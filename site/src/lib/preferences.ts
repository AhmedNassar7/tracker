// Local, per-viewer preferences that power the "Best match" sort. Same
// storage story as visitHistory.ts — plain localStorage, small, guarded,
// degrades to "no preferences set" if storage is unavailable. Nothing here
// is sent anywhere; there is no account and no server.

import type { SiteIndexEntry } from "./types";

export interface Preferences {
  levels: string[]; // e.g. ["internship", "new_grad"] — matches SiteIndexEntry.level
  regions: string[]; // e.g. ["us", "remote"] — matches SiteIndexEntry.region
  remote: string[]; // e.g. ["remote", "hybrid"] — matches SiteIndexEntry.remote_type
  keywords: string[]; // free text, matched case-insensitively against title + company
  excludeCompanies: string[]; // lower-cased company substrings to hide entirely
}

export const EMPTY_PREFERENCES: Preferences = {
  levels: [],
  regions: [],
  remote: [],
  keywords: [],
  excludeCompanies: [],
};

const PREFERENCES_KEY = "tracker:preferences";
const SORT_MODE_KEY = "tracker:sortMode";

export type SortMode = "tier" | "newest" | "match";

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
}

export function readPreferences(): Preferences {
  if (typeof window === "undefined") return { ...EMPTY_PREFERENCES };
  try {
    const raw = window.localStorage.getItem(PREFERENCES_KEY);
    if (!raw) return { ...EMPTY_PREFERENCES };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      levels: normalizeList(parsed.levels),
      regions: normalizeList(parsed.regions),
      remote: normalizeList(parsed.remote),
      keywords: normalizeList(parsed.keywords),
      excludeCompanies: normalizeList(parsed.excludeCompanies).map((c) => c.toLowerCase()),
    };
  } catch {
    return { ...EMPTY_PREFERENCES };
  }
}

export function writePreferences(prefs: Preferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
  } catch {
    // storage full / disabled — the panel still works for this session,
    // it just won't be remembered next time.
  }
}

export function readSortMode(): SortMode {
  // "tier" (best-known companies first) is the default a new visitor sees.
  if (typeof window === "undefined") return "tier";
  try {
    const stored = window.localStorage.getItem(SORT_MODE_KEY);
    return stored === "match" || stored === "newest" || stored === "tier" ? stored : "tier";
  } catch {
    return "tier";
  }
}

export function writeSortMode(mode: SortMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SORT_MODE_KEY, mode);
  } catch {
    /* see writePreferences */
  }
}

export function hasPreferences(prefs: Preferences): boolean {
  return (
    prefs.levels.length > 0 ||
    prefs.regions.length > 0 ||
    prefs.remote.length > 0 ||
    prefs.keywords.length > 0
  );
}

export function isExcluded(item: SiteIndexEntry, prefs: Preferences): boolean {
  if (prefs.excludeCompanies.length === 0) return false;
  const company = (item.company || "").toLowerCase();
  return prefs.excludeCompanies.some((needle) => company.includes(needle));
}

/** Higher = better fit. Deliberately simple and explainable (see matchReasons):
 *  each satisfied preference adds a fixed weight, plus a small freshness nudge
 *  so ties break toward newer postings. A job with no signal still scores 0,
 *  not negative, so "Best match" never buries everything unmatched below the
 *  fold — it just floats the good stuff up. */
export function scoreOpportunity(item: SiteIndexEntry, prefs: Preferences): number {
  let score = 0;
  if (item.level && prefs.levels.includes(item.level)) score += 3;
  if (item.region && prefs.regions.includes(item.region)) score += 2;
  if (item.remote_type && prefs.remote.includes(item.remote_type)) score += 2;

  if (prefs.keywords.length > 0) {
    const haystack = `${item.title} ${item.company} ${item.location}`.toLowerCase();
    for (const kw of prefs.keywords) {
      if (haystack.includes(kw.toLowerCase())) score += 2;
    }
  }

  const age = (item.age || "").trim();
  if (age === "0d") score += 1;
  else if (age === "1d") score += 0.5;

  return score;
}

export function matchReasons(item: SiteIndexEntry, prefs: Preferences): string[] {
  const reasons: string[] = [];
  if (item.level && prefs.levels.includes(item.level)) {
    reasons.push(item.level.replace(/_/g, " "));
  }
  if (item.region && prefs.regions.includes(item.region)) reasons.push(item.region.toUpperCase());
  if (item.remote_type && prefs.remote.includes(item.remote_type)) reasons.push(item.remote_type);
  if (prefs.keywords.length > 0) {
    const haystack = `${item.title} ${item.company} ${item.location}`.toLowerCase();
    for (const kw of prefs.keywords) {
      if (haystack.includes(kw.toLowerCase())) reasons.push(`"${kw}"`);
    }
  }
  return reasons;
}
