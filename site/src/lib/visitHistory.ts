// "New since your last visit" needs nothing beyond what's already fetched
// — just remembering which ids were seen last time, in plain localStorage
// (a set of 16-char hex ids for ~1,400 items is a few KB, well under
// localStorage's ceiling; this is exactly the kind of small, short-lived
// preference localStorage is for, unlike the tracker's IndexedDB data).

const LAST_SEEN_IDS_KEY = "tracker:lastSeenIds";
const LAST_SEEN_AT_KEY = "tracker:lastSeenAt";

export interface LastVisit {
  ids: Set<string>;
  // null specifically means "no prior visit recorded" — distinct from an
  // empty id set, which would incorrectly mark every current item "new"
  // the very first time someone opens the site.
  at: string | null;
}

export function readLastVisit(): LastVisit {
  if (typeof window === "undefined") return { ids: new Set(), at: null };
  try {
    const rawIds = window.localStorage.getItem(LAST_SEEN_IDS_KEY);
    const at = window.localStorage.getItem(LAST_SEEN_AT_KEY);
    if (rawIds === null || at === null) return { ids: new Set(), at: null };
    const parsed: unknown = JSON.parse(rawIds);
    return { ids: new Set(Array.isArray(parsed) ? (parsed as string[]) : []), at };
  } catch {
    return { ids: new Set(), at: null };
  }
}

export function writeLastVisit(ids: readonly string[], at: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_SEEN_IDS_KEY, JSON.stringify(ids));
    window.localStorage.setItem(LAST_SEEN_AT_KEY, at);
  } catch {
    // Quota exceeded or storage disabled (some private-browsing modes) —
    // this feature is a nice-to-have; silently skipping the write just
    // means "new since last visit" won't fire next time, not a real error.
  }
}
