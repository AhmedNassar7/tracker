// Mirrors config/site-index.schema.json — keep in sync by hand, same
// convention the Python side uses for config/*.schema.json vs. the code
// that writes them.

export type SiteIndexKind = "job" | "hackathon" | "event";
export type SiteIndexOrigin = "curated" | "public";

export type Level =
  | "internship"
  | "new_grad"
  | "junior"
  | "entry_level"
  | "mid_level"
  | "unknown"
  | "other";

export type Region = "us" | "canada" | "mena" | "emea" | "remote" | "unknown";

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
  country?: string;
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
}

export interface StatsHistory {
  updated_at: string;
  retention_days: number;
  snapshots: StatsHistorySnapshot[];
}
