#!/usr/bin/env python3
from __future__ import annotations

import datetime
import json
import re
from urllib.parse import quote
from pathlib import Path

ROOT = Path(__file__).parent.parent
DATA_OUT = ROOT / "data"

CURATED_JSON = DATA_OUT / "jobs-global.json"
PUBLIC_JSON = DATA_OUT / "public-opportunities.json"
ROOT_README = ROOT / "README.md"
DATA_README = DATA_OUT / "README.md"


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
        "The tables above are enough for most people — the files below are the raw data behind them,"
        " useful if you want to build something on top of this list (a script, a bot, your own site).",
        "",
        "| File | What it contains |",
        "|---|---|",
        "| [jobs-global.json](jobs-global.json) | Curated jobs: Remotive, ArbeitNow, SimplifyJobs, filtered to the top-tier company allowlist |",
        "| [jobs-global-archive.json](jobs-global-archive.json) | Curated jobs that have since closed, gone dead-link, or rolled off the source feed |",
        "| [jobs-global-latest.md](jobs-global-latest.md) | Human-readable view of the curated feed only, without the public-board jobs |",
        "| [public-opportunities.json](public-opportunities.json) | Public-board jobs, hackathons, and events: Greenhouse, Lever, Ashby, SmartRecruiters, Devpost, Luma |",
        "| [public-opportunities.md](public-opportunities.md) | Human-readable view of the public-board feed only |",
        "| [stats.json](stats.json) | Counts of the curated feed broken down by level, country, and source |",
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
        "## Contents",
        "",
        "- [Start here](#start-here)",
        "- [Snapshot](#snapshot)",
        "- [Career resources](#career-resources)",
        "- [How it works](#how-it-works)",
        "- [Contributing](#contributing)",
        "- [Repository layout](#repository-layout)",
        "- [License](#license)",
        "",
        "## Start here",
        "",
        f"### 👉 [**Open the full list of {total_items} opportunities**](data/README.md)",
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
        "## Career resources",
        "",
        "Free, well-known resources people use alongside this list to prepare for software engineering interviews at FAANG and other"
        " top tech companies:",
        "",
        "| Resource | What it's for |",
        "|---|---|",
        "| [NeetCode](https://neetcode.io/) | Coding interview problems organized by pattern, with free video explanations |",
        "| [Grind75](https://www.grind75.com/) | A free, prioritized coding-interview study plan (the spiritual successor to Blind75) |",
        "| [Tech Interview Handbook](https://www.techinterviewhandbook.org/) | Free guide covering resumes, behavioral questions, and interview strategy |",
        "| [System Design Primer](https://github.com/donnemartin/system-design-primer) | The most-starred free guide to system design interviews |",
        "| [Levels.fyi](https://www.levels.fyi/) | Crowdsourced compensation data to benchmark and negotiate offers |",
        "",
        "That's the five most-used ones. [**See the full resource catalog →**](data/resources.md) for mock interviews, resume tools,"
        " open-source fellowships, learning platforms, and more.",
        "",
        "## How it works",
        "",
        "1. **Fetch** — [scripts/fetch.py](scripts/fetch.py) pulls Remotive, ArbeitNow, SimplifyJobs, speedyapply, zapplyjobs, hanzili,"
        " and ambicuity, filtered by the companies in [config/companies_allowlist.yml](config/companies_allowlist.yml)."
        " [scripts/public_sources.py](scripts/public_sources.py) widens coverage with Devpost, Luma, Greenhouse, Lever, and Workday"
        " (all auto-discovered from those results), plus Ashby and SmartRecruiters for the companies listed in"
        " [config/extra_job_boards.yml](config/extra_job_boards.yml). Every apply link is checked before publishing, and dead ones are"
        " moved to the archive automatically.",
        "2. **Build** — [scripts/build_data_readme.py](scripts/build_data_readme.py) turns the raw JSON in [data/](data/) into the readable"
        " tables in this file and in [data/README.md](data/README.md).",
        "3. **Publish** — a [GitHub Actions workflow](.github/workflows/hourly-global-roles.yml) runs this pipeline hourly, opens a pull request"
        " with whatever changed, and auto-merges it. No manual steps.",
        "",
        "Curious about a specific run? Check the [workflow runs](https://github.com/AhmedNassar7/tracker/actions/workflows/hourly-global-roles.yml)"
        " or the day-by-day notes in [log/](log/).",
        "",
        "## Contributing",
        "",
        "- **Track one more company** on a platform we already support (Ashby or SmartRecruiters) — add its board token to"
        " [config/extra_job_boards.yml](config/extra_job_boards.yml). Greenhouse, Lever, and Workday companies need no config at all;"
        " they're picked up automatically the first time one of their postings shows up from another source.",
        "- **Change which companies are accepted** — edit [config/companies_allowlist.yml](config/companies_allowlist.yml). Both of these are"
        " plain YAML lists, no coding required.",
        "- **Add a brand-new job board/API** (like Remotive or SimplifyJobs) — this needs a short fetcher function in"
        " [scripts/fetch.py](scripts/fetch.py) or [scripts/public_sources.py](scripts/public_sources.py), since each API has its own shape.",
        "",
        "Not comfortable writing YAML or Python? Open an issue with the company or board name and someone will add it. Pull requests"
        " run through [CI](.github/workflows/ci.yml) automatically — the test suite (`python tests/test_fetch.py` and"
        " `python tests/test_public_sources.py`) needs to pass before merging.",
        "",
        "## Repository layout",
        "",
        "Job seekers only need [data/README.md](data/README.md). Everything else here is for anyone who"
        " wants to understand, run, or contribute to the pipeline that builds it:",
        "",
        "| Path | What's in it |",
        "|---|---|",
        "| [data/README.md](data/README.md) | The combined, human-readable table of every open opportunity |",
        "| [data/resources.md](data/resources.md) | Hand-curated career resources: coding practice, mock interviews, resume tools, and more |",
        "| [data/](data/) | Raw JSON/Markdown the tables above are generated from — see [Source Files](data/README.md#source-files) |",
        "| [config/companies_allowlist.yml](config/companies_allowlist.yml) | Which companies' listings are accepted (edit this, no coding required) |",
        "| [config/extra_job_boards.yml](config/extra_job_boards.yml) | Ashby/SmartRecruiters companies to track (edit this, no coding required) |",
        "| [config/sources.yml](config/sources.yml) | Reference docs for the APIs the pipeline calls — not read by the code itself |",
        "| [config/job-entry.schema.json](config/job-entry.schema.json) | JSON Schema describing the shape of each job record, for anyone building on top of the data |",
        "| [scripts/](scripts/) | The fetch/build pipeline (Python, standard library only — no dependencies to install) |",
        "| [tests/](tests/) | Automated tests for the pipeline scripts, run in CI on every pull request |",
        "| [.github/workflows/](.github/workflows/) | The hourly refresh job and the CI test job |",
        "| [log/](log/) | One line per automated run, grouped by month — a history of when data was refreshed |",
        "",
        "## License",
        "",
        "[MIT](LICENSE) — free to use, fork, and self-host.",
        "",
        "## Notes",
        "",
        "- This README and [data/README.md](data/README.md) are generated files — edits should go through"
        " [scripts/build_data_readme.py](scripts/build_data_readme.py) so they survive the next automated run.",
        "- Raw JSON stays separate from the Markdown views so either can be consumed independently.",
    ]) + "\n"


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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
