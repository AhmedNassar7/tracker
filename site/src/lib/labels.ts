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

export { LEVEL_LABELS };

/** "new_grad" -> "New grad". Falls back to a de-underscored, capitalized form
 *  for any value not in the table, so an unmapped level never shows raw. */
export function formatLevel(level: string | undefined | null): string {
  if (!level) return "—";
  if (LEVEL_LABELS[level]) return LEVEL_LABELS[level];
  const spaced = level.replace(/_/g, " ").trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : "—";
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
