from __future__ import annotations

import json


def write_public_outputs(rows, *, data_out, now_iso, sort_key, log_info):
    rows = sorted(rows, key=sort_key)
    jobs = [row for row in rows if row.get("kind") == "job"]
    hackathons = [row for row in rows if row.get("kind") == "hackathon"]
    events = [row for row in rows if row.get("kind") == "event"]

    json_path = data_out / "public-opportunities.json"
    payload = {
        "generated_at": now_iso,
        "total": len(rows),
        "jobs": jobs,
        "hackathons": hackathons,
        "events": events,
    }
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    log_info(f"Exported {json_path}")

    md_path = data_out / "public-opportunities.md"
    lines = [
        "# Public Opportunities",
        "",
        f"Generated at: {now_iso}",
        "",
        f"Total: {len(rows)}",
        "",
        "## Jobs",
    ]

    if jobs:
        for row in jobs:
            company = row.get("company") or "Unknown"
            title = row.get("title") or "Untitled"
            location = row.get("location") or "Unknown"
            date = row.get("date") or ""
            url = row.get("url") or ""
            suffix = f" - {date}" if date else ""
            lines.append(f"- [{company} - {title}]({url}) ({location}){suffix}")
    else:
        lines.append("- None")

    lines.extend(["", "## Hackathons"])
    if hackathons:
        for row in hackathons:
            title = row.get("title") or "Untitled"
            date = row.get("date") or ""
            url = row.get("url") or ""
            suffix = f" - {date}" if date else ""
            lines.append(f"- [{title}]({url}){suffix}")
    else:
        lines.append("- None")

    lines.extend(["", "## Events"])
    if events:
        for row in events:
            title = row.get("title") or "Untitled"
            date = row.get("date") or ""
            url = row.get("url") or ""
            suffix = f" - {date}" if date else ""
            lines.append(f"- [{title}]({url}){suffix}")
    else:
        lines.append("- None")

    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    log_info(f"Exported {md_path}")
