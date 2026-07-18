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
