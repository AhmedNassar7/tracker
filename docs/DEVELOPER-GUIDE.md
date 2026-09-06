# Developer Guide

[← back to project overview](../README.md) · [docs index](../README.md#documentation)

## Prerequisites

- **Python 3.11+** (the codebase uses `datetime.UTC`, which requires 3.11) — that's it. No `pip install`, no `requirements.txt`, no Node/npm.
- Optional: `git` and the [GitHub CLI](https://cli.github.com/) (`gh`) if you want to mirror what the hourly workflow does (open/merge a PR) locally — not required for day-to-day script work.

Check your Python version:

```bash
python --version   # must be 3.11 or newer
```

## Setup from scratch

```bash
git clone https://github.com/AhmedNassar7/tracker.git
cd tracker
python scripts/fetch.py              # writes data/jobs-global*.json, data/stats.json
python scripts/public_sources.py     # writes data/public-opportunities.json
python scripts/build_data_readme.py  # renders README.md and data/README.md
```

There is no install step between `git clone` and running the scripts — every fetcher uses only `urllib.request` from the standard library.

On Windows, if test output shows `UnicodeEncodeError` on the ✅/❌ emoji, set UTF-8 output first:

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

There's no build step, no linter configured, and no package manager — these five commands are the entire toolchain. Always run them in this order (`fetch.py` → `public_sources.py` → `build_data_readme.py`) since each stage reads the previous stage's output.

## Naming conventions (from actual code)

- **Fetcher functions**: `fetch_<source_id>()`, e.g. `fetch_remotive`, `fetch_zapplyjobs_canada`, `fetch_ambicuity_newgrad` — one function per source, always returning a list of normalized row dicts.
- **`source` field values**: match the fetcher's source id exactly, e.g. `"zapplyjobs_canada"`, `"speedyapply_swe"`, or `"greenhouse:<board_token>"` / `"lever:<slug>"` / `"workday:<tenant>"` for the public layer (colon-separated, board-specific suffix).
- **Detection helpers**: `detect_<thing>(value)`, e.g. `detect_level`, `detect_region`, `detect_remote_type`, `detect_country`, `detect_role_type` — pure functions, title/location string in, category string out.
- **Logging**: every script defines its own `log_info` / `log_warn` / `log_error` (and `fetch.py` adds `log_debug`) module-level functions rather than using the `logging` module — kept consistent so tests can monkeypatch them to silence output.
- **Config loaders**: `load_<config_name>()`, e.g. `load_extra_job_boards()` — hand-parsed line-by-line YAML (no PyYAML dependency), mirroring the allowlist-loading pattern already in `fetch.py`.
- **Regex constants**: `SCREAMING_SNAKE_CASE`, centralized in `scripts/patterns.py`, prefixed by which layer uses them (`FETCH_*` for `fetch.py`, `PUBLIC_*` for `public_sources.py`).

## How to add a new feature for this codebase

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

Both test files are plain scripts with a `main()` that runs a sequence of `run(name, fn)` calls, not pytest — there's no fixture/collection magic. To add a check:

1. Open the relevant test file (`tests/test_fetch.py` for `scripts/fetch.py`, `tests/test_public_sources.py` for `scripts/public_sources.py`).
2. Build a fake payload for the shape you're testing, patch the module's `fetch_url` (or `fetch_json`/`fetch_json_post` in the public-sources test) to return it, and call the function directly. Example, following the existing `speedyapply` case in `tests/test_fetch.py`:

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

3. Run just that file to confirm: `python tests/test_fetch.py`. There's no way to run a single check in isolation short of temporarily commenting out the other `run(...)` calls — the whole file is one sequential `main()`.
4. If you added a new fetcher, add its name to `fetch.SOURCE_FETCHER_NAMES` in `scripts/fetch.py` — `main()`'s "calls all sources consistently" check reads that same list, so there's no separate test-side list to update.

See [TESTING.md](TESTING.md) for the full feature-to-test map.

## How to debug locally

- **A single source looks wrong**: fetchers write their raw pull into `data/raw/` before parsing (e.g. `data/raw/zapplyjobs_canada.md`, `data/raw/remotive.json`) — inspect that file directly to tell a fetch failure from a parse failure.
- **Turn on verbose logging**: `fetch.py` has a module-level `DEBUG = False` flag gating `log_debug()` calls (per-row skip reasons, entry counts). Flip it to `True` at the top of the file for a local run to see why rows are being dropped.
- **A whole source returns nothing**: check the `[WARN]`/`[ERROR]` lines each fetcher prints — every fetcher logs a per-source summary line like `SOURCE: N matched (skipped role:X level:Y region:Z company:W)`, which tells you which filter is eating the rows.
- **Output didn't change even though you expected it to**: `write_fetch_outputs` in `scripts/fetch_outputs.py` diffs the new rows against the previous `jobs-global.json` by content signature and skips the file write entirely if nothing changed (see the "write outputs skips age-only changes" test) — this is intentional, not a bug.
- **A dead-link false positive**: `check_url_alive()` only trusts a `GET`-confirmed 404/410; everything else (403, timeouts, DNS errors) is treated as "assume alive." If a posting you know is dead isn't getting archived (curated layer) or dropped (public layer), that's why — see the docstring on `check_url_alive` in `scripts/net.py`.
