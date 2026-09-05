#!/usr/bin/env python3
"""
Fetch global tech roles from multiple sources, normalize, dedupe, and export.
Sources: Remotive, ArbeitNow, SimplifyJobs (internships & new grad), ambicuity/
New-Grad-Jobs, speedyapply (SWE + AI), zapplyjobs, hanzili (Canada), Amazon
(direct from amazon.jobs' own API), Netflix (direct from its Eightfold-hosted
careers API)
Scope: US, Canada, EMEA + Remote | Levels: Internship/New Grad/Junior/Entry/Mid
Companies: Top-tier allowlist only
"""

import json
import re
import hashlib
import datetime
import urllib.request
import urllib.error
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from patterns import (
    FETCH_COUNTRY_MARK_MAP,
    FETCH_HYBRID_RE,
    FETCH_LEVEL_MAP,
    FETCH_REMOTE_RE,
    FETCH_ROLE_RE,
    detect_region,
    detect_role_type,
)
from simplify_jobs_parser import (
    clean_html_text as _clean_html_text,
    format_location_display as _format_location_display,
    parse_simplify_entries,
)
from community_board_parser import parse_job_table
from company_names import prettify_company_name
from fetch_outputs import write_fetch_outputs
from net import check_url_alive, fetch_with_retry, find_dead_links, run_and_collect

# Setup paths and directories
ROOT = Path(__file__).parent.parent
DATA_RAW = ROOT / "data" / "raw"
DATA_OUT = ROOT / "data"
CONFIG = ROOT / "config"

DATA_RAW.mkdir(parents=True, exist_ok=True)
DATA_OUT.mkdir(parents=True, exist_ok=True)

NOW_ISO = datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
TODAY = datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%d")

# Logging helpers
ERRORS = []
DEBUG = False

def log_info(msg):
    print(f"[INFO] {msg}", file=sys.stdout, flush=True)

def log_warn(msg):
    print(f"[WARN] {msg}", file=sys.stderr, flush=True)

def log_error(msg):
    print(f"[ERROR] {msg}", file=sys.stderr, flush=True)
    ERRORS.append(msg)

def log_debug(msg):
    if DEBUG:
        print(f"[DEBUG] {msg}", file=sys.stdout, flush=True)

# Load company allowlist. ALLOWLIST stays a flat list of lowercase company
# names (matching the config file's own line-by-line shape); the YAML's
# top-level category headers (faang, big_tech, cloud_infra, ...) are tracked
# alongside it in ALLOWLIST_CATEGORY_BY_NAME rather than folded into
# ALLOWLIST's own shape, so is_allowed_company() can report which category a
# company matched without changing what ALLOWLIST itself looks like.
ALLOWLIST_PATH = CONFIG / "companies_allowlist.yml"
ALLOWLIST = []
ALLOWLIST_CATEGORY_BY_NAME = {}

if not ALLOWLIST_PATH.exists():
    log_error(f"Allowlist not found: {ALLOWLIST_PATH}")
else:
    try:
        current_category = None
        for line in ALLOWLIST_PATH.read_text(encoding="utf-8").splitlines():
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            if s.endswith(":"):
                current_category = s[:-1].strip()
                continue
            name = s.lstrip("- ").strip().lower()
            if name:
                ALLOWLIST.append(name)
                ALLOWLIST_CATEGORY_BY_NAME[name] = current_category or "other"
        log_info(f"Loaded {len(ALLOWLIST)} companies from allowlist")
    except Exception as e:
        log_error(f"Failed to load allowlist: {e}")
        ALLOWLIST = []
        ALLOWLIST_CATEGORY_BY_NAME = {}

LEVEL_MAP = FETCH_LEVEL_MAP
ROLE_RE = FETCH_ROLE_RE
REMOTE_RE = FETCH_REMOTE_RE
HYBRID_RE = FETCH_HYBRID_RE

WANTED_LEVELS = {
    "internship",
    "new_grad",
    "junior",
    "entry_level",
    "mid_level",
}
WANTED_REGIONS = {"us", "canada", "emea", "remote"}
RELAXED_MODE = False

# Sources where a role whose title doesn't self-describe a level
# (detect_level -> "unknown") is KEPT rather than dropped in strict mode, as
# long as it isn't clearly a senior/leadership posting. Scoped to Amazon on
# purpose: its API serves thousands of "Software Development Engineer" roles
# with no level word in the title (entry-to-mid in practice, "Senior"/
# "Principal" spelled out when higher), and dropping all of them is the main
# reason Amazon's curated count is a fraction of what's actually open. Other
# first-party APIs use grade conventions ("Software Engineer 4/5") that this
# can't safely bucket, so they stay strict.
UNKNOWN_LEVEL_SOURCES = {"amazon"}
SENIOR_TITLE_RE = re.compile(
    r"\b(senior|sr\.?|staff|principal|lead|manager|director|head\s+of|vp|"
    r"vice\s+president|distinguished|fellow|architect|executive)\b",
    re.I,
)

COUNTRY_MARK_MAP = FETCH_COUNTRY_MARK_MAP

# Utility functions
def make_id(company, title, url):
    raw = f"{company.lower()}|{title.lower()}|{url}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]

def detect_level(title):
    for level, rx in LEVEL_MAP.items():
        if rx.search(title):
            return level
    return "unknown"

def detect_remote_type(location):
    if REMOTE_RE.search(location):
        return "remote"
    if HYBRID_RE.search(location):
        return "hybrid"
    return "onsite" if location.strip() else "unknown"

def detect_country(location):
    for rx, country in COUNTRY_MARK_MAP:
        if rx.search(location):
            return country
    if REMOTE_RE.search(location):
        return "Remote"
    return "Unknown"

def clean_company(company):
    company = re.sub(r"^[\s🔥]+", "", company).strip()
    return re.sub(r"\s+", " ", company)

def format_company(company):
    return clean_company(company).replace("🔥", "")

def format_location_display(location):
    clean_location = re.sub(r"\s+", " ", location.strip())
    return clean_location

def format_job_age(row):
    age = (row.get("age") or "").strip()
    if age:
        return age

    posted_at = (row.get("posted_at") or "").strip()
    try:
        posted_date = datetime.date.fromisoformat(posted_at[:10])
    except Exception:
        return ""

    age_days = max((datetime.datetime.now(datetime.UTC).date() - posted_date).days, 0)
    return f"{age_days}d"

def _age_to_days(age_value):
    age_value = (age_value or "").strip().lower()
    if not age_value:
        return None

    match = re.match(r"^(\d+)\s*(d|day|days|w|week|weeks|mo|month|months|y|year|years)$", age_value)
    if not match:
        return None

    amount = int(match.group(1))
    unit = match.group(2)
    if unit in {"d", "day", "days"}:
        return amount
    if unit in {"w", "week", "weeks"}:
        return amount * 7
    if unit in {"mo", "month", "months"}:
        return amount * 30
    if unit in {"y", "year", "years"}:
        return amount * 365
    return None

def _job_sort_key(row):
    age_days = _age_to_days(row.get("age"))
    if age_days is None:
        posted_at = (row.get("posted_at") or "").strip()
        try:
            posted_date = datetime.date.fromisoformat(posted_at[:10])
            age_days = max((datetime.datetime.now(datetime.UTC).date() - posted_date).days, 0)
        except Exception:
            age_days = 10**9

    posted_at = (row.get("posted_at") or "").strip()
    try:
        posted_date = datetime.date.fromisoformat(posted_at[:10])
        posted_sort = -posted_date.toordinal()
    except Exception:
        posted_sort = 0

    return (age_days, posted_sort, (row.get("company") or "").lower(), (row.get("title") or "").lower())

def is_allowed_company(company):
    """Return the matched allowlist category (e.g. 'faang', 'big_tech') if
    company is on the allowlist, or None if it isn't. Still works anywhere
    that only checked this for truthiness before.
    """
    c = company.lower()
    for a in ALLOWLIST:
        if a in c or c in a:
            return ALLOWLIST_CATEGORY_BY_NAME.get(a, "other")
    return None

def include_job(row, company):
    category = is_allowed_company(company)
    row["category"] = category or ""

    if not RELAXED_MODE:
        level_ok = row["level"] in WANTED_LEVELS or (
            row["level"] == "unknown"
            and row.get("source") in UNKNOWN_LEVEL_SOURCES
            and not SENIOR_TITLE_RE.search(row.get("title") or "")
        )
        return level_ok and category is not None

    level_ok = row["level"] in WANTED_LEVELS or row["level"] == "unknown"
    company_ok = category is not None or row["level"] in {"internship", "new_grad"}
    return level_ok and company_ok


def fetch_url(url, dest, timeout=25):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "tracker-bot/1.0"})
        _status, data = fetch_with_retry(req, timeout)
        dest.write_bytes(data)
        log_debug(f"Fetched {len(data)} bytes from {url}")
        return True
    except urllib.error.HTTPError as e:
        log_warn(f"HTTP {e.code} from {url}: {e.reason}")
        return False
    except urllib.error.URLError as e:
        log_warn(f"URL error from {url}: {e.reason}")
        return False
    except Exception as e:
        log_error(f"Unexpected error fetching {url}: {type(e).__name__}: {e}")
        return False

def normalize(company, title, location, url, posted_at, source, source_url, age="", location_details=None):
    return {
        "id": make_id(company, title, url),
        "company": clean_company(company),
        "title": title.strip(),
        "level": detect_level(title),
        "region": detect_region(location),
        "role_type": detect_role_type(title),
        "country": detect_country(location),
        "location": location.strip(),
        "remote_type": detect_remote_type(location),
        "url": url.strip(),
        "source": source,
        "source_url": source_url,
        "posted_at": (posted_at or TODAY)[:10],
        "age": age.strip(),
        "location_details": location_details or [],
        "collected_at": NOW_ISO,
        "tags": ["software", "programming", "global-tech-roles"],
    }

# Source fetcher functions
def fetch_remotive():
    """Fetch from Remotive API - global remote job board"""
    out = []
    path = DATA_RAW / "remotive.json"
    log_info("Fetching Remotive...")
    
    if not fetch_url("https://remotive.com/api/remote-jobs?category=software-dev", path):
        log_warn("Remotive fetch failed, skipping")
        return out
    
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        jobs = data.get("jobs", [])
        log_debug(f"Remotive returned {len(jobs)} total jobs")
    except json.JSONDecodeError as e:
        log_error(f"Invalid JSON from Remotive: {e}")
        return out
    except Exception as e:
        log_error(f"Error parsing Remotive: {e}")
        return out
    
    skipped = {"role": 0, "level": 0, "region": 0, "company": 0}
    
    for j in jobs:
        company = (j.get("company_name") or "").strip()
        title = (j.get("title") or "").strip()
        location = (j.get("candidate_required_location") or "Worldwide").strip()
        url = (j.get("url") or "").strip()
        posted = (j.get("publication_date") or TODAY)[:10]
        
        if not (company and title and url):
            skipped["role"] += 1
            continue
        
        if not ROLE_RE.search(title):
            skipped["role"] += 1
            continue
        
        row = normalize(company, title, location, url, posted, "remotive", "https://remotive.com/")

        if not include_job(row, company):
            if row["level"] not in WANTED_LEVELS and not RELAXED_MODE:
                skipped["level"] += 1
            elif row["region"] not in WANTED_REGIONS and not RELAXED_MODE:
                skipped["region"] += 1
            else:
                skipped["company"] += 1
            continue
        
        out.append(row)
    
    log_info(f"Remotive: {len(out)} matched (skipped role:{skipped['role']} level:{skipped['level']} region:{skipped['region']} company:{skipped['company']})")
    return out

def fetch_arbeitnow():
    """Fetch from ArbeitNow API - remote work marketplace"""
    out = []
    path = DATA_RAW / "arbeitnow.json"
    log_info("Fetching ArbeitNow...")
    
    if not fetch_url("https://arbeitnow.com/api/job-board-api", path):
        log_warn("ArbeitNow fetch failed, skipping")
        return out
    
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        jobs = data.get("data", [])
        log_debug(f"ArbeitNow returned {len(jobs)} total jobs")
    except json.JSONDecodeError as e:
        log_error(f"Invalid JSON from ArbeitNow: {e}")
        return out
    except Exception as e:
        log_error(f"Error parsing ArbeitNow: {e}")
        return out
    
    skipped = {"role": 0, "level": 0, "region": 0, "company": 0}
    
    for j in jobs:
        company = (j.get("company_name") or "").strip()
        title = (j.get("title") or "").strip()
        location = (j.get("location") or "Remote").strip()
        
        if j.get("remote"):
            if "remote" not in location.lower():
                location += " (Remote)"
        
        url = (j.get("url") or "").strip()
        posted = str(j.get("created_at") or TODAY)[:10]
        
        if not (company and title and url):
            skipped["role"] += 1
            continue
        
        if not ROLE_RE.search(title):
            skipped["role"] += 1
            continue
        
        row = normalize(company, title, location, url, posted, "arbeitnow", "https://arbeitnow.com/")

        if not include_job(row, company):
            if row["level"] not in WANTED_LEVELS and not RELAXED_MODE:
                skipped["level"] += 1
            elif row["region"] not in WANTED_REGIONS and not RELAXED_MODE:
                skipped["region"] += 1
            else:
                skipped["company"] += 1
            continue
        
        out.append(row)
    
    log_info(f"ArbeitNow: {len(out)} matched (skipped role:{skipped['role']} level:{skipped['level']} region:{skipped['region']} company:{skipped['company']})")
    return out

def fetch_simplify_internships():
    """Fetch SimplifyJobs internships from GitHub README markdown"""
    out = []
    path = DATA_RAW / "simplify_internships.md"
    log_info("Fetching SimplifyJobs Internships...")
    
    if not fetch_url(
        "https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/README.md",
        path,
    ):
        log_warn("SimplifyJobs internships fetch failed, skipping")
        return out
    
    try:
        content = path.read_text(encoding="utf-8")
        entries = parse_simplify_entries(content)
        log_debug(f"Internships parser extracted {len(entries)} entries")
    except Exception as e:
        log_error(f"Error reading internships markdown: {e}")
        return out
    
    skipped = {"role": 0, "level": 0, "region": 0, "company": 0, "parse": 0}
    
    for company, title, location, url, age, location_details in entries:
        try:
            
            if not (company and title and url):
                skipped["parse"] += 1
                continue
            
            if not ROLE_RE.search(title):
                skipped["role"] += 1
                continue
            
            row = normalize(
                company,
                title,
                location,
                url,
                TODAY,
                "simplify_internships",
                "https://github.com/SimplifyJobs/Summer2026-Internships",
                age=age,
                location_details=location_details,
            )

            if not include_job(row, company):
                if row["region"] not in WANTED_REGIONS and not RELAXED_MODE:
                    skipped["region"] += 1
                else:
                    skipped["company"] += 1
                continue
            
            out.append(row)
        except Exception as e:
            log_debug(f"Error parsing internship line: {e}")
            skipped["parse"] += 1
    
    log_info(f"SimplifyJobs Internships: {len(out)} matched (skipped role:{skipped['role']} region:{skipped['region']} company:{skipped['company']} parse:{skipped['parse']})")
    return out

def fetch_simplify_newgrad():
    """Fetch SimplifyJobs new grad positions from GitHub README markdown"""
    out = []
    path = DATA_RAW / "simplify_newgrad.md"
    log_info("Fetching SimplifyJobs New Grad...")
    
    if not fetch_url(
        "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/README.md",
        path,
    ):
        log_warn("SimplifyJobs new grad fetch failed, skipping")
        return out
    
    try:
        content = path.read_text(encoding="utf-8")
        entries = parse_simplify_entries(content)
        log_debug(f"New grad parser extracted {len(entries)} entries")
    except Exception as e:
        log_error(f"Error reading new grad markdown: {e}")
        return out
    
    skipped = {"role": 0, "level": 0, "region": 0, "company": 0, "parse": 0}
    
    for company, title, location, url, age, location_details in entries:
        try:
            
            if not (company and title and url):
                skipped["parse"] += 1
                continue
            
            if not ROLE_RE.search(title):
                skipped["role"] += 1
                continue
            
            row = normalize(
                company,
                title,
                location,
                url,
                TODAY,
                "simplify_newgrad",
                "https://github.com/SimplifyJobs/New-Grad-Positions",
                age=age,
                location_details=location_details,
            )

            if not include_job(row, company):
                if row["region"] not in WANTED_REGIONS and not RELAXED_MODE:
                    skipped["region"] += 1
                else:
                    skipped["company"] += 1
                continue
            
            out.append(row)
        except Exception as e:
            log_debug(f"Error parsing new grad line: {e}")
            skipped["parse"] += 1
    
    log_info(f"SimplifyJobs New Grad: {len(out)} matched (skipped role:{skipped['role']} region:{skipped['region']} company:{skipped['company']} parse:{skipped['parse']})")
    return out

def _fetch_community_board(source_id, source_url, raw_readme_url, cache_name, *, company_idx, title_idx, location_idx):
    """Shared fetch+parse+filter loop for community job-tracker READMEs that
    share the generic pipe-table shape handled by community_board_parser
    (speedyapply, zapplyjobs, hanzili — each with its own column order).
    """
    out = []
    path = DATA_RAW / cache_name
    log_info(f"Fetching {source_id}...")

    if not fetch_url(raw_readme_url, path):
        log_warn(f"{source_id} fetch failed, skipping")
        return out

    try:
        content = path.read_text(encoding="utf-8")
        entries = parse_job_table(content, company_idx=company_idx, title_idx=title_idx, location_idx=location_idx)
        log_debug(f"{source_id} parser extracted {len(entries)} entries")
    except Exception as e:
        log_error(f"Error reading {source_id} markdown: {e}")
        return out

    skipped = {"role": 0, "region": 0, "company": 0, "parse": 0}

    for company, title, location, url, age in entries:
        try:
            if not (company and title and url):
                skipped["parse"] += 1
                continue

            if not ROLE_RE.search(title):
                skipped["role"] += 1
                continue

            row = normalize(company, title, location, url, TODAY, source_id, source_url, age=age)

            if not include_job(row, company):
                if row["region"] not in WANTED_REGIONS and not RELAXED_MODE:
                    skipped["region"] += 1
                else:
                    skipped["company"] += 1
                continue

            out.append(row)
        except Exception as e:
            log_debug(f"Error parsing {source_id} line: {e}")
            skipped["parse"] += 1

    log_info(f"{source_id}: {len(out)} matched (skipped role:{skipped['role']} region:{skipped['region']} company:{skipped['company']} parse:{skipped['parse']})")
    return out

def fetch_speedyapply_swe():
    """Fetch speedyapply/2027-SWE-College-Jobs' README job table."""
    return _fetch_community_board(
        "speedyapply_swe",
        "https://github.com/speedyapply/2027-SWE-College-Jobs",
        "https://raw.githubusercontent.com/speedyapply/2027-SWE-College-Jobs/main/README.md",
        "speedyapply_swe.md",
        company_idx=0, title_idx=1, location_idx=2,
    )

def fetch_speedyapply_ai():
    """Fetch speedyapply/2027-AI-College-Jobs' README job table."""
    return _fetch_community_board(
        "speedyapply_ai",
        "https://github.com/speedyapply/2027-AI-College-Jobs",
        "https://raw.githubusercontent.com/speedyapply/2027-AI-College-Jobs/main/README.md",
        "speedyapply_ai.md",
        company_idx=0, title_idx=1, location_idx=2,
    )

def fetch_zapplyjobs_newgrad():
    """Fetch zapplyjobs/New-Grad-Software-Engineering-Jobs-2027's README job table."""
    return _fetch_community_board(
        "zapplyjobs_newgrad",
        "https://github.com/zapplyjobs/New-Grad-Software-Engineering-Jobs-2027",
        "https://raw.githubusercontent.com/zapplyjobs/New-Grad-Software-Engineering-Jobs-2027/main/README.md",
        "zapplyjobs_newgrad.md",
        company_idx=0, title_idx=1, location_idx=2,
    )

def fetch_zapplyjobs_all_newgrad():
    """Fetch zapplyjobs/New-Grad-Jobs-2027's README job table (all disciplines,
    not just SWE — same bot-generated table shape as the SWE-only board, but
    covers ~100+ companies the SWE-only board doesn't, e.g. Anthropic, Airbnb, ASML."""
    return _fetch_community_board(
        "zapplyjobs_all_newgrad",
        "https://github.com/zapplyjobs/New-Grad-Jobs-2027",
        "https://raw.githubusercontent.com/zapplyjobs/New-Grad-Jobs-2027/main/README.md",
        "zapplyjobs_all_newgrad.md",
        company_idx=0, title_idx=1, location_idx=2,
    )

def fetch_zapplyjobs_internships():
    """Fetch zapplyjobs/Internships-2027's README job table."""
    return _fetch_community_board(
        "zapplyjobs_internships",
        "https://github.com/zapplyjobs/Internships-2027",
        "https://raw.githubusercontent.com/zapplyjobs/Internships-2027/main/README.md",
        "zapplyjobs_internships.md",
        company_idx=0, title_idx=1, location_idx=2,
    )

def fetch_zapplyjobs_datascience():
    """Fetch zapplyjobs/New-Grad-Data-Science-Jobs-2027's README job table."""
    return _fetch_community_board(
        "zapplyjobs_datascience",
        "https://github.com/zapplyjobs/New-Grad-Data-Science-Jobs-2027",
        "https://raw.githubusercontent.com/zapplyjobs/New-Grad-Data-Science-Jobs-2027/main/README.md",
        "zapplyjobs_datascience.md",
        company_idx=0, title_idx=1, location_idx=2,
    )

def fetch_zapplyjobs_canada():
    """Fetch zapplyjobs/Canada-Jobs-2027's README job table."""
    return _fetch_community_board(
        "zapplyjobs_canada",
        "https://github.com/zapplyjobs/Canada-Jobs-2027",
        "https://raw.githubusercontent.com/zapplyjobs/Canada-Jobs-2027/main/README.md",
        "zapplyjobs_canada.md",
        company_idx=0, title_idx=1, location_idx=2,
    )

def fetch_zapplyjobs_canada_internships():
    """Fetch zapplyjobs/Canada-Internships-2027's README job table."""
    return _fetch_community_board(
        "zapplyjobs_canada_internships",
        "https://github.com/zapplyjobs/Canada-Internships-2027",
        "https://raw.githubusercontent.com/zapplyjobs/Canada-Internships-2027/main/README.md",
        "zapplyjobs_canada_internships.md",
        company_idx=0, title_idx=1, location_idx=2,
    )

def fetch_vanshb03_summer_internships():
    """Fetch vanshb03/Summer2027-Internships' README job table.

    One of the most-starred internship trackers on GitHub. Consecutive roles
    at the same company are grouped under a single header row with a "↳"
    marker instead of repeating the company name — parse_job_table carries
    the company forward for those rows.
    """
    return _fetch_community_board(
        "vanshb03_summer_internships",
        "https://github.com/vanshb03/Summer2027-Internships",
        "https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/main/README.md",
        "vanshb03_summer_internships.md",
        company_idx=0, title_idx=1, location_idx=2,
    )

def fetch_vanshb03_newgrad():
    """Fetch vanshb03/New-Grad-2027's README job table."""
    return _fetch_community_board(
        "vanshb03_newgrad",
        "https://github.com/vanshb03/New-Grad-2027",
        "https://raw.githubusercontent.com/vanshb03/New-Grad-2027/main/README.md",
        "vanshb03_newgrad.md",
        company_idx=0, title_idx=1, location_idx=2,
    )

def fetch_lorenzolacorte_eu():
    """Fetch LorenzoLaCorte/european-tech-internships-2026's README job table.

    A dedicated Europe-focused tracker (internships, new-grad, and PhD
    sections) — added to widen coverage beyond the mostly US/Canada
    curated sources. Apply links point at the original LinkedIn posting
    rather than a direct ATS page, same as any other source here.
    """
    rows = _fetch_community_board(
        "lorenzolacorte_eu",
        "https://github.com/LorenzoLaCorte/european-tech-internships-2026",
        "https://raw.githubusercontent.com/LorenzoLaCorte/european-tech-internships-2026/main/README.md",
        "lorenzolacorte_eu.md",
        company_idx=0, title_idx=1, location_idx=2,
    )
    # Unlike every other source, this one lists every company name in
    # all-lowercase ("google", "coca-cola hbc ag") — normalize it to the
    # display form the rest of the site uses (prettify_company_name also
    # fixes "openai" -> "OpenAI", which a plain .title() would leave as
    # "Openai").
    for row in rows:
        row["company"] = prettify_company_name(row["company"])
    return rows

def fetch_hanzili_canada():
    """Fetch hanzili/canada_sde_junior_new_grad_position's README job table."""
    return _fetch_community_board(
        "hanzili_canada",
        "https://github.com/hanzili/canada_sde_junior_new_grad_position",
        "https://raw.githubusercontent.com/hanzili/canada_sde_junior_new_grad_position/main/README.md",
        "hanzili_canada.md",
        company_idx=1, title_idx=0, location_idx=5,
    )

_AMAZON_POSTED_DATE_RE = re.compile(r"^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$")

def _parse_amazon_posted_date(text):
    """Amazon's search API returns dates like 'April  9, 2026' (a double
    space before single-digit days) — collapse whitespace before parsing.
    """
    collapsed = re.sub(r"\s+", " ", (text or "").strip())
    try:
        return datetime.datetime.strptime(collapsed, "%B %d, %Y").date().isoformat()
    except Exception:
        return TODAY

def fetch_amazon(max_pages=10, result_limit=100):
    """Fetch directly from amazon.jobs' own search API — verified live,
    keyless, real JSON — rather than only through third-party trackers that
    can carry stale/removed Amazon listings with no reliable way to verify
    them (Amazon's own careers site has no dead-link ambiguity the way a
    community README does: a closed posting simply won't appear in a fresh
    search result here).

    Query is Amazon's own job-family name ("software development engineer"),
    not narrowed to a level, since Amazon's title convention doesn't always
    self-describe level the way other sources do — level filtering is left
    entirely to detect_level() + include_job(), same as every other source.
    """
    out = []
    log_info("Fetching Amazon (direct)...")
    base_url = "https://www.amazon.jobs/en/search.json"
    skipped = {"role": 0, "level": 0, "region": 0, "company": 0}

    for page in range(max_pages):
        offset = page * result_limit
        url = f"{base_url}?base_query=software+development+engineer&result_limit={result_limit}&offset={offset}"
        path = DATA_RAW / f"amazon_page{page}.json"

        if not fetch_url(url, path):
            log_warn(f"Amazon fetch failed on page {page}, stopping pagination")
            break

        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            jobs = data.get("jobs", [])
        except Exception as e:
            log_error(f"Error parsing Amazon page {page}: {e}")
            break

        if not jobs:
            break

        for j in jobs:
            title = (j.get("title") or "").strip()
            job_path = (j.get("job_path") or "").strip()
            url_full = f"https://www.amazon.jobs{job_path}" if job_path else ""
            location = (j.get("normalized_location") or "").strip()
            posted = _parse_amazon_posted_date(j.get("posted_date") or "")

            if not (title and url_full):
                skipped["role"] += 1
                continue

            if not ROLE_RE.search(title):
                skipped["role"] += 1
                continue

            row = normalize("Amazon", title, location, url_full, posted, "amazon", "https://www.amazon.jobs/")

            if not include_job(row, "Amazon"):
                if row["level"] not in WANTED_LEVELS and not RELAXED_MODE:
                    skipped["level"] += 1
                elif row["region"] not in WANTED_REGIONS and not RELAXED_MODE:
                    skipped["region"] += 1
                else:
                    skipped["company"] += 1
                continue

            out.append(row)

        hits = data.get("hits", 0)
        if offset + result_limit >= hits:
            break

    log_info(f"Amazon: {len(out)} matched (skipped role:{skipped['role']} level:{skipped['level']} region:{skipped['region']} company:{skipped['company']})")
    return out

def _parse_netflix_posted_date(unix_ts):
    """Netflix's Eightfold API returns t_create as a Unix timestamp (seconds)."""
    try:
        return datetime.datetime.fromtimestamp(int(unix_ts), tz=datetime.timezone.utc).date().isoformat()
    except Exception:
        return TODAY

def fetch_netflix(max_pages=20, page_size=10):
    """Fetch directly from Netflix's own Eightfold-hosted careers API —
    verified live, keyless, real JSON — rather than not tracking Netflix at
    all, which was the status quo: Netflix runs its own Eightfold instance,
    not Greenhouse/Lever/Workday/Ashby/SmartRecruiters, so none of the
    public layer's auto-discovery/config mechanisms can ever reach it.

    Confirmed live 2026-08-18: `netflix.eightfold.ai/api/apply/v2/jobs` with
    `domain=netflix.com` returns real structured positions (id, name,
    location, canonicalPositionUrl, t_create/t_update as Unix timestamps),
    500 total open roles. The `query` param filters server-side — confirmed
    "software engineer" narrows that to ~164 — so this pages through the
    software-engineering subset directly instead of pulling all 500 and
    filtering client-side (each page returns at most 10 regardless of the
    `num` value requested — also confirmed live, not documented — hence the
    small `page_size` default and correspondingly higher `max_pages`).

    Eightfold's subdomain isn't a guessable-per-company pattern the way
    Greenhouse/Lever's are (spot-checked several other known Eightfold
    customers — none resolved at `<company>.eightfold.ai`), so this is a
    single verified direct integration, not a generalized auto-discovered
    platform — same treatment as Amazon's own direct API above.
    """
    out = []
    log_info("Fetching Netflix (direct)...")
    base_url = "https://netflix.eightfold.ai/api/apply/v2/jobs"
    skipped = {"role": 0, "level": 0, "region": 0, "company": 0}

    for page in range(max_pages):
        offset = page * page_size
        url = f"{base_url}?domain=netflix.com&query=software+engineer&start={offset}&num={page_size}"
        path = DATA_RAW / f"netflix_page{page}.json"

        if not fetch_url(url, path):
            log_warn(f"Netflix fetch failed on page {page}, stopping pagination")
            break

        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            positions = data.get("positions", [])
        except Exception as e:
            log_error(f"Error parsing Netflix page {page}: {e}")
            break

        if not positions:
            break

        for p in positions:
            title = (p.get("name") or "").strip()
            url_full = (p.get("canonicalPositionUrl") or "").strip()
            location = (p.get("location") or "").strip()
            posted = _parse_netflix_posted_date(p.get("t_create"))

            if not (title and url_full):
                skipped["role"] += 1
                continue

            if not ROLE_RE.search(title):
                skipped["role"] += 1
                continue

            row = normalize(
                "Netflix", title, location, url_full, posted, "netflix",
                "https://explore.jobs.netflix.net/careers",
            )

            if not include_job(row, "Netflix"):
                if row["level"] not in WANTED_LEVELS and not RELAXED_MODE:
                    skipped["level"] += 1
                elif row["region"] not in WANTED_REGIONS and not RELAXED_MODE:
                    skipped["region"] += 1
                else:
                    skipped["company"] += 1
                continue

            out.append(row)

        count = data.get("count", 0)
        if offset + page_size >= count:
            break

    log_info(f"Netflix: {len(out)} matched (skipped role:{skipped['role']} level:{skipped['level']} region:{skipped['region']} company:{skipped['company']})")
    return out

def fetch_ambicuity_newgrad():
    """Fetch ambicuity/New-Grad-Jobs' live JSON feed (refreshed every 5 min upstream)."""
    out = []
    path = DATA_RAW / "ambicuity.json"
    log_info("Fetching ambicuity New-Grad-Jobs...")

    if not fetch_url("https://jobs.riteshrana.engineer/jobs.json", path):
        log_warn("ambicuity fetch failed, skipping")
        return out

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        jobs = data.get("jobs", [])
        log_debug(f"ambicuity returned {len(jobs)} total jobs")
    except Exception as e:
        log_error(f"Error parsing ambicuity feed: {e}")
        return out

    skipped = {"role": 0, "level": 0, "region": 0, "company": 0, "closed": 0}

    for j in jobs:
        if j.get("is_closed"):
            skipped["closed"] += 1
            continue

        company = (j.get("company") or "").strip()
        title = (j.get("title") or "").strip()
        location = (j.get("location") or "Remote").strip()
        url = (j.get("url") or "").strip()
        posted = (j.get("posted_at") or TODAY)[:10]

        if not (company and title and url):
            skipped["role"] += 1
            continue

        if not ROLE_RE.search(title):
            skipped["role"] += 1
            continue

        row = normalize(company, title, location, url, posted, "ambicuity", "https://github.com/ambicuity/New-Grad-Jobs")

        if not include_job(row, company):
            if row["level"] not in WANTED_LEVELS and not RELAXED_MODE:
                skipped["level"] += 1
            elif row["region"] not in WANTED_REGIONS and not RELAXED_MODE:
                skipped["region"] += 1
            else:
                skipped["company"] += 1
            continue

        out.append(row)

    log_info(f"ambicuity: {len(out)} matched (skipped role:{skipped['role']} level:{skipped['level']} region:{skipped['region']} company:{skipped['company']} closed:{skipped['closed']})")
    return out

def dedupe(rows):
    """Remove duplicate entries (by id, company, title)"""
    seen = set()
    out = []
    
    for r in rows:
        k = (r["id"], r["company"].lower(), r["title"].lower()[:60])
        if k in seen:
            log_debug(f"Duplicate removed: {r['company']} - {r['title'][:40]}")
            continue
        seen.add(k)
        out.append(r)
    
    log_info(f"Deduplication: {len(rows)} → {len(out)} jobs")
    return out

def public_job_record(row):
    return {
        "id": row["id"],
        "company": format_company(row["company"]),
        "title": row["title"],
        "level": row["level"],
        "category": row.get("category", ""),
        "region": row.get("region", "unknown"),
        "role_type": row.get("role_type", "other_swe"),
        "country": row["country"],
        "location": _format_location_display(row["location"], row.get("location_details")),
        "remote_type": row["remote_type"],
        "url": row["url"],
        "source": row["source"],
        "source_url": row["source_url"],
        "posted_at": row["posted_at"],
        "age": format_job_age(row),
        "collected_at": row["collected_at"],
        "tags": row["tags"],
    }

def write_outputs(rows):
    write_fetch_outputs(
        rows,
        data_out=DATA_OUT,
        now_iso=NOW_ISO,
        public_job_record=public_job_record,
        job_sort_key=_job_sort_key,
        log_info=log_info,
        log_error=log_error,
        check_url_alive=check_url_alive,
    )


SOURCE_FETCHER_NAMES = [
    "fetch_remotive",
    "fetch_arbeitnow",
    "fetch_simplify_internships",
    "fetch_simplify_newgrad",
    "fetch_speedyapply_swe",
    "fetch_speedyapply_ai",
    "fetch_zapplyjobs_newgrad",
    "fetch_zapplyjobs_all_newgrad",
    "fetch_zapplyjobs_internships",
    "fetch_zapplyjobs_datascience",
    "fetch_zapplyjobs_canada",
    "fetch_zapplyjobs_canada_internships",
    "fetch_vanshb03_summer_internships",
    "fetch_vanshb03_newgrad",
    "fetch_lorenzolacorte_eu",
    "fetch_hanzili_canada",
    "fetch_ambicuity_newgrad",
    "fetch_amazon",
    "fetch_netflix",
]

def _call_fetcher_by_name(name):
    # Looked up via globals() rather than a captured function reference so
    # tests can still patch e.g. fetch.fetch_remotive on the module.
    return globals()[name]()

# Most of these 17 sources (SimplifyJobs, speedyapply, zapplyjobs, vanshb03,
# LorenzoLaCorte, hanzili) are all README files on raw.githubusercontent.com
# — one shared host, same "don't burst too hard against one API" reasoning
# as SHARED_HOST_WORKERS in public_sources.py. Kept a bit higher than that
# cap since this is a CDN serving static files rather than a single
# application server answering paginated queries, but still bounded.
_FETCHER_WORKERS = 6

def _run_fetchers(names):
    """Run each named source fetcher concurrently (they each hit a different
    URL and write to their own cache file, so they're fully independent) and
    concatenate results in the same order the names were given, so output
    stays deterministic regardless of which network call finishes first.
    """
    return run_and_collect(
        _call_fetcher_by_name,
        [(n,) for n in names],
        log_error,
        max_workers=_FETCHER_WORKERS,
        label=lambda args: args[0],
    )

def main():
    global RELAXED_MODE
    log_info("=" * 70)
    log_info("GLOBAL TECH ROLES FETCHER")
    log_info("=" * 70)
    log_info(f"Scope: US, Canada, EMEA, Remote")
    log_info(f"Levels: Internship, New Grad, Junior, Entry, Mid")
    log_info(f"Allowlisted companies: {len(ALLOWLIST)}")
    log_info(f"Timestamp: {NOW_ISO}")
    log_info("=" * 70)

    rows = _run_fetchers(SOURCE_FETCHER_NAMES)
    rows = dedupe(rows)

    if len(rows) == 0:
        log_warn("No jobs found in strict mode. Retrying with relaxed filters...")
        RELAXED_MODE = True
        retry_rows = _run_fetchers(SOURCE_FETCHER_NAMES)
        rows = dedupe(retry_rows)

    if len(rows) == 0:
        log_warn("No jobs found after filtering!")

    write_outputs(rows)

    log_info("=" * 70)
    log_info(f"COMPLETE: {len(rows)} final roles")
    log_info(f"Raw data saved to: {DATA_RAW}")
    log_info(f"Processed data saved to: {DATA_OUT}")
    
    if ERRORS:
        log_warn(f"Encountered {len(ERRORS)} warnings/errors during run")
        for err in ERRORS[:5]:
            log_warn(f"  - {err}")
        if len(ERRORS) > 5:
            log_warn(f"  ... and {len(ERRORS) - 5} more")
    
    log_info("=" * 70)

if __name__ == "__main__":
    main()
