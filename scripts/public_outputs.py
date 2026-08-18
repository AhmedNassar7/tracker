from __future__ import annotations

import json
from pathlib import Path

from net import run_concurrently
from schema_validator import load_schema, validate_records

PUBLIC_ENTRY_SCHEMA = load_schema(Path(__file__).resolve().parent.parent / "config" / "public-entry.schema.json")


def write_public_outputs(rows, *, data_out, now_iso, sort_key, log_info, log_error, check_url_alive=None):
    rows = sorted(rows, key=sort_key)
    jobs = [row for row in rows if row.get("kind") == "job"]
    hackathons = [row for row in rows if row.get("kind") == "hackathon"]
    events = [row for row in rows if row.get("kind") == "event"]

    # Validate shape first — cheap, no network — before the dead-link check
    # below spends a real HTTP request on a row that's going to be rejected
    # anyway. Mirrors write_fetch_outputs' ordering in fetch_outputs.py.
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

    # Confirm every link is actually reachable before publishing — the same
    # liveness policy the curated layer already applies (only a
    # GET-confirmed 404/410 counts as dead; everything else, including a
    # timeout or bot-block, is "can't tell, assume alive" so a flaky check
    # never wrongly drops a live posting). This layer never ran this check
    # before, even though it's where most published listings come from
    # (Greenhouse/Lever/Workday/Ashby/SmartRecruiters/Devpost/Unstop/
    # Devfolio/Luma). `check_url_alive=None` (the default) skips the check
    # entirely — same opt-in shape as write_fetch_outputs — so tests can
    # call this without triggering real network calls; public_sources.py's
    # real run always passes it.
    if check_url_alive is not None and rows:
        alive_calls = [(row.get("url") or "",) for row in rows]
        checked = run_concurrently(check_url_alive, alive_calls, max_workers=20)
        live_rows = []
        dead_count = 0
        for row, (_args, alive, exc) in zip(rows, checked):
            if exc is not None:
                # check_url_alive itself never raises (it has a catch-all
                # "assume alive" fallback) — this only fires if that
                # contract changes later. Same safe default it uses.
                log_error(f"Dead-link check failed for {row.get('url')}: {exc}")
                live_rows.append(row)
                continue
            if alive:
                live_rows.append(row)
            else:
                dead_count += 1
                log_info(f"Dead link, dropping: {row.get('company')} - {row.get('title')} ({row.get('url')})")
        if dead_count:
            log_info(f"Dropped {dead_count} dead link(s) before publishing public-opportunities.json")
        rows = live_rows
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
