// Company → logo, the safe way.
//
// Guessing "<company>.com" and pulling a logo/favicon from it is the mistake
// CompanyAvatar.tsx calls out: a wrong domain silently renders a *different*
// company's real mark. So a company logo is only shown for a company whose
// domain is hand-verified in the map below. For hackathons/events, where the
// row's own URL *is* the organiser's site, the favicon of that URL's host is
// used directly (see faviconForUrl) — that can't be the wrong entity.
//
// The image comes from Google's favicon service: keyless, free, stable, and
// it serves the domain's own favicon. It's a small icon, not a wordmark —
// the deliberate trade for "provably correct + zero API keys". Swapping in
// logo.dev/Brandfetch later is a one-line change here.

// Two keyless favicon providers, tried in order — no single one covers every
// domain (e.g. bytedance.com 404s on Google's, joinbytedance.com 404s on
// DuckDuckGo's), so CompanyAvatar falls through the list, then to initials.
function faviconSources(domain: string, size: number): string[] {
  const d = encodeURIComponent(domain);
  return [
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
    `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${d}&size=${size}`,
  ];
}

// Verified 2026-09-05. Keys are lower-cased company display names (post
// prettifyCompany). Covers config/companies_allowlist.yml plus the
// most-common public-layer employers. Add a row only after confirming the
// domain is the company's real primary site.
const COMPANY_DOMAINS: Record<string, string> = {
  // FAANG + Microsoft group
  google: "google.com", meta: "meta.com", apple: "apple.com", amazon: "amazon.com",
  netflix: "netflix.com", microsoft: "microsoft.com", linkedin: "linkedin.com", github: "github.com",
  // Big tech
  nvidia: "nvidia.com", amd: "amd.com", intel: "intel.com", qualcomm: "qualcomm.com",
  arm: "arm.com", ibm: "ibm.com", oracle: "oracle.com", salesforce: "salesforce.com",
  adobe: "adobe.com", cisco: "cisco.com", sap: "sap.com", samsung: "samsung.com",
  sony: "sony.com", siemens: "siemens.com",
  // Cloud / infra
  cloudflare: "cloudflare.com", datadog: "datadoghq.com", splunk: "splunk.com",
  snowflake: "snowflake.com", databricks: "databricks.com", mongodb: "mongodb.com",
  elastic: "elastic.co", hashicorp: "hashicorp.com", twilio: "twilio.com",
  stripe: "stripe.com", okta: "okta.com",
  // Product SaaS
  spotify: "spotify.com", shopify: "shopify.com", figma: "figma.com", notion: "notion.so",
  atlassian: "atlassian.com", slack: "slack.com", zoom: "zoom.us", dropbox: "dropbox.com",
  asana: "asana.com", hubspot: "hubspot.com", palantir: "palantir.com",
  // AI research
  openai: "openai.com", anthropic: "anthropic.com", deepmind: "deepmind.com",
  cohere: "cohere.com", mistral: "mistral.ai", "scale ai": "scale.com", "hugging face": "huggingface.co",
  // Fintech
  paypal: "paypal.com", revolut: "revolut.com", n26: "n26.com", wise: "wise.com",
  klarna: "klarna.com", visa: "visa.com", mastercard: "mastercard.com",
  // Ride / delivery / travel
  uber: "uber.com", lyft: "lyft.com", doordash: "doordash.com", airbnb: "airbnb.com",
  booking: "booking.com", expedia: "expedia.com",
  // Finance
  "goldman sachs": "goldmansachs.com", "morgan stanley": "morganstanley.com",
  jpmorgan: "jpmorganchase.com", "jpmorgan chase": "jpmorganchase.com", bloomberg: "bloomberg.com",
  mckinsey: "mckinsey.com", "two sigma": "twosigma.com", "jane street": "janestreet.com",
  citadel: "citadel.com", "hudson river trading": "hudsonrivertrading.com",
  // APAC
  grab: "grab.com", "sea limited": "sea.com", tokopedia: "tokopedia.com", rakuten: "rakuten.com",
  line: "line.me", naver: "naver.com", coupang: "coupang.com", tencent: "tencent.com",
  alibaba: "alibaba.com", bytedance: "bytedance.com", baidu: "baidu.com", xiaomi: "mi.com",
  tsmc: "tsmc.com", mediatek: "mediatek.com", canva: "canva.com", flipkart: "flipkart.com",
  swiggy: "swiggy.com", zomato: "zomato.com", phonepe: "phonepe.com", razorpay: "razorpay.com",
  freshworks: "freshworks.com", zoho: "zoho.com", paytm: "paytm.com", tiktok: "tiktok.com",
  // LATAM
  mercadolibre: "mercadolibre.com", nubank: "nubank.com.br", rappi: "rappi.com",
  ifood: "ifood.com.br", globant: "globant.com", dlocal: "dlocal.com",
  // MENA / Africa
  careem: "careem.com", talabat: "talabat.com", noon: "noon.com", jumia: "jumia.com",
  flutterwave: "flutterwave.com", paystack: "paystack.com", interswitch: "interswitchgroup.com",
  fawry: "fawry.com", thndr: "thndr.app", tamara: "tamara.co", tabby: "tabby.ai", swvl: "swvl.com",
  // More global tech
  tesla: "tesla.com", spacex: "spacex.com", "palo alto networks": "paloaltonetworks.com",
  crowdstrike: "crowdstrike.com", servicenow: "servicenow.com", workday: "workday.com",
  block: "block.xyz", coinbase: "coinbase.com", robinhood: "robinhood.com",
  instacart: "instacart.com", pinterest: "pinterest.com", reddit: "reddit.com",
  snap: "snap.com", roblox: "roblox.com", unity: "unity.com", "epic games": "epicgames.com",
  discord: "discord.com", duolingo: "duolingo.com", vercel: "vercel.com", airtable: "airtable.com",
  webflow: "webflow.com", loom: "loom.com", substack: "substack.com", attio: "attio.com",
  mercury: "mercury.com", plaid: "plaid.com", clickhouse: "clickhouse.com",
  // Frequent public-layer employers
  ramp: "ramp.com", brex: "brex.com", deel: "deel.com", linear: "linear.app",
  scaleai: "scale.com", "scale.com": "scale.com",
};

/** Ordered favicon URLs for a company whose domain is hand-verified; [] if
 *  the company has no verified domain (caller then shows initials). */
export function logoCandidates(company: string, size = 64): string[] {
  const domain = COMPANY_DOMAINS[company.trim().toLowerCase()];
  return domain ? faviconSources(domain, size) : [];
}

/** Ordered favicon URLs for an arbitrary URL's host — safe for hackathon/
 *  event rows, where the URL is the organiser's own page. Never use for a
 *  job row: a job URL points at an ATS (greenhouse.io, lever.co), not the
 *  employer. */
export function faviconCandidatesForUrl(url: string, size = 64): string[] {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host ? faviconSources(host, size) : [];
  } catch {
    return [];
  }
}
