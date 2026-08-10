from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from net import run_concurrently
from schema_validator import load_schema, validate_records

JOB_ENTRY_SCHEMA = load_schema(Path(__file__).resolve().parent.parent / "config" / "job-entry.schema.json")


def _job_compare_payload(row):
    return {
        "id": row.get("id"),
        "company": row.get("company"),
        "title": row.get("title"),
        "level": row.get("level"),
        "category": row.get("category"),
        "region": row.get("region"),
        "role_type": row.get("role_type"),
        "country": row.get("country"),
        "location": row.get("location"),
        "remote_type": row.get("remote_type"),
        "url": row.get("url"),
        "source": row.get("source"),
        "source_url": row.get("source_url"),
        "tags": row.get("tags"),
    }


def _job_signature(row):
    return json.dumps(_job_compare_payload(row), sort_keys=True, ensure_ascii=False)


def _load_jobs_payload(path):
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    jobs = payload.get("jobs", [])
    return jobs if isinstance(jobs, list) else []


def write_fetch_outputs(
    rows,
    *,
    data_out,
    now_iso,
    public_job_record,
    job_sort_key,
    log_info,
    log_error,
    check_url_alive=None,
):
    rows = sorted(rows, key=job_sort_key)
    public_rows = [public_job_record(row) for row in rows]

    # Validate what THIS run's fetch + normalize + public_job_record actually
    # produced, before it's merged with previously-written data below.
    # Deliberately scoped to only these freshly computed rows, not the merged
    # active/archive lists further down: those carry forward rows written by
    # past runs verbatim when unchanged (including rows written before this
    # validator existed, or before a field was even added to the schema) —
    # re-validating that inherited history every run would mean one old row
    # permanently blocks every future run instead of catching an actual bug
    # in today's code, which is what this check exists to do.
    validation_errors = validate_records(public_rows, JOB_ENTRY_SCHEMA, label="jobs-global.json jobs")
    if validation_errors:
        for err in validation_errors[:20]:
            log_error(f"Schema validation: {err}")
        raise ValueError(
            f"Schema validation failed for {len(validation_errors)} field(s) in this run's "
            f"freshly fetched rows — see logged errors above"
        )

    active_file = data_out / "jobs-global.json"
    archive_file = data_out / "jobs-global-archive.json"
    previous_active_rows = _load_jobs_payload(active_file)
    previous_archive_rows = _load_jobs_payload(archive_file)
    previous_active_by_id = {row.get("id"): row for row in previous_active_rows if row.get("id")}
    previous_archive_by_id = {row.get("id"): row for row in previous_archive_rows if row.get("id")}

    changed = not active_file.exists() or not archive_file.exists()
    merged_public_rows = []
    newly_closed_rows = []
    current_ids = set()

    candidates_by_id = {}
    for row in public_rows:
        row_id = row["id"]
        current_ids.add(row_id)
        prev = previous_active_by_id.get(row_id)
        if prev and _job_signature(prev) == _job_signature(row):
            candidate = prev
        else:
            candidate = dict(row)
            changed = True
        candidates_by_id[row_id] = candidate

    # Dead-link checks are one or two HTTP requests each; running them
    # concurrently instead of one-by-one keeps this from scaling linearly
    # with the number of published jobs.
    alive_by_id = {}
    if check_url_alive is not None and candidates_by_id:
        items = list(candidates_by_id.items())
        calls = [(candidate.get("url") or "",) for _row_id, candidate in items]
        checked = run_concurrently(check_url_alive, calls, max_workers=20)
        for (row_id, candidate), (_args, alive, exc) in zip(items, checked):
            if exc is not None:
                # check_url_alive itself never raises (it has a catch-all
                # fallback) — this only fires if that contract changes later.
                # Same safe default it uses: can't tell, assume alive.
                log_error(f"Dead-link check failed for {candidate.get('url')}: {exc}")
                alive_by_id[row_id] = True
            else:
                alive_by_id[row_id] = alive

    for row in public_rows:
        row_id = row["id"]
        candidate = candidates_by_id[row_id]

        # A URL that 404s/410s even though the source still lists the posting —
        # catches stale scraped data the "still present upstream" check below can't.
        if not alive_by_id.get(row_id, True):
            log_info(f"Dead link, archiving: {candidate.get('company')} - {candidate.get('title')}")
            closed = dict(candidate)
            closed["closed_at"] = now_iso
            newly_closed_rows.append(closed)
            changed = True
            continue

        merged_public_rows.append(candidate)

    # A posting that was active last run but is absent from this run's fetch has
    # closed (or rolled off the source) — archive it instead of silently dropping it.
    for row_id in set(previous_active_by_id) - current_ids:
        closed = dict(previous_active_by_id[row_id])
        closed["closed_at"] = now_iso
        newly_closed_rows.append(closed)
        changed = True

    previous_active_order = [row.get("id") for row in previous_active_rows if row.get("id")]
    current_active_order = [row.get("id") for row in merged_public_rows if row.get("id")]
    if previous_active_order != current_active_order:
        changed = True

    if not changed:
        log_info("No job changes detected; skipping output refresh")
        return

    public_rows = merged_public_rows

    archive_rows = dict(previous_archive_by_id)
    for row in newly_closed_rows:
        archive_rows[row["id"]] = row
    for row in merged_public_rows:
        # Reappeared in this run's active set (e.g. a previously wrongly-flagged
        # dead link turned out to be alive) — drop the stale archive entry.
        archive_rows.pop(row.get("id"), None)
    archive_public_rows = sorted(
        archive_rows.values(),
        key=lambda x: x.get("closed_at", x.get("collected_at", "")),
        reverse=True,
    )

    payload = {"generated_at": now_iso, "total": len(public_rows), "jobs": public_rows}
    try:
        active_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        log_info(f"Exported {active_file}")
    except Exception as e:
        log_error(f"Failed to write JSON: {e}")

    archive_payload = {"generated_at": now_iso, "total": len(archive_public_rows), "jobs": archive_public_rows}
    try:
        archive_file.write_text(json.dumps(archive_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        log_info(f"Exported {archive_file}")
    except Exception as e:
        log_error(f"Failed to write archive JSON: {e}")

    stats = {
        "generated_at": now_iso,
        "total": len(rows),
        "by_level": dict(Counter(r["level"] for r in rows)),
        "by_country": dict(Counter(r["country"] for r in rows)),
        "by_source": dict(Counter(r["source"] for r in rows)),
    }
    stats_file = data_out / "stats.json"
    try:
        stats_file.write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
        log_info(f"Exported {stats_file}")
    except Exception as e:
        log_error(f"Failed to write stats: {e}")
