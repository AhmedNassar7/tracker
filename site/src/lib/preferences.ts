// Personalisation, Lane H model: "your preferences" = a filter you saved,
// plus two ranking-only knobs that don't work as hard filters (keyword boost,
// exclude companies). All local, all in localStorage, nothing leaves the
// browser, no account.
//
//   savedPrefFilter  — a FilterState the user pressed "Save as my preferences"
//                       on. Drives the "Relevance" sort and (later) alerts.
//   RankTune         — { keywords, excludeCompanies }: nudges applied on top
//                       of the saved filter when ranking.

import { DEFAULT_FILTERS, type FilterState } from "./filters";
import type { SiteIndexEntry } from "./types";

const PREF_FILTER_KEY = "tracker:prefFilter";
const RANK_TUNE_KEY = "tracker:rankTune";
const SORT_MODE_KEY = "tracker:sortMode";

export type SortMode = "tier" | "newest" | "relevance";

export interface RankTune {
  keywords: string[]; // free text, matched against title + company + location
  excludeCompanies: string[]; // lower-cased company substrings to hide entirely
}

export const EMPTY_RANK_TUNE: RankTune = { keywords: [], excludeCompanies: [] };

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
}

// ---- saved preference filter ------------------------------------------------

export function readPrefFilter(): FilterState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PREF_FILTER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FilterState>;
    // Merge onto DEFAULT_FILTERS so an old/partial shape can't crash a consumer.
    return {
      ...DEFAULT_FILTERS,
      ...parsed,
      levels: normalizeList(parsed.levels),
      regions: normalizeList(parsed.regions),
      remotes: normalizeList(parsed.remotes),
      countries: normalizeList(parsed.countries),
      tags: normalizeList(parsed.tags),
      q: typeof parsed.q === "string" ? parsed.q : "",
      kind: parsed.kind ?? "all",
      visa: parsed.visa === "yes" ? "yes" : "",
      nodegree: parsed.nodegree === "yes" ? "yes" : "",
    };
  } catch {
    return null;
  }
}

export function writePrefFilter(filters: FilterState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREF_FILTER_KEY, JSON.stringify(filters));
  } catch {
    /* storage full / disabled — kept for this session only */
  }
}

export function clearPrefFilter(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PREF_FILTER_KEY);
  } catch {
    /* ignore */
  }
}

/** A saved filter is "real" if it narrows anything — otherwise Relevance has
 *  nothing to rank against and stays disabled. */
export function prefFilterIsMeaningful(f: FilterState | null): boolean {
  if (!f) return false;
  return (
    f.q.trim() !== "" ||
    f.kind !== "all" ||
    f.visa === "yes" ||
    f.nodegree === "yes" ||
    f.levels.length > 0 ||
    f.regions.length > 0 ||
    f.remotes.length > 0 ||
    f.countries.length > 0 ||
    f.tags.length > 0
  );
}

/** Do two FilterStates describe the same query? (used for the "Saved ✓ /
 *  Update" button state) */
export function filtersEqual(a: FilterState, b: FilterState): boolean {
  const sameArr = (x: string[], y: string[]) => x.length === y.length && [...x].sort().join(",") === [...y].sort().join(",");
  return (
    a.q.trim() === b.q.trim() &&
    a.kind === b.kind &&
    a.visa === b.visa &&
    a.nodegree === b.nodegree &&
    sameArr(a.levels, b.levels) &&
    sameArr(a.regions, b.regions) &&
    sameArr(a.remotes, b.remotes) &&
    sameArr(a.countries, b.countries) &&
    sameArr(a.tags, b.tags)
  );
}

// ---- ranking-only tune ----------------------------------------------------

export function readRankTune(): RankTune {
  if (typeof window === "undefined") return { ...EMPTY_RANK_TUNE };
  try {
    const raw = window.localStorage.getItem(RANK_TUNE_KEY);
    if (!raw) return { ...EMPTY_RANK_TUNE };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      keywords: normalizeList(parsed.keywords),
      excludeCompanies: normalizeList(parsed.excludeCompanies).map((c) => c.toLowerCase()),
    };
  } catch {
    return { ...EMPTY_RANK_TUNE };
  }
}

export function writeRankTune(tune: RankTune): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RANK_TUNE_KEY, JSON.stringify(tune));
  } catch {
    /* ignore */
  }
}

// ---- sort mode ----------------------------------------------------------

/** The user's explicitly-chosen sort, or null if they've never picked one
 *  (so the caller can default to Relevance when a saved filter exists). */
export function readSortMode(): SortMode | null {
  if (typeof window === "undefined") return null;
  try {
    const s = window.localStorage.getItem(SORT_MODE_KEY);
    return s === "relevance" || s === "newest" || s === "tier" ? s : null;
  } catch {
    return null;
  }
}

export function writeSortMode(mode: SortMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SORT_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

// ---- scoring / ranking ------------------------------------------------------

export function isExcluded(item: SiteIndexEntry, tune: RankTune): boolean {
  if (tune.excludeCompanies.length === 0) return false;
  const company = (item.company || "").toLowerCase();
  return tune.excludeCompanies.some((needle) => company.includes(needle));
}

/** True when the item flatly contradicts a HARD facet of the saved filter —
 *  its level isn't one the user asked for, or its kind isn't. These are
 *  partitioned below a "show anyway" line in Relevance sort rather than
 *  interleaved (H4). Soft facets (region/remote/country/tags) only lower the
 *  score, they don't banish. */
export function contradictsPrefFilter(item: SiteIndexEntry, pref: FilterState): boolean {
  if (pref.kind !== "all" && item.kind !== pref.kind) return true;
  if (pref.levels.length > 0 && !(item.level && pref.levels.includes(item.level))) return true;
  return false;
}

/** Higher = better fit. Each satisfied saved-filter facet adds a fixed
 *  weight; keyword hits and freshness are small nudges. Explainable — see
 *  matchReasons. A no-signal item scores 0, never negative, so Relevance
 *  floats the good stuff up without burying everything else. */
export function scoreOpportunity(item: SiteIndexEntry, pref: FilterState, tune: RankTune): number {
  let score = 0;
  if (pref.levels.length > 0 && item.level && pref.levels.includes(item.level)) score += 3;
  if (pref.regions.length > 0 && item.region && pref.regions.includes(item.region)) score += 2;
  if (pref.remotes.length > 0 && item.remote_type && pref.remotes.includes(item.remote_type)) score += 2;
  if (pref.countries.length > 0 && item.country && pref.countries.includes(item.country)) score += 2;
  if (pref.tags.length > 0) {
    const tags = item.tech_tags ?? [];
    for (const t of pref.tags) if (tags.includes(t)) score += 1;
  }
  const haystack = `${item.title} ${item.company} ${item.location}`.toLowerCase();
  if (pref.q.trim() && haystack.includes(pref.q.trim().toLowerCase())) score += 2;
  for (const kw of tune.keywords) if (haystack.includes(kw.toLowerCase())) score += 2;

  const age = (item.age || "").trim();
  if (age === "0d") score += 1;
  else if (age === "1d") score += 0.5;
  return score;
}

export function matchReasons(item: SiteIndexEntry, pref: FilterState, tune: RankTune): string[] {
  const reasons: string[] = [];
  if (pref.levels.length > 0 && item.level && pref.levels.includes(item.level)) {
    reasons.push(item.level.replace(/_/g, " "));
  }
  if (pref.regions.length > 0 && item.region && pref.regions.includes(item.region)) reasons.push(item.region.toUpperCase());
  if (pref.remotes.length > 0 && item.remote_type && pref.remotes.includes(item.remote_type)) reasons.push(item.remote_type);
  if (pref.countries.length > 0 && item.country && pref.countries.includes(item.country)) reasons.push(item.country);
  if (pref.tags.length > 0) {
    const tags = item.tech_tags ?? [];
    for (const t of pref.tags) if (tags.includes(t)) reasons.push(t);
  }
  const haystack = `${item.title} ${item.company} ${item.location}`.toLowerCase();
  for (const kw of tune.keywords) if (haystack.includes(kw.toLowerCase())) reasons.push(`"${kw}"`);
  return reasons;
}
