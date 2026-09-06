// Country resolution for the UI. Two jobs:
//  1. countryForItem() — the item's own `country` if the pipeline set one,
//     otherwise detected from its location string right here in the browser.
//     This means Gulf / North-Africa / APAC countries show up in the filter
//     and get a flag immediately, without waiting for the pipeline to
//     re-run detect_country over the public layer.
//  2. countryIso2() — name → ISO-3166-1 alpha-2, for <Flag> (flagcdn images,
//     because Windows browsers render flag *emoji* as bare letters).
//
// The patterns are a compact port of scripts/patterns.py's
// FETCH_COUNTRY_MARK_MAP — MENA-heavy on purpose (project focus), plus the
// common ones. First match wins, same as the Python.

export const COUNTRY_ISO2: Record<string, string> = {
  "United States": "US", Canada: "CA", "United Kingdom": "GB", Ireland: "IE",
  Germany: "DE", France: "FR", Netherlands: "NL", Belgium: "BE",
  Sweden: "SE", Norway: "NO", Denmark: "DK", Finland: "FI",
  Italy: "IT", Spain: "ES", Portugal: "PT", Switzerland: "CH",
  Austria: "AT", Poland: "PL", Czechia: "CZ", Romania: "RO",
  Greece: "GR", Hungary: "HU", Ukraine: "UA",
  "United Arab Emirates": "AE", "Saudi Arabia": "SA", Qatar: "QA",
  Kuwait: "KW", Bahrain: "BH", Oman: "OM", Jordan: "JO",
  Lebanon: "LB", Palestine: "PS", Iraq: "IQ", Israel: "IL",
  Egypt: "EG", Morocco: "MA", Algeria: "DZ", Tunisia: "TN", Turkey: "TR",
  Nigeria: "NG", Kenya: "KE", Ghana: "GH", "South Africa": "ZA",
  India: "IN", Pakistan: "PK", Bangladesh: "BD", Singapore: "SG",
  Japan: "JP", "South Korea": "KR", China: "CN", "Hong Kong": "HK",
  Taiwan: "TW", Indonesia: "ID", Philippines: "PH", Vietnam: "VN",
  Thailand: "TH", Malaysia: "MY", Australia: "AU", "New Zealand": "NZ",
  Brazil: "BR", Mexico: "MX", Argentina: "AR", Colombia: "CO", Chile: "CL",
  Peru: "PE", Uruguay: "UY", "Costa Rica": "CR", Ecuador: "EC", Panama: "PA",
  "Dominican Republic": "DO",
  Luxembourg: "LU", Estonia: "EE", Lithuania: "LT", Latvia: "LV", Bulgaria: "BG",
  Croatia: "HR", Serbia: "RS", Slovakia: "SK", Slovenia: "SI", Cyprus: "CY",
  Malta: "MT", Iceland: "IS",
  Rwanda: "RW", Uganda: "UG", Tanzania: "TZ", Ethiopia: "ET", Senegal: "SN",
  "Côte d'Ivoire": "CI", Libya: "LY", "Sri Lanka": "LK",
};

const COUNTRY_PATTERNS: [RegExp, string][] = [
  [/\b(canada|toronto|vancouver|montreal|ottawa|calgary|ontario|\bBC\b)\b/i, "Canada"],
  [/\b(united states|\bUSA\b|\bUS\b|new york|nyc|california|texas|washington|seattle|austin|boston|san francisco|\bSF\b|los angeles|chicago|denver|atlanta|miami|san jose|bay area|mountain view|palo alto|sunnyvale|bellevue|redmond|hawthorne|brownsville|bastrop|madison|greenwich|jersey city)\b/i, "United States"],
  [/\b(united kingdom|\bUK\b|england|london|cambridge|manchester|reading|edinburgh)\b/i, "United Kingdom"],
  [/\b(ireland|dublin)\b/i, "Ireland"],
  [/\b(germany|berlin|munich|hamburg|frankfurt|cologne|nuremberg)\b/i, "Germany"],
  [/\b(france|paris|lyon|toulouse)\b/i, "France"],
  [/\b(netherlands|amsterdam|rotterdam|utrecht|eindhoven)\b/i, "Netherlands"],
  [/\b(belgium|brussels|antwerp)\b/i, "Belgium"],
  [/\b(sweden|stockholm|gothenburg)\b/i, "Sweden"],
  [/\b(norway|oslo)\b/i, "Norway"],
  [/\b(denmark|copenhagen)\b/i, "Denmark"],
  [/\b(finland|helsinki)\b/i, "Finland"],
  [/\b(switzerland|zurich|geneva)\b/i, "Switzerland"],
  [/\b(austria|vienna)\b/i, "Austria"],
  [/\b(poland|warsaw|krakow|wroclaw|mazowieckie|gdansk)\b/i, "Poland"],
  [/\b(czechia|czech republic|prague|brno)\b/i, "Czechia"],
  [/\b(romania|bucharest|cluj)\b/i, "Romania"],
  [/\b(greece|athens)\b/i, "Greece"],
  [/\b(hungary|budapest)\b/i, "Hungary"],
  [/\b(ukraine|kyiv|kiev|lviv)\b/i, "Ukraine"],
  [/\b(italy|milan|rome|turin)\b/i, "Italy"],
  [/\b(spain|madrid|barcelona|valencia)\b/i, "Spain"],
  [/\b(portugal|lisbon|porto|braga)\b/i, "Portugal"],
  // MENA — Gulf, Levant, North Africa
  [/\b(united arab emirates|\bU\.?A\.?E\.?\b|dubai|abu dhabi|sharjah|ajman|difc)\b/i, "United Arab Emirates"],
  [/\b(saudi arabia|saudi|\bKSA\b|riyadh|jeddah|jiddah|dammam|khobar|dhahran|neom|mecca|makkah|medina|madinah)\b/i, "Saudi Arabia"],
  [/\b(qatar|doha)\b/i, "Qatar"],
  [/\bkuwait\b/i, "Kuwait"],
  [/\b(bahrain|manama)\b/i, "Bahrain"],
  [/\b(oman|muscat)\b/i, "Oman"],
  [/\b(jordan|amman)\b/i, "Jordan"],
  [/\b(lebanon|beirut)\b/i, "Lebanon"],
  [/\b(palestine|ramallah|gaza|nablus|west bank)\b/i, "Palestine"],
  [/\b(iraq|baghdad|erbil|basra)\b/i, "Iraq"],
  [/\b(israel|tel aviv|jerusalem|herzliya|haifa|yokneam)\b/i, "Israel"],
  [/\b(egypt|cairo|new cairo|alexandria|giza|maadi|smart village|sheikh zayed|6th of october)\b/i, "Egypt"],
  [/\b(morocco|casablanca|rabat|marrakech|marrakesh|tangier)\b/i, "Morocco"],
  [/\b(algeria|algiers|oran)\b/i, "Algeria"],
  [/\b(tunisia|tunis)\b/i, "Tunisia"],
  [/\b(turkey|t[üu]rkiye|istanbul|ankara|izmir)\b/i, "Turkey"],
  // Africa (sub-Saharan tech hubs)
  [/\b(nigeria|lagos|abuja)\b/i, "Nigeria"],
  [/\b(kenya|nairobi|mombasa)\b/i, "Kenya"],
  [/\b(ghana|accra)\b/i, "Ghana"],
  [/\b(south africa|johannesburg|cape town|pretoria|durban)\b/i, "South Africa"],
  // APAC
  [/\b(india|bengaluru|bangalore|hyderabad|mumbai|pune|gurgaon|gurugram|noida|chennai|new delhi|delhi|karnataka)\b/i, "India"],
  [/\b(pakistan|karachi|lahore|islamabad)\b/i, "Pakistan"],
  [/\b(bangladesh|dhaka)\b/i, "Bangladesh"],
  [/\bsingapore\b/i, "Singapore"],
  [/\b(japan|tokyo|osaka|kyoto)\b/i, "Japan"],
  [/\b(south korea|seoul)\b/i, "South Korea"],
  [/\b(china|\bCHN\b|beijing|shanghai|shenzhen|guangzhou|hangzhou)\b/i, "China"],
  [/\bhong kong\b/i, "Hong Kong"],
  [/\b(taiwan|taipei)\b/i, "Taiwan"],
  [/\b(indonesia|jakarta)\b/i, "Indonesia"],
  [/\b(philippines|manila|cebu)\b/i, "Philippines"],
  [/\b(vietnam|hanoi|ho chi minh)\b/i, "Vietnam"],
  [/\b(thailand|bangkok)\b/i, "Thailand"],
  [/\b(malaysia|kuala lumpur)\b/i, "Malaysia"],
  [/\b(australia|sydney|melbourne|brisbane|perth|canberra)\b/i, "Australia"],
  [/\b(new zealand|auckland|wellington)\b/i, "New Zealand"],
  [/\b(sri lanka|colombo)\b/i, "Sri Lanka"],
  // LATAM
  [/\b(brazil|brasil|s[aã]o paulo|rio de janeiro)\b/i, "Brazil"],
  [/\b(mexico|m[eé]xico|guadalajara|monterrey)\b/i, "Mexico"],
  [/\b(argentina|buenos aires|c[oó]rdoba)\b/i, "Argentina"],
  [/\b(colombia|bogot[aá]|medell[ií]n)\b/i, "Colombia"],
  [/\b(chile|santiago)\b/i, "Chile"],
  [/\b(peru|lima)\b/i, "Peru"],
  [/\b(uruguay|montevideo)\b/i, "Uruguay"],
  [/\bcosta rica\b/i, "Costa Rica"],
  [/\b(ecuador|quito|guayaquil)\b/i, "Ecuador"],
  [/\b(panama|panam[aá])\b/i, "Panama"],
  [/\b(dominican republic|santo domingo)\b/i, "Dominican Republic"],
  // Wider Europe
  [/\bluxembourg\b/i, "Luxembourg"],
  [/\b(estonia|tallinn)\b/i, "Estonia"],
  [/\b(lithuania|vilnius|kaunas)\b/i, "Lithuania"],
  [/\b(latvia|riga)\b/i, "Latvia"],
  [/\b(bulgaria|sofia|plovdiv)\b/i, "Bulgaria"],
  [/\b(croatia|zagreb|split)\b/i, "Croatia"],
  [/\b(serbia|belgrade|novi sad)\b/i, "Serbia"],
  [/\b(slovakia|bratislava)\b/i, "Slovakia"],
  [/\b(slovenia|ljubljana)\b/i, "Slovenia"],
  [/\b(cyprus|nicosia|limassol)\b/i, "Cyprus"],
  [/\b(malta|valletta)\b/i, "Malta"],
  [/\b(iceland|reykjav[ií]k)\b/i, "Iceland"],
  // More Africa
  [/\b(rwanda|kigali)\b/i, "Rwanda"],
  [/\b(uganda|kampala)\b/i, "Uganda"],
  [/\b(tanzania|dar es salaam)\b/i, "Tanzania"],
  [/\b(ethiopia|addis ababa)\b/i, "Ethiopia"],
  [/\b(senegal|dakar)\b/i, "Senegal"],
  [/\b(c[oô]te d.?ivoire|ivory coast|abidjan)\b/i, "Côte d'Ivoire"],
  [/\b(libya|tripoli)\b/i, "Libya"],
];

export function detectCountry(location: string | undefined | null): string | null {
  const loc = location || "";
  if (!loc.trim()) return null;
  for (const [rx, name] of COUNTRY_PATTERNS) if (rx.test(loc)) return name;
  return null;
}

export function countryIso2(country: string | undefined | null): string | null {
  return COUNTRY_ISO2[(country || "").trim()] ?? null;
}

/** The country to show for a listing: the pipeline's value if it's a real
 *  one, else detected from the location string. "Unknown"/"Remote" fall
 *  through to detection (a "Remote — Cairo" row still gets Egypt). */
export function countryForItem(item: { country?: string; location?: string }): string | null {
  const c = (item.country || "").trim();
  if (c && c !== "Unknown" && c !== "Remote") return c;
  return detectCountry(item.location);
}

export function flagUrl(iso2: string, size: "20x15" | "40x30" = "20x15"): string {
  return `https://flagcdn.com/${size}/${iso2.toLowerCase()}.png`;
}

// ---- region tier ----------------------------------------------------------
// The coarse macro-region shown in the Region filter and used for relevance
// scoring. Mirrors scripts/patterns.py detect_region, but resolved in the
// browser off countryForItem() so a bucket the deployed data doesn't carry
// yet (apac, latam, north_america) still appears without a pipeline re-run.
//
// Taxonomy: north_america · latam · europe · mena · apac · remote. US and
// Canada are NOT their own buckets — they're north_america, and the Country
// filter already gives per-country granularity. 'unknown' is a valid internal
// value (an unclassifiable location) but is deliberately NOT offered as a
// filter option — nobody filters for "roles in an unknown region".

export const REGION_ORDER = [
  "north_america",
  "latam",
  "europe",
  "mena",
  "apac",
  "remote",
] as const;

// Pre-2026-09-06 stored values (saved preferences, shared URLs) → current.
export const REGION_ALIASES: Record<string, string> = {
  us: "north_america",
  canada: "north_america",
  emea: "europe",
};

const REGION_BY_COUNTRY: Record<string, string> = {
  "United States": "north_america", Canada: "north_america",
  Mexico: "latam", Brazil: "latam", Argentina: "latam", Colombia: "latam", Chile: "latam",
  Peru: "latam", Uruguay: "latam", "Costa Rica": "latam", Ecuador: "latam",
  Panama: "latam", "Dominican Republic": "latam",
  "United Kingdom": "europe", Ireland: "europe", Germany: "europe", France: "europe",
  Netherlands: "europe", Belgium: "europe", Sweden: "europe", Norway: "europe",
  Denmark: "europe", Finland: "europe", Italy: "europe", Spain: "europe",
  Portugal: "europe", Switzerland: "europe", Austria: "europe", Poland: "europe",
  Czechia: "europe", Romania: "europe", Greece: "europe", Hungary: "europe", Ukraine: "europe",
  Luxembourg: "europe", Estonia: "europe", Lithuania: "europe", Latvia: "europe",
  Bulgaria: "europe", Croatia: "europe", Serbia: "europe", Slovakia: "europe",
  Slovenia: "europe", Cyprus: "europe", Malta: "europe", Iceland: "europe",
  "United Arab Emirates": "mena", "Saudi Arabia": "mena", Qatar: "mena", Kuwait: "mena",
  Bahrain: "mena", Oman: "mena", Jordan: "mena", Lebanon: "mena", Palestine: "mena",
  Iraq: "mena", Israel: "mena", Egypt: "mena", Morocco: "mena", Algeria: "mena",
  Tunisia: "mena", Turkey: "mena", Libya: "mena",
  Nigeria: "mena", Kenya: "mena", Ghana: "mena", "South Africa": "mena",
  Rwanda: "mena", Uganda: "mena", Tanzania: "mena", Ethiopia: "mena",
  Senegal: "mena", "Côte d'Ivoire": "mena",
  India: "apac", Pakistan: "apac", Bangladesh: "apac", "Sri Lanka": "apac",
  Singapore: "apac", Japan: "apac",
  "South Korea": "apac", China: "apac", "Hong Kong": "apac", Taiwan: "apac",
  Indonesia: "apac", Philippines: "apac", Vietnam: "apac", Thailand: "apac",
  Malaysia: "apac", Australia: "apac", "New Zealand": "apac",
};

const REGION_TEXT_PATTERNS: [RegExp, string][] = [
  [/\b(north america|\bUSA?\b|canada|united states)\b/i, "north_america"],
  [/\b(latam|latin america|south america|central america|caribbean)\b/i, "latam"],
  [/\b(mena|menat|middle east|gulf|\bGCC\b|north africa|maghreb|levant|sub.?saharan|\bafrica\b)\b/i, "mena"],
  [/\b(emea|europe|european union)\b/i, "europe"],
  [/\b(apac|\bAPJ\b|asia.?pacific|\basia\b|oceania|south.?east asia)\b/i, "apac"],
];

const REMOTE_TEXT_RE = /\b(remote|worldwide|anywhere|fully remote|distributed)\b/i;

export function detectRegionFromText(location: string | undefined | null): string | null {
  const loc = (location || "").trim();
  if (!loc) return null;
  for (const [rx, region] of REGION_TEXT_PATTERNS) if (rx.test(loc)) return region;
  return null;
}

/** The macro-region bucket for a listing. Order mirrors patterns.py
 *  detect_region: the pipeline's own value (mapped through REGION_ALIASES for
 *  pre-taxonomy data) → an explicit "remote" location → derived from the
 *  resolved country → named in the location text → "unknown". */
export function regionForItem(item: { region?: string; country?: string; location?: string }): string {
  const raw = (item.region || "").trim();
  if (raw && raw !== "unknown") return REGION_ALIASES[raw] ?? raw;
  if (REMOTE_TEXT_RE.test(item.location || "")) return "remote";
  const country = countryForItem(item);
  if (country && REGION_BY_COUNTRY[country]) return REGION_BY_COUNTRY[country];
  return detectRegionFromText(item.location) ?? "unknown";
}
