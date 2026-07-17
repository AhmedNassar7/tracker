from __future__ import annotations

import json
from collections import Counter


def _job_compare_payload(row):
    return {
        "id": row.get("id"),
        "company": row.get("company"),
        "title": row.get("title"),
        "level": row.get("level"),
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


def _render_latest_markdown(public_rows, now_iso):
    lines = [
        "# Global Tech Roles (Latest)",
        "",
        f"Generated at: {now_iso}",
        "",
        "This is a raw export of the curated-source feed only (Remotive, ArbeitNow, SimplifyJobs)."
        " For the full combined list — this feed plus Greenhouse, Lever, Ashby, SmartRecruiters, hackathons,"
        " and events — see [README.md](README.md) or the [project overview](../README.md).",
        "",
        "| Company | Title | Location | Age |",
        "|---|---|---|---|",
    ]
    for row in public_rows:
        company = row.get("company") or ""
        title = row.get("title") or ""
        url = row.get("url") or ""
        location = row.get("location") or ""
        age = row.get("age") or ""
        lines.append(f"| {company} | [{title}]({url}) | {location} | {age} |")
    return "\n".join(lines) + "\n"


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

    for row in public_rows:
        row_id = row["id"]
        current_ids.add(row_id)
        prev = previous_active_by_id.get(row_id)
        if prev and _job_signature(prev) == _job_signature(row):
            candidate = prev
        else:
            candidate = dict(row)
            changed = True

        # A URL that 404s/410s even though the source still lists the posting —
        # catches stale scraped data the "still present upstream" check below can't.
        if check_url_alive is not None and not check_url_alive(candidate.get("url") or ""):
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

    latest_md_file = data_out / "jobs-global-latest.md"
    try:
        latest_md_file.write_text(_render_latest_markdown(public_rows, now_iso), encoding="utf-8")
        log_info(f"Exported {latest_md_file}")
    except Exception as e:
        log_error(f"Failed to write markdown: {e}")

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
