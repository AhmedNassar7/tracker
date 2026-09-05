// Company prominence tiers — mirrors the section order of
// config/companies_allowlist.yml (and CATEGORY_RANK in scripts/fetch.py).
// Drives the default "Top companies" sort so the best-known names lead the
// list regardless of which collector layer a role came from. A company not
// listed here sorts after every tiered one (tier 99).

const TIERS: string[][] = [
  // 0 — FAANG + Microsoft group
  ["google", "youtube", "waymo", "meta", "facebook", "instagram", "apple", "amazon", "aws", "netflix", "microsoft", "linkedin", "github"],
  // 1 — big tech
  ["nvidia", "amd", "intel", "qualcomm", "arm", "ibm", "oracle", "salesforce", "adobe", "cisco", "sap", "samsung", "sony", "siemens"],
  // 2 — cloud/infra + AI research (the hot names)
  ["cloudflare", "datadog", "splunk", "snowflake", "databricks", "mongodb", "elastic", "hashicorp", "twilio", "stripe", "okta",
   "openai", "anthropic", "deepmind", "cohere", "mistral", "scale ai", "scale", "hugging face"],
  // 3 — product SaaS + fintech + ride/delivery
  ["spotify", "shopify", "figma", "notion", "atlassian", "slack", "zoom", "dropbox", "asana", "hubspot", "palantir",
   "paypal", "revolut", "n26", "wise", "klarna", "visa", "mastercard",
   "uber", "lyft", "doordash", "airbnb", "booking", "expedia"],
  // 4 — finance + APAC/LATAM/MENA majors
  ["goldman sachs", "morgan stanley", "jpmorgan", "bloomberg", "mckinsey", "two sigma", "jane street", "citadel", "hudson river trading",
   "grab", "sea", "tokopedia", "rakuten", "line", "naver", "coupang", "tencent", "alibaba", "bytedance", "tiktok", "baidu", "xiaomi",
   "tsmc", "mediatek", "canva", "flipkart", "swiggy", "zomato", "phonepe", "razorpay", "freshworks", "zoho", "paytm",
   "mercadolibre", "nubank", "rappi", "ifood", "globant", "dlocal",
   "careem", "talabat", "noon", "jumia", "flutterwave", "paystack", "interswitch", "fawry", "thndr", "tamara", "tabby", "swvl"],
  // 5 — more global tech
  ["tesla", "spacex", "palo alto networks", "crowdstrike", "servicenow", "workday", "block", "coinbase", "robinhood",
   "instacart", "pinterest", "reddit", "snap", "roblox", "unity", "epic games", "discord", "duolingo",
   "vercel", "airtable", "webflow", "loom", "substack", "attio", "mercury", "plaid", "clickhouse", "ramp", "brex", "deel", "linear"],
];

// Flatten to name → tier once at module load.
const TIER_BY_NAME = new Map<string, number>();
TIERS.forEach((names, tier) => names.forEach((n) => TIER_BY_NAME.set(n, tier)));

const UNRANKED = 99;

export function companyTier(company: string): number {
  const name = (company || "").trim().toLowerCase();
  if (!name) return UNRANKED;
  const exact = TIER_BY_NAME.get(name);
  if (exact !== undefined) return exact;
  // Word-boundary-ish match so "Amazon.com Services LLC" / "Amazon Web
  // Services" still resolve to Amazon's tier. Only keys >= 4 chars, to keep
  // short ones ("arm", "sap", "sea", "n26") to exact matches. Strongest
  // (lowest) matching tier wins.
  let best = UNRANKED;
  for (const [key, tier] of TIER_BY_NAME) {
    if (key.length >= 4 && tier < best && name.includes(key)) best = tier;
  }
  return best;
}
