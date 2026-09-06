#!/usr/bin/env python3
from __future__ import annotations

import datetime
import hashlib
import html
import json
import re
import sys
from urllib.parse import quote
from pathlib import Path

ROOT = Path(__file__).parent.parent
DATA_OUT = ROOT / "data"

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from schema_validator import load_schema, validate_records
from rss_feeds import write_feeds
from company_names import prettify_company_name
from net import load_link_cache
from patterns import country_flag, detect_country

CURATED_JSON = DATA_OUT / "jobs-global.json"
PUBLIC_JSON = DATA_OUT / "public-opportunities.json"
LINK_CACHE_JSON = DATA_OUT / "link-cache.json"
AGGREGATE_LINKS_CONFIG = ROOT / "config" / "aggregate_links.yml"
ROOT_README = ROOT / "README.md"
DATA_README = DATA_OUT / "README.md"
SITE_INDEX_JSON = DATA_OUT / "site-index.json"
SITE_INDEX_SCHEMA = ROOT / "config" / "site-index.schema.json"
STATS_HISTORY_JSON = DATA_OUT / "stats-history.json"
STATS_HISTORY_SCHEMA = ROOT / "config" / "stats-history.schema.json"
STORY_CARDS_JSON = DATA_OUT / "story-cards.json"
STORY_CARDS_SCHEMA = ROOT / "config" / "story-cards.schema.json"
# One point per hourly run; 90 days keeps the file bounded (~2,160 points at
# worst) while covering enough history for a meaningful trend line.
STATS_HISTORY_RETENTION_DAYS = 90
FEEDS_DIR = DATA_OUT / "feeds"

# Fields copied straight through when present; curated-only fields (category,
# remote_type, country) and the level/region/role_type job fields are added
# separately per-kind so we never fabricate a key an origin layer doesn't have.
# `location` is NOT here — it's cleaned of the README-only <details>/<br> HTML
# and split into a `locations[]` array by _clean_site_location().
_SITE_INDEX_PASSTHROUGH = ("company", "title", "source", "source_url")

# Matches the multi-location dropdown the curated layer bakes into `location`
# for the markdown tables (see format_location_display in
# scripts/simplify_jobs_parser.py). site-index.json is consumed by a real UI,
# not a markdown renderer, so that HTML is unpacked back into plain data here.
_LOC_DETAILS_RE = re.compile(
    r"<details[^>]*>\s*<summary>\s*(?:<strong>)?\s*(\d+)\s+locations?\s*"
    r"(?:</strong>)?\s*</summary>(.*?)</details>",
    re.I | re.S,
)


def _clean_site_location(raw: str) -> tuple[str, list[str]]:
    """(summary, locations[]) for site-index.json. A single-location string is
    returned as-is with an empty list; a multi-location dropdown becomes a
    short "First, Place +N more" summary plus the full list."""
    raw = (raw or "").strip()
    m = _LOC_DETAILS_RE.search(raw)
    if not m:
        # No dropdown — just make sure no stray tags leak through.
        return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", raw)).strip(), []
    body = m.group(2)
    if re.search(r"<br\s*/?>", body, re.I):
        parts = re.split(r"<br\s*/?>", body, flags=re.I)
    else:
        # Space-mashed "City, ST City, ST" — break before a capitalised word
        # that follows a 2-letter state/country code.
        parts = re.split(r"(?<=,\s[A-Z]{2})\s+(?=[A-Z])", body)
    locs: list[str] = []
    for part in parts:
        part = html.unescape(re.sub(r"<[^>]+>", " ", part)).strip(" \t\r\n-•,")
        part = re.sub(r"\s+", " ", part)
        if part:
            locs.append(part)
    if not locs:
        return f"{m.group(1)} locations", []
    if len(locs) == 1:
        return locs[0], []
    return f"{locs[0]} +{len(locs) - 1} more", locs


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def load_aggregate_links(path: Path = AGGREGATE_LINKS_CONFIG) -> list[dict]:
    """Parse config/aggregate_links.yml — one "Company | Link text | URL" line
    per company that has no enumerable public board. Same dependency-free line
    parsing as the other config loaders. Returns kind:"board" entries ready
    for both the rendered README and site-index.json.
    """
    if not path.exists():
        return []
    boards: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        parts = [p.strip() for p in stripped.split("|")]
        if len(parts) != 3 or not all(parts):
            continue
        company, title, url = parts
        if not url.startswith(("http://", "https://")):
            continue
        boards.append(
            {
                "id": hashlib.sha256(f"board|{company.lower()}|{url}".encode("utf-8")).hexdigest()[:16],
                "kind": "board",
                "origin": "config",
                "company": prettify_company_name(company),
                "title": title,
                "location": "",
                "age": "",
                "posted_at": "",
                "url": url,
                "source": "company_board",
                "source_url": url,
            }
        )
    return boards


def calculate_age_from_date(posted_at: str) -> str:
    """Calculate age from posted_at date if it exists."""
    try:
        posted_date = datetime.datetime.strptime(posted_at, "%Y-%m-%d").date()
        today = datetime.date.today()
        delta = today - posted_date
        if delta.days < 1:
            return "0d"
        return f"{delta.days}d"
    except:
        return ""


def normalize_rows(rows: list[dict], origin: str) -> list[dict]:
    normalized: list[dict] = []
    for row in rows:
        age = row.get("age") or row.get("date") or ""
        # If age is still empty, calculate from posted_at
        if not age:
            age = calculate_age_from_date(row.get("posted_at") or "")
        # For a job, never let a frozen/placeholder age look fresher than
        # first-seen; a hackathon/event 'age' is a deadline countdown, skip it.
        if (row.get("kind") or "job") == "job":
            age = reconcile_age(age, row.get("posted_at") or "")

        entry = {
            "origin": origin,
            "company": prettify_company_name(row.get("company") or ""),
            "title": row.get("title") or "",
            "location": row.get("location") or "",
            "age": age,
            "level": row.get("level") or "other",
            "url": row.get("url") or "",
            "source": row.get("source") or "",
            "posted_at": row.get("posted_at") or "",
            "kind": row.get("kind") or "job",
            # Allowlist tier (curated rows only) — drives the tier-first
            # ordering in sort_jobs so FAANG/big-tech surface above a
            # same-age role at a less-known company.
            "category": row.get("category") or "",
            # Already-detected classification fields, copied through (not
            # re-derived) so summarize_snapshot_dimensions() can bucket the
            # published set by them. region/role_type exist on both layers;
            # country/remote_type are curated-only — absent on public rows,
            # which then just fall into the "unknown" bucket, never a guess.
            "region": row.get("region") or "",
            "role_type": row.get("role_type") or "",
            "remote_type": row.get("remote_type") or "",
            "country": row.get("country") or "",
        }
        # B3/B4/B5 facets — carried through so the rendered tables can show a
        # 🛂 marker / an inline pay range. Only copied when the source row
        # actually has the key (absent-not-guessed, same as everywhere else).
        for facet in ("tech_tags", "visa_sponsorship", "degree_required", "relocation", "salary"):
            if facet in row and row[facet] not in (None, "", []):
                entry[facet] = row[facet]
        normalized.append(entry)
    return normalized


def level_bucket(level: str) -> str:
    if level == "internship":
        return "internship"
    if level in {"new_grad", "junior", "entry_level"}:
        return "early_career"
    return "mid_level"


# Company-tier order for the README tables — mirrors CATEGORY_RANK in
# scripts/fetch.py (the allowlist section order). Uncategorised rows (all
# public-layer jobs) sort after every tiered company.
CATEGORY_RANK = {
    "faang": 0, "microsoft_group": 1, "big_tech": 2, "cloud_infra": 3,
    "product_saas": 4, "ai_research": 5, "fintech": 6, "ride_delivery": 7,
    "consulting_finance": 8, "apac_tech": 9, "latam_tech": 10,
    "mena_africa_tech": 11, "more_global_tech": 12,
}


def _age_to_days(age: str) -> int:
    age = (age or "").strip().lower()
    if age.endswith("d") and age[:-1].isdigit():
        return int(age[:-1])
    if age.endswith("mo") and age[:-2].isdigit():
        return int(age[:-2]) * 30
    return 10**9


def reconcile_age(age: str, posted_at: str) -> str:
    """Return a display age that can't claim a posting is fresher than the day
    it was first recorded.

    Two things make a stored ``age`` go stale: the curated feed deliberately
    freezes ``age`` between runs to avoid hourly churn, and a few community
    parsers seed ``"0d"`` when they can't read the source's date cell — both
    leave weeks-old listings showing as brand new. ``posted_at`` is frozen at
    first-seen, so days-since-``posted_at`` is a hard lower bound. Trust a
    parseable source age that's within that bound; otherwise use the bound.
    """
    try:
        seen = max(
            (datetime.datetime.now(datetime.UTC).date()
             - datetime.date.fromisoformat((posted_at or "")[:10])).days,
            0,
        )
    except Exception:
        seen = None
    days = _age_to_days(age)
    if days < 10**9:  # source gave a parseable age
        if seen is not None and seen > days:
            return f"{seen}d"
        return age
    if seen is not None:
        return f"{seen}d"
    return age or ""


def sort_jobs(rows: list[dict]) -> list[dict]:
    # Order: company tier (FAANG → big-tech → … → uncategorised public rows)
    # first, then — within a tier — all of one company's roles stay together
    # as a block, blocks ordered by the company's freshest posting, and each
    # block sorted newest-first. So the reader sees "Google (5 roles), then
    # Amazon (3 roles), …" instead of the two interleaved by age.
    def company_of(row: dict) -> str:
        return (row.get("company") or "").strip().lower()

    def tier_of(row: dict) -> int:
        return CATEGORY_RANK.get(row.get("category") or "", 50)

    freshest_in_company: dict[tuple[int, str], int] = {}
    for row in rows:
        ck = (tier_of(row), company_of(row))
        d = _age_to_days(row.get("age"))
        if ck not in freshest_in_company or d < freshest_in_company[ck]:
            freshest_in_company[ck] = d

    def key(row: dict) -> tuple:
        tier = tier_of(row)
        company = company_of(row)
        return (
            tier,
            freshest_in_company[(tier, company)],  # freshest company first
            company,                                # cluster the company together
            _age_to_days(row.get("age")),           # newest role first in the block
            (row.get("title") or "").lower(),
        )

    return sorted(rows, key=key)


def format_age(age_str: str) -> str:
    """Format age string to days/months/years based on magnitude."""
    age = (age_str or "").strip().lower()
    
    # Parse age into days
    if age.endswith("d") and age[:-1].isdigit():
        age_days = int(age[:-1])
    elif age.endswith("mo") and age[:-2].isdigit():
        age_days = int(age[:-2]) * 30
    else:
        return age  # Return as-is if unparseable
    
    # Format based on magnitude
    if age_days < 30:
        return f"{age_days}d"
    elif age_days < 365:
        months = age_days // 30
        return f"{months}mo"
    else:
        years = age_days // 365
        return f"{years}yrs"


# Sources that come from a hand-maintained GitHub README rather than a live
# company/ATS API. A closed posting only leaves one of these lists when a
# volunteer edits the file, which can lag by days or weeks — and `check_url_alive`
# can't always tell (ATS "soft 404s" return HTTP 200). A live-API source is
# self-cleaning: a closed job simply isn't in the next fetch. So we age these
# out much sooner, per the user's "if not sure, drop it" preference.
COMMUNITY_TRACKER_SOURCES = frozenset({
    "simplify_internships", "simplify_newgrad",
    "speedyapply_swe", "speedyapply_ai",
    "zapplyjobs_internships", "zapplyjobs_newgrad", "zapplyjobs_all_newgrad",
    "zapplyjobs_canada", "zapplyjobs_canada_internships", "zapplyjobs_datascience",
    "lorenzolacorte_eu", "hanzili_canada", "ambicuity",
})
COMMUNITY_TRACKER_MAX_AGE_DAYS = 30
LIVE_API_MAX_AGE_DAYS = 180


def max_age_days_for_source(source: str) -> int:
    return (
        COMMUNITY_TRACKER_MAX_AGE_DAYS
        if (source or "") in COMMUNITY_TRACKER_SOURCES
        else LIVE_API_MAX_AGE_DAYS
    )


def filter_stale_jobs(rows: list[dict]) -> list[dict]:
    """Drop jobs past their source's freshness limit (30 days for a
    hand-maintained community tracker, 180 for a live API). An unparseable
    age is kept — we can't judge it."""
    filtered: list[dict] = []
    for row in rows:
        age = (row.get("age") or "").strip().lower()
        if age.endswith("d") and age[:-1].isdigit():
            age_days = int(age[:-1])
        elif age.endswith("mo") and age[:-2].isdigit():
            age_days = int(age[:-2]) * 30
        else:
            filtered.append(row)  # Keep if unparseable
            continue

        if age_days <= max_age_days_for_source(row.get("source")):
            filtered.append(row)

    return filtered


def badge(label: str, value: int, color: str, link: str) -> str:
    safe_label = quote(label, safe="").replace("-", "--")
    return f"[![{label} {value}](https://img.shields.io/badge/{safe_label}-{value}-{color}.svg)]({link})"


_SALARY_SYMBOLS = {"USD": "$", "EUR": "€", "GBP": "£", "INR": "₹"}
_SALARY_PERIOD_SUFFIX = {"year": "/yr", "month": "/mo", "hour": "/hr"}


def format_salary_short(salary: dict) -> str:
    """'$120k–$150k/yr' from a parse_salary() dict, for the README title
    cell. Returns '' for anything that doesn't have the four expected keys, so
    a malformed value never lands in a table."""
    try:
        lo, hi = int(salary["min"]), int(salary["max"])
        currency = str(salary["currency"])
        period = str(salary["period"])
    except (KeyError, TypeError, ValueError):
        return ""

    def amount(n: int) -> str:
        return f"{round(n / 1000)}k" if n >= 1000 else str(n)

    sym = _SALARY_SYMBOLS.get(currency, currency + " ")
    suffix = _SALARY_PERIOD_SUFFIX.get(period, "")
    return f"{sym}{amount(lo)}–{sym}{amount(hi)}{suffix}"


def job_row_markers(row: dict) -> str:
    """Leading emoji marker string for a job's title cell (currently just the
    visa-sponsorship 🛂). Trailing space included when non-empty so callers
    can prepend it unconditionally."""
    markers = ""
    if row.get("visa_sponsorship") is True:
        markers += "\U0001f6c2 "
    return markers


def clean_cell(value: str) -> str:
    text = value or ""
    text = text.replace("\r", " ").replace("\n", " ")
    text = text.replace("<br>", ", ").replace("<br/>", ", ").replace("<br />", ", ")
    text = text.replace("</summary>", ": ")
    for tag in ("<details>", "</details>", "<summary>", "<strong>", "</strong>"):
        text = text.replace(tag, "")
    text = re.sub(r"\s+", " ", text).strip()
    return text.replace("|", " ")


def table_rows(rows: list[dict], enable_details: bool = True) -> list[str]:
    lines: list[str] = []
    for row in rows:
        company = clean_cell(row["company"])
        title = clean_cell(row["title"])
        location_full = clean_cell(row["location"])
        age = clean_cell(row["age"])
        age_formatted = format_age(age)
        
        # Handle multiple locations with expandable details
        if enable_details and " locations: " in location_full.lower():
            # Split the header from the location list
            parts = location_full.split(": ", 1)
            if len(parts) == 2:
                count_part = parts[0]  # e.g., "7 locations"
                locs_str = parts[1]  # e.g., "Seattle, WA, SF, Austin, TX, ..."
                
                # Split locations, but keep pairs together (City, State)
                # This is a simple heuristic: pairs of items separated by commas are kept together
                loc_items = [item.strip() for item in locs_str.split(", ")]
                
                # Group into pairs where possible (City, State pattern)
                grouped_locs = []
                i = 0
                while i < len(loc_items):
                    if i + 1 < len(loc_items) and len(loc_items[i + 1]) <= 2:
                        # Likely a state abbreviation, keep with city
                        grouped_locs.append(f"{loc_items[i]}, {loc_items[i + 1]}")
                        i += 2
                    else:
                        grouped_locs.append(loc_items[i])
                        i += 1
                
                # Create expandable location with HTML details/summary
                location_lines = "<br>".join(grouped_locs)
                location_display = f'<details><summary>{count_part}</summary>{location_lines}</details>'
            else:
                location_display = location_full
        else:
            location_display = location_full
        
        markers = job_row_markers(row)
        salary_txt = format_salary_short(row["salary"]) if isinstance(row.get("salary"), dict) else ""
        salary_suffix = f" _{salary_txt}_" if salary_txt else ""
        lines.append(
            f"| {company} | {markers}[{title}]({row['url']}){salary_suffix} | {location_display} | {age_formatted} |"
        )
    return lines


def simplify_event_name(title: str) -> str:
    """Simplify event names by removing 'Subscribe' prefix and descriptions."""
    title = (title or "").strip()
    # Remove "Subscribe " prefix
    if title.startswith("Subscribe "):
        title = title[10:]
    
    # Extract just the event name (first meaningful part)
    # Split by common description patterns
    parts = title.split(" - ", 1)
    name = parts[0].strip()
    
    # For very descriptive titles, try to get just the main name
    # Examples: "Build Club The most..." -> "Build Club"
    # "Cursor Community Cursor community..." -> "Cursor Community"
    words = name.split()
    if len(words) > 4:
        # If more than 4 words, likely contains description, take first 2-3 meaningful words
        potential_names = [" ".join(words[:2]), " ".join(words[:3])]
        # Use the one that doesn't repeat keywords
        for candidate in potential_names:
            if candidate.lower().count(candidate.lower().split()[0]) == 1:
                name = candidate
                break
        else:
            name = potential_names[0]
    
    # Remove parenthetical descriptions
    name = re.sub(r'\s*\(.*?\)', '', name)
    # Remove URLs
    name = re.sub(r'https?://\S+', '', name)
    # Remove "Global" suffix if present at the end
    if name.endswith(" Global"):
        name = name[:-7]
    
    name = name.strip()
    return name if name else title


def fix_event_url(url: str) -> str:
    """Fix event URLs that are relative paths."""
    url = (url or "").strip()
    if url and url.startswith("/"):
        # Convert relative Luma URLs to full URLs
        return f"https://lu.ma{url}"
    return url


def render_data_readme(
    now_text: str,
    stats: dict,
    all_jobs: list[dict],
    hackathons: list[dict],
    events: list[dict],
    boards: list[dict] | None = None,
) -> str:
    jobs_by_bucket = {"internship": [], "early_career": [], "mid_level": []}
    for row in all_jobs:
        jobs_by_bucket[level_bucket(row["level"])].append(row)

    # Filter out stale jobs (> 6 months / 180 days)
    internship_bucket = filter_stale_jobs(jobs_by_bucket["internship"])
    early_bucket = filter_stale_jobs(jobs_by_bucket["early_career"])
    mid_bucket = filter_stale_jobs(jobs_by_bucket["mid_level"])

    internship_rows = sort_jobs(internship_bucket)
    early_rows = sort_jobs(early_bucket)
    mid_rows = sort_jobs(mid_bucket)

    lines: list[str] = [
        "# Software Engineering Opportunities",
        "",
        f"**Last Updated:** {now_text}  ·  refreshed hourly  ·  [← back to project overview](../README.md)",
        "",
        "Every row links straight to the real application page. Click a title to apply — no account on this repo needed."
        " The **Age** column shows how long ago the listing was posted, so you can spot the newest roles at a glance.",
        "",
        "## Markers",
        "",
        "Extra signals pulled straight from a posting's own text (only the ATS sources that publish a full"
        " description — Greenhouse, Lever, Ashby, Remotive, ArbeitNow — so most rows won't carry one). Absent"
        " means the posting didn't say, not \"no\".",
        "",
        "| Marker | Meaning |",
        "|---|---|",
        "| 🛂 | The posting explicitly states visa sponsorship is available |",
        "| _$120k–$150k/yr_ (after the title) | A pay range disclosed in the posting itself — never an estimate |",
        "",
        "## Quick Links",
        "",
        "### Jobs",
        "- [Internship](#internship)",
        "- [Early Career](#early-career)",
        "- [Mid-Level and Above](#mid-level-and-above)",
        "",
        "### Other Tables",
        "- [Hackathons](#hackathons)",
        "- [Events](#events)",
        "",
        "## Counts",
        "",
        "| Section | Count |",
        "|---|---:|",
        f"| Jobs | {stats['jobs_total']} |",
        f"| Hackathons | {len(hackathons)} |",
        f"| Events | {len(events)} |",
        f"| Total | {stats['total_items']} |",
        "",
        "## Jobs",
        "",
        f"{badge('Jobs', stats['jobs_total'], 'brightgreen', '#jobs')} {badge('Levels', 3, 'blue', '#jobs')} {badge('Internship', len(internship_rows), '22c55e', '#internship')} {badge('Early Career', len(early_rows), '0ea5e9', '#early-career')} {badge('Mid-Level and Above', len(mid_rows), 'dc2626', '#mid-level-and-above')}",
        "",
        "### Internship",
        "",
        f"Total roles: {len(internship_rows)}",
        "",
        "| Company | Title | Location | Age |",
        "|---|---|---|---|",
    ]
    if internship_rows:
        lines.extend(table_rows(internship_rows))
    else:
        lines.append("| - | No roles matched this level today. | - | - |")

    lines.extend([
        "",
        "### Early Career",
        "",
        f"Total roles: {len(early_rows)}",
        "",
        "| Company | Title | Location | Age |",
        "|---|---|---|---|",
    ])
    if early_rows:
        lines.extend(table_rows(early_rows))
    else:
        lines.append("| - | No roles matched this level today. | - | - |")

    lines.extend([
        "",
        "### Mid-Level and Above",
        "",
        f"Total roles: {len(mid_rows)}",
        "",
        "| Company | Title | Location | Age |",
        "|---|---|---|---|",
    ])
    if mid_rows:
        lines.extend(table_rows(mid_rows))
    else:
        lines.append("| - | No roles matched this level today. | - | - |")

    def _when(row: dict) -> str:
        # hackathons/events reach here straight from public_payload (not via
        # normalize_rows), so the countdown is still under "date".
        v = (row.get("date") or row.get("age") or "").strip()
        return v if v else "—"

    def _where(row: dict) -> str:
        v = clean_cell(row.get("location") or "")
        return v if v else "—"

    lines.extend([
        "",
        "## Hackathons",
        "",
        f"Total hackathons: {len(hackathons)}",
        "",
        "| Organizer | Hackathon | Location | Closes |",
        "|---|---|---|---|",
    ])
    for row in hackathons:
        lines.append(
            f"| {row['company']} | [{row['title']}]({row['url']}) | {_where(row)} | {_when(row)} |"
        )

    lines.extend([
        "",
        "## Events",
        "",
        f"Total events: {len(events)}",
        "",
        "| Organizer | Event | Location | When |",
        "|---|---|---|---|",
    ])
    for row in events:
        event_name = simplify_event_name(row.get("title") or "")
        event_url = fix_event_url(row.get("url") or "")
        lines.append(
            f"| {row['company']} | [{event_name}]({event_url}) | {_where(row)} | {_when(row)} |"
        )

    boards = boards or []
    if boards:
        lines.extend([
            "",
            "## Browse Every Role",
            "",
            "Companies that run their own careers site with no public feed to pull role-by-role."
            " Each link is a pre-filtered search on the company's own site for early-career software roles —"
            " not a single posting, so counts above don't include these.",
            "",
            "| Company | Open roles |",
            "|---|---|",
        ])
        for row in boards:
            lines.append(f"| {row['company']} | [{row['title']}]({row['url']}) |")

    lines.extend([
        "",
        "## Source Files",
        "",
        "This page is the one formatted view — everyone who just wants to browse jobs should stop here."
        " The two files below are the raw JSON behind it, only useful if you're building something on top"
        " of this list (a script, a bot, your own site):",
        "",
        "| File | What it contains |",
        "|---|---|",
        "| [jobs-global.json](jobs-global.json) | Curated jobs: Remotive, ArbeitNow, SimplifyJobs, and others, filtered to the top-tier company allowlist |",
        "| [jobs-global-archive.json](jobs-global-archive.json) | Curated jobs that have since closed, gone dead-link, or rolled off the source feed |",
        "| [public-opportunities.json](public-opportunities.json) | Public-board jobs, hackathons, and events: Greenhouse, Lever, Workday, Ashby, SmartRecruiters, Devpost, Luma |",
        "| [stats.json](stats.json) | Counts of the curated feed broken down by level, country, and source |",
        "| [site-index.json](site-index.json) | Both feeds above, flattened into one list with a content checksum — meant for a future site to fetch as a single lightweight file |",
        "| [stats-history.json](stats-history.json) | One snapshot of the totals above per hourly run, last 90 days — a free trend line with no extra fetching (see [config/stats-history.schema.json](../config/stats-history.schema.json)) |",
        "",
        "## RSS Feeds",
        "",
        "Five preset feeds, refreshed hourly — fixed filters rather than arbitrary saved ones, since a static site can't compute custom filtered XML on demand:",
        "",
        "| Feed | Filter |",
        "|---|---|",
        "| [feeds/all-jobs.xml](feeds/all-jobs.xml) | Every job |",
        "| [feeds/internships.xml](feeds/internships.xml) | Internships only |",
        "| [feeds/new-grad.xml](feeds/new-grad.xml) | New-grad roles only |",
        "| [feeds/hackathons.xml](feeds/hackathons.xml) | Hackathons |",
        "| [feeds/events.xml](feeds/events.xml) | Events |",
        "",
        "## Notes",
        "",
        "- Use [README.md](../README.md) as the root entry point.",
        "- This page merges two feeds: the curated one (top-tier companies only) and the public one"
        " (broader board coverage). Both refresh every hour.",
        "- Looking for interview prep, resume tools, or open-source fellowships instead of a job listing?"
        " See [resources.md](resources.md).",
        "- Everything on this page is generated automatically — don't hand-edit it, since the next"
        " hourly run will overwrite it. To change how it's built, edit [scripts/build_data_readme.py](../scripts/build_data_readme.py).",
    ])
    return "\n".join(lines) + "\n"


def render_root_readme(now_text: str, stats: dict) -> str:
    jobs_total = stats["jobs_total"]
    total_items = stats["total_items"]
    hackathons_total = stats["hackathons_total"]
    events_total = stats["events_total"]
    internship_total = stats["level_counts"]["internship"]
    early_total = stats["level_counts"]["early_career"]
    mid_total = stats["level_counts"]["mid_level"]

    last_updated_value = quote(now_text, safe="").replace("-", "--")
    status_badges = " ".join([
        "[![Hourly Global Tech Roles PR](https://github.com/AhmedNassar7/tracker/actions/workflows/hourly-global-roles.yml/badge.svg)](https://github.com/AhmedNassar7/tracker/actions/workflows/hourly-global-roles.yml)",
        "[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)",
        badge("Total opportunities", total_items, "brightgreen", "data/README.md"),
        badge("Jobs", jobs_total, "16a34a", "data/README.md#jobs"),
        f"[![Last updated {now_text}](https://img.shields.io/badge/Last%20updated-{last_updated_value}-grey.svg)](LAST_UPDATED)",
    ])
    level_badges = " ".join([
        badge("Internship", internship_total, "22c55e", "data/README.md#internship"),
        badge("Early Career", early_total, "0ea5e9", "data/README.md#early-career"),
        badge("Mid-Level and Above", mid_total, "dc2626", "data/README.md#mid-level-and-above"),
        badge("Hackathons", hackathons_total, "f59e0b", "data/README.md#hackathons"),
        badge("Events", events_total, "8b5cf6", "data/README.md#events"),
    ])

    return "\n".join([
        "# tracker",
        "",
        "**A free, always-up-to-date list of software engineering jobs, internships, hackathons, and events — no sign-up, no paywall.**",
        "",
        "A robot checks top companies and public job boards every hour, so you don't have to. Everything below is refreshed automatically.",
        "",
        status_badges,
        "",
        level_badges,
        "",
        "### 👉 [**Open the full list of {} opportunities**](data/README.md)".format(total_items),
        "",
        "That page has everything: jobs, internships, hackathons, and events, each with a direct apply link. No account needed, just click and go.",
        "",
        "## Snapshot",
        "",
        f"_As of {now_text}._",
        "",
        "| Category | Count | Link |",
        "|---|---:|---|",
        f"| Internship | {internship_total} | [View](data/README.md#internship) |",
        f"| Early Career | {early_total} | [View](data/README.md#early-career) |",
        f"| Mid-Level and Above | {mid_total} | [View](data/README.md#mid-level-and-above) |",
        f"| **Jobs total** | **{jobs_total}** | [View](data/README.md#jobs) |",
        f"| Hackathons | {hackathons_total} | [View](data/README.md#hackathons) |",
        f"| Events | {events_total} | [View](data/README.md#events) |",
        f"| **Grand total** | **{total_items}** | [View](data/README.md) |",
        "",
        "## Also here",
        "",
        "- 📚 **[Career resources](data/resources.md)** — coding practice, mock interviews, resume tools, and more, for preparing"
        " applications alongside the job list.",
        "- 🛠️ **[Contributing](CONTRIBUTING.md)** — how the automation works, how to add a company or job source, and how to run it"
        " locally. Only needed if you want to help build or extend this repo.",
        "",
        "## Documentation",
        "",
        "Deeper technical docs for contributors, in [docs/](docs/):",
        "",
        "| Doc | What's in it |",
        "|---|---|",
        "| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the pipeline fits together, with system/data-flow diagrams |",
        "| [docs/DEVELOPER-GUIDE.md](docs/DEVELOPER-GUIDE.md) | Setup, every available command, naming conventions, how to add a feature or test |",
        "| [docs/FEATURES.md](docs/FEATURES.md) | Every feature, where it lives in the code, and how it works |",
        "| [docs/DIAGRAMS.md](docs/DIAGRAMS.md) | All Mermaid diagrams in one place |",
        "| [docs/DATA.md](docs/DATA.md) | Every external source, JSON record shapes, config file fields |",
        "| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | The two GitHub Actions workflows, triggers, steps, secrets |",
        "| [docs/TESTING.md](docs/TESTING.md) | Test framework, how to run tests, feature-to-test map |",
        "| [docs/DEMO.md](docs/DEMO.md) | A walkthrough script for showing this project to someone new |",
        "",
        "## License",
        "",
        "[MIT](LICENSE) — free to use, fork, and self-host.",
    ]) + "\n"


def _site_index_entry(row: dict, *, kind: str, origin: str, link_cache: dict | None = None) -> dict:
    entry = {"id": row.get("id") or "", "kind": kind, "origin": origin}
    for field in _SITE_INDEX_PASSTHROUGH:
        entry[field] = row.get(field) or ""
    # site-index.json is what the site actually fetches — normalize the
    # company name here so "Openai"/"Mongodb" (from a board slug title-cased
    # upstream) render as "OpenAI"/"MongoDB" without touching the raw feeds.
    entry["company"] = prettify_company_name(entry["company"])
    # A1 — verified-open signal. data/link-cache.json records every apply URL
    # the pipeline confirmed alive and when (net.resolve_link_liveness; only
    # positive results are cached, and a confirmed-dead curated/public link
    # was already archived/dropped before this file was written). Look it up
    # by the *raw* url, before fix_event_url() rewrites Luma's relative paths,
    # since that's the key the cache was written under. Absent from the cache
    # ⇒ "unverified" (never checked, aged out of the 7-day cache, or the last
    # check was inconclusive) — not a claim that it's dead.
    raw_url = row.get("url") or ""
    if kind != "board":
        # A "board" is a careers-search page, not a posting — "verified open"
        # doesn't apply, and its URL never goes through the liveness check.
        cache_hit = (link_cache or {}).get(raw_url)
        if isinstance(cache_hit, dict) and cache_hit.get("alive") is True and cache_hit.get("at"):
            entry["liveness"] = "verified"
            entry["last_checked"] = cache_hit["at"]
        else:
            entry["liveness"] = "unverified"
    # Resolve Luma's site-relative event paths here so every url in
    # site-index.json is always a ready-to-use absolute link — a consumer
    # (e.g. the site) shouldn't need to know which source emits relative
    # paths, same normalization fix_event_url() already applies for the
    # rendered README tables.
    entry["url"] = fix_event_url(raw_url)
    entry["posted_at"] = row.get("posted_at") or ""
    raw_age = row.get("age") or row.get("date") or ""
    # For a job, reconcile against posted_at so a frozen or placeholder "0d"
    # from the curated feed doesn't render a weeks-old listing as brand new.
    # A hackathon/event 'age' is a countdown to a deadline, not a job age —
    # leave it untouched.
    entry["age"] = reconcile_age(raw_age, entry["posted_at"]) if kind == "job" else raw_age

    location_summary, location_list = _clean_site_location(row.get("location") or "")
    entry["location"] = location_summary
    if location_list:
        entry["locations"] = location_list

    if kind == "job":
        if row.get("level"):
            entry["level"] = row["level"]
        if row.get("region"):
            entry["region"] = row["region"]
        if row.get("role_type"):
            entry["role_type"] = row["role_type"]
        # B3/B4/B5 facets — copied straight through, only when the source
        # record carries them (a posting whose text never mentioned a skill /
        # visa / salary has no key here, same absent-not-guessed rule as
        # category/remote_type below).
        if row.get("tech_tags"):
            entry["tech_tags"] = list(row["tech_tags"])
        for facet in ("visa_sponsorship", "degree_required", "relocation"):
            if isinstance(row.get(facet), bool):
                entry[facet] = row[facet]
        if isinstance(row.get("salary"), dict):
            entry["salary"] = row["salary"]
        # Country — for every job row now (G2). The curated layer already
        # detected it; for a public-layer row, run the same detector over its
        # location string here so the site's country filter isn't limited to
        # the (EU-skewed) curated set. 'Unknown'/'Remote' are kept so counts
        # stay honest; `country_flag` is '' for those.
        country = row.get("country") or detect_country(row.get("location") or "")
        entry["country"] = country
        flag = country_flag(country)
        if flag:
            entry["country_flag"] = flag

        if origin == "curated":
            # Only the curated layer detects these — leave them out entirely
            # for public-layer jobs rather than guessing a value.
            entry["category"] = row.get("category") or ""
            if row.get("remote_type"):
                entry["remote_type"] = row["remote_type"]

    return entry


def _dedupe_and_prune_site_jobs(job_items: list[dict]) -> list[dict]:
    """Two cleanups the raw curated+public concat needs before it's a good
    site feed:

    1. **Drop cross-layer exact duplicates.** A handful of postings show up
       identically in both feeds (same company, title, and url); keep the
       first (curated, which carries category/region/remote_type).
    2. **Prune stale jobs.** Same per-source freshness cut as the README
       (see filter_stale_jobs / max_age_days_for_source) — 30 days for a
       hand-maintained community tracker, 180 for a live API — so the site
       and the generated tables agree on what's live. A job with an
       unparseable age is kept (can't tell).
    """
    seen: set[tuple] = set()
    out: list[dict] = []
    for item in job_items:
        key = (item["company"].strip().lower(),
               item["title"].strip().lower(),
               item["url"].strip())
        if key in seen:
            continue
        seen.add(key)
        days = _age_to_days(item.get("age") or "")
        if days != 10**9 and days > max_age_days_for_source(item.get("source")):
            continue
        out.append(item)
    return out


def build_site_index(
    curated_payload: dict,
    public_payload: dict,
    link_cache: dict | None = None,
    aggregate_boards: list[dict] | None = None,
) -> dict:
    """Flatten both layers' raw records into one site-sized list, reusing the
    payloads main() already loaded rather than re-reading either data file.

    `link_cache` is data/link-cache.json's `entries` map ({url: {alive, at}});
    when given, each item gets a `liveness` ("verified"/"unverified") and, for
    a verified one, a `last_checked` timestamp. Defaults to {} so tests can
    call this without the cache (every item is then "unverified").

    `aggregate_boards` is load_aggregate_links()'s output — the hand-curated
    "browse every role at X" links (config/aggregate_links.yml). They ride
    along in `items` as kind:"board" so the site can render its own "Browse
    every role" section from the same one file, and are counted separately
    from real opportunities everywhere downstream.
    """
    link_cache = link_cache or {}
    job_items: list[dict] = []
    for row in curated_payload.get("jobs", []) or []:
        job_items.append(_site_index_entry(row, kind="job", origin="curated", link_cache=link_cache))
    for row in public_payload.get("jobs", []) or []:
        job_items.append(_site_index_entry(row, kind="job", origin="public", link_cache=link_cache))

    items: list[dict] = _dedupe_and_prune_site_jobs(job_items)
    for row in public_payload.get("hackathons", []) or []:
        items.append(_site_index_entry(row, kind="hackathon", origin="public", link_cache=link_cache))
    for row in public_payload.get("events", []) or []:
        items.append(_site_index_entry(row, kind="event", origin="public", link_cache=link_cache))
    for row in aggregate_boards or []:
        items.append(_site_index_entry(row, kind="board", origin="config", link_cache=link_cache))

    schema = load_schema(SITE_INDEX_SCHEMA)
    errors = validate_records(items, schema, label="site-index.json items")
    if errors:
        raise ValueError("site-index.json failed schema validation:\n" + "\n".join(errors))

    # Checksum over the sorted id set only (not full record content): cheap to
    # compute, and its only job is answering "did the set of items change
    # since last visit" for client-side diffing — not detecting in-place field
    # edits to an otherwise-unchanged posting.
    checksum = hashlib.sha256("\n".join(sorted(item["id"] for item in items)).encode("utf-8")).hexdigest()

    return {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": len(items),
        "checksum": f"sha256:{checksum}",
        "items": items,
    }


# How many rows to keep for the open-ended dimensions. A single snapshot
# stays small (~a few KB) and 90 days of them stays well under the size the
# performance budget cares about, while still being enough for "top hiring
# companies this week" / "most roles: US, then Germany" story cards.
_SNAPSHOT_TOP_N = 20
_SNAPSHOT_COUNTRY_N = 15


def summarize_snapshot_dimensions(jobs: list[dict]) -> dict:
    """Per-run counts of the published job set along the dimensions a trend
    dashboard and the D1 story cards need — D2 in docs/WEBSITE-VISION-PLAN.html
    §11.

    Every bucket is a plain ``{value: count}`` map. A missing or blank field
    goes to ``"unknown"`` (never a guessed value), so the closed dimensions
    (level/region/remote_type/role_type/category) always sum to ``len(jobs)``.
    The open-ended ones (country/company/source) are capped to their top N by
    count so the 90-day file stays bounded; those therefore sum to *at most*
    ``len(jobs)``. Pure: same input, same output, no clock or disk.
    """
    def tally(key_fn) -> dict:
        counts: dict = {}
        for job in jobs:
            key = (key_fn(job) or "").strip() or "unknown"
            counts[key] = counts.get(key, 0) + 1
        return counts

    def top_n(counts: dict, n: int) -> dict:
        return dict(sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:n])

    return {
        "by_level": tally(lambda j: j.get("level")),
        "by_region": tally(lambda j: j.get("region")),
        "by_remote_type": tally(lambda j: j.get("remote_type")),
        "by_role_type": tally(lambda j: j.get("role_type")),
        "by_category": tally(lambda j: j.get("category") or "uncategorized"),
        "by_country": top_n(tally(lambda j: j.get("country")), _SNAPSHOT_COUNTRY_N),
        "by_source": top_n(tally(lambda j: j.get("source")), _SNAPSHOT_TOP_N),
        "top_companies": top_n(tally(lambda j: j.get("company")), _SNAPSHOT_TOP_N),
    }


def update_stats_history(
    existing_history: dict, stats: dict, now_iso: str, dimensions: dict | None = None
) -> dict:
    """Append this run's snapshot to the rolling history, pruning anything
    older than STATS_HISTORY_RETENTION_DAYS. Pure — takes the previously
    written history dict (or {} if data/stats-history.json doesn't exist
    yet) rather than reading the file itself, so it's testable without disk
    I/O, matching build_site_index()'s shape.

    ``dimensions`` (from summarize_snapshot_dimensions) is stored under the
    snapshot's ``dimensions`` key when given. It's optional in the schema, so
    the pre-D2 snapshots already on disk (which have no such key) still
    validate on every subsequent run.

    This is the free time-series data the plan's website-build doc calls
    for ("a trend line built from stats.json's own git history"), built
    forward one point per hourly run instead of scraping this repo's git
    history through GitHub's rate-limited API from every site visitor's
    browser — that would hit a 60-req/hr unauthenticated ceiling shared
    across all visitors, unreliable at any real traffic. A site consuming
    this file needs nothing beyond a normal fetch, same as site-index.json.
    """
    snapshots = list(existing_history.get("snapshots", []) or [])
    snapshot = {
        "at": now_iso,
        "curated_roles": stats["curated_roles"],
        "public_opportunities": stats["public_opportunities"],
        "jobs_total": stats["jobs_total"],
        "hackathons_total": stats["hackathons_total"],
        "events_total": stats["events_total"],
        "total_items": stats["total_items"],
        "level_counts": dict(stats["level_counts"]),
    }
    if dimensions:
        snapshot["dimensions"] = dimensions
    snapshots.append(snapshot)

    # Timestamps are all "YYYY-MM-DDTHH:MM:SSZ" (fixed-width, zero-padded,
    # UTC) — the same format already relied on for lexicographic ordering
    # elsewhere in this pipeline (e.g. archive sort by closed_at), so a
    # plain string comparison against the cutoff is correct here too.
    #
    # The cutoff is computed from `now_iso`, not a fresh clock read — this
    # function takes "now" as an input specifically so it stays pure and
    # deterministic (same inputs, same output, no hidden dependency on
    # wall-clock time). Deriving the cutoff from a real `datetime.now()`
    # call here instead would silently prune anything dated more than 90
    # real-world days ago even when `now_iso` itself is a much older
    # timestamp (e.g. in a test, or a backfill) — exactly the kind of bug
    # this function's own tests are meant to catch.
    now = datetime.datetime.strptime(now_iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
    cutoff = now - datetime.timedelta(days=STATS_HISTORY_RETENTION_DAYS)
    cutoff_iso = cutoff.strftime("%Y-%m-%dT%H:%M:%SZ")
    snapshots = [s for s in snapshots if s.get("at", "") >= cutoff_iso]

    schema = load_schema(STATS_HISTORY_SCHEMA)
    errors = validate_records(snapshots, schema, label="stats-history.json snapshots")
    if errors:
        raise ValueError("stats-history.json failed schema validation:\n" + "\n".join(errors))

    return {
        "updated_at": now_iso,
        "retention_days": STATS_HISTORY_RETENTION_DAYS,
        "snapshots": snapshots,
    }


# Region code -> the phrase a story card reads it as ("Most roles in the US,
# then Europe"). Human-facing text, so it lives in the generator like every
# other string in this repo. 'remote'/'unknown' are deliberately absent — a
# "where are the roles" card is about places.
_REGION_PHRASE = {
    "us": "the US",
    "canada": "Canada",
    "emea": "Europe",
    "mena": "the Middle East & Africa",
}


def _shift_iso(iso: str, *, days: int) -> str:
    dt = datetime.datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ") + datetime.timedelta(days=days)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _dimensioned_snapshot_near(snapshots: list[dict], target_iso: str, *, before_iso: str | None = None) -> dict | None:
    """The snapshot that actually carries a `dimensions` block whose timestamp
    is closest to `target_iso`. None if none qualify.

    `before_iso` restricts candidates to snapshots strictly older than that
    timestamp — used for the "week/month ago" comparisons so a sparse history
    (only one recent dimensioned snapshot) picks a genuinely earlier point or
    nothing, never the latest snapshot itself.
    """
    dated = [s for s in snapshots if s.get("dimensions") and s.get("at")]
    if before_iso is not None:
        dated = [s for s in dated if s["at"] < before_iso]
    if not dated:
        return None
    target = datetime.datetime.strptime(target_iso, "%Y-%m-%dT%H:%M:%SZ")
    return min(
        dated,
        key=lambda s: abs(datetime.datetime.strptime(s["at"], "%Y-%m-%dT%H:%M:%SZ") - target),
    )


def _pct_change(now_val: int, then_val) -> int | None:
    if not then_val:
        return None
    return round((now_val - then_val) / then_val * 100)


def build_story_cards(history: dict, now_iso: str) -> dict:
    """3–4 auto-generated "state of hiring" cards (D1, docs/WEBSITE-VISION-PLAN
    §11) built from stats-history.json's own `dimensions` — the kind of
    screenshot-friendly stat card the plan wants, with a click-through into a
    pre-filtered list.

    Pure. Each card is ``{id, title, detail, filter}`` where ``filter`` is a
    partial site FilterState the client applies on click (``{}`` = just jump
    to the list). Only cards with real backing data are emitted; a history
    with no dimensioned snapshot yields an empty list, and any week-/month-
    over comparison is simply dropped (not faked) when there's no earlier
    dimensioned snapshot to compare against.
    """
    snapshots = list(history.get("snapshots", []) or [])
    latest = _dimensioned_snapshot_near(snapshots, now_iso)
    cards: list[dict] = []
    if latest is None:
        return {"generated_at": now_iso, "cards": cards}

    dims = latest.get("dimensions", {})
    week_ago = _dimensioned_snapshot_near(snapshots, _shift_iso(latest["at"], days=-7), before_iso=latest["at"])
    month_ago = _dimensioned_snapshot_near(snapshots, _shift_iso(latest["at"], days=-30), before_iso=latest["at"])

    # 1 — total open roles, with a week-over-week delta when we have one.
    total = latest.get("jobs_total", 0)
    detail = f"{total:,} open software roles"
    if week_ago is not None:
        delta = total - week_ago.get("jobs_total", 0)
        if delta:
            detail += f" · {'+' if delta > 0 else '−'}{abs(delta):,} since last week"
    cards.append({"id": "roles-total", "title": "Roles right now", "detail": detail, "filter": {}})

    # 2 — internships, with a month-over-month % move when available.
    now_int = (dims.get("by_level") or {}).get("internship", 0)
    if now_int:
        detail = f"{now_int:,} internships open"
        if month_ago is not None:
            then_int = (month_ago.get("dimensions", {}).get("by_level") or {}).get("internship")
            pct = _pct_change(now_int, then_int)
            if pct is not None and abs(pct) >= 3:
                detail += f" · {'up' if pct > 0 else 'down'} {abs(pct)}% this month"
        cards.append({
            "id": "internships", "title": "Internships", "detail": detail,
            "filter": {"kind": "job", "levels": ["internship"]},
        })

    # 3 — the companies posting the most right now (card click filters to them).
    top = [name for name, _ in list((dims.get("top_companies") or {}).items())[:3]]
    if top:
        cards.append({
            "id": "top-companies", "title": "Hiring most this week",
            "detail": ", ".join(top), "filter": {"kind": "job", "companies": top},
        })

    # 4 — where the roles are (by region, skipping remote/unknown).
    regions = [r for r, _ in (dims.get("by_region") or {}).items() if r in _REGION_PHRASE]
    regions.sort(key=lambda r: -(dims.get("by_region") or {}).get(r, 0))
    if regions:
        if len(regions) >= 2:
            detail = f"Most roles in {_REGION_PHRASE[regions[0]]}, then {_REGION_PHRASE[regions[1]]}"
        else:
            detail = f"Most roles in {_REGION_PHRASE[regions[0]]}"
        cards.append({
            "id": "geography", "title": "Where the roles are", "detail": detail,
            "filter": {"kind": "job", "regions": [regions[0]]},
        })

    # 5 — remote share (only if there's room after the four above).
    remote_by = dims.get("by_remote_type") or {}
    remote_total = sum(remote_by.values())
    if remote_total and remote_by.get("remote"):
        pct = round(remote_by["remote"] / remote_total * 100)
        cards.append({
            "id": "remote-share", "title": "Remote", "detail": f"{pct}% of roles are fully remote",
            "filter": {"kind": "job", "remotes": ["remote"]},
        })

    cards = cards[:4]
    schema = load_schema(STORY_CARDS_SCHEMA)
    errors = validate_records(cards, schema, label="story-cards.json cards")
    if errors:
        raise ValueError("story-cards.json failed schema validation:\n" + "\n".join(errors))
    return {"generated_at": now_iso, "cards": cards}


def main() -> int:
    curated_payload = load_json(CURATED_JSON)
    public_payload = load_json(PUBLIC_JSON)
    curated_jobs = normalize_rows(curated_payload.get("jobs", []), "curated")
    public_jobs = normalize_rows(public_payload.get("jobs", []), "public")
    hackathons = public_payload.get("hackathons", []) or []
    events = public_payload.get("events", []) or []

    all_jobs = curated_jobs + public_jobs
    
    # Filter stale jobs first to get accurate counts
    jobs_by_bucket = {"internship": [], "early_career": [], "mid_level": []}
    for row in all_jobs:
        jobs_by_bucket[level_bucket(row["level"])].append(row)
    
    internship_bucket = filter_stale_jobs(jobs_by_bucket["internship"])
    early_bucket = filter_stale_jobs(jobs_by_bucket["early_career"])
    mid_bucket = filter_stale_jobs(jobs_by_bucket["mid_level"])
    
    filtered_jobs = internship_bucket + early_bucket + mid_bucket
    

    level_counts = {
        "internship": len(internship_bucket),
        "early_career": len(early_bucket),
        "mid_level": len(mid_bucket),
    }
    stats = {
        "curated_roles": len(curated_jobs),
        "public_opportunities": len(public_jobs) + len(hackathons) + len(events),
        "jobs_total": len(filtered_jobs),
        "hackathons_total": len(hackathons),
        "events_total": len(events),
        "total_items": len(filtered_jobs) + len(hackathons) + len(events),
        "level_counts": level_counts,
    }

    boards = load_aggregate_links()

    now_text = datetime.date.today().isoformat()
    DATA_OUT.mkdir(parents=True, exist_ok=True)
    DATA_README.write_text(render_data_readme(now_text, stats, all_jobs, hackathons, events, boards), encoding="utf-8")
    ROOT_README.write_text(render_root_readme(now_text, stats), encoding="utf-8")
    print(f"Wrote {DATA_README}")
    print(f"Wrote {ROOT_README}")

    site_index = build_site_index(
        curated_payload, public_payload, load_link_cache(LINK_CACHE_JSON), boards
    )
    SITE_INDEX_JSON.write_text(json.dumps(site_index, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {SITE_INDEX_JSON} ({site_index['count']} items)")

    now_iso = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    dimensions = summarize_snapshot_dimensions(filtered_jobs)
    stats_history = update_stats_history(load_json(STATS_HISTORY_JSON), stats, now_iso, dimensions)
    STATS_HISTORY_JSON.write_text(json.dumps(stats_history, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {STATS_HISTORY_JSON} ({len(stats_history['snapshots'])} snapshots)")

    story_cards = build_story_cards(stats_history, now_iso)
    STORY_CARDS_JSON.write_text(json.dumps(story_cards, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {STORY_CARDS_JSON} ({len(story_cards['cards'])} cards)")

    feed_paths = write_feeds(site_index["items"], site_index["generated_at"], FEEDS_DIR)
    print(f"Wrote {len(feed_paths)} RSS feeds to {FEEDS_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
