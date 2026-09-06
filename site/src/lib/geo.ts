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
  // LATAM
  [/\b(brazil|brasil|s[aã]o paulo|rio de janeiro)\b/i, "Brazil"],
  [/\b(mexico|m[eé]xico|guadalajara|monterrey)\b/i, "Mexico"],
  [/\b(argentina|buenos aires|c[oó]rdoba)\b/i, "Argentina"],
  [/\b(colombia|bogot[aá]|medell[ií]n)\b/i, "Colombia"],
  [/\b(chile|santiago)\b/i, "Chile"],
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
