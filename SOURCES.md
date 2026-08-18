# Data Sources

Every website, repo, and API `tracker`'s pipeline pulls from, with links. This is a hand-maintained reference — it isn't rebuilt by the hourly pipeline, so update it by hand (see [CONTRIBUTING.md](CONTRIBUTING.md)) whenever a fetcher is added or removed. For what the pipeline *outputs*, see [data/README.md](data/README.md); for career-prep resources aimed at job seekers (not pipeline inputs), see [data/resources.md](data/resources.md).

## Curated layer (`scripts/fetch.py`)

Every row from these sources is checked against [config/companies_allowlist.yml](config/companies_allowlist.yml) (case-insensitive substring match) before publishing.

| Source | Link | What it is |
|---|---|---|
| Remotive | [API](https://remotive.com/api/remote-jobs?category=software-dev) · [site](https://remotive.com/) | Free public API for remote software jobs |
| ArbeitNow | [API](https://arbeitnow.com/api/job-board-api) · [site](https://arbeitnow.com/) | Free public job-board API, strong EU/remote coverage |
| SimplifyJobs — Internships | [repo](https://github.com/SimplifyJobs/Summer2026-Internships) | The most-used community internship tracker on GitHub |
| SimplifyJobs — New Grad | [repo](https://github.com/SimplifyJobs/New-Grad-Positions) | Its new-grad counterpart |
| speedyapply — SWE | [repo](https://github.com/speedyapply/2027-SWE-College-Jobs) | Community new-grad/intern SWE tracker |
| speedyapply — AI | [repo](https://github.com/speedyapply/2027-AI-College-Jobs) | Same tracker family, AI/ML-focused |
| vanshb03 — Summer Internships | [repo](https://github.com/vanshb03/Summer2027-Internships) | One of the most-starred internship trackers on GitHub |
| vanshb03 — New Grad | [repo](https://github.com/vanshb03/New-Grad-2027) | Its new-grad counterpart |
| zapplyjobs — New Grad SWE | [repo](https://github.com/zapplyjobs/New-Grad-Software-Engineering-Jobs-2027) | Software-engineering-specific new-grad board |
| zapplyjobs — New Grad (all disciplines) | [repo](https://github.com/zapplyjobs/New-Grad-Jobs-2027) | Broader new-grad board, not limited to SWE |
| zapplyjobs — Internships | [repo](https://github.com/zapplyjobs/Internships-2027) | General internship board |
| zapplyjobs — Data Science | [repo](https://github.com/zapplyjobs/New-Grad-Data-Science-Jobs-2027) | Data science / ML new-grad board |
| zapplyjobs — Canada Jobs | [repo](https://github.com/zapplyjobs/Canada-Jobs-2027) | Canada-focused new-grad board |
| zapplyjobs — Canada Internships | [repo](https://github.com/zapplyjobs/Canada-Internships-2027) | Canada-focused internship board |
| hanzili | [repo](https://github.com/hanzili/canada_sde_junior_new_grad_position) | Canada SDE junior/new-grad tracker |
| ambicuity | [JSON feed](https://jobs.riteshrana.engineer/jobs.json) · [repo](https://github.com/ambicuity/New-Grad-Jobs) | New-grad job list backed by a live JSON API (not README-scraped) |
| LorenzoLaCorte — European Tech | [repo](https://github.com/LorenzoLaCorte/european-tech-internships-2026) | Dedicated Europe internship/new-grad/PhD tracker, added to widen EMEA coverage beyond ArbeitNow. Apply links point at the original LinkedIn posting |
| Amazon (direct) | [API](https://www.amazon.jobs/en/search.json?base_query=software+development+engineer) · [site](https://www.amazon.jobs/) | Amazon's own careers search API, hit directly rather than only through third-party trackers — verified free, keyless, real structured JSON. Every apply link points straight at `amazon.jobs`, with no third-party staleness risk |
| Netflix (direct) | [API](https://netflix.eightfold.ai/api/apply/v2/jobs?domain=netflix.com) · [site](https://explore.jobs.netflix.net/careers) | Netflix's own Eightfold-hosted careers API, hit directly — verified free, keyless, real structured JSON, 500 open roles total. Netflix's own numbered-grade title convention ("Software Engineer 4/5/6") mostly falls outside this project's internship–mid-level scope, so this currently surfaces few rows day to day — real reflection of Netflix's senior-skewed hiring, not a fetcher bug |

## Public layer (`scripts/public_sources.py`)

Widens coverage beyond the allowlist-gated curated layer.

| Source | Link | How it's included |
|---|---|---|
| Greenhouse | [boards-api.greenhouse.io](https://boards-api.greenhouse.io/) | Auto-discovered — a company's board gets polled directly once one of its postings shows up via any other source — **plus 35 companies hand-seeded** in [config/extra_job_boards.yml](config/extra_job_boards.yml)'s `greenhouse:` section (verified live 2026-08-18: real, non-empty boards for allowlisted companies — LinkedIn, Datadog, Databricks, MongoDB, Elastic, Twilio, Stripe, Okta, Figma, Dropbox, Asana, Anthropic, DeepMind, Scale AI, N26, Lyft, Airbnb, Jane Street, Coupang, Baidu, PhonePe, Jumia, Block, Robinhood, Instacart, Pinterest, Reddit, Roblox, Epic Games, Discord, Duolingo, Webflow, Cloudflare, SpaceX, Coinbase, Careem — that had never been auto-discovered because none of them ever happened to appear in another curated source first) |
| Lever | [api.lever.co](https://api.lever.co/) | Auto-discovered, same mechanism as Greenhouse — plus 4 hand-seeded companies (Spotify, Palantir, Paytm, dLocal), same discipline |
| Workday | CXS API (per-tenant, no single URL) | Auto-discovered, same mechanism as Greenhouse |
| Ashby | [api.ashbyhq.com](https://api.ashbyhq.com/) | Listed by hand in [config/extra_job_boards.yml](config/extra_job_boards.yml) — verify a token with `curl https://api.ashbyhq.com/posting-api/job-board/<token>` before adding. Includes Snowflake and Thndr (Cairo, Egypt), verified live 2026-08-18 |
| SmartRecruiters | [api.smartrecruiters.com](https://api.smartrecruiters.com/) | Listed by hand in [config/extra_job_boards.yml](config/extra_job_boards.yml) — the API can't confirm a slug is valid, so only add ones verified out-of-band |
| Devpost | [devpost.com/api/hackathons](https://devpost.com/api/hackathons) · [site](https://devpost.com/hackathons) | Devpost's own JSON API (the hackathons page itself is client-rendered) |
| Unstop | [API](https://unstop.com/api/public/opportunity/search-result?opportunity=hackathons) · [site](https://unstop.com/hackathons) | Free, keyless, paginated JSON API — 6,000+ hackathons at time of adding, filtered to `oppstatus=recruiting` (still accepting registrations). Complements Devpost rather than duplicating it |
| Devfolio | [API](https://api.devfolio.co/api/hackathons) · [site](https://devfolio.co/hackathons) | Free, keyless JSON API, strong for Web3/student hackathons Devpost under-covers. Filtered client-side to events whose `ends_at` hasn't passed yet, since the API has no separate "still open" flag |
| Luma | [luma.com/discover](https://luma.com/discover) | Filtered for tech/software relevance — Luma's discover page is a general community directory, not tech-specific |

## Considered, not added

- **workopia/UK-Graduate-Jobs** and its sibling country repos (France, Germany, Spain, Netherlands, etc.) — a large, actively-updated family of graduate-job trackers. Skipped because their apply links point at Workopia's own site (an intermediary/lead-gen page), not the employer's original posting, which breaks this repo's "every row links straight to the real application page" rule — and the table is HTML, not a plain pipe-table, so it wouldn't reuse the existing generic parser.

## Notes

- Config-file changes (`companies_allowlist.yml`, `extra_job_boards.yml`) don't need a new row here — this file tracks *where the data comes from*, not which companies are accepted.
- If a fetcher is added or removed in `scripts/fetch.py` or `scripts/public_sources.py`, update this file and the "How it works" section in [CONTRIBUTING.md](CONTRIBUTING.md) in the same change.
