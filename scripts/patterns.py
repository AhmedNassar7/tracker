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


# ---------------------------------------------------------------------------
# Job-description facet detection — tech stack, work authorisation, salary.
#
# Backlog items B3 / B4 / B5 (docs/WEBSITE-VISION-PLAN.html §11). Every
# detector here is STRICT-POSITIVE: a facet is reported only when the source
# text says so in as many words. Missing a real signal is acceptable;
# asserting one that isn't there breaks the project's no-fabrication rule.
# Callers merge the returned dict into a record and only ever ADD keys that
# are present — a facet the text doesn't mention stays absent, never False-
# by-default (except the two "…_sponsorship: false" / "degree_required:
# false" cases, which are themselves explicit statements in the text).
# ---------------------------------------------------------------------------

# Canonical display tag -> pattern. Ordered so a more specific tech is tested
# before the token it contains ("React Native" before "React"); the first
# lookup that hits wins and the rest of that family is skipped.
TECH_TAG_PATTERNS = [
    ("React Native", re.compile(r"\breact[ -]native\b", re.I)),
    ("React", re.compile(r"\breact(?:\.?js)?\b(?!\s+native)", re.I)),
    ("Next.js", re.compile(r"\bnext\.js\b", re.I)),
    ("Vue.js", re.compile(r"\bvue(?:\.?js)?\b", re.I)),
    ("Angular", re.compile(r"\bangular(?:js)?\b", re.I)),
    ("Svelte", re.compile(r"\bsvelte(?:kit)?\b", re.I)),
    ("Node.js", re.compile(r"\bnode\.?js\b", re.I)),
    ("TypeScript", re.compile(r"\btype[ -]?script\b", re.I)),
    ("JavaScript", re.compile(r"\bjava[ -]?script\b|\bes6\b", re.I)),
    ("Python", re.compile(r"\bpython\b", re.I)),
    ("Django", re.compile(r"\bdjango\b", re.I)),
    ("Flask", re.compile(r"\bflask\b", re.I)),
    ("FastAPI", re.compile(r"\bfast[ ]?api\b", re.I)),
    ("Java", re.compile(r"\bjava\b(?!\s*script)", re.I)),
    ("Spring", re.compile(r"\bspring\s*(?:boot|framework|mvc|cloud)\b", re.I)),
    ("Kotlin", re.compile(r"\bkotlin\b", re.I)),
    ("Swift", re.compile(r"\bswift\s?ui\b|\bswift\b(?=\s*(?:developer|engineer|programming|programmer|language|code\b))", re.I)),
    ("Objective-C", re.compile(r"\bobjective[ -]?c\b", re.I)),
    ("Go", re.compile(
        r"\bgolang\b"
        r"|\b(?:in|with|using|know|knows|learn)\s+go\b"
        r"|\bwritten\s+in\s+go\b"
        r"|\bgo\s*\(\s*golang\s*\)"
        r"|\bgo\s+lang\b"
        r"|\bgo\b(?=\s+(?:developer|engineer|programmer|programming|routines?|micro-?services?|services)\b)"
        r"|[,/]\s*go\s*[,/]"
        # "…, Go." / "TypeScript and Go;" — Go as the tail of a tech list:
        # only when it's immediately closed by list punctuation or end, which
        # rules out prose like "and go home".
        r"|\b(?:and|or|,|/)\s*go\b(?=\s*[.,;)/]|\s*$)",
        re.I,
    )),
    ("Rust", re.compile(r"\brust\b(?!\s*(?:belt|ic|y|ling))", re.I)),
    ("C++", re.compile(r"c\+\+", re.I)),
    ("C#", re.compile(r"\bc#|\bc[ -]sharp\b", re.I)),
    (".NET", re.compile(r"\.net\b|\bdotnet\b|\basp\.net\b", re.I)),
    ("Ruby on Rails", re.compile(r"\bruby[ -]on[ -]rails\b|\brails\b", re.I)),
    ("Ruby", re.compile(r"\bruby\b(?!\s*on\s*rails)", re.I)),
    ("PHP", re.compile(r"\bphp\b|\blaravel\b", re.I)),
    ("Scala", re.compile(r"\bscala\b", re.I)),
    ("Elixir", re.compile(r"\belixir\b|\bphoenix framework\b", re.I)),
    ("GraphQL", re.compile(r"\bgraph[ ]?ql\b", re.I)),
    ("gRPC", re.compile(r"\bgrpc\b", re.I)),
    ("Kubernetes", re.compile(r"\bkubernetes\b|\bk8s\b", re.I)),
    ("Docker", re.compile(r"\bdocker\b|\bcontainerd\b", re.I)),
    ("Terraform", re.compile(r"\bterraform\b", re.I)),
    ("AWS", re.compile(r"\baws\b|\bamazon web services\b", re.I)),
    ("GCP", re.compile(r"\bgcp\b|\bgoogle cloud\b", re.I)),
    ("Azure", re.compile(r"\bazure\b", re.I)),
    ("PostgreSQL", re.compile(r"\bpostgres(?:ql)?\b", re.I)),
    ("MySQL", re.compile(r"\bmysql\b", re.I)),
    ("MongoDB", re.compile(r"\bmongo(?:db)?\b", re.I)),
    ("Redis", re.compile(r"\bredis\b", re.I)),
    ("Kafka", re.compile(r"\bkafka\b", re.I)),
    ("Spark", re.compile(r"\bapache spark\b|\bpy[ ]?spark\b", re.I)),
    ("TensorFlow", re.compile(r"\btensor[ ]?flow\b", re.I)),
    ("PyTorch", re.compile(r"\bpy[ ]?torch\b", re.I)),
    ("SQL", re.compile(r"\bsql\b", re.I)),
]

# Families sharing a base token: once the base is emitted we don't also want
# the parent framework unless it matched on its own terms. Handled inline in
# detect_tech_tags via first-match-wins over the ordered list above, so no
# extra structure is needed here — this list is just documentation of intent.

_VISA_NEGATIVE_RE = re.compile(
    r"\b(?:no|not|unable|cannot|can['’]?t|will\s+not|won['’]?t|do(?:es)?\s+not|are\s+not\s+able)\b"
    r"[^.\n]{0,40}\b(?:sponsor(?:ship)?|visa)\b"
    r"|\bwithout\s+(?:visa\s+)?sponsorship\b"
    r"|\bsponsorship\s+(?:is\s+)?not\s+(?:available|offered|provided)\b"
    r"|\bnot\s+(?:able|eligible)\s+to\s+sponsor\b"
    r"|\bmust\s+(?:be\s+)?(?:legally\s+)?authoriz|authoris\w*\s+to\s+work[^.\n]{0,40}\bwithout\b",
    re.I,
)
_VISA_POSITIVE_RE = re.compile(
    r"\bvisa\s+sponsorship\b"
    r"|\bsponsor(?:ship)?\s+(?:a\s+|the\s+)?(?:visa|work\s+permit|candidates?|applicants?|employees?)\b"
    r"|\bwill(?:ing\s+to)?\s+sponsor\b"
    r"|\bsponsorship\s+(?:is\s+)?(?:available|offered|provided)\b"
    r"|\bwe\s+(?:can\s+|do\s+|will\s+)?sponsor\b"
    r"|\bh-?1b\s+sponsor"
    r"|\bvisa\s+support\b|\brelocation\s+and\s+visa\b"
    r"|\beligible\s+for\s+(?:visa\s+)?sponsorship\b"
    r"|\bprovide\s+(?:visa\s+)?sponsorship\b",
    re.I,
)

_NO_DEGREE_RE = re.compile(
    r"\bno\s+degree\s+(?:required|necessary|needed)\b"
    r"|\bdegree\s+(?:is\s+)?not\s+(?:required|necessary|needed)\b"
    r"|\bwithout\s+a\s+(?:college\s+|university\s+)?degree\b"
    r"|\bin\s+lieu\s+of\s+a\s+degree\b"
    r"|\bor\s+equivalent\s+practical\s+experience\b"
    r"|\bdo(?:es)?\s+not\s+require\s+a\s+degree\b"
    r"|\bdegree[- ]optional\b",
    re.I,
)
_DEGREE_REQUIRED_RE = re.compile(
    r"\b(?:bachelor['’]?s?|master['’]?s?|b\.?s\.?c?\.?|m\.?s\.?c?\.?|ph\.?\s?d\.?|bs/ms|undergraduate\s+degree)\b"
    r"[^.\n]{0,60}\b(?:is\s+)?(?:required|mandatory|a\s+must)\b"
    r"|\brequires?\s+(?:a\s+|an\s+)?(?:bachelor|master|degree|ph\.?\s?d|bs\b|ms\b)"
    r"|\bmust\s+(?:have|possess|hold)\s+(?:a\s+|an\s+)?(?:bachelor|master|degree)"
    r"|\bminimum\s+(?:of\s+)?(?:a\s+)?(?:bachelor|master)['’]?s?\b",
    re.I,
)

_RELOCATION_NEGATIVE_RE = re.compile(
    r"\bno\s+relocation\b|\brelocation\s+(?:is\s+)?not\s+(?:available|offered|provided)\b", re.I
)
_RELOCATION_POSITIVE_RE = re.compile(
    r"\brelocation\s+(?:assistance|package|support|benefits?|bonus|allowance|stipend|provided|offered|available)\b"
    r"|\b(?:assistance|help|support)\s+with\s+relocat"
    r"|\bwe(?:['’]ll|\s+will)?\s+(?:help\s+you\s+)?relocat"
    r"|\bwilling\s+to\s+relocate\s+you\b",
    re.I,
)

_CURRENCY_CODES = {
    "$": "USD", "US$": "USD", "USD": "USD",
    "€": "EUR", "EUR": "EUR",
    "£": "GBP", "GBP": "GBP",
    "C$": "CAD", "CAD": "CAD",
    "A$": "AUD", "AUD": "AUD",
    "₹": "INR", "INR": "INR",
    "AED": "AED", "SAR": "SAR", "EGP": "EGP",
}
_SALARY_NUM = r"\d{1,3}(?:,\d{3})+|\d{1,3}(?:\.\d+)?\s?[kK]|\d{1,7}"
_SALARY_RANGE_RE = re.compile(
    r"(?P<cur>US\$|C\$|A\$|\$|€|£|₹|USD|EUR|GBP|CAD|AUD|INR|AED|SAR|EGP)\s?"
    r"(?P<lo>" + _SALARY_NUM + r")"
    r"\s?(?:-|–|—|to)\s?"
    r"(?:US\$|C\$|A\$|\$|€|£|₹|USD|EUR|GBP|CAD|AUD|INR|AED|SAR|EGP)?\s?"
    r"(?P<hi>" + _SALARY_NUM + r")",
    re.I,
)
_SALARY_PER_HOUR_RE = re.compile(r"\bper\s+hour\b|\b/\s?hr\b|\bhourly\b|\ban\s+hour\b", re.I)
_SALARY_PER_MONTH_RE = re.compile(r"\bper\s+month\b|\b/\s?mo\b|\bmonthly\b", re.I)
_SALARY_PER_YEAR_RE = re.compile(
    r"\bper\s+year\b|\bper\s+annum\b|\bannually\b|\bannual\b|\b/\s?yr\b|\bp\.?a\.?\b|\byearly\b", re.I
)


def detect_tech_tags(text):
    """Ordered, de-duplicated list of canonical tech tags explicitly named in
    ``text``. First-match-wins over TECH_TAG_PATTERNS so "React Native" is
    never also reported as bare "React" unless "React" appears separately."""
    if not text:
        return []
    found = []
    seen = set()
    for tag, rx in TECH_TAG_PATTERNS:
        if tag in seen:
            continue
        if rx.search(text):
            found.append(tag)
            seen.add(tag)
    return found


def detect_requirements(text):
    """Work-authorisation / education / relocation facets stated in ``text``.

    Returns a dict containing only the keys the text is explicit about:
      ``visa_sponsorship``  True | False   (False only on an explicit "no …")
      ``degree_required``   True | False   (False only on an explicit "no degree")
      ``relocation``        True | False   (False only on an explicit "no relocation")
    A silent text yields ``{}``.
    """
    out = {}
    if not text:
        return out
    if _VISA_NEGATIVE_RE.search(text):
        out["visa_sponsorship"] = False
    elif _VISA_POSITIVE_RE.search(text):
        out["visa_sponsorship"] = True

    if _NO_DEGREE_RE.search(text):
        out["degree_required"] = False
    elif _DEGREE_REQUIRED_RE.search(text):
        out["degree_required"] = True

    if _RELOCATION_NEGATIVE_RE.search(text):
        out["relocation"] = False
    elif _RELOCATION_POSITIVE_RE.search(text):
        out["relocation"] = True
    return out


def _salary_amount(raw):
    raw = raw.strip().lower().replace(" ", "")
    if raw.endswith("k"):
        return int(round(float(raw[:-1]) * 1000))
    return int(raw.replace(",", ""))


def parse_salary(text):
    """A literal pay range lifted straight from the posting, or None.

    Strict: needs an explicit currency mark and a two-ended range. Rejects
    anything that doesn't look like real pay (min > max, a >10x spread, or
    amounts outside sane annual/hourly bounds) rather than guess. ``period``
    is read from nearby wording when present, otherwise inferred from
    magnitude — that inference is arithmetic on the stated numbers, it does
    not invent the numbers themselves.
    """
    if not text:
        return None
    m = _SALARY_RANGE_RE.search(text)
    if not m:
        return None
    raw_cur = m.group("cur")
    cur = _CURRENCY_CODES.get(raw_cur) or _CURRENCY_CODES.get(raw_cur.upper())
    if cur is None:
        return None
    try:
        lo = _salary_amount(m.group("lo"))
        hi = _salary_amount(m.group("hi"))
    except (ValueError, TypeError):
        return None
    if lo <= 0 or hi <= 0 or lo > hi or hi > lo * 10:
        return None

    window = text[max(0, m.start() - 40): m.end() + 40]
    if _SALARY_PER_HOUR_RE.search(window):
        period = "hour"
    elif _SALARY_PER_MONTH_RE.search(window):
        period = "month"
    elif _SALARY_PER_YEAR_RE.search(window):
        period = "year"
    else:
        period = "hour" if hi < 1000 else ("month" if hi < 10000 else "year")

    bounds = {
        "hour": (5, 500),
        "month": (500, 100_000),
        "year": (10_000, 2_000_000),
    }[period]
    if not (bounds[0] <= lo and hi <= bounds[1]):
        return None
    return {"min": lo, "max": hi, "currency": cur, "period": period}


def extract_job_facets(title, location="", description=""):
    """Merge-ready dict of every facet detectable from the parts of a posting
    we have. Only present keys are returned, so ``record.update(facets)`` is
    always safe. ``tech_tags`` and requirement facets scan the whole blob;
    ``salary`` prefers the description (a title rarely carries a real range).
    """
    blob = " ".join(p for p in (title, location, description) if p)
    facets = {}
    tags = detect_tech_tags(blob)
    if tags:
        facets["tech_tags"] = tags
    facets.update(detect_requirements(blob))
    salary = parse_salary(description) or parse_salary(blob)
    if salary:
        facets["salary"] = salary
    return facets
