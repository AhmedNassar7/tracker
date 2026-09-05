#!/usr/bin/env python3
"""Fetch public opportunity sources: hackathons/events and public job boards.

This layer is separate from the main jobs snapshot. It uses public feeds/APIs
to widen coverage:
- Devpost hackathons
- Unstop hackathons
- Devfolio hackathons
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
    PUBLIC_SOFTWARE_ROLE_TYPES,
    detect_region,
    detect_role_type,
)
from simplify_jobs_parser import format_location_display
from company_names import prettify_company_name
from public_outputs import write_public_outputs
from net import check_url_alive, fetch_with_retry, run_and_collect


ROOT = Path(__file__).parent.parent
DATA_OUT = ROOT / "data"

DATA_OUT.mkdir(parents=True, exist_ok=True)

NOW_ISO = datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
TODAY = datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%d")

LEVEL_PATTERNS = PUBLIC_LEVEL_PATTERNS
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
    _status, data = fetch_with_retry(req, timeout)
    return data.decode("utf-8", errors="replace")


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
    _status, data = fetch_with_retry(req, timeout)
    return json.loads(data.decode("utf-8", errors="replace"))


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
                "region": detect_region(location),
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
                "region": detect_region(location),
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
                "region": detect_region(location),
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
                "region": detect_region(location),
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


WORKDAY_LOCATION_COUNT_RE = re.compile(r"^\d+\s+locations?$", re.I)


def fetch_workday_job_locations(host, tenant, site, external_path):
    """Workday's job *listing* endpoint only ever gives a bare count like
    "2 Locations" for a multi-location posting — the actual location names
    live behind a separate per-job detail call. Only worth making for
    postings that hit that bare-count case (most postings are single-location
    and already have a real name from the listing).
    """
    detail_url = f"https://{host}/wday/cxs/{tenant}/{site}{external_path}"
    try:
        detail = fetch_json(detail_url)
    except Exception as exc:
        log_warn(f"Workday location detail fetch failed for {external_path}: {exc}")
        return []

    info = detail.get("jobPostingInfo") or {}
    locations = []
    primary = clean_text(info.get("location") or "")
    if primary:
        locations.append(primary)
    for extra in info.get("additionalLocations") or []:
        extra_clean = clean_text(extra or "")
        if extra_clean:
            locations.append(extra_clean)
    return locations


def fetch_workday_jobs(host, site, company_name, max_pages=5, max_location_lookups=25):
    """Page through the Workday CXS jobs API. The endpoint hard-caps `limit`
    at 20 per request (larger values 400), so wide coverage needs pagination
    rather than one big page like the other board fetchers use.
    """
    tenant = host.split(".")[0]
    api_url = f"https://{host}/wday/cxs/{tenant}/{site}/jobs"
    page_size = 20
    location_lookups = 0

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

            location_details = []
            if WORKDAY_LOCATION_COUNT_RE.match(location) and location_lookups < max_location_lookups:
                location_lookups += 1
                location_details = fetch_workday_job_locations(host, tenant, site, external_path)
            display_location = format_location_display(location, location_details) if location_details else location

            jobs.append(
                {
                    "id": make_id("workday", host, site, title, url),
                    "kind": "job",
                    "company": company_name or prettify_company_name(tenant),
                    "title": title,
                    "location": display_location,
                    "level": detect_level(title),
                    "region": detect_region(display_location),
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
    """Load Ashby/SmartRecruiters/hand-seeded-Greenhouse/hand-seeded-Lever
    company tokens from config/extra_job_boards.yml.

    Ashby and SmartRecruiters have no discovery mechanism at all, so they're
    always curated by hand. Greenhouse/Lever normally auto-discover a
    company's board the first time one of its postings surfaces through an
    existing curated fetcher (see discover_job_board_sources) — but a
    company that never happens to appear that way (e.g. a MENA-region
    company none of the ~17 curated sources, mostly US/EU-focused, ever
    mention) stays invisible indefinitely even when its board is sitting
    right there, publicly pollable. These two sections are the manual
    escape hatch for exactly that case — verified live before adding, same
    discipline as Ashby tokens (curl the board URL and confirm real
    postings, not just a 200).
    Parsed with simple line matching (no YAML dependency), same approach as
    the company allowlist loader in fetch.py.
    """
    path = ROOT / "config" / "extra_job_boards.yml"
    boards = {"ashby": [], "smartrecruiters": [], "greenhouse": [], "lever": []}
    if not path.exists():
        return boards
    section = None
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            # Strip a trailing "# comment" *before* anything else — a
            # comment explaining why a company was added (e.g. "- careem  #
            # verified live 2026-08-18, 231 real postings") would otherwise
            # get swallowed into the token itself, since none of this
            # file's real content ever contains a literal '#'. This also
            # correctly reduces a pure comment line to "", which the
            # empty-line check below already skips.
            stripped = line.split("#", 1)[0].strip()
            if not stripped:
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


def fetch_devpost_hackathons(max_pages=6):
    """Fetch currently-open hackathons from Devpost's own JSON API.

    The hackathons *page* is client-rendered — the server HTML has no
    listings in it at all, only nav chrome — so scraping it was silently
    returning link text like "Participate in our public hackathons" as if
    it were a hackathon title. `devpost.com/api/hackathons` is the real
    endpoint Devpost's own frontend calls; it returns clean, structured,
    already-tech-relevant data (every Devpost hackathon is a build event
    by definition), no relevance filtering needed.
    """
    rows = []
    seen_urls = set()
    for page in range(1, max_pages + 1):
        api_url = f"https://devpost.com/api/hackathons?status[]=open&order_by=recently-added&page={page}"
        try:
            payload = fetch_json(api_url)
        except Exception as exc:
            if page == 1:
                log_warn(f"Devpost fetch failed: {exc}")
            break

        hackathons = payload.get("hackathons", [])
        if not hackathons:
            break

        for item in hackathons:
            title = clean_text(item.get("title") or "")
            url = item.get("url") or ""
            if not (title and url) or url in seen_urls:
                continue
            seen_urls.add(url)
            location = clean_text((item.get("displayed_location") or {}).get("location") or "") or "Various"
            rows.append(
                {
                    "id": make_id("devpost", title, url),
                    "kind": "hackathon",
                    "company": clean_text(item.get("organization_name") or "") or "Devpost",
                    "title": title,
                    "location": location,
                    "date": item.get("time_left_to_submission") or "",
                    "posted_at": TODAY,
                    "url": url,
                    "source": "devpost",
                    "source_url": "https://devpost.com/hackathons",
                }
            )

        total_count = (payload.get("meta") or {}).get("total_count", 0)
        if len(seen_urls) >= total_count:
            break

    return rows


def _format_deadline_from_end(end_dt, now):
    if end_dt is None:
        return ""
    days_left = (end_dt - now).days
    if days_left < 0:
        return "closed"
    if days_left == 0:
        return "last day"
    return f"{days_left} days left"


def fetch_unstop_hackathons(max_pages=10):
    """Fetch currently-recruiting hackathons from Unstop's own public API —
    verified live: a real, free, keyless, paginated JSON endpoint (10
    results/page) covering thousands of hackathons, complementing Devpost's
    catalog rather than duplicating it. `oppstatus=recruiting` narrows to
    ones still accepting registrations; capped at max_pages since the full
    catalog is 6000+ entries and most of it is well past relevant.
    """
    rows = []
    seen_urls = set()
    now = datetime.datetime.now(datetime.UTC)
    api_base = "https://unstop.com/api/public/opportunity/search-result"

    for page in range(1, max_pages + 1):
        api_url = f"{api_base}?opportunity=hackathons&oppstatus=recruiting&page={page}"
        try:
            payload = fetch_json(api_url)
        except Exception as exc:
            if page == 1:
                log_warn(f"Unstop fetch failed: {exc}")
            break

        result = payload.get("data") or {}
        items = result.get("data", [])
        if not items:
            break

        for item in items:
            title = clean_text(item.get("title") or "")
            url = item.get("seo_url") or item.get("public_url") or ""
            if url and not url.startswith("http"):
                url = f"https://unstop.com/{url.lstrip('/')}"
            if not (title and url) or url in seen_urls:
                continue
            seen_urls.add(url)

            organisation = (item.get("organisation") or {}).get("name") or "Unstop"
            region = clean_text(item.get("region") or "")
            location = "Online" if region.lower() == "online" else (region.title() if region else "Various")

            end_dt = None
            try:
                end_dt = datetime.datetime.fromisoformat(item.get("end_date") or "")
            except Exception:
                pass

            rows.append(
                {
                    "id": make_id("unstop", title, url),
                    "kind": "hackathon",
                    "company": clean_text(organisation),
                    "title": title,
                    "location": location,
                    "date": _format_deadline_from_end(end_dt, now),
                    "posted_at": TODAY,
                    "url": url,
                    "source": "unstop",
                    "source_url": "https://unstop.com/hackathons",
                }
            )

        total = result.get("total", 0)
        if page * 10 >= total:
            break

    return rows


def fetch_devfolio_hackathons(max_pages=2):
    """Fetch hackathons from Devfolio's own public API — verified live, real
    JSON, no key. The whole catalog is only `pages` batches (2 today, ~1000
    each), so this pulls all of them and filters to ones that haven't ended
    yet — Devfolio's API doesn't expose a separate "still open" flag the way
    Unstop's regn_open does, so `ends_at` in the future is the signal used.
    """
    rows = []
    seen_urls = set()
    now = datetime.datetime.now(datetime.UTC)

    for page in range(1, max_pages + 1):
        api_url = f"https://api.devfolio.co/api/hackathons?page={page}"
        try:
            payload = fetch_json(api_url)
        except Exception as exc:
            if page == 1:
                log_warn(f"Devfolio fetch failed: {exc}")
            break

        items = payload.get("result", [])
        if not items:
            break

        for item in items:
            end_dt = None
            try:
                end_dt = datetime.datetime.fromisoformat(item.get("ends_at") or "")
            except Exception:
                pass
            if end_dt is None or end_dt < now:
                continue  # already concluded — not worth publishing

            title = clean_text(item.get("name") or "")
            slug = item.get("slug") or ""
            url = f"https://{slug}.devfolio.co" if slug else ""
            if not (title and url) or url in seen_urls:
                continue
            seen_urls.add(url)

            if item.get("is_online"):
                location = "Online"
            else:
                city = clean_text(item.get("city") or "")
                country = clean_text(item.get("country") or "")
                location = ", ".join(part for part in (city, country) if part) or "Various"

            rows.append(
                {
                    "id": make_id("devfolio", title, url),
                    "kind": "hackathon",
                    "company": "Devfolio",
                    "title": title,
                    "location": location,
                    "date": _format_deadline_from_end(end_dt, now),
                    "posted_at": TODAY,
                    "url": url,
                    "source": "devfolio",
                    "source_url": "https://devfolio.co/hackathons",
                }
            )

        total_pages = payload.get("pages", page)
        if page >= total_pages:
            break

    return rows


# Luma's "discover" page is a general community directory, not tech-specific
# — it mixes real dev/AI/startup communities with completely unrelated ones
# (book clubs, walking tours, general design meetups). Keep only entries
# whose visible text signals software/tech/startup relevance.
LUMA_RELEVANT_RE = re.compile(
    r"\b("
    r"tech|software|develop\w*|coding|code|engineer\w*|startup|founder\w*|"
    r"artificial intelligence|\bai\b|machine learning|\bml\b|hackathon\w*|programming|"
    r"open.?source|github|web3|blockchain|data science|cloud|devops|no.?code|"
    r"product manager|builder\w*|computer science"
    r")\b",
    re.I,
)


def parse_luma_discover(html_text):
    rows = []
    seen = set()
    for href, inner in re.findall(r'<a[^>]+href="([^"]+\?k=[^"]+)"[^>]*>(.*?)</a>', html_text, flags=re.I | re.S):
        if "?k=c" not in href:
            continue
        text = clean_text(inner)
        if not text:
            continue
        if not LUMA_RELEVANT_RE.search(text):
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


def _run_concurrently(fn, arg_tuples, max_workers=10):
    """Call fn(*args) for each entry in arg_tuples concurrently and
    concatenate the returned lists, in the same order arg_tuples was given
    (not completion order) so output stays deterministic. Each board/company
    is an independent HTTP call, and the number of auto-discovered boards
    only grows over time, so running them one-by-one doesn't scale.
    """
    return run_and_collect(fn, arg_tuples, log_error, max_workers=max_workers)


def _deadline_days(row):
    """Days until a hackathon/event closes, from its human `date` string
    ("closed" / "last day" / "N days left" / "N days"). Returns a large
    sentinel for anything undated so those sort last, and -1 for an
    already-closed one (callers drop those before sorting).
    """
    hint = (row.get("date") or "").strip().lower()
    if hint in {"closed", "ended", "concluded"}:
        return -1
    if hint in {"last day", "today"}:
        return 0
    match = re.match(r"^(\d+)\s*(d|days?)(\s+left)?$", hint)
    if match:
        return int(match.group(1))
    match = re.search(r"(\d+)\s*days?\s+left", hint)
    if match:
        return int(match.group(1))
    return 10**9


def is_closed_opportunity(row):
    """True for a hackathon/event whose submission window has already passed
    — these should never be published (a user opening one can't enter)."""
    return row.get("kind") in {"hackathon", "event"} and _deadline_days(row) == -1


def sort_key(row):
    kind_rank = {"job": 0, "hackathon": 1, "event": 2}
    kind = row.get("kind") or ""
    if kind == "job":
        date_hint = (row.get("date") or "").strip().lower()
        days_match = re.match(r"^(\d+)d$", date_hint)
        date_rank = int(days_match.group(1)) if days_match else 10**9
    else:
        # Hackathons/events: soonest deadline first so the ones a user can
        # still act on lead the list, undated ones trail.
        date_rank = _deadline_days(row)
        if date_rank < 0:
            date_rank = 10**9
    return (kind_rank.get(kind, 9), date_rank, (row.get("company") or "").lower(), (row.get("title") or "").lower())


def dedupe(rows):
    seen = set()
    out = []
    for row in rows:
        if is_closed_opportunity(row):
            continue
        key = (row.get("kind"), row.get("company"), row.get("title"), row.get("url"))
        if key in seen:
            continue
        seen.add(key)
        out.append(row)
    return out


def write_outputs(rows):
    write_public_outputs(
        rows,
        data_out=DATA_OUT,
        now_iso=NOW_ISO,
        sort_key=sort_key,
        log_info=log_info,
        log_error=log_error,
        check_url_alive=check_url_alive,
        # Shared with fetch.py's run — a URL it just confirmed alive doesn't
        # need re-checking here a minute later.
        link_cache_path=DATA_OUT / "link-cache.json",
    )

def main():
    log_info("=" * 70)
    log_info("PUBLIC OPPORTUNITY SOURCE LAYER")
    log_info("=" * 70)

    rows = []
    seed_jobs = load_seed_jobs()
    greenhouse, lever, workday = discover_job_board_sources(seed_jobs)

    # Hand-curated Greenhouse/Lever tokens (config/extra_job_boards.yml) merge
    # in here, before the fetch calls below — these are boards that would
    # never get auto-discovered above because the company they belong to
    # never happens to appear in any of the other curated sources (see
    # load_extra_job_boards' docstring). setdefault so an auto-discovered
    # entry (a real company name from an actual fetched row) always wins
    # over the config fallback's title-cased guess at the same token.
    extra_boards = load_extra_job_boards()
    for token in extra_boards["greenhouse"]:
        greenhouse.setdefault(token, prettify_company_name(token.replace("-", " ")))
    for token in extra_boards["lever"]:
        lever.setdefault(token, prettify_company_name(token.replace("-", " ")))

    log_info(
        f"Discovered {len(greenhouse)} Greenhouse boards, {len(lever)} Lever boards, "
        f"and {len(workday)} Workday hosts from existing jobs + hand-curated config"
    )

    rows.extend(fetch_devpost_hackathons())
    rows.extend(fetch_unstop_hackathons())
    rows.extend(fetch_devfolio_hackathons())
    rows.extend(fetch_luma_discover())

    # Greenhouse/Lever/Ashby/SmartRecruiters each serve *every* company from
    # one shared API host, so a wide-open worker count risks tripping that
    # host's rate limiting; keep those bursts modest (fetch_with_retry still
    # backs off and retries a 429 if one slips through). Workday is the
    # exception — each company gets its own subdomain, so there's no shared
    # host to be polite to and the higher default concurrency is fine.
    SHARED_HOST_WORKERS = 5

    rows.extend(_run_concurrently(
        fetch_greenhouse_board_jobs, sorted(greenhouse.items()), max_workers=SHARED_HOST_WORKERS,
    ))
    rows.extend(_run_concurrently(
        fetch_lever_jobs, sorted(lever.items()), max_workers=SHARED_HOST_WORKERS,
    ))

    log_info(
        f"Loaded {len(extra_boards['ashby'])} Ashby boards and "
        f"{len(extra_boards['smartrecruiters'])} SmartRecruiters boards from config"
    )
    rows.extend(_run_concurrently(
        fetch_ashby_board_jobs,
        [(token, prettify_company_name(token.replace("-", " "))) for token in extra_boards["ashby"]],
        max_workers=SHARED_HOST_WORKERS,
    ))
    rows.extend(_run_concurrently(
        fetch_smartrecruiters_jobs,
        [(token, prettify_company_name(token.replace("-", " "))) for token in extra_boards["smartrecruiters"]],
        max_workers=SHARED_HOST_WORKERS,
    ))

    rows.extend(_run_concurrently(
        fetch_workday_jobs,
        [(host, site, company) for (host, site), company in sorted(workday.items())],
    ))
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