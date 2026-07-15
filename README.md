# tracker

**A free, always-up-to-date list of software engineering jobs, internships, hackathons, and events — no sign-up, no paywall.**

A robot checks top companies and public job boards every hour, so you don't have to. Everything below is refreshed automatically.

[![Hourly Global Tech Roles PR](https://github.com/AhmedNassar7/tracker/actions/workflows/daily-activity.yml/badge.svg)](https://github.com/AhmedNassar7/tracker/actions/workflows/daily-activity.yml) [![Total opportunities 125](https://img.shields.io/badge/Total%20opportunities-125-brightgreen.svg)](data/README.md) [![Jobs 109](https://img.shields.io/badge/Jobs-109-16a34a.svg)](data/README.md#jobs) [![Last updated 2026-07-15](https://img.shields.io/badge/Last%20updated-2026--07--15-grey.svg)](LAST_UPDATED)

[![Internship 22](https://img.shields.io/badge/Internship-22-22c55e.svg)](data/README.md#internship) [![Early Career 17](https://img.shields.io/badge/Early%20Career-17-0ea5e9.svg)](data/README.md#early-career) [![Mid-Level and Above 70](https://img.shields.io/badge/Mid--Level%20and%20Above-70-dc2626.svg)](data/README.md#mid-level-and-above) [![Hackathons 2](https://img.shields.io/badge/Hackathons-2-f59e0b.svg)](data/README.md#hackathons) [![Events 14](https://img.shields.io/badge/Events-14-8b5cf6.svg)](data/README.md#events)

## New here? Start with one click

### 👉 [**Open the full list of 125 opportunities**](data/README.md)

That page has everything: jobs, internships, hackathons, and events, each with a direct apply link. No account needed, just click and go.

## Snapshot

_As of 2026-07-15._

| Category | Count | Link |
|---|---:|---|
| Internship | 22 | [View](data/README.md#internship) |
| Early Career | 17 | [View](data/README.md#early-career) |
| Mid-Level and Above | 70 | [View](data/README.md#mid-level-and-above) |
| **Jobs total** | **109** | [View](data/README.md#jobs) |
| Hackathons | 2 | [View](data/README.md#hackathons) |
| Events | 14 | [View](data/README.md#events) |
| **Grand total** | **125** | [View](data/README.md) |

## How it works

1. **Fetch** — [scripts/fetch.py](scripts/fetch.py) pulls Remotive, ArbeitNow, and SimplifyJobs, filtered by the companies in [config/companies_allowlist.yml](config/companies_allowlist.yml). [scripts/public_sources.py](scripts/public_sources.py) widens coverage with Devpost, Luma, Greenhouse, and Lever (auto-discovered from those results), plus Ashby and SmartRecruiters for the companies listed in [config/extra_job_boards.yml](config/extra_job_boards.yml).
2. **Build** — [scripts/build_data_readme.py](scripts/build_data_readme.py) turns the raw JSON in [data/](data/) into the readable tables in this file and in [data/README.md](data/README.md).
3. **Publish** — a [GitHub Actions workflow](.github/workflows/daily-activity.yml) runs this pipeline hourly, opens a pull request with whatever changed, and auto-merges it. No manual steps.

Curious about a specific run? Check the [workflow runs](https://github.com/AhmedNassar7/tracker/actions/workflows/daily-activity.yml) or the day-by-day notes in [log/](log/).

## Want a job source added?

- **Track one more company** on a platform we already support (Ashby or SmartRecruiters) — add its board token to [config/extra_job_boards.yml](config/extra_job_boards.yml). Greenhouse and Lever companies need no config at all; they're picked up automatically the first time one of their postings shows up from another source.
- **Change which companies are accepted** — edit [config/companies_allowlist.yml](config/companies_allowlist.yml). Both of these are plain YAML lists, no coding required.
- **Add a brand-new job board/API** (like Remotive or SimplifyJobs) — this needs a short fetcher function in [scripts/fetch.py](scripts/fetch.py) or [scripts/public_sources.py](scripts/public_sources.py), since each API has its own shape.

Not comfortable writing YAML or Python? Open an issue with the company or board name and someone will add it.

## Career resources

Free, well-known resources people use alongside this list to prepare for software engineering interviews at FAANG and other top tech companies:

| Resource | What it's for |
|---|---|
| [NeetCode](https://neetcode.io/) | Coding interview problems organized by pattern, with free video explanations |
| [Grind75](https://www.grind75.com/) | A free, prioritized coding-interview study plan (the spiritual successor to Blind75) |
| [Tech Interview Handbook](https://www.techinterviewhandbook.org/) | Free guide covering resumes, behavioral questions, and interview strategy |
| [System Design Primer](https://github.com/donnemartin/system-design-primer) | The most-starred free guide to system design interviews |
| [Levels.fyi](https://www.levels.fyi/) | Crowdsourced compensation data to benchmark and negotiate offers |

## Repository layout

| Path | What's in it |
|---|---|
| [data/README.md](data/README.md) | The combined, human-readable table of every open opportunity |
| [data/](data/) | Raw JSON the tables are generated from |
| [config/companies_allowlist.yml](config/companies_allowlist.yml) | Which companies' listings are accepted |
| [config/extra_job_boards.yml](config/extra_job_boards.yml) | Ashby/SmartRecruiters companies to track |
| [scripts/](scripts/) | The fetch/build pipeline (Python) |
| [log/](log/) | One line per automated run, grouped by month |
| [tests/](tests/) | Automated tests for the pipeline scripts |

## Notes

- This README and [data/README.md](data/README.md) are generated files — edits should go through [scripts/build_data_readme.py](scripts/build_data_readme.py) so they survive the next automated run.
- Raw JSON stays separate from the Markdown views so either can be consumed independently.
