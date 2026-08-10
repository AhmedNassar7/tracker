from __future__ import annotations

import json
from pathlib import Path

from schema_validator import load_schema, validate_records

PUBLIC_ENTRY_SCHEMA = load_schema(Path(__file__).resolve().parent.parent / "config" / "public-entry.schema.json")


def write_public_outputs(rows, *, data_out, now_iso, sort_key, log_info, log_error):
    rows = sorted(rows, key=sort_key)
    jobs = [row for row in rows if row.get("kind") == "job"]
    hackathons = [row for row in rows if row.get("kind") == "hackathon"]
    events = [row for row in rows if row.get("kind") == "event"]

    validation_errors = validate_records(jobs, PUBLIC_ENTRY_SCHEMA, label="public-opportunities.json jobs")
    validation_errors += validate_records(hackathons, PUBLIC_ENTRY_SCHEMA, label="public-opportunities.json hackathons")
    validation_errors += validate_records(events, PUBLIC_ENTRY_SCHEMA, label="public-opportunities.json events")
    if validation_errors:
        for err in validation_errors[:20]:
            log_error(f"Schema validation: {err}")
        raise ValueError(
            f"Schema validation failed for {len(validation_errors)} field(s) across "
            f"public-opportunities.json — see logged errors above"
        )

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
