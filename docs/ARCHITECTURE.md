# Architecture

[← back to project overview](../README.md) · [docs index](../README.md#documentation)

## In plain English

`tracker` has no server and no database. It is a Python script pipeline that GitHub Actions runs once an hour:

1. **Fetch** — pull raw data from ~15 external sources (job-board APIs and community GitHub trackers), normalize every row into one shared shape, and filter it.
2. **Widen** — take the companies discovered in step 1, and poll their underlying ATS (Greenhouse/Lever/Workday) APIs directly for more of their open roles, plus a couple of standalone sources (hackathons, events).
3. **Build** — turn the resulting JSON into human-readable Markdown tables.
4. **Publish** — commit the changed files straight back into this repo via a pull request that auto-merges.

The "deployment target" is the repository itself: `data/*.json` and the two `README.md` files *are* the product. Anyone can read them straight off GitHub, no server required.

## System overview

```mermaid
flowchart TB
    subgraph External["External sources (15+)"]
        direction TB
        Curated["Curated APIs & READMEs\nRemotive · ArbeitNow · SimplifyJobs\nspeedyapply · zapplyjobs\nLorenzoLaCorte · hanzili · ambicuity"]
        ATS["ATS APIs\nGreenhouse · Lever · Workday\nAshby · SmartRecruiters"]
        Events["Devpost · Luma"]
    end

    subgraph Pipeline["scripts/ (Python stdlib, no deps)"]
        Fetch["fetch.py\ncurated layer"]
        Public["public_sources.py\npublic/auto-discovery layer"]
        Build["build_data_readme.py\nrenderer"]
    end

    subgraph Config["config/ (hand-edited YAML)"]
        Allow["companies_allowlist.yml"]
        Extra["extra_job_boards.yml"]
    end

    subgraph Data["data/ (generated JSON + Markdown)"]
        JobsGlobal["jobs-global.json"]
        Archive["jobs-global-archive.json"]
        PublicJSON["public-opportunities.json"]
        Stats["stats.json"]
        DataReadme["data/README.md"]
    end

    RootReadme["README.md (root)"]

    Curated --> Fetch
    Allow --> Fetch
    Fetch --> JobsGlobal
    Fetch --> Archive
    Fetch --> Stats

    JobsGlobal -. "seeds company URLs for\nauto-discovery" .-> Public
    ATS --> Public
    Events --> Public
    Extra --> Public
    Public --> PublicJSON

    JobsGlobal --> Build
    PublicJSON --> Build
    Build --> DataReadme
    Build --> RootReadme

    GHA["GitHub Actions\n(hourly cron)"] --> Fetch
    GHA --> Public
    GHA --> Build
    GHA -- "opens + auto-merges PR" --> Repo[("this repo, main branch")]
    DataReadme --> Repo
    RootReadme --> Repo
    JobsGlobal --> Repo
    Archive --> Repo
    PublicJSON --> Repo
    Stats --> Repo
```

## Every layer/component

| Component | File | What it does |
|---|---|---|
| Curated fetch layer | [scripts/fetch.py](../scripts/fetch.py) | Pulls 17 curated sources concurrently, normalizes each row to the shared job shape, filters by `config/companies_allowlist.yml` + level/region, dedupes, writes `jobs-global*.json` and `stats.json` |
| Shared normalization/output | [scripts/fetch_outputs.py](../scripts/fetch_outputs.py) | Diffs this run against the last, checks link liveness (concurrently, via `net.run_concurrently`), moves dead/vanished postings to the archive, only writes files when something actually changed |
| Classification patterns | [scripts/patterns.py](../scripts/patterns.py) | Central regexes for level/region/remote-type/country/role detection, shared by both fetch layers |
| Networking | [scripts/net.py](../scripts/net.py) | `fetch_with_retry` (retries transient network errors and 429/5xx HTTP responses with backoff) and `run_concurrently` (thread-pool fan-out with deterministic, order-preserving results), shared by both fetch layers |
| SimplifyJobs parser | [scripts/simplify_jobs_parser.py](../scripts/simplify_jobs_parser.py) | Parses SimplifyJobs' specific pipe-table + HTML-table README format, including multi-location `<details>` cells |
| Generic community-board parser | [scripts/community_board_parser.py](../scripts/community_board_parser.py) | Shape-based parser (not fixed-column) for speedyapply/zapplyjobs/hanzili/LorenzoLaCorte README tables |
| Public/auto-discovery layer | [scripts/public_sources.py](../scripts/public_sources.py) | Auto-discovers Greenhouse/Lever/Workday boards from curated job URLs, polls Ashby/SmartRecruiters from config, pulls Devpost hackathons and Luma events, writes `public-opportunities.json` |
| Public output writer | [scripts/public_outputs.py](../scripts/public_outputs.py) | Splits rows by `kind` (job/hackathon/event) and writes the combined JSON payload |
| README renderer | [scripts/build_data_readme.py](../scripts/build_data_readme.py) | Loads both JSON outputs, merges + buckets by level, filters stale (>180d) postings, renders `README.md` and `data/README.md` |
| Config | [config/](../config/) | `companies_allowlist.yml` (curated-layer gate), `extra_job_boards.yml` (Ashby/SmartRecruiters tokens), two JSON Schemas documenting the output shapes |
| Tests | [tests/](../tests/) | Assert-based test scripts for `net.py`, `fetch.py`, and `public_sources.py`, run in CI |
| Automation | [.github/workflows/](../.github/workflows/) | `ci.yml` (tests on PR/push), `hourly-global-roles.yml` (the hourly pipeline + auto-merge) |

## Data flow end to end

```mermaid
sequenceDiagram
    participant Cron as GitHub Actions (hourly cron)
    participant Fetch as fetch.py
    participant Src as Curated sources
    participant Out as fetch_outputs.py
    participant Public as public_sources.py
    participant ATS as Greenhouse/Lever/Workday/Ashby/SmartRecruiters
    participant Build as build_data_readme.py
    participant Repo as GitHub repo (main)

    Cron->>Fetch: python scripts/fetch.py
    Fetch->>Src: HTTP GET (17 sources, concurrently)
    Src-->>Fetch: raw JSON / README markdown
    Fetch->>Fetch: normalize, classify, filter by allowlist, dedupe
    Fetch->>Out: write_outputs(rows)
    Out->>Repo: read previous jobs-global.json (diff base)
    Out->>Out: check_url_alive() per posting, concurrently (HEAD then GET each)
    Out-->>Repo: jobs-global.json, jobs-global-archive.json, stats.json

    Cron->>Public: python scripts/public_sources.py
    Public->>Repo: read jobs-global.json (seed URLs)
    Public->>Public: discover Greenhouse/Lever/Workday tokens from seed URLs
    Public->>ATS: HTTP GET/POST (discovered + configured boards, concurrently per platform)
    ATS-->>Public: job postings JSON
    Public->>Public: filter to software roles, dedupe
    Public-->>Repo: public-opportunities.json

    Cron->>Build: python scripts/build_data_readme.py
    Build->>Repo: read jobs-global.json + public-opportunities.json
    Build->>Build: merge, bucket by level, filter stale (>180d), render tables
    Build-->>Repo: README.md, data/README.md

    Cron->>Repo: git commit + open PR (peter-evans/create-pull-request)
    Cron->>Repo: gh pr merge --squash
```

## External services and APIs

```mermaid
graph LR
    subgraph Curated["Curated layer sources"]
        Remotive["Remotive API"]
        ArbeitNow["ArbeitNow API"]
        SimplifyI["SimplifyJobs\nInternships repo"]
        SimplifyN["SimplifyJobs\nNew-Grad repo"]
        Speedy["speedyapply\nSWE + AI repos"]
        Zapply["zapplyjobs\n6 repos"]
        Lorenzo["LorenzoLaCorte\nEU repo"]
        Hanzili["hanzili\nCanada repo"]
        Ambicuity["ambicuity\nJSON feed"]
    end

    subgraph Public["Public / auto-discovered layer"]
        Greenhouse["Greenhouse\nboards-api.greenhouse.io"]
        Lever["Lever\napi.lever.co"]
        Workday["Workday\nper-tenant CXS API"]
        Ashby["Ashby\napi.ashbyhq.com"]
        SmartRec["SmartRecruiters\napi.smartrecruiters.com"]
        Devpost["Devpost\ndevpost.com/api/hackathons"]
        Luma["Luma\nluma.com/discover"]
    end

    Tracker(("tracker pipeline"))

    Remotive --> Tracker
    ArbeitNow --> Tracker
    SimplifyI --> Tracker
    SimplifyN --> Tracker
    Speedy --> Tracker
    Zapply --> Tracker
    Lorenzo --> Tracker
    Hanzili --> Tracker
    Ambicuity --> Tracker

    Tracker -. "company names seed\nauto-discovery" .-> Greenhouse
    Tracker -. seeds .-> Lever
    Tracker -. seeds .-> Workday
    Ashby --> Tracker
    SmartRec --> Tracker
    Devpost --> Tracker
    Luma --> Tracker
    Greenhouse --> Tracker
    Lever --> Tracker
    Workday --> Tracker
```

All 15 integrations are free-tier public APIs or public GitHub content — no paid APIs, no API keys, no `requirements.txt`.

## CI/CD pipeline

Two independent GitHub Actions workflows:

```mermaid
flowchart TD
    subgraph CI["ci.yml — on pull_request, push to main"]
        C1["Checkout"] --> C2["Set up Python 3.11"]
        C2 --> C3["python3 tests/test_fetch.py"]
        C3 --> C4["python3 tests/test_public_sources.py"]
    end

    subgraph Hourly["hourly-global-roles.yml — cron '15 * * * *' + workflow_dispatch"]
        H1["Checkout"] --> H2["Set up Python 3.11"]
        H2 --> H3["python3 scripts/fetch.py"]
        H3 --> H4["python3 scripts/public_sources.py"]
        H4 --> H5["python3 scripts/build_data_readme.py"]
        H5 --> H6["Write LAST_UPDATED timestamp"]
        H6 --> H7["peter-evans/create-pull-request\n(opens PR if anything changed)"]
        H7 --> H8{"PR created?"}
        H8 -- yes --> H9["gh pr merge --squash --delete-branch"]
        H8 -- no --> H10["nothing changed, workflow ends"]
    end
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for the full trigger/job/step breakdown of both workflows.
