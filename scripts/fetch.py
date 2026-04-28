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
import html
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
    "new_grad": re.compile(r"\b(new.?grad|fresh.?grad|recent.?grad|graduate|campus|early.?career)\b", re.I),
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

WANTED_LEVELS = {
    "internship",
    "new_grad",
    "junior",
    "entry_level",
    "mid_level",
}
WANTED_REGIONS = {"us", "canada", "emea", "remote"}
RELAXED_MODE = False

COUNTRY_MARK_MAP = [
    (re.compile(r"\b(canada|toronto|vancouver|montreal|ottawa|calgary|surrey|brampton|ontario|bc)\b", re.I), "🇨🇦", "Canada"),
    (re.compile(r"\b(united states|usa|\bUS\b|new york|california|texas|washington|seattle|austin|boston|san francisco|los angeles|chicago|denver|atlanta|miami|nyc|fulton|el segundo|san jose|waltham|lehi|sunnyvale)\b", re.I), "🇺🇸", "United States"),
    (re.compile(r"\b(united kingdom|uk|england|london|reading)\b", re.I), "🇬🇧", "United Kingdom"),
    (re.compile(r"\b(germany|berlin|munich|nuremberg|pforzheim|frankfurt|hamburg)\b", re.I), "🇩🇪", "Germany"),
    (re.compile(r"\b(france|paris)\b", re.I), "🇫🇷", "France"),
    (re.compile(r"\b(netherlands|amsterdam)\b", re.I), "🇳🇱", "Netherlands"),
    (re.compile(r"\b(sweden|stockholm)\b", re.I), "🇸🇪", "Sweden"),
    (re.compile(r"\b(ireland|dublin)\b", re.I), "🇮🇪", "Ireland"),
    (re.compile(r"\b(italy|milan|rome)\b", re.I), "🇮🇹", "Italy"),
    (re.compile(r"\b(spain|madrid|barcelona)\b", re.I), "🇪🇸", "Spain"),
    (re.compile(r"\b(portugal|lisbon|porto)\b", re.I), "🇵🇹", "Portugal"),
    (re.compile(r"\b(switzerland|zurich|geneva)\b", re.I), "🇨🇭", "Switzerland"),
    (re.compile(r"\b(poland|warsaw|krakow)\b", re.I), "🇵🇱", "Poland"),
    (re.compile(r"\b(united arab emirates|uae|dubai|abu dhabi)\b", re.I), "🇦🇪", "United Arab Emirates"),
    (re.compile(r"\b(saudi|saudi arabia|riyadh|jeddah)\b", re.I), "🇸🇦", "Saudi Arabia"),
    (re.compile(r"\b(qatar|doha)\b", re.I), "🇶🇦", "Qatar"),
    (re.compile(r"\b(israel|tel aviv|jerusalem)\b", re.I), "🇮🇱", "Israel"),
    (re.compile(r"\b(egypt|cairo|alexandria|giza)\b", re.I), "🇪🇬", "Egypt"),
]

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

def _extract_location_details(value):
    match = re.search(
        r"<details[^>]*>\s*<summary><strong>(\d+)\s+locations?</strong></summary>(.*?)</details>",
        value,
        flags=re.I | re.S,
    )
    if not match:
        return _clean_html_text(value), []

    inner = match.group(2)
    inner = re.sub(r"<br\s*/?>|</br>", "\n", inner, flags=re.I)
    inner = re.sub(r"<[^>]+>", " ", inner)
    inner = html.unescape(inner)
    locations = [part.strip(" \t\r\n-•") for part in inner.split("\n")]
    locations = [part for part in locations if part]
    location_text = " ".join(locations)
    return location_text or _clean_html_text(value), locations

def _format_location_display(location, location_details=None):
    clean_location = re.sub(r"\s+", " ", location.strip())
    if location_details:
        count = len(location_details)
        summary = f"{count} location" if count == 1 else f"{count} locations"
        body = "<br>".join(html.escape(item) for item in location_details)
        return f"<details><summary><strong>{summary}</strong></summary>{body}</details>"

    count_match = re.match(r"^(?P<count>\d+)\s+locations?\s+(?P<rest>.+)$", clean_location, flags=re.I)
    if count_match:
        count = int(count_match.group("count"))
        summary = f"{count} location" if count == 1 else f"{count} locations"
        body = html.escape(count_match.group("rest").strip())
        return f"<details><summary><strong>{summary}</strong></summary>{body}</details>"

    return clean_location

def _job_compare_payload(row):
    return {
        "id": row.get("id"),
        "company": row.get("company"),
        "title": row.get("title"),
        "level": row.get("level"),
        "country": row.get("country"),
        "location": row.get("location"),
        "remote_type": row.get("remote_type"),
        "url": row.get("url"),
        "source": row.get("source"),
        "source_url": row.get("source_url"),
        "tags": row.get("tags"),
    }

def _job_signature(row):
    return json.dumps(_job_compare_payload(row), sort_keys=True, ensure_ascii=False)

def _load_jobs_payload(path):
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    jobs = payload.get("jobs", [])
    return jobs if isinstance(jobs, list) else []

def is_allowed_company(company):
    c = company.lower()
    return any(a in c or c in a for a in ALLOWLIST)

def include_job(row, company):
    if not RELAXED_MODE:
        return (
            row["level"] in WANTED_LEVELS
            and row["region"] in WANTED_REGIONS
            and is_allowed_company(company)
        )

    level_ok = row["level"] in WANTED_LEVELS or row["level"] == "unknown"
    region_ok = row["region"] in WANTED_REGIONS or row["region"] == "unknown"
    company_ok = is_allowed_company(company) or row["level"] in {"internship", "new_grad"}
    return level_ok and region_ok and company_ok

def _clean_html_text(value):
    value = re.sub(r"<br\s*/?>", " ", value, flags=re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    value = html.unescape(value)
    return re.sub(r"\s+", " ", value).strip()

def _extract_markdown_link(value):
    match = re.search(r"\[[^\]]*\]\((https?://[^)]+)\)", value)
    if match:
        return match.group(1).strip()
    match = re.search(r"(https?://\S+)", value)
    if match:
        return match.group(1).strip().rstrip("|")
    return ""

def parse_simplify_entries(content):
    entries = []

    inactive_match = re.search(r"🗃️\s*Inactive roles", content, flags=re.I)
    if inactive_match:
        content = content[:inactive_match.start()]

    # Markdown table rows: | Company | Position | Location | Link |
    for line in content.splitlines():
        line = line.strip()
        if not line.startswith("|") or "http" not in line:
            continue
        parts = [part.strip() for part in line.split("|")[1:-1]]
        if len(parts) < 4:
            continue
        company = _clean_html_text(parts[0])
        title = _clean_html_text(parts[1])
        location = _clean_html_text(parts[2]) or "Remote"
        url = _extract_markdown_link(parts[3])
        if company and title and url:
            entries.append((company, title, location, url, "", []))

    # HTML table rows: <tr><td>...</td>...</tr>
    for row_html in re.findall(r"<tr[^>]*>(.*?)</tr>", content, flags=re.I | re.S):
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row_html, flags=re.I | re.S)
        if len(cells) < 3:
            continue

        texts = [_clean_html_text(cell) for cell in cells]
        company = texts[0]
        title = texts[1] if len(texts) > 1 else ""
        location_cell = cells[2] if len(cells) > 2 else "Remote"
        location, location_details = _extract_location_details(location_cell)
        if not location:
            location = texts[2] if len(texts) > 2 else "Remote"
        age = _clean_html_text(cells[4]) if len(cells) > 4 else ""

        hrefs = re.findall(r"href=\"(https?://[^\"]+)\"", row_html, flags=re.I)
        url = ""
        for href in hrefs:
            if "simplify.jobs/c/" in href:
                continue
            if "simplify.jobs/p/" in href:
                continue
            url = href
            break
        if not url and hrefs:
            url = hrefs[0]

        if company and title and url:
            entries.append((company, title, location, url, age, location_details))

    # Deduplicate parsed entries
    deduped = []
    seen = set()
    for item in entries:
        key = (item[0].lower(), item[1].lower(), item[3])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped

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
    """Write JSON, Markdown, and stats files"""
    rows = sorted(rows, key=lambda x: x["posted_at"], reverse=True)
    public_rows = [public_job_record(row) for row in rows]

    active_file = DATA_OUT / "jobs-global.json"
    archive_file = DATA_OUT / "jobs-global-archive.json"
    previous_active_rows = _load_jobs_payload(active_file)
    previous_archive_rows = _load_jobs_payload(archive_file)
    previous_active_by_id = {row.get("id"): row for row in previous_active_rows if row.get("id")}
    previous_archive_by_id = {row.get("id"): row for row in previous_archive_rows if row.get("id")}

    # Append-only behavior: merge previous active rows with newly fetched rows.
    # Do NOT archive jobs just because they're not present in the current fetch.
    changed = not active_file.exists() or not archive_file.exists()
    # Start with previous active rows, then update/overwrite with current public rows
    merged_by_id = {row.get("id"): dict(row) for row in previous_active_rows if row.get("id")}
    for row in public_rows:
        row_id = row["id"]
        prev = merged_by_id.get(row_id)
        if prev and _job_signature(prev) == _job_signature(row):
            # no structural change for this job
            continue
        merged_by_id[row_id] = dict(row)
        changed = True

    # Preserve previous archive as-is; we do not automatically move missing jobs to archive
    archive_rows = dict(previous_archive_by_id)
    archive_public_rows = sorted(
        archive_rows.values(),
        key=lambda x: x.get("closed_at", x.get("collected_at", "")),
        reverse=True,
    )

    merged_public_rows = list(merged_by_id.values())

    if not changed:
        log_info("No job changes detected; skipping output refresh")
        return

    public_rows = merged_public_rows

    # JSON export
    payload = {"generated_at": NOW_ISO, "total": len(public_rows), "jobs": public_rows}
    try:
        active_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        log_info(f"Exported {active_file}")
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
        "## Stats Snapshot",
        "",
        f"[![{len(public_rows)} roles](https://img.shields.io/badge/roles-{len(public_rows)}-brightgreen.svg)](data/jobs-global-latest.md) [![5 levels](https://img.shields.io/badge/levels-5-blue.svg)](data/jobs-global-latest.md) [![4 sources](https://img.shields.io/badge/sources-4-orange.svg)](README.md#sources)",
        "",
        f"[![Internship {len([r for r in public_rows if r['level'] == 'internship'])}](https://img.shields.io/badge/Internship-{len([r for r in public_rows if r['level'] == 'internship'])}-22c55e.svg)](data/jobs-global-latest.md#internship) [![New Grad {len([r for r in public_rows if r['level'] == 'new_grad'])}](https://img.shields.io/badge/New%20Grad-{len([r for r in public_rows if r['level'] == 'new_grad'])}-0ea5e9.svg)](data/jobs-global-latest.md#new-grad) [![Junior {len([r for r in public_rows if r['level'] == 'junior'])}](https://img.shields.io/badge/Junior-{len([r for r in public_rows if r['level'] == 'junior'])}-f59e0b.svg)](data/jobs-global-latest.md#junior) [![Entry Level {len([r for r in public_rows if r['level'] == 'entry_level'])}](https://img.shields.io/badge/Entry%20Level-{len([r for r in public_rows if r['level'] == 'entry_level'])}-8b5cf6.svg)](data/jobs-global-latest.md#entry-level) [![Mid Level {len([r for r in public_rows if r['level'] == 'mid_level'])}](https://img.shields.io/badge/Mid%20Level-{len([r for r in public_rows if r['level'] == 'mid_level'])}-ef4444.svg)](data/jobs-global-latest.md#mid-level)",
        "",
    ]

    level_sections = [
        ("internship", "Internship"),
        ("new_grad", "New Grad"),
        ("junior", "Junior"),
        ("entry_level", "Entry Level"),
        ("mid_level", "Mid Level"),
    ]

    md_lines.extend([
        "## Browse by Level",
        "",
        "- [Internship](#internship)",
        "- [New Grad](#new-grad)",
        "- [Junior](#junior)",
        "- [Entry Level](#entry-level)",
        "- [Mid Level](#mid-level)",
        "",
    ])

    level_titles = {
        "internship": "Internship",
        "new_grad": "New Grad",
        "junior": "Junior",
        "entry_level": "Entry Level",
        "mid_level": "Mid Level",
    }

    rows_by_level = {level: [] for level, _label in level_sections}
    for row in public_rows:
        rows_by_level.setdefault(row["level"], []).append(row)

    for level, _label in level_sections:
        level_rows = rows_by_level.get(level, [])
        md_lines.extend([
            f"## {level_titles[level]}",
            "",
            f"Total roles: {len(level_rows)}",
            "",
        ])
        if not level_rows:
            md_lines.extend([
                "No roles matched this level today.",
                "",
            ])
            continue

        md_lines.extend([
            "| Company | Title | Location | Age |",
            "|---|---|---|---|",
        ])
        for r in level_rows[:200]:
            company = r["company"].replace("|", " ")
            title = r["title"].replace("|", " ")
            location = r["location"].replace("|", " ")
            age = format_job_age(r).replace("|", " ")
            md_lines.append(
                f"| {company} | [{title}]({r['url']}) | {location} | {age} |"
            )
        md_lines.append("")

    if archive_public_rows:
        md_lines.extend([
            "## Archive",
            "",
            f"Closed roles tracked: {len(archive_public_rows)}",
            "",
            "| Company | Title | Location | Closed |",
            "|---|---|---|---|",
        ])
        for r in archive_public_rows[:200]:
            company = r["company"].replace("|", " ")
            title = r["title"].replace("|", " ")
            location = r["location"].replace("|", " ")
            closed_at = (r.get("closed_at") or r.get("collected_at") or "")[:10]
            md_lines.append(
                f"| {company} | [{title}]({r['url']}) | {location} | {closed_at} |"
            )
        md_lines.append("")
    
    md_file = DATA_OUT / "jobs-global-latest.md"
    try:
        md_file.write_text("\n".join(md_lines) + "\n", encoding="utf-8")
        log_info(f"Exported {md_file}")
    except Exception as e:
        log_error(f"Failed to write markdown: {e}")

    archive_payload = {"generated_at": NOW_ISO, "total": len(archive_public_rows), "jobs": archive_public_rows}
    try:
        archive_file.write_text(json.dumps(archive_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        log_info(f"Exported {archive_file}")
    except Exception as e:
        log_error(f"Failed to write archive JSON: {e}")

    # Stats export
    stats = {
        "generated_at": NOW_ISO,
        "total": len(rows),
        "by_level": dict(Counter(r["level"] for r in rows)),
        "by_country": dict(Counter(r["country"] for r in rows)),
        "by_source": dict(Counter(r["source"] for r in rows)),
    }
    stats_file = DATA_OUT / "stats.json"
    try:
        stats_file.write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
        log_info(f"Exported {stats_file}")
    except Exception as e:
        log_error(f"Failed to write stats: {e}")

    readme_file = ROOT / "README.md"
    level_names = [
        ("internship", "Internship"),
        ("new_grad", "New Grad"),
        ("junior", "Junior"),
        ("entry_level", "Entry Level"),
        ("mid_level", "Mid Level"),
    ]
    if readme_file.exists():
        try:
            readme_text = readme_file.read_text(encoding="utf-8")
            badge_specs = {
                "internship": ("Internship", "22c55e"),
                "new_grad": ("New%20Grad", "0ea5e9"),
                "junior": ("Junior", "f59e0b"),
                "entry_level": ("Entry%20Level", "8b5cf6"),
                "mid_level": ("Mid%20Level", "ef4444"),
            }
            badge_start = "<!-- LEVEL_BADGES_START -->"
            badge_end = "<!-- LEVEL_BADGES_END -->"
            start_marker = "<!-- LEVEL_COUNTS_START -->"
            end_marker = "<!-- LEVEL_COUNTS_END -->"
            readme_text = re.sub(
                r"\[!\[\d+ roles\]\(https://img\.shields\.io/badge/roles-\d+-brightgreen\.svg\)\]",
                f"[![{stats['total']} roles](https://img.shields.io/badge/roles-{stats['total']}-brightgreen.svg)]",
                readme_text,
                count=1,
            )
            if badge_start in readme_text and badge_end in readme_text:
                badges = []
                for level, _label in level_names:
                    badge_label, color = badge_specs[level]
                    badges.append(
                        f"[![{badge_label} {stats['by_level'].get(level, 0)}](https://img.shields.io/badge/{badge_label}-{stats['by_level'].get(level, 0)}-{color}.svg)](data/jobs-global-latest.md#{level.replace('_', '-')})"
                    )
                before, remainder = readme_text.split(badge_start, 1)
                _, after = remainder.split(badge_end, 1)
                updated_readme = before.rstrip() + "\n\n" + badge_start + "\n" + " ".join(badges) + "\n" + badge_end + after
                readme_text = updated_readme
            if start_marker in readme_text and end_marker in readme_text:
                counts_block = [start_marker]
                for level, label in level_names:
                    counts_block.append(f"- {label}: {stats['by_level'].get(level, 0)}")
                counts_block.extend([end_marker, ""])
                before, remainder = readme_text.split(start_marker, 1)
                _, after = remainder.split(end_marker, 1)
                updated_readme = before.rstrip() + "\n\n" + "\n".join(counts_block) + after
                readme_file.write_text(updated_readme, encoding="utf-8")
                log_info(f"Updated {readme_file}")
        except Exception as e:
            log_error(f"Failed to update README counts: {e}")

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
