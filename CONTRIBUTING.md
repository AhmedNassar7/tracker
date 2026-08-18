# Contributing to tracker

This file is for anyone who wants to understand, run, or extend the pipeline behind [the job list](data/README.md). If you're just here to find a job, you don't need any of this — head back to [README.md](README.md).

## How it works

1. **Fetch** — `scripts/fetch.py` pulls Remotive, ArbeitNow, SimplifyJobs, speedyapply, vanshb03, zapplyjobs, hanzili, ambicuity, LorenzoLaCorte's European tracker, and Amazon's own careers API directly, filtered by the companies in `config/companies_allowlist.yml`. `scripts/public_sources.py` widens coverage with Devpost, Unstop, Devfolio, Luma, Greenhouse, Lever, and Workday (all auto-discovered from those results), plus Ashby and SmartRecruiters for the companies listed in `config/extra_job_boards.yml`. Every apply link is checked before publishing, and dead ones are moved to the archive automatically. Every published row is also checked against `config/job-entry.schema.json` / `config/public-entry.schema.json` before being written — a shape drift fails the run instead of silently shipping bad data. See [SOURCES.md](SOURCES.md) for the full list with links.
2. **Build** — `scripts/build_data_readme.py` turns the raw JSON in `data/` into the readable tables in `README.md` and `data/README.md`, and also writes `data/site-index.json`, a flattened, checksummed view of both feeds for anything (a future site, a script) that wants the whole list as one small file instead of parsing both `jobs-global.json` and `public-opportunities.json` separately. It also appends one snapshot per run to `data/stats-history.json` (capped to the last 90 days) — a free trend line built forward hourly rather than reconstructed by scraping this repo's git history from a browser — and (via `scripts/rss_feeds.py`) renders five preset RSS feeds to `data/feeds/*.xml` (all jobs, internships, new grad, hackathons, events). These are fixed presets rather than arbitrary saved filters, since generating truly arbitrary filtered XML on demand would need a server this project deliberately doesn't have.
3. **Publish** — a [GitHub Actions workflow](.github/workflows/hourly-global-roles.yml) runs this pipeline hourly, opens a pull request with whatever changed, and auto-merges it. No manual steps.

Curious about a specific run? Check the [workflow runs](https://github.com/AhmedNassar7/tracker/actions/workflows/hourly-global-roles.yml) — every run that changes anything opens and merges its own PR, so the merged-PR history doubles as a changelog.

## Ways to contribute

- **Track one more company** on a platform we already support (Ashby or SmartRecruiters) — add its board token to `config/extra_job_boards.yml`. Greenhouse, Lever, and Workday companies need no config at all; they're picked up automatically the first time one of their postings shows up from another source.
- **Change which companies are accepted** — edit `config/companies_allowlist.yml`. Both of these are plain YAML lists, no coding required.
- **Add a brand-new job board/API** (like Remotive or SimplifyJobs) — this needs a short fetcher function in `scripts/fetch.py` or `scripts/public_sources.py`, since each API has its own shape. Check whether the source has a JSON API before writing an HTML scraper — several sources that look like plain GitHub READMEs actually have one (see `scripts/fetch.py`'s `ambicuity` fetcher for an example).

Not comfortable writing YAML or Python? Open an issue with the company or board name and someone will add it.

## Running it locally

No dependencies to install — everything is Python standard library (3.11+).

```bash
python scripts/fetch.py              # curated sources -> data/jobs-global*.json
python scripts/public_sources.py     # public board sources -> data/public-opportunities.json
python scripts/build_data_readme.py  # renders README.md and data/README.md from the JSON above

python tests/test_net.py
python tests/test_fetch.py
python tests/test_public_sources.py
python tests/test_schema_validation.py
python tests/test_site_index.py
python tests/test_stats_history.py
python tests/test_rss_feeds.py
```

Pull requests run through [CI](.github/workflows/ci.yml) automatically — every test file needs to pass before merging.

## Repository layout

| Path | What's in it |
|---|---|
| [data/README.md](data/README.md) | The combined, human-readable table of every open opportunity |
| [SOURCES.md](SOURCES.md) | Every website/repo/API the pipeline pulls from, with links |
| [data/resources.md](data/resources.md) | Hand-curated career resources: coding practice, mock interviews, resume tools, and more |
| [data/](data/) | Raw JSON the tables above are generated from — see [Source Files](data/README.md#source-files) |
| [config/companies_allowlist.yml](config/companies_allowlist.yml) | Which companies' listings are accepted (edit this, no coding required) |
| [config/extra_job_boards.yml](config/extra_job_boards.yml) | Ashby/SmartRecruiters companies to track (edit this, no coding required) |
| [config/job-entry.schema.json](config/job-entry.schema.json) | JSON Schema for each record in `data/jobs-global.json` / `jobs-global-archive.json` |
| [config/public-entry.schema.json](config/public-entry.schema.json) | JSON Schema for each record in `data/public-opportunities.json` (jobs/hackathons/events share one shape, disambiguated by `kind`) |
| [config/site-index.schema.json](config/site-index.schema.json) | JSON Schema for each item in `data/site-index.json`, the flattened combined view of both feeds |
| [config/stats-history.schema.json](config/stats-history.schema.json) | JSON Schema for each snapshot in `data/stats-history.json`, the rolling per-run trend history |
| [scripts/](scripts/) | The fetch/build pipeline (Python, standard library only) |
| [tests/](tests/) | Automated tests for the pipeline scripts, run in CI on every pull request |
| [.github/workflows/](.github/workflows/) | The hourly refresh job (`hourly-global-roles.yml`) and the CI test job (`ci.yml`) |

## Notes

- `README.md` and `data/README.md` are generated files — edits should go through `scripts/build_data_readme.py` so they survive the next automated run.
- `data/resources.md`, `SOURCES.md`, and this file are hand-maintained, not touched by the pipeline.
- `.nojekyll` at the repo root is prep for a future GitHub Pages site published from `main` / root: without it, GitHub runs the whole repo through Jekyll before serving, which can mangle the site's own `index.html` and is unnecessary since this repo has no Jekyll config. The data JSON stays reachable at its normal path either way, so the site (once built) can `fetch()` it directly, same-origin, with zero duplication.
