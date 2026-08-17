import type { SiteIndexEntry, SiteIndexKind } from "./types";

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

// URL query param names — short, but distinct from likely-future params
// (e.g. a saved-view id) so shared links stay readable.
const PARAM_KEYS: Record<keyof FilterState, string> = {
  q: "q",
  kind: "kind",
  level: "level",
  region: "region",
  remote: "remote",
};

export function filtersFromSearchParams(params: URLSearchParams): FilterState {
  return {
    q: params.get(PARAM_KEYS.q) ?? DEFAULT_FILTERS.q,
    kind: (params.get(PARAM_KEYS.kind) as FilterState["kind"]) || DEFAULT_FILTERS.kind,
    level: params.get(PARAM_KEYS.level) ?? DEFAULT_FILTERS.level,
    region: params.get(PARAM_KEYS.region) ?? DEFAULT_FILTERS.region,
    remote: params.get(PARAM_KEYS.remote) ?? DEFAULT_FILTERS.remote,
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
