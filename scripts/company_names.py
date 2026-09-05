"""Human-readable company-name normalization, shared by the pipeline scripts.

Several sources hand this pipeline a company name that is really a machine
token: `config/extra_job_boards.yml` slugs get run through
`token.replace("-", " ").title()` (so `openai` -> `Openai`, `mongodb` ->
`Mongodb`), `LorenzoLaCorte/european-tech-internships` lists every company in
all-lowercase, and the community trackers occasionally carry an odd-cased name.
`prettify_company_name` is the single place that turns any of those into the
form a person expects to read ("OpenAI", "MongoDB", "Jane Street").

stdlib only — imported by fetch.py / public_sources.py / build_data_readme.py,
none of which are allowed a third-party dependency.
"""

from __future__ import annotations

import re

# Exact display form for names a generic title-caser can't get right: acronyms
# ("IBM"), internal capitals ("PayPal"), and tokens with no separator to split
# on ("janestreet" -> "Jane Street"). Keys are the lowercased, punctuation-
# normalized name (see `_key`); values are the final display string.
CANONICAL = {
    "openai": "OpenAI",
    "mongodb": "MongoDB",
    "clickhouse": "ClickHouse",
    "scaleai": "Scale AI",
    "scale ai": "Scale AI",
    "janestreet": "Jane Street",
    "jane street": "Jane Street",
    "epicgames": "Epic Games",
    "epic games": "Epic Games",
    "spacex": "SpaceX",
    "bytedance": "ByteDance",
    "tiktok": "TikTok",
    "github": "GitHub",
    "gitlab": "GitLab",
    "paypal": "PayPal",
    "linkedin": "LinkedIn",
    "deepmind": "DeepMind",
    "hashicorp": "HashiCorp",
    "smartrecruiters": "SmartRecruiters",
    "phonepe": "PhonePe",
    "hubspot": "HubSpot",
    "dropbox": "Dropbox",
    "n26": "N26",
    "dlocal": "dLocal",
    "paytm": "Paytm",
    "nvidia": "NVIDIA",
    "ibm": "IBM",
    "amd": "AMD",
    "sap": "SAP",
    "arm": "Arm",
    "aws": "AWS",
    "spotify": "Spotify",
    "coinbase": "Coinbase",
    "robinhood": "Robinhood",
    "doordash": "DoorDash",
    "servicenow": "ServiceNow",
    "palantir": "Palantir",
    "databricks": "Databricks",
    "snowflake": "Snowflake",
    "amazon web services": "Amazon Web Services",
}

# Sub-tokens that should be upper-cased wherever they appear as a whole word
# ("... AI", "... ML", "... QA"). Kept small and unambiguous.
_ACRONYM_WORDS = {
    "ai": "AI", "ml": "ML", "qa": "QA", "ui": "UI", "ux": "UX", "hr": "HR",
    "aws": "AWS", "gcp": "GCP", "api": "API", "sdk": "SDK", "sql": "SQL",
    "ios": "iOS", "sre": "SRE", "nlp": "NLP", "llm": "LLM", "gpu": "GPU",
    "ci": "CI", "cd": "CD", "it": "IT", "qa/qc": "QA/QC",
}


def _key(value: str) -> str:
    value = re.sub(r"\s+", " ", value or "").strip().lower()
    value = re.sub(r"[._/]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def _title_token(token: str) -> str:
    """Title-case one whitespace-delimited token, preserving the cases a plain
    ``.title()`` would destroy: existing internal capitals ("ByteDance"),
    all-caps acronyms already spelled out ("SAP"), and anything with a digit
    ("N26"). Hyphenated pieces are title-cased individually ("Coca-Cola").
    """
    if not token:
        return token
    low = token.lower()
    if low in _ACRONYM_WORDS:
        return _ACRONYM_WORDS[low]
    # Same, but with surrounding punctuation kept ("ml," -> "ML,", "(ai)" -> "(AI)").
    core = token.strip(".,:;!?()[]{}'\"")
    if core and core.lower() in _ACRONYM_WORDS:
        return token.replace(core, _ACRONYM_WORDS[core.lower()], 1)
    if any(ch.isdigit() for ch in token):
        return token
    if token.isupper() and len(token) <= 4:
        return token
    if re.search(r"[a-z][A-Z]", token):
        return token
    if "-" in token:
        return "-".join(_title_token(part) for part in token.split("-"))
    return token[:1].upper() + token[1:].lower()


def prettify_company_name(raw: str) -> str:
    """Return `raw` in the form a reader expects.

    Idempotent and safe on an already-clean name ("Stripe" -> "Stripe",
    "Jane Street" -> "Jane Street"). A trailing parenthetical is dropped
    ("Amazon Web Services (AWS)" -> "Amazon Web Services") since it's almost
    always a redundant abbreviation of what precedes it.
    """
    if not raw or not raw.strip():
        return raw
    collapsed = re.sub(r"\s+", " ", raw).strip()
    without_paren = re.sub(r"\s*\([^)]*\)\s*$", "", collapsed).strip() or collapsed

    key = _key(without_paren)
    if key in CANONICAL:
        return CANONICAL[key]

    # Only re-case a name that is clearly an unformatted machine token — i.e.
    # entirely lowercase ("openai", "amazon web services", the whole
    # LorenzoLaCorte feed). Anything that already carries capitalization is a
    # real display name (a university, a hackathon org, "JPMorgan Chase") and
    # is returned untouched apart from whitespace collapsing — title-casing it
    # would only mangle "of" -> "Of", "(IIT)" -> "(iit)", etc.
    if without_paren != without_paren.lower():
        return collapsed

    return " ".join(_title_token(tok) for tok in without_paren.split(" "))


# Filler words that stay lower-case mid-phrase in a title-cased string
# ("Software Engineer for the Ads Team"), but are still capitalized if they
# lead the string.
_TITLE_MINOR_WORDS = {
    "a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or",
    "the", "to", "vs", "via", "with", "nor", "per",
}


def smart_title_case(text: str) -> str:
    """Title-case `text` ONLY when it arrives entirely lower-case — a
    low-quality scraped value like "software dev engineer intern, amazon
    robotics" or "berlin, germany". A string with any existing capital is
    left as-is (its source already cased it). Acronyms (_ACRONYM_WORDS) and
    digit-bearing tokens are preserved; short filler words stay lower unless
    they lead the string. Idempotent on already-cased input.
    """
    if not text or not text.strip():
        return text
    collapsed = re.sub(r"\s+", " ", text).strip()
    if collapsed != collapsed.lower():
        return collapsed
    words = collapsed.split(" ")
    out = []
    for idx, tok in enumerate(words):
        bare = tok.strip(".,:;()[]{}'\"").lower()
        if idx > 0 and bare in _TITLE_MINOR_WORDS:
            out.append(tok.lower())
        else:
            out.append(_title_token(tok))
    return " ".join(out)
