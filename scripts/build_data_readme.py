#!/usr/bin/env python3
from __future__ import annotations

import datetime
import hashlib
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

CURATED_JSON = DATA_OUT / "jobs-global.json"
PUBLIC_JSON = DATA_OUT / "public-opportunities.json"
ROOT_README = ROOT / "README.md"
DATA_README = DATA_OUT / "README.md"
SITE_INDEX_JSON = DATA_OUT / "site-index.json"
SITE_INDEX_SCHEMA = ROOT / "config" / "site-index.schema.json"
STATS_HISTORY_JSON = DATA_OUT / "stats-history.json"
STATS_HISTORY_SCHEMA = ROOT / "config" / "stats-history.schema.json"
# One point per hourly run; 90 days keeps the file bounded (~2,160 points at
# worst) while covering enough history for a meaningful trend line.
STATS_HISTORY_RETENTION_DAYS = 90
FEEDS_DIR = DATA_OUT / "feeds"

# Fields copied straight through when present; curated-only fields (category,
# remote_type, country) and the level/region/role_type job fields are added
# separately per-kind so we never fabricate a key an origin layer doesn't have.
_SITE_INDEX_PASSTHROUGH = ("company", "title", "location", "source", "source_url")


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


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
        
        normalized.append(
            {
                "origin": origin,
                "company": row.get("company") or "",
                "title": row.get("title") or "",
                "location": row.get("location") or "",
                "age": age,
                "level": row.get("level") or "other",
                "url": row.get("url") or "",
                "source": row.get("source") or "",
                "posted_at": row.get("posted_at") or "",
                "kind": row.get("kind") or "job",
            }
        )
    return normalized


def level_bucket(level: str) -> str:
    if level == "internship":
        return "internship"
    if level in {"new_grad", "junior", "entry_level"}:
        return "early_career"
    return "mid_level"


def sort_jobs(rows: list[dict]) -> list[dict]:
    def key(row: dict) -> tuple:
        age = (row.get("age") or "").strip().lower()
        if age.endswith("d") and age[:-1].isdigit():
            age_days = int(age[:-1])
        elif age.endswith("mo") and age[:-2].isdigit():
            age_days = int(age[:-2]) * 30
        else:
            age_days = 10**9
        return (age_days, (row.get("company") or "").lower(), (row.get("title") or "").lower())

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


def filter_stale_jobs(rows: list[dict]) -> list[dict]:
    """Remove jobs older than 6 months (180 days)."""
    filtered: list[dict] = []
    for row in rows:
        age = (row.get("age") or "").strip().lower()
        
        # Parse age into days
        if age.endswith("d") and age[:-1].isdigit():
            age_days = int(age[:-1])
        elif age.endswith("mo") and age[:-2].isdigit():
            age_days = int(age[:-2]) * 30
        else:
            filtered.append(row)  # Keep if unparseable
            continue
        
        # Keep only jobs <= 180 days old
        if age_days <= 180:
            filtered.append(row)
    
    return filtered


def badge(label: str, value: int, color: str, link: str) -> str:
    safe_label = quote(label, safe="").replace("-", "--")
    return f"[![{label} {value}](https://img.shields.io/badge/{safe_label}-{value}-{color}.svg)]({link})"


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
        
        lines.append(
            f"| {company} | [{title}]({row['url']}) | {location_display} | {age_formatted} |"
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


def render_data_readme(now_text: str, stats: dict, all_jobs: list[dict], hackathons: list[dict], events: list[dict]) -> str:
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
        "## Emoji Guide",
        "",
        "| Emoji | Meaning |",
        "|---|---|",
        "| 🎓 | PhD or advanced degree required |",
        "| 🇺🇸 | US only |",
        "| 🛂 | Visa sponsorship |",
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

    lines.extend([
        "",
        "## Hackathons",
        "",
        f"Total hackathons: {len(hackathons)}",
        "",
        "| Organizer | Hackathon |",
        "|---|---|",
    ])
    for row in hackathons:
        lines.append(f"| {row['company']} | [{row['title']}]({row['url']}) |")

    lines.extend([
        "",
        "## Events",
        "",
        f"Total events: {len(events)}",
        "",
        "| Organizer | Event |",
        "|---|---|",
    ])
    for row in events:
        event_name = simplify_event_name(row.get("title") or "")
        event_url = fix_event_url(row.get("url") or "")
        lines.append(f"| {row['company']} | [{event_name}]({event_url}) |")

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


def _site_index_entry(row: dict, *, kind: str, origin: str) -> dict:
    entry = {"id": row.get("id") or "", "kind": kind, "origin": origin}
    for field in _SITE_INDEX_PASSTHROUGH:
        entry[field] = row.get(field) or ""
    # Resolve Luma's site-relative event paths here so every url in
    # site-index.json is always a ready-to-use absolute link — a consumer
    # (e.g. the site) shouldn't need to know which source emits relative
    # paths, same normalization fix_event_url() already applies for the
    # rendered README tables.
    entry["url"] = fix_event_url(row.get("url") or "")
    entry["age"] = row.get("age") or row.get("date") or ""
    entry["posted_at"] = row.get("posted_at") or ""

    if kind == "job":
        if row.get("level"):
            entry["level"] = row["level"]
        if row.get("region"):
            entry["region"] = row["region"]
        if row.get("role_type"):
            entry["role_type"] = row["role_type"]
        if origin == "curated":
            # Only the curated layer detects these — leave them out entirely
            # for public-layer jobs rather than guessing a value.
            entry["category"] = row.get("category") or ""
            if row.get("remote_type"):
                entry["remote_type"] = row["remote_type"]
            if row.get("country"):
                entry["country"] = row["country"]

    return entry


def build_site_index(curated_payload: dict, public_payload: dict) -> dict:
    """Flatten both layers' raw records into one site-sized list, reusing the
    payloads main() already loaded rather than re-reading either data file.
    """
    items: list[dict] = []
    for row in curated_payload.get("jobs", []) or []:
        items.append(_site_index_entry(row, kind="job", origin="curated"))
    for row in public_payload.get("jobs", []) or []:
        items.append(_site_index_entry(row, kind="job", origin="public"))
    for row in public_payload.get("hackathons", []) or []:
        items.append(_site_index_entry(row, kind="hackathon", origin="public"))
    for row in public_payload.get("events", []) or []:
        items.append(_site_index_entry(row, kind="event", origin="public"))

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


def update_stats_history(existing_history: dict, stats: dict, now_iso: str) -> dict:
    """Append this run's snapshot to the rolling history, pruning anything
    older than STATS_HISTORY_RETENTION_DAYS. Pure — takes the previously
    written history dict (or {} if data/stats-history.json doesn't exist
    yet) rather than reading the file itself, so it's testable without disk
    I/O, matching build_site_index()'s shape.

    This is the free time-series data the plan's website-build doc calls
    for ("a trend line built from stats.json's own git history"), built
    forward one point per hourly run instead of scraping this repo's git
    history through GitHub's rate-limited API from every site visitor's
    browser — that would hit a 60-req/hr unauthenticated ceiling shared
    across all visitors, unreliable at any real traffic. A site consuming
    this file needs nothing beyond a normal fetch, same as site-index.json.
    """
    snapshots = list(existing_history.get("snapshots", []) or [])
    snapshots.append(
        {
            "at": now_iso,
            "curated_roles": stats["curated_roles"],
            "public_opportunities": stats["public_opportunities"],
            "jobs_total": stats["jobs_total"],
            "hackathons_total": stats["hackathons_total"],
            "events_total": stats["events_total"],
            "total_items": stats["total_items"],
            "level_counts": dict(stats["level_counts"]),
        }
    )

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

    now_text = datetime.date.today().isoformat()
    DATA_OUT.mkdir(parents=True, exist_ok=True)
    DATA_README.write_text(render_data_readme(now_text, stats, all_jobs, hackathons, events), encoding="utf-8")
    ROOT_README.write_text(render_root_readme(now_text, stats), encoding="utf-8")
    print(f"Wrote {DATA_README}")
    print(f"Wrote {ROOT_README}")

    site_index = build_site_index(curated_payload, public_payload)
    SITE_INDEX_JSON.write_text(json.dumps(site_index, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {SITE_INDEX_JSON} ({site_index['count']} items)")

    now_iso = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    stats_history = update_stats_history(load_json(STATS_HISTORY_JSON), stats, now_iso)
    STATS_HISTORY_JSON.write_text(json.dumps(stats_history, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {STATS_HISTORY_JSON} ({len(stats_history['snapshots'])} snapshots)")

    feed_paths = write_feeds(site_index["items"], site_index["generated_at"], FEEDS_DIR)
    print(f"Wrote {len(feed_paths)} RSS feeds to {FEEDS_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
