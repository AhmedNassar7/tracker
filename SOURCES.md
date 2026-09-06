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
| PinpointHQ | `<host>/postings.json` (per-tenant) | Listed by hand in [config/extra_job_boards.yml](config/extra_job_boards.yml)'s `pinpoint:` section — a bare token is a `<token>.pinpointhq.com` subdomain, a token with a dot is a custom careers host. Added the MENA push's Pinpoint tenants: **Tabby** (Dubai/Riyadh BNPL, 44 postings) and **Money Fellows** (`careers.moneyfellows.com`, Cairo). Verify with `python scripts/verify_extra_boards.py pinpoint:<token>` (or `--dump` for its JSON shape) |
| Devpost | [devpost.com/api/hackathons](https://devpost.com/api/hackathons) · [site](https://devpost.com/hackathons) | Devpost's own JSON API (the hackathons page itself is client-rendered) |
| Unstop | [API](https://unstop.com/api/public/opportunity/search-result?opportunity=hackathons) · [site](https://unstop.com/hackathons) | Free, keyless, paginated JSON API — 6,000+ hackathons at time of adding, filtered to `oppstatus=recruiting` (still accepting registrations). Complements Devpost rather than duplicating it |
| Devfolio | [API](https://api.devfolio.co/api/hackathons) · [site](https://devfolio.co/hackathons) | Free, keyless JSON API, strong for Web3/student hackathons Devpost under-covers. Filtered client-side to events whose `ends_at` hasn't passed yet, since the API has no separate "still open" flag |
| Luma | [luma.com/discover](https://luma.com/discover) | Filtered for tech/software relevance — Luma's discover page is a general community directory, not tech-specific |
| Curated events | [config/events.yml](config/events.yml) | Hand-maintained list of tech/career events (conferences, summits, career fairs — Techne Summit, RiseUp, GITEX, LEAP, STEP, Web Summit, …) that no pollable API covers. One line each: `Name \| Organizer \| City, Country \| YYYY-MM-DD \| URL`. Past-dated rows drop out automatically |

## Considered, not added

- **workopia/UK-Graduate-Jobs** and its sibling country repos (France, Germany, Spain, Netherlands, etc.) — a large, actively-updated family of graduate-job trackers. Skipped because their apply links point at Workopia's own site (an intermediary/lead-gen page), not the employer's original posting, which breaks this repo's "every row links straight to the real application page" rule — and the table is HTML, not a plain pipe-table, so it wouldn't reuse the existing generic parser.
- **jobright-ai/2026-Software-Engineer-New-Grad** — actively maintained, but every apply link routes through `jobright.ai/jobs/info/<id>?utm_campaign=…` (its own tracking redirect), not the employer's page — same rule as workopia. Also caps its list to "the last 7 days" and pushes users to a paid Airtable link for the rest.
- **Non-standard ATSes surfaced by the MENA push** — the region's employers cluster on ATSes the pipeline didn't originally read. Each has a public keyless JSON API and follows the same pattern as the existing fetchers; `scripts/verify_extra_boards.py` already has a checker for each (`platform:token`), so verify the endpoint shape (`--dump platform:token`) before building:
  - **PinpointHQ** — `{company}.pinpointhq.com/postings.json` (or a custom domain like `careers.moneyfellows.com`). **Built 2026-09-06** (`fetch_pinpoint_jobs` in `public_sources.py`) — now a supported public-layer source, see the table above. First tenants: **Tabby** (`tabby.pinpointhq.com`, 44 postings incl. "Senior Fullstack Engineer"), **Money Fellows** (`careers.moneyfellows.com`, 8, Cairo).
  - **Workable** — `apply.workable.com/api/v3/accounts/{sub}/jobs`. The Egyptian startup scene (Elmenus, Breadfast, Rabbit, …) is mostly here. Not built yet (Lane M3).
  - **BambooHR** — `{company}.bamboohr.com/careers/list` (`{"result": […]}`). Seen: **Instabug / "Luciq"** (`instabug.bamboohr.com`, ✓ but only 1 non-software opening at check time). Not built yet (Lane M3).
  - **Recruitee** — `{company}.recruitee.com/api/offers/` (`{"offers": […]}`). Seen: **MoneyHash** (`moneyhash.recruitee.com`, valid board, 0 open when checked). Not built yet (Lane M3).
  Added so far via routes we *do* support: **Tabby** & **Money Fellows** (`pinpoint:`), **Mercor** (`ashby:mercor`, 96 jobs — San Francisco, **not** MENA), **Bosta** (`lever:Bosta`, Cairo).
- **LinkedIn company job pages** (`linkedin.com/company/<x>/jobs`) — enumerating a company's jobs from LinkedIn means scraping against its bot protection at volume, which this repo's "respect source terms" rule forbids (LinkedIn is used *only* via its unauthenticated guest job-posting endpoint, read-only, one id at a time, for the closed-link check in `scripts/net.py`). It's also unnecessary: a company's LinkedIn listings are cross-posts of its own ATS board — so fetching the Greenhouse/Lever/Ashby/Workday board (or an `aggregate_links.yml` row for a bespoke careers site) gets the same roles from a keyless, allowed source. The tell for which ATS: the "Powered by …" line in the company careers page footer.
- **vanshb03/{Summer2027-Internships, New-Grad-2027}** — *was* a source; **removed 2026-09-06**. In practice it was the single biggest contributor of dead / "job not found" links: its rows skew heavily toward soft-404-prone hosts (joinbytedance.com, jobs.apple.com, metacareers.com, iCIMS), its Amazon links carried job ids ~3,000,000 (years stale — current ids are ~10,500,000), and every Microsoft row pointed at one generic `apply.careers.microsoft.com/careers?query=intern…` search URL rather than a real posting. Everything it covered is already pulled fresher from a live source (Amazon via its own API; Adobe/Roblox/Stripe/Duolingo/Pinterest via their Greenhouse/Ashby/Workday boards; Google/Meta/Apple/Microsoft via `config/aggregate_links.yml` + SimplifyJobs).

## Notes

- Config-file changes (`companies_allowlist.yml`, `extra_job_boards.yml`) don't need a new row here — this file tracks *where the data comes from*, not which companies are accepted.
- If a fetcher is added or removed in `scripts/fetch.py` or `scripts/public_sources.py`, update this file and the "How it works" section in [CONTRIBUTING.md](CONTRIBUTING.md) in the same change.
