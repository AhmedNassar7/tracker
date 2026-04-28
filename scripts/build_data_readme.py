#!/usr/bin/env python3
from __future__ import annotations

import datetime
import json
import re
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


def normalize_rows(rows: list[dict], origin: str) -> list[dict]:
    normalized: list[dict] = []
    for row in rows:
        normalized.append(
            {
                "origin": origin,
                "company": row.get("company") or "",
                "title": row.get("title") or "",
                "location": row.get("location") or "",
                "age": row.get("age") or row.get("date") or "",
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
    safe_label = label.replace(" ", "%20")
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


def table_rows(rows: list[dict]) -> list[str]:
    lines: list[str] = []
    for row in rows:
        company = clean_cell(row["company"])
        title = clean_cell(row["title"])
        location = clean_cell(row["location"])
        age = clean_cell(row["age"])
        age_formatted = format_age(age)
        lines.append(
            f"| {company} | [{title}]({row['url']}) | {location} | {age_formatted} |"
        )
    return lines


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
        f"**Last Updated:** {now_text}",
        "",
        "This is the single data page for all tables. Use the links below to jump to each table.",
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
        f"| Curated roles | {stats['curated_roles']} |",
        f"| Public opportunities | {stats['public_opportunities']} |",
        f"| Jobs | {stats['jobs_total']} |",
        f"| Hackathons | {len(hackathons)} |",
        f"| Events | {len(events)} |",
        f"| Total | {stats['total_items']} |",
        "",
        "## Jobs",
        "",
        f"{badge('Jobs', stats['jobs_total'], 'brightgreen', '#jobs')} {badge('Levels', 3, 'blue', '#jobs')} {badge('Internship', len(internship_rows), '22c55e', '#internship')} {badge('Early Career', len(early_rows), '0ea5e9', '#early-career')} {badge('Mid-Level and Above', len(mid_rows), 'ef4444', '#mid-level-and-above')}",
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
        "| Organizer | Hackathon | Location | Timeline |",
        "|---|---|---|---|",
    ])
    for row in hackathons:
        location = row.get("location") or "Various"
        timeline = row.get("date") or ""
        lines.append(f"| {row['company']} | [{row['title']}]({row['url']}) | {location} | {timeline} |")

    lines.extend([
        "",
        "## Events",
        "",
        f"Total events: {len(events)}",
        "",
        "| Organizer | Event | Location |",
        "|---|---|---|",
    ])
    for row in events:
        location = row.get("location") or "Global"
        lines.append(f"| {row['company']} | [{row['title']}]({row['url']}) | {location} |")

    lines.extend([
        "",
        "## Source Files",
        "",
        "| File | What it contains |",
        "|---|---|",
        "| [jobs-global.json](jobs-global.json) | Curated raw data |",
        "| [public-opportunities.json](public-opportunities.json) | Public raw data |",
        "",
        "## Notes",
        "",
        "- Use [README.md](../README.md) as the root entry point.",
        "- Tables are merged from the curated and public feeds.",
        "- The combined page is rebuilt from JSON outputs.",
    ])
    return "\n".join(lines) + "\n"


def render_root_readme(stats: dict) -> str:
    curated_total = stats["curated_roles"]
    public_total = stats["public_opportunities"]
    jobs_total = stats["jobs_total"]
    total_items = stats["total_items"]
    internship_total = stats["level_counts"]["internship"]
    early_total = stats["level_counts"]["early_career"]
    mid_total = stats["level_counts"]["mid_level"]

    badges = " ".join([
        "[![Daily Global Tech Roles PR](https://github.com/AhmedNassar7/tracker/actions/workflows/daily-activity.yml/badge.svg)](https://github.com/AhmedNassar7/tracker/actions/workflows/daily-activity.yml)",
        badge("Total opportunities", total_items, "brightgreen", "data/README.md"),
        badge("Jobs", jobs_total, "16a34a", "data/README.md#jobs"),
        badge("Curated roles", curated_total, "2563eb", "data/README.md#source-files"),
        badge("Public opportunities", public_total, "7c3aed", "data/README.md#source-files"),
    ])
    level_badges = " ".join([
        badge("Internship", internship_total, "22c55e", "data/README.md#internship"),
        badge("Early Career", early_total, "0ea5e9", "data/README.md#early-career"),
        badge("Mid-Level and Above", mid_total, "ef4444", "data/README.md#mid-level-and-above"),
        badge("Hackathons", 2, "f59e0b", "data/README.md#hackathons"),
        badge("Events", 7, "8b5cf6", "data/README.md#events"),
    ])

    return "\n".join([
        "# tracker",
        "",
        badges,
        "",
        level_badges,
        "",
        "Daily automated pipeline tracking software engineering opportunities from curated top-tier companies and public job boards.",
        "",
        "## Start Here",
        "",
        "Open [data/README.md](data/README.md) for the combined data page with all tables and links.",
        "",
        "## Snapshot",
        "",
        "| Category | Count |",
        "|---|---:|",
        f"| Curated roles | {curated_total} |",
        f"| Public opportunities | {public_total} |",
        f"| Jobs | {jobs_total} |",
        f"| Hackathons | 2 |",
        f"| Events | 7 |",
        f"| Total | {total_items} |",
        "",
        "## Navigation",
        "",
        "- [Combined data page](data/README.md)",
        "- [Jobs tables](data/README.md#jobs)",
        "- [Internship table](data/README.md#internship)",
        "- [Early career table](data/README.md#early-career)",
        "- [Mid-level and above table](data/README.md#mid-level-and-above)",
        "- [Hackathons table](data/README.md#hackathons)",
        "- [Events table](data/README.md#events)",
        "",
        "## Notes",
        "",
        "- The data page is generated from the JSON outputs in `data/`.",
        "- Raw JSON stays separate from the single Markdown view.",
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
    

    all_jobs = curated_jobs + public_jobs
    level_counts = {
        "internship": len(internship_bucket),
        "early_career": len(early_bucket),
        "mid_level": len(mid_bucket),
    }
    stats = {
        "curated_roles": len(curated_jobs),
        "public_opportunities": len(public_jobs) + len(hackathons) + len(events),
        "jobs_total": len(filtered_jobs),
        "total_items": len(filtered_jobs) + len(hackathons) + len(events),
        "level_counts": level_counts,
    }

    now_text = datetime.date.today().isoformat()
    DATA_OUT.mkdir(parents=True, exist_ok=True)
    DATA_README.write_text(render_data_readme(now_text, stats, all_jobs, hackathons, events), encoding="utf-8")
    ROOT_README.write_text(render_root_readme(stats), encoding="utf-8")
    print(f"Wrote {DATA_README}")
    print(f"Wrote {ROOT_README}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
