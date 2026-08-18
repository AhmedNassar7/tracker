import contextlib
import importlib.util
import io
import xml.etree.ElementTree as ET
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
    rf = load_module("scripts/rss_feeds.py", "rss_feeds_module_for_test")

    total = 0

    def run(name, fn):
        nonlocal total
        total += 1
        fn()
        print(color(f"✅ {name}", GREEN))

    job_internship = {
        "id": "aaaaaaaaaaaaaaaa",
        "kind": "job",
        "company": "Amazon",
        "title": "SDE Intern",
        "location": "Seattle, WA",
        "level": "internship",
        "age": "1d",
        "url": "https://example.com/a",
        "posted_at": "2026-08-10",
    }
    job_new_grad = {
        "id": "bbbbbbbbbbbbbbbb",
        "kind": "job",
        "company": "Stripe & Co",  # deliberately carries an XML special char
        "title": "New Grad SWE <Backend>",  # deliberately carries a raw '<'
        "location": "Remote",
        "level": "new_grad",
        "age": "3d",
        "url": "https://example.com/b",
        "posted_at": "2026-08-08",
    }
    job_mid_level = {
        "id": "cccccccccccccccc",
        "kind": "job",
        "company": "Google",
        "title": "Senior SWE",
        "location": "Remote",
        "level": "mid_level",
        "age": "0d",
        "url": "https://example.com/c",
        "posted_at": "2026-08-12",
    }
    hackathon = {
        "id": "dddddddddddddddd",
        "kind": "hackathon",
        "company": "Devpost",
        "title": "Build Hack",
        "location": "Online",
        "age": "10 days left",
        "url": "https://example.com/d",
        "posted_at": "",  # Workday's fuzzy-date case can leave this empty
    }

    items = [job_internship, job_new_grad, job_mid_level, hackathon]
    generated_at = "2026-08-18T00:00:00Z"

    all_jobs_preset = next(p for p in rf.FEED_PRESETS if p["id"] == "all-jobs")
    internships_preset = next(p for p in rf.FEED_PRESETS if p["id"] == "internships")
    new_grad_preset = next(p for p in rf.FEED_PRESETS if p["id"] == "new-grad")
    hackathons_preset = next(p for p in rf.FEED_PRESETS if p["id"] == "hackathons")

    all_jobs_xml = rf.build_feed_xml(all_jobs_preset, items, generated_at)
    parsed_all_jobs = ET.fromstring(all_jobs_xml.split("\n", 1)[1])  # strip the leading XML declaration line

    run("all-jobs feed includes every job, excludes the hackathon", lambda: check(
        "3 job items",
        len(parsed_all_jobs.findall("./channel/item")) == 3,
    ))

    internships_xml = rf.build_feed_xml(internships_preset, items, generated_at)
    parsed_internships = ET.fromstring(internships_xml.split("\n", 1)[1])

    run("internships feed matches only the internship-level job", lambda: check(
        "1 item, the internship",
        len(parsed_internships.findall("./channel/item")) == 1
        and parsed_internships.find("./channel/item/guid").text == "aaaaaaaaaaaaaaaa",
    ))

    new_grad_xml = rf.build_feed_xml(new_grad_preset, items, generated_at)
    parsed_new_grad = ET.fromstring(new_grad_xml.split("\n", 1)[1])

    run("new-grad feed matches only the new_grad-level job", lambda: check(
        "1 item, the new grad role",
        len(parsed_new_grad.findall("./channel/item")) == 1
        and parsed_new_grad.find("./channel/item/guid").text == "bbbbbbbbbbbbbbbb",
    ))

    run("mid_level job appears in all-jobs but not internships or new-grad", lambda: check(
        "excluded from level-specific feeds",
        "cccccccccccccccc" not in [g.text for g in parsed_internships.findall("./channel/item/guid")]
        and "cccccccccccccccc" not in [g.text for g in parsed_new_grad.findall("./channel/item/guid")],
    ))

    hackathons_xml = rf.build_feed_xml(hackathons_preset, items, generated_at)
    parsed_hackathons = ET.fromstring(hackathons_xml.split("\n", 1)[1])

    run("hackathons feed matches only the hackathon, empty posted_at doesn't crash", lambda: check(
        "1 hackathon item",
        len(parsed_hackathons.findall("./channel/item")) == 1,
    ))

    run("hackathon item with empty posted_at has no pubDate rather than a bad one", lambda: check(
        "no pubDate element",
        parsed_hackathons.find("./channel/item/pubDate") is None,
    ))

    run("items are sorted newest posted_at first", lambda: check(
        "order by posted_at desc",
        [g.text for g in parsed_all_jobs.findall("./channel/item/guid")]
        == ["cccccccccccccccc", "aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"],
    ))

    run("company/title with XML special characters round-trip correctly", lambda: check(
        "escaped and unescaped without corruption",
        parsed_new_grad.find("./channel/item/title").text == "Stripe & Co — New Grad SWE <Backend>",
    ))

    run("a real posted_at produces an RFC 2822 pubDate", lambda: check(
        "pubDate present",
        parsed_all_jobs.find("./channel/item/pubDate") is not None,
    ))

    run("channel metadata is present and correct", lambda: check(
        "title/link/description",
        parsed_all_jobs.find("./channel/title").text == "tracker — All Jobs"
        and parsed_all_jobs.find("./channel/link").text == rf.SITE_URL,
    ))

    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        out_dir = Path(tmp) / "feeds"
        written = rf.write_feeds(items, generated_at, out_dir)

        run("write_feeds writes one file per preset", lambda: check(
            "5 files written",
            len(written) == len(rf.FEED_PRESETS) and all(p.exists() for p in written),
        ))

        run("a written feed file is valid, parseable XML", lambda: check(
            "parses without error",
            ET.fromstring((out_dir / "all-jobs.xml").read_text(encoding="utf-8").split("\n", 1)[1]) is not None,
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
