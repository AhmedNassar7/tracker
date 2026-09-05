// Company → logo, the safe way.
//
// Guessing "<company>.com" and pulling a logo/favicon from it is exactly the
// mistake CompanyAvatar.tsx already calls out: a wrong domain silently renders
// a *different* company's real mark. So a logo is only ever shown for a company
// whose domain is hand-verified in the map below. Everything else falls back to
// the generated initials avatar — never a guess.
//
// The image itself comes from Google's favicon service: keyless, free, stable,
// and it serves the domain's *own* favicon, so for a verified domain it can't
// be the wrong company. It's a small icon, not a full wordmark — that's the
// deliberate trade for "provably correct + zero API keys" (the project takes no
// paid/keyed APIs). Swapping in logo.dev/Brandfetch later is a one-line change
// here if a token is ever added.

const FAVICON_ENDPOINT = "https://www.google.com/s2/favicons";

// Verified 2026-09-05. Keys are lower-cased company display names (post
// prettifyCompany). Add a row only after confirming the domain is the
// company's real primary site.
const COMPANY_DOMAINS: Record<string, string> = {
  google: "google.com",
  meta: "meta.com",
  apple: "apple.com",
  amazon: "amazon.com",
  netflix: "netflix.com",
  microsoft: "microsoft.com",
  linkedin: "linkedin.com",
  github: "github.com",
  nvidia: "nvidia.com",
  amd: "amd.com",
  intel: "intel.com",
  qualcomm: "qualcomm.com",
  ibm: "ibm.com",
  oracle: "oracle.com",
  salesforce: "salesforce.com",
  adobe: "adobe.com",
  cisco: "cisco.com",
  sap: "sap.com",
  samsung: "samsung.com",
  sony: "sony.com",
  siemens: "siemens.com",
  cloudflare: "cloudflare.com",
  datadog: "datadoghq.com",
  snowflake: "snowflake.com",
  databricks: "databricks.com",
  mongodb: "mongodb.com",
  elastic: "elastic.co",
  hashicorp: "hashicorp.com",
  twilio: "twilio.com",
  stripe: "stripe.com",
  okta: "okta.com",
  spotify: "spotify.com",
  shopify: "shopify.com",
  figma: "figma.com",
  notion: "notion.so",
  atlassian: "atlassian.com",
  zoom: "zoom.us",
  dropbox: "dropbox.com",
  asana: "asana.com",
  hubspot: "hubspot.com",
  palantir: "palantir.com",
  openai: "openai.com",
  anthropic: "anthropic.com",
  cohere: "cohere.com",
  "scale ai": "scale.com",
  "hugging face": "huggingface.co",
  coinbase: "coinbase.com",
  robinhood: "robinhood.com",
  block: "block.xyz",
  paypal: "paypal.com",
  visa: "visa.com",
  mastercard: "mastercard.com",
  "jane street": "janestreet.com",
  citadel: "citadel.com",
  "hudson river trading": "hudsonrivertrading.com",
  "two sigma": "twosigma.com",
  uber: "uber.com",
  lyft: "lyft.com",
  airbnb: "airbnb.com",
  doordash: "doordash.com",
  instacart: "instacart.com",
  pinterest: "pinterest.com",
  reddit: "reddit.com",
  discord: "discord.com",
  roblox: "roblox.com",
  "epic games": "epicgames.com",
  duolingo: "duolingo.com",
  bytedance: "bytedance.com",
  tiktok: "tiktok.com",
  bloomberg: "bloomberg.com",
  "goldman sachs": "goldmansachs.com",
  "jpmorgan chase": "jpmorganchase.com",
  "capital one": "capitalone.com",
  tesla: "tesla.com",
  spacex: "spacex.com",
  waymo: "waymo.com",
  rivian: "rivian.com",
  "scale.com": "scale.com",
  ramp: "ramp.com",
  plaid: "plaid.com",
  brex: "brex.com",
  mercury: "mercury.com",
  vercel: "vercel.com",
  linear: "linear.app",
  deel: "deel.com",
  airtable: "airtable.com",
  webflow: "webflow.com",
  n26: "n26.com",
  revolut: "revolut.com",
  wise: "wise.com",
  klarna: "klarna.com",
  careem: "careem.com",
  "grab": "grab.com",
  coupang: "coupang.com",
  paytm: "paytm.com",
  phonepe: "phonepe.com",
  jumia: "jumia.com",
  thndr: "thndr.app",
  nubank: "nubank.com.br",
  dlocal: "dlocal.com",
};

/** Google-favicon URL for a company whose domain is hand-verified, else null.
 *  `size` is the requested icon size in px (Google serves 16/32/64/128). */
export function logoUrl(company: string, size = 64): string | null {
  const domain = COMPANY_DOMAINS[company.trim().toLowerCase()];
  if (!domain) return null;
  return `${FAVICON_ENDPOINT}?domain=${encodeURIComponent(domain)}&sz=${size}`;
}
