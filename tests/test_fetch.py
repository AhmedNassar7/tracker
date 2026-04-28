import importlib.util
import json
import tempfile
import sys
import io
import contextlib
from pathlib import Path
from unittest.mock import patch


GREEN = "\033[32m"
RED = "\033[31m"
RESET = "\033[0m"


def color(text, code):
    return f"{code}{text}{RESET}"


def load_fetch_module():
    module_path = Path(__file__).resolve().parents[1] / "scripts" / "fetch.py"
    spec = importlib.util.spec_from_file_location("fetch_module", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        spec.loader.exec_module(module)
    return module


def check(name, condition, details=""):
    if not condition:
        raise AssertionError(f"{name} failed{': ' + details if details else ''}")


def main():
    fetch = load_fetch_module()
    fetch.log_info = lambda *_args, **_kwargs: None
    fetch.log_warn = lambda *_args, **_kwargs: None
    fetch.log_error = lambda *_args, **_kwargs: None
    fetch.log_debug = lambda *_args, **_kwargs: None
    total = 0

    def run(name, fn):
        nonlocal total
        total += 1
        fn()
        print(color(f"✅ {name}", GREEN))

    run("make_id is stable", lambda: check(
        "make_id is stable",
        fetch.make_id("Google", "Software Engineer", "https://example.com/1")
        == fetch.make_id("Google", "Software Engineer", "https://example.com/1")
        and fetch.make_id("Google", "Software Engineer", "https://example.com/1")
        != fetch.make_id("Meta", "Software Engineer", "https://example.com/1")
        and len(fetch.make_id("Google", "Software Engineer", "https://example.com/1")) == 16,
    ))

    run("level and region detection", lambda: check(
        "level and region detection",
        fetch.detect_level("Software Engineer Intern") == "internship"
        and fetch.detect_level("Software Engineer – Early Career") == "new_grad"
        and fetch.detect_level("Junior Backend Engineer") == "junior"
        and fetch.detect_region("Toronto, Canada") == "canada"
        and fetch.detect_region("Berlin, Germany") == "emea"
        and fetch.detect_region("Remote - Worldwide") == "remote"
        and fetch.detect_remote_type("Remote - Worldwide") == "remote"
        and fetch.detect_remote_type("Hybrid - London") == "hybrid"
        and fetch.detect_remote_type("Austin, USA") == "onsite",
    ))

    with patch.object(fetch, "ALLOWLIST", ["google", "microsoft"]):
        run("allowlist matching", lambda: check(
            "allowlist matching",
            fetch.is_allowed_company("Google LLC")
            and fetch.is_allowed_company("Microsoft Corporation")
            and not fetch.is_allowed_company("Small Startup Inc"),
        ))

    with patch.object(fetch, "NOW_ISO", "2026-01-01T00:00:00Z"):
        row = fetch.normalize(
            company="Google",
            title="Software Engineer Intern",
            location="Remote - USA",
            url="https://example.com/job",
            posted_at="2026-01-02",
            source="remotive",
            source_url="https://remotive.com",
        )
    run("normalize schema", lambda: check(
        "normalize schema",
        {"id", "company", "title", "level", "region", "country", "location", "remote_type", "url", "source", "source_url", "posted_at", "collected_at", "tags"}.issubset(row)
        and row["level"] == "internship"
        and row["region"] == "remote"
        and row["remote_type"] == "remote",
    ))

    run("dedupe", lambda: check(
        "dedupe",
        len(fetch.dedupe([
            {"id": "1111111111111111", "company": "Google", "title": "Software Engineer"},
            {"id": "1111111111111111", "company": "Google", "title": "Software Engineer"},
            {"id": "2222222222222222", "company": "Meta", "title": "Backend Engineer"},
        ])) == 2,
    ))

    fake_payload = {
        "jobs": [
            {
                "company_name": "Google",
                "title": "Software Engineer Intern",
                "candidate_required_location": "Remote - USA",
                "url": "https://example.com/g1",
                "publication_date": "2026-01-10",
            },
            {
                "company_name": "Random Co",
                "title": "Software Engineer Intern",
                "candidate_required_location": "Remote - USA",
                "url": "https://example.com/r1",
                "publication_date": "2026-01-10",
            },
        ]
    }
    with tempfile.TemporaryDirectory() as tmp:
        data_raw = Path(tmp)

        def fake_fetch(_url, dest, timeout=25):
            dest.write_text(json.dumps(fake_payload), encoding="utf-8")
            return True

        with patch.object(fetch, "DATA_RAW", data_raw), patch.object(fetch, "ALLOWLIST", ["google"]), patch.object(fetch, "fetch_url", side_effect=fake_fetch):
            remotive_rows = fetch.fetch_remotive()
    run("remotive fetch", lambda: check("remotive fetch", len(remotive_rows) == 1 and remotive_rows[0]["company"] == "Google" and remotive_rows[0]["source"] == "remotive"))

    md = "\n".join([
        "| Company | Position | Location | Link |",
        "|---|---|---|---|",
        "| Google | Software Engineer Intern | Remote - USA | [Apply](https://example.com/g2) |",
        "| UnknownCo | Software Engineer Intern | Remote - USA | [Apply](https://example.com/u2) |",
    ])
    with tempfile.TemporaryDirectory() as tmp:
        data_raw = Path(tmp)

        def fake_fetch(_url, dest, timeout=25):
            dest.write_text(md, encoding="utf-8")
            return True

        with patch.object(fetch, "DATA_RAW", data_raw), patch.object(fetch, "ALLOWLIST", ["google"]), patch.object(fetch, "fetch_url", side_effect=fake_fetch):
            internship_rows = fetch.fetch_simplify_internships()
    run("simplify internships fetch", lambda: check("simplify internships fetch", len(internship_rows) == 1 and internship_rows[0]["company"] == "Google" and internship_rows[0]["source"] == "simplify_internships"))

    simplify_html = "\n".join([
        "<table>",
        "<thead>",
        "<tr><th>Company</th><th>Role</th><th>Location</th><th>Application</th><th>Age</th></tr>",
        "</thead>",
        "<tbody>",
        "<tr>",
        '<td><strong><a href="https://simplify.jobs/c/Mirage?utm_source=GHList&utm_medium=company">Mirage</a></strong></td>',
        "<td>Software Engineer – Early Career</td>",
        '<td><details><summary><strong>4 locations</strong></summary>Seattle, WA<br>SF<br>NYC<br>Sunnyvale, CA</details></td>',
        '<td><div align="center"><a href="https://jobs.example.com/apply"><img src="https://i.imgur.com/fbjwDvo.png" width="52" alt="Apply"></a></div></td>',
        "<td>3d</td>",
        "</tr>",
        "</tbody>",
        "</table>",
        "<details><summary>🗃️ Inactive roles (1)</summary>",
        "<table>",
        "<tbody>",
        "<tr>",
        '<td><strong><a href="https://simplify.jobs/c/ClosedCo?utm_source=GHList&utm_medium=company">ClosedCo</a></strong></td>',
        "<td>Software Engineer – Early Career</td>",
        '<td>Remote in USA</td>',
        '<td><div align="center"><a href="https://jobs.example.com/closed"><img src="https://i.imgur.com/fbjwDvo.png" width="52" alt="Apply"></a></div></td>',
        "<td>99d</td>",
        "</tr>",
        "</tbody>",
        "</table>",
        "</details>",
    ])
    with tempfile.TemporaryDirectory() as tmp:
        data_raw = Path(tmp)

        def fake_fetch(_url, dest, timeout=25):
            dest.write_text(simplify_html, encoding="utf-8")
            return True

        with patch.object(fetch, "DATA_RAW", data_raw), patch.object(fetch, "ALLOWLIST", ["mirage", "closedco"]), patch.object(fetch, "fetch_url", side_effect=fake_fetch):
            simplify_rows = fetch.fetch_simplify_newgrad()
    run("simplify new grad active rows only", lambda: check(
        "simplify new grad active rows only",
        len(simplify_rows) == 1
        and simplify_rows[0]["company"] == "Mirage"
        and simplify_rows[0]["age"] == "3d"
        and simplify_rows[0]["location_details"] == ["Seattle, WA", "SF", "NYC", "Sunnyvale, CA"],
    ))

    rows = [{
        "id": "aaaaaaaaaaaaaaaa",
        "company": "Google",
        "title": "Software Engineer Intern",
        "level": "internship",
        "region": "remote",
        "country": "REMOTE",
        "location": "Remote - USA",
        "remote_type": "remote",
        "url": "https://example.com/g3",
        "source": "remotive",
        "source_url": "https://remotive.com",
        "posted_at": "2026-01-12",
        "collected_at": "2026-01-12T00:00:00Z",
        "tags": ["software"],
    }]
    with tempfile.TemporaryDirectory() as tmp:
        data_out = Path(tmp)
        with patch.object(fetch, "DATA_OUT", data_out), patch.object(fetch, "NOW_ISO", "2026-01-12T00:00:00Z"), patch.object(fetch, "TODAY", "2026-01-12"):
            fetch.write_outputs(rows)
        payload = json.loads((data_out / "jobs-global.json").read_text(encoding="utf-8"))
        run("write outputs", lambda: check("write outputs", payload["total"] == 1 and "region" not in payload["jobs"][0] and "age" in payload["jobs"][0] and (data_out / "jobs-global-latest.md").exists() and (data_out / "stats.json").exists() and (data_out / "jobs-global-archive.json").exists()))

        with tempfile.TemporaryDirectory() as tmp:
            data_out = Path(tmp)
            unsorted_rows = [
                {
                    "id": "bbbbbbbbbbbbbbbb",
                    "company": "Beta",
                    "title": "Software Engineer",
                    "level": "new_grad",
                    "country": "United States",
                    "location": "Remote",
                    "remote_type": "remote",
                    "url": "https://example.com/beta",
                    "source": "simplify_newgrad",
                    "source_url": "https://example.com/source",
                    "posted_at": "2026-01-10",
                    "age": "10d",
                    "collected_at": "2026-01-10T00:00:00Z",
                    "tags": ["software"],
                },
                {
                    "id": "aaaaaaaaaaaaaaaa",
                    "company": "Alpha",
                    "title": "Software Engineer",
                    "level": "new_grad",
                    "country": "United States",
                    "location": "Remote",
                    "remote_type": "remote",
                    "url": "https://example.com/alpha",
                    "source": "simplify_newgrad",
                    "source_url": "https://example.com/source",
                    "posted_at": "2026-01-12",
                    "age": "2d",
                    "collected_at": "2026-01-12T00:00:00Z",
                    "tags": ["software"],
                },
            ]
            with patch.object(fetch, "DATA_OUT", data_out), patch.object(fetch, "NOW_ISO", "2026-01-12T00:00:00Z"), patch.object(fetch, "TODAY", "2026-01-12"):
                fetch.write_outputs(unsorted_rows)
            md_text = (data_out / "jobs-global-latest.md").read_text(encoding="utf-8")
            run("write outputs sorts by age", lambda: check(
                "write outputs sorts by age",
                md_text.index("| Alpha |") < md_text.index("| Beta |")
            ))

    existing_row = {
        "id": "bbbbbbbbbbbbbbbb",
        "company": "Mirage",
        "title": "Software Engineer – Early Career",
        "level": "new_grad",
        "country": "United States",
        "location": "Seattle, WA SF NYC Sunnyvale, CA",
        "remote_type": "onsite",
        "url": "https://example.com/mirage",
        "source": "simplify_newgrad",
        "source_url": "https://github.com/SimplifyJobs/New-Grad-Positions",
        "posted_at": "2026-01-01",
        "age": "2d",
        "collected_at": "2026-01-01T00:00:00Z",
        "tags": ["software", "programming", "global-tech-roles"],
    }
    with tempfile.TemporaryDirectory() as tmp:
        data_out = Path(tmp)
        (data_out / "jobs-global.json").write_text(json.dumps({"generated_at": "2026-01-01T00:00:00Z", "total": 1, "jobs": [existing_row]}, ensure_ascii=False, indent=2), encoding="utf-8")
        (data_out / "jobs-global-archive.json").write_text(json.dumps({"generated_at": "2026-01-01T00:00:00Z", "total": 0, "jobs": []}, ensure_ascii=False, indent=2), encoding="utf-8")
        (data_out / "jobs-global-latest.md").write_text("original markdown\n", encoding="utf-8")
        (data_out / "stats.json").write_text(json.dumps({"generated_at": "2026-01-01T00:00:00Z", "total": 1, "by_level": {"new_grad": 1}, "by_country": {"United States": 1}, "by_source": {"simplify_newgrad": 1}}, ensure_ascii=False, indent=2), encoding="utf-8")

        unchanged_row = dict(existing_row)
        unchanged_row["age"] = "3d"
        unchanged_row["collected_at"] = "2026-01-02T00:00:00Z"

        before_json = (data_out / "jobs-global.json").read_text(encoding="utf-8")
        before_md = (data_out / "jobs-global-latest.md").read_text(encoding="utf-8")
        before_stats = (data_out / "stats.json").read_text(encoding="utf-8")

        with patch.object(fetch, "DATA_OUT", data_out), patch.object(fetch, "NOW_ISO", "2026-01-02T00:00:00Z"), patch.object(fetch, "TODAY", "2026-01-02"):
            fetch.write_outputs([unchanged_row])

        run("write outputs skips age-only changes", lambda: check(
            "write outputs skips age-only changes",
            (data_out / "jobs-global.json").read_text(encoding="utf-8") == before_json
            and (data_out / "jobs-global-latest.md").read_text(encoding="utf-8") == before_md
            and (data_out / "stats.json").read_text(encoding="utf-8") == before_stats,
        ))

    with patch.object(fetch, "fetch_remotive", return_value=[]) as remotive_mock, patch.object(fetch, "fetch_arbeitnow", return_value=[]) as arbeitnow_mock, patch.object(fetch, "fetch_simplify_internships", return_value=[]) as internships_mock, patch.object(fetch, "fetch_simplify_newgrad", return_value=[]) as newgrad_mock, patch.object(fetch, "dedupe", return_value=[]), patch.object(fetch, "write_outputs") as write_outputs, patch.object(fetch, "log_warn"):
        fetch.main()
    assert remotive_mock.call_count >= 1
    assert arbeitnow_mock.call_count >= 1
    assert internships_mock.call_count >= 1
    assert newgrad_mock.call_count >= 1
    assert remotive_mock.call_count == arbeitnow_mock.call_count == internships_mock.call_count == newgrad_mock.call_count
    assert write_outputs.call_count == 1
    print(color("✅ main calls all sources consistently", GREEN))
    total += 1

    print(color(f"✅ ALL PASSED: {total} checks", GREEN))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as exc:
        print(color(f"❌ TEST FAILED: {exc}", RED))
        raise SystemExit(1)
    except Exception as exc:
        print(color(f"❌ TEST ERROR: {exc}", RED))
        raise SystemExit(1)
