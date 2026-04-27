# tracker

[![Daily Global Tech Roles PR](https://github.com/AhmedNassar7/tracker/actions/workflows/daily-activity.yml/badge.svg)](https://github.com/AhmedNassar7/tracker/actions/workflows/daily-activity.yml)

This repo runs a daily jobs pipeline for software roles at top-tier companies.

## Start Here

Use this page to jump straight to the jobs you want:

- [Internship](data/jobs-global-latest.md#internship)
- [New Grad](data/jobs-global-latest.md#new-grad)
- [Junior](data/jobs-global-latest.md#junior)
- [Entry Level](data/jobs-global-latest.md#entry-level)
- [Mid Level](data/jobs-global-latest.md#mid-level)
- [All jobs in one page](data/jobs-global-latest.md)
- [Raw JSON data](data/jobs-global.json)
- [Stats snapshot](data/stats.json)

## Levels

- Internship
- New Grad
- Junior
- Entry Level
- Mid Level

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

## Source Policy

- Public APIs and public job board pages only
- Keep `source` and `source_url` for attribution
- No forbidden scraping

---

*Maintained by [AhmedNassar7](https://github.com/AhmedNassar7)*
