# Data

[← back to project overview](../README.md) · [docs index](../README.md#documentation)

No database. All state is JSON files committed under [data/](../data/), regenerated hourly. This page documents every source and every file/field shape.

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
| Workable | `apply.workable.com/api/v1/widget/accounts/<slug>?details=true` (one keyless GET; `{name, jobs:[…]}` with full HTML JD inline) | Manual — `config/extra_job_boards.yml` `workable:` section |
| Devpost | `devpost.com/api/hackathons?status[]=open&order_by=recently-added&page=N` | Standalone (not company-driven) |
| Unstop | `unstop.com/api/public/opportunity/search-result?opportunity=hackathons&oppstatus=recruiting&page=N` | Standalone; paginated, filtered to still-recruiting hackathons |
| Devfolio | `api.devfolio.co/api/hackathons?page=N` | Standalone; filtered client-side to events whose `ends_at` hasn't passed |
| HackerEarth | `www.hackerearth.com/chrome-extension/events/` | Standalone; keyless JSON (the browser-extension endpoint), small featured set, closed events dropped by `end_utc_tz` in the past |
| Luma | `luma.com/discover` (HTML, regex-parsed) | Standalone; filtered by `LUMA_RELEVANT_RE` for tech relevance |
| Curated events | `config/events.yml` (hand-maintained) | Standalone; `Name \| Organizer \| City, Country \| YYYY-MM-DD \| URL` per line — conferences/summits/career fairs with no pollable API. Past-dated rows are auto-hidden |

All free-tier, keyless, public endpoints. Full descriptions in [SOURCES.md](../SOURCES.md).

## Data shapes and schemas

Three JSON Schemas document the three output shapes, all enforced: `scripts/schema_validator.py` (dependency-free, no `jsonschema` package) runs against every row before writing, in `fetch_outputs.py`, `public_outputs.py`, and `build_data_readme.py` (for `site-index.json`). A shape drift raises `ValueError` and aborts the run under `set -euo pipefail`. Tests: `tests/test_schema_validation.py`, `tests/test_site_index.py`.

### `JobEntry` — [config/job-entry.schema.json](../config/job-entry.schema.json)

Used by `data/jobs-global.json` and `data/jobs-global-archive.json` (archive entries add one extra field, `closed_at`).

| Field | Type | Notes |
|---|---|---|
| `id` | string | 16-char hex, `sha256(company+title+url)[:16]` |
| `company` | string | |
| `title` | string | |
| `level` | enum | `internship` \| `new_grad` \| `junior` \| `entry_level` \| `mid_level` \| `unknown` |
| `category` | string | Allowlist category the company matched (`faang`, `big_tech`, `cloud_infra`, ...), or `""` if only included via relaxed-mode fallback |
| `region` | enum | `north_america` \| `latam` \| `europe` \| `mena` \| `apac` \| `remote` \| `unknown` — continental macro-region tier, same taxonomy as `PublicEntry.region`. `mena` (Middle East & Africa, sub-Saharan included) is matched before `europe`. Countries (incl. US/Canada) are the separate `country` field, not region buckets. Data written before 2026-09-06 may still carry `us`/`canada`/`emea` |
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
| `source` | string | e.g. `greenhouse:stripe`, `lever:acme`, `pinpoint:tabby.pinpointhq.com`, `workable:foodics`, `devpost`, `luma` |
| `source_url` | string (uri) | |
| `tech_tags`, `visa_sponsorship`, `degree_required`, `relocation`, `salary` | array / boolean / object | Job-only, optional B3/B4/B5 facets — same strict-positive rules as `SiteIndexEntry` below. Populated for Greenhouse (`?content=true`), Lever (`descriptionPlain` + `lists`), Ashby (`descriptionPlain`), PinpointHQ (`description` + `key_responsibilities` + `skills_knowledge_expertise`), and Workable (`description` HTML); other public sources omit them |

### `SiteIndexEntry` — [config/site-index.schema.json](../config/site-index.schema.json)

Used by the `items` array in `data/site-index.json`, written by `build_site_index()` in `scripts/build_data_readme.py`. Not a third source of truth — every item is copied from an already-validated `JobEntry` / `PublicEntry`; this file just gives a client one flattened file instead of merging `jobs-global.json` + `public-opportunities.json` itself.

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
| `liveness` | enum | `verified` (apply URL in `data/link-cache.json` as alive) or `unverified` (not in cache: never checked, inconclusive, or aged out). **Not** a "dead" flag — dead links are archived/dropped before this file is written. Absent on `kind:"board"` rows |
| `last_checked` | string | ISO-8601 UTC of the last liveness confirmation. Only when `liveness` is `verified` |
| `level`, `region`, `role_type` | enum | Job-only. `region` = macro-region tier (`north_america` / `latam` / `europe` / `mena` / `apac` / `remote` / `unknown`); US/Canada are `north_america`; `mena` (incl. sub-Saharan Africa) tested before `europe`. Site derives it client-side via `geo.ts` `regionForItem()` so `apac`/`latam` appear without a pipeline re-run. Region + Role `<MultiSelect>`s are data-driven; `unknown` is never a filter option. `role_type` → **Role** facet (`?role=backend,frontend`) |
| `category`, `remote_type` | string / enum | Job-only, **curated-origin only** — omitted (not `""`/guessed) on public items |
| `country` | string | Job-only, **both origins**. Public rows get `detect_country()` over `location` in `build_site_index`. `"Unknown"` / `"Remote"` are kept so counts stay honest |
| `country_flag` | string | Job-only. Flag emoji for `country` (`scripts/patterns.py` `country_flag()`). Absent for `Unknown` / `Remote` / country not in the ISO-2 table |
| `tech_tags` | string[] | Job-only. Canonical tags (`React`, `Go`, `Kubernetes`, …) from `detect_tech_tags` over the description. Only for sources with a full description (Greenhouse/Lever/Ashby/PinpointHQ/Workable + curated Remotive/ArbeitNow); omitted — never `[]` — otherwise |
| `visa_sponsorship`, `degree_required`, `relocation` | boolean | Job-only, **explicit-only**. `true`/`false` only when the description says so (negative wins over positive); a silent posting has no key, never a default `false`. From `detect_requirements` |
| `min_years_experience` | integer 1–20 | Job-only, **explicit-only**. Lower bound of a stated YoE requirement ("3+ years… experience" → 3), only when an "experience" word follows the number. From `detect_requirements` |
| `languages_required` | string[] | Job-only, **explicit-only**. Spoken languages next to a fluency cue ("fluent in German"). Never programming languages, never English. From `detect_requirements` |
| `salary` | object | Job-only. `{min, max, currency, period: hour\|month\|year}` lifted by `parse_salary` and sanity-checked; **never estimated**. Absent unless the posting discloses a currency-marked range |

Top-level shape: `{generated_at, count, checksum, items}`. `checksum` = `"sha256:" + sha256(sorted item ids joined by "\n")` — enough to answer "did the item set change," not a content hash. Only `items[]` entries are schema-validated.

## Config files

### `config/companies_allowlist.yml`

Plain YAML, hand-parsed (no PyYAML). Top-level keys are category labels (`faang`, `cloud_infra`, `ai_research`, …). `ALLOWLIST` is a flat lowercase name list; the loader also tracks each name's category in `ALLOWLIST_CATEGORY_BY_NAME`, so `is_allowed_company()` returns the matched category (e.g. `"faang"`), which becomes the row's `category` in `data/jobs-global.json`.

### `config/extra_job_boards.yml`

Sections `ashby:` / `smartrecruiters:` (and `greenhouse:`/`lever:`/`workday:`/`pinpoint:`/`workable:`/`recruitee:`), each a flat token/slug list. Loaded by `load_extra_job_boards()` in `scripts/public_sources.py`. **Caveat (in the file):** SmartRecruiters' API returns HTTP 200 + empty for *any* slug — confirm out-of-band before adding. Ashby 404s an invalid token: `curl https://api.ashbyhq.com/posting-api/job-board/<token>`.

### `config/events.yml`

Hand-maintained tech/career events with no pollable API. One per line: `Name | Organizer | City, Country | YYYY-MM-DD | URL`. Loaded by `parse_curated_events()` / `fetch_curated_events()`; rendered as `kind:"event"` with a live countdown, **any past-dated row dropped** — bump the date for next year's edition. Verify date + URL against the organizer's site first.

### `config/job-entry.schema.json` / `config/public-entry.schema.json`

JSON Schema (draft-07) for external consumers — not read by the pipeline. Update by hand when a record shape changes.

## Storage

Every file is flat JSON or Markdown inside [data/](../data/), committed to git. No external storage, cache, or database.

| File | Format | Written by | Purpose |
|---|---|---|---|
| `data/jobs-global.json` | JSON (`JobEntry[]`) | `scripts/fetch.py` via `fetch_outputs.py` | Live curated jobs |
| `data/jobs-global-archive.json` | JSON (`JobEntry[]` + `closed_at`) | same | Closed/dead-linked/vanished curated jobs |
| `data/public-opportunities.json` | JSON (`{jobs, hackathons, events}`) | `scripts/public_sources.py` via `public_outputs.py` | Public-board jobs + hackathons + events |
| `data/stats.json` | JSON | `scripts/fetch.py` via `fetch_outputs.py` | Curated-feed counts by level/country/source |
| `data/site-index.json` | JSON (`SiteIndexEntry[]` + wrapper) | `scripts/build_data_readme.py` | Both feeds flattened into one checksummed list |
| `data/stats-history.json` | JSON (`{updated_at, retention_days, snapshots[]}`) | `scripts/build_data_readme.py` | One `StatsHistorySnapshot` per run, capped to 90 days. Snapshots also carry a `dimensions` object (`by_level`/`by_region`/`by_remote_type`/`by_role_type`/`by_category` — exhaustive, blank → `unknown`; plus `by_country`/`by_source`/`top_companies` top ~15–20) from `summarize_snapshot_dimensions()`; optional in the schema |
| `data/story-cards.json` | JSON (`{generated_at, cards[]}`) | `scripts/build_data_readme.py` | 3–4 "state of hiring" cards (`build_story_cards()`) from `stats-history.json` `dimensions` — `{id, title, detail, filter}`, `filter` = a partial FilterState the frontend applies on click. Week/month deltas dropped (not faked) when there's no earlier dimensioned snapshot |
| `data/README.md` | Markdown | `scripts/build_data_readme.py` | Full job/hackathon/event tables |
| `README.md` (root) | Markdown | `scripts/build_data_readme.py` | Lean overview + badges + snapshot counts |
| `data/raw/*.json` / `*.md` | Raw source payloads | each fetcher's `fetch_url()` | Debugging aid — the untouched pull before its parser runs |

`data/raw/` is overwritten every run. Only `jobs-global.json`, `jobs-global-archive.json`, and `public-opportunities.json` carry state between runs (via `id`-keyed diffing in `write_fetch_outputs`).
