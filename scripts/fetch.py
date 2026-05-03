#!/usr/bin/env python3
"""
Fetch global tech roles from multiple sources, normalize, dedupe, and export.
Sources: Remotive, ArbeitNow, SimplifyJobs (internships & new grad)
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
import traceback
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from patterns import (
    FETCH_COUNTRY_MARK_MAP,
    FETCH_HYBRID_RE,
    FETCH_LEVEL_MAP,
    FETCH_REGION_MAP,
    FETCH_REMOTE_RE,
    FETCH_ROLE_RE,
)
from simplify_jobs_parser import (
    clean_html_text as _clean_html_text,
    format_location_display as _format_location_display,
    parse_simplify_entries,
)
from fetch_outputs import write_fetch_outputs

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

# Load company allowlist
ALLOWLIST_PATH = CONFIG / "companies_allowlist.yml"
ALLOWLIST = []

if not ALLOWLIST_PATH.exists():
    log_error(f"Allowlist not found: {ALLOWLIST_PATH}")
else:
    try:
        for line in ALLOWLIST_PATH.read_text(encoding="utf-8").splitlines():
            s = line.strip()
            if s and not s.startswith("#") and not s.endswith(":"):
                ALLOWLIST.append(s.lstrip("- ").strip().lower())
        log_info(f"Loaded {len(ALLOWLIST)} companies from allowlist")
    except Exception as e:
        log_error(f"Failed to load allowlist: {e}")
        ALLOWLIST = []

LEVEL_MAP = FETCH_LEVEL_MAP
ROLE_RE = FETCH_ROLE_RE
REGION_MAP = FETCH_REGION_MAP
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

def detect_region(location):
    if REMOTE_RE.search(location):
        return "remote"
    for region, rx in REGION_MAP.items():
        if rx.search(location):
            return region
    return "unknown"

def detect_remote_type(location):
    if REMOTE_RE.search(location):
        return "remote"
    if HYBRID_RE.search(location):
        return "hybrid"
    return "onsite" if location.strip() else "unknown"

def detect_country(location):
    for rx, _code, country in COUNTRY_MARK_MAP:
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
    c = company.lower()
    return any(a in c or c in a for a in ALLOWLIST)

def include_job(row, company):
    if not RELAXED_MODE:
        return (
            row["level"] in WANTED_LEVELS
            and is_allowed_company(company)
        )

    level_ok = row["level"] in WANTED_LEVELS or row["level"] == "unknown"
    company_ok = is_allowed_company(company) or row["level"] in {"internship", "new_grad"}
    return level_ok and company_ok

def fetch_url(url, dest, timeout=25):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "tracker-bot/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as response:
            data = response.read()
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

    rows = []
    
    try:
        rows += fetch_remotive()
        rows += fetch_arbeitnow()
        rows += fetch_simplify_internships()
        rows += fetch_simplify_newgrad()
    except Exception as e:
        log_error(f"Unexpected error during fetching: {e}")
        traceback.print_exc()

    rows = dedupe(rows)

    if len(rows) == 0:
        log_warn("No jobs found in strict mode. Retrying with relaxed filters...")
        RELAXED_MODE = True
        retry_rows = []
        try:
            retry_rows += fetch_remotive()
            retry_rows += fetch_arbeitnow()
            retry_rows += fetch_simplify_internships()
            retry_rows += fetch_simplify_newgrad()
        except Exception as e:
            log_error(f"Unexpected error during relaxed retry: {e}")
            traceback.print_exc()
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
