# Diagrams

[← back to project overview](../README.md) · [docs index](../README.md#documentation)

Every diagram here reflects the actual code as of this writing — nothing speculative. See [ARCHITECTURE.md](ARCHITECTURE.md) for the same diagrams in narrative context, and [FEATURES.md](FEATURES.md) for per-feature flowcharts.

## System overview

```mermaid
flowchart TB
    subgraph External["External sources (15+)"]
        Curated["Curated APIs & READMEs"]
        ATS["ATS APIs (Greenhouse/Lever/Workday/Ashby/SmartRecruiters)"]
        Events["Devpost + Luma"]
    end

    subgraph Pipeline["scripts/"]
        Fetch["fetch.py"]
        Public["public_sources.py"]
        Build["build_data_readme.py"]
    end

    Config["config/*.yml"] --> Fetch
    Curated --> Fetch
    Fetch --> DataJSON["data/jobs-global*.json\ndata/stats.json"]
    DataJSON -. seeds .-> Public
    ATS --> Public
    Events --> Public
    Public --> PublicJSON["data/public-opportunities.json"]
    DataJSON --> Build
    PublicJSON --> Build
    Build --> Readmes["README.md\ndata/README.md"]
```

## Data / request flow (sequence diagram)

```mermaid
sequenceDiagram
    participant Cron as GitHub Actions
    participant Fetch as fetch.py
    participant Sources as 17 curated sources
    participant Public as public_sources.py
    participant ATS as Greenhouse/Lever/Workday/Ashby/SmartRecruiters
    participant Build as build_data_readme.py
    participant Repo as git repo (main)

    Cron->>Fetch: run
    Fetch->>Sources: HTTP GET x17
    Sources-->>Fetch: raw JSON/markdown
    Fetch->>Fetch: normalize + classify + filter + dedupe
    Fetch->>Repo: jobs-global.json, jobs-global-archive.json, stats.json

    Cron->>Public: run
    Public->>Repo: read jobs-global.json (seed)
    Public->>ATS: HTTP GET/POST (discovered + configured boards)
    ATS-->>Public: postings JSON
    Public->>Repo: public-opportunities.json

    Cron->>Build: run
    Build->>Repo: read both JSON files
    Build->>Repo: README.md, data/README.md

    Cron->>Repo: open PR, auto-merge
```

## Component / module dependencies

```mermaid
graph TD
    fetch["fetch.py"] --> patterns["patterns.py"]
    fetch --> simplify["simplify_jobs_parser.py"]
    fetch --> community["community_board_parser.py"]
    fetch --> fetch_outputs["fetch_outputs.py"]
    community --> simplify

    public_sources["public_sources.py"] --> patterns
    public_sources --> simplify
    public_sources --> public_outputs["public_outputs.py"]

    build["build_data_readme.py"] -.reads JSON written by.-> fetch_outputs
    build -.reads JSON written by.-> public_outputs

    test_fetch["tests/test_fetch.py"] -.imports.-> fetch
    test_public["tests/test_public_sources.py"] -.imports.-> public_sources
```

## Feature mind map

```mermaid
mindmap
  root((tracker))
    Curated layer
      17 source fetchers
      Company allowlist filter
      Classification (level/region/country)
      Dedup
      Relaxed-mode retry
    Public layer
      Greenhouse auto-discovery
      Lever auto-discovery
      Workday auto-discovery
        Multi-location resolution
      Ashby (config)
      SmartRecruiters (config)
      Devpost hackathons
      Luma events (relevance-filtered)
    Output pipeline
      Dead-link detection
      Change-only writes
      Archive with revival
      README rendering
        Root README (lean)
        data/README (full tables)
        Stale-job filtering (180d)
    Automation
      Hourly cron (GitHub Actions)
      Auto-merging PR
      CI test suite
```

## CI/CD pipeline

```mermaid
flowchart TD
    subgraph CI["ci.yml"]
        direction LR
        T1["on: pull_request, push to main"] --> T2["checkout + setup-python 3.11"]
        T2 --> T3["test_fetch.py"]
        T3 --> T4["test_public_sources.py"]
    end

    subgraph Hourly["hourly-global-roles.yml"]
        direction TB
        H1["on: cron 15 * * * *, workflow_dispatch"] --> H2["checkout + setup-python 3.11"]
        H2 --> H3["fetch.py"]
        H3 --> H4["public_sources.py"]
        H4 --> H5["build_data_readme.py"]
        H5 --> H6["write LAST_UPDATED"]
        H6 --> H7["create-pull-request action"]
        H7 --> H8{changed?}
        H8 -- yes --> H9["gh pr merge --squash"]
        H8 -- no --> H10["no-op"]
    end
```

## Data pipeline (automation/scripts project)

```mermaid
flowchart LR
    subgraph Stage1["Stage 1: Fetch"]
        A1["Download raw\n(data/raw/*)"] --> A2["Parse per-source"] --> A3["Normalize"] --> A4["Filter + dedupe"]
    end
    subgraph Stage2["Stage 2: Widen"]
        B1["Seed from Stage 1 output"] --> B2["Discover ATS boards"] --> B3["Poll + filter software roles"]
    end
    subgraph Stage3["Stage 3: Build"]
        C1["Load both JSON outputs"] --> C2["Merge + bucket + filter stale"] --> C3["Render Markdown"]
    end
    Stage1 --> Stage2 --> Stage3
```

## Entity relationships (data model)

```mermaid
erDiagram
    JOB_ENTRY {
        string id PK "16-char hex, sha256(company+title+url)"
        string company
        string title
        string level "internship|new_grad|junior|entry_level|mid_level|unknown"
        string country
        string location
        string remote_type "remote|hybrid|onsite|unknown"
        string url
        string source
        string source_url
        string posted_at "YYYY-MM-DD"
        string age
        string collected_at "ISO8601 UTC"
        array tags
    }
    PUBLIC_ENTRY {
        string id PK "16-char hex"
        string kind "job|hackathon|event"
        string company
        string title
        string location
        string level "job only"
        string role_type "job only"
        string date
        string posted_at
        string url
        string source
        string source_url
    }
    ARCHIVE_ENTRY {
        string id PK
        string closed_at "ISO8601 UTC, added on archival"
    }
    JOB_ENTRY ||--o{ ARCHIVE_ENTRY : "moves to when dead/vanished"
    ARCHIVE_ENTRY ||--o{ JOB_ENTRY : "moves back when it reappears active"
```

*(`JOB_ENTRY` = `data/jobs-global.json`, also the shape stored in `data/jobs-global-archive.json` plus `closed_at`. `PUBLIC_ENTRY` = the shared shape for all three arrays in `data/public-opportunities.json`. There is no runtime database — this is the JSON record shape, not SQL tables.)*

## Deployment flow

```mermaid
flowchart TD
    Dev["Contributor opens PR\n(code/config change)"] --> CI["ci.yml runs tests"]
    CI -->|pass| Merge["PR merged to main"]
    CI -->|fail| Fix["fix and push again"]
    Fix --> CI

    Cron["Hourly cron fires\n(15 * * * *)"] --> Pipeline["fetch.py -> public_sources.py\n-> build_data_readme.py"]
    Merge -.picked up on next cron run.-> Pipeline
    Pipeline --> Changed{"any file changed?"}
    Changed -- no --> End1["workflow ends, no PR"]
    Changed -- yes --> PR["create-pull-request opens\nbranch frequent/global-roles-<run_id>"]
    PR --> AutoMerge["gh pr merge --squash --delete-branch"]
    AutoMerge --> Live["main branch updated\nREADME.md / data/*.json live on GitHub"]
```

There is no separate hosting target — "deployment" *is* committing the generated files back to `main`. See [DEPLOYMENT.md](DEPLOYMENT.md) for the full explanation.
