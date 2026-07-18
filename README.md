# tracker

**A free, always-up-to-date list of software engineering jobs, internships, hackathons, and events — no sign-up, no paywall.**

A robot checks top companies and public job boards every hour, so you don't have to. Everything below is refreshed automatically.

[![Hourly Global Tech Roles PR](https://github.com/AhmedNassar7/tracker/actions/workflows/hourly-global-roles.yml/badge.svg)](https://github.com/AhmedNassar7/tracker/actions/workflows/hourly-global-roles.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![Total opportunities 420](https://img.shields.io/badge/Total%20opportunities-420-brightgreen.svg)](data/README.md) [![Jobs 410](https://img.shields.io/badge/Jobs-410-16a34a.svg)](data/README.md#jobs) [![Last updated 2026-07-18](https://img.shields.io/badge/Last%20updated-2026--07--18-grey.svg)](LAST_UPDATED)

[![Internship 62](https://img.shields.io/badge/Internship-62-22c55e.svg)](data/README.md#internship) [![Early Career 26](https://img.shields.io/badge/Early%20Career-26-0ea5e9.svg)](data/README.md#early-career) [![Mid-Level and Above 322](https://img.shields.io/badge/Mid--Level%20and%20Above-322-dc2626.svg)](data/README.md#mid-level-and-above) [![Hackathons 2](https://img.shields.io/badge/Hackathons-2-f59e0b.svg)](data/README.md#hackathons) [![Events 8](https://img.shields.io/badge/Events-8-8b5cf6.svg)](data/README.md#events)

## Contents

- [Start here](#start-here)
- [Snapshot](#snapshot)
- [Career resources](#career-resources)
- [How it works](#how-it-works)
- [Contributing](#contributing)
- [Repository layout](#repository-layout)
- [License](#license)

## Start here

### 👉 [**Open the full list of 420 opportunities**](data/README.md)

That page has everything: jobs, internships, hackathons, and events, each with a direct apply link. No account needed, just click and go.

## Snapshot

_As of 2026-07-18._

| Category | Count | Link |
|---|---:|---|
| Internship | 62 | [View](data/README.md#internship) |
| Early Career | 26 | [View](data/README.md#early-career) |
| Mid-Level and Above | 322 | [View](data/README.md#mid-level-and-above) |
| **Jobs total** | **410** | [View](data/README.md#jobs) |
| Hackathons | 2 | [View](data/README.md#hackathons) |
| Events | 8 | [View](data/README.md#events) |
| **Grand total** | **420** | [View](data/README.md) |

## Career resources

Free, well-known resources people use alongside this list to prepare for software engineering interviews at FAANG and other top tech companies:

| Resource | What it's for |
|---|---|
| [NeetCode](https://neetcode.io/) | Coding interview problems organized by pattern, with free video explanations |
| [Grind75](https://www.grind75.com/) | A free, prioritized coding-interview study plan (the spiritual successor to Blind75) |
| [Tech Interview Handbook](https://www.techinterviewhandbook.org/) | Free guide covering resumes, behavioral questions, and interview strategy |
| [System Design Primer](https://github.com/donnemartin/system-design-primer) | The most-starred free guide to system design interviews |
| [Levels.fyi](https://www.levels.fyi/) | Crowdsourced compensation data to benchmark and negotiate offers |

That's the five most-used ones. [**See the full resource catalog →**](data/resources.md) for mock interviews, resume tools, open-source fellowships, learning platforms, and more.

## How it works

1. **Fetch** — [scripts/fetch.py](scripts/fetch.py) pulls Remotive, ArbeitNow, SimplifyJobs, speedyapply, zapplyjobs, hanzili, and ambicuity, filtered by the companies in [config/companies_allowlist.yml](config/companies_allowlist.yml). [scripts/public_sources.py](scripts/public_sources.py) widens coverage with Devpost, Luma, Greenhouse, Lever, and Workday (all auto-discovered from those results), plus Ashby and SmartRecruiters for the companies listed in [config/extra_job_boards.yml](config/extra_job_boards.yml). Every apply link is checked before publishing, and dead ones are moved to the archive automatically.
2. **Build** — [scripts/build_data_readme.py](scripts/build_data_readme.py) turns the raw JSON in [data/](data/) into the readable tables in this file and in [data/README.md](data/README.md).
3. **Publish** — a [GitHub Actions workflow](.github/workflows/hourly-global-roles.yml) runs this pipeline hourly, opens a pull request with whatever changed, and auto-merges it. No manual steps.

Curious about a specific run? Check the [workflow runs](https://github.com/AhmedNassar7/tracker/actions/workflows/hourly-global-roles.yml) or the day-by-day notes in [log/](log/).

## Contributing

- **Track one more company** on a platform we already support (Ashby or SmartRecruiters) — add its board token to [config/extra_job_boards.yml](config/extra_job_boards.yml). Greenhouse, Lever, and Workday companies need no config at all; they're picked up automatically the first time one of their postings shows up from another source.
- **Change which companies are accepted** — edit [config/companies_allowlist.yml](config/companies_allowlist.yml). Both of these are plain YAML lists, no coding required.
- **Add a brand-new job board/API** (like Remotive or SimplifyJobs) — this needs a short fetcher function in [scripts/fetch.py](scripts/fetch.py) or [scripts/public_sources.py](scripts/public_sources.py), since each API has its own shape.

Not comfortable writing YAML or Python? Open an issue with the company or board name and someone will add it. Pull requests run through [CI](.github/workflows/ci.yml) automatically — the test suite (`python tests/test_fetch.py` and `python tests/test_public_sources.py`) needs to pass before merging.

## Repository layout

Job seekers only need [data/README.md](data/README.md). Everything else here is for anyone who wants to understand, run, or contribute to the pipeline that builds it:

| Path | What's in it |
|---|---|
| [data/README.md](data/README.md) | The combined, human-readable table of every open opportunity |
| [data/resources.md](data/resources.md) | Hand-curated career resources: coding practice, mock interviews, resume tools, and more |
| [data/](data/) | Raw JSON/Markdown the tables above are generated from — see [Source Files](data/README.md#source-files) |
| [config/companies_allowlist.yml](config/companies_allowlist.yml) | Which companies' listings are accepted (edit this, no coding required) |
| [config/extra_job_boards.yml](config/extra_job_boards.yml) | Ashby/SmartRecruiters companies to track (edit this, no coding required) |
| [config/sources.yml](config/sources.yml) | Reference docs for the APIs the pipeline calls — not read by the code itself |
| [config/job-entry.schema.json](config/job-entry.schema.json) | JSON Schema describing the shape of each job record, for anyone building on top of the data |
| [scripts/](scripts/) | The fetch/build pipeline (Python, standard library only — no dependencies to install) |
| [tests/](tests/) | Automated tests for the pipeline scripts, run in CI on every pull request |
| [.github/workflows/](.github/workflows/) | The hourly refresh job and the CI test job |
| [log/](log/) | One line per automated run, grouped by month — a history of when data was refreshed |

## License

[MIT](LICENSE) — free to use, fork, and self-host.

## Notes

- This README and [data/README.md](data/README.md) are generated files — edits should go through [scripts/build_data_readme.py](scripts/build_data_readme.py) so they survive the next automated run.
- Raw JSON stays separate from the Markdown views so either can be consumed independently.
