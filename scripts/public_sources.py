#!/usr/bin/env python3
"""Fetch public opportunity sources: hackathons/events and public job boards.

This layer is separate from the main jobs snapshot. It uses public feeds/APIs
to widen coverage:
- Devpost hackathons
- Unstop hackathons
- Devfolio hackathons
- HackerEarth hackathons / hiring challenges
- Luma discovery pages
- Curated tech/career events (hand-maintained in config/events.yml)
- confs.tech's open conference-data JSON (github.com/tech-conferences/conference-data) —
  OSS/dev-community conferences across a curated set of topics
- Greenhouse public job board API (auto-discovered from existing job URLs)
- Lever public postings JSON (auto-discovered from existing job URLs)
- Workday CXS jobs API (auto-discovered from existing job URLs)
- Ashby public job board API (companies listed in config/extra_job_boards.yml)
- SmartRecruiters public postings API (companies listed in config/extra_job_boards.yml)
- PinpointHQ public postings (companies listed in config/extra_job_boards.yml)
- Workable public job board widget API (companies listed in config/extra_job_boards.yml)
"""

from __future__ import annotations

import datetime
import hashlib
import html
import json
import re
import sys
import traceback
import urllib.error
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
    detect_level as _detect_level,
    detect_region,
    detect_role_type,
    extract_job_facets,
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


# Cap the description text handed to the regex detectors — a few ATS
# descriptions run to tens of KB and the facet regexes scan the whole blob
# per job; the signals we look for (skills list, a "visa sponsorship" line, a
# pay range) are always near the top of a posting anyway.
_FACET_DESC_CAP = 20000


def job_facets(title, location, description=""):
    """Merge-ready dict of the B3/B4/B5 facets (tech_tags / visa_sponsorship /
    degree_required / relocation / salary) from whatever posting text a source
    exposes. Strict-positive — see scripts/patterns.py. ``record.update(...)``
    is always safe: only keys the text is explicit about are returned."""
    return extract_job_facets(title, location, (description or "")[:_FACET_DESC_CAP])


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
    # Shared, senior-aware resolver (scripts/patterns.py). Public layer's
    # unmatched default is "other" (not "unknown"), per PublicEntry's enum.
    return _detect_level(title, LEVEL_PATTERNS, default="other")


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
        # `?content=true` gives HTML-entity-encoded HTML — unescape then strip.
        description = clean_text(html.unescape(item.get("content") or ""))
        job = {
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
        job.update(job_facets(title, location, description))
        jobs.append(job)
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
        # Lever gives plain-text `descriptionPlain` plus structured `lists`
        # (requirements / responsibilities) with HTML `content`.
        desc_parts = [item.get("descriptionPlain") or clean_text(item.get("description") or "")]
        for lst in item.get("lists") or []:
            desc_parts.append(clean_text(lst.get("text") or ""))
            desc_parts.append(clean_text(lst.get("content") or ""))
        description = " ".join(p for p in desc_parts if p)
        job = {
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
        job.update(job_facets(title, location, description))
        jobs.append(job)
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
        description = item.get("descriptionPlain") or clean_text(item.get("descriptionHtml") or "")
        job = {
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
        job.update(job_facets(title, location, description))
        jobs.append(job)
    return jobs


def _pinpoint_company_from_host(host):
    """'tabby.pinpointhq.com' -> 'tabby';  'careers.moneyfellows.com' ->
    'moneyfellows' (the registrable domain's second-level label)."""
    parts = host.split(".")
    if "pinpointhq" in parts:
        return parts[0]
    return parts[-2] if len(parts) >= 2 else parts[0]


def _pinpoint_location(item):
    """Location string from a PinpointHQ posting. Pinpoint doesn't put a
    single flat 'location' on the posting — it's nested under `job` (an object
    or a custom-group), and shapes vary between tenants — so try the paths
    seen in the wild and take the first non-empty one. An empty result just
    means region/country stay 'unknown' for that row, not that it's dropped.
    """
    job = item.get("job") or {}
    candidates = [
        item.get("location_name"), item.get("location"),
        job.get("location_name"), job.get("location"),
        (job.get("location") or {}).get("name") if isinstance(job.get("location"), dict) else None,
        (item.get("location") or {}).get("name") if isinstance(item.get("location"), dict) else None,
    ]
    # Pinpoint tenants often stash the office in a "structure_custom_group_*"
    # slot titled "Location" / "Office" / "City".
    for grp in ("structure_custom_group_one", "structure_custom_group_two", "structure_custom_group_three"):
        g = job.get(grp) or item.get(grp) or {}
        if isinstance(g, dict) and (g.get("title") or "").lower() in ("location", "office", "city", "country"):
            candidates.append(g.get("name"))
    for locs_key in ("locations", "job_locations"):
        arr = item.get(locs_key) or job.get(locs_key)
        if isinstance(arr, list) and arr:
            names = [x.get("name") if isinstance(x, dict) else x for x in arr]
            candidates.append(", ".join(n for n in names if n))
    for c in candidates:
        if isinstance(c, str) and c.strip():
            return clean_text(c)
    return ""


def fetch_pinpoint_jobs(host, company_name):
    """PinpointHQ public postings — `https://<host>/postings.json` returns a
    bare list of posting objects (confirmed 2026-09-06 against tabby.pinpointhq
    .com / careers.moneyfellows.com). `host` is either `<company>.pinpointhq
    .com` or a custom careers domain.

    Known posting fields: id, title, url, employment_type[_text],
    workplace_type[_text] (onsite|remote|hybrid), description / key_
    responsibilities / skills_knowledge_expertise (HTML), compensation_* ,
    job:{department:{name}, division:{name}}. Location + posted-date field
    names still vary — see _pinpoint_location and the date fallbacks below.
    """
    api_url = f"https://{host}/postings.json"
    try:
        payload = fetch_json(api_url)
    except Exception as exc:
        log_warn(f"Pinpoint fetch failed for {host}: {exc}")
        return []

    postings = payload if isinstance(payload, list) else (payload.get("data") or payload.get("postings") or [])
    jobs = []
    for item in postings:
        title = clean_text(item.get("title") or "")
        url = item.get("url") or ""
        if not (title and url) or not is_software_job(title):
            continue
        location = _pinpoint_location(item)
        posted_at = ""
        for date_key in ("first_published_at", "published_at", "created_at", "live_at", "updated_at"):
            posted_at = parse_iso_date(item.get(date_key) or "")
            if posted_at:
                break
        # Region from the office location itself (so a Dubai-based "remote"
        # role still counts as MENA); the "(Remote)" tag is display-only.
        region = detect_region(location)
        wt = (item.get("workplace_type") or "").lower()
        if wt == "remote" and "remote" not in location.lower():
            location = (location + " (Remote)").strip() if location else "Remote"
            if region == "unknown":
                region = "remote"
        description = clean_text(html.unescape(" ".join(filter(None, (
            item.get("description"), item.get("key_responsibilities"), item.get("skills_knowledge_expertise"),
        )))))
        job = {
            "id": make_id("pinpoint", host, title, url),
            "kind": "job",
            "company": company_name or _pinpoint_company_from_host(host),
            "title": title,
            "location": location,
            "level": detect_level(title),
            "region": region,
            "role_type": detect_role_type(title),
            "date": format_age_from_date(posted_at),
            "posted_at": posted_at,
            "url": url,
            "source": f"pinpoint:{host}",
            "source_url": api_url,
        }
        job.update(job_facets(title, location, description))
        jobs.append(job)
    return jobs


def _workable_locations(item):
    """De-duped 'City, Country' strings for a Workable posting. A job has flat
    country/city/state fields plus a `locations` array (each {country, city,
    region, countryCode}); the array is authoritative for multi-location
    postings, the flat fields are the fallback. Returns the ordered list
    (first = primary) — [] just means region/country stay 'unknown'."""
    entries = item.get("locations") or []
    if not entries:
        entries = [{"city": item.get("city"), "country": item.get("country")}]
    out = []
    for loc in entries:
        if not isinstance(loc, dict):
            continue
        text = clean_text(", ".join(p for p in (loc.get("city"), loc.get("country")) if p))
        if text and text not in out:
            out.append(text)
    return out


def fetch_workable_jobs(account_token, company_name):
    """Workable public job board — `https://apply.workable.com/api/v1/widget/
    accounts/<account>?details=true` returns {name, description, jobs:[...]}
    with the full HTML job description inline (one keyless GET, no pagination
    for typical board sizes; confirmed 2026-09-07 against foodics / lucidya /
    salla). `account_token` is the apply.workable.com account slug, taken from
    an `apply.workable.com/<account>` careers URL.

    Job fields used: title, shortcode, url, published_on / created_at,
    country/city/state + locations[], telecommuting (the remote flag),
    description (HTML — feeds the B3/B4/B5 facet detectors).
    """
    api_url = f"https://apply.workable.com/api/v1/widget/accounts/{account_token}?details=true"
    try:
        payload = fetch_json(api_url)
    except Exception as exc:
        log_warn(f"Workable fetch failed for {account_token}: {exc}")
        return []

    board_name = payload.get("name") if isinstance(payload, dict) else None
    jobs = []
    for item in (payload.get("jobs") or []) if isinstance(payload, dict) else []:
        title = clean_text(item.get("title") or "")
        shortcode = item.get("shortcode") or ""
        url = item.get("url") or item.get("shortlink") or (
            f"https://apply.workable.com/{account_token}/j/{shortcode}/" if shortcode else ""
        )
        if not (title and url) or not is_software_job(title):
            continue
        locs = _workable_locations(item)
        primary = locs[0] if locs else ""
        location = format_location_display(primary, locs) if len(locs) > 1 else primary
        # Region from the office location(s), before the "(Remote)" tag — a
        # Cairo-based remote role is still MENA (same rule as PinpointHQ).
        region = "unknown"
        for loc in locs:
            region = detect_region(loc)
            if region != "unknown":
                break
        if item.get("telecommuting") and "remote" not in primary.lower():
            location = (location + " (Remote)").strip() if location else "Remote"
            if region == "unknown":
                region = "remote"
        posted_at = parse_iso_date(item.get("published_on") or item.get("created_at") or "")
        description = clean_text(item.get("description") or "")
        job = {
            "id": make_id("workable", account_token, title, url),
            "kind": "job",
            "company": company_name or board_name or account_token,
            "title": title,
            "location": location,
            "level": detect_level(title),
            "region": region,
            "role_type": detect_role_type(title),
            "date": format_age_from_date(posted_at),
            "posted_at": posted_at,
            "url": url,
            "source": f"workable:{account_token}",
            "source_url": api_url,
        }
        job.update(job_facets(title, primary, description))
        jobs.append(job)
    return jobs


def _recruitee_locations(offer):
    """Recruitee gives a `locations[]` of address objects plus flat
    city/country fields — render each as "City, Country", de-duped in order."""
    out = []
    raw = offer.get("locations") or []
    if not raw and (offer.get("city") or offer.get("country")):
        raw = [{"city": offer.get("city"), "country": offer.get("country")}]
    for loc in raw:
        city = clean_text(loc.get("city") or loc.get("name") or "")
        country = clean_text(loc.get("country") or "")
        disp = f"{city}, {country}" if city and country and country.lower() not in city.lower() else (city or country)
        if disp and disp not in out:
            out.append(disp)
    return out


def fetch_recruitee_jobs(slug, company_name):
    """Recruitee public job board — one keyless GET on
    `https://<slug>.recruitee.com/api/offers/` returns `{offers:[...]}` with
    every published posting (no pagination for normal board sizes). `slug` is
    the `<slug>.recruitee.com` subdomain, taken from a company's Recruitee
    careers URL. Verified 2026-09-10 against `sahl` (Cairo insurtech).

    Fields used: title, careers_url, locations[] / city+country, remote /
    hybrid flags, published_at / created_at, description + requirements (HTML —
    feeds the B3/B4/B5 facet detectors). Only `status == "published"` rows.
    """
    api_url = f"https://{slug}.recruitee.com/api/offers/"
    try:
        payload = fetch_json(api_url)
    except Exception as exc:
        log_warn(f"Recruitee fetch failed for {slug}: {exc}")
        return []

    jobs = []
    for offer in (payload.get("offers") or []) if isinstance(payload, dict) else []:
        if (offer.get("status") or "published") != "published":
            continue
        title = clean_text(offer.get("title") or "")
        url = offer.get("careers_url") or offer.get("careers_apply_url") or ""
        if not (title and url) or not is_software_job(title):
            continue
        locs = _recruitee_locations(offer)
        primary = locs[0] if locs else ""
        location = format_location_display(primary, locs) if len(locs) > 1 else primary
        # Region from the office location(s), before any "(Remote)" suffix.
        region = "unknown"
        for loc in locs:
            region = detect_region(loc)
            if region != "unknown":
                break
        if offer.get("remote") and "remote" not in primary.lower():
            location = (location + " (Remote)").strip() if location else "Remote"
            if region == "unknown":
                region = "remote"
        posted_at = parse_iso_date(offer.get("published_at") or offer.get("created_at") or "")
        description = clean_text(
            html.unescape(" ".join(filter(None, (offer.get("description"), offer.get("requirements")))))
        )
        job = {
            "id": make_id("recruitee", slug, title, url),
            "kind": "job",
            "company": company_name or offer.get("company_name") or slug,
            "title": title,
            "location": location,
            "level": detect_level(title),
            "region": region,
            "role_type": detect_role_type(title),
            "date": format_age_from_date(posted_at),
            "posted_at": posted_at,
            "url": url,
            "source": f"recruitee:{slug}",
            "source_url": f"https://{slug}.recruitee.com/",
        }
        job.update(job_facets(title, primary, description))
        jobs.append(job)
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
    always curated by hand. Greenhouse/Lever/Workday normally auto-discover a
    company's board the first time one of its postings surfaces through an
    existing curated fetcher (see discover_job_board_sources) — but a
    company that never happens to appear that way (e.g. a MENA-region
    company none of the ~17 curated sources, mostly US/EU-focused, ever
    mention; or a big Workday employer whose community-tracker rows link to
    its own careers page, never a *.myworkdayjobs.com URL) stays invisible
    indefinitely even when its board is sitting right there, publicly
    pollable. These sections are the manual escape hatch for exactly that
    case — verified live before adding, same discipline as Ashby tokens
    (curl the board URL and confirm real postings, not just a 200). The
    workday: section takes "Company Name | host | site" per line (Workday
    has no bare token — each tenant is a subdomain plus a site path).
    Parsed with simple line matching (no YAML dependency), same approach as
    the company allowlist loader in fetch.py.
    """
    path = ROOT / "config" / "extra_job_boards.yml"
    # ashby/smartrecruiters/greenhouse/lever entries are a bare board token;
    # workday needs three fields (Workday has no single "token" — each tenant
    # gets its own subdomain *and* a site path), so those lines are
    # "Company Name | host | site" and land in `boards["workday"]` as
    # (company, host, site) tuples.
    boards = {
        "ashby": [], "smartrecruiters": [], "greenhouse": [], "lever": [],
        "workday": [], "pinpoint": [], "workable": [], "recruitee": [],
    }
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
                if not token:
                    continue
                if section == "workday":
                    parts = [p.strip() for p in token.split("|")]
                    if len(parts) == 3 and all(parts):
                        boards["workday"].append((parts[0], parts[1], parts[2]))
                    else:
                        log_warn(f"extra_job_boards.yml: bad workday line {token!r} (need 'Company | host | site')")
                elif section == "pinpoint":
                    # A bare token is a *.pinpointhq.com subdomain; a token
                    # with a dot is a full custom careers host.
                    boards["pinpoint"].append(token if "." in token else f"{token}.pinpointhq.com")
                else:
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


def fetch_hackerearth_hackathons():
    """Fetch featured hackathons / hiring challenges from HackerEarth's own
    public JSON endpoint (`/chrome-extension/events/`, keyless, the one its
    browser extension calls — same category as the Devpost/Unstop/Devfolio
    internal APIs above). Small, high-signal set (a handful of currently
    featured events), and it's notably stronger on MENA/India events the
    other three under-cover. `url` points at the real event page on
    hackerearth.com, not a middleman. Not disallowed by robots.txt.

    Per item: `title`, `url`, `description`, `end_utc_tz` (ISO, `+00:00`),
    `status`, `challenge_type`. No org/location fields — like Devfolio's
    `company` this is stamped "HackerEarth"; the platform is online-only, so
    location is "Online". Rows whose window has already closed are dropped
    (same `ends_at`-in-the-future rule as Devfolio).
    """
    api_url = "https://www.hackerearth.com/chrome-extension/events/"
    try:
        payload = fetch_json(api_url)
    except Exception as exc:
        log_warn(f"HackerEarth fetch failed: {exc}")
        return []

    rows = []
    seen_urls = set()
    now = datetime.datetime.now(datetime.UTC)
    for item in payload.get("response", []) or []:
        title = clean_text(item.get("title") or "")
        url = item.get("url") or ""
        if not (title and url) or url in seen_urls:
            continue

        end_dt = None
        for key in ("end_utc_tz", "end_tz"):
            try:
                parsed = datetime.datetime.fromisoformat(item.get(key) or "")
            except Exception:
                continue
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=datetime.UTC)
            end_dt = parsed
            break
        if end_dt is not None and end_dt < now:
            continue  # submission window already closed — can't enter

        seen_urls.add(url)
        rows.append(
            {
                "id": make_id("hackerearth", title, url),
                "kind": "hackathon",
                "company": "HackerEarth",
                "title": title,
                "location": "Online",
                "date": _format_deadline_from_end(end_dt, now),
                "posted_at": TODAY,
                "url": url,
                "source": "hackerearth",
                "source_url": "https://www.hackerearth.com/challenges/",
            }
        )
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


def _event_countdown(days_until: int) -> str:
    """Human 'date' string for a curated event, in the same shape the
    hackathon feeds use so _deadline_days() sorts them together."""
    if days_until <= 0:
        return "happening now"
    if days_until == 1:
        return "1 day left"
    return f"{days_until} days left"


def parse_curated_events(text: str, today: datetime.date):
    """Parse config/events.yml lines ('Name | Organizer | City, Country |
    YYYY-MM-DD | URL') into event rows, dropping anything already past."""
    rows = []
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or "|" not in line:
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) != 5:
            log_warn(f"events.yml: skipping malformed line: {raw!r}")
            continue
        name, organizer, location, date_str, url = parts
        try:
            start = datetime.date.fromisoformat(date_str)
        except ValueError:
            log_warn(f"events.yml: bad date {date_str!r} for {name!r}")
            continue
        days_until = (start - today).days
        if days_until < -1:  # event is over — hide it until the row is bumped
            continue
        rows.append(
            {
                "id": make_id("curated_events", name, url),
                "kind": "event",
                "company": organizer or name,
                "title": name,
                "location": location or "Global",
                "date": _event_countdown(days_until),
                "posted_at": TODAY,
                "url": url,
                "source": "curated_events",
                "source_url": "https://github.com/AhmedNassar7/tracker/blob/main/config/events.yml",
            }
        )
    return rows


def fetch_curated_events():
    path = ROOT / "config" / "events.yml"
    if not path.exists():
        return []
    try:
        text = path.read_text(encoding="utf-8")
    except Exception as exc:
        log_warn(f"events.yml read failed: {exc}")
        return []
    today = datetime.datetime.now(datetime.UTC).date()
    return parse_curated_events(text, today)


# confs.tech (confs.tech / github.com/tech-conferences/conference-data) is a
# crowd-sourced, actively-maintained database of dev-community conferences —
# one JSON array per topic per year, e.g.
# conferences/2026/opensource.json = [{"name", "url", "startDate", "endDate",
# "city", "country", "online", "cfpUrl", ...}, ...]. Served straight off
# raw.githubusercontent.com (same CDN the curated-layer community trackers
# already rely on), keyless, no scraping — exactly the "check for a JSON API
# first" case this repo prefers. Topics below are the ones actually relevant
# to a software-engineering audience; confs.tech also tracks non-engineering
# topics (leadership, product, ux, accessibility, iot, css, …) that are a
# worse fit for this site and are deliberately left out. A topic file that
# doesn't exist yet for the given year (confs.tech hasn't backfilled every
# topic that far out — 2027 currently only has ~14 of these) 404s; that's
# expected and handled quietly rather than logged as a failure.
CONFS_TECH_TOPICS = [
    "android", "api", "clojure", "cpp", "data", "devops", "dotnet",
    "general", "graphql", "groovy", "ios", "java", "javascript", "kotlin",
    "networking", "opensource", "performance", "php", "python", "rust",
    "security", "sre", "testing", "typescript",
]
CONFS_TECH_REPO_URL = "https://github.com/tech-conferences/conference-data"


def _confs_tech_location(item):
    city = (item.get("city") or "").strip()
    country = (item.get("country") or "").strip()
    if city and country:
        return f"{city}, {country}"
    if city:
        return city
    if item.get("online"):
        return "Virtual"
    return "Global"


def _fetch_confs_tech_topic(year, topic):
    """One (year, topic) JSON file -> event rows, dropping past ones."""
    url = f"https://raw.githubusercontent.com/tech-conferences/conference-data/main/conferences/{year}/{topic}.json"
    try:
        payload = fetch_json(url)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return []  # topic not yet backfilled for this year — not an error
        raise

    today = datetime.datetime.now(datetime.UTC).date()
    rows = []
    for item in payload or []:
        name = (item.get("name") or "").strip()
        conf_url = (item.get("url") or "").strip()
        date_str = item.get("startDate") or ""
        if not (name and conf_url and date_str):
            continue
        try:
            start = datetime.date.fromisoformat(date_str)
        except ValueError:
            continue
        days_until = (start - today).days
        if days_until < -1:  # event is over
            continue
        rows.append(
            {
                "id": make_id("confs_tech", name, conf_url, date_str),
                "kind": "event",
                "company": name,
                "title": name,
                "location": _confs_tech_location(item),
                "date": _event_countdown(days_until),
                "posted_at": TODAY,
                "url": conf_url,
                "source": "confs_tech",
                "source_url": CONFS_TECH_REPO_URL,
            }
        )
    return rows


def _normalize_event_name(name):
    return re.sub(r"[^a-z0-9]+", "", (name or "").lower())


def fetch_confs_tech_events(existing_event_names=()):
    """Fetch this year + next year of CONFS_TECH_TOPICS from confs.tech's
    data repo. `existing_event_names` are the titles already covered by
    config/events.yml (hand-curated) — a confs.tech row whose normalized
    name matches one is dropped so the same conference doesn't appear twice
    (e.g. KubeCon, already hand-seeded for its MENA/EMEA relevance).
    """
    this_year = datetime.datetime.now(datetime.UTC).year
    arg_tuples = [
        (year, topic)
        for year in (this_year, this_year + 1)
        for topic in CONFS_TECH_TOPICS
    ]
    rows = run_and_collect(
        _fetch_confs_tech_topic, arg_tuples, log_error, max_workers=10,
        label=lambda args: f"{args[0]}/{args[1]}.json",
    )
    curated_keys = {_normalize_event_name(n) for n in existing_event_names}
    if not curated_keys:
        return rows
    return [
        row for row in rows
        if _normalize_event_name(row["title"]) not in curated_keys
    ]


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
    if hint in {"last day", "today", "happening now"}:
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
    # Workday can't be auto-discovered for a company none of the curated
    # sources link to a *myworkdayjobs.com* URL for (they link to the
    # company's own careers page instead). Hand-seeded "Company | host | site"
    # rows fill that gap — big global employers on Workday: Salesforce,
    # NVIDIA, Adobe, Visa, Mastercard, Workday itself, …
    for company, host, site in extra_boards["workday"]:
        workday.setdefault((host, site), company)

    log_info(
        f"Discovered {len(greenhouse)} Greenhouse boards, {len(lever)} Lever boards, "
        f"and {len(workday)} Workday hosts from existing jobs + hand-curated config"
    )

    rows.extend(fetch_devpost_hackathons())
    rows.extend(fetch_unstop_hackathons())
    rows.extend(fetch_devfolio_hackathons())
    rows.extend(fetch_hackerearth_hackathons())
    rows.extend(fetch_luma_discover())
    curated_events = fetch_curated_events()
    rows.extend(curated_events)
    rows.extend(fetch_confs_tech_events(
        existing_event_names=[row["title"] for row in curated_events]
    ))

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

    # PinpointHQ (config only — no auto-discovery). Each company is its own
    # host, so no shared-host worker cap needed (same as Workday).
    if extra_boards["pinpoint"]:
        log_info(f"Loaded {len(extra_boards['pinpoint'])} PinpointHQ boards from config")
        rows.extend(_run_concurrently(
            fetch_pinpoint_jobs,
            [(host, prettify_company_name(_pinpoint_company_from_host(host))) for host in extra_boards["pinpoint"]],
        ))

    # Workable (config only — no auto-discovery yet). apply.workable.com is one
    # shared host for every account, so cap the burst like Greenhouse/Lever/etc.
    if extra_boards["workable"]:
        log_info(f"Loaded {len(extra_boards['workable'])} Workable boards from config")
        rows.extend(_run_concurrently(
            fetch_workable_jobs,
            [(token, prettify_company_name(token.replace("-", " "))) for token in extra_boards["workable"]],
            max_workers=SHARED_HOST_WORKERS,
        ))

    # Recruitee (config only). Each account is its own <slug>.recruitee.com
    # subdomain, so no shared-host cap needed (same as Workday/PinpointHQ).
    if extra_boards["recruitee"]:
        log_info(f"Loaded {len(extra_boards['recruitee'])} Recruitee boards from config")
        rows.extend(_run_concurrently(
            fetch_recruitee_jobs,
            [(slug, prettify_company_name(slug.replace("-", " "))) for slug in extra_boards["recruitee"]],
        ))

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