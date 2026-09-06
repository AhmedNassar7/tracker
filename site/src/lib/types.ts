// Mirrors config/site-index.schema.json — keep in sync by hand, same
// convention the Python side uses for config/*.schema.json vs. the code
// that writes them.

export type SiteIndexKind = "job" | "hackathon" | "event" | "board";
export type SiteIndexOrigin = "curated" | "public" | "config";

export type Level =
  | "internship"
  | "new_grad"
  | "junior"
  | "entry_level"
  | "mid_level"
  | "unknown"
  | "other";

export type Region =
  | "north_america"
  | "latam"
  | "europe"
  | "mena"
  | "apac"
  | "remote"
  | "unknown";

export type RoleType =
  | "full_stack"
  | "backend"
  | "frontend"
  | "mobile"
  | "platform"
  | "infrastructure"
  | "security"
  | "machine_learning"
  | "software_engineer"
  | "other_swe";

export type RemoteType = "remote" | "hybrid" | "onsite" | "unknown";

export interface SiteIndexEntry {
  id: string;
  kind: SiteIndexKind;
  origin: SiteIndexOrigin;
  company: string;
  title: string;
  location: string;
  // Present only for a multi-location posting (>=2 entries); `location` is
  // then a short "First, Place +N more" summary of this list.
  locations?: string[];
  age: string;
  posted_at: string;
  url: string;
  source: string;
  source_url: string;
  // A1 — verified-open signal. "verified" ⇒ the pipeline's liveness check
  // confirmed this apply URL reachable (see `last_checked`); "unverified" ⇒
  // not in the link cache (never checked, checked inconclusively, or aged
  // out). Never a claim the link is dead — dead links are removed upstream.
  liveness?: "verified" | "unverified";
  // ISO-8601 UTC of that last confirmation; present only when verified.
  last_checked?: string;
  // Job-only fields — absent (not "", not guessed) when not applicable.
  level?: Level;
  region?: Region;
  role_type?: RoleType;
  // Job-only, curated-origin only.
  category?: string;
  remote_type?: RemoteType;
  // Job-only, both origins (curated detects it; public rows get it from the
  // same detector run over `location` in build_site_index). "Unknown" /
  // "Remote" are real values here, not omissions.
  country?: string;
  // Flag emoji for `country`; absent for Unknown / Remote / unmapped.
  country_flag?: string;
  // Job-only B3/B4/B5 facets, detected from the posting's own description
  // text (scripts/patterns.py). Absent — never a default `false` or `[]` —
  // when the posting didn't say. Only the ATS sources that expose a full
  // description populate these (Greenhouse / Lever / Ashby / Remotive /
  // ArbeitNow); every other layer omits them.
  tech_tags?: string[];
  visa_sponsorship?: boolean;
  degree_required?: boolean;
  relocation?: boolean;
  salary?: SalaryRange;
}

export interface SalaryRange {
  min: number;
  max: number;
  currency: string;
  period: "hour" | "month" | "year";
}

export interface SiteIndex {
  generated_at: string;
  count: number;
  checksum: string;
  items: SiteIndexEntry[];
}

// Mirrors config/stats-history.schema.json.
export type CountMap = Record<string, number>;

// D2 — per-run breakdowns of the published job set. Present on snapshots
// written on/after 2026-09-06; absent on older ones (hence optional on the
// snapshot). by_level/by_region/by_remote_type/by_role_type/by_category are
// exhaustive; by_country/by_source/top_companies are top-N only.
export interface SnapshotDimensions {
  by_level?: CountMap;
  by_region?: CountMap;
  by_remote_type?: CountMap;
  by_role_type?: CountMap;
  by_category?: CountMap;
  by_country?: CountMap;
  by_source?: CountMap;
  top_companies?: CountMap;
}

export interface StatsHistorySnapshot {
  at: string;
  curated_roles: number;
  public_opportunities: number;
  jobs_total: number;
  hackathons_total: number;
  events_total: number;
  total_items: number;
  level_counts: {
    internship: number;
    early_career: number;
    mid_level: number;
  };
  dimensions?: SnapshotDimensions;
}

export interface StatsHistory {
  updated_at: string;
  retention_days: number;
  snapshots: StatsHistorySnapshot[];
}

// Mirrors config/story-cards.schema.json. `filter` is a partial FilterState
// (a loose map here so this file needn't import filters.ts, which imports
// this one) the client applies on click; {} = jump to the list. Values are a
// string (kind) or a string[] (the array facets — levels/regions/…).
export interface StoryCard {
  id: string;
  title: string;
  detail: string;
  filter: Record<string, string | string[]>;
}

export interface StoryCards {
  generated_at: string;
  cards: StoryCard[];
}
