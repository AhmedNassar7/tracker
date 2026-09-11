// Whether the visitor has already seen (or explicitly dismissed) the
// first-visit product tour. Same shape as visitHistory.ts: plain
// localStorage, SSR-guarded, and silently a no-op if storage is unavailable
// (private-browsing modes, quota) — this is a nice-to-have, never something
// worth failing the page over.

const TOUR_SEEN_KEY = "tracker:tourSeen";

export function hasSeenTour(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(TOUR_SEEN_KEY) === "1";
  } catch {
    // Can't tell — default to "seen" so a storage error never traps a
    // returning visitor into the modal on every load.
    return true;
  }
}

export function markTourSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOUR_SEEN_KEY, "1");
  } catch {
    // Storage disabled — the tour will just reopen next visit, not a bug.
  }
}
