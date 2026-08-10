import contextlib
import importlib.util
import io
import tempfile
from pathlib import Path
from unittest.mock import patch


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
    sv = load_module("scripts/schema_validator.py", "schema_validator_module")
    job_schema = sv.load_schema(ROOT / "config" / "job-entry.schema.json")
    public_schema = sv.load_schema(ROOT / "config" / "public-entry.schema.json")

    total = 0

    def run(name, fn):
        nonlocal total
        total += 1
        fn()
        print(color(f"✅ {name}", GREEN))

    valid_job = {
        "id": "aaaaaaaaaaaaaaaa",
        "company": "Google",
        "title": "Software Engineer Intern",
        "level": "internship",
        "category": "faang",
        "region": "remote",
        "role_type": "software_engineer",
        "country": "Remote",
        "location": "Remote - USA",
        "remote_type": "remote",
        "url": "https://example.com/job",
        "source": "remotive",
        "source_url": "https://remotive.com/",
        "posted_at": "2026-01-01",
        "age": "0d",
        "collected_at": "2026-01-01T00:00:00Z",
        "tags": ["software"],
    }

    run("valid job record has no errors", lambda: check(
        "valid job record has no errors",
        sv.validate_record(valid_job, job_schema) == [],
    ))

    run("archived job record with closed_at is valid", lambda: check(
        "archived job record with closed_at is valid",
        sv.validate_record({**valid_job, "closed_at": "2026-01-02T00:00:00Z"}, job_schema) == [],
    ))

    missing_field = dict(valid_job)
    del missing_field["url"]
    run("missing required field is caught", lambda: check(
        "missing required field is caught",
        any("url" in e and "missing required field" in e for e in sv.validate_record(missing_field, job_schema)),
    ))

    bad_enum = {**valid_job, "level": "not_a_real_level"}
    run("bad enum value is caught", lambda: check(
        "bad enum value is caught",
        any("level" in e and "not in allowed set" in e for e in sv.validate_record(bad_enum, job_schema)),
    ))

    bad_pattern = {**valid_job, "id": "not-16-hex-chars"}
    run("bad id pattern is caught", lambda: check(
        "bad id pattern is caught",
        any("id" in e and "does not match pattern" in e for e in sv.validate_record(bad_pattern, job_schema)),
    ))

    extra_field = {**valid_job, "made_up_field": "surprise"}
    run("undeclared field is caught (additionalProperties: false)", lambda: check(
        "undeclared field is caught",
        any("made_up_field" in e for e in sv.validate_record(extra_field, job_schema)),
    ))

    wrong_type = {**valid_job, "tags": "software"}
    run("wrong type is caught", lambda: check(
        "wrong type is caught",
        any("tags" in e and "expected type 'array'" in e for e in sv.validate_record(wrong_type, job_schema)),
    ))

    valid_public_job = {
        "id": "bbbbbbbbbbbbbbbb",
        "kind": "job",
        "company": "Twilio",
        "title": "Software Engineer Intern",
        "location": "Remote - USA",
        "level": "internship",
        "role_type": "software_engineer",
        "region": "remote",
        "date": "0d",
        "posted_at": "2026-01-01",
        "url": "https://example.com/gh1",
        "source": "greenhouse:twilio",
        "source_url": "https://boards-api.greenhouse.io/v1/boards/twilio/jobs?content=true",
    }
    run("valid public-layer job record has no errors", lambda: check(
        "valid public-layer job record has no errors",
        sv.validate_record(valid_public_job, public_schema) == [],
    ))

    valid_hackathon = {
        "id": "cccccccccccccccc",
        "kind": "hackathon",
        "company": "Devpost",
        "title": "Build with Me Hackathon",
        "location": "Online",
        "date": "22 days left",
        "posted_at": "2026-01-01",
        "url": "https://example.devpost.com/",
        "source": "devpost",
        "source_url": "https://devpost.com/hackathons",
    }
    run("valid hackathon record (no level/role_type/region) has no errors", lambda: check(
        "valid hackathon record has no errors",
        sv.validate_record(valid_hackathon, public_schema) == [],
    ))

    run("validate_records flags the right index", lambda: check(
        "validate_records flags the right index",
        any("[1]" in e for e in sv.validate_records([valid_job, bad_enum], job_schema, label="jobs")),
    ))

    # Integration: the actual write path should refuse to publish a row that
    # fails schema validation, rather than silently shipping it.
    fetch = load_module("scripts/fetch.py", "fetch_module_for_schema_test")
    fetch.log_info = lambda *_a, **_k: None
    fetch.log_warn = lambda *_a, **_k: None
    fetch.log_error = lambda *_a, **_k: None

    bad_row = {
        "id": "dddddddddddddddd",
        "company": "Google",
        "title": "Software Engineer",
        "level": "definitely_not_a_valid_level",
        "category": "faang",
        "region": "us",
        "role_type": "software_engineer",
        "country": "United States",
        "location": "Mountain View, CA",
        "remote_type": "onsite",
        "url": "https://example.com/bad",
        "source": "remotive",
        "source_url": "https://remotive.com",
        "posted_at": "2026-01-01",
        "collected_at": "2026-01-01T00:00:00Z",
        "tags": ["software"],
    }

    def write_bad_job_row():
        with tempfile.TemporaryDirectory() as tmp:
            data_out = Path(tmp)
            with patch.object(fetch, "DATA_OUT", data_out), patch.object(fetch, "check_url_alive", return_value=True):
                fetch.write_outputs([bad_row])

    run("write_outputs refuses to publish a schema-invalid job row", lambda: check(
        "write_outputs refuses to publish a schema-invalid job row",
        _raises(write_bad_job_row, ValueError),
    ))

    public_sources = load_module("scripts/public_sources.py", "public_sources_module_for_schema_test")
    public_sources.log_info = lambda *_a, **_k: None
    public_sources.log_warn = lambda *_a, **_k: None
    public_sources.log_error = lambda *_a, **_k: None

    bad_public_row = {
        "id": "eeeeeeeeeeeeeeee",
        "kind": "job",
        "company": "Twilio",
        # "title" deliberately omitted — required field
        "location": "Remote - USA",
        "date": "0d",
        "posted_at": "2026-01-01",
        "url": "https://example.com/gh-bad",
        "source": "greenhouse:twilio",
        "source_url": "https://boards-api.greenhouse.io/v1/boards/twilio/jobs?content=true",
    }

    def write_bad_public_row():
        with tempfile.TemporaryDirectory() as tmp:
            data_out = Path(tmp)
            with patch.object(public_sources, "DATA_OUT", data_out):
                public_sources.write_outputs([bad_public_row])

    run("public write_outputs refuses to publish a row missing a required field", lambda: check(
        "public write_outputs refuses to publish a row missing a required field",
        _raises(write_bad_public_row, ValueError),
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
