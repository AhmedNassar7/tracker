# Deployment

[← back to project overview](../README.md) · [docs index](../README.md#documentation)

## Two independent deploys

**Data pipeline**: GitHub Actions runs the pipeline and commits output straight into `main`. The product — `README.md`, `data/README.md`, `data/*` — is the repo, browsable on GitHub. No API server.

**Website**: static site (Astro + React islands + Tailwind) in `site/`, live at **[ahmednassar7.github.io/tracker](https://ahmednassar7.github.io/tracker/)**. Its `deploy-site.yml` triggers only on a push to `site/**`, not on hourly data refreshes. It never bundles data — it `fetch()`s `data/site-index.json` (+ `stats-history.json`, `data/feeds/`) at runtime from jsDelivr, falling back to `raw.githubusercontent.com`, so a visitor sees data ≤1h stale with no redeploy. `.nojekyll` at the repo root is required — without it GitHub runs the repo through Jekyll and mangles the site's `index.html`.

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
7. `peter-evans/create-pull-request@v6` — stages changed/untracked files, opens a PR from `frequent/global-roles-<run_id>` (fixed title/body/author, label `automated`), only if something changed (no-op on a clean tree)
8. If a PR opened (`steps.cpr.outputs.pull-request-number != ''`): `gh pr merge <number> --squash --delete-branch`
9. If a PR opened: purge jsDelivr's CDN cache for `data/site-index.json`, `data/stats-history.json`, and the five `data/feeds/*.xml` via `purge.jsdelivr.net/gh/AhmedNassar7/tracker@main/<path>`. Best-effort (`|| true`) — `dataSource.ts` falls back to `raw.githubusercontent.com` only on failure, not staleness, so without this a visitor sees stale data up to jsDelivr's TTL (~2.5h observed once)

Every repo-writing step runs `set -euo pipefail` — a command failure aborts the job.

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

Then the `deploy` job runs `actions/deploy-pages@v4`. This workflow and the hourly data commits never trigger each other.

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
| `secrets.PAT_TOKEN` | `hourly-global-roles.yml` (`create-pull-request` + `gh pr merge`) | PAT with `contents: write` + `pull-requests: write`. Needed instead of `GITHUB_TOKEN` because a PR opened with the default token can't trigger downstream runs / auto-merge under branch protection here |

No other secrets or env vars — every source in [DATA.md](DATA.md) is a keyless public API.

## Verify it worked

- **After a `workflow_dispatch` run**: [Actions tab](https://github.com/AhmedNassar7/tracker/actions/workflows/hourly-global-roles.yml) — a green run either merged a PR (data changed) or had no PR (nothing changed).
- **After a merge**: `LAST_UPDATED` and the "Last updated" badge show a recent UTC timestamp.
- **Data sanity**: `data/stats.json` `generated_at` matches the latest merge time; `data/README.md` counts match the root `README.md` badges (same `stats` dict, same run — a mismatch = partial regeneration).
- **PR history**: a gap >~2h in the merged `chore: global tech roles` PRs = the cron stopped or a run is failing.
- **Site current**: the "data as of" line on the live site should be within ~1–2h. If it's older while the pipeline looks healthy, suspect jsDelivr staleness (step 9 above); confirm against `raw.githubusercontent.com/AhmedNassar7/tracker/main/data/site-index.json` `generated_at` (never cached).
- **Site deploy**: [deploy-site.yml Actions tab](https://github.com/AhmedNassar7/tracker/actions/workflows/deploy-site.yml) — runs only on a `site/**` push.
