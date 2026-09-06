import contextlib
import importlib.util
import io
from pathlib import Path


GREEN = "\033[32m"
RED = "\033[31m"
RESET = "\033[0m"

ROOT = Path(__file__).resolve().parents[1]


def color(text, code):
    return f"{code}{text}{RESET}"


def load_module(rel_path, name):
    module_path = ROOT / rel_path
    spec = importlib.util.spec_from_file_location(name, module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        spec.loader.exec_module(module)
    return module


def check(name, condition, details=""):
    if not condition:
        raise AssertionError(f"{name} failed{': ' + details if details else ''}")


def main():
    bdr = load_module("scripts/build_data_readme.py", "build_data_readme_module_for_stats_history_test")

    total = 0

    def run(name, fn):
        nonlocal total
        total += 1
        fn()
        print(color(f"✅ {name}", GREEN))

    stats = {
        "curated_roles": 100,
        "public_opportunities": 200,
        "jobs_total": 250,
        "hackathons_total": 40,
        "events_total": 10,
        "total_items": 300,
        "level_counts": {"internship": 90, "early_career": 120, "mid_level": 40},
    }

    run("first run with no existing file produces one snapshot", lambda: check(
        "one snapshot",
        len(bdr.update_stats_history({}, stats, "2026-01-01T00:00:00Z")["snapshots"]) == 1,
    ))

    run("snapshot carries every stats field through unchanged", lambda: check(
        "fields match",
        bdr.update_stats_history({}, stats, "2026-01-01T00:00:00Z")["snapshots"][0]
        == {"at": "2026-01-01T00:00:00Z", **stats},
    ))

    existing = {
        "updated_at": "2026-01-01T00:00:00Z",
        "retention_days": 90,
        "snapshots": [{"at": "2026-01-01T00:00:00Z", **stats}],
    }

    run("a second run appends rather than replacing", lambda: check(
        "two snapshots",
        len(bdr.update_stats_history(existing, stats, "2026-01-01T01:00:00Z")["snapshots"]) == 2,
    ))

    run("appended snapshots keep chronological order", lambda: check(
        "order preserved",
        [s["at"] for s in bdr.update_stats_history(existing, stats, "2026-01-01T01:00:00Z")["snapshots"]]
        == ["2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z"],
    ))

    stale_existing = {
        "updated_at": "2025-01-01T00:00:00Z",
        "retention_days": 90,
        "snapshots": [
            {"at": "2020-01-01T00:00:00Z", **stats},  # far older than the 90-day window
            {"at": "2026-01-01T00:00:00Z", **stats},
        ],
    }

    run("snapshots older than the retention window are pruned", lambda: check(
        "old snapshot dropped",
        "2020-01-01T00:00:00Z"
        not in [s["at"] for s in bdr.update_stats_history(stale_existing, stats, "2026-01-01T01:00:00Z")["snapshots"]],
    ))

    run("a recent snapshot survives pruning", lambda: check(
        "recent snapshot kept",
        "2026-01-01T00:00:00Z"
        in [s["at"] for s in bdr.update_stats_history(stale_existing, stats, "2026-01-01T01:00:00Z")["snapshots"]],
    ))

    run("update_stats_history is pure — the same input never mutates across calls", lambda: check(
        "no cross-call mutation",
        len(bdr.update_stats_history(existing, stats, "2026-01-01T02:00:00Z")["snapshots"]) == 2,
        "calling twice with the same 'existing' dict grew past 2, meaning it was mutated in place",
    ))

    invalid_stats = {**stats, "jobs_total": "not_a_number"}

    def build_with_invalid_snapshot():
        bdr.update_stats_history({}, invalid_stats, "2026-01-01T00:00:00Z")

    run("a non-integer count fails schema validation instead of publishing", lambda: check(
        "raises ValueError",
        _raises(build_with_invalid_snapshot, ValueError),
    ))

    # D2 — per-run dimension breakdowns
    sample_jobs = [
        {"level": "internship", "region": "us", "remote_type": "remote", "role_type": "backend",
         "category": "faang", "country": "United States", "company": "Google", "source": "greenhouse:google"},
        {"level": "internship", "region": "us", "remote_type": "onsite", "role_type": "backend",
         "category": "faang", "country": "United States", "company": "Google", "source": "greenhouse:google"},
        {"level": "new_grad", "region": "emea", "remote_type": "", "role_type": "frontend",
         "category": "", "country": "", "company": "Spotify", "source": "lever:spotify"},
    ]
    dims = bdr.summarize_snapshot_dimensions(sample_jobs)
    run("summarize_snapshot_dimensions: exhaustive dims sum to len(jobs)", lambda: check(
        "exhaustive sums",
        all(sum(dims[k].values()) == len(sample_jobs)
            for k in ("by_level", "by_region", "by_remote_type", "by_role_type", "by_category")),
        details=str(dims),
    ))
    run("summarize_snapshot_dimensions: blank field → 'unknown' bucket, never guessed", lambda: check(
        "unknown bucket",
        dims["by_remote_type"].get("unknown") == 1
        and dims["by_country"].get("unknown") == 1
        and dims["by_category"].get("uncategorized") == 1,
        details=str(dims),
    ))
    run("summarize_snapshot_dimensions: counts are right", lambda: check(
        "counts",
        dims["by_level"] == {"internship": 2, "new_grad": 1}
        and dims["top_companies"] == {"Google": 2, "Spotify": 1},
    ))
    run("summarize_snapshot_dimensions: open dims are capped to top N", lambda: check(
        "top-N cap",
        (lambda d: len(d["top_companies"]) == 20 and len(d["by_country"]) == 15)(
            bdr.summarize_snapshot_dimensions([
                {"company": f"Co{i}", "country": f"C{i}", "level": "new_grad"} for i in range(50)
            ])
        ),
    ))

    with_dims = bdr.update_stats_history({}, stats, "2026-01-01T00:00:00Z", dims)["snapshots"][0]
    run("update_stats_history stores dimensions when given, omits the key when not", lambda: check(
        "dimensions key",
        with_dims.get("dimensions") == dims
        and "dimensions" not in bdr.update_stats_history({}, stats, "2026-01-01T00:00:00Z")["snapshots"][0],
    ))
    run("a snapshot with dimensions still passes schema validation", lambda: check(
        "dims schema valid",
        len(bdr.update_stats_history({}, stats, "2026-01-01T00:00:00Z", dims)["snapshots"]) == 1,
    ))
    run("pre-D2 snapshots (no dimensions key) stay valid on a later run", lambda: check(
        "legacy snapshot valid",
        len(bdr.update_stats_history(
            {"updated_at": "2026-01-01T00:00:00Z", "retention_days": 90,
             "snapshots": [{"at": "2026-01-01T00:00:00Z", **stats}]},
            stats, "2026-01-01T01:00:00Z", dims,
        )["snapshots"]) == 2,
    ))

    print(color(f"✅ ALL PASSED: {total} checks", GREEN))
    return 0


def _raises(fn, exc_type):
    try:
        fn()
    except exc_type:
        return True
    except Exception:
        return False
    return False


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as exc:
        print(color(f"❌ TEST FAILED: {exc}", RED))
        raise SystemExit(1)
    except Exception as exc:
        print(color(f"❌ TEST ERROR: {exc}", RED))
        raise SystemExit(1)
