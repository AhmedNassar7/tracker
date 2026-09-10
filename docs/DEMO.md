# Demo Script

[← back to project overview](../README.md) · [docs index](../README.md#documentation)

For showing `tracker` to a recruiter, a contributor, or a "why does this exist" skeptic.

## Show first

Open the live [README.md](../README.md) on GitHub (not the code). The badges + "As of {date}" snapshot make the point: a live, self-updating feed. Then [data/README.md](../data/README.md) for the actual job table with working apply links.

## Step-by-step

| Step | Do | Point |
|---|---|---|
| 1 | Open `README.md` on GitHub | Every number/badge is script-generated, hourly, automatic |
| 2 | Point at the "Last updated" badge / `LAST_UPDATED` | Timestamp changes every run; so do the counts |
| 3 | Open [data/README.md](../data/README.md), scroll to a job row | Every row links to the real employer application page — no redirect, no aggregator |
| 4 | Open [Actions → Hourly Global Tech Roles PR](https://github.com/AhmedNassar7/tracker/actions/workflows/hourly-global-roles.yml) | Runs on GitHub Actions cron, no server. A green run either merged its own PR or found nothing changed — both correct |
| 5 | Open a recent merged PR from that workflow | Each PR = one hourly snapshot; PR history = a changelog of the job market |
| 6 | Open [scripts/fetch.py](../scripts/fetch.py) → `fetch_remotive` | Fetch a source, normalize, filter, done. Stdlib only — no framework, no DB |
| 7 | Open [config/companies_allowlist.yml](../config/companies_allowlist.yml) | Widen/narrow which companies show up by editing YAML — no code, picked up next run |
| 8 | Run the pipeline live (below) | Runs on your machine in under a minute, zero setup |

## Run it live

```bash
python scripts/fetch.py
python scripts/public_sources.py
python scripts/build_data_readme.py
```

For a fast, deterministic demo with no network, run `python tests/test_fetch.py` — its fixtures exercise five source formats in one run.

## Three things to highlight

1. **Zero infrastructure.** No DB, no server, no paid API, no `requirements.txt`. Backend = a cron job; frontend = a Markdown file.
2. **Self-healing dead-link handling.** `check_url_alive()` retries a `HEAD` 404 with `GET` before trusting it (ATS pages that mishandle `HEAD`, observed on Pinterest). Test: `tests/test_fetch.py` "confirms a HEAD 404 with a GET before trusting it".
3. **Auto-discovery, not hardcoding.** The public layer derives which Greenhouse/Lever/Workday boards to poll from companies the curated layer already found — coverage grows with the allowlist, zero config.

## Common questions

**Why not a database?** A flat JSON file in git *is* the database — free version history, free hosting, zero ops.

**How do you know a posting is still open?** Two checks per run: (1) apply URL still alive (`check_url_alive`, GET-confirmed before declaring dead), (2) posting still present in this run's fetch. Either failing archives it with a `closed_at` timestamp.

**What stops spam companies?** `config/companies_allowlist.yml` gates the curated layer. The public layer filters to real software-engineering titles via `is_software_job()`.

**Does it silently break?** CI runs the test suite on every pipeline change before merge; each hourly run is an inspectable Actions log plus (on change) a merged PR. A gap in that PR history is the signal.

**Can I add a company without Python?** Yes — `config/companies_allowlist.yml` and `config/extra_job_boards.yml` are plain YAML. A brand-new source needs a short fetcher; see [DEVELOPER-GUIDE.md](DEVELOPER-GUIDE.md#add-a-new-curated-job-board-source).
