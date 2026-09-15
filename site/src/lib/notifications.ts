// Per-search webhook push (Lane C4). The browser-notification half of this
// (Lane C7 — a "Turn on alerts" toggle + Notification permission +
// periodicSync) was built and then removed: users didn't know what it meant
// or when it would fire, and it duplicated what the webhook already does
// more concretely — you paste a URL you control, tied to one named search,
// with an obvious mental model. See `SavedSearches.tsx`'s 🔗 button.

import { applyFilters } from "./filters";
import { filtersForSavedSearch, listSavedSearches } from "./savedSearches";
import type { SiteIndexEntry } from "./types";

const LAST_CHECK_KEY = "tracker:notifyLastCheck";

// The pipeline itself only refreshes hourly and a saved search rarely gets
// a genuinely new match more often than that — checking more often than
// this would just re-run the same diff against unchanged data.
const MIN_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

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

// The user's own webhook, POSTed to directly from the browser (no server of
// ours in the middle; the URL never leaves this device except straight to
// the host it points at). `mode: "no-cors"` is deliberate, not an oversight:
// a JSON POST with `Content-Type: application/json` is a "non-simple"
// request that triggers a CORS preflight first, and most incoming-webhook
// endpoints (Slack's, certainly) don't answer that preflight — the browser
// would then abort the request and NEVER actually deliver it. A `no-cors`
// request is restricted to "simple request" shape (no preflight), which
// both Discord and Slack are known to accept a JSON-encoded body under
// regardless of the resulting `text/plain` Content-Type — Slack's own
// webhook docs even document `text/plain` as the sanctioned workaround for
// exactly this browser limitation. The tradeoff: the response is opaque, so
// delivery can never be confirmed from here — this is fire-and-forget.
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

export interface WebhookPushResult {
  pushed: number;
}

// Runs from OpportunityBrowser whenever the Jobs page has fresh data loaded.
// No-ops instantly unless at least one saved search has a webhook set, and
// is rate-limited to roughly once per pipeline refresh either way.
export function pushWebhookMatches(items: SiteIndexEntry[], now: Date = new Date()): WebhookPushResult {
  const searches = listSavedSearches().filter((s) => !!s.webhookUrl);
  if (searches.length === 0) return { pushed: 0 };
  if (now.getTime() - readLastCheck() < MIN_CHECK_INTERVAL_MS) return { pushed: 0 };
  writeLastCheck(now.getTime());

  let pushed = 0;
  for (const search of searches) {
    const matches = applyFilters(items, filtersForSavedSearch(search)).filter(
      (item) => item.kind === "job" && isFreshEnough(item.age),
    );
    if (matches.length === 0) continue;
    const names = matches.slice(0, 5).map((m) => `${m.company} — ${m.title}`);
    const more = matches.length > names.length ? ` (+${matches.length - names.length} more)` : "";
    postWebhook(
      search.webhookUrl as string,
      `🔔 Tracker: ${matches.length} new match${matches.length === 1 ? "" : "es"} for "${search.name}"\n${names.join("\n")}${more}`,
    );
    pushed += 1;
  }
  return { pushed };
}
