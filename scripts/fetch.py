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
from collections import Counter

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

# Define career level detection patterns
LEVEL_MAP = {
    "internship": re.compile(r"\b(intern|internship|co.?op)\b", re.I),
    "new_grad": re.compile(r"\b(new.?grad|fresh.?grad|recent.?grad|graduate|campus)\b", re.I),
    "junior": re.compile(r"\b(junior|jr\.?)\b", re.I),
    "entry_level": re.compile(r"\b(entry.?level|associate)\b", re.I),
    "mid_level": re.compile(r"\b(mid.?level|engineer ii|sde2|software engineer 2)\b", re.I),
}

# Software engineering role patterns
ROLE_RE = re.compile(
    r"\b("
    r"software engineer|software developer|sde|full.?stack|frontend|front.?end|backend|back.?end|"
    r"mobile|android|ios|flutter|react native|web developer|python|java|javascript|typescript|"
    r"golang|go developer|c\+\+|c#|dotnet|\.net|node\.?js|devops|platform engineer|site reliability|sre|"
    r"machine learning|ml engineer|data engineer|data scientist|qa engineer|test automation|"
    r"security engineer|cloud engineer|embedded software"
    r")\b",
    re.I,
)

# Geographic region patterns
REGION_MAP = {
    "us": re.compile(
        r"\b(usa|united states|new york|california|texas|washington|seattle|austin|boston|"
        r"san francisco|los angeles|chicago|denver|atlanta|miami)\b",
        re.I,
    ),
    "canada": re.compile(r"\b(canada|toronto|vancouver|montreal|ottawa|calgary)\b", re.I),
    "emea": re.compile(
        r"\b(emea|europe|uk|united kingdom|germany|france|netherlands|spain|portugal|"
        r"poland|sweden|ireland|italy|middle east|uae|egypt|saudi|qatar|israel|london|"
        r"berlin|paris|amsterdam|zurich)\b",
        re.I,
    ),
}

REMOTE_RE = re.compile(r"\b(remote|worldwide|global|fully remote|anywhere)\b", re.I)
HYBRID_RE = re.compile(r"\bhybrid\b", re.I)

WANTED_LEVELS = {"internship", "new_grad", "junior", "entry_level", "mid_level"}
WANTED_REGIONS = {"us", "canada", "emea", "remote"}

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

def is_allowed_company(company):
    c = company.lower()
    return any(a in c or c in a for a in ALLOWLIST)

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

def normalize(company, title, location, url, posted_at, source, source_url):
    return {
        "id": make_id(company, title, url),
        "company": company.strip(),
        "title": title.strip(),
        "level": detect_level(title),
        "region": detect_region(location),
        "country": "REMOTE" if detect_remote_type(location) == "remote" else "UNKNOWN",
        "location": location.strip(),
        "remote_type": detect_remote_type(location),
        "url": url.strip(),
        "source": source,
        "source_url": source_url,
        "posted_at": (posted_at or TODAY)[:10],
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
        
        if row["level"] not in WANTED_LEVELS:
            skipped["level"] += 1
            continue
        if row["region"] not in WANTED_REGIONS:
            skipped["region"] += 1
            continue
        if not is_allowed_company(company):
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
        
        if row["level"] not in WANTED_LEVELS:
            skipped["level"] += 1
            continue
        if row["region"] not in WANTED_REGIONS:
            skipped["region"] += 1
            continue
        if not is_allowed_company(company):
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
        lines = content.split("\n")
        log_debug(f"Internships readme has {len(lines)} lines")
    except Exception as e:
        log_error(f"Error reading internships markdown: {e}")
        return out
    
    skipped = {"role": 0, "level": 0, "region": 0, "company": 0, "parse": 0}
    
    for line in lines:
        if not line.startswith("|") or "http" not in line:
            continue
        
        try:
            parts = [p.strip() for p in line.split("|")]
            if len(parts) < 5:
                skipped["parse"] += 1
                continue
            
            company = parts[1]
            title = parts[2]
            location = parts[3]
            url = parts[4].split("](")[-1].rstrip(")")
            
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
            )
            
            if row["region"] not in WANTED_REGIONS:
                skipped["region"] += 1
                continue
            if not is_allowed_company(company):
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
        lines = content.split("\n")
        log_debug(f"New grad readme has {len(lines)} lines")
    except Exception as e:
        log_error(f"Error reading new grad markdown: {e}")
        return out
    
    skipped = {"role": 0, "level": 0, "region": 0, "company": 0, "parse": 0}
    
    for line in lines:
        if not line.startswith("|") or "http" not in line:
            continue
        
        try:
            parts = [p.strip() for p in line.split("|")]
            if len(parts) < 5:
                skipped["parse"] += 1
                continue
            
            company = parts[1]
            title = parts[2]
            location = parts[3]
            url = parts[4].split("](")[-1].rstrip(")")
            
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
            )
            
            if row["region"] not in WANTED_REGIONS:
                skipped["region"] += 1
                continue
            if not is_allowed_company(company):
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

def write_outputs(rows):
    """Write JSON, Markdown, and stats files"""
    rows = sorted(rows, key=lambda x: x["posted_at"], reverse=True)

    # JSON export
    payload = {"generated_at": NOW_ISO, "total": len(rows), "jobs": rows}
    json_file = DATA_OUT / "jobs-global.json"
    try:
        json_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        log_info(f"Exported {json_file}")
    except Exception as e:
        log_error(f"Failed to write JSON: {e}")

    # Markdown export
    md_lines = [
        f"# Global Tech Roles Snapshot ({TODAY})",
        "",
        f"**Total matching roles:** {len(rows)}",
        "",
        "**Scope:** US, Canada, EMEA (+ remote) | **Levels:** Internship/New Grad/Junior/Entry/Mid | **Companies:** Top-tier allowlist only",
        "",
        "| Company | Title | Level | Region | Location | Posted | Source |",
        "|---|---|---|---|---|---|---|",
    ]
    
    for r in rows[:200]:
        title = r["title"].replace("|", " ")
        company = r["company"].replace("|", " ")
        location = r["location"].replace("|", " ")
        md_lines.append(
            f"| {company} | [{title}]({r['url']}) | {r['level']} | {r['region']} | {location} | {r['posted_at']} | [{r['source']}]({r['source_url']}) |"
        )
    
    md_file = DATA_OUT / "jobs-global-latest.md"
    try:
        md_file.write_text("\n".join(md_lines) + "\n", encoding="utf-8")
        log_info(f"Exported {md_file}")
    except Exception as e:
        log_error(f"Failed to write markdown: {e}")

    # Stats export
    stats = {
        "generated_at": NOW_ISO,
        "total": len(rows),
        "by_level": dict(Counter(r["level"] for r in rows)),
        "by_region": dict(Counter(r["region"] for r in rows)),
        "by_source": dict(Counter(r["source"] for r in rows)),
    }
    stats_file = DATA_OUT / "stats.json"
    try:
        stats_file.write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
        log_info(f"Exported {stats_file}")
    except Exception as e:
        log_error(f"Failed to write stats: {e}")

def main():
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
