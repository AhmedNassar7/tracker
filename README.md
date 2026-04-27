# tracker

[![Daily Global Tech Roles PR](https://github.com/AhmedNassar7/tracker/actions/workflows/daily-activity.yml/badge.svg)](https://github.com/AhmedNassar7/tracker/actions/workflows/daily-activity.yml)

Daily Global Dev Jobs Tracker.

## Quick Test

Run the test directly with Python:

```bash
python tests/test_fetch.py
```

Expected result:
- Green check lines with emoji
- Final line: `✅ ALL PASSED: 9 checks`

## What To Expect In GitHub Actions

If the workflow finds matching jobs, it should create/update these files:

- `data/jobs-global.json`
- `data/jobs-global-latest.md`
- `data/stats.json`
- `log/YYYY-MM.md`
- `LAST_UPDATED`

If no jobs match, the workflow still completes and writes empty outputs, so you can see that the run happened.

Run time is usually about 1 to 3 minutes. If an API is down, the workflow should continue with the other sources and report warnings in the Actions log.

## 🎯 Scope

- **Regions:** US, Canada, EMEA (+ Remote)
- **Levels:** Internship, New Grad, Junior, Entry-Level, Mid-Level
- **Companies:** Top-tier allowlist only (`config/companies_allowlist.yml`)
- **Roles:** Software Engineer, Full Stack, Frontend, Backend, Mobile, DevOps, ML, Data, SRE, Security, Cloud, QA

## 📚 Role Coverage

Actively tracking positions for:

- **Software Engineering:** SDE, Full Stack, Frontend, Backend, Mobile (iOS/Android/Flutter)
- **Languages:** Python, Java, JavaScript/TypeScript, Go, C++, C#, .NET, Node.js, React Native
- **DevOps & Platform:** DevOps Engineer, Platform Engineer, SRE, Infrastructure
- **Data & ML:** Machine Learning Engineer, Data Engineer, Data Scientist
- **Specialized:** QA Engineer, Security Engineer, Cloud Engineer, Embedded Software
- **Early Career:** Internships, New Grad, Campus Hiring

## 📊 Data Sources

Fetches from **multiple safe, public sources**:

1. **Remotive API** — Global remote-first job board
2. **ArbeitNow API** — Remote work marketplace
3. **SimplifyJobs Internships** — Curated 2026 summer internships at top companies
4. **SimplifyJobs New Grad** — New graduate software engineer positions

Each job entry includes:
- `source` + `source_url` for attribution
- Standardized fields: `id`, `company`, `title`, `level`, `region`, `remote_type`, `location`, `posted_at`
- Deduplication and normalization per `config/schema.json`

## 📁 Outputs

Updated daily in `data/`:

- **`jobs-global.json`** — Full structured JSON export (all jobs)
- **`jobs-global-latest.md`** — Top 200 jobs in markdown table (latest first)
- **`stats.json`** — Aggregated counts by level, region, source
- **`log/YYYY-MM.md`** — Monthly audit log

Last updated: See `LAST_UPDATED`

## 🔧 Configuration

- **`config/companies_allowlist.yml`** — Approved companies (FAANG, Big Tech, Cloud, SaaS, AI, FinTech, etc.)
- **`config/sources.yml`** — Source definitions and control
- **`config/schema.json`** — Job entry JSON schema

## 🚀 Automation

Workflow: `.github/workflows/daily-activity.yml`

- **Triggers:** Daily at 01:15 UTC + manual dispatch
- **Process:**
  1. Fetch from all enabled sources
  2. Normalize & filter by level/region/allowlist
  3. Deduplicate
  4. Export JSON, Markdown, Stats
  5. Create PR
  6. Auto-merge with squash

Each run produces **2 GitHub contributions**: commit + merged PR.

## 📝 Attributes

Sources are properly attributed:

- Each job listing includes `source` and `source_url`
- Respect `robots.txt` and Terms of Service
- Public APIs and feeds only
- No forbidden scraping

---

*Maintained by [AhmedNassar7](https://github.com/AhmedNassar7)*