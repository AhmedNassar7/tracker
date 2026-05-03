#!/usr/bin/env python3
"""Fetch public opportunity sources: hackathons/events and public job boards.

This layer is separate from the main jobs snapshot. It uses public feeds/APIs
to widen coverage:
- Devpost hackathons
- Luma discovery pages
- Greenhouse public job board API
- Lever public postings JSON
- Workday page support (generic HTML extraction; enable per-source)
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
        parsed = urlparse(url)
        if "workdayjobs.com" in parsed.netloc.lower():
            workday[parsed.netloc.lower()] = company
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

    log_info(f"Discovered {len(greenhouse)} Greenhouse boards and {len(lever)} Lever boards from existing jobs")

    rows.extend(fetch_devpost_events())
    rows.extend(fetch_luma_discover())

    for board_token, company in sorted(greenhouse.items()):
        rows.extend(fetch_greenhouse_board_jobs(board_token, company))

    for company_slug, company in sorted(lever.items()):
        rows.extend(fetch_lever_jobs(company_slug, company))

    # Workday support is available as a helper for configurable pages.
    if workday:
        log_info(f"Detected {len(workday)} Workday hosts for future source configuration")

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