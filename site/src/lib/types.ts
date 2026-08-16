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

export type Region = "us" | "canada" | "emea" | "remote" | "unknown";

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
  age: string;
  posted_at: string;
  url: string;
  source: string;
  source_url: string;
  // Job-only fields — absent (not "", not guessed) when not applicable.
  level?: Level;
  region?: Region;
  role_type?: RoleType;
  // Job-only, curated-origin only.
  category?: string;
  remote_type?: RemoteType;
  country?: string;
}

export interface SiteIndex {
  generated_at: string;
  count: number;
  checksum: string;
  items: SiteIndexEntry[];
}
