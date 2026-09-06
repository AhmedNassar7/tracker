# Browser Extension — Plan

**Status:** planned, not built. Prepared 2026-09-06. Companion to [WEBSITE-VISION-PLAN.html](WEBSITE-VISION-PLAN.html) §11 (the extension is item **X1–X6** there).

A Manifest V3 browser extension that makes `tracker` a working companion *while you apply*, the way Simplify's Copilot does — but keeping every one of this project's guardrails: **no server, no database, no paid API, no PII collection, no fabricated data.** The extension is pure client-side code; its only "backend" is the same static `data/site-index.json` the website already fetches, plus the browser's own local storage.

---

## 0. Why an extension at all

The website can list roles and track your own funnel, but it can't:

- **Autofill** an application form on `boards.greenhouse.io` / `jobs.lever.co` / `*.myworkdayjobs.com` / `jobs.ashbyhq.com` — that needs code running *on that page*.
- Show **"you already tracked this" / "you dismissed this"** on a posting you found via Google or LinkedIn, not via the site.
- Turn **"I just applied"** into a tracked application without you re-typing the company and title.

All three are content-script territory. Everything else (the list, the dashboard, preferences) stays on the site.

---

## 1. Guardrails (identical to the site's)

| Keep | How the extension honours it |
|---|---|
| No server / DB / paid API | The extension bundles no backend. It reads `site-index.json` from the CDN (same as the site) and writes only to `chrome.storage.local` / `chrome.storage.sync`. |
| No PII collection | Résumé/profile data for autofill is stored **only** in `chrome.storage.local`, never transmitted anywhere. No analytics, no telemetry. |
| No fabricated data | Autofill only ever fills fields from data *the user typed into the extension*. "On tracker" badges only show for ids that are genuinely in `site-index.json` / the user's own tracked set. |
| Respect source terms | Content scripts only read the DOM of a page the user deliberately opened and only *fill* fields the user triggers. No background scraping, no auto-submit, no rate-pushing. |
| Progressive enhancement | Every feature degrades: no résumé saved → autofill button is disabled with a "set up your profile" hint; offline → badges still work from cached data. |

**Explicitly out of scope:** auto-submitting applications, scraping job boards in the background, reading the user's email, anything that logs into a site as the user.

---

## 2. Architecture

```
extension/
  manifest.json            # MV3
  src/
    background.ts           # service worker — data sync, alarms, message router
    content/
      ats-autofill.ts       # runs on Greenhouse/Lever/Ashby/Workday application forms
      posting-badge.ts      # runs on LinkedIn/Google/company career pages — injects the "on tracker" chip
    popup/                  # the toolbar popup (React, same stack as site/)
      Popup.tsx             # tracked applications at a glance + quick actions
    options/                # full-page settings
      Options.tsx           # résumé/profile fields, sync toggle, board allowlist
    lib/
      storage.ts            # typed wrapper over chrome.storage (local + sync)
      siteIndex.ts          # fetch + 1h-cache site-index.json, shared id set
      atsAdapters.ts        # per-platform field maps (Greenhouse, Lever, Ashby, Workday)
      matchProfile.ts       # profile field -> form field resolution
  shared/                   # symlink/copy of site/src/lib/{types,tracker,preferences}.ts
```

- **Shared code with the site.** `tracker.ts` (the application-funnel model), `preferences.ts`, and `types.ts` are copied (or workspace-linked) from `site/src/lib/` so the extension and the site speak the exact same `TrackedApplication` shape. A build step keeps them in sync; a CI check diffs them.
- **Data sync.** The background worker fetches `site-index.json` hourly (an `alarms` job) into `chrome.storage.local`, so badge injection is instant and works offline. Same CDN + fallback logic as `site/src/lib/dataSource.ts`.
- **The tracked-application store is the integration point.** The site writes it to IndexedDB; the extension writes it to `chrome.storage`. To share it *across* the two, see §5 (Sync).

---

## 3. Features

### X1 — "On tracker" posting badge  ·  *S*
Content script on `linkedin.com/jobs/*`, `google.com/search`, `*.greenhouse.io`, `*.lever.co`, `*.ashbyhq.com`, `*.myworkdayjobs.com`, and major company career hosts. Resolves the posting to a `tracker` id (by apply-URL match, then company+title fuzzy match) and injects a small chip:

- **✓ On tracker** — links to the row on the site.
- **★ Bookmarked** / **📮 Applied · 6d ago** — if it's in the user's own tracked set, shows the funnel stage.
- **✕ You dismissed this** — if it's in the `dismissed.ts` set (Otta's "never twice", now enforced even outside the site).

Zero fabrication: no chip at all when there's no genuine match.

### X2 — One-click "track this application"  ·  *S*
On any recognised posting, a **"Track in tracker"** button. Reads company + title + apply URL from the page (per-platform selectors in `atsAdapters.ts`), creates a `TrackedApplication` at `status: "bookmarked"` (or `"applied"` if triggered from the post-submit confirmation page). No retyping.

### X3 — ATS form autofill  ·  *M*
Content script on the actual application form. A per-platform field map resolves the form's inputs (first name, last name, email, phone, LinkedIn, GitHub, portfolio, work authorization, "how did you hear about us", location, school, grad year, …) to the profile the user saved in **Options**. A floating **"Autofill"** button fills them; the user reviews and submits manually. Never auto-submits. Greenhouse + Lever first (stable, well-documented DOM), then Ashby + Workday.

### X4 — Résumé / profile vault  ·  *M*  ·  (see also site "CV part", §11 R1–R3)
The Options page holds:
- **Structured profile** — the fields X3 fills.
- **Résumé text** — pasted plain text or extracted from an uploaded PDF (client-side, `pdf.js`), used for X5 and as the source for a "master answers" library (common free-text questions → your saved answer, copy-paste).
- Everything in `chrome.storage.local`, exportable/importable as JSON, wiped with one button. **Never leaves the browser.**

### X5 — Keyword-gap hint  ·  *M*
On a posting page, extract the job description text (already in the DOM), diff its notable skills/tools (reusing the site's `detect_tech_tags` logic, ported to TS) against the résumé text in the vault, and show **"In this JD but not your résumé: Kubernetes, gRPC, Terraform."** Purely local text diff — no LLM, no upload. A nudge, not a score.

### X6 — Popup dashboard  ·  *S*
The toolbar popup: your tracked applications grouped by stage, "N closing in 48h", "N replied", a quick "+ add current page", and a link to the full site dashboard. The daily-glance surface.

---

## 4. Manifest V3 permissions (minimal)

| Permission | Why | Scope |
|---|---|---|
| `storage` | profile + cached site-index + tracked apps | — |
| `alarms` | hourly site-index refresh | — |
| `activeTab` + `scripting` | inject autofill/badge on the tab the user is looking at | no broad host grant |
| `host_permissions` | badge + autofill content scripts | an explicit allowlist of ATS + job-board hosts, **not** `<all_urls>` |

No `tabs`, no `webRequest`, no `cookies`, no `identity` (unless the optional GitHub-gist sync in §5 is built, and then only `identity` for the OAuth popup).

---

## 5. Cross-device sync — the "do we need accounts?" question

**Default: no account. Local-first, same as the site today.** `chrome.storage.sync` already gives *free, built-in* cross-device sync for anyone signed into the same browser profile (Chrome/Edge/Firefox account) — 100 KB / 8 KB-per-item quota, which comfortably fits preferences + a few hundred tracked applications. That covers most of the "use it on my laptop and my desktop" need with **zero backend and zero new login**.

For the rest (a different browser, sharing nothing with Google):
- **Export / import JSON** — already works on the site; mirror it in the extension.
- **Optional GitHub-gist sync** *(power-user, later)* — "Connect GitHub" writes an encrypted blob to a private gist you own. Uses the `identity` API for OAuth, no server, the data lives in *your* GitHub. Opt-in, clearly labelled, removable.

**A real account system (email + password + our database) is explicitly rejected** — it needs a server, breaks the $0 / no-PII guarantees, and buys almost nothing that `chrome.storage.sync` + export/import doesn't already give. If a compelling need appears later, the gist route is the way, not a bespoke backend.

---

## 6. How application stages are tracked (answering "how do you know it's at OA stage?")

**It's the user's call — set by hand, one tap.** There is no inbox scraping and no ATS polling (both need a server or email access). The funnel is: `bookmarked → applied → OA → interview → offer` / `rejected`, stored in `TrackedApplication.statusHistory` with a timestamp per transition, so the site/extension can then *compute* "median days applied→OA", "response rate", "3 stalled > 21 days", etc.

What the **extension** adds to make that one tap effortless:
- Detects the **post-submit confirmation page** on Greenhouse/Lever/etc. → offers "mark as Applied" right there.
- *Later, opt-in:* an email-rule helper — the user forwards an OA/interview invite to a local rule, or (with `identity` + Gmail read scope, a big ask, probably never) the extension reads the subject line. **Not in the v1 plan** — it crosses the PII line the project holds.

---

## 7. Build & ship

- Its own workspace: `extension/` with its own `package.json`, Vite + `@crxjs/vite-plugin` (MV3 HMR), React 19 (same as `site/`).
- A `pnpm`/`npm` workspace root so `site/` and `extension/` can share `lib/`.
- CI: typecheck + a "shared lib in sync" diff check. No store submission automation — publishing to the Chrome Web Store / AMO is a manual, reviewed step.
- Versioned independently of the site and the pipeline.

---

## 8. Rollout order

1. **X1 + X6** — badge + popup. Read-only, low-risk, immediately useful, exercises the whole data-sync + id-matching spine.
2. **X2** — one-click track. Introduces writes to the shared store.
3. **X4** — profile/résumé vault (Options page).
4. **X3** — autofill, Greenhouse + Lever.
5. **X5** — keyword-gap hint.
6. **X3** — extend autofill to Ashby + Workday.
7. *Optional, much later:* GitHub-gist sync.
