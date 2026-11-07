// "Is what's on screen a saved snapshot rather than live data?" — set by
// dataSource.ts when the service worker answers a data request from its saved
// copy (it flags those responses `x-tracker-from-cache`, and stamps when the
// copy was saved `x-tracker-saved-at`; see public/sw.js).
//
// Lives on `window` + a DOM event rather than React state because the fetch
// that discovers it (HeaderStat, the job list, …) and the banner that shows it
// are different islands, and the fetch can finish BEFORE the banner mounts —
// so a late subscriber must be able to read the current value, not just wait
// for the next event.

export const CACHED_DATA_EVENT = "tracker:cached-data";

declare global {
  interface Window {
    __trackerCachedData?: { savedAt: string | null };
  }
}

export function reportCachedData(savedAt: string | null): void {
  if (typeof window === "undefined") return;
  window.__trackerCachedData = { savedAt };
  window.dispatchEvent(new CustomEvent(CACHED_DATA_EVENT, { detail: { savedAt } }));
}

export function readCachedData(): { savedAt: string | null } | null {
  if (typeof window === "undefined") return null;
  return window.__trackerCachedData ?? null;
}

/** "3h ago" style age of a saved copy, or "" when unknown/unparseable. A
 *  saved copy is by definition in the past, so a future time (clock skew)
 *  reads as "just now" rather than a negative number. */
export function savedAgo(savedAt: string | null | undefined, now: number = Date.now()): string {
  if (!savedAt) return "";
  const t = Date.parse(savedAt);
  if (Number.isNaN(t)) return "";
  const minutes = Math.max(0, Math.round((now - t) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
