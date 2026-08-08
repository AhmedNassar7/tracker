# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`tracker` is an automated pipeline that scrapes ~15 job boards and community GitHub trackers every hour, filters the results to a curated company allowlist, and publishes the combined list as plain Markdown/JSON — no database, no server, no paid APIs. It runs entirely on GitHub Actions and free-tier public APIs, using only the Python standard library (no `requirements.txt`, no dependencies to install).

`README.md` and `data/README.md` are **generated files** — never edit them directly. Both are rendered by `scripts/build_data_readme.py` and get overwritten on every hourly run. Edit the generator, then regenerate:

```bash
python scripts/build_data_readme.py
```

## Commands

There is no build step and no package manager — just run the scripts with the system Python (3.11+, stdlib only).

```bash
# Run the full pipeline locally, in order (each stage writes into data/)
python scripts/fetch.py              # curated sources -> data/jobs-global*.json
python scripts/public_sources.py     # public board sources -> data/public-opportunities.*
python scripts/build_data_readme.py  # renders README.md and data/README.md from the JSON above

# Run tests (plain scripts with an assert-based runner, not pytest — no test framework is installed)
python tests/test_net.py
python tests/test_fetch.py
python tests/test_public_sources.py

# On Windows, the emoji check marks in test output need UTF-8, or `print` raises UnicodeEncodeError:
set PYTHONIOENCODING=utf-8   # PowerShell: $env:PYTHONIOENCODING = "utf-8"
```

There's no way to run "a single test" — each test file is one `main()` that runs every check in sequence and exits nonzero on the first failed assertion. To isolate one check while debugging, temporarily comment out the other `run(...)` calls in the relevant `tests/test_*.py`.

CI (`.github/workflows/ci.yml`) runs all three test files on every push/PR. The hourly data-refresh workflow is `.github/workflows/hourly-global-roles.yml` — it runs the three pipeline commands above in order, commits whatever changed, and auto-merges via `peter-evans/create-pull-request`.

## Architecture

### Two independent collector layers, merged at render time

- **Curated layer** (`scripts/fetch.py`) — pulls Remotive, ArbeitNow, SimplifyJobs, speedyapply (SWE + AI), zapplyjobs, hanzili, and ambicuity. Every row is checked against `config/companies_allowlist.yml` (substring match, case-insensitive) — this is the strict, high-quality feed. Writes `data/jobs-global.json` / `data/jobs-global-archive.json` / `data/stats.json` via `scripts/fetch_outputs.py`.
- **Public layer** (`scripts/public_sources.py`) — widens coverage via Greenhouse, Lever, and Workday (all **auto-discovered**: the first time one of these company's postings shows up from any source, its board gets polled directly on the next run — no config needed), plus Ashby/SmartRecruiters for companies listed by hand in `config/extra_job_boards.yml`, plus Devpost hackathons (its own JSON API — the hackathons *page* is client-rendered and has no listings in the server HTML) and Luma events (filtered for tech/software relevance — Luma's discover page is a general community directory, not tech-specific). Writes `data/public-opportunities.json` via `scripts/public_outputs.py`.
- `scripts/build_data_readme.py` loads both JSON outputs, merges them, and renders both README files (the root one is a lean overview; `data/README.md` has the actual job tables). It's the single source of truth for all human-facing text in this repo — badges, counts, and table formatting all live in its `render_root_readme` / `render_data_readme` functions. Architecture/contributing prose lives in the hand-maintained `CONTRIBUTING.md`, not in the generator.

### Job-record shape

Both layers converge on the same normalized shape (documented as JSON Schema in `config/job-entry.schema.json`): `company`, `title`, `level` (`internship`/`new_grad`/`junior`/`entry_level`/`mid_level`), `country`, `location`, `remote_type`, `url`, `source`, `posted_at`, `age`. Classification regexes (level/region/role detection) live centrally in `scripts/patterns.py`, shared by both `fetch.py` and `public_sources.py`.

### Dead-link handling (`scripts/fetch_outputs.py`)

Before publishing, `fetch.py` passes `check_url_alive` into `write_fetch_outputs`. **A `HEAD` 404 is not trusted on its own** — some ATS pages (observed live on Pinterest's careers site) mishandle `HEAD` and 404 it even though the page is genuinely live on `GET`. Only a `GET`-confirmed 404/410 is treated as dead. Anything else (403 bot-blocking, timeouts, DNS errors) is treated as "can't tell, assume alive." Two things get archived into `jobs-global-archive.json` with a `closed_at` timestamp: postings that fail this check, and postings present last run but absent from this run's fresh fetch. If an archived posting reappears active later, its stale archive entry is dropped automatically.

These checks run concurrently (via `net.run_concurrently`, capped at 20 workers) instead of one job at a time — with ~600+ published jobs, checking them sequentially at up to 16s each (`HEAD` then `GET`, 8s timeout apiece) would make the hourly run scale linearly with the job count. `check_url_alive` itself never raises (it has a catch-all "assume alive" fallback), so a caught exception from it is treated as a bug in that contract, not routine — it still degrades to "assume alive" rather than aborting the whole output-write.

### Networking (`scripts/net.py`)

Shared by both collector layers:

- `fetch_with_retry(req, timeout)` performs `urlopen()` + `read()` as one retried unit (a connection can drop mid-download, so retrying only `urlopen()` and not the read isn't enough) and retries transient failures — connection-level errors and 429/5xx HTTP responses (honoring a clamped `Retry-After` on a 429, guarding against a negative/`NaN` header value reaching `time.sleep()`) — while re-raising conclusive HTTP errors (404, 403, ...) immediately.
- `run_concurrently(fn, arg_tuples)` fans a function out over a thread pool and gathers `(args, result, exception)` triples back in the *order arg_tuples was given*, not completion order, so callers stay deterministic and one failing call never loses the others' results.
- `run_and_collect(fn, arg_tuples, log_error, ...)` layers the aggregation policy both collector layers want on top of `run_concurrently`: concatenate each call's list result, and for a call that raised, log it (message + full traceback) and skip its contribution instead of losing every other call's results too. `fetch_outputs.py`'s dead-link check uses raw `run_concurrently` instead, since it needs to build a `{row_id: alive}` dict rather than concatenate a list.

Both `fetch.py` (17 independent source fetchers, capped at 6 concurrent — most share `raw.githubusercontent.com`, but it's a CDN serving static files rather than a single application server) and `public_sources.py` (auto-discovered Greenhouse/Lever/Workday boards, configured Ashby/SmartRecruiters boards) use `run_and_collect` to fan out their fetches; Greenhouse/Lever/Ashby/SmartRecruiters calls are deliberately capped at 5 concurrent workers (`SHARED_HOST_WORKERS`) since each of those platforms serves every company from one shared *application* API host — Workday doesn't need that cap since each company gets its own subdomain.

### Community-board table parsing

`scripts/simplify_jobs_parser.py` is specific to SimplifyJobs' own README format (pipe tables + HTML tables, `<details>`-wrapped multi-location cells). `scripts/community_board_parser.py` is a separate, generic parser for the *other* community trackers (speedyapply, zapplyjobs, hanzili) — each has a different column order and link markup (raw `href`, markdown-link-wrapped `<img>`, angle-bracket-wrapped URLs), and some silently drop an empty trailing cell rather than leaving it blank, which shifts column indices row-to-row. Because of that, `parse_job_table` only trusts *fixed* column positions for company/title/location (stable across all observed sources); the URL and age are found by scanning cells for their shape (a link; an `Nd`/`Nmo`/relative-date pattern) rather than a fixed index. If a new source is added and its rows are getting dropped, check for this variable-column-count issue first.

Workday tenant/site extraction (`extract_workday_site` in `public_sources.py`) has to skip an optional locale segment (`en-US`, `en-us`) that some tenants (Intel, Sony) put before the actual site name — treating the locale as the site 404s against the Workday CXS API.

Workday's job *listing* endpoint only ever returns a bare count like `"2 Locations"` for a multi-location posting — never the actual location names. `fetch_workday_jobs` detects that bare-count shape and makes one extra per-job detail call (`fetch_workday_job_locations`) only for postings that need it, to get the real names and render a proper `<details>` dropdown (matching how the curated layer already renders multi-location SimplifyJobs postings via `format_location_display`). Don't assume `locationsText` is ever a usable location list on its own.

### Config files are the extension point — most changes need no code

- `config/companies_allowlist.yml` — which companies are accepted (curated layer).
- `config/extra_job_boards.yml` — Ashby/SmartRecruiters companies to poll. **SmartRecruiters' API returns HTTP 200 with an empty result for *any* company slug, valid or not** — there's no way to verify a guessed token via the API alone, so don't add SmartRecruiters entries without an out-of-band way to confirm the slug is real. Ashby's API *does* 404 on an invalid token, so new Ashby boards can be verified directly: `curl https://api.ashbyhq.com/posting-api/job-board/<token>`.
- `config/job-entry.schema.json` — JSON Schema for the job record shape, for external consumers. Not read by the code; update it by hand if the record shape changes.
- `data/resources.md` and `CONTRIBUTING.md` — hand-curated, not regenerated by the pipeline. Keep the source list in `CONTRIBUTING.md`'s "How it works" section in sync by hand when adding/removing a fetcher.

### Everything is designed to run hourly without dependencies

No `requirements.txt` exists on purpose — every fetcher uses `urllib.request` from the standard library. If you're tempted to add `requests`, `beautifulsoup4`, or similar, that's a signal to reconsider the approach rather than add a dependency; check whether the target source has a JSON API before writing an HTML/regex scraper (e.g. `ambicuity/New-Grad-Jobs` looks like a GitHub README source but actually has a documented JSON feed at `jobs.riteshrana.engineer/jobs.json` — that's what's wired up, not README scraping).
