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
