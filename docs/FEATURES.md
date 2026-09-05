# Features

[← back to project overview](../README.md) · [docs index](../README.md#documentation)

## Curated job fetching

**Purpose:** Pull job postings from 18 hand-picked sources and keep only roles at top-tier companies, so the "Jobs" table stays high-signal instead of a firehose.

**Where it lives:** [scripts/fetch.py](../scripts/fetch.py) — one `fetch_<source>()` function per source (`fetch_remotive`, `fetch_arbeitnow`, `fetch_simplify_internships`, `fetch_simplify_newgrad`, `fetch_speedyapply_swe`/`_ai`, six `fetch_zapplyjobs_*`, `fetch_vanshb03_summer_internships`/`_newgrad`, `fetch_lorenzolacorte_eu`, `fetch_hanzili_canada`, `fetch_ambicuity_newgrad`, `fetch_amazon`), orchestrated by `main()`. `fetch_amazon` is the one exception to "third-party tracker" — it hits `amazon.jobs`'s own search API directly, since Amazon has a real, free, keyless API of its own (verified live rather than assumed).

**How it works:** Each fetcher downloads its source (JSON API or a GitHub-hosted README), parses it into `(company, title, location, url, age)` tuples, runs each through `normalize()` to attach a stable id, detected level/region/country/remote-type, then `include_job()` filters by wanted level + `config/companies_allowlist.yml`. All source lists get concatenated and deduped by `dedupe()`. If zero rows survive strict filtering, `main()` retries everything once in `RELAXED_MODE` (level `unknown` allowed, non-allowlisted companies allowed for internship/new-grad only) so a single misbehaving regex can't zero out an entire run.

```mermaid
flowchart LR
    Src["17 sources\n(API JSON or README markdown)"] --> Parse["source-specific parser\n(simplify_jobs_parser /\ncommunity_board_parser /\ninline JSON parsing)"]
    Parse --> Norm["normalize()\nid, level, region, country,\nremote_type via patterns.py"]
    Norm --> Filter{"include_job()\nlevel in WANTED_LEVELS\n+ allowlist match?"}
    Filter -- no --> Drop["dropped, counted in\nper-source skip stats"]
    Filter -- yes --> Dedupe["dedupe()\nby id + company + title"]
    Dedupe --> Zero{"0 rows survived\nfor every source?"}
    Zero -- yes --> Relaxed["retry once in\nRELAXED_MODE"]
    Zero -- no --> Out["write_fetch_outputs()"]
    Relaxed --> Out
```

## Company allowlist filtering

**Purpose:** Guarantee the curated feed only contains roles at companies worth showing, regardless of how noisy a source's own listings are.

**Where it lives:** `config/companies_allowlist.yml` (data), loaded and checked in `scripts/fetch.py` via `ALLOWLIST`, `is_allowed_company()`.

**How it works:** The YAML file is parsed by hand (no PyYAML dependency) into a flat lowercase list, ignoring category headers and comments. `is_allowed_company(company)` matches an allowlist entry as a **whole token** — bounded by a non-alphanumeric character (or string start/end) on each side — so `"Amazon"` matches `"Amazon.com Services LLC"` and `"Amazon Web Services"` but not `"Metaphor"` (a plain `"meta" in c` used to wrongly accept it as Meta, dropping a random startup into the FAANG tier).

## Classification engine

**Purpose:** Turn a free-text job title and location string into structured fields (`level`, `region`, `country`, `remote_type`) that the rest of the pipeline can filter, bucket, and sort on.

**Where it lives:** [scripts/patterns.py](../scripts/patterns.py) — regex tables shared by both `fetch.py` (`FETCH_*`) and `public_sources.py` (`PUBLIC_*`); applied via `detect_level`, `detect_region`, `detect_remote_type`, `detect_country`, `detect_role_type`.

**How it works:** Each detector runs an ordered set of `re.compile(..., re.I)` patterns against the title or location string and returns the first match's category (e.g. `internship`, `new_grad`, `junior`), or a fallback (`"unknown"` for the curated layer, `"other"` for the public layer) if nothing matches.

`detect_region` buckets a location into `us` / `canada` / `mena` / `emea` / `remote` / `unknown`. **`mena` (Middle East & Africa) is checked before `emea`** so a Gulf, Levant, North-Africa, or sub-Saharan-tech-hub location (Dubai, Riyadh, Cairo, Amman, Tel Aviv, Lagos, Nairobi, Cape Town, Istanbul, …) resolves to its own region instead of being folded into Europe. It's in `WANTED_REGIONS`, so the curated layer keeps these roles rather than filtering them out. The site exposes `mena` as a first-class facet everywhere `region` appears — `FilterBar`, `GlobalDashboard`'s "Jobs by region", the `PreferencesPanel` region chips, and "Best match" scoring — labelled **"Middle East & Africa"**. Region enums in `config/job-entry.schema.json`, `config/public-entry.schema.json`, and `config/site-index.schema.json` all carry `mena`.

## Dead-link detection and archiving

**Purpose:** Keep the published list free of postings whose link is actually gone, without wrongly archiving/dropping live postings just because a server mishandled one HTTP verb.

**Where it lives:** `check_url_alive()` in [scripts/net.py](../scripts/net.py), shared by both collector layers. The curated layer's archiving logic is in `write_fetch_outputs()` in [scripts/fetch_outputs.py](../scripts/fetch_outputs.py) (archives to `jobs-global-archive.json` with `closed_at`); the public layer's is in `write_public_outputs()` in [scripts/public_outputs.py](../scripts/public_outputs.py) (drops the row outright — no archive file exists for that layer).

**How it works:** For each URL, `check_url_alive` tries `HEAD` first; a `HEAD` 404/410/405 is *not* trusted on its own (observed live on Pinterest's careers site) — it retries with `GET` before declaring the link dead. Anything else (403 bot-block, timeout, DNS error) is treated as "can't tell, assume alive." Separately, a posting present in the previous run but missing from this run's fresh fetch (rolled off the source, not necessarily dead-linked) is also archived. A posting that reappears active later has its stale archive entry dropped automatically.

**Soft-404 and bot-blocked exceptions (all hand-verified):** three sites can't be judged by status code alone, so `check_url_alive` special-cases them:
- **`_SOFT_404_RULES`** — a URL-regex → dead/alive-marker table. `google.com/about/careers/.../results/*` is dead when its `og:title` is empty; `jobs.apple.com/*/details/*` and `joinbytedance.com/search/*` are dead when a server-rendered `og:title` is *absent* entirely (a live posting always has one, an expired one falls back to a generic shell). Add a rule only after confirming the marker by hand against real live-vs-expired pages.
- **LinkedIn** — `linkedin.com/jobs/view/<id>` apply links (e.g. the whole `lorenzolacorte_eu` feed) are bot-blocked on the page itself, so `check_url_alive` fetches LinkedIn's unauthenticated guest fragment instead. It treats "No longer accepting applications" / a 404 as dead — and, unlike every other case, an *inconclusive* read (bot-block, empty fragment, timeout) after 3 retries also resolves to **dead**, not alive. LinkedIn scraped links are the lowest-trust input and go stale within days; a curated-layer archive is reversible, so the row returns automatically once LinkedIn answers again.

```mermaid
flowchart TD
    Row["candidate posting"] --> Head["HEAD request"]
    Head -->|"200-399"| Alive1["alive"]
    Head -->|"404/410/405"| Get["retry with GET"]
    Head -->|"other error/timeout"| Alive2["alive (inconclusive)"]
    Get -->|"200-399"| Alive3["alive (HEAD was wrong)"]
    Get -->|"404/410"| Dead["dead -> archived\nwith closed_at timestamp"]
    Get -->|"other error/timeout"| Alive4["alive (inconclusive)"]

    Missing["posting was active last run,\nabsent from this run's fetch"] --> Dead

    Reappear["archived posting reappears\nactive in a later run"] --> Revive["dropped from archive\nautomatically"]
```

## Schema validation on write

**Purpose:** Guarantee every row this pipeline publishes actually matches the JSON Schema it claims to (`config/job-entry.schema.json` / `config/public-entry.schema.json`), so a coding bug or an unexpected upstream value fails the run loudly instead of silently shipping malformed data to whatever reads these files next (the planned site, most directly).

**Where it lives:** [scripts/schema_validator.py](../scripts/schema_validator.py) (the validator itself — dependency-free, no `jsonschema` package, matching this repo's stdlib-only rule), called from `write_fetch_outputs()` in `fetch_outputs.py` and `write_public_outputs()` in `public_outputs.py`.

**How it works:** A small draft-07 subset — `type`, `enum`, `pattern`, `format: uri`, `required`, and `additionalProperties: false` — is enough to cover everything the two schema files actually use, without a general JSON Schema implementation. Both write functions validate every row immediately before writing; any error raises `ValueError` with up to 20 specific messages logged first, which — combined with the hourly workflow's `set -euo pipefail` — aborts that run entirely rather than opening a PR with bad data. No workflow YAML changes were needed for this: validation lives inside the same `fetch.py`/`public_sources.py` runs the hourly workflow already calls.

## Change-only output writes

**Purpose:** Avoid noisy commits/PRs — the hourly workflow should only open a PR when the published data actually changed.

**Where it lives:** `write_fetch_outputs()` in [scripts/fetch_outputs.py](../scripts/fetch_outputs.py).

**How it works:** Each new row is compared against the previous run's row with the same `id` via a content signature (`_job_signature`, JSON of the meaningful fields, sorted keys) that deliberately excludes noisy fields like `age`/`collected_at`. If every row's signature and the active-file ordering are unchanged, the function logs "No job changes detected" and returns without touching any file on disk — so an hour with zero real changes produces zero git diff.

## Public / auto-discovery layer

**Purpose:** Widen coverage far beyond the curated allowlist by polling the actual ATS (applicant tracking system) APIs behind companies already seen in the curated feed — no manual company list needed for the three biggest ATS platforms.

**Where it lives:** [scripts/public_sources.py](../scripts/public_sources.py) — `discover_job_board_sources()`, `fetch_greenhouse_board_jobs`, `fetch_lever_jobs`, `fetch_workday_jobs`, `fetch_ashby_board_jobs`, `fetch_smartrecruiters_jobs`.

**How it works:** `discover_job_board_sources()` scans every URL already in `data/jobs-global.json` (the curated layer's output) for a Greenhouse board token, Lever company slug, or Workday `(host, site)` pair, using dedicated URL-shape extractors. Any company found this way gets its full board polled directly on the *next* run — no config file entry required. Ashby and SmartRecruiters can't be auto-discovered this way (no reliable URL signature), so their companies are curated by hand in `config/extra_job_boards.yml`.

```mermaid
flowchart LR
    Seed["data/jobs-global.json\n(curated layer output)"] --> Discover["discover_job_board_sources()"]
    Discover --> GH["Greenhouse\nboard tokens"]
    Discover --> LV["Lever\ncompany slugs"]
    Discover --> WD["Workday\n(host, site) pairs"]
    Config["config/extra_job_boards.yml"] --> AB["Ashby tokens"]
    Config --> SR["SmartRecruiters tokens"]

    GH --> Poll["poll each board's\npublic API directly"]
    LV --> Poll
    WD --> Poll
    AB --> Poll
    SR --> Poll
    Poll --> Filter["is_software_job()\nfilter to engineering roles"]
    Filter --> Out["public-opportunities.json"]
```

## Workday multi-location resolution

**Purpose:** Workday's job *listing* API only ever returns a bare count ("2 Locations") for multi-location postings, never the actual city names — this feature resolves that into a real, readable dropdown.

**Where it lives:** `fetch_workday_job_locations()` and the `WORKDAY_LOCATION_COUNT_RE` check inside `fetch_workday_jobs()` in [scripts/public_sources.py](../scripts/public_sources.py).

**How it works:** `fetch_workday_jobs` detects the bare-count shape (`^\d+\s+locations?$`) and, only for postings that need it (capped at `max_location_lookups=25` per board to bound API calls), makes one extra per-job detail call to the Workday CXS API to pull `jobPostingInfo.location` + `additionalLocations`. The result is rendered the same way the curated layer already renders SimplifyJobs multi-location postings — a `<details><summary>` dropdown — via the shared `format_location_display()` helper.

## Hackathon and event discovery

**Purpose:** Broaden the tracker beyond jobs to include build events (hackathons, tech meetups) that the same audience — students and early-career engineers — cares about, from more than one hackathon catalog so no single site's blind spots become the tracker's blind spots.

**Where it lives:** `fetch_devpost_hackathons()`, `fetch_unstop_hackathons()`, `fetch_devfolio_hackathons()`, and `fetch_luma_discover()` / `parse_luma_discover()` in [scripts/public_sources.py](../scripts/public_sources.py).

**How it works:** Devpost's hackathons *page* is client-rendered and has no listings in the server HTML, so this hits `devpost.com/api/hackathons` directly — the JSON API the site's own frontend calls — paginated until `total_count` is reached. Unstop's public API (`oppstatus=recruiting`) and Devfolio's public API (filtered client-side to events whose `ends_at` hasn't passed) add two more real, free, keyless catalogs — Unstop skews global-with-strong-India-coverage, Devfolio skews Web3/student hackathons, neither of which Devpost covers as deeply. Luma's `/discover` page is a general community directory (book clubs, walking tours, design meetups, not just tech), so `LUMA_RELEVANT_RE` filters the scraped anchor text to only entries whose visible text signals software/AI/startup relevance before including them.

## README/data rendering

**Purpose:** Turn the two machine-oriented JSON files into the two human-oriented Markdown pages people actually browse.

**Where it lives:** [scripts/build_data_readme.py](../scripts/build_data_readme.py) — `render_root_readme()`, `render_data_readme()`, plus helpers `level_bucket`, `filter_stale_jobs`, `format_age`, `table_rows`, `badge`.

**How it works:** Loads `jobs-global.json` + `public-opportunities.json`, normalizes both into one shared row shape (tagging origin as `curated` or `public`), buckets every job into `internship` / `early_career` / `mid_level` via `level_bucket()`, drops anything older than 180 days via `filter_stale_jobs()`, then renders two Markdown files: a lean root `README.md` (badges + snapshot counts + links) and the full `data/README.md` (every job table, hackathons, events, plus a **Browse Every Role** section and the source-file index). Both files carry an explicit "generated — don't hand-edit" notice. Titles/locations that a source hands over in all-lowercase (e.g. LorenzoLaCorte's LinkedIn scrape) are title-cased by `smart_title_case()` in `scripts/company_names.py` — acronyms and already-cased strings are left alone.

**Job ordering (`sort_jobs`):** company tier first (FAANG → big-tech → cloud → … from the allowlist section order — `CATEGORY_RANK`, mirrored in `scripts/fetch.py`; uncategorised public-layer rows sort last). *Within* a tier, every one of a company's roles stays together as a single block; blocks are ordered by the company's freshest posting, and each block is sorted newest-first — so a table reads "Google (6 roles), then Netflix (3), then Apple (1)…" instead of interleaving companies by age. The site's default "Top companies" sort (`OpportunityBrowser.tsx`) mirrors this exactly.

**Company-name normalization (`company_names.prettify_company_name`):** besides re-casing machine tokens (`openai` → `OpenAI`), it collapses a legal-entity or regional-subsidiary name to the parent brand — `Amazon.com Services LLC` / `Amazon Kuiper Commercial Services LLC` / `Amazon Development Centre Canada ULC` → `Amazon`, `Uber Technologies, Inc.` → `Uber` — but only when *every* token after a known parent brand is corporate/legal/geographic filler, so a real sub-brand (`Amazon Robotics`, `Amazon Web Services`, `Google Fiber`) is left intact.

**Age reconciliation (`reconcile_age`):** the curated feed deliberately freezes a row's `age` between runs to avoid hourly churn, and a few community-README parsers seed `"0d"` when they can't read the source's date cell — both leave weeks-old listings showing as brand new. `posted_at` is frozen at first-seen, so days-since-`posted_at` is a hard lower bound: `reconcile_age` trusts a parseable source age only while it's within that bound, otherwise shows the bound. Applied to every job row in both `data/README.md` and `site-index.json`; hackathon/event `age` (a deadline countdown) is left untouched.

**Multi-location postings:** the curated layer bakes a `<details><summary>` dropdown into `location` for the Markdown tables (via `format_location_display`). `site-index.json` is consumed by a real UI, not a Markdown renderer, so `_clean_site_location()` unpacks that HTML back into a plain `"First, Place +N more"` summary string plus a `locations[]` array; the site's `OpportunityTable` renders its own `<details>` control from the array.

```mermaid
flowchart TD
    CJ["jobs-global.json\n(curated)"] --> Merge["normalize_rows() x2\n+ concatenate"]
    PJ["public-opportunities.json\n(public jobs/hackathons/events)"] --> Merge
    Merge --> Bucket["level_bucket()\ninternship / early_career / mid_level"]
    Bucket --> Stale["filter_stale_jobs()\ndrop postings > 180d old"]
    Stale --> Sort["sort_jobs()\nby age, then company tier, then name"]
    Sort --> Render1["render_data_readme()"]
    Sort --> Render2["render_root_readme()"]
    Render1 --> DataReadme["data/README.md"]
    Render2 --> RootReadme["README.md (root)"]
```

## Dead-simple config extension points

**Purpose:** Let non-Python contributors change which companies/boards are tracked without touching code.

**Where it lives:** `config/companies_allowlist.yml`, `config/extra_job_boards.yml`, `config/aggregate_links.yml`.

**How it works:** All three are plain lists read line-by-line (no dependency on a YAML parser library). Adding a company to the curated allowlist or an Ashby/SmartRecruiters board token to `extra_job_boards.yml` takes effect on the very next hourly run — see [CONTRIBUTING.md](../CONTRIBUTING.md) for the exact steps and the SmartRecruiters verification caveat (its API returns HTTP 200 for *any* slug, valid or not, so unverified additions silently do nothing). `config/aggregate_links.yml` (`Company | link text | URL` per line) is for companies with no enumerable public board (Google, Meta, Microsoft, Apple) — each becomes one hand-verified "browse all early-career roles" row in `data/README.md`'s **Browse Every Role** section, never a fake single posting.

## Website

**Purpose:** A fast, no-account frontend over `data/site-index.json` — the same data the READMEs render, but browsable, filterable, and personalised.

**Where it lives:** `site/` (Astro + React islands, deployed separately, reads `site-index.json` / `stats-history.json` from jsDelivr at runtime so it's ≤1h stale without redeploying).

**How it works:** `OpportunityBrowser.tsx` is the main island — a `SnapshotHero` (live count, freshness, four one-tap shortcut chips), a collapsible `PreferencesPanel` (level/region/work-type/keywords/hide-company, stored in `localStorage`, never uploaded), a **Top companies / Newest / Best match** sort — *Top companies* is the default: it ranks by `companyTier()` (`lib/companyTiers.ts`, the same FAANG-first order as the pipeline) so the best-known names lead regardless of collector layer; *Best match* ranks by `scoreOpportunity()` (`lib/preferences.ts`) with "why it matched" chips — the `FilterBar`, and `OpportunityTable` (per-kind columns; `CompanyAvatar` shows a real favicon only for companies whose domain is hand-verified in `lib/companyLogos.ts`, trying two keyless providers (DuckDuckGo, then Google `faviconV2`) since neither covers every domain — for hackathon/event rows it instead derives the favicon from the row's own organiser URL, which can't be the wrong entity — else generated initials, never a guessed logo). Saved searches (`lib/savedSearches.ts`) persist named filter combos as chips. `<ClientRouter />` gives native cross-page view transitions.
