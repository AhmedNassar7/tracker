// Opt-in local notifications (Lane C7). This project has no backend and no
// paid push service (see CLAUDE.md — stdlib/free-tier only), so there's no
// way to notify someone whose tab is closed with any guarantee. What this
// gives instead:
//   1. A per-visit check (`checkAndNotify`) — runs whenever the Jobs page
//      has fresh data loaded, diffs it against your saved searches + your
//      bookmarked hackathon/event deadlines, and fires a real browser
//      Notification if there's something new. This is the guaranteed half.
//   2. A best-effort `periodicSync` registration (`registerBackgroundSync`)
//      — Chrome-only, requires the PWA installed plus a "high" site-
//      engagement score the browser computes on its own, and the service
//      worker has no access to localStorage so it can only show a generic
//      "check the app" nudge, never a real count. Might never fire; the
//      per-visit check above is the real feature.
// Permission is requested only from an explicit "turn on alerts" tap
// (`enableNotifications`), never on page load.

import { BASE_URL } from "./basePath";
import { applyFilters } from "./filters";
import { filtersForSavedSearch, listSavedSearches, type SavedSearch } from "./savedSearches";
import type { TrackedApplication } from "./tracker";
import type { SiteIndexEntry } from "./types";

const ENABLED_KEY = "tracker:notifyEnabled";
const LAST_CHECK_KEY = "tracker:notifyLastCheck";

// The pipeline itself only refreshes hourly and a saved search rarely gets
// a genuinely new match more often than that — checking more often than
// this would just re-run the same diff against unchanged data.
const MIN_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function isNotifyEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export async function enableNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return false;
  try {
    window.localStorage.setItem(ENABLED_KEY, "1");
  } catch {
    // Storage disabled — the toggle just won't remember itself next visit.
  }
  void registerBackgroundSync();
  return true;
}

export function disableNotifications(): void {
  try {
    window.localStorage.removeItem(ENABLED_KEY);
  } catch {
    // Best effort, same as every other localStorage write in this project.
  }
}

function readLastCheck(): number {
  try {
    return Number(window.localStorage.getItem(LAST_CHECK_KEY) ?? 0);
  } catch {
    return 0;
  }
}

function writeLastCheck(at: number): void {
  try {
    window.localStorage.setItem(LAST_CHECK_KEY, String(at));
  } catch {
    // Best effort — worst case, the next visit re-checks sooner than ideal.
  }
}

// A saved-search match is only worth announcing if it's new-ish — otherwise
// every visit would re-announce the entire saved search, not just what
// changed since the last check.
function isFreshEnough(age: string): boolean {
  const a = (age || "").trim().toLowerCase();
  return a === "0d" || a === "1d";
}

// Mirrors OpportunityBrowser's own `deadlineDays` (a hackathon/event's `age`
// is a countdown to its own deadline, not a posting age) — duplicated
// rather than imported, since that helper lives in a component module and
// this is a plain lib with no React/JSX dependency.
const DEADLINE_UNIT_TO_DAYS: Record<string, number> = { hour: 1 / 24, day: 1, month: 30, year: 365 };
function deadlineDays(age: string): number | null {
  const hint = (age || "").trim().toLowerCase();
  if (!hint || hint === "closed" || hint === "ended" || hint === "concluded") return null;
  if (hint === "last day" || hint === "today" || hint === "happening now") return 0;
  let m = hint.match(/^(\d+)\s*(?:d|days?)(?:\s+left)?$/);
  if (m) return +m[1];
  m = hint.match(/^(?:about\s+)?(\d+)\s*(hour|day|month|year)s?(?:\s+left)?$/);
  if (m) return +m[1] * DEADLINE_UNIT_TO_DAYS[m[2]];
  m = hint.match(/(\d+)\s*days?\s+left/);
  if (m) return +m[1];
  return null;
}

// A bookmarked/applied/OA/interview hackathon or event still "counts" —
// rejected or a plain job (no deadline concept) don't.
const DEADLINE_RELEVANT_STATUSES = new Set(["bookmarked", "applied", "oa", "interview"]);

export interface NotifyCheckResult {
  fired: boolean;
  reasons: string[];
}

function browserChannelActive(): boolean {
  return isNotifyEnabled() && notificationsSupported() && Notification.permission === "granted";
}

// Lane C4 — the user's own webhook, POSTed to directly from the browser
// (no server of ours in the middle; the URL never leaves this device except
// straight to the host it points at). `mode: "no-cors"` is deliberate, not
// an oversight: a JSON POST with `Content-Type: application/json` is a
// "non-simple" request that triggers a CORS preflight first, and most
// incoming-webhook endpoints (Slack's, certainly) don't answer that
// preflight — the browser would then abort the request and NEVER actually
// deliver it. A `no-cors` request is restricted to "simple request" shape
// (no preflight), which both Discord and Slack are known to accept a
// JSON-encoded body under regardless of the resulting `text/plain`
// Content-Type — Slack's own webhook docs even document `text/plain` as
// the sanctioned workaround for exactly this browser limitation. The
// tradeoff: the response is opaque, so delivery can never be confirmed
// from here — this is a fire-and-forget, same as any local notification.
function postWebhook(url: string, text: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return; // a malformed saved URL — nothing sane to POST to
  }

  if (host.endsWith("api.telegram.org")) {
    // Telegram has no generic "incoming webhook" the way Discord/Slack do —
    // the pasted URL is expected to be a full bot `sendMessage` endpoint
    // with the token + chat_id already embedded, so the message is just
    // appended as a query param (a plain GET, no body/Content-Type at all).
    const sep = url.includes("?") ? "&" : "?";
    void fetch(`${url}${sep}text=${encodeURIComponent(text)}`, { mode: "no-cors" }).catch(() => undefined);
    return;
  }

  const body = host.endsWith("hooks.slack.com") ? JSON.stringify({ text }) : JSON.stringify({ content: text });
  void fetch(url, { method: "POST", mode: "no-cors", body }).catch(() => undefined);
}

export function checkAndNotify(
  items: SiteIndexEntry[],
  tracked: Map<string, TrackedApplication>,
  now: Date = new Date(),
): NotifyCheckResult {
  const searches = listSavedSearches();
  const browserActive = browserChannelActive();
  const anyWebhook = searches.some((s) => !!s.webhookUrl);
  // Nothing is opted in on either channel — skip entirely rather than burn
  // the shared rate-limit window computing a diff nobody will see.
  if (!browserActive && !anyWebhook) return { fired: false, reasons: [] };
  if (now.getTime() - readLastCheck() < MIN_CHECK_INTERVAL_MS) return { fired: false, reasons: [] };
  writeLastCheck(now.getTime());

  const reasons: string[] = [];
  const perSearchMatches: { search: SavedSearch; matches: SiteIndexEntry[] }[] = [];

  for (const search of searches) {
    const filters = filtersForSavedSearch(search);
    const matches = applyFilters(items, filters).filter((item) => item.kind === "job" && isFreshEnough(item.age));
    perSearchMatches.push({ search, matches });
    if (matches.length > 0) {
      reasons.push(`${matches.length} new match${matches.length === 1 ? "" : "es"} for "${search.name}"`);
    }
  }

  const byId = new Map(items.map((item) => [item.id, item]));
  let closingSoon = 0;
  for (const app of tracked.values()) {
    if (app.kind === "job" || !DEADLINE_RELEVANT_STATUSES.has(app.status)) continue;
    const live = byId.get(app.id);
    if (!live) continue;
    const days = deadlineDays(live.age);
    if (days !== null && days <= 2) closingSoon += 1;
  }
  if (closingSoon > 0) {
    reasons.push(`${closingSoon} bookmarked ${closingSoon === 1 ? "deadline closes" : "deadlines close"} within 48h`);
  }

  if (browserActive && reasons.length > 0) {
    try {
      new Notification("Tracker — new since your last visit", {
        body: reasons.join(" · "),
        tag: "tracker-digest",
        icon: `${BASE_URL}favicon.svg`,
      });
    } catch {
      // Some browsers/webviews throw constructing Notification directly
      // outside a service worker — the toggle just has no visible effect
      // there, not a crash.
    }
  }

  // Webhooks are per-search and independent of the browser toggle — a
  // saved search with a webhook set still posts even if the visitor never
  // turned browser alerts on at all.
  for (const { search, matches } of perSearchMatches) {
    if (search.webhookUrl && matches.length > 0) {
      const names = matches.slice(0, 5).map((m) => `${m.company} — ${m.title}`);
      const more = matches.length > names.length ? ` (+${matches.length - names.length} more)` : "";
      postWebhook(
        search.webhookUrl,
        `🔔 Tracker: ${matches.length} new match${matches.length === 1 ? "" : "es"} for "${search.name}"\n${names.join("\n")}${more}`,
      );
    }
  }

  return { fired: browserActive && reasons.length > 0, reasons };
}

type PeriodicSyncRegistration = ServiceWorkerRegistration & {
  periodicSync?: { register: (tag: string, options: { minInterval: number }) => Promise<void> };
};

export async function registerBackgroundSync(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const registration = (await navigator.serviceWorker.ready) as PeriodicSyncRegistration;
    if (!registration.periodicSync) return;
    await registration.periodicSync.register("tracker-digest-check", { minInterval: MIN_CHECK_INTERVAL_MS });
  } catch {
    // Permission denied, unsupported, or the PWA isn't installed — silently
    // skip; the per-visit check is the feature that actually works everywhere.
  }
}
