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
        {"level": "internship", "region": "north_america", "remote_type": "remote", "role_type": "backend",
         "category": "faang", "country": "United States", "company": "Google", "source": "greenhouse:google"},
        {"level": "internship", "region": "north_america", "remote_type": "onsite", "role_type": "backend",
         "category": "faang", "country": "United States", "company": "Google", "source": "greenhouse:google"},
        {"level": "new_grad", "region": "europe", "remote_type": "", "role_type": "frontend",
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

    # D5 — per-company daily history (every company, not just the top 20)
    def jobs_of(**counts):
        return [{"company": c} for c, n in counts.items() for _ in range(n)]

    h1 = bdr.update_company_history({}, jobs_of(Acme=3, Beta=1), "2026-01-01T08:00:00Z")
    run("company history: first run seeds one day, every company counted", lambda: check(
        "seed", h1["days"] == ["2026-01-01"] and h1["companies"] == {"Acme": [3], "Beta": [1]},
        details=str(h1),
    ))
    h1b = bdr.update_company_history(h1, jobs_of(Acme=5, Beta=1), "2026-01-01T20:00:00Z")
    run("company history: a second run the same UTC day overwrites that day", lambda: check(
        "same day overwrite", h1b["days"] == ["2026-01-01"] and h1b["companies"]["Acme"] == [5],
        details=str(h1b),
    ))
    h2 = bdr.update_company_history(h1b, jobs_of(Acme=4, Gamma=2), "2026-01-02T08:00:00Z")
    run("company history: next day appends; a vanished company is a real 0, a new one is 0-padded", lambda: check(
        "next day", h2["days"] == ["2026-01-01", "2026-01-02"]
        and h2["companies"]["Acme"] == [5, 4]
        and h2["companies"]["Beta"] == [1, 0]
        and h2["companies"]["Gamma"] == [0, 2],
        details=str(h2),
    ))
    run("company history: whitespace/blank company names are normalised or skipped, never a key", lambda: check(
        "blank names",
        bdr.update_company_history({}, [{"company": "  Acme "}, {"company": ""}, {}], "2026-01-01T00:00:00Z")["companies"]
        == {"Acme": [1]},
    ))
    run("company history: a company all-zero across the window is dropped", lambda: check(
        "all-zero dropped",
        bdr.update_company_history(
            {"updated_at": "2026-01-01T00:00:00Z", "retention_days": 90, "days": ["2026-01-01"], "companies": {"Old": [0]}},
            jobs_of(Acme=1), "2026-01-02T00:00:00Z",
        )["companies"].keys() == {"Acme"},
    ))
    long_ago = {"updated_at": "2026-01-01T00:00:00Z", "retention_days": 90,
                "days": ["2026-01-01", "2026-01-02"], "companies": {"Acme": [3, 2], "OnlyOld": [4, 0]}}
    pruned = bdr.update_company_history(long_ago, jobs_of(Acme=1), "2026-04-05T00:00:00Z")
    run("company history: days older than the 90-day cutoff are pruned, arrays stay aligned", lambda: check(
        "prune", pruned["days"] == ["2026-04-05"] and pruned["companies"] == {"Acme": [1]},
        details=str(pruned),
    ))
    run("company history: a corrupt existing entry (wrong length) is discarded, not propagated", lambda: check(
        "corrupt entry",
        bdr.update_company_history(
            {"updated_at": "2026-01-01T00:00:00Z", "retention_days": 90, "days": ["2026-01-01"],
             "companies": {"Bad": [1, 2, 3], "Ok": [2]}},
            jobs_of(Ok=1), "2026-01-02T00:00:00Z",
        )["companies"] == {"Ok": [2, 1]},
    ))
    run("company history: is pure — the input dict is never mutated", lambda: check(
        "pure", h2["companies"]["Acme"] == [5, 4] and h1b["companies"]["Acme"] == [5]
        and h1["companies"]["Acme"] == [3],
    ))

    # D4 — monthly "State of Early-Career Tech Hiring" post
    import datetime as _dt
    import sys as _sys
    import tempfile as _tempfile
    from pathlib import Path as _Path

    _sys.path.insert(0, str(ROOT / "scripts"))
    soh = load_module("scripts/state_of_hiring.py", "state_of_hiring_module_for_test")

    def snap(day, dims, hour="12:00:00"):
        return {"at": f"{day}T{hour}Z", "curated_roles": 0, "public_opportunities": 0, "jobs_total": 0,
                "hackathons_total": 0, "events_total": 0, "total_items": 0,
                "level_counts": {"internship": 0, "early_career": 0, "mid_level": 0}, "dimensions": dims}

    START_DIMS = {  # 100 roles
        "by_level": {"internship": 10, "new_grad": 5, "junior": 0, "entry_level": 5, "mid_level": 60, "other": 10, "unknown": 10},
        "by_region": {"north_america": 60, "europe": 20, "apac": 10, "unknown": 10},
        "by_country": {"United States": 50, "Unknown": 25, "Germany": 5},
        "by_role_type": {"software_engineer": 60, "backend": 40},
        "top_companies": {"Acme": 20, "Beta": 10},
    }
    END_DIMS = {  # 200 roles; early-career 20% -> 25%
        "by_level": {"internship": 25, "new_grad": 10, "junior": 5, "entry_level": 10, "mid_level": 100, "other": 25, "unknown": 25},
        "by_region": {"north_america": 120, "europe": 40, "apac": 20, "unknown": 20},
        "by_country": {"United States": 100, "Unknown": 50, "Germany": 10},
        "by_role_type": {"software_engineer": 120, "backend": 80},
        "top_companies": {"Acme": 40, "Beta": 20},
    }

    def month_history(*, with_baseline=True, first_day=1, last_day=31, baseline_day="2026-09-30"):
        snaps = []
        if with_baseline:
            snaps.append(snap(baseline_day, START_DIMS))
        for d in range(first_day, last_day + 1):
            snaps.append(snap(f"2026-10-{d:02d}", END_DIMS if d == last_day else START_DIMS))
        return {"updated_at": "2026-11-02T00:00:00Z", "retention_days": 90, "snapshots": snaps}

    full = month_history()
    post = soh.build_state_of_hiring(full, 2026, 10, "2026-11-02")
    run("D4: a full month with a baseline yields a post with the right numbers", lambda: check(
        "post numbers", post is not None and "# State of Early-Career Tech Hiring — October 2026" in post
        and "**200 published software roles**" in post and "against 100 on Sep 30" in post
        and "**25.0% were early-career**" in post and "+5.0 pt since Sep 30" in post
        and "| Internship | 25 |" in post and "| Acme | 40 |" in post,
        details=(post or "")[:600],
    ))
    run("D4: 'other' and 'unknown' levels are one 'Level not stated' row; senior is labelled", lambda: check(
        "level merge", "| Level not stated | 50 |" in post and "Other |" not in post and "Mid level & senior" in post,
    ))
    run("D4: the unknown-country bucket is labelled, never a bare 'Unknown'", lambda: check(
        "country label", "Country not stated" in post and "| Unknown |" not in post,
    ))
    run("D4: the post carries the coverage-is-not-the-market caveat", lambda: check(
        "caveat", "Coverage is not the market" in post and "never guessed" in post,
    ))
    run("D4: no baseline before the month -> no post (never an invented comparison)", lambda: check(
        "no baseline", soh.build_state_of_hiring(month_history(with_baseline=False), 2026, 10, "2026-11-02") is None,
    ))
    run("D4: a stale baseline (20 days before the month) -> no post", lambda: check(
        "stale baseline",
        soh.build_state_of_hiring(month_history(baseline_day="2026-09-11"), 2026, 10, "2026-11-02") is None,
    ))
    run("D4: thin coverage (< 20 days in the month) -> no post", lambda: check(
        "thin coverage", soh.build_state_of_hiring(month_history(first_day=15), 2026, 10, "2026-11-02") is None,
    ))
    run("D4: history that stops before month end -> no post", lambda: check(
        "ends early", soh.build_state_of_hiring(month_history(last_day=24), 2026, 10, "2026-11-02") is None,
    ))
    run("D4: snapshots without dimensions are ignored for coverage", lambda: check(
        "ignores bare snapshots",
        soh.reportable_months({"snapshots": [{**s, "dimensions": None} for s in full["snapshots"]]},
                              _dt.date(2026, 11, 2)) == [],
    ))
    run("D4: the current month is never reportable; a completed one is", lambda: check(
        "completed only",
        soh.reportable_months(full, _dt.date(2026, 10, 31)) == []
        and soh.reportable_months(full, _dt.date(2026, 11, 1)) == [(2026, 10)],
    ))
    with _tempfile.TemporaryDirectory() as _tmp:
        rdir = _Path(_tmp) / "reports"
        w1 = soh.write_state_of_hiring_reports(full, rdir, "2026-11-02T08:00:00Z")
        report = rdir / "state-of-hiring-2026-10.md"
        run("D4: first run writes the month's file and an index linking to it", lambda: check(
            "first write", report.exists() and (rdir / "README.md").exists()
            and "state-of-hiring-2026-10.md" in (rdir / "README.md").read_text(encoding="utf-8")
            and report in w1, details=str(w1),
        ))
        first_text = report.read_text(encoding="utf-8")
        changed = {**full, "snapshots": [*full["snapshots"][:-1], snap("2026-10-31", {**END_DIMS, "top_companies": {"Zed": 99}})]}
        w2 = soh.write_state_of_hiring_reports(changed, rdir, "2026-11-03T08:00:00Z")
        run("D4: an existing month is frozen — the hourly run never rewrites it", lambda: check(
            "frozen", w2 == [] and report.read_text(encoding="utf-8") == first_text, details=str(w2),
        ))
        w3 = soh.write_state_of_hiring_reports(changed, rdir, "2026-11-03T08:00:00Z", force=True)
        run("D4: --regen-reports (force) rebuilds it from the current generator", lambda: check(
            "force", report in w3 and "| Zed | 99 |" in report.read_text(encoding="utf-8"),
        ))
        empty = _Path(_tmp) / "none"
        soh.write_state_of_hiring_reports({"snapshots": []}, empty, "2026-11-02T08:00:00Z")
        run("D4: no reportable month -> no reports directory is created", lambda: check(
            "no dir", not empty.exists(),
        ))

    # D1 — story cards from stats-history dimensions
    def dim_snapshot(at, *, jobs_total, internships, companies, regions, remote):
        return {
            "at": at, **{**stats, "jobs_total": jobs_total},
            "dimensions": {
                "by_level": {"internship": internships, "new_grad": 10},
                "by_region": regions,
                "by_remote_type": remote,
                "by_role_type": {"backend": jobs_total},
                "by_category": {"faang": jobs_total},
                "by_country": {"United States": jobs_total},
                "by_source": {"greenhouse:x": jobs_total},
                "top_companies": companies,
            },
        }

    hist = {"snapshots": [
        # ~28d before latest — the "this month" comparison point
        dim_snapshot("2026-02-01T00:00:00Z", jobs_total=1000, internships=100,
                     companies={"Amazon": 50}, regions={"north_america": 600, "europe": 300, "remote": 100},
                     remote={"remote": 100, "onsite": 900}),
        # ~7d before latest — the "since last week" comparison point
        dim_snapshot("2026-02-22T00:00:00Z", jobs_total=1000, internships=110,
                     companies={"Amazon": 60}, regions={"north_america": 650, "europe": 300, "remote": 100},
                     remote={"remote": 150, "onsite": 850}),
        dim_snapshot("2026-03-01T00:00:00Z", jobs_total=1120, internships=125,
                     companies={"Amazon": 80, "Google": 40, "Meta": 30},
                     regions={"north_america": 700, "europe": 320, "remote": 100},
                     remote={"remote": 224, "onsite": 896}),
    ]}
    out = bdr.build_story_cards(hist, "2026-03-01T00:05:00Z")
    by_id = {c["id"]: c for c in out["cards"]}

    run("build_story_cards: ≤4 cards, schema-valid, no raw-count cards (no 'roles-total', no 'N open' wording)", lambda: check(
        "cards shape / count-free",
        1 <= len(out["cards"]) <= 4
        and all({"id", "title", "detail", "filter"} == set(c) for c in out["cards"])
        and "roles-total" not in by_id
        and all("open" not in c["detail"].lower() and " roles" not in c["detail"].lower()
                for c in out["cards"]
                if c["id"] != "geography"),  # geography's "Most roles in …" is a phrase, not a count
        details=str(out),
    ))
    run("build_story_cards: internship trend is count-free — just direction + %", lambda: check(
        "internship trend",
        by_id["internship-trend"]["title"] == "This month"
        and by_id["internship-trend"]["detail"] == "Internships up 25%"
        and "open" not in by_id["internship-trend"]["detail"]
        and by_id["internship-trend"]["filter"] == {"kind": "job", "levels": ["internship"]},
        details=str(by_id.get("internship-trend")),
    ))
    run("build_story_cards: a flat level (0% move) gets no trend card", lambda: check(
        "no flat trend",
        "new_grad-trend" not in by_id,  # fixture new_grad is 10 → 10
    ))
    run("build_story_cards: geography card uses region phrases and skips remote/unknown", lambda: check(
        "geography",
        by_id["geography"]["detail"] == "Most roles in North America, then Europe"
        and by_id["geography"]["filter"] == {"kind": "job", "regions": ["north_america"]},
    ))
    run("build_story_cards: top-companies card lists the top 3 and filters to them", lambda: check(
        "top companies",
        by_id["top-companies"]["detail"] == "Amazon, Google, Meta"
        and by_id["top-companies"]["filter"] == {"kind": "job", "companies": ["Amazon", "Google", "Meta"]},
    ))
    run("build_story_cards: no dimensioned snapshot → no cards, no crash", lambda: check(
        "empty history",
        bdr.build_story_cards({"snapshots": [{"at": "2026-01-01T00:00:00Z", **stats}]}, "2026-01-02T00:00:00Z")["cards"] == []
        and bdr.build_story_cards({}, "2026-01-02T00:00:00Z")["cards"] == [],
    ))
    run("build_story_cards: a single dimensioned snapshot → only the two ranking cards", lambda: check(
        "single snapshot",
        (lambda o: {c["id"] for c in o["cards"]} == {"top-companies", "geography"})(
            bdr.build_story_cards({"snapshots": [hist["snapshots"][2]]}, "2026-03-01T00:05:00Z")
        ),
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
