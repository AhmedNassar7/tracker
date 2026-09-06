import type { Level, Region, RemoteType, SiteIndexEntry, SiteIndexKind } from "./types";

// The filter bar is the ONE place facets live (Lane H). Every multi-value
// facet is a string[] — empty array = "don't filter on this". `kind` stays
// single (it's the tab row); `q` is free text; `visa` is an explicit-only
// flag ("" | "yes").
export interface FilterState {
  q: string;
  kind: SiteIndexKind | "all";
  levels: string[];
  regions: string[];
  remotes: string[];
  countries: string[];
  companies: string[];
  tags: string[];
  // B4 — "yes" ⇒ only postings that *explicitly* offer visa sponsorship. No
  // "no" option: a silent posting isn't a match either way. (A "no degree
  // required" filter existed here too and was removed as low-value clutter;
  // the `degree_required` signal is still detected and shown as a chip.)
  visa: string;
}

export const DEFAULT_FILTERS: FilterState = {
  q: "",
  kind: "all",
  levels: [],
  regions: [],
  remotes: [],
  countries: [],
  companies: [],
  tags: [],
  visa: "",
};

// Single source of truth for what each facet may legally hold — used to
// build FilterBar's option lists AND to validate incoming URL params, so the
// two can't drift.
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
export const REGION_VALUES: readonly Region[] = ["us", "canada", "mena", "emea", "remote", "unknown"];
export const REMOTE_VALUES: readonly RemoteType[] = ["remote", "hybrid", "onsite", "unknown"];
export const FACET_FLAG_VALUES: readonly string[] = ["yes"];

// The FilterState keys that are string[] facets — iterated by the URL
// (de)serializer and by hasActiveFilters so adding a facet is one line.
export const ARRAY_FACET_KEYS = ["levels", "regions", "remotes", "countries", "companies", "tags"] as const;
type ArrayFacetKey = (typeof ARRAY_FACET_KEYS)[number];

// URL param name per FilterState key. Arrays serialize as a comma-joined
// list (`?levels=internship,new_grad`) — readable in a shared link.
const PARAM_KEYS: Record<keyof FilterState, string> = {
  q: "q",
  kind: "kind",
  levels: "levels",
  regions: "regions",
  remotes: "remote",
  countries: "country",
  companies: "company",
  tags: "tag",
  visa: "visa",
};

// Fixed-enum facets get their incoming values filtered to the known set, so
// a stale/hand-edited `?levels=foo,internship` keeps `internship` and drops
// `foo` instead of matching nothing with no visible reason. country/tag are
// free-form (whatever's in the data) so they pass through as-is — the
// FilterBar only ever offers real values, so a bad one just matches zero.
const ENUM_FOR_FACET: Partial<Record<ArrayFacetKey, readonly string[]>> = {
  levels: LEVEL_VALUES,
  regions: REGION_VALUES,
  remotes: REMOTE_VALUES,
};

function splitParam(raw: string | null, allowed?: readonly string[]): string[] {
  if (!raw) return [];
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (allowed && !allowed.includes(p)) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

function pickValid(raw: string | null, valid: readonly string[], fallback: string): string {
  return raw && valid.includes(raw) ? raw : fallback;
}

export function filtersFromSearchParams(params: URLSearchParams): FilterState {
  const next: FilterState = {
    ...DEFAULT_FILTERS,
    levels: [],
    regions: [],
    remotes: [],
    countries: [],
    companies: [],
    tags: [],
  };
  next.q = params.get(PARAM_KEYS.q) ?? "";
  next.kind = pickValid(params.get(PARAM_KEYS.kind), KIND_VALUES, DEFAULT_FILTERS.kind) as FilterState["kind"];
  next.visa = pickValid(params.get(PARAM_KEYS.visa), FACET_FLAG_VALUES, "");
  for (const key of ARRAY_FACET_KEYS) {
    next[key] = splitParam(params.get(PARAM_KEYS[key]), ENUM_FOR_FACET[key]);
  }
  return next;
}

// Only non-default values reach the URL, so "no filters" is a clean path.
export function searchParamsFromFilters(filters: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set(PARAM_KEYS.q, filters.q);
  if (filters.kind !== DEFAULT_FILTERS.kind) params.set(PARAM_KEYS.kind, filters.kind);
  if (filters.visa) params.set(PARAM_KEYS.visa, filters.visa);
  for (const key of ARRAY_FACET_KEYS) {
    if (filters[key].length > 0) params.set(PARAM_KEYS[key], filters[key].join(","));
  }
  return params;
}

export function applyFilters(items: SiteIndexEntry[], filters: FilterState): SiteIndexEntry[] {
  const q = filters.q.trim().toLowerCase();
  return items.filter((item) => {
    if (filters.kind !== "all" && item.kind !== filters.kind) return false;
    if (filters.levels.length > 0 && !(item.level && filters.levels.includes(item.level))) return false;
    if (filters.regions.length > 0 && !(item.region && filters.regions.includes(item.region))) return false;
    if (filters.remotes.length > 0 && !(item.remote_type && filters.remotes.includes(item.remote_type))) return false;
    if (filters.countries.length > 0 && !(item.country && filters.countries.includes(item.country))) return false;
    if (filters.companies.length > 0 && !filters.companies.includes(item.company)) return false;
    if (filters.tags.length > 0) {
      const tags = item.tech_tags ?? [];
      if (!filters.tags.some((t) => tags.includes(t))) return false;
    }
    // `=== true` / `=== false` (not truthy) so a silent posting is excluded.
    if (filters.visa === "yes" && item.visa_sponsorship !== true) return false;
    if (q && !`${item.company} ${item.title} ${item.location}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function hasActiveFilters(filters: FilterState): boolean {
  return (
    filters.q !== "" ||
    filters.kind !== "all" ||
    filters.visa !== "" ||
    ARRAY_FACET_KEYS.some((k) => filters[k].length > 0)
  );
}

/** Toggle one value in a string[] facet — the primitive the MultiSelect and
 *  the hero quick-chips both use. */
export function toggleFacetValue(filters: FilterState, key: ArrayFacetKey, value: string): FilterState {
  const current = filters[key];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  return { ...filters, [key]: next };
}
