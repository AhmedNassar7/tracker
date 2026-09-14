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
import { filtersForSavedSearch, listSavedSearches } from "./savedSearches";
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

export function checkAndNotify(
  items: SiteIndexEntry[],
  tracked: Map<string, TrackedApplication>,
  now: Date = new Date(),
): NotifyCheckResult {
  if (!isNotifyEnabled() || !notificationsSupported() || Notification.permission !== "granted") {
    return { fired: false, reasons: [] };
  }
  if (now.getTime() - readLastCheck() < MIN_CHECK_INTERVAL_MS) return { fired: false, reasons: [] };
  writeLastCheck(now.getTime());

  const reasons: string[] = [];

  for (const search of listSavedSearches()) {
    const filters = filtersForSavedSearch(search);
    const matches = applyFilters(items, filters).filter((item) => item.kind === "job" && isFreshEnough(item.age));
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

  if (reasons.length === 0) return { fired: false, reasons: [] };

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

  return { fired: true, reasons };
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
