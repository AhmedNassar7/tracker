import contextlib
import importlib.util
import io
import json
import tempfile
from pathlib import Path
from unittest.mock import patch


GREEN = "\033[32m"
RED = "\033[31m"
RESET = "\033[0m"


def color(text, code):
    return f"{code}{text}{RESET}"


def load_module():
    module_path = Path(__file__).resolve().parents[1] / "scripts" / "public_sources.py"
    spec = importlib.util.spec_from_file_location("public_sources_module", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        spec.loader.exec_module(module)
    return module


def check(name, condition, details=""):
    if not condition:
        raise AssertionError(f"{name} failed{': ' + details if details else ''}")


def main():
    mod = load_module()
    mod.log_info = lambda *_args, **_kwargs: None
    mod.log_warn = lambda *_args, **_kwargs: None
    mod.log_error = lambda *_args, **_kwargs: None

    total = 0

    def run(name, fn):
        nonlocal total
        total += 1
        fn()
        print(color(f"✅ {name}", GREEN))

    seed_jobs = [
        {"company": "Twilio", "url": "https://job-boards.greenhouse.io/twilio/jobs/7850821"},
        {"company": "Example Co", "url": "https://jobs.lever.co/exampleco/123"},
        {"company": "Other", "url": "https://example.com"},
    ]
    discovered = mod.discover_job_board_sources(seed_jobs)

    run("discover greenhouse and lever sources", lambda: check(
        "discover greenhouse and lever sources",
        discovered[0].get("twilio") == "Twilio"
        and discovered[1].get("exampleco") == "Example Co",
    ))

    run("software role detection", lambda: check(
        "software role detection",
        mod.is_software_job("Senior Software Engineer")
        and mod.is_software_job("Full Stack Developer")
        and not mod.is_software_job("Bilingual Inside Sales Consultant")
        and mod.detect_level("Software Engineer Intern") == "internship"
        and mod.detect_role_type("Software Engineer Intern") == "software_engineer",
    ))

    devpost_html = '<a href="https://example.devpost.com/?ref_feature=challenge&ref_medium=discover">Online Build with Me Hackathon 22 days left Apr 09 - May 20, 2026 $50,000 in prizes 4543 participants</a>'
    devpost_rows = mod.parse_devpost_hackathons(devpost_html)
    run("parse devpost hackathon card", lambda: check(
        "parse devpost hackathon card",
        len(devpost_rows) == 1
        and devpost_rows[0]["company"] == "Devpost"
        and devpost_rows[0]["kind"] == "hackathon"
        and "Build with Me Hackathon" in devpost_rows[0]["title"]
    ))

    luma_html = '<a href="https://luma.com/cursorcommunity?k=c">Avatar for Cursor Community Subscribe Cursor Community Discover community meetups, hackathons, workshops taking place around the world.</a>'
    luma_rows = mod.parse_luma_discover(luma_html)
    run("parse luma discover card", lambda: check(
        "parse luma discover card",
        len(luma_rows) == 1
        and luma_rows[0]["company"] == "Luma"
        and luma_rows[0]["kind"] == "event"
    ))

    greenhouse_payload = {
        "jobs": [
            {
                "title": "Software Engineer Intern",
                "updated_at": "2026-01-02T10:00:00-05:00",
                "location": {"name": "Remote - USA"},
                "absolute_url": "https://example.com/gh1",
            }
        ]
    }
    with patch.object(mod, "fetch_json", return_value=greenhouse_payload):
        gh_rows = mod.fetch_greenhouse_board_jobs("twilio", "Twilio")
    run("greenhouse job board fetch", lambda: check(
        "greenhouse job board fetch",
        len(gh_rows) == 1
        and gh_rows[0]["company"] == "Twilio"
        and gh_rows[0]["kind"] == "job"
        and gh_rows[0]["level"] == "internship"
        and gh_rows[0]["role_type"] == "software_engineer",
    ))

    greenhouse_non_swe = {
        "jobs": [
            {
                "title": "Bilingual Inside Sales Consultant",
                "updated_at": "2026-01-02T10:00:00-05:00",
                "location": {"name": "Remote"},
                "absolute_url": "https://example.com/sales",
            }
        ]
    }
    with patch.object(mod, "fetch_json", return_value=greenhouse_non_swe):
        no_rows = mod.fetch_greenhouse_board_jobs("twilio", "Twilio")
    run("greenhouse filters non software roles", lambda: check(
        "greenhouse filters non software roles",
        len(no_rows) == 0,
    ))

    with tempfile.TemporaryDirectory() as tmp:
        out_dir = Path(tmp)
        rows = gh_rows + devpost_rows + luma_rows
        with patch.object(mod, "DATA_OUT", out_dir), patch.object(mod, "NOW_ISO", "2026-01-02T00:00:00Z"), patch.object(mod, "TODAY", "2026-01-02"):
            mod.write_outputs(rows)
        payload = json.loads((out_dir / "public-opportunities.json").read_text(encoding="utf-8"))
        run("write public opportunities outputs", lambda: check(
            "write public opportunities outputs",
            payload["total"] == len(rows)
            and (out_dir / "public-opportunities.md").exists()
            and payload["jobs"]
            and payload["hackathons"]
            and payload["events"]
            and "feeds" not in payload,
        ))

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