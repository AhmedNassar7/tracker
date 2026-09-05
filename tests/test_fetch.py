import importlib.util
import json
import tempfile
import io
import contextlib
import datetime
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
    # check_url_alive/find_dead_links now live in net.py (shared by both
    # collector layers), imported into fetch's namespace via
    # `from net import ...`. find_dead_links' own internal call to
    # check_url_alive resolves against net.py's globals, not fetch's — so
    # patching fetch.check_url_alive (as the tests below do for the
    # standalone check_url_alive tests) would NOT intercept that internal
    # call. This import, already on sys.path from fetch.py's own
    # sys.path.insert above, gets the same cached net module fetch.py
    # itself imported, so patching net.check_url_alive here reaches it.
    import net
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
        and fetch.detect_level("Software Development Engineer I") == "entry_level"
        and fetch.detect_level("Software Development Engineer II") == "mid_level"
        and fetch.detect_region("Toronto, Canada") == "canada"
        and fetch.detect_region("Berlin, Germany") == "emea"
        and fetch.detect_region("Dubai, United Arab Emirates") == "mena"
        and fetch.detect_region("Cairo, Egypt") == "mena"
        and fetch.detect_region("Riyadh, Saudi Arabia") == "mena"
        and fetch.detect_region("Lagos, Nigeria") == "mena"
        and fetch.detect_region("Remote - Worldwide") == "remote"
        and fetch.detect_remote_type("Remote - Worldwide") == "remote"
        and fetch.detect_remote_type("Hybrid - London") == "hybrid"
        and fetch.detect_remote_type("Austin, USA") == "onsite",
    ))

    run("role regex recognizes Amazon's job-family title", lambda: check(
        "role regex recognizes Amazon's job-family title",
        bool(fetch.ROLE_RE.search("Software Development Engineer"))
        and bool(fetch.ROLE_RE.search("Software Development Engineer II")),
    ))

    with patch.object(fetch, "ALLOWLIST", ["google"]):
        run("include job accepts any region", lambda: check(
            "include job accepts any region",
            fetch.include_job({"level": "new_grad", "region": "unknown"}, "Google")
        ))

    with patch.object(fetch, "ALLOWLIST", ["google", "microsoft", "meta", "arm", "scale ai"]), \
         patch.object(fetch, "ALLOWLIST_CATEGORY_BY_NAME", {"meta": "faang", "arm": "big_tech", "scale ai": "ai_research"}):
        run("allowlist matching is whole-token, not raw substring", lambda: check(
            "allowlist matching",
            fetch.is_allowed_company("Google LLC")
            and fetch.is_allowed_company("Microsoft Corporation")
            and fetch.is_allowed_company("Meta Platforms")
            and fetch.is_allowed_company("Amazon owns Scale AI")  # spaced multi-word entry
            and not fetch.is_allowed_company("Small Startup Inc")
            and not fetch.is_allowed_company("Metaphor")          # "meta" is not a token here
            and not fetch.is_allowed_company("Pharmacy Systems"),  # "arm" is not a token here
        ))

    class _FakeResponse:
        def __init__(self, status, body=b""):
            self.status = status
            self._body = body
        def __enter__(self):
            return self
        def __exit__(self, *exc):
            return False
        def read(self, _n=-1):
            return self._body

    import urllib.error

    with patch("urllib.request.urlopen", return_value=_FakeResponse(200)):
        run("check_url_alive treats 200 as alive", lambda: check(
            "check_url_alive treats 200 as alive",
            fetch.check_url_alive("https://example.com/job/1") is True,
        ))

    with patch("urllib.request.urlopen", side_effect=urllib.error.HTTPError("u", 404, "Not Found", {}, None)):
        run("check_url_alive treats 404 as dead", lambda: check(
            "check_url_alive treats 404 as dead",
            fetch.check_url_alive("https://example.com/job/gone") is False,
        ))

    with patch("urllib.request.urlopen", side_effect=urllib.error.HTTPError("u", 403, "Forbidden", {}, None)):
        run("check_url_alive treats inconclusive errors as alive", lambda: check(
            "check_url_alive treats inconclusive errors as alive",
            fetch.check_url_alive("https://example.com/job/blocked") is True,
        ))

    # Observed on Pinterest's careers site: HEAD 404s even though the page is
    # genuinely live (GET 200) — a HEAD-only 404 must not be trusted alone.
    with patch("urllib.request.urlopen", side_effect=[urllib.error.HTTPError("u", 404, "Not Found", {}, None), _FakeResponse(200)]):
        run("check_url_alive confirms a HEAD 404 with a GET before trusting it", lambda: check(
            "check_url_alive confirms a HEAD 404 with a GET before trusting it",
            fetch.check_url_alive("https://example.com/job/head-404-but-live") is True,
        ))

    # Google Careers always returns 200, live or expired — only the
    # og:title meta tag (empty when expired) tells them apart.
    _google_url = "https://www.google.com/about/careers/applications/jobs/results/123-engineer"
    _live_body = b'<meta property="og:title" content="Software Engineer">'
    _expired_body = b'<meta property="og:title" content="">'

    with patch("urllib.request.urlopen", return_value=_FakeResponse(200, _live_body)) as mock_urlopen:
        run("check_url_alive treats a Google Careers page with a real og:title as alive", lambda: check(
            "check_url_alive treats a Google Careers page with a real og:title as alive",
            fetch.check_url_alive(_google_url) is True
            and mock_urlopen.call_args.args[0].get_method() == "GET",
        ))

    with patch("urllib.request.urlopen", return_value=_FakeResponse(200, _expired_body)):
        run("check_url_alive treats a Google Careers page with an empty og:title as dead", lambda: check(
            "check_url_alive treats a Google Careers page with an empty og:title as dead",
            fetch.check_url_alive(_google_url) is False,
        ))

    # linkedin.com/jobs/view/<id> apply links (the whole LorenzoLaCorte feed)
    # are checked via LinkedIn's unauthenticated guest fragment, which renders
    # "No longer accepting applications" for a closed posting.
    _li_url = "https://www.linkedin.com/jobs/view/software-dev-engineer-at-amazon-4455793689"
    run("_linkedin_job_id pulls the numeric id out of a slugged jobs/view URL", lambda: check(
        "_linkedin_job_id",
        net._linkedin_job_id(_li_url) == "4455793689"
        and net._linkedin_job_id("https://linkedin.com/jobs/view/123") == "123"
        and net._linkedin_job_id("https://example.com/jobs/view/1") is None,
    ))

    with patch("urllib.request.urlopen", return_value=_FakeResponse(200, b"<h2>No longer accepting applications</h2>")):
        run("check_url_alive treats a closed LinkedIn guest posting as dead", lambda: check(
            "check_url_alive closed LinkedIn",
            fetch.check_url_alive(_li_url) is False,
        ))

    with patch("urllib.request.urlopen", return_value=_FakeResponse(200, b"<button>Apply</button>")):
        run("check_url_alive treats an open LinkedIn guest posting as alive", lambda: check(
            "check_url_alive open LinkedIn",
            fetch.check_url_alive(_li_url) is True,
        ))

    with patch("urllib.request.urlopen", return_value=_FakeResponse(200, b"   ")), patch("time.sleep", return_value=None):
        run("check_url_alive treats an unresolvable LinkedIn fragment as dead (low-trust source)", lambda: check(
            "check_url_alive empty LinkedIn fragment",
            fetch.check_url_alive(_li_url) is False,
        ))

    with patch("urllib.request.urlopen", side_effect=urllib.error.HTTPError("u", 404, "Not Found", {}, None)):
        run("check_url_alive treats a 404 LinkedIn guest posting as dead", lambda: check(
            "check_url_alive 404 LinkedIn",
            fetch.check_url_alive(_li_url) is False,
        ))

    # A bot-block (429) that never clears, then treated as dead after retries.
    with patch("urllib.request.urlopen", side_effect=urllib.error.HTTPError("u", 429, "Too Many", {}, None)), patch("time.sleep", return_value=None):
        run("check_url_alive treats a persistently rate-limited LinkedIn check as dead", lambda: check(
            "check_url_alive 429 LinkedIn",
            fetch.check_url_alive(_li_url) is False,
        ))

    # jobs.apple.com / joinbytedance.com detail pages always return 200 —
    # a live posting is server-rendered with an og:title tag, an expired one
    # falls back to a generic shell with none (confirmed by hand against
    # stale vanshb03 Apple rows).
    _apple_url = "https://jobs.apple.com/en-us/details/200646547-3956/software-engineer-is-t-early-career"
    with patch("urllib.request.urlopen", return_value=_FakeResponse(200, b'<meta property="og:title" content="Software Engineer - Careers at Apple">')):
        run("check_url_alive treats an Apple details page with an og:title as alive", lambda: check(
            "check_url_alive Apple live",
            fetch.check_url_alive(_apple_url) is True,
        ))
    with patch("urllib.request.urlopen", return_value=_FakeResponse(200, b"<html><head><title>Careers at Apple</title></head><body>generic shell</body></html>")):
        run("check_url_alive treats an Apple details page with no og:title as dead", lambda: check(
            "check_url_alive Apple expired",
            fetch.check_url_alive(_apple_url) is False,
        ))
    _bd_url = "https://joinbytedance.com/search/7527678842316998919"
    with patch("urllib.request.urlopen", return_value=_FakeResponse(200, b"<html><head></head><body>shell</body></html>")):
        run("check_url_alive treats a ByteDance search page with no og:title as dead", lambda: check(
            "check_url_alive ByteDance expired",
            fetch.check_url_alive(_bd_url) is False,
        ))

    with patch.object(net, "check_url_alive", side_effect=[False, True]):
        run("find_dead_links flags only definitive 404/410 links", lambda: check(
            "find_dead_links flags only definitive 404/410 links",
            {item["url"] for item in fetch.find_dead_links([
                {"company": "Broken Co", "title": "Engineer", "url": "https://example.com/dead"},
                {"company": "Good Co", "title": "Engineer", "url": "https://example.com/live"},
            ])} == {"https://example.com/dead"},
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

    # speedyapply-style table: an apply-button HTML link, and a row with no
    # Salary cell at all (column count shifts, so the parser can't rely on a
    # fixed trailing index for the link/age columns).
    speedyapply_md = "\n".join([
        "| Company | Position | Location | Salary | Posting | Age |",
        "|---|---|---|---|---|---|",
        '| <a href="https://www.google.com"><strong>Google</strong></a> | Software Engineer Intern | Remote - USA | $60/hr | <a href="https://example.com/sa1"><img src="https://i.imgur.com/x.png" alt="Apply" width="70"/></a> | 5d |',
        '| <a href="https://unknown.co"><strong>UnknownCo</strong></a> | Software Engineer Intern | Remote - USA | <a href="https://example.com/sa2"><img src="https://i.imgur.com/x.png" alt="Apply" width="70"/></a> | 5d |',
    ])
    with tempfile.TemporaryDirectory() as tmp:
        data_raw = Path(tmp)

        def fake_fetch(_url, dest, timeout=25):
            dest.write_text(speedyapply_md, encoding="utf-8")
            return True

        with patch.object(fetch, "DATA_RAW", data_raw), patch.object(fetch, "ALLOWLIST", ["google"]), patch.object(fetch, "fetch_url", side_effect=fake_fetch):
            speedyapply_rows = fetch.fetch_speedyapply_swe()
    run("speedyapply fetch handles missing salary column", lambda: check(
        "speedyapply fetch handles missing salary column",
        len(speedyapply_rows) == 1
        and speedyapply_rows[0]["company"] == "Google"
        and speedyapply_rows[0]["url"] == "https://example.com/sa1"
        and speedyapply_rows[0]["age"] == "5d"
        and speedyapply_rows[0]["source"] == "speedyapply_swe",
    ))

    # zapplyjobs-style table: markdown link wrapping an <img>, apply column
    # last, fuzzy "Recently" instead of a day count, bold-markdown company name.
    zapplyjobs_md = "\n".join([
        "| Company | Role | Location | Posted | Visa | **Apply** |",
        "|---|---|---|---|---|---|",
        '| **Google** | Software Engineer Intern | Remote - USA | Recently |  | [<img src="images/apply.png" width="80" alt="Apply">](https://example.com/za1) |',
        '| **UnknownCo** | Software Engineer Intern | Remote - USA | Recently |  | [<img src="images/apply.png" width="80" alt="Apply">](https://example.com/za2) |',
    ])
    with tempfile.TemporaryDirectory() as tmp:
        data_raw = Path(tmp)

        def fake_fetch(_url, dest, timeout=25):
            dest.write_text(zapplyjobs_md, encoding="utf-8")
            return True

        with patch.object(fetch, "DATA_RAW", data_raw), patch.object(fetch, "ALLOWLIST", ["google"]), patch.object(fetch, "fetch_url", side_effect=fake_fetch):
            zapplyjobs_rows = fetch.fetch_zapplyjobs_newgrad()
    run("zapplyjobs fetch strips markdown bold and finds fuzzy age", lambda: check(
        "zapplyjobs fetch strips markdown bold and finds fuzzy age",
        len(zapplyjobs_rows) == 1
        and zapplyjobs_rows[0]["company"] == "Google"
        and zapplyjobs_rows[0]["url"] == "https://example.com/za1"
        and zapplyjobs_rows[0]["age"] == "Recently"
    ))

    # vanshb03-style table: raw `<a href>` apply link (no markdown/img
    # wrapper), real "Mon DD" posted dates (not parsed as an age), and a "↳"
    # marker on the second row that should carry the company from the row above.
    vanshb03_md = "\n".join([
        "| Company | Role | Location | Application/Link | Date Posted |",
        "| --- | --- | --- | --- | --- |",
        '| Google | Software Engineer Intern | Remote - USA | <a href="https://example.com/vb1">Apply</a> | Jul 28 |',
        '| ↳ | Backend Engineer Intern | Remote - USA | <a href="https://example.com/vb2">Apply</a> | Jul 27 |',
        '| UnknownCo | Software Engineer Intern | Remote - USA | <a href="https://example.com/vb3">Apply</a> | Jul 26 |',
    ])
    with tempfile.TemporaryDirectory() as tmp:
        data_raw = Path(tmp)

        def fake_fetch(_url, dest, timeout=25):
            dest.write_text(vanshb03_md, encoding="utf-8")
            return True

        with patch.object(fetch, "DATA_RAW", data_raw), patch.object(fetch, "ALLOWLIST", ["google"]), patch.object(fetch, "fetch_url", side_effect=fake_fetch):
            vanshb03_rows = fetch.fetch_vanshb03_summer_internships()
    run("vanshb03 fetch carries the company forward across a ↓ ditto row", lambda: check(
        "vanshb03 fetch carries the company forward across a ditto row",
        len(vanshb03_rows) == 2
        and vanshb03_rows[0]["company"] == "Google"
        and vanshb03_rows[0]["url"] == "https://example.com/vb1"
        and vanshb03_rows[1]["company"] == "Google"
        and vanshb03_rows[1]["title"] == "Backend Engineer Intern"
        and vanshb03_rows[1]["url"] == "https://example.com/vb2",
    ))

    # vanshb03 flags a closed posting with a bare 🔒 status cell ("🔒 - Job
    # application is closed" in its legend). A struck-through title means the
    # same. Both should be dropped so users stop hitting dead apply links.
    vanshb03_closed_md = "\n".join([
        "| Company | Role | Location | Application/Link | Status | Date Posted |",
        "| --- | --- | --- | --- | --- | --- |",
        '| Google | Software Engineer Intern | Remote - USA | <a href="https://example.com/open">Apply</a> | | Jul 28 |',
        '| Google | Backend Software Engineer | Remote - USA | <a href="https://example.com/closed">Apply</a> | 🔒 | Jul 27 |',
        '| Google | ~~Frontend Software Engineer~~ | Remote - USA | <a href="https://example.com/struck">Apply</a> | | Jul 26 |',
    ])
    with tempfile.TemporaryDirectory() as tmp:
        data_raw = Path(tmp)

        def fake_fetch(_url, dest, timeout=25):
            dest.write_text(vanshb03_closed_md, encoding="utf-8")
            return True

        with patch.object(fetch, "DATA_RAW", data_raw), patch.object(fetch, "ALLOWLIST", ["google"]), patch.object(fetch, "fetch_url", side_effect=fake_fetch):
            vanshb03_closed_rows = fetch.fetch_vanshb03_newgrad()
    run("vanshb03 fetch drops rows the source marked closed (🔒 / strikethrough)", lambda: check(
        "vanshb03 fetch drops rows the source marked closed",
        len(vanshb03_closed_rows) == 1
        and vanshb03_closed_rows[0]["url"] == "https://example.com/open",
        details=str([(r["title"], r["url"]) for r in vanshb03_closed_rows]),
    ))

    run("prettify_company_name fixes token-cased and lowercase names", lambda: check(
        "prettify_company_name",
        fetch.prettify_company_name("Openai") == "OpenAI"
        and fetch.prettify_company_name("mongodb") == "MongoDB"
        and fetch.prettify_company_name("scaleai") == "Scale AI"
        and fetch.prettify_company_name("amazon web services (aws)") == "Amazon Web Services"
        and fetch.prettify_company_name("Stripe") == "Stripe",
    ))

    run("prettify_company_name collapses a legal-entity name to the parent brand", lambda: check(
        "prettify_company_name legal-entity collapse",
        fetch.prettify_company_name("Amazon.com Services LLC") == "Amazon"
        and fetch.prettify_company_name("Amazon Kuiper Commercial Services LLC") == "Amazon"
        and fetch.prettify_company_name("Amazon Development Centre Canada ULC") == "Amazon"
        and fetch.prettify_company_name("Uber Technologies, Inc.") == "Uber"
        and fetch.prettify_company_name("Google LLC") == "Google"
        # a real sub-brand is NOT truncated
        and fetch.prettify_company_name("Amazon Robotics") == "Amazon Robotics"
        and fetch.prettify_company_name("Amazon Web Services") == "Amazon Web Services"
        and fetch.prettify_company_name("Palo Alto Networks") == "Palo Alto Networks",
    ))

    run("format_job_age never lets a source age look fresher than first-seen", lambda: check(
        "format_job_age reconcile",
        # source said "0d" but we first recorded it (posted_at) 26 days ago
        fetch.format_job_age({"age": "0d", "posted_at": "2026-08-10"})
        == f"{(datetime.datetime.now(datetime.UTC).date() - datetime.date(2026, 8, 10)).days}d"
        # a genuinely-fresh row is untouched
        and fetch.format_job_age({"age": "0d", "posted_at": datetime.datetime.now(datetime.UTC).date().isoformat()}) == "0d"
        # parseable source age within the first-seen bound is kept verbatim
        and fetch.format_job_age({"age": "3d", "posted_at": datetime.datetime.now(datetime.UTC).date().isoformat()}) == "3d"
        # no source age -> derive from posted_at
        and fetch.format_job_age({"age": "", "posted_at": "2026-08-10"})
        == f"{(datetime.datetime.now(datetime.UTC).date() - datetime.date(2026, 8, 10)).days}d"
        # nothing to go on -> empty
        and fetch.format_job_age({"age": "", "posted_at": ""}) == "",
    ))

    run("smart_title_case caps an all-lowercase title/location but leaves cased text alone", lambda: check(
        "smart_title_case",
        fetch.smart_title_case("software dev engineer intern, amazon robotics")
        == "Software Dev Engineer Intern, Amazon Robotics"
        and fetch.smart_title_case("berlin, germany") == "Berlin, Germany"
        and fetch.smart_title_case("Senior Software Engineer") == "Senior Software Engineer"
        and fetch.smart_title_case("ios developer") == "iOS Developer",
    ))

    run("_job_sort_key orders same-age rows by company tier, not alphabetically", lambda: check(
        "job sort tier",
        [r["company"] for r in sorted(
            [
                {"company": "Zoom", "title": "SWE", "age": "0d", "category": "product_saas"},
                {"company": "Acme", "title": "SWE", "age": "0d", "category": ""},
                {"company": "Apple", "title": "SWE", "age": "0d", "category": "faang"},
            ],
            key=fetch._job_sort_key,
        )] == ["Apple", "Zoom", "Acme"],
    ))

    # LorenzoLaCorte-style table: lowercase company/title, a trailing empty
    # cell after the link column ("||"), and EMEA locations that should
    # region/country-tag correctly.
    lorenzolacorte_md = "\n".join([
        "|company|title|location|link|",
        "|---|---|---|---|",
        "|google|software engineer, new grad|paris, île-de-france, france|[🔗](https://example.com/eu1)||",
        "|unknownco|software engineer, new grad|paris, île-de-france, france|[🔗](https://example.com/eu2)||",
    ])
    with tempfile.TemporaryDirectory() as tmp:
        data_raw = Path(tmp)

        def fake_fetch(_url, dest, timeout=25):
            dest.write_text(lorenzolacorte_md, encoding="utf-8")
            return True

        with patch.object(fetch, "DATA_RAW", data_raw), patch.object(fetch, "ALLOWLIST", ["google"]), patch.object(fetch, "fetch_url", side_effect=fake_fetch):
            lorenzolacorte_rows = fetch.fetch_lorenzolacorte_eu()
    run("LorenzoLaCorte fetch title-cases the all-lowercase company name, handles a trailing empty cell, and tags EMEA/France", lambda: check(
        "LorenzoLaCorte fetch title-cases the all-lowercase company name, handles a trailing empty cell, and tags EMEA/France",
        len(lorenzolacorte_rows) == 1
        and lorenzolacorte_rows[0]["company"] == "Google"
        and lorenzolacorte_rows[0]["url"] == "https://example.com/eu1"
        and lorenzolacorte_rows[0]["region"] == "emea"
        and lorenzolacorte_rows[0]["country"] == "France",
    ))

    # hanzili-style table: Title comes before Company (reversed column order
    # vs. every other source), url wrapped in a markdown link with <angle
    # brackets> around it.
    hanzili_md = "\n".join([
        "| Title | Company | Role | Company Info | Details | Location | Apply |",
        "|---|---|---|---|---|---|---|",
        "| Software Developer New Grad <!--id:1--> | Google | Build things | Big tech | Full-time | Toronto, Ontario | [Apply](<https://example.com/ha1>) |",
        "| Software Developer New Grad <!--id:2--> | UnknownCo | Build things | Startup | Full-time | Toronto, Ontario | [Apply](<https://example.com/ha2>) |",
    ])
    with tempfile.TemporaryDirectory() as tmp:
        data_raw = Path(tmp)

        def fake_fetch(_url, dest, timeout=25):
            dest.write_text(hanzili_md, encoding="utf-8")
            return True

        with patch.object(fetch, "DATA_RAW", data_raw), patch.object(fetch, "ALLOWLIST", ["google"]), patch.object(fetch, "fetch_url", side_effect=fake_fetch):
            hanzili_rows = fetch.fetch_hanzili_canada()
    run("hanzili fetch handles reversed title/company columns", lambda: check(
        "hanzili fetch handles reversed title/company columns",
        len(hanzili_rows) == 1
        and hanzili_rows[0]["company"] == "Google"
        and hanzili_rows[0]["title"] == "Software Developer New Grad"
        and hanzili_rows[0]["url"] == "https://example.com/ha1",
    ))

    ambicuity_payload = {
        "meta": {"total_jobs": 2},
        "jobs": [
            {
                "company": "Google",
                "title": "Software Engineer, New Grad",
                "location": "Remote - USA",
                "url": "https://example.com/am1",
                "posted_at": "2026-01-10T00:00:00",
                "is_closed": False,
            },
            {
                "company": "Google",
                "title": "Software Engineer, New Grad",
                "location": "Remote - USA",
                "url": "https://example.com/am-closed",
                "posted_at": "2026-01-10T00:00:00",
                "is_closed": True,
            },
        ],
    }
    with tempfile.TemporaryDirectory() as tmp:
        data_raw = Path(tmp)

        def fake_fetch(_url, dest, timeout=25):
            dest.write_text(json.dumps(ambicuity_payload), encoding="utf-8")
            return True

        with patch.object(fetch, "DATA_RAW", data_raw), patch.object(fetch, "ALLOWLIST", ["google"]), patch.object(fetch, "fetch_url", side_effect=fake_fetch):
            ambicuity_rows = fetch.fetch_ambicuity_newgrad()
    run("ambicuity fetch skips closed postings", lambda: check(
        "ambicuity fetch skips closed postings",
        len(ambicuity_rows) == 1
        and ambicuity_rows[0]["company"] == "Google"
        and ambicuity_rows[0]["url"] == "https://example.com/am1"
        and ambicuity_rows[0]["source"] == "ambicuity",
    ))

    amazon_payload = {
        "hits": 2,
        "jobs": [
            {
                "title": "Software Development Engineer I",
                "job_path": "/en/jobs/123/software-development-engineer-i",
                "normalized_location": "Seattle, WA, USA",
                "posted_date": "April  9, 2026",
            },
            {
                "title": "Principal Software Development Engineer",
                "job_path": "/en/jobs/456/principal-software-development-engineer",
                "normalized_location": "Seattle, WA, USA",
                "posted_date": "April  9, 2026",
            },
        ],
    }
    with tempfile.TemporaryDirectory() as tmp:
        data_raw = Path(tmp)

        def fake_fetch(_url, dest, timeout=25):
            dest.write_text(json.dumps(amazon_payload), encoding="utf-8")
            return True

        with patch.object(fetch, "DATA_RAW", data_raw), patch.object(fetch, "ALLOWLIST", ["amazon"]), patch.object(fetch, "fetch_url", side_effect=fake_fetch):
            amazon_rows = fetch.fetch_amazon(max_pages=1)
    run("amazon fetch hits its own API directly and filters by level", lambda: check(
        "amazon fetch hits its own API directly and filters by level",
        len(amazon_rows) == 1
        and amazon_rows[0]["title"] == "Software Development Engineer I"
        and amazon_rows[0]["level"] == "entry_level"
        and amazon_rows[0]["url"] == "https://www.amazon.jobs/en/jobs/123/software-development-engineer-i"
        and amazon_rows[0]["posted_at"] == "2026-04-09"
        and amazon_rows[0]["source"] == "amazon",
    ))

    netflix_payload = {
        "count": 3,
        "positions": [
            {
                # Netflix's real numbered-grade titles ("Software Engineer 4/5/6",
                # "L5", "L6" — seen live) don't match detect_level()'s patterns at
                # all (those only recognize up to "engineer ii"/"sde2"), so they
                # correctly come back level:"unknown" and get filtered by
                # include_job() in strict mode same as any other source's
                # unclassifiable title — this is real Netflix data, confirmed
                # live 2026-08-18, not a fabricated edge case.
                "name": "Software Engineer 4 - Platform Systems",
                "canonicalPositionUrl": "https://explore.jobs.netflix.net/careers/job/790298014263",
                "location": "USA - Remote",
                "t_create": 1721692800,
            },
            {
                # "engineer ii" is one of the few numbered patterns detect_level
                # does recognize (mid_level) — this is what actually clears the
                # level filter.
                "name": "Software Engineer II - Platform Systems",
                "canonicalPositionUrl": "https://explore.jobs.netflix.net/careers/job/790298014264",
                "location": "USA - Remote",
                "t_create": 1721692800,  # 2024-07-23T00:00:00Z
            },
            {
                "name": "Staff Product Designer",  # non-engineering title -> filtered by ROLE_RE
                "canonicalPositionUrl": "https://explore.jobs.netflix.net/careers/job/999",
                "location": "USA - Remote",
                "t_create": 1721692800,
            },
        ],
    }
    with tempfile.TemporaryDirectory() as tmp:
        data_raw = Path(tmp)

        def fake_fetch(_url, dest, timeout=25):
            dest.write_text(json.dumps(netflix_payload), encoding="utf-8")
            return True

        with patch.object(fetch, "DATA_RAW", data_raw), patch.object(fetch, "ALLOWLIST", ["netflix"]), patch.object(fetch, "fetch_url", side_effect=fake_fetch):
            netflix_rows = fetch.fetch_netflix(max_pages=1)
    run("netflix fetch hits its own Eightfold API directly, filters non-engineering and unclassifiable-level roles", lambda: check(
        "netflix fetch hits its own Eightfold API directly, filters non-engineering and unclassifiable-level roles",
        len(netflix_rows) == 1
        and netflix_rows[0]["title"] == "Software Engineer II - Platform Systems"
        and netflix_rows[0]["url"] == "https://explore.jobs.netflix.net/careers/job/790298014264"
        and netflix_rows[0]["posted_at"] == "2024-07-23"
        and netflix_rows[0]["source"] == "netflix"
        and netflix_rows[0]["company"] == "Netflix",
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
        with patch.object(fetch, "DATA_OUT", data_out), patch.object(fetch, "NOW_ISO", "2026-01-12T00:00:00Z"), patch.object(fetch, "TODAY", "2026-01-12"), patch.object(fetch, "check_url_alive", return_value=True):
            fetch.write_outputs(rows)
        payload = json.loads((data_out / "jobs-global.json").read_text(encoding="utf-8"))
        run("write outputs", lambda: check("write outputs", payload["total"] == 1 and payload["jobs"][0]["region"] == "remote" and payload["jobs"][0]["role_type"] == "other_swe" and payload["jobs"][0]["category"] == "" and "age" in payload["jobs"][0] and (data_out / "stats.json").exists() and (data_out / "jobs-global-archive.json").exists()))

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
            with patch.object(fetch, "DATA_OUT", data_out), patch.object(fetch, "NOW_ISO", "2026-01-12T00:00:00Z"), patch.object(fetch, "TODAY", "2026-01-12"), patch.object(fetch, "check_url_alive", return_value=True):
                fetch.write_outputs(unsorted_rows)
            sorted_payload = json.loads((data_out / "jobs-global.json").read_text(encoding="utf-8"))
            companies_in_order = [j["company"] for j in sorted_payload["jobs"]]
            run("write outputs sorts by age", lambda: check(
                "write outputs sorts by age",
                companies_in_order.index("Alpha") < companies_in_order.index("Beta")
            ))

    existing_row = {
        "id": "bbbbbbbbbbbbbbbb",
        "company": "Mirage",
        "title": "Software Engineer – Early Career",
        "level": "new_grad",
        "category": "",
        "region": "us",
        "role_type": "software_engineer",
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
        (data_out / "stats.json").write_text(json.dumps({"generated_at": "2026-01-01T00:00:00Z", "total": 1, "by_level": {"new_grad": 1}, "by_country": {"United States": 1}, "by_source": {"simplify_newgrad": 1}}, ensure_ascii=False, indent=2), encoding="utf-8")

        unchanged_row = dict(existing_row)
        unchanged_row["age"] = "3d"
        unchanged_row["collected_at"] = "2026-01-02T00:00:00Z"

        before_json = (data_out / "jobs-global.json").read_text(encoding="utf-8")
        before_stats = (data_out / "stats.json").read_text(encoding="utf-8")

        with patch.object(fetch, "DATA_OUT", data_out), patch.object(fetch, "NOW_ISO", "2026-01-02T00:00:00Z"), patch.object(fetch, "TODAY", "2026-01-02"), patch.object(fetch, "check_url_alive", return_value=True):
            fetch.write_outputs([unchanged_row])

        run("write outputs skips age-only changes", lambda: check(
            "write outputs skips age-only changes",
            (data_out / "jobs-global.json").read_text(encoding="utf-8") == before_json
            and (data_out / "stats.json").read_text(encoding="utf-8") == before_stats,
        ))

    with tempfile.TemporaryDirectory() as tmp:
        data_out = Path(tmp)
        (data_out / "jobs-global.json").write_text(json.dumps({"generated_at": "2026-01-01T00:00:00Z", "total": 1, "jobs": [existing_row]}, ensure_ascii=False, indent=2), encoding="utf-8")
        (data_out / "jobs-global-archive.json").write_text(json.dumps({"generated_at": "2026-01-01T00:00:00Z", "total": 0, "jobs": []}, ensure_ascii=False, indent=2), encoding="utf-8")

        dead_link_row = dict(existing_row)
        dead_link_row["age"] = "3d"
        with patch.object(fetch, "DATA_OUT", data_out), patch.object(fetch, "NOW_ISO", "2026-01-02T00:00:00Z"), patch.object(fetch, "TODAY", "2026-01-02"), patch.object(fetch, "check_url_alive", return_value=False):
            fetch.write_outputs([dead_link_row])

        active_payload = json.loads((data_out / "jobs-global.json").read_text(encoding="utf-8"))
        archive_payload = json.loads((data_out / "jobs-global-archive.json").read_text(encoding="utf-8"))
        run("dead link is archived instead of published", lambda: check(
            "dead link is archived instead of published",
            active_payload["total"] == 0
            and archive_payload["total"] == 1
            and archive_payload["jobs"][0]["id"] == existing_row["id"]
            and archive_payload["jobs"][0]["closed_at"] == "2026-01-02T00:00:00Z",
        ))

    with tempfile.TemporaryDirectory() as tmp:
        data_out = Path(tmp)
        (data_out / "jobs-global.json").write_text(json.dumps({"generated_at": "2026-01-01T00:00:00Z", "total": 1, "jobs": [existing_row]}, ensure_ascii=False, indent=2), encoding="utf-8")
        (data_out / "jobs-global-archive.json").write_text(json.dumps({"generated_at": "2026-01-01T00:00:00Z", "total": 0, "jobs": []}, ensure_ascii=False, indent=2), encoding="utf-8")

        with patch.object(fetch, "DATA_OUT", data_out), patch.object(fetch, "NOW_ISO", "2026-01-02T00:00:00Z"), patch.object(fetch, "TODAY", "2026-01-02"), patch.object(fetch, "check_url_alive", return_value=True):
            fetch.write_outputs([])

        active_payload = json.loads((data_out / "jobs-global.json").read_text(encoding="utf-8"))
        archive_payload = json.loads((data_out / "jobs-global-archive.json").read_text(encoding="utf-8"))
        run("posting dropped from the source feed is archived", lambda: check(
            "posting dropped from the source feed is archived",
            active_payload["total"] == 0
            and archive_payload["total"] == 1
            and archive_payload["jobs"][0]["id"] == existing_row["id"]
            and archive_payload["jobs"][0]["closed_at"] == "2026-01-02T00:00:00Z",
        ))

    with tempfile.TemporaryDirectory() as tmp:
        data_out = Path(tmp)
        archived_copy = dict(existing_row)
        archived_copy["closed_at"] = "2026-01-01T00:00:00Z"
        (data_out / "jobs-global.json").write_text(json.dumps({"generated_at": "2026-01-01T00:00:00Z", "total": 0, "jobs": []}, ensure_ascii=False, indent=2), encoding="utf-8")
        (data_out / "jobs-global-archive.json").write_text(json.dumps({"generated_at": "2026-01-01T00:00:00Z", "total": 1, "jobs": [archived_copy]}, ensure_ascii=False, indent=2), encoding="utf-8")

        revived_row = dict(existing_row)
        with patch.object(fetch, "DATA_OUT", data_out), patch.object(fetch, "NOW_ISO", "2026-01-02T00:00:00Z"), patch.object(fetch, "TODAY", "2026-01-02"), patch.object(fetch, "check_url_alive", return_value=True):
            fetch.write_outputs([revived_row])

        active_payload = json.loads((data_out / "jobs-global.json").read_text(encoding="utf-8"))
        archive_payload = json.loads((data_out / "jobs-global-archive.json").read_text(encoding="utf-8"))
        run("posting that reappears active is dropped from the archive", lambda: check(
            "posting that reappears active is dropped from the archive",
            active_payload["total"] == 1
            and active_payload["jobs"][0]["id"] == existing_row["id"]
            and archive_payload["total"] == 0,
        ))

    # Sourced from fetch.SOURCE_FETCHER_NAMES itself (rather than a second
    # hardcoded copy here) so this check can't silently drift out of sync
    # when a new source fetcher is added.
    source_fn_names = fetch.SOURCE_FETCHER_NAMES
    with contextlib.ExitStack() as stack:
        source_mocks = {
            name: stack.enter_context(patch.object(fetch, name, return_value=[]))
            for name in source_fn_names
        }
        stack.enter_context(patch.object(fetch, "dedupe", return_value=[]))
        write_outputs = stack.enter_context(patch.object(fetch, "write_outputs"))
        stack.enter_context(patch.object(fetch, "log_warn"))
        fetch.main()
    call_counts = {name: mock.call_count for name, mock in source_mocks.items()}
    assert all(count >= 1 for count in call_counts.values()), call_counts
    assert len(set(call_counts.values())) == 1, call_counts
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
