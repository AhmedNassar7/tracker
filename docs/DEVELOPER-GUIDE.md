# Developer Guide

[← back to project overview](../README.md) · [docs index](../README.md#documentation)

## Prerequisites

**Python 3.11+** (uses `datetime.UTC`). No `pip install`, no `requirements.txt`, no Node/npm. Optional: `git` + [`gh`](https://cli.github.com/) to mirror the hourly workflow's PR locally.

## Setup

```bash
git clone https://github.com/AhmedNassar7/tracker.git
cd tracker
python scripts/fetch.py              # writes data/jobs-global*.json, data/stats.json
python scripts/public_sources.py     # writes data/public-opportunities.json
python scripts/build_data_readme.py  # renders README.md and data/README.md
```

No install step — every fetcher uses only `urllib.request`.

On Windows, if test output shows `UnicodeEncodeError` on the ✅/❌ emoji, set UTF-8 first:

```powershell
$env:PYTHONIOENCODING = "utf-8"
```

```cmd
set PYTHONIOENCODING=utf-8
```

## Every available command

| Command | What it does |
|---|---|
| `python scripts/fetch.py` | Runs the curated layer: fetches 17 sources, filters against `config/companies_allowlist.yml`, dedupes, writes `data/jobs-global.json`, `data/jobs-global-archive.json`, `data/stats.json` |
| `python scripts/public_sources.py` | Runs the public/auto-discovery layer: seeds from `data/jobs-global.json`, polls Greenhouse/Lever/Workday/Ashby/SmartRecruiters/Devpost/Luma, writes `data/public-opportunities.json` |
| `python scripts/build_data_readme.py` | Renders `README.md` and `data/README.md` from the two JSON files above — the only way those two files should ever be updated |
| `python tests/test_fetch.py` | Runs all checks for `scripts/fetch.py` |
| `python tests/test_patterns.py` | Runs all checks for `scripts/patterns.py` (level/region/role classification + the B3/B4/B5 tech-tag / visa-degree-relocation / salary detectors) |
| `python tests/test_public_sources.py` | Runs all checks for `scripts/public_sources.py` |

No build step, no linter, no package manager. Always run in order (`fetch.py` → `public_sources.py` → `build_data_readme.py`) — each stage reads the previous stage's output.

## Naming conventions

- **Fetchers**: `fetch_<source_id>()`, one per source, returns a list of normalized row dicts.
- **`source` values**: match the fetcher id exactly (`"zapplyjobs_canada"`), or `"greenhouse:<token>"` / `"lever:<slug>"` / `"workday:<tenant>"` for the public layer.
- **Detection helpers**: `detect_<thing>(value)` — pure functions, string in, category out.
- **Logging**: each script defines its own `log_info`/`log_warn`/`log_error` (`fetch.py` adds `log_debug`) — not the `logging` module — so tests can monkeypatch them.
- **Config loaders**: `load_<config_name>()` — hand-parsed line-by-line YAML, no PyYAML.
- **Regex constants**: `SCREAMING_SNAKE_CASE` in `scripts/patterns.py`, prefixed `FETCH_*` / `PUBLIC_*` by layer.

## Add a new feature

### Add a new curated job-board source

1. Check whether the source has a JSON API before writing a scraper — several "just a GitHub README" sources actually have one (see `fetch_ambicuity_newgrad` in [scripts/fetch.py](../scripts/fetch.py) for the pattern: it hits `jobs.riteshrana.engineer/jobs.json` instead of parsing a README).
2. If it's a markdown table shaped like the existing community trackers (one company/title/location column, apply link and age findable but not fixed-position), reuse `_fetch_community_board()` + `parse_job_table()` from [scripts/community_board_parser.py](../scripts/community_board_parser.py) — just supply the column indices, like `fetch_hanzili_canada` does.
3. Otherwise write a dedicated `fetch_<source>()` function following the shape of `fetch_remotive`: fetch → parse → `normalize()` each row → `include_job()` filter → return list.
4. Add the new fetcher's name to the `SOURCE_FETCHER_NAMES` list in `scripts/fetch.py` — `main()` runs every name in that list concurrently (via `net.run_concurrently`) for both the strict pass and the relaxed retry, so one entry covers both.
5. Add a matching case to `tests/test_fetch.py` (see next section). No separate test-side registration needed — the "main calls all sources consistently" check reads `fetch.SOURCE_FETCHER_NAMES` directly, so it picks up the new fetcher automatically.
6. Update [SOURCES.md](../SOURCES.md) and the "How it works" section of [CONTRIBUTING.md](../CONTRIBUTING.md) — both are hand-maintained, not generated.

### Add a company to an existing platform

No code needed:

- **Curated allowlist**: add a line under the right category in [config/companies_allowlist.yml](../config/companies_allowlist.yml).
- **Ashby/SmartRecruiters**: add the board token under the right section in [config/extra_job_boards.yml](../config/extra_job_boards.yml) — verify the token first (`curl https://api.ashbyhq.com/posting-api/job-board/<token>` for Ashby; SmartRecruiters can't be verified via the API alone — see the warning comment at the top of that file).
- **Greenhouse/Lever/Workday**: nothing to do — these are auto-discovered the moment one of a company's postings shows up from any other source.

### Change how output is rendered

Edit `render_root_readme` / `render_data_readme` in [scripts/build_data_readme.py](../scripts/build_data_readme.py), then regenerate:

```bash
python scripts/build_data_readme.py
```

Never hand-edit `README.md` or `data/README.md` directly — the next hourly run overwrites them.

## How to add a test

Test files are plain scripts with a `main()` running `run(name, fn)` calls — not pytest.

1. Open the relevant file (`tests/test_fetch.py`, `tests/test_public_sources.py`).
2. Build a fake payload, patch the module's `fetch_url` (or `fetch_json`/`fetch_json_post`) to return it, call the function directly. Example (the `speedyapply` case):

```python
my_source_md = "\n".join([
    "| Company | Position | Location | Link |",
    "|---|---|---|---|",
    "| Google | Software Engineer Intern | Remote - USA | [Apply](https://example.com/x1) |",
])
with tempfile.TemporaryDirectory() as tmp:
    data_raw = Path(tmp)

    def fake_fetch(_url, dest, timeout=25):
        dest.write_text(my_source_md, encoding="utf-8")
        return True

    with patch.object(fetch, "DATA_RAW", data_raw), patch.object(fetch, "ALLOWLIST", ["google"]), patch.object(fetch, "fetch_url", side_effect=fake_fetch):
        rows = fetch.fetch_my_source()
run("my_source fetch", lambda: check(
    "my_source fetch",
    len(rows) == 1 and rows[0]["company"] == "Google" and rows[0]["url"] == "https://example.com/x1",
))
```

3. Run the file: `python tests/test_fetch.py`. To isolate one check, comment out the other `run(...)` calls.
4. New fetcher → add its name to `fetch.SOURCE_FETCHER_NAMES`; the "calls all sources consistently" check reads that list.

Full feature-to-test map: [TESTING.md](TESTING.md).

## Debug locally

- **One source looks wrong**: inspect its raw pull in `data/raw/` (e.g. `data/raw/remotive.json`) to tell a fetch failure from a parse failure.
- **Verbose logging**: flip `fetch.py`'s module-level `DEBUG = False` to `True` for per-row skip reasons.
- **A source returns nothing**: read its `[WARN]`/`[ERROR]` lines and the per-source summary (`SOURCE: N matched (skipped role:X level:Y region:Z company:W)`) — it names which filter ate the rows.
- **Output didn't change when expected**: `write_fetch_outputs` diffs by content signature and skips the write if nothing meaningful changed. Intentional.
- **Dead-link false positive**: `check_url_alive()` only trusts a `GET`-confirmed 404/410; 403/timeouts/DNS → "assume alive". See its docstring in `scripts/net.py`.
