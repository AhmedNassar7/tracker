import type { Level, Region, RemoteType, SiteIndexEntry, SiteIndexKind } from "./types";

export interface FilterState {
  q: string;
  kind: SiteIndexKind | "all";
  level: string;
  region: string;
  remote: string;
}

export const DEFAULT_FILTERS: FilterState = {
  q: "",
  kind: "all",
  level: "",
  region: "",
  remote: "",
};

// Single source of truth for what each dropdown may legally hold — used both
// to build FilterBar's option lists and to validate incoming URL query
// params below, so the two can never drift apart.
export const KIND_VALUES: readonly (SiteIndexKind | "all")[] = ["all", "job", "hackathon", "event"];
export const LEVEL_VALUES: readonly Level[] = [
  "internship",
  "new_grad",
  "junior",
  "entry_level",
  "mid_level",
  "other",
  "unknown",
];
export const REGION_VALUES: readonly Region[] = ["us", "canada", "emea", "remote", "unknown"];
export const REMOTE_VALUES: readonly RemoteType[] = ["remote", "hybrid", "onsite", "unknown"];

// URL query param names — short, but distinct from likely-future params
// (e.g. a saved-view id) so shared links stay readable.
const PARAM_KEYS: Record<keyof FilterState, string> = {
  q: "q",
  kind: "kind",
  level: "level",
  region: "region",
  remote: "remote",
};

// A hand-edited or stale shared URL can carry any string in its query
// params. Falling back to the default for anything outside the known set
// means a bad `?level=xyz` degrades to "show everything" instead of
// silently matching zero rows with no visible explanation why. Every
// FilterState field is a plain string (kind is narrowed at the call site
// below), so this stays untyped rather than forcing values through the
// stricter Level/Region/RemoteType enums it's validating against.
function pickValid(raw: string | null, valid: readonly string[], fallback: string): string {
  return raw && valid.includes(raw) ? raw : fallback;
}

export function filtersFromSearchParams(params: URLSearchParams): FilterState {
  return {
    q: params.get(PARAM_KEYS.q) ?? DEFAULT_FILTERS.q,
    kind: pickValid(params.get(PARAM_KEYS.kind), KIND_VALUES, DEFAULT_FILTERS.kind) as FilterState["kind"],
    level: pickValid(params.get(PARAM_KEYS.level), LEVEL_VALUES, DEFAULT_FILTERS.level),
    region: pickValid(params.get(PARAM_KEYS.region), REGION_VALUES, DEFAULT_FILTERS.region),
    remote: pickValid(params.get(PARAM_KEYS.remote), REMOTE_VALUES, DEFAULT_FILTERS.remote),
  };
}

// Only non-default values are written to the URL, so the common "no filters"
// case is a clean path with no query string at all.
export function searchParamsFromFilters(filters: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  (Object.keys(PARAM_KEYS) as (keyof FilterState)[]).forEach((key) => {
    const value = filters[key];
    if (value && value !== DEFAULT_FILTERS[key]) {
      params.set(PARAM_KEYS[key], value);
    }
  });
  return params;
}

export function applyFilters(items: SiteIndexEntry[], filters: FilterState): SiteIndexEntry[] {
  const q = filters.q.trim().toLowerCase();
  return items.filter((item) => {
    if (filters.kind !== "all" && item.kind !== filters.kind) return false;
    if (filters.level && item.level !== filters.level) return false;
    if (filters.region && item.region !== filters.region) return false;
    if (filters.remote && item.remote_type !== filters.remote) return false;
    if (q && !`${item.company} ${item.title}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function hasActiveFilters(filters: FilterState): boolean {
  return (
    filters.q !== "" ||
    filters.kind !== "all" ||
    filters.level !== "" ||
    filters.region !== "" ||
    filters.remote !== ""
  );
}
