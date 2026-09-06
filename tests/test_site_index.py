import contextlib
import datetime
import importlib.util
import io
import json
from pathlib import Path

# A job fixture claiming age "0d" must carry a matching posted_at, or the
# pipeline's reconcile_age() (correctly) rewrites the stale age to
# days-since-posted_at.
_TODAY_ISO = datetime.datetime.now(datetime.UTC).date().isoformat()


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
        "posted_at": _TODAY_ISO,
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
        "posted_at": _TODAY_ISO,
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
        "url": "/some-event?k=c",  # Luma's site-relative shape
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
            {**public_payload, "jobs": public_payload["jobs"] + [
                {**public_job, "id": "eeeeeeeeeeeeeeee", "url": "https://example.com/gh-distinct"}
            ]},
        )["checksum"] != index["checksum"],
    ))

    run("build_site_index drops a cross-layer exact-duplicate job", lambda: check(
        "cross-layer dedupe",
        # public_job is the same company/title/url as curated_job? no — give it one.
        len(bdr.build_site_index(
            {**curated_payload, "jobs": [curated_job]},
            {**public_payload, "jobs": [{
                **public_job, "id": "ffffffffffffffff",
                "company": curated_job["company"], "title": curated_job["title"],
                "url": curated_job["url"],
            }]},
        )["items"]) == 3,  # 1 job (deduped) + hackathon + event
    ))

    run("build_site_index prunes a job older than 180 days", lambda: check(
        "stale prune",
        all(it["id"] != "0000000000000000" for it in bdr.build_site_index(
            {**curated_payload, "jobs": [curated_job, {
                **curated_job, "id": "0000000000000000",
                "url": "https://example.com/old", "age": "210d",
                "posted_at": "",
            }]},
            {"jobs": [], "hackathons": [], "events": []},
        )["items"]),
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

    run("Luma's site-relative event url is resolved to an absolute link", lambda: check(
        "relative url resolved",
        by_id["dddddddddddddddd"]["url"] == "https://lu.ma/some-event?k=c",
    ))

    run("an already-absolute url is left unchanged", lambda: check(
        "absolute url unchanged",
        by_id["cccccccccccccccc"]["url"] == "https://example.devpost.com/",
    ))

    run("every generated item validates against site-index.schema.json", lambda: check(
        "schema valid",
        sv.validate_records(index["items"], site_index_schema, label="items") == [],
    ))

    boards = bdr.load_aggregate_links()
    run("load_aggregate_links parses 'Company | text | url' lines from the config", lambda: check(
        "aggregate links parsed",
        len(boards) >= 1
        and all(b["company"] and b["title"] and b["url"].startswith("http") for b in boards),
    ))

    run("_clean_site_location unpacks the README <details> dropdown into a summary + list", lambda: check(
        "clean location",
        bdr._clean_site_location(
            "<details><summary><strong>3 locations</strong></summary>Seattle, WA<br>Austin, TX<br>NYC</details>"
        ) == ("Seattle, WA +2 more", ["Seattle, WA", "Austin, TX", "NYC"])
        # space-mashed body (the count_match branch of format_location_display)
        and bdr._clean_site_location(
            "<details><summary><strong>2 locations</strong></summary>San Jose, CA Austin, TX</details>"
        ) == ("San Jose, CA +1 more", ["San Jose, CA", "Austin, TX"])
        # a plain single location is passed straight through, no list
        and bdr._clean_site_location("London, UK") == ("London, UK", [])
        # any stray markup is stripped even without a dropdown
        and bdr._clean_site_location("Remote <br> US") == ("Remote US", []),
    ))

    ml_job = {**curated_job, "location": "<details><summary><strong>3 locations</strong></summary>Seattle, WA<br>Austin, TX<br>NYC</details>"}
    ml_index = bdr.build_site_index({**curated_payload, "jobs": [ml_job]}, {"jobs": [], "hackathons": [], "events": []})
    run("build_site_index emits a clean location summary + locations[] for a multi-location row", lambda: check(
        "multi-location site entry",
        ml_index["items"][0]["location"] == "Seattle, WA +2 more"
        and ml_index["items"][0]["locations"] == ["Seattle, WA", "Austin, TX", "NYC"]
        and "<" not in ml_index["items"][0]["location"],
    ))

    invalid_curated_job = {**curated_job, "level": "not_a_real_level"}

    def build_with_invalid_row():
        bdr.build_site_index({**curated_payload, "jobs": [invalid_curated_job]}, {"jobs": [], "hackathons": [], "events": []})

    run("build_site_index refuses to publish a schema-invalid row", lambda: check(
        "raises ValueError",
        _raises(build_with_invalid_row, ValueError),
    ))

    # B3/B4/B5 — facets carried from a public job record through to site-index.json
    faceted_public_job = {
        **public_job,
        "id": "1111111111111111",
        "url": "https://example.com/gh-faceted",
        "tech_tags": ["Python", "Go"],
        "visa_sponsorship": True,
        "degree_required": False,
        "salary": {"min": 120000, "max": 150000, "currency": "USD", "period": "year"},
    }
    faceted_index = bdr.build_site_index(
        {"jobs": [], "hackathons": [], "events": []},
        {"jobs": [faceted_public_job], "hackathons": [], "events": []},
    )
    run("build_site_index carries B3/B4/B5 facets through for a job", lambda: check(
        "facets in site index",
        faceted_index["items"][0].get("tech_tags") == ["Python", "Go"]
        and faceted_index["items"][0].get("visa_sponsorship") is True
        and faceted_index["items"][0].get("degree_required") is False
        and faceted_index["items"][0].get("salary", {}).get("currency") == "USD",
        details=str(faceted_index["items"][0]),
    ))
    run("faceted item still validates against site-index.schema.json", lambda: check(
        "faceted schema valid",
        sv.validate_records(faceted_index["items"], site_index_schema, label="items") == [],
    ))
    run("a job with no facets gets no facet keys", lambda: check(
        "no phantom facet keys",
        not any(k in by_id["bbbbbbbbbbbbbbbb"] for k in
                ("tech_tags", "visa_sponsorship", "degree_required", "relocation", "salary")),
    ))

    # B1 — aggregate-links board rows ride along in site-index.json
    board_row = {
        "id": "9999999999999999",
        "kind": "board",
        "origin": "config",
        "company": "Google",
        "title": "Early-career & internship software roles",
        "location": "",
        "age": "",
        "posted_at": "",
        "url": "https://www.google.com/about/careers/applications/jobs/results/?q=Software%20Engineer",
        "source": "company_board",
        "source_url": "https://www.google.com/about/careers/applications/jobs/results/?q=Software%20Engineer",
    }
    board_index = bdr.build_site_index(
        curated_payload, public_payload, {}, [board_row]
    )
    board_items = [it for it in board_index["items"] if it["kind"] == "board"]
    run("build_site_index appends aggregate-links boards as kind:'board'", lambda: check(
        "board in index",
        len(board_items) == 1
        and board_items[0]["origin"] == "config"
        and board_items[0]["company"] == "Google"
        and board_items[0]["url"].startswith("https://www.google.com/about/careers/"),
        details=str(board_items),
    ))
    run("a board row carries no liveness / opportunity fields", lambda: check(
        "board has no liveness",
        "liveness" not in board_items[0]
        and "last_checked" not in board_items[0]
        and "level" not in board_items[0]
        and board_items[0]["age"] == "" and board_items[0]["posted_at"] == "",
    ))
    run("boards don't change the job/hackathon/event item count", lambda: check(
        "board count isolation",
        board_index["count"] == index["count"] + 1,
    ))
    run("board rows validate against site-index.schema.json", lambda: check(
        "board schema valid",
        sv.validate_records(board_index["items"], site_index_schema, label="items") == [],
    ))
    run("no boards passed → no board items (unchanged behaviour)", lambda: check(
        "no boards default",
        not any(it["kind"] == "board" for it in index["items"]),
    ))

    # A1 — verified-open signal from data/link-cache.json
    live_cache = {
        public_job["url"]: {"alive": True, "at": "2026-01-01T09:30:00Z"},
        event["url"]: {"alive": True, "at": "2026-01-01T08:00:00Z"},  # raw relative path, pre-fix_event_url
    }
    live_index = bdr.build_site_index(curated_payload, public_payload, live_cache)
    live_by_id = {it["id"]: it for it in live_index["items"]}
    run("build_site_index marks a cached url 'verified' with last_checked", lambda: check(
        "liveness verified",
        live_by_id["bbbbbbbbbbbbbbbb"]["liveness"] == "verified"
        and live_by_id["bbbbbbbbbbbbbbbb"]["last_checked"] == "2026-01-01T09:30:00Z",
        details=str(live_by_id["bbbbbbbbbbbbbbbb"]),
    ))
    run("build_site_index marks an uncached url 'unverified' with no last_checked", lambda: check(
        "liveness unverified",
        live_by_id["aaaaaaaaaaaaaaaa"]["liveness"] == "unverified"
        and "last_checked" not in live_by_id["aaaaaaaaaaaaaaaa"],
    ))
    run("liveness cache is keyed on the RAW url, before Luma path resolution", lambda: check(
        "liveness raw-url lookup",
        live_by_id["dddddddddddddddd"]["liveness"] == "verified"
        and live_by_id["dddddddddddddddd"]["url"] == "https://lu.ma/some-event?k=c",
    ))
    run("a dead/absent cache entry never yields 'verified'", lambda: check(
        "liveness dead entry",
        bdr.build_site_index(
            curated_payload, public_payload,
            {public_job["url"]: {"alive": False, "at": "2026-01-01T09:30:00Z"}},
        )["items"] and all(
            it["liveness"] == "unverified"
            for it in bdr.build_site_index(
                curated_payload, public_payload,
                {public_job["url"]: {"alive": False, "at": "2026-01-01T09:30:00Z"}},
            )["items"]
        ),
    ))
    run("no cache arg → every item is 'unverified' (tests keep working)", lambda: check(
        "liveness default",
        all(it["liveness"] == "unverified" for it in index["items"]),
    ))
    run("liveness fields still validate against site-index.schema.json", lambda: check(
        "liveness schema valid",
        sv.validate_records(live_index["items"], site_index_schema, label="items") == [],
    ))

    run("normalize_rows carries facet keys through for the README path", lambda: check(
        "normalize_rows facets",
        (lambda r: r.get("visa_sponsorship") is True
         and r.get("tech_tags") == ["Rust"]
         and r.get("salary", {}).get("period") == "year"
         and "relocation" not in r)(
            bdr.normalize_rows([{
                "company": "Acme", "title": "SWE", "url": "https://x/y", "source": "remotive",
                "posted_at": "2026-01-01", "age": "2d", "level": "new_grad", "kind": "job",
                "visa_sponsorship": True, "tech_tags": ["Rust"],
                "salary": {"min": 90000, "max": 110000, "currency": "USD", "period": "year"},
            }], "curated")[0]
        ),
    ))

    # README render helpers
    run("format_salary_short renders a compact range", lambda: check(
        "salary short",
        bdr.format_salary_short({"min": 120000, "max": 150000, "currency": "USD", "period": "year"}) == "$120k–$150k/yr"
        and bdr.format_salary_short({"min": 22, "max": 28, "currency": "USD", "period": "hour"}) == "$22–$28/hr"
        and bdr.format_salary_short({"min": 1, "currency": "USD"}) == "",
    ))
    run("job_row_markers emits 🛂 only for an explicit visa=true", lambda: check(
        "row markers",
        bdr.job_row_markers({"visa_sponsorship": True}).strip() == "\U0001f6c2"
        and bdr.job_row_markers({"visa_sponsorship": False}) == ""
        and bdr.job_row_markers({}) == "",
    ))
    run("table_rows prepends 🛂 and appends the pay range to the title cell", lambda: check(
        "table_rows facet render",
        (lambda line: "\U0001f6c2 [" in line and "_$120k–$150k/yr_" in line)(
            bdr.table_rows([{
                "company": "Acme", "title": "SWE Intern", "location": "Remote",
                "age": "3d", "url": "https://example.com/j",
                "visa_sponsorship": True,
                "salary": {"min": 120000, "max": 150000, "currency": "USD", "period": "year"},
            }])[0]
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
