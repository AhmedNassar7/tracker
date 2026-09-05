from __future__ import annotations

import re

FETCH_LEVEL_MAP = {
    "internship": re.compile(r"\b(intern|internship|co.?op)\b", re.I),
    "new_grad": re.compile(r"\b(new.?grad|fresh.?grad|recent.?grad|graduate|campus|early.?career)\b", re.I),
    "junior": re.compile(r"\b(junior|jr\.?)\b", re.I),
    "entry_level": re.compile(r"\b(entry.?level|associate|engineer i|sde ?i|sde ?1)\b", re.I),
    "mid_level": re.compile(r"\b(mid.?level|engineer ii|sde2|software engineer 2)\b", re.I),
}

FETCH_ROLE_RE = re.compile(
    r"\b("
    r"software development engineer|software engineer|software developer|sde|full.?stack|frontend|front.?end|backend|back.?end|"
    r"mobile|android|ios|flutter|react native|web developer|python|java|javascript|typescript|"
    r"golang|go developer|c\+\+|c#|dotnet|\.net|node\.?js|devops|platform engineer|site reliability|sre|"
    r"machine learning|ml engineer|data engineer|data scientist|qa engineer|test automation|"
    r"security engineer|cloud engineer|embedded software"
    r")\b",
    re.I,
)

FETCH_REGION_MAP = {
    "us": re.compile(
        r"\b(usa|united states|new york|california|texas|washington|seattle|austin|boston|"
        r"san francisco|los angeles|chicago|denver|atlanta|miami)\b",
        re.I,
    ),
    "canada": re.compile(r"\b(canada|toronto|vancouver|montreal|ottawa|calgary)\b", re.I),
    # MENA + wider Middle East / Africa. Checked BEFORE emea so a Gulf/North
    # Africa location resolves to its own bucket instead of being folded into
    # Europe. Kept deliberately broad (Gulf, Levant, North Africa, plus the
    # main sub-Saharan tech hubs) because the region's employers — Careem,
    # Tamara, Thndr, Jumia, Flutterwave, Paystack — span all of it.
    "mena": re.compile(
        r"\b(mena|menat|gcc|middle east|gulf|"
        r"uae|united arab emirates|dubai|abu dhabi|sharjah|"
        r"saudi|saudi arabia|riyadh|jeddah|dammam|khobar|"
        r"qatar|doha|kuwait|bahrain|manama|oman|muscat|"
        r"jordan|amman|lebanon|beirut|"
        r"israel|tel aviv|jerusalem|herzliya|"
        r"egypt|cairo|alexandria|giza|"
        r"morocco|casablanca|rabat|tunisia|tunis|"
        r"turkey|istanbul|ankara|"
        r"nigeria|lagos|abuja|kenya|nairobi|ghana|accra|"
        r"south africa|johannesburg|cape town|pretoria)\b",
        re.I,
    ),
    "emea": re.compile(
        r"\b(emea|europe|uk|united kingdom|germany|france|netherlands|spain|portugal|"
        r"poland|sweden|ireland|italy|london|"
        r"berlin|paris|amsterdam|zurich)\b",
        re.I,
    ),
}

FETCH_REMOTE_RE = re.compile(r"\b(remote|worldwide|global|fully remote|anywhere)\b", re.I)
FETCH_HYBRID_RE = re.compile(r"\bhybrid\b", re.I)

FETCH_COUNTRY_MARK_MAP = [
    (re.compile(r"\b(canada|toronto|vancouver|montreal|ottawa|calgary|surrey|brampton|ontario|bc)\b", re.I), "Canada"),
    (re.compile(r"\b(united states|usa|\bUS\b|new york|california|texas|washington|seattle|austin|boston|san francisco|los angeles|chicago|denver|atlanta|miami|nyc|fulton|el segundo|san jose|waltham|lehi|sunnyvale)\b", re.I), "United States"),
    (re.compile(r"\b(united kingdom|uk|england|london|reading)\b", re.I), "United Kingdom"),
    (re.compile(r"\b(germany|berlin|munich|nuremberg|pforzheim|frankfurt|hamburg)\b", re.I), "Germany"),
    (re.compile(r"\b(france|paris)\b", re.I), "France"),
    (re.compile(r"\b(netherlands|amsterdam)\b", re.I), "Netherlands"),
    (re.compile(r"\b(sweden|stockholm)\b", re.I), "Sweden"),
    (re.compile(r"\b(ireland|dublin)\b", re.I), "Ireland"),
    (re.compile(r"\b(italy|milan|rome)\b", re.I), "Italy"),
    (re.compile(r"\b(spain|madrid|barcelona)\b", re.I), "Spain"),
    (re.compile(r"\b(portugal|lisbon|porto)\b", re.I), "Portugal"),
    (re.compile(r"\b(switzerland|zurich|geneva)\b", re.I), "Switzerland"),
    (re.compile(r"\b(poland|warsaw|krakow)\b", re.I), "Poland"),
    (re.compile(r"\b(united arab emirates|uae|dubai|abu dhabi|sharjah)\b", re.I), "United Arab Emirates"),
    (re.compile(r"\b(saudi|saudi arabia|riyadh|jeddah|dammam|khobar)\b", re.I), "Saudi Arabia"),
    (re.compile(r"\b(qatar|doha)\b", re.I), "Qatar"),
    (re.compile(r"\b(kuwait)\b", re.I), "Kuwait"),
    (re.compile(r"\b(bahrain|manama)\b", re.I), "Bahrain"),
    (re.compile(r"\b(oman|muscat)\b", re.I), "Oman"),
    (re.compile(r"\b(jordan|amman)\b", re.I), "Jordan"),
    (re.compile(r"\b(lebanon|beirut)\b", re.I), "Lebanon"),
    (re.compile(r"\b(israel|tel aviv|jerusalem|herzliya)\b", re.I), "Israel"),
    (re.compile(r"\b(egypt|cairo|alexandria|giza)\b", re.I), "Egypt"),
    (re.compile(r"\b(morocco|casablanca|rabat)\b", re.I), "Morocco"),
    (re.compile(r"\b(turkey|istanbul|ankara)\b", re.I), "Turkey"),
    (re.compile(r"\b(nigeria|lagos|abuja)\b", re.I), "Nigeria"),
    (re.compile(r"\b(kenya|nairobi)\b", re.I), "Kenya"),
    (re.compile(r"\b(south africa|johannesburg|cape town|pretoria)\b", re.I), "South Africa"),
]

PUBLIC_LEVEL_PATTERNS = {
    "internship": re.compile(r"\b(intern|internship|co.?op)\b", re.I),
    "new_grad": re.compile(r"\b(new.?grad|fresh.?grad|recent.?grad|graduate|campus|early.?career)\b", re.I),
    "junior": re.compile(r"\b(junior|jr\.?)\b", re.I),
    "entry_level": re.compile(r"\b(entry.?level|associate|engineer i|sde ?i|sde ?1)\b", re.I),
    "mid_level": re.compile(r"\b(mid.?level|engineer ii|sde2|software engineer 2)\b", re.I),
}

PUBLIC_ROLE_PATTERNS = {
    "full_stack": re.compile(r"\bfull.?stack\b", re.I),
    "backend": re.compile(r"\bback.?end\b", re.I),
    "frontend": re.compile(r"\bfront.?end\b", re.I),
    "mobile": re.compile(r"\bmobile|android|ios|react native|flutter\b", re.I),
    "platform": re.compile(r"\bplatform engineer|platform\b", re.I),
    "infrastructure": re.compile(r"\binfrastructure|infra|site reliability|sre|devops\b", re.I),
    "security": re.compile(r"\bsecurity\b", re.I),
    "machine_learning": re.compile(r"\bmachine learning|ml engineer|data engineer|data scientist\b", re.I),
    "software_engineer": re.compile(r"\bsoftware engineer|software developer|sde\b", re.I),
}

PUBLIC_SOFTWARE_ROLE_TYPES = {
    "software_engineer",
    "full_stack",
    "backend",
    "frontend",
    "mobile",
    "platform",
    "infrastructure",
}

PUBLIC_NON_SOFTWARE_TITLE_PATTERNS = [
    re.compile(r"\bsecurity\b", re.I),
    re.compile(r"\bmachine learning\b|\bml engineer\b|\bdata scientist\b|\bdata engineer\b", re.I),
    re.compile(r"\bsolutions? engineer\b", re.I),
    re.compile(r"\bpresales?\b|\bsales\b", re.I),
    re.compile(r"\bproduct manager\b|\bprogram manager\b", re.I),
    re.compile(r"\banalyst\b|\bconsultant\b", re.I),
    re.compile(r"\bsupport\b|\bcustomer success\b|\btechnical support\b", re.I),
    re.compile(r"\bcompliance\b|\boperations\b", re.I),
]


def detect_region(location):
    """Coarse region bucket ('us'/'canada'/'mena'/'emea'/'remote'/'unknown')
    from a free-text location string. Shared by both the curated and public
    layers so 'region' means the same thing everywhere it's published. 'mena'
    (Middle East & Africa) is matched before 'emea' so Gulf/North-Africa
    locations get their own bucket instead of being counted as Europe.
    """
    if FETCH_REMOTE_RE.search(location):
        return "remote"
    for region, rx in FETCH_REGION_MAP.items():
        if rx.search(location):
            return region
    return "unknown"


def detect_role_type(title):
    """Engineering discipline detected from a job title. Shared by both
    layers — previously duplicated as a near-identical function inside
    public_sources.py.
    """
    if PUBLIC_ROLE_PATTERNS["full_stack"].search(title):
        return "full_stack"
    if PUBLIC_ROLE_PATTERNS["backend"].search(title):
        return "backend"
    if PUBLIC_ROLE_PATTERNS["frontend"].search(title):
        return "frontend"
    if PUBLIC_ROLE_PATTERNS["mobile"].search(title):
        return "mobile"
    if PUBLIC_ROLE_PATTERNS["platform"].search(title):
        return "platform"
    if PUBLIC_ROLE_PATTERNS["infrastructure"].search(title):
        return "infrastructure"
    if PUBLIC_ROLE_PATTERNS["security"].search(title):
        return "security"
    if PUBLIC_ROLE_PATTERNS["machine_learning"].search(title):
        return "machine_learning"
    if PUBLIC_ROLE_PATTERNS["software_engineer"].search(title):
        return "software_engineer"
    return "other_swe"
