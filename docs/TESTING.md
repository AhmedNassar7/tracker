# Testing

[← back to project overview](../README.md) · [docs index](../README.md#documentation)

## Test framework used

None of the standard ones — no pytest, no unittest test-discovery. Each test file is a single plain Python script with one `main()` function that runs a sequence of checks in order and raises `AssertionError` (or lets one propagate) on the first failure. The only stdlib pieces borrowed are `unittest.mock.patch` (for monkeypatching module-level state and functions) and `tempfile.TemporaryDirectory` (for isolating file writes). This is a deliberate consequence of the project having zero dependencies — pulling in pytest would break the "no `requirements.txt`" rule for a dev-only tool, so a small hand-rolled runner is used instead.

Each check is registered with a local `run(name, fn)` helper that prints a green `✅ <name>` on success; any assertion failure inside `fn` raises, `main()`'s top-level `try/except` catches it, prints a red `❌ TEST FAILED: ...`, and exits `1`.

## How to run tests

```bash
python tests/test_net.py
python tests/test_fetch.py
python tests/test_patterns.py
python tests/test_public_sources.py
python tests/test_schema_validation.py
python tests/test_site_index.py
python tests/test_stats_history.py
python tests/test_rss_feeds.py
```

All eight must pass — this is exactly what [CI](DEPLOYMENT.md) runs on every push/PR. On Windows, if the ✅/❌ characters raise `UnicodeEncodeError`, set UTF-8 output first:

```powershell
$env:PYTHONIOENCODING = "utf-8"
```

There is no test runner flag to select one test — to isolate a single check while debugging, temporarily comment out the other `run(...)` calls in the relevant file, run it, then undo.

## What is tested — feature to test file map

| Feature / function | Tested in | What's covered |
|---|---|---|
| `fetch_with_retry` | `tests/test_net.py` | Succeeds first try; does not retry a non-retryable HTTP error (404); retries a transient `URLError` and recovers; raises after exhausting retries; retries a 429 and recovers; honors a `Retry-After` header |
| `run_concurrently` | `tests/test_net.py` | Results come back in `arg_tuples` order, not completion order; a per-call exception is isolated without losing the other results; empty input returns `[]` |
| `make_id`, `detect_level`, `detect_region`, `detect_remote_type` | `tests/test_fetch.py` | ID stability/uniqueness, level/region/remote-type classification against real-shaped title/location strings |
| `detect_tech_tags`, `detect_requirements`, `parse_salary`, `extract_job_facets` (`scripts/patterns.py`) | `tests/test_patterns.py` | B3/B4/B5 job-facet detection: canonical tech tags from JD text (Java ≠ JavaScript, "React Native" not double-counted as "React"); **rejects ambiguous prose** — bare "go"/"spark"/"spring"/"rust" as ordinary words must not tag a language; visa-sponsorship / degree / relocation only when the text is explicit (negative statement wins over positive; silent text → key absent, never `False`); `parse_salary` needs a currency-marked two-ended range and rejects junk (single number, >10× spread, min>max, out-of-bounds), infers `period` from magnitude when unstated |
| `normalize(..., description=...)` facet merge | `tests/test_fetch.py` | Adds no facet keys when no description is passed; extracts `tech_tags`/`visa_sponsorship`/`degree_required`/`salary` from a description string |
| `fetch_greenhouse_board_jobs` facet attach | `tests/test_public_sources.py` | Lifts facets from the entity-encoded `?content=true` HTML body; a posting with no `content` gets no facet keys |
| `include_job`, `is_allowed_company` | `tests/test_fetch.py` | Allowlist substring matching, relaxed-region inclusion rule |
| `check_url_alive` | `tests/test_fetch.py` | 200 = alive, GET-confirmed 404 = dead, inconclusive errors (403) = assume alive, **HEAD 404 followed by GET 200 = alive** (the Pinterest-observed edge case) |
| `normalize` | `tests/test_fetch.py` | Output schema shape and field derivation |
| `dedupe` | `tests/test_fetch.py` | Duplicate `id` collapsed |
| `fetch_remotive` | `tests/test_fetch.py` | JSON-API fetcher end-to-end with a faked payload, allowlist filtering |
| `fetch_simplify_internships` / `fetch_simplify_newgrad` | `tests/test_fetch.py` | Pipe-table parsing, HTML-table parsing with `<details>` multi-location, inactive-roles section exclusion |
| `fetch_speedyapply_swe` | `tests/test_fetch.py` | Generic community-board parser handling a missing trailing (salary) column |
| `fetch_zapplyjobs_newgrad` | `tests/test_fetch.py` | Markdown-bold company names, fuzzy age text ("Recently") instead of a day count |
| community-board parser (`fetch_speedyapply_swe`) | `tests/test_fetch.py` | "↳" ditto-row company carry-forward; drops rows the source marked closed (🔒 / strikethrough) |
| `fetch_lorenzolacorte_eu` | `tests/test_fetch.py` | All-lowercase company title-casing, trailing empty cell, EMEA/country tagging |
| `fetch_hanzili_canada` | `tests/test_fetch.py` | Reversed title/company column order, angle-bracket-wrapped URL |
| `fetch_ambicuity_newgrad` | `tests/test_fetch.py` | JSON feed fetcher, `is_closed` postings skipped |
| `write_outputs` / `write_fetch_outputs` | `tests/test_fetch.py` | Fresh write, sort-by-age ordering, change-only skip (age-only diffs don't rewrite), dead-link archiving, vanished-posting archiving, archive revival on reappearance |
| `main()` orchestration | `tests/test_fetch.py` | Every registered fetcher gets called exactly once per run (strict mode), consistent call counts, `write_outputs` invoked once |
| `discover_job_board_sources`, `extract_workday_site` | `tests/test_public_sources.py` | Greenhouse/Lever/Workday URL-shape extraction, Workday locale-segment skip (Intel/Sony-style URLs) |
| `is_software_job`, `detect_level`, `detect_role_type` | `tests/test_public_sources.py` | Software-vs-non-software title filtering |
| `fetch_devpost_hackathons` | `tests/test_public_sources.py` | JSON API mapping |
| `parse_luma_discover` | `tests/test_public_sources.py` | Tech-relevance filtering (keeps "Cursor Community", drops "Reading Rhythms") |
| `fetch_greenhouse_board_jobs` | `tests/test_public_sources.py` | Job mapping + non-software-role filtering |
| `fetch_ashby_board_jobs` | `tests/test_public_sources.py` | `isListed: false` postings excluded |
| `fetch_smartrecruiters_jobs` | `tests/test_public_sources.py` | Location assembly, `remote` flag appended to location text |
| `fetch_workday_jobs` | `tests/test_public_sources.py` | Pagination (stops on a short page), non-software filtering, `postedOn` → age string |
| `parse_workday_posted_on` | `tests/test_public_sources.py` | "Today"/"Yesterday"/"N Days Ago"/"30+ Days Ago" parsing |
| `fetch_workday_job_locations` (via `fetch_workday_jobs`) | `tests/test_public_sources.py` | Bare "N Locations" count resolved into a real `<details>` dropdown via the per-job detail call |
| `load_extra_job_boards` | `tests/test_public_sources.py` | YAML-by-hand parsing of `ashby:`/`smartrecruiters:` sections |
| `write_outputs` (public) | `tests/test_public_sources.py` | Correct split into `jobs`/`hackathons`/`events` arrays; drops a confirmed-dead link before publishing (the public layer's own dead-link check, `check_url_alive` wired in via `scripts/public_outputs.py`) |
| `load_extra_job_boards` (incl. hand-seeded `greenhouse:`/`lever:` sections) | `tests/test_public_sources.py` | Parses all four sections (`ashby`/`smartrecruiters`/`greenhouse`/`lever`) from config |
| `validate_record`, `validate_records` (`scripts/schema_validator.py`) | `tests/test_schema_validation.py` | Type/enum/pattern/`additionalProperties` checks against both `JobEntry` and `PublicEntry`; integration tests proving `fetch.write_outputs` / `public_sources.write_outputs` refuse to publish an invalid row; a pre-existing legacy-shaped archive row doesn't block a run with valid fresh data |
| `build_site_index` (`scripts/build_data_readme.py`) | `tests/test_site_index.py` | Curated-only fields (`category`/`remote_type`/`country`) kept on curated items and omitted (not fabricated) on public items; `date`→`age` unification; checksum stability/change detection; refuses to publish a schema-invalid row |

The README-rendering functions (`render_root_readme` / `render_data_readme` in `scripts/build_data_readme.py`) still have no automated test — verified manually by running the script and reading the output. If you change those, run it locally and diff the result before committing.

## How to write a new test — real example from this codebase

Every fetcher test follows the same shape: build a fake source payload, patch `fetch_url` (or `fetch_json`/`fetch_json_post` for the public-sources module) to hand it back instead of making a real HTTP call, call the function, and assert on the result. This is the actual `speedyapply` test from `tests/test_fetch.py`:

```python
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
```

The comment above the fixture explains *why* this specific input shape matters (a missing trailing column shifting indices) — follow that pattern: a new test's fixture should encode the real edge case you're guarding against, not a generic happy path, since the happy path is already covered by the `fetch_remotive`/`fetch_arbeitnow` tests.

To add a check: pick the right test file, add a fixture + patched-fetch block following the pattern above, call it through `run("descriptive name", lambda: check(...))`, then run the file directly to confirm the green checkmark appears. If you added a brand-new fetcher, register it in `fetch.SOURCE_FETCHER_NAMES` (`scripts/fetch.py`) — the "main calls all sources consistently" check in `tests/test_fetch.py` reads that same list rather than keeping its own separate copy, so there's nothing to update on the test side (see [DEVELOPER-GUIDE.md](DEVELOPER-GUIDE.md#how-to-add-a-new-feature-for-this-codebase)).
