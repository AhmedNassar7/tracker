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
| PinpointHQ | `https://<host>/postings.json` — `<host>` is `<token>.pinpointhq.com` for a bare token, or a full custom careers host if the token contains a dot | Manual — `config/extra_job_boards.yml` `pinpoint:` section |
| Devpost | `devpost.com/api/hackathons?status[]=open&order_by=recently-added&page=N` | Standalone (not company-driven) |
| Unstop | `unstop.com/api/public/opportunity/search-result?opportunity=hackathons&oppstatus=recruiting&page=N` | Standalone; paginated, filtered to still-recruiting hackathons |
| Devfolio | `api.devfolio.co/api/hackathons?page=N` | Standalone; filtered client-side to events whose `ends_at` hasn't passed |
| Luma | `luma.com/discover` (HTML, regex-parsed) | Standalone; filtered by `LUMA_RELEVANT_RE` for tech relevance |
| Curated events | `config/events.yml` (hand-maintained) | Standalone; `Name \| Organizer \| City, Country \| YYYY-MM-DD \| URL` per line — conferences/summits/career fairs with no pollable API. Past-dated rows are auto-hidden |

All are free-tier, keyless, public endpoints. Full descriptions with rationale live in [SOURCES.md](../SOURCES.md).

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
| `region` | enum | `north_america` \| `latam` \| `europe` \| `mena` \| `apac` \| `remote` \| `unknown` — macro-region tier, same taxonomy as `PublicEntry.region`; `mena` (Middle East & Africa) is matched before `europe`. Countries (incl. US/Canada) are the separate `country` field, not region buckets. Data written before 2026-09-06 may still carry `us`/`canada`/`emea` |
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
| `tech_tags`, `visa_sponsorship`, `degree_required`, `relocation`, `salary` | array / boolean / object | Optional B3/B4/B5 facets — same meaning and strict-positive rules as in `SiteIndexEntry` below. Curated layer populates them for Remotive and ArbeitNow (the two sources that carry a job description); the community-tracker README rows have none |
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
| `region` | enum | Job-only: `north_america` \| `latam` \| `europe` \| `mena` \| `apac` \| `remote` \| `unknown` |
| `date` | string | Free-form: age for jobs, submission deadline for hackathons, `""` for events |
| `posted_at` | string | `YYYY-MM-DD`, or `""` when a source only exposes a fuzzy relative date instead of a real timestamp (Workday — the fuzzy value lives in `date` instead) |
| `url` | string | Absolute URL, except Luma events which use a site-relative path |
| `source` | string | e.g. `greenhouse:stripe`, `lever:acme`, `pinpoint:tabby.pinpointhq.com`, `pinpoint:careers.moneyfellows.com`, `devpost`, `luma` |
| `source_url` | string (uri) | |
| `tech_tags`, `visa_sponsorship`, `degree_required`, `relocation`, `salary` | array / boolean / object | Job-only, optional B3/B4/B5 facets — same strict-positive rules as `SiteIndexEntry` below. Populated for Greenhouse (`?content=true`), Lever (`descriptionPlain` + `lists`), Ashby (`descriptionPlain`), and PinpointHQ (`description` + `key_responsibilities` + `skills_knowledge_expertise`); other public sources omit them |

### `SiteIndexEntry` — [config/site-index.schema.json](../config/site-index.schema.json)

Used by the `items` array in `data/site-index.json`, written by `build_site_index()` in `scripts/build_data_readme.py`. This isn't a third source of truth — every item is copied straight from a `JobEntry` or `PublicEntry` record already validated against the two schemas above; the point of this file is giving a client (a future site, a script) one small flattened file instead of having to fetch and merge `jobs-global.json` and `public-opportunities.json` itself.

| Field | Type | Notes |
|---|---|---|
| `id` | string | 16-char hex, carried over unchanged |
| `kind` | enum | `job` \| `hackathon` \| `event` \| `board` — `board` is a hand-curated "browse every role at X" link from `config/aggregate_links.yml`, a pre-filtered careers-search URL (never a single posting). The site renders these in a separate "Browse every role" section and excludes them from every count / facet |
| `origin` | enum | `curated` (from `jobs-global.json`) \| `public` (from `public-opportunities.json`) \| `config` (from `config/aggregate_links.yml`, always `kind:"board"`) |
| `company`, `title`, `url`, `source`, `source_url` | string | Copied straight through (`company` also brand-normalized — `Amazon.com Services LLC` → `Amazon`) |
| `location` | string | Single-line display string, **never HTML**. A multi-location posting's curated `<details>` dropdown is unpacked into a `"First, Place +N more"` summary here |
| `locations` | string[] | Present only for a multi-location posting (≥2 entries) — the individual locations, for a client to render its own control |
| `age` | string | Unified from `JobEntry.age` / `PublicEntry.date`, then (jobs only) `reconcile_age`'d against `posted_at` so a frozen/placeholder `"0d"` can't show a weeks-old listing as new |
| `posted_at` | string | `YYYY-MM-DD` or `""` |
| `liveness` | enum | `verified` (this item's apply URL is in `data/link-cache.json` as alive — see `last_checked`) or `unverified` (not in the cache: never checked, checked inconclusively, or aged out). **Not** a "dead" flag — a confirmed-dead link is archived/dropped before this file is written. Absent entirely on `kind:"board"` rows (a careers-search page, never liveness-checked) |
| `last_checked` | string | ISO-8601 UTC of the last successful liveness confirmation. Present only when `liveness` is `verified` |
| `level`, `region`, `role_type` | enum | Job-only. `region` is the macro-region tier (`north_america` / `latam` / `europe` / `mena` / `apac` / `remote` / `unknown`) — US/Canada are `north_america`, not their own buckets; `mena` is tested before `europe`. The site derives it client-side via `geo.ts` `regionForItem()` (own value → remote → from country → from location text) so `apac`/`latam` appear in the filter without a pipeline re-run, and the Region filter only lists buckets the data actually contains |
| `category`, `remote_type` | string / enum | Job-only, **curated-origin only** — omitted entirely (not `""` or guessed) on public-origin job items, since the public layer never detects them |
| `country` | string | Job-only, **both origins** (G2). Curated detects it at fetch time; for a public row `build_site_index` runs the same `detect_country()` over `location`. `"Unknown"` / `"Remote"` are kept (not omitted) so country counts stay honest |
| `country_flag` | string | Job-only. Flag emoji for `country` (Unicode regional-indicator symbols, `scripts/patterns.py` `country_flag()`). Absent for `Unknown` / `Remote` / a country not in the ISO-2 table |
| `tech_tags` | string[] | Job-only. Canonical skill/tech tags (`React`, `Go`, `Kubernetes`, …) detected from the posting's description text by `scripts/patterns.py` `detect_tech_tags`. Present only for sources that expose a full description (Greenhouse/Lever/Ashby/PinpointHQ, plus curated Remotive/ArbeitNow); omitted — never `[]` — otherwise |
| `visa_sponsorship`, `degree_required`, `relocation` | boolean | Job-only, **explicit-only**. `true`/`false` only when the description says so in as many words (a negative statement wins over a positive one); a silent posting has no key at all, never a default `false`. From `detect_requirements` |
| `salary` | object | Job-only. `{min, max, currency (3-letter), period: hour\|month\|year}` — a literal range lifted from the posting by `parse_salary` and sanity-checked; **never estimated**. Absent unless the posting itself discloses a currency-marked range |

Top-level shape: `{generated_at, count, checksum, items}`. `checksum` is `"sha256:" + sha256(sorted item ids joined by "\n")` — cheap to compute and enough to answer "did the item set change since last visit," not a full-content hash. Not itself schema-validated (only `items[]` entries are); it's a plain wrapper this pipeline's own code constructs.

## Config files and what each field does

### `config/companies_allowlist.yml`

Plain YAML, hand-parsed (no PyYAML). Top-level keys are category labels (`faang`, `cloud_infra`, `ai_research`, `apac_tech`, etc.). `ALLOWLIST` itself stays a flat lowercase list of company names, but the loader also tracks each name's category in a parallel `ALLOWLIST_CATEGORY_BY_NAME` dict, so `is_allowed_company()` returns the matched category (e.g. `"faang"`) instead of a plain bool — every job row that passes the curated-layer filter via case-insensitive substring match carries that category through to `data/jobs-global.json` as its `category` field.

### `config/extra_job_boards.yml`

Two sections, `ashby:` and `smartrecruiters:`, each a flat list of board tokens/company slugs. Loaded by `load_extra_job_boards()` in `scripts/public_sources.py`. **Caveat documented in the file itself:** SmartRecruiters' API returns HTTP 200 with an empty result for *any* slug, valid or not — there is no way to verify a guessed token through the API, so entries must be confirmed out-of-band before adding. Ashby's API does 404 on an invalid token and can be verified directly: `curl https://api.ashbyhq.com/posting-api/job-board/<token>`.

### `config/events.yml`

Hand-maintained list of tech / career events (conferences, summits, career fairs) that no pollable API covers. One per line: `Name | Organizer | City, Country | START_DATE | URL`, `START_DATE` in ISO `YYYY-MM-DD`. Loaded by `parse_curated_events()` / `fetch_curated_events()` in `scripts/public_sources.py`, which renders each as a `kind:"event"` row with a live countdown ("in 12 days") and **drops any row whose date is already past** — so for an annual event you just bump the date to next year's edition when it's announced. Verify the date and URL against the organizer's own site before editing (same discipline as `aggregate_links.yml`).

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
| `data/stats-history.json` | JSON (`{updated_at, retention_days, snapshots[]}`) | `scripts/build_data_readme.py` | One `StatsHistorySnapshot` appended per hourly run, capped to 90 days — a free trend series (see [config/stats-history.schema.json](../config/stats-history.schema.json)). Snapshots from 2026-09-06 on also carry a `dimensions` object: `by_level` / `by_region` / `by_remote_type` / `by_role_type` / `by_category` (exhaustive — a blank field → `unknown`, so they sum to `jobs_total`) and `by_country` / `by_source` / `top_companies` (top ~15–20 by count). Built by `summarize_snapshot_dimensions()` from the published job set; earlier snapshots simply omit the key |
| `data/story-cards.json` | JSON (`{generated_at, cards[]}`) | `scripts/build_data_readme.py` | 3–4 auto-generated "state of hiring" stat cards (`build_story_cards()`) derived from `stats-history.json`'s `dimensions` — `{id, title, detail, filter}` per card, where `filter` is a partial site FilterState the frontend applies on click. All copy is generated; week/month deltas are dropped (not faked) when there's no earlier dimensioned snapshot. See [config/story-cards.schema.json](../config/story-cards.schema.json) |
| `data/README.md` | Markdown | `scripts/build_data_readme.py` | The full human-readable job/hackathon/event tables |
| `README.md` (root) | Markdown | `scripts/build_data_readme.py` | Lean overview + badges + snapshot counts |
| `data/raw/*.json` / `*.md` | Raw source payloads | each fetcher's `fetch_url()` call | Debugging aid — inspect a source's untouched pull before its parser runs |

`data/raw/` is overwritten on every run and is not meant to be diffed for history — only `jobs-global.json`, `jobs-global-archive.json`, and `public-opportunities.json` carry forward state between runs (via `id`-keyed diffing in `write_fetch_outputs`).
