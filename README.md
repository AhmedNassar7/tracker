<p align="center"><img src="site/public/favicon.svg" width="72" height="72" alt="tracker logo"></p>

<h1 align="center">tracker</h1>

<p align="center"><i>Software engineering jobs, internships, hackathons, and events — free, updated hourly.</i></p>

[![Hourly Global Tech Roles PR](https://github.com/AhmedNassar7/tracker/actions/workflows/hourly-global-roles.yml/badge.svg)](https://github.com/AhmedNassar7/tracker/actions/workflows/hourly-global-roles.yml) [![CI](https://github.com/AhmedNassar7/tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/AhmedNassar7/tracker/actions/workflows/ci.yml) [![Deploy site](https://github.com/AhmedNassar7/tracker/actions/workflows/deploy-site.yml/badge.svg)](https://github.com/AhmedNassar7/tracker/actions/workflows/deploy-site.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![Total opportunities 4331](https://img.shields.io/badge/Total%20opportunities-4331-brightgreen.svg)](data/README.md) [![Jobs 4020](https://img.shields.io/badge/Jobs-4020-16a34a.svg)](data/README.md#jobs) [![Last updated 2026-09-15](https://img.shields.io/badge/Last%20updated-2026--09--15-grey.svg)](LAST_UPDATED)

[![Internship 256](https://img.shields.io/badge/Internship-256-22c55e.svg)](data/README.md#internship) [![Early Career 84](https://img.shields.io/badge/Early%20Career-84-0ea5e9.svg)](data/README.md#early-career) [![Mid-Level and Above 3680](https://img.shields.io/badge/Mid--Level%20and%20Above-3680-dc2626.svg)](data/README.md#mid-level-and-above) [![Hackathons 94](https://img.shields.io/badge/Hackathons-94-f59e0b.svg)](data/README.md#hackathons) [![Events 217](https://img.shields.io/badge/Events-217-8b5cf6.svg)](data/README.md#events)

[![Python 3.11+](https://img.shields.io/badge/Python-3.11%2B-3776AB.svg?logo=python&logoColor=white)](scripts/) [![stdlib only](https://img.shields.io/badge/dependencies-stdlib%20only-informational.svg)](CLAUDE.md) [![Astro site](https://img.shields.io/badge/site-Astro%20%2B%20React-ff5d01.svg?logo=astro&logoColor=white)](site/)

### 👉 [**Open the full list of 4331 opportunities**](data/README.md)

That page has everything: jobs, internships, hackathons, and events, each with a direct apply link. No account needed, just click and go.

## Snapshot

_As of 2026-09-15._

| Category | Count | Link |
|---|---:|---|
| Internship | 256 | [View](data/README.md#internship) |
| Early Career | 84 | [View](data/README.md#early-career) |
| Mid-Level and Above | 3680 | [View](data/README.md#mid-level-and-above) |
| **Jobs total** | **4020** | [View](data/README.md#jobs) |
| Hackathons | 94 | [View](data/README.md#hackathons) |
| Events | 217 | [View](data/README.md#events) |
| **Grand total** | **4331** | [View](data/README.md) |

## Features

<table>
<tr>
<td align="center">⏰<br><b>Hourly</b><br><sub>auto-refresh</sub></td>
<td align="center">🔗<br><b>15+ sources</b><br><sub>boards &amp; ATS APIs</sub></td>
<td align="center">✅<br><b>Curated allowlist</b><br><sub>top-tier companies</sub></td>
<td align="center">🩺<br><b>Dead-link checks</b><br><sub>GET-verified</sub></td>
</tr>
<tr>
<td align="center">📡<br><b>11 RSS feeds</b><br><sub>region &amp; category</sub></td>
<td align="center">📊<br><b>90-day trends</b><br><sub>stats-history.json</sub></td>
<td align="center">🌐<br><b>Web app</b><br><sub>search &amp; bookmarks</sub></td>
<td align="center">🆓<br><b>Zero cost</b><br><sub>stdlib + free APIs</sub></td>
</tr>
</table>

## Why

- **No database, no server** — the repo *is* the backend; JSON and Markdown are the product.
- **No paid APIs** — every source is free-tier or a keyless public endpoint.
- **Standard library only** — no `requirements.txt`, nothing to install.
- **Self-auditing** — every hourly change ships as its own auto-merged pull request.

The site's brand color, light/dark: [![0f766e](https://img.shields.io/badge/light-0f766e-0f766e.svg)](site/src/styles/global.css) [![2dd4bf](https://img.shields.io/badge/dark-2dd4bf-2dd4bf.svg)](site/src/styles/global.css) <img src="assets/bookmark-pop.svg" width="20" height="20" valign="middle" alt="Bookmark pop micro-interaction preview"> — every real animation in [docs/FEATURES.md#design-system--motion](docs/FEATURES.md#design-system--motion).

Live site: **https://ahmednassar7.github.io/tracker/** — architecture, setup, and deployment details are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Also here

- 📚 **[Career resources](data/resources.md)** — coding practice, mock interviews, resume tools, and more, for preparing applications alongside the job list.
- 🛠️ **[Contributing](CONTRIBUTING.md)** — how the automation works, how to add a company or job source, and how to run it locally. Only needed if you want to help build or extend this repo.

## Documentation

Deeper technical docs for contributors, in [docs/](docs/):

| Doc | What's in it |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the pipeline fits together, with system/data-flow diagrams |
| [docs/DEVELOPER-GUIDE.md](docs/DEVELOPER-GUIDE.md) | Setup, every available command, naming conventions, how to add a feature or test |
| [docs/FEATURES.md](docs/FEATURES.md) | Every feature, where it lives in the code, and how it works |
| [docs/DIAGRAMS.md](docs/DIAGRAMS.md) | All Mermaid diagrams in one place |
| [docs/DATA.md](docs/DATA.md) | Every external source, JSON record shapes, config file fields |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | The GitHub Actions workflows, triggers, steps, secrets |
| [docs/TESTING.md](docs/TESTING.md) | Test framework, how to run tests, feature-to-test map |
| [docs/DEMO.md](docs/DEMO.md) | A walkthrough script for showing this project to someone new |

## License

[MIT](LICENSE) — free to use, fork, and self-host.
