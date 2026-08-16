# Data

[← back to project overview](../README.md) · [docs index](../README.md#documentation)

There is no database. All state is JSON files committed to the repo under [data/](../data/), regenerated hourly. This page documents every external data source and every file/field shape involved.

## External data sources

### Curated layer (`scripts/fetch.py`) — gated by `config/companies_allowlist.yml`

| Source | Endpoint | Shape |
|---|---|---|
| Remotive | `https://remotive.com/api/remote-jobs?category=software-dev` | JSON API |
| ArbeitNow | `https://arbeitnow.com/api/job-board-api` | JSON API |
| SimplifyJobs Internships | `raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/README.md` | Markdown (pipe table + HTML table) |
| SimplifyJobs New Grad | `raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/README.md` | Markdown (pipe table + HTML table) |
| speedyapply SWE / AI | `raw.githubusercontent.com/speedyapply/2027-{SWE,AI}-College-Jobs/main/README.md` | Markdown pipe table |
| zapplyjobs (6 boards: New Grad SWE, New Grad all-disciplines, Internships, Data Science, Canada Jobs, Canada Internships) | `raw.githubusercontent.com/zapplyjobs/<repo>/main/README.md` | Markdown pipe table |
| vanshb03 Summer Internships / New Grad | `raw.githubusercontent.com/vanshb03/<repo>/main/README.md` | Markdown pipe table (uses "↳" ditto rows) |
| LorenzoLaCorte European Tech | `raw.githubusercontent.com/LorenzoLaCorte/european-tech-internships-2026/main/README.md` | Markdown pipe table (all-lowercase company names, title-cased on ingest) |
| hanzili Canada | `raw.githubusercontent.com/hanzili/canada_sde_junior_new_grad_position/main/README.md` | Markdown pipe table (reversed title/company column order) |
| ambicuity New-Grad-Jobs | `https://jobs.riteshrana.engineer/jobs.json` | JSON API (live feed, refreshed every 5 min upstream — not a README scrape) |
| Amazon (direct) | `https://www.amazon.jobs/en/search.json?base_query=software+development+engineer` | JSON API — Amazon's own careers search, hit directly instead of only through third-party trackers |

### Public / auto-discovery layer (`scripts/public_sources.py`)

| Source | Endpoint | Discovery |
|---|---|---|
| Greenhouse | `boards-api.greenhouse.io/v1/boards/<token>/jobs?content=true` | Auto — board token extracted from any curated-layer job URL matching `greenhouse.io` |
| Lever | `api.lever.co/v0/postings/<slug>?mode=json` | Auto — slug extracted from any curated-layer job URL matching `lever.co` |
| Workday | `https://<host>/wday/cxs/<tenant>/<site>/jobs` (POST, paginated, 20/page) | Auto — `(host, site)` extracted from any curated-layer job URL matching `workdayjobs.com`, skipping an optional locale segment (`en-US`) |
| Ashby | `api.ashbyhq.com/posting-api/job-board/<token>` | Manual — `config/extra_job_boards.yml` |
| SmartRecruiters | `api.smartrecruiters.com/v1/companies/<slug>/postings?limit=100` | Manual — `config/extra_job_boards.yml` |
| Devpost | `devpost.com/api/hackathons?status[]=open&order_by=recently-added&page=N` | Standalone (not company-driven) |
| Unstop | `unstop.com/api/public/opportunity/search-result?opportunity=hackathons&oppstatus=recruiting&page=N` | Standalone; paginated, filtered to still-recruiting hackathons |
| Devfolio | `api.devfolio.co/api/hackathons?page=N` | Standalone; filtered client-side to events whose `ends_at` hasn't passed |
| Luma | `luma.com/discover` (HTML, regex-parsed) | Standalone; filtered by `LUMA_RELEVANT_RE` for tech relevance |

All 18 are free-tier, keyless, public endpoints. Full descriptions with rationale live in [SOURCES.md](../SOURCES.md).

## Data shapes and schemas

Three JSON Schemas document the three output record shapes, and all three are actually enforced: `scripts/schema_validator.py` is a small, dependency-free validator (no `jsonschema` package — matches the repo's stdlib-only rule) that `fetch_outputs.py`, `public_outputs.py`, and `build_data_readme.py` (for `site-index.json`) each run against every row right before writing. A shape drift raises `ValueError` and aborts the run under `set -euo pipefail`, rather than silently publishing bad data — see `tests/test_schema_validation.py` (the two publish-layer schemas) and `tests/test_site_index.py` (the flattened index) for the validator's unit tests plus integration tests proving each write path actually refuses invalid rows.

### `JobEntry` — [config/job-entry.schema.json](../config/job-entry.schema.json)

Used by `data/jobs-global.json` and `data/jobs-global-archive.json` (archive entries add one extra field, `closed_at`).

| Field | Type | Notes |
|---|---|---|
| `id` | string | 16-char hex, `sha256(company+title+url)[:16]` |
| `company` | string | |
| `title` | string | |
| `level` | enum | `internship` \| `new_grad` \| `junior` \| `entry_level` \| `mid_level` \| `unknown` |
| `category` | string | Allowlist category the company matched (`faang`, `big_tech`, `cloud_infra`, ...), or `""` if only included via relaxed-mode fallback |
| `region` | enum | `us` \| `canada` \| `emea` \| `remote` \| `unknown` — same taxonomy as `PublicEntry.region` |
| `role_type` | enum | Same 10-value taxonomy as `PublicEntry.role_type` below |
| `country` | string | Detected country name, or `Remote`/`Unknown` |
| `location` | string | Raw location string from the source |
| `remote_type` | enum | `remote` \| `hybrid` \| `onsite` \| `unknown` |
| `url` | string (uri) | Direct apply link |
| `source` | string | Source id, e.g. `remotive`, `zapplyjobs_canada` |
| `source_url` | string (uri) | Attribution link to the source site/repo |
| `posted_at` | string | `YYYY-MM-DD` |
| `age` | string | Human-readable, e.g. `"0d"`, `"5d"`, `"Recently"` — sourced verbatim when the origin provides it, else computed from `posted_at` |
| `collected_at` | string | ISO 8601 UTC timestamp |
| `tags` | string[] | Always `["software", "programming", "global-tech-roles"]` currently |
| `closed_at` | string | ISO 8601 UTC timestamp. Only present in `jobs-global-archive.json`, never in `jobs-global.json` |

`additionalProperties: false` — the schema is exhaustive; nothing else is ever written to this shape.

### `PublicEntry` — [config/public-entry.schema.json](../config/public-entry.schema.json)

Used by all three arrays (`jobs`, `hackathons`, `events`) in `data/public-opportunities.json`, disambiguated by `kind`.

| Field | Type | Notes |
|---|---|---|
| `id` | string | 16-char hex |
| `kind` | enum | `job` \| `hackathon` \| `event` |
| `company` | string | Company or organizer name |
| `title` | string | |
| `location` | string | `Various`/`Global` when not a single place |
| `level` | enum | Job-only: same 5 curated levels + `other` |
| `role_type` | enum | Job-only: `full_stack` \| `backend` \| `frontend` \| `mobile` \| `platform` \| `infrastructure` \| `security` \| `machine_learning` \| `software_engineer` \| `other_swe` |
| `region` | enum | Job-only: `us` \| `canada` \| `emea` \| `remote` \| `unknown` |
| `date` | string | Free-form: age for jobs, submission deadline for hackathons, `""` for events |
| `posted_at` | string | `YYYY-MM-DD`, or `""` when a source only exposes a fuzzy relative date instead of a real timestamp (Workday — the fuzzy value lives in `date` instead) |
| `url` | string | Absolute URL, except Luma events which use a site-relative path |
| `source` | string | e.g. `greenhouse:stripe`, `lever:acme`, `devpost`, `luma` |
| `source_url` | string (uri) | |

### `SiteIndexEntry` — [config/site-index.schema.json](../config/site-index.schema.json)

Used by the `items` array in `data/site-index.json`, written by `build_site_index()` in `scripts/build_data_readme.py`. This isn't a third source of truth — every item is copied straight from a `JobEntry` or `PublicEntry` record already validated against the two schemas above; the point of this file is giving a client (a future site, a script) one small flattened file instead of having to fetch and merge `jobs-global.json` and `public-opportunities.json` itself.

| Field | Type | Notes |
|---|---|---|
| `id` | string | 16-char hex, carried over unchanged |
| `kind` | enum | `job` \| `hackathon` \| `event` |
| `origin` | enum | `curated` (from `jobs-global.json`) \| `public` (from `public-opportunities.json`) |
| `company`, `title`, `location`, `url`, `source`, `source_url` | string | Copied straight through |
| `age` | string | Unified from `JobEntry.age` / `PublicEntry.date` |
| `posted_at` | string | `YYYY-MM-DD` or `""` |
| `level`, `region`, `role_type` | enum | Job-only |
| `category`, `remote_type`, `country` | string / enum | Job-only, **curated-origin only** — omitted entirely (not `""` or guessed) on public-origin job items, since the public layer never detects them |

Top-level shape: `{generated_at, count, checksum, items}`. `checksum` is `"sha256:" + sha256(sorted item ids joined by "\n")` — cheap to compute and enough to answer "did the item set change since last visit," not a full-content hash. Not itself schema-validated (only `items[]` entries are); it's a plain wrapper this pipeline's own code constructs.

## Config files and what each field does

### `config/companies_allowlist.yml`

Plain YAML, hand-parsed (no PyYAML). Top-level keys are category labels (`faang`, `cloud_infra`, `ai_research`, `apac_tech`, etc.). `ALLOWLIST` itself stays a flat lowercase list of company names, but the loader also tracks each name's category in a parallel `ALLOWLIST_CATEGORY_BY_NAME` dict, so `is_allowed_company()` returns the matched category (e.g. `"faang"`) instead of a plain bool — every job row that passes the curated-layer filter via case-insensitive substring match carries that category through to `data/jobs-global.json` as its `category` field.

### `config/extra_job_boards.yml`

Two sections, `ashby:` and `smartrecruiters:`, each a flat list of board tokens/company slugs. Loaded by `load_extra_job_boards()` in `scripts/public_sources.py`. **Caveat documented in the file itself:** SmartRecruiters' API returns HTTP 200 with an empty result for *any* slug, valid or not — there is no way to verify a guessed token through the API, so entries must be confirmed out-of-band before adding. Ashby's API does 404 on an invalid token and can be verified directly: `curl https://api.ashbyhq.com/posting-api/job-board/<token>`.

### `config/job-entry.schema.json` / `config/public-entry.schema.json`

JSON Schema (draft-07), for external consumers of the data files — not read by the pipeline code itself. Update these by hand whenever a record's field shape changes in `scripts/fetch.py` / `scripts/public_sources.py`.

## Storage — what is saved, where, in what format

Everything is a flat JSON or Markdown file inside [data/](../data/), committed directly to the git repo — there is no external storage, cache, or database.

| File | Format | Written by | Purpose |
|---|---|---|---|
| `data/jobs-global.json` | JSON (`JobEntry[]`) | `scripts/fetch.py` via `fetch_outputs.py` | Live curated jobs |
| `data/jobs-global-archive.json` | JSON (`JobEntry[]` + `closed_at`) | same | Closed/dead-linked/vanished curated jobs |
| `data/public-opportunities.json` | JSON (`{jobs, hackathons, events}`) | `scripts/public_sources.py` via `public_outputs.py` | Public-board jobs + hackathons + events |
| `data/stats.json` | JSON | `scripts/fetch.py` via `fetch_outputs.py` | Curated-feed counts by level/country/source |
| `data/site-index.json` | JSON (`SiteIndexEntry[]` + wrapper) | `scripts/build_data_readme.py` | Both feeds flattened into one checksummed list |
| `data/README.md` | Markdown | `scripts/build_data_readme.py` | The full human-readable job/hackathon/event tables |
| `README.md` (root) | Markdown | `scripts/build_data_readme.py` | Lean overview + badges + snapshot counts |
| `data/raw/*.json` / `*.md` | Raw source payloads | each fetcher's `fetch_url()` call | Debugging aid — inspect a source's untouched pull before its parser runs |

`data/raw/` is overwritten on every run and is not meant to be diffed for history — only `jobs-global.json`, `jobs-global-archive.json`, and `public-opportunities.json` carry forward state between runs (via `id`-keyed diffing in `write_fetch_outputs`).
