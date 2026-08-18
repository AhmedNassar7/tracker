# Deployment

[← back to project overview](../README.md) · [docs index](../README.md#documentation)

## How this project actually deploys

Two independent, decoupled deploys live in this repo — the data pipeline (unchanged from day one) and a real, live website (shipped since; see [site/](../site/)).

**The data pipeline**: "deployment" means GitHub Actions runs the pipeline and commits its output straight back into `main`. The published product — `README.md`, `data/README.md`, and the JSON/XML files under `data/` — is the repo itself, browsable directly on GitHub. Anyone who wants the raw data can `fetch()` it from `raw.githubusercontent.com`/jsDelivr or clone the repo; no API server is ever running for this half.

**The website**: a real static site (Astro + React islands + Tailwind) lives in `site/`, live at **[ahmednassar7.github.io/tracker](https://ahmednassar7.github.io/tracker/)**. It deploys independently of the hourly data commits — its own `deploy-site.yml` workflow only triggers on a push to `site/**`, not on every hourly data refresh. The site never bundles data at build time; it `fetch()`s `data/site-index.json` (and `data/stats-history.json`, and the RSS feeds under `data/feeds/`) at runtime from jsDelivr, with `raw.githubusercontent.com` as a fallback — so a visitor always sees data that's at most ~1 hour stale without the site itself needing to redeploy every hour. `.nojekyll` at the repo root is what makes this possible at all: without it, GitHub runs the whole repo through Jekyll before serving, which would mangle the site's own `index.html`.

## Every GitHub Actions workflow

### `ci.yml` — test gate

| | |
|---|---|
| **Triggers** | `pull_request` (any target), `push` to `main` |
| **Permissions** | `contents: read` |
| **Runner** | `ubuntu-latest`, 10-minute timeout |

Steps:
1. Checkout (`actions/checkout@v4`)
2. Set up Python 3.11 (`actions/setup-python@v5`)
3. Run `python3 tests/test_net.py`
4. Run `python3 tests/test_fetch.py`
5. Run `python3 tests/test_public_sources.py`
6. Run `python3 tests/test_schema_validation.py`
7. Run `python3 tests/test_site_index.py`
8. Run `python3 tests/test_stats_history.py`
9. Run `python3 tests/test_rss_feeds.py`

Any test file exiting nonzero fails the job. This is the only gate before a PR can merge — there's no separate lint/typecheck/build step because there's nothing to build.

### `hourly-global-roles.yml` — the pipeline itself

| | |
|---|---|
| **Triggers** | `schedule: cron "15 * * * *"` (every hour, 15 minutes past), `workflow_dispatch` (manual) |
| **Permissions** | `contents: write`, `pull-requests: write` |
| **Concurrency** | group `frequent-global-tech-roles`, `cancel-in-progress: false` (a slow run is never killed by the next scheduled tick — it just queues) |
| **Runner** | `ubuntu-latest`, 25-minute timeout |

Steps:
1. Checkout
2. Set up Python 3.11
3. `mkdir -p data/raw && python3 scripts/fetch.py`
4. `python3 scripts/public_sources.py`
5. `python3 scripts/build_data_readme.py`
6. Write `LAST_UPDATED` — `date -u` formatted as `YYYY-MM-DD HH:MM:SS UTC`
7. `peter-evans/create-pull-request@v6` — stages any changed/untracked files, opens a PR from branch `frequent/global-roles-<run_id>` with a fixed title/body/author, labeled `automated`, only if something actually changed (the action itself is a no-op when the working tree is clean, which happens often thanks to the change-only write logic in `fetch_outputs.py`)
8. If a PR was opened (`steps.cpr.outputs.pull-request-number != ''`): `gh pr merge <number> --squash --delete-branch`
9. If a PR was opened: purge jsDelivr's CDN cache for `data/site-index.json`, `data/stats-history.json`, and all five `data/feeds/*.xml` files via `purge.jsdelivr.net/gh/AhmedNassar7/tracker@main/<path>`. Best-effort (`|| true` per call) — the site's own `dataSource.ts` tries jsDelivr first and only falls back to `raw.githubusercontent.com` on outright failure, not staleness, so without this a visitor could see up to jsDelivr's own cache TTL of stale data after a real merge (confirmed live: ~2.5 hours once, before this step existed)

Every step that writes to the repo runs with `set -euo pipefail` — any command failure aborts the job rather than silently continuing with partial data.

### `deploy-site.yml` — the website

| | |
|---|---|
| **Triggers** | `push` to `main` touching `site/**` or the workflow file itself, `workflow_dispatch` |
| **Permissions** | `contents: read`, `pages: write`, `id-token: write` |
| **Concurrency** | group `pages`, `cancel-in-progress: true` (a newer push wins over an in-flight older deploy) |
| **Runner** | `ubuntu-latest`, two jobs: `build` then `deploy` |

Steps (`build` job, working directory `site/`):
1. Checkout
2. Set up Node 22 with npm cache keyed on `site/package-lock.json`
3. `npm ci`
4. `npm run build` (Astro outputs to `site/dist`)
5. `actions/upload-pages-artifact@v3` with `path: site/dist`

Then the `deploy` job runs `actions/deploy-pages@v4` against that artifact. This workflow never touches the hourly data commits and vice versa — a `site/` code change redeploys the site without waiting for the next hourly tick, and an hourly data commit never triggers a site rebuild (the site fetches fresh data at runtime instead; see the section above).

## Manual deploy steps

**Data pipeline**: none needed. To force an out-of-schedule refresh, trigger `hourly-global-roles.yml` manually via **Actions → Hourly Global Tech Roles PR → Run workflow** (`workflow_dispatch`), or run the three pipeline scripts locally and push the diff yourself:

```bash
python scripts/fetch.py
python scripts/public_sources.py
python scripts/build_data_readme.py
git add -A
git commit -m "chore: manual refresh"
git push
```

**Site**: also none needed under normal use — pushing a `site/**` change to `main` deploys automatically. To force a redeploy without a code change, trigger `deploy-site.yml` manually via **Actions → Deploy site → Run workflow**. To build and preview locally first:

```bash
cd site
npm ci
npm run dev    # local dev server, reads a gitignored dev-fallback data snapshot from site/public/
npm run build  # production build to site/dist
```

## Environment variables / secrets needed in production

| Name | Used by | Purpose |
|---|---|---|
| `secrets.PAT_TOKEN` | `hourly-global-roles.yml` (both the `create-pull-request` step and the `gh pr merge` step) | A personal access token with `contents: write` + `pull-requests: write` scope. Needed instead of the default `GITHUB_TOKEN` because a PR opened with the default token can't trigger downstream workflow runs / auto-merge reliably under branch protection in this repo's setup |

No other secrets, API keys, or environment variables exist — every external source in [DATA.md](DATA.md) is a keyless public API.

## How to verify it worked

- **After a manual `workflow_dispatch` run**: check the [Actions tab](https://github.com/AhmedNassar7/tracker/actions/workflows/hourly-global-roles.yml) for the run's status; a green run either opened+merged a PR (data changed) or completed with no PR (nothing changed — also success).
- **After a merge**: `LAST_UPDATED` at the repo root and the "Last updated" badge on `README.md` should show a recent UTC timestamp.
- **Data sanity check**: `data/stats.json`'s `generated_at` timestamp should match the latest merged PR's merge time; `data/README.md`'s job counts should match the badges on the root `README.md` (both are rendered from the same `stats` dict in the same `build_data_readme.py` run, so a mismatch signals a partial/stale regeneration).
- **PR history as changelog**: every merged `chore: global tech roles` PR in the repo's closed-PR list corresponds to one hourly run that changed something — a gap longer than ~2 hours in that history signals the cron stopped firing or a run has been failing.
- **Site is live and current**: check [ahmednassar7.github.io/tracker](https://ahmednassar7.github.io/tracker/) directly — the "data as of" line near the top should be within the last hour or two. If it's noticeably older than that while the data pipeline itself looks healthy by the checks above, suspect jsDelivr CDN staleness (see the purge step in `hourly-global-roles.yml` above) before suspecting the site itself; confirm by comparing against `https://raw.githubusercontent.com/AhmedNassar7/tracker/main/data/site-index.json`'s `generated_at` directly, which is never cached.
- **Site deploy succeeded**: check the [deploy-site.yml Actions tab](https://github.com/AhmedNassar7/tracker/actions/workflows/deploy-site.yml) — it only runs on a `site/**` push, so "no runs since your last site change" means the trigger didn't fire, not that it's still running.
