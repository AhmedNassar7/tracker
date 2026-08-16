# Deployment

[← back to project overview](../README.md) · [docs index](../README.md#documentation)

## How this project actually deploys

There is no hosting target, container, or server to deploy to. "Deployment" here means: **GitHub Actions runs the pipeline and commits its output straight back into this repository's `main` branch.** The published product — `README.md`, `data/README.md`, and the JSON files under `data/` — is the repo itself, browsable directly on GitHub. Anyone who wants the raw data can `fetch()` the JSON files from `raw.githubusercontent.com` or clone the repo; no API server is ever running.

`.nojekyll` at the repo root exists in preparation for a possible future GitHub Pages site served from `main`/root — without it, GitHub would run the whole repo through Jekyll before serving, which can mangle a future site's own `index.html`. No such site exists yet; today it has no effect on the data files, which are already served fine as-is.

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

Every step that writes to the repo runs with `set -euo pipefail` — any command failure aborts the job rather than silently continuing with partial data.

## Manual deploy steps

None. To force an out-of-schedule refresh, trigger `hourly-global-roles.yml` manually via **Actions → Hourly Global Tech Roles PR → Run workflow** (`workflow_dispatch`), or run the three pipeline scripts locally and push the diff yourself:

```bash
python scripts/fetch.py
python scripts/public_sources.py
python scripts/build_data_readme.py
git add -A
git commit -m "chore: manual refresh"
git push
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
