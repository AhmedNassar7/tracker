import contextlib
import importlib.util
import io
import json
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
    bdr = load_module("scripts/build_data_readme.py", "build_data_readme_module")
    sv = load_module("scripts/schema_validator.py", "schema_validator_module_for_site_index_test")
    site_index_schema = sv.load_schema(ROOT / "config" / "site-index.schema.json")

    total = 0

    def run(name, fn):
        nonlocal total
        total += 1
        fn()
        print(color(f"✅ {name}", GREEN))

    curated_job = {
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
    public_job = {
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
    hackathon = {
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
    event = {
        "id": "dddddddddddddddd",
        "kind": "event",
        "company": "Luma",
        "title": "Some Meetup",
        "location": "Global",
        "date": "",
        "posted_at": "2026-01-01",
        "url": "/some-event?k=c",
        "source": "luma",
        "source_url": "https://luma.com/discover",
    }

    curated_payload = {"generated_at": "2026-01-01T00:00:00Z", "total": 1, "jobs": [curated_job]}
    public_payload = {
        "generated_at": "2026-01-01T00:00:00Z",
        "total": 3,
        "jobs": [public_job],
        "hackathons": [hackathon],
        "events": [event],
    }

    index = bdr.build_site_index(curated_payload, public_payload)

    run("count matches the number of items", lambda: check(
        "count matches",
        index["count"] == 4 == len(index["items"]),
    ))

    run("checksum is a sha256: prefixed hex digest", lambda: check(
        "checksum shape",
        index["checksum"].startswith("sha256:") and len(index["checksum"]) == len("sha256:") + 64,
    ))

    run("checksum is stable across two builds of the same data", lambda: check(
        "checksum stable",
        bdr.build_site_index(curated_payload, public_payload)["checksum"] == index["checksum"],
    ))

    run("checksum changes when an item is added", lambda: check(
        "checksum changes",
        bdr.build_site_index(
            curated_payload,
            {**public_payload, "jobs": public_payload["jobs"] + [{**public_job, "id": "eeeeeeeeeeeeeeee"}]},
        )["checksum"] != index["checksum"],
    ))

    by_id = {item["id"]: item for item in index["items"]}

    run("curated job keeps curated-only fields (category, remote_type, country)", lambda: check(
        "curated-only fields present",
        by_id["aaaaaaaaaaaaaaaa"]["origin"] == "curated"
        and by_id["aaaaaaaaaaaaaaaa"]["category"] == "faang"
        and by_id["aaaaaaaaaaaaaaaa"]["remote_type"] == "remote"
        and by_id["aaaaaaaaaaaaaaaa"]["country"] == "Remote",
    ))

    run("public job omits curated-only fields instead of fabricating them", lambda: check(
        "public job has no category/remote_type/country keys",
        "category" not in by_id["bbbbbbbbbbbbbbbb"]
        and "remote_type" not in by_id["bbbbbbbbbbbbbbbb"]
        and "country" not in by_id["bbbbbbbbbbbbbbbb"],
    ))

    run("public-layer 'date' is unified into 'age'", lambda: check(
        "date -> age",
        by_id["bbbbbbbbbbbbbbbb"]["age"] == "0d",
    ))

    run("hackathon keeps its deadline in 'age', has no level/region/role_type", lambda: check(
        "hackathon shape",
        by_id["cccccccccccccccc"]["kind"] == "hackathon"
        and by_id["cccccccccccccccc"]["age"] == "22 days left"
        and "level" not in by_id["cccccccccccccccc"]
        and "region" not in by_id["cccccccccccccccc"],
    ))

    run("event with an empty date still has a valid (empty) age", lambda: check(
        "event age",
        by_id["dddddddddddddddd"]["kind"] == "event" and by_id["dddddddddddddddd"]["age"] == "",
    ))

    run("every generated item validates against site-index.schema.json", lambda: check(
        "schema valid",
        sv.validate_records(index["items"], site_index_schema, label="items") == [],
    ))

    invalid_curated_job = {**curated_job, "level": "not_a_real_level"}

    def build_with_invalid_row():
        bdr.build_site_index({**curated_payload, "jobs": [invalid_curated_job]}, {"jobs": [], "hackathons": [], "events": []})

    run("build_site_index refuses to publish a schema-invalid row", lambda: check(
        "raises ValueError",
        _raises(build_with_invalid_row, ValueError),
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
