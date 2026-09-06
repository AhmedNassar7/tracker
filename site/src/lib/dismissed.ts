// "Not interested" memory — the other half of visitHistory.ts. A viewer can
// dismiss an opportunity and it stays gone on every later visit, so the list
// keeps getting more relevant instead of showing the same roles they've
// already decided against (Otta's "never show the same job twice").
//
// Same storage story as visitHistory / savedSearches / preferences: plain
// localStorage, every access guarded, nothing leaves the browser. Stored as
// a JSON array so insertion order is kept and the oldest entries can be
// evicted once the cap is hit — a 16-char id is tiny, but an unbounded set
// on a heavy multi-year user shouldn't be able to creep toward the quota.

const KEY = "tracker:dismissedIds";
const MAX = 3000;

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function write(ids: readonly string[]): void {
  if (typeof window === "undefined") return;
  try {
    // Keep the most-recently-dismissed MAX; older ones fall off. A role that
    // aged off the list is almost certainly closed anyway, so losing its
    // "dismissed" flag has no visible effect.
    window.localStorage.setItem(KEY, JSON.stringify(ids.slice(-MAX)));
  } catch {
    /* quota / disabled — feature silently no-ops, same as the sibling libs */
  }
}

export function readDismissed(): Set<string> {
  return new Set(read());
}

export function addDismissed(id: string): Set<string> {
  const next = read().filter((x) => x !== id);
  next.push(id);
  write(next);
  return new Set(next);
}

export function removeDismissed(id: string): Set<string> {
  const next = read().filter((x) => x !== id);
  write(next);
  return new Set(next);
}

export function clearDismissed(): Set<string> {
  write([]);
  return new Set();
}
