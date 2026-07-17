#!/usr/bin/env python3
"""Fetch public opportunity sources: hackathons/events and public job boards.

This layer is separate from the main jobs snapshot. It uses public feeds/APIs
to widen coverage:
- Devpost hackathons
- Luma discovery pages
- Greenhouse public job board API (auto-discovered from existing job URLs)
- Lever public postings JSON (auto-discovered from existing job URLs)
- Workday CXS jobs API (auto-discovered from existing job URLs)
- Ashby public job board API (companies listed in config/extra_job_boards.yml)
- SmartRecruiters public postings API (companies listed in config/extra_job_boards.yml)
"""

from __future__ import annotations

import datetime
import hashlib
import html
import json
import re
import sys
import traceback
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from patterns import (
    PUBLIC_LEVEL_PATTERNS,
    PUBLIC_NON_SOFTWARE_TITLE_PATTERNS,
    PUBLIC_ROLE_PATTERNS,
    PUBLIC_SOFTWARE_ROLE_TYPES,
)
from public_outputs import write_public_outputs


ROOT = Path(__file__).parent.parent
DATA_OUT = ROOT / "data"

DATA_OUT.mkdir(parents=True, exist_ok=True)

NOW_ISO = datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
TODAY = datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%d")

LEVEL_PATTERNS = PUBLIC_LEVEL_PATTERNS
ROLE_PATTERNS = PUBLIC_ROLE_PATTERNS
SOFTWARE_ROLE_TYPES = PUBLIC_SOFTWARE_ROLE_TYPES
NON_SOFTWARE_TITLE_PATTERNS = PUBLIC_NON_SOFTWARE_TITLE_PATTERNS


def log_info(msg):
    print(f"[INFO] {msg}", file=sys.stdout, flush=True)


def log_warn(msg):
    print(f"[WARN] {msg}", file=sys.stderr, flush=True)


def log_error(msg):
    print(f"[ERROR] {msg}", file=sys.stderr, flush=True)


def fetch_url(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": "tracker-bot/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def clean_text(value):
    value = re.sub(r"<br\s*/?>", " ", value, flags=re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    value = html.unescape(value)
    return re.sub(r"\s+", " ", value).strip()


def make_id(*parts):
    raw = "|".join((part or "").lower() for part in parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def parse_iso_date(value):
    if not value:
        return ""
    try:
        return datetime.date.fromisoformat(value[:10]).isoformat()
    except Exception:
        return ""


def format_age_from_date(date_text):
    if not date_text:
        return ""
    try:
        date_obj = datetime.date.fromisoformat(date_text[:10])
    except Exception:
        return ""
    age_days = max((datetime.datetime.now(datetime.UTC).date() - date_obj).days, 0)
    return f"{age_days}d"


def detect_level(title):
    for level, rx in LEVEL_PATTERNS.items():
        if rx.search(title):
            return level
    return "other"


def detect_role_type(title):
    if ROLE_PATTERNS["full_stack"].search(title):
        return "full_stack"
    if ROLE_PATTERNS["backend"].search(title):
        return "backend"
    if ROLE_PATTERNS["frontend"].search(title):
        return "frontend"
    if ROLE_PATTERNS["mobile"].search(title):
        return "mobile"
    if ROLE_PATTERNS["platform"].search(title):
        return "platform"
    if ROLE_PATTERNS["infrastructure"].search(title):
        return "infrastructure"
    if ROLE_PATTERNS["security"].search(title):
        return "security"
    if ROLE_PATTERNS["machine_learning"].search(title):
        return "machine_learning"
    if ROLE_PATTERNS["software_engineer"].search(title):
        return "software_engineer"
    return "other_swe"


def is_software_job(title):
    title_text = title or ""
    for pattern in NON_SOFTWARE_TITLE_PATTERNS:
        if pattern.search(title_text):
            return False
    role_type = detect_role_type(title_text)
    return role_type in SOFTWARE_ROLE_TYPES


def fetch_json(url):
    return json.loads(fetch_url(url))


def fetch_json_post(url, payload, timeout=25):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "User-Agent": "tracker-bot/1.0",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8", errors="replace"))


def extract_greenhouse_board_token(job_url):
    parsed = urlparse(job_url)
    host = parsed.netloc.lower()
    path_parts = [part for part in parsed.path.split("/") if part]
    if "greenhouse.io" not in host:
        return ""
    if host.startswith("job-boards.greenhouse.io") and path_parts:
        return path_parts[0]
    if host.startswith("boards.greenhouse.io") and path_parts:
        return path_parts[0]
    if host.startswith("boards-api.greenhouse.io"):
        try:
            board_index = path_parts.index("boards")
            return path_parts[board_index + 1]
        except Exception:
            return ""
    return ""


def extract_lever_slug(job_url):
    parsed = urlparse(job_url)
    host = parsed.netloc.lower()
    if "lever.co" not in host:
        return ""
    path_parts = [part for part in parsed.path.split("/") if part]
    if len(path_parts) >= 1:
        return path_parts[0]
    return ""


WORKDAY_LOCALE_RE = re.compile(r"^[a-z]{2}(-[A-Za-z]{2})?$")


def extract_workday_site(job_url):
    """Return (host, site) for a Workday-hosted job URL, e.g.
    "nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/..." ->
    ("nvidia.wd5.myworkdayjobs.com", "NVIDIAExternalCareerSite"). The tenant
    used by the CXS API is the host's first label ("nvidia").

    Some tenants (observed on Intel, Sony) prefix the site with a locale
    segment instead, e.g. ".../en-US/SonyGlobalCareers/job/..." — treating
    "en-US" itself as the site 404s, so a locale-shaped first segment is
    skipped in favor of the one after it.
    """
    parsed = urlparse(job_url)
    host = parsed.netloc.lower()
    if "workdayjobs.com" not in host:
        return "", ""
    path_parts = [part for part in parsed.path.split("/") if part]
    if not path_parts:
        return "", ""
    site = path_parts[0]
    if WORKDAY_LOCALE_RE.match(site) and len(path_parts) > 1:
        site = path_parts[1]
    return host, site


def load_seed_jobs():
    path = DATA_OUT / "jobs-global.json"
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    jobs = payload.get("jobs", [])
    return jobs if isinstance(jobs, list) else []


def discover_job_board_sources(seed_jobs):
    greenhouse = {}
    lever = {}
    workday = {}
    for row in seed_jobs:
        url = row.get("url") or ""
        company = row.get("company") or ""
        greenhouse_token = extract_greenhouse_board_token(url)
        if greenhouse_token:
            greenhouse[greenhouse_token] = company
            continue
        lever_slug = extract_lever_slug(url)
        if lever_slug:
            lever[lever_slug] = company
            continue
        workday_host, workday_site = extract_workday_site(url)
        if workday_host and workday_site:
            workday[(workday_host, workday_site)] = company
    return greenhouse, lever, workday


def fetch_greenhouse_board_jobs(board_token, company_name):
    api_url = f"https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true"
    try:
        payload = fetch_json(api_url)
    except Exception as exc:
        log_warn(f"Greenhouse fetch failed for {board_token}: {exc}")
        return []

    jobs = []
    for item in payload.get("jobs", []):
        title = clean_text(item.get("title") or "")
        location = clean_text((item.get("location") or {}).get("name") or "")
        url = item.get("absolute_url") or ""
        posted_at = parse_iso_date(item.get("updated_at") or "")
        if not (title and url) or not is_software_job(title):
            continue
        jobs.append(
            {
                "id": make_id("greenhouse", board_token, title, url),
                "kind": "job",
                "company": company_name or board_token,
                "title": title,
                "location": location,
                "level": detect_level(title),
                "role_type": detect_role_type(title),
                "date": format_age_from_date(posted_at),
                "posted_at": posted_at,
                "url": url,
                "source": f"greenhouse:{board_token}",
                "source_url": api_url,
            }
        )
    return jobs


def fetch_lever_jobs(company_slug, company_name):
    api_url = f"https://api.lever.co/v0/postings/{company_slug}?mode=json"
    try:
        payload = fetch_json(api_url)
    except Exception as exc:
        log_warn(f"Lever fetch failed for {company_slug}: {exc}")
        return []

    jobs = []
    for item in payload:
        title = clean_text(item.get("text") or item.get("title") or "")
        categories = item.get("categories") or {}
        location = clean_text(categories.get("location") or item.get("categories", {}).get("location") or "")
        url = item.get("hostedUrl") or item.get("applyUrl") or item.get("url") or ""
        created_at = item.get("createdAt") or item.get("created_at") or 0
        try:
            posted_at = datetime.datetime.fromtimestamp(int(created_at) / 1000, tz=datetime.UTC).date().isoformat()
        except Exception:
            posted_at = ""
        if not (title and url) or not is_software_job(title):
            continue
        jobs.append(
            {
                "id": make_id("lever", company_slug, title, url),
                "kind": "job",
                "company": company_name or company_slug,
                "title": title,
                "location": location,
                "level": detect_level(title),
                "role_type": detect_role_type(title),
                "date": format_age_from_date(posted_at),
                "posted_at": posted_at,
                "url": url,
                "source": f"lever:{company_slug}",
                "source_url": api_url,
            }
        )
    return jobs


def fetch_ashby_board_jobs(board_token, company_name):
    api_url = f"https://api.ashbyhq.com/posting-api/job-board/{board_token}"
    try:
        payload = fetch_json(api_url)
    except Exception as exc:
        log_warn(f"Ashby fetch failed for {board_token}: {exc}")
        return []

    jobs = []
    for item in payload.get("jobs", []):
        if item.get("isListed") is False:
            continue
        title = clean_text(item.get("title") or "")
        location = clean_text(item.get("location") or "")
        url = item.get("jobUrl") or item.get("applyUrl") or ""
        posted_at = parse_iso_date(item.get("publishedAt") or "")
        if not (title and url) or not is_software_job(title):
            continue
        jobs.append(
            {
                "id": make_id("ashby", board_token, title, url),
                "kind": "job",
                "company": company_name or board_token,
                "title": title,
                "location": location,
                "level": detect_level(title),
                "role_type": detect_role_type(title),
                "date": format_age_from_date(posted_at),
                "posted_at": posted_at,
                "url": url,
                "source": f"ashby:{board_token}",
                "source_url": api_url,
            }
        )
    return jobs


def fetch_smartrecruiters_jobs(company_slug, company_name):
    api_url = f"https://api.smartrecruiters.com/v1/companies/{company_slug}/postings?limit=100"
    try:
        payload = fetch_json(api_url)
    except Exception as exc:
        log_warn(f"SmartRecruiters fetch failed for {company_slug}: {exc}")
        return []

    jobs = []
    for item in payload.get("content", []):
        title = clean_text(item.get("name") or "")
        location_info = item.get("location") or {}
        full_location = location_info.get("fullLocation") or ""
        location = clean_text(", ".join(part.strip() for part in full_location.split(",") if part.strip()))
        if not location:
            location_parts = [location_info.get("city"), location_info.get("region"), location_info.get("country")]
            location = clean_text(", ".join(part for part in location_parts if part))
        if location_info.get("remote") and "remote" not in location.lower():
            location = f"{location} (Remote)".strip()
        posting_id = item.get("id") or ""
        url = f"https://jobs.smartrecruiters.com/{company_slug}/{posting_id}" if posting_id else ""
        posted_at = parse_iso_date(item.get("releasedDate") or "")
        if not (title and url) or not is_software_job(title):
            continue
        jobs.append(
            {
                "id": make_id("smartrecruiters", company_slug, title, url),
                "kind": "job",
                "company": company_name or company_slug,
                "title": title,
                "location": location,
                "level": detect_level(title),
                "role_type": detect_role_type(title),
                "date": format_age_from_date(posted_at),
                "posted_at": posted_at,
                "url": url,
                "source": f"smartrecruiters:{company_slug}",
                "source_url": api_url,
            }
        )
    return jobs


def parse_workday_posted_on(text):
    """Workday only exposes fuzzy relative dates ("Posted Today", "Posted
    3 Days Ago", "Posted 30+ Days Ago") rather than a timestamp, so this
    returns an age string directly instead of a parseable date.
    """
    text = (text or "").strip().lower()
    if not text:
        return ""
    if "today" in text:
        return "0d"
    if "yesterday" in text:
        return "1d"
    match = re.search(r"(\d+)\+?\s*day", text)
    if match:
        return f"{match.group(1)}d"
    return ""


def fetch_workday_jobs(host, site, company_name, max_pages=5):
    """Page through the Workday CXS jobs API. The endpoint hard-caps `limit`
    at 20 per request (larger values 400), so wide coverage needs pagination
    rather than one big page like the other board fetchers use.
    """
    tenant = host.split(".")[0]
    api_url = f"https://{host}/wday/cxs/{tenant}/{site}/jobs"
    page_size = 20

    jobs = []
    for page in range(max_pages):
        payload = {"appliedFacets": {}, "limit": page_size, "offset": page * page_size, "searchText": ""}
        try:
            result = fetch_json_post(api_url, payload)
        except Exception as exc:
            if page == 0:
                log_warn(f"Workday fetch failed for {host}/{site}: {exc}")
            break

        postings = result.get("jobPostings", [])
        if not postings:
            break

        for item in postings:
            title = clean_text(item.get("title") or "")
            location = clean_text(item.get("locationsText") or "")
            external_path = item.get("externalPath") or ""
            if not (title and external_path) or not is_software_job(title):
                continue
            url = f"https://{host}/{site}{external_path}"
            jobs.append(
                {
                    "id": make_id("workday", host, site, title, url),
                    "kind": "job",
                    "company": company_name or tenant.title(),
                    "title": title,
                    "location": location,
                    "level": detect_level(title),
                    "role_type": detect_role_type(title),
                    "date": parse_workday_posted_on(item.get("postedOn") or ""),
                    "posted_at": "",
                    "url": url,
                    "source": f"workday:{tenant}",
                    "source_url": api_url,
                }
            )

        if len(postings) < page_size:
            break

    return jobs


def load_extra_job_boards():
    """Load Ashby/SmartRecruiters company tokens from config/extra_job_boards.yml.

    These platforms can't be auto-discovered from existing job URLs the way
    Greenhouse/Lever tokens can, so they're curated by hand in that file.
    Parsed with simple line matching (no YAML dependency), same approach as
    the company allowlist loader in fetch.py.
    """
    path = ROOT / "config" / "extra_job_boards.yml"
    boards = {"ashby": [], "smartrecruiters": []}
    if not path.exists():
        return boards
    section = None
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            if stripped.endswith(":") and not stripped.startswith("-"):
                section = stripped[:-1].strip().lower()
                continue
            if stripped.startswith("-") and section in boards:
                token = stripped.lstrip("- ").strip()
                if token:
                    boards[section].append(token)
    except Exception as exc:
        log_warn(f"Failed to load extra job boards config: {exc}")
    return boards


def parse_devpost_hackathons(html_text):
    matches = re.findall(r'<a[^>]+href="([^"]*devpost\.com[^"]*)"[^>]*>(.*?)</a>', html_text, flags=re.I | re.S)
    rows = []
    seen = set()
    for href, inner in matches:
        parsed = urlparse(href)
        text = clean_text(inner)
        if not text:
            continue
        if not parsed.netloc.endswith("devpost.com"):
            continue
        if "info.devpost.com" in href.lower():
            continue
        if "ref_feature=challenge" not in href and "hackathon" not in text.lower():
            continue
        if not any(token in text.lower() for token in ["days left", "participants", "prizes", "hackathon", "challenge"]):
            continue
        title = text
        for marker in [r"\s+\d+\s+days? left.*$", r"\s+about\s+\d+\s+months? left.*$", r"\s+\d+\s+participants.*$", r"\s+\$[\d,]+\s+in prizes.*$", r"\s+\d+\s+non-cash prizes.*$", r"\s+\d{1,2}\s+[A-Z][a-z]{2}\s*-\s*[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}.*$"]:
            title = re.sub(marker, "", title, flags=re.I)
        title = re.sub(r"^(Online|Hybrid|In-person)\s+", "", title, flags=re.I)
        title = title.strip(" -|")
        if not title:
            continue
        key = href.lower()
        if key in seen:
            continue
        seen.add(key)
        timeline_match = re.search(r"(\d+\s+days? left|about\s+\d+\s+months? left|[A-Z][a-z]{2}\s+\d{1,2}\s*-\s*[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})", text)
        timeline = timeline_match.group(1) if timeline_match else ""
        location = "Online" if re.search(r"\bonline\b", text, flags=re.I) else "Various"
        rows.append(
            {
                "id": make_id("devpost", title, href),
                "kind": "hackathon",
                "company": "Devpost",
                "title": title,
                "location": location,
                "date": timeline,
                "posted_at": TODAY,
                "url": href,
                "source": "devpost",
                "source_url": "https://devpost.com/hackathons",
            }
        )
    return rows


def fetch_devpost_events():
    try:
        html_text = fetch_url("https://devpost.com/hackathons")
    except Exception as exc:
        log_warn(f"Devpost fetch failed: {exc}")
        return []
    return parse_devpost_hackathons(html_text)


def parse_luma_discover(html_text):
    rows = []
    seen = set()
    for href, inner in re.findall(r'<a[^>]+href="([^"]+\?k=[^"]+)"[^>]*>(.*?)</a>', html_text, flags=re.I | re.S):
        if "?k=c" not in href:
            continue
        text = clean_text(inner)
        if not text:
            continue
        title = re.sub(r"^Avatar for\s+", "", text, flags=re.I)
        title = re.sub(r"\s+Subscribe\s+", " ", title, flags=re.I)
        title = re.sub(r"\s+\d+[KkMm]?\s+Events.*$", "", title)
        title = title.strip()
        if len(title) < 3:
            continue
        key = href.lower()
        if key in seen:
            continue
        seen.add(key)
        rows.append(
            {
                "id": make_id("luma", title, href),
                "kind": "event",
                "company": "Luma",
                "title": title,
                "location": "Global",
                "date": "",
                "posted_at": TODAY,
                "url": href,
                "source": "luma",
                "source_url": "https://luma.com/discover",
            }
        )
    return rows


def fetch_luma_discover():
    try:
        html_text = fetch_url("https://luma.com/discover")
    except Exception as exc:
        log_warn(f"Luma fetch failed: {exc}")
        return []
    return parse_luma_discover(html_text)


def sort_key(row):
    kind_rank = {"job": 0, "hackathon": 1, "event": 2}
    date_hint = (row.get("date") or "").strip().lower()
    days_match = re.match(r"^(\d+)d$", date_hint)
    if days_match:
        date_rank = int(days_match.group(1))
    else:
        date_rank = 10**9
    return (kind_rank.get(row.get("kind") or "", 9), date_rank, (row.get("company") or "").lower(), (row.get("title") or "").lower())


def dedupe(rows):
    seen = set()
    out = []
    for row in rows:
        key = (row.get("kind"), row.get("company"), row.get("title"), row.get("url"))
        if key in seen:
            continue
        seen.add(key)
        out.append(row)
    return out


def write_outputs(rows):
    write_public_outputs(rows, data_out=DATA_OUT, now_iso=NOW_ISO, sort_key=sort_key, log_info=log_info)

def main():
    log_info("=" * 70)
    log_info("PUBLIC OPPORTUNITY SOURCE LAYER")
    log_info("=" * 70)

    rows = []
    seed_jobs = load_seed_jobs()
    greenhouse, lever, workday = discover_job_board_sources(seed_jobs)

    log_info(
        f"Discovered {len(greenhouse)} Greenhouse boards, {len(lever)} Lever boards, "
        f"and {len(workday)} Workday hosts from existing jobs"
    )

    rows.extend(fetch_devpost_events())
    rows.extend(fetch_luma_discover())

    for board_token, company in sorted(greenhouse.items()):
        rows.extend(fetch_greenhouse_board_jobs(board_token, company))

    for company_slug, company in sorted(lever.items()):
        rows.extend(fetch_lever_jobs(company_slug, company))

    extra_boards = load_extra_job_boards()
    log_info(
        f"Loaded {len(extra_boards['ashby'])} Ashby boards and "
        f"{len(extra_boards['smartrecruiters'])} SmartRecruiters boards from config"
    )
    for token in extra_boards["ashby"]:
        rows.extend(fetch_ashby_board_jobs(token, token.replace("-", " ").title()))
    for token in extra_boards["smartrecruiters"]:
        rows.extend(fetch_smartrecruiters_jobs(token, token.replace("-", " ").title()))

    for (host, site), company in sorted(workday.items()):
        rows.extend(fetch_workday_jobs(host, site, company))
    if workday:
        log_info(f"Fetched Workday postings from {len(workday)} discovered host(s)")

    rows = dedupe(rows)
    write_outputs(rows)

    log_info("=" * 70)
    log_info(f"COMPLETE: {len(rows)} public opportunities")
    log_info("=" * 70)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        log_error(f"Unexpected error: {exc}")
        traceback.print_exc()
        raise SystemExit(1)