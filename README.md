# tracker

[![Daily Global Tech Roles PR](https://github.com/AhmedNassar7/tracker/actions/workflows/daily-activity.yml/badge.svg)](https://github.com/AhmedNassar7/tracker/actions/workflows/daily-activity.yml)

Daily Global Dev Jobs Tracker.

## Start Here

Use this page to jump straight to the jobs you want:

- [Internship jobs](data/jobs-global-latest.md#internship)
- [New Grad jobs](data/jobs-global-latest.md#new-grad)
- [Junior jobs](data/jobs-global-latest.md#junior)
- [Entry Level jobs](data/jobs-global-latest.md#entry-level)
- [Mid Level jobs](data/jobs-global-latest.md#mid-level)
- [Senior Level jobs](data/jobs-global-latest.md#senior-level)
- [Staff Level jobs](data/jobs-global-latest.md#staff-level)
- [Lead / Tech Lead jobs](data/jobs-global-latest.md#lead--tech-lead)
- [Principal Level jobs](data/jobs-global-latest.md#principal-level)
- [All jobs in one page](data/jobs-global-latest.md)
- [Raw JSON data](data/jobs-global.json)
- [Stats snapshot](data/stats.json)

## What This Repo Shows

This repo runs a daily jobs pipeline for software roles at top-tier companies.
Jobs are grouped by level so browsing is faster and less noisy.

## What The Data Means

The generated jobs page includes:
- Company name, without extra emoji noise
- Job title
- Location with a country flag when recognized
- Posted date
- Source attribution

The data files include:
- `data/jobs-global-latest.md` for a human-friendly jobs browser
- `data/jobs-global.json` for structured data
- `data/stats.json` for counts by level and source
- `log/YYYY-MM.md` for the monthly run log
- `LAST_UPDATED` for the last update timestamp

## Levels

- Internship
- New Grad
- Junior
- Entry Level
- Mid Level
- Senior Level
- Staff Level
- Lead / Tech Lead
- Principal Level

## Sources

Public and allowed sources only:
- Remotive
- ArbeitNow
- SimplifyJobs Internships
- SimplifyJobs New Grad

## Test

Run the test directly:

```bash
python tests/test_fetch.py
```

Expected result:
- Green pass lines
- Final line: `✅ ALL PASSED: 9 checks`

## Workflow

The GitHub Actions workflow runs daily and can also be triggered manually.
If strict filtering returns no matches, the script retries with a relaxed pass so useful jobs still show up when available.

## Source Policy

- Public APIs and public job board pages only
- Keep `source` and `source_url` for attribution
- No forbidden scraping

---

*Maintained by [AhmedNassar7](https://github.com/AhmedNassar7)*
