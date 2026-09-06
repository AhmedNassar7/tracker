// Display formatting for enum-ish field values that are stored in
// `snake_case` (levels) or arrive as a machine token (some company names).
// The raw values stay the source of truth — `LEVEL_VALUES` in filters.ts,
// the stored `site-index.json` — and only what the user reads goes through
// here, so FilterBar / GlobalDashboard / OpportunityTable can't drift apart
// on wording.

const LEVEL_LABELS: Record<string, string> = {
  internship: "Internship",
  new_grad: "New grad",
  junior: "Junior",
  entry_level: "Entry level",
  mid_level: "Mid level",
  other: "Other",
  unknown: "Unknown",
};

// Continental macro-region tier (scripts/patterns.py detect_region). `mena`
// (Middle East & Africa, incl. sub-Saharan) is matched before `europe`. The
// US and Canada are `north_america`, not their own buckets — per-country
// granularity is the separate Country filter. `unknown` ("Other") is a valid
// stored value but isn't offered as a filter option. The three legacy keys
// (us/canada/emea) are kept only so historical stats-history.json snapshots
// still render a label.
const REGION_LABELS: Record<string, string> = {
  remote: "Remote",
  north_america: "North America",
  latam: "Latin America",
  europe: "Europe",
  mena: "Middle East & Africa",
  apac: "Asia-Pacific",
  unknown: "Other",
  us: "United States",
  canada: "Canada",
  emea: "Europe",
};

const REMOTE_LABELS: Record<string, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "Onsite",
  unknown: "Unknown",
};

// Engineering discipline (scripts/patterns.py detect_role_type). `other_swe`
// is the catch-all for a software role whose sub-discipline isn't in the title.
const ROLE_LABELS: Record<string, string> = {
  software_engineer: "Software Engineer",
  full_stack: "Full-stack",
  backend: "Backend",
  frontend: "Frontend",
  mobile: "Mobile",
  platform: "Platform",
  infrastructure: "Infrastructure / DevOps",
  machine_learning: "ML / Data",
  security: "Security",
  other_swe: "Other software",
};

export { LEVEL_LABELS, REGION_LABELS, REMOTE_LABELS, ROLE_LABELS };

/** "new_grad" -> "New grad". Falls back to a de-underscored, capitalized form
 *  for any value not in the table, so an unmapped level never shows raw. */
export function formatLevel(level: string | undefined | null): string {
  if (!level) return "—";
  if (LEVEL_LABELS[level]) return LEVEL_LABELS[level];
  const spaced = level.replace(/_/g, " ").trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : "—";
}

/** "34 min ago" / "5h ago" / "3d ago" from an ISO timestamp — a compact,
 *  always-past relative time for freshness/liveness labels. Returns "" for an
 *  unparseable value so callers can just skip rendering. Mirrors the wording
 *  of SnapshotHero's own updatedAgo helper. */
export function formatRelativeTime(iso: string | undefined | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// Country → ISO2 and flags live in ./geo (with client-side country
// detection); flag *emoji* is avoided in the UI because Windows renders it as
// bare letters — see components/Flag.tsx.

/** "5d" / "3mo" / "2yrs" from a raw age like "5d" / "101d" — same magnitude
 *  buckets as scripts/build_data_readme.py's format_age(), so the site and the
 *  README show a listing's age the same way. Unparseable ⇒ returned as-is. */
export function formatAge(age: string | undefined | null): string {
  const a = (age || "").trim().toLowerCase();
  let days: number;
  if (/^\d+d$/.test(a)) days = parseInt(a, 10);
  else if (/^\d+mo$/.test(a)) days = parseInt(a, 10) * 30;
  else return a || "—";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}yrs`;
}

const SALARY_SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", INR: "₹" };
const SALARY_PERIOD_SUFFIX: Record<string, string> = { year: "/yr", month: "/mo", hour: "/hr" };

/** "$120k–$150k/yr" from a site-index SalaryRange. Mirrors
 *  format_salary_short() in scripts/build_data_readme.py so the site and the
 *  generated README render a disclosed range the same way. */
export function formatSalaryShort(salary: {
  min: number;
  max: number;
  currency: string;
  period: string;
} | undefined | null): string {
  if (!salary || typeof salary.min !== "number" || typeof salary.max !== "number") return "";
  const sym = SALARY_SYMBOLS[salary.currency] ?? `${salary.currency} `;
  const suffix = SALARY_PERIOD_SUFFIX[salary.period] ?? "";
  const amount = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  return `${sym}${amount(salary.min)}–${sym}${amount(salary.max)}${suffix}`;
}

// The pipeline (scripts/company_names.py) already normalizes company names
// into site-index.json; this is a thin client-side safety net for anything
// that slips through (a brand-new board slug, a manually tracked entry).
const COMPANY_CANONICAL: Record<string, string> = {
  openai: "OpenAI",
  mongodb: "MongoDB",
  clickhouse: "ClickHouse",
  scaleai: "Scale AI",
  "scale ai": "Scale AI",
  janestreet: "Jane Street",
  epicgames: "Epic Games",
  spacex: "SpaceX",
  bytedance: "ByteDance",
  tiktok: "TikTok",
  github: "GitHub",
  gitlab: "GitLab",
  paypal: "PayPal",
  linkedin: "LinkedIn",
  deepmind: "DeepMind",
  hashicorp: "HashiCorp",
  phonepe: "PhonePe",
  hubspot: "HubSpot",
  n26: "N26",
  dlocal: "dLocal",
  nvidia: "NVIDIA",
  ibm: "IBM",
  amd: "AMD",
  sap: "SAP",
  aws: "AWS",
};

function titleCaseToken(token: string): string {
  const low = token.toLowerCase();
  if (low === "ai" || low === "ml") return low.toUpperCase();
  if (/\d/.test(token)) return token;
  if (token === token.toUpperCase() && token.length <= 4) return token;
  if (/[a-z][A-Z]/.test(token)) return token;
  if (token.includes("-")) return token.split("-").map(titleCaseToken).join("-");
  return token ? token[0].toUpperCase() + token.slice(1).toLowerCase() : token;
}

export function prettifyCompany(name: string | undefined | null): string {
  if (!name || !name.trim()) return name ?? "";
  const collapsed = name.replace(/\s+/g, " ").trim();
  const withoutParen = collapsed.replace(/\s*\([^)]*\)\s*$/, "").trim() || collapsed;
  const key = withoutParen.toLowerCase().replace(/[._/]+/g, " ").replace(/\s+/g, " ").trim();
  if (COMPANY_CANONICAL[key]) return COMPANY_CANONICAL[key];
  return withoutParen.split(" ").map(titleCaseToken).join(" ");
}
