# tracker

[![Daily Egypt Dev Jobs PR](https://github.com/AhmedNassar7/tracker/actions/workflows/daily-activity.yml/badge.svg)](https://github.com/AhmedNassar7/tracker/actions/workflows/daily-activity.yml)

Daily snapshot of Egypt-based remote dev jobs, powered by GitHub Actions.

A workflow runs every day at 01:15 UTC:
- Fetches live listings from the [Remotive](https://remotive.com) public API
- Filters for Egypt / Cairo / MENA locations
- Writes `data/jobs-egypt.json` and `data/jobs-egypt-latest.md`
- Opens a Pull Request → auto-merges it

Each run produces **2 contributions**: one commit + one merged PR.

---

*Profile: [AhmedNassar7](https://github.com/AhmedNassar7)*