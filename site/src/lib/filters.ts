import type { Level, Region, RemoteType, SiteIndexEntry, SiteIndexKind } from "./types";

export interface FilterState {
  q: string;
  kind: SiteIndexKind | "all";
  level: string;
  region: string;
  remote: string;
  country: string;
  // B3 — a single tech tag (e.g. "React"); free-form like `country`, its
  // options come from what's actually in the data.
  tag: string;
  // B4 — "yes" means "only postings that explicitly offer visa sponsorship" /
  // "only postings that explicitly say no degree is required". Empty = don't
  // filter on it. There's no "no" option: a posting that's simply silent
  // isn't a match either way, and offering "no" would wrongly imply we can
  // tell the difference between "says no" and "doesn't say".
  visa: string;
  nodegree: string;
}

export const DEFAULT_FILTERS: FilterState = {
  q: "",
  kind: "all",
  level: "",
  region: "",
  remote: "",
  country: "",
  tag: "",
  visa: "",
  nodegree: "",
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
export const REGION_VALUES: readonly Region[] = ["us", "canada", "mena", "emea", "remote", "unknown"];
export const REMOTE_VALUES: readonly RemoteType[] = ["remote", "hybrid", "onsite", "unknown"];
// The only legal non-empty value for the two boolean-ish facet filters.
export const FACET_FLAG_VALUES: readonly string[] = ["yes"];

// URL query param names — short, but distinct from likely-future params
// (e.g. a saved-view id) so shared links stay readable.
const PARAM_KEYS: Record<keyof FilterState, string> = {
  q: "q",
  kind: "kind",
  level: "level",
  region: "region",
  remote: "remote",
  country: "country",
  tag: "tag",
  visa: "visa",
  nodegree: "nodegree",
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
    visa: pickValid(params.get(PARAM_KEYS.visa), FACET_FLAG_VALUES, DEFAULT_FILTERS.visa),
    nodegree: pickValid(params.get(PARAM_KEYS.nodegree), FACET_FLAG_VALUES, DEFAULT_FILTERS.nodegree),
    // tag, like country below, is free-form — FilterBar only offers tags that
    // exist in the loaded data, so a stale ?tag= just matches zero rows.
    tag: params.get(PARAM_KEYS.tag) ?? DEFAULT_FILTERS.tag,
    // country is free-form text (job-entry.schema.json has no fixed enum
    // for it — "Detected country name, or 'Remote'/'Unknown'"), unlike
    // level/region/remote, so there's no fixed set to validate against
    // here. FilterBar only ever offers values that actually exist in the
    // loaded data, so a bad ?country= from a hand-edited URL just matches
    // zero rows rather than needing a fallback — same self-correcting
    // behavior pickValid gives the fixed-enum fields, without a static list.
    country: params.get(PARAM_KEYS.country) ?? DEFAULT_FILTERS.country,
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
    if (filters.country && item.country !== filters.country) return false;
    if (filters.tag && !(item.tech_tags ?? []).includes(filters.tag)) return false;
    // "yes" = require the posting to have said so explicitly. `=== true` /
    // `=== false` (not truthy/falsy) so a silent posting with the key absent
    // is correctly excluded rather than accidentally matched.
    if (filters.visa === "yes" && item.visa_sponsorship !== true) return false;
    if (filters.nodegree === "yes" && item.degree_required !== false) return false;
    // Company + title + location — widened from company/title only, since
    // someone searching "Cairo" or "Dubai" is asking a real, answerable
    // question this data already has, not one that needs a new source.
    if (q && !`${item.company} ${item.title} ${item.location}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function hasActiveFilters(filters: FilterState): boolean {
  return (
    filters.q !== "" ||
    filters.kind !== "all" ||
    filters.level !== "" ||
    filters.region !== "" ||
    filters.remote !== "" ||
    filters.country !== "" ||
    filters.tag !== "" ||
    filters.visa !== "" ||
    filters.nodegree !== ""
  );
}
