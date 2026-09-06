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
python tests/test_patterns.py
python tests/test_public_sources.py
python tests/test_schema_validation.py
python tests/test_site_index.py

# On Windows, the emoji check marks in test output need UTF-8, or `print` raises UnicodeEncodeError:
set PYTHONIOENCODING=utf-8   # PowerShell: $env:PYTHONIOENCODING = "utf-8"
```

There's no way to run "a single test" — each test file is one `main()` that runs every check in sequence and exits nonzero on the first failed assertion. To isolate one check while debugging, temporarily comment out the other `run(...)` calls in the relevant `tests/test_*.py`.

CI (`.github/workflows/ci.yml`) runs all eight test files on every push/PR. The hourly data-refresh workflow is `.github/workflows/hourly-global-roles.yml` — it runs the three pipeline commands above in order, commits whatever changed, and auto-merges via `peter-evans/create-pull-request`.

## Architecture

### Two independent collector layers, merged at render time

- **Curated layer** (`scripts/fetch.py`) — pulls Remotive, ArbeitNow, SimplifyJobs, speedyapply (SWE + AI), zapplyjobs, hanzili, and ambicuity. Every row is checked against `config/companies_allowlist.yml` (substring match, case-insensitive) — this is the strict, high-quality feed. Writes `data/jobs-global.json` / `data/jobs-global-archive.json` / `data/stats.json` via `scripts/fetch_outputs.py`.
- **Public layer** (`scripts/public_sources.py`) — widens coverage via Greenhouse, Lever, and Workday (normally **auto-discovered**: the first time one of these company's postings shows up from any source, its board gets polled directly on the next run — no config needed; all three also have a hand-seed section in `config/extra_job_boards.yml` for a company none of the curated sources ever link a board URL for), plus Ashby/SmartRecruiters for companies listed by hand there, plus Devpost/Unstop/Devfolio hackathons (their own JSON APIs — the hackathons *pages* are client-rendered), Luma events (filtered for tech/software relevance), and a hand-maintained list of tech/career conferences & summits in `config/events.yml` (past-dated rows auto-hidden). Writes `data/public-opportunities.json` via `scripts/public_outputs.py`.
- `scripts/build_data_readme.py` loads both JSON outputs, merges them, and renders both README files (the root one is a lean overview; `data/README.md` has the actual job tables). It's the single source of truth for all human-facing text in this repo — badges, counts, and table formatting all live in its `render_root_readme` / `render_data_readme` functions. Architecture/contributing prose lives in the hand-maintained `CONTRIBUTING.md`, not in the generator. The same run also writes `data/site-index.json` (via `build_site_index()`), a flattened `{generated_at, count, checksum, items}` projection of both feeds meant for a future frontend to fetch as one file — each item is copied straight from its source `JobEntry`/`PublicEntry` record, never fabricated, so fields only one layer detects (e.g. `category`, `remote_type`, `country` are curated-only) are simply absent on the other layer's items rather than guessed.

### Job-record shape

Both layers converge on the same normalized shape (documented as JSON Schema in `config/job-entry.schema.json`): `company`, `title`, `level` (`internship`/`new_grad`/`junior`/`entry_level`/`mid_level`), `country`, `location`, `remote_type`, `url`, `source`, `posted_at`, `age`. Classification regexes (level/region/role detection) live centrally in `scripts/patterns.py`, shared by both `fetch.py` and `public_sources.py`.

`scripts/patterns.py` also holds the **job-facet detectors** (`extract_job_facets` → `detect_tech_tags` / `detect_requirements` / `parse_salary`), which add optional `tech_tags`, `visa_sponsorship`, `degree_required`, `relocation`, and `salary` keys **only when the posting's own description text says so** — the strict no-fabrication rule, so a silent posting simply has no key rather than a `False`/guessed default. They run only for the sources that actually carry a description: `fetch.py` threads it in for Remotive and ArbeitNow (via `normalize(..., description=...)`); `public_sources.py` does it for Greenhouse (`?content=true` HTML), Lever (`descriptionPlain` + `lists`), and Ashby (`descriptionPlain`). Community-tracker README rows have no description and get no facet keys. `tests/test_patterns.py` covers the detectors directly; the false-positive guards there (bare "go"/"spark"/"spring" in prose must **not** tag a language) are load-bearing — loosen a regex and re-run it.

### Dead-link handling (`scripts/net.py`, consumed by `fetch_outputs.py` and `public_outputs.py`)

`check_url_alive` and `find_dead_links` live in `scripts/net.py` (moved there from `fetch.py`) since **both** collector layers use them: `fetch.py` passes `check_url_alive` into `write_fetch_outputs`, and `public_sources.py` passes the same function into `write_public_outputs` — the public layer is where most published listings actually come from (Greenhouse/Lever/Workday/Ashby/SmartRecruiters/Devpost/Unstop/Devfolio/Luma combined), and until this was fixed it never verified a single link before publishing. **A `HEAD` 404 is not trusted on its own** — some ATS pages (observed live on Pinterest's careers site) mishandle `HEAD` and 404 it even though the page is genuinely live on `GET`. Only a `GET`-confirmed 404/410 is treated as dead. Anything else (403 bot-blocking, timeouts, DNS errors) is treated as "can't tell, assume alive."

The two layers act on a dead link differently, matching how each already handles data lifecycle: `fetch_outputs.py` **archives** it into `jobs-global-archive.json` with a `closed_at` timestamp (along with postings present last run but absent from this run's fresh fetch — an archived posting that reappears active later has its stale archive entry dropped automatically), while `public_outputs.py` **drops** it before writing `public-opportunities.json` — that layer has no archive file or `closed_at` field in its schema, so "don't publish a link known to be broken" is the correct scope for now rather than introducing parallel archive infrastructure it doesn't otherwise have.

**Staleness caps at render time** (`build_data_readme.py`, `max_age_days_for_source`): a job is dropped from both README tables and `site-index.json` past a per-source age limit — **30 days for a hand-maintained community tracker** (`COMMUNITY_TRACKER_SOURCES` — Simplify, vanshb03, speedyapply, zapplyjobs, hanzili, lorenzolacorte, ambicuity), **180 days for a live API** (Greenhouse/Amazon/Workday/Ashby/Lever/…). Rationale: a live-API source is self-cleaning (a closed job just isn't in the next fetch), but a community-tracker row only leaves when a volunteer edits the file, and `check_url_alive` can't catch every ATS soft-404 — so those age out fast, matching the "if not sure, drop it" preference. An unparseable age is kept.

Google Careers result pages are a separate case, handled specially in `check_url_alive`: they're a client-rendered SPA that returns HTTP 200 for both live and expired job ids, so no status code ever flags them dead. The one server-rendered tell is the `og:title` meta tag — the real job title when live, empty when expired — so for `google.com/about/careers/applications/jobs/results/*` URLs the check skips the `HEAD` short-circuit, does a `GET`, and reads the body (capped at 1.2MB; the tag is observed ~980KB in) for that marker. Only add another source-specific body check like this once its soft-404 shape has been confirmed by hand the same way — never on suspicion, since a wrong guess here means silently archiving live postings.

These checks run concurrently (via `net.run_concurrently`, capped at 20 workers) instead of one job at a time — with ~600+ published jobs, checking them sequentially at up to 16s each (`HEAD` then `GET`, 8s timeout apiece) would make the hourly run scale linearly with the job count. `check_url_alive` itself never raises (it has a catch-all "assume alive" fallback), so a caught exception from it is treated as a bug in that contract, not routine — it still degrades to "assume alive" rather than aborting the whole output-write. Both write functions accept `check_url_alive` as an optional keyword (`None` skips the check entirely) specifically so tests can call them without triggering real network calls — only each layer's own `main()` passes the real function.

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
- `config/extra_job_boards.yml` — Ashby/SmartRecruiters companies to poll, plus `greenhouse:`/`lever:`/`workday:` sections for hand-seeding a company whose board would otherwise never get auto-discovered (auto-discovery only ever triggers once one of a company's postings organically surfaces through an *existing* curated fetcher — a company none of those ~17, mostly US/EU-focused, sources ever mention stays invisible indefinitely even with a real, live, publicly pollable board; this is exactly the gap that left MENA-region companies like Careem — 231 real Dubai/UAE postings on Greenhouse — and Thndr — Cairo, Egypt, on Ashby — undiscovered until verified and added by hand). The `greenhouse:`/`lever:`/`ashby:`/`smartrecruiters:` entries are a bare board token per line; **`workday:` entries are `Company Name | host | site`** (three fields — Workday has no single token, each tenant is its own subdomain plus a site path), verified with `curl -XPOST -d '{"limit":5,"offset":0,"searchText":"software engineer"}' https://<host>/wday/cxs/<tenant>/<site>/jobs`. **SmartRecruiters' API returns HTTP 200 with an empty result for *any* company slug, valid or not** — there's no way to verify a guessed token via the API alone, so don't add SmartRecruiters entries without an out-of-band way to confirm the slug is real. Ashby's API *does* 404 on an invalid token, so new Ashby boards can be verified directly: `curl https://api.ashbyhq.com/posting-api/job-board/<token>`. Same discipline applies to hand-seeded Greenhouse (`curl https://boards-api.greenhouse.io/v1/boards/<token>/jobs`) and Lever (`curl https://api.lever.co/v0/postings/<token>?mode=json`) tokens — confirm real postings exist, not just a non-404 response, before adding one.
- `config/job-entry.schema.json` — JSON Schema for the job record shape, for external consumers. Not read by the code; update it by hand if the record shape changes.
- `data/resources.md` and `CONTRIBUTING.md` — hand-curated, not regenerated by the pipeline. Keep the source list in `CONTRIBUTING.md`'s "How it works" section in sync by hand when adding/removing a fetcher.

### Everything is designed to run hourly without dependencies

No `requirements.txt` exists on purpose — every fetcher uses `urllib.request` from the standard library. If you're tempted to add `requests`, `beautifulsoup4`, or similar, that's a signal to reconsider the approach rather than add a dependency; check whether the target source has a JSON API before writing an HTML/regex scraper (e.g. `ambicuity/New-Grad-Jobs` looks like a GitHub README source but actually has a documented JSON feed at `jobs.riteshrana.engineer/jobs.json` — that's what's wired up, not README scraping).
