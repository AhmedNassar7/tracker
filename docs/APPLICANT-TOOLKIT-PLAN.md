# Applicant Toolkit — Plan

**Status:** planned, not built. Prepared 2026-09-08. Companion to
[WEBSITE-VISION-PLAN.html](WEBSITE-VISION-PLAN.html) §11 (**Lane R** résumé/CV, **Lane C**
personalisation) and [EXTENSION-PLAN.md](EXTENSION-PLAN.md) (X2/X4 share this data model).

This document takes the six "features" every commercial early-career platform advertises —
**AI resume builder · cover letter builder · contact finder · job alerts · application
tracker · unified profile** — and turns them into an ordered, guardrail-safe build plan for
`tracker`. It is the single reference for *what we build, in what order, to what quality bar,
and what stays free*.

The whole toolkit is **client-side code in `site/` plus one generator change**. It adds **no
server, no database, no paid API, no PII store, no fabricated data** — the same guarantees the
pipeline and the site already hold. Everything a user types lives in *their* browser
(IndexedDB / `localStorage`), is exportable as JSON, and is wiped with one button.

---

## 0. The six features, judged

| Feature | Verdict | Free? | Where it lives |
|---|---|---|---|
| **Unified profile** | **Build first** — it is the spine every other tool reads from | ✅ fully | `site/src/lib/profile.ts` + `/profile` route |
| **Application tracker** | **Build** — highest daily-use pull, genuinely easy without a backend | ✅ fully | `/tracker` route, IndexedDB |
| **Job / internship alerts** | **Build** — the pipeline already emits an hourly feed with `posted_at` | ✅ fully | generator (`rss_feeds.py`) + PWA service worker |
| **Cover letter builder** | **Build** — templated core, optional "polish with AI" on the user's own key | ✅ templated · BYO-key for AI | `/toolkit/cover-letter` route |
| **AI resume builder** | **Build the useful 20%** — analyser + keyword-gap + ATS-safe export. **Not** a layout/design engine | ⚠️ partial | `/toolkit/resume` route |
| **Contact finder** | **Skip the database** — deep-link to LinkedIn/careers search + an outreach-template library instead | ✅ (deep-links only) | a panel on each tracked application |

**Why the two "no" calls:**

- **A full résumé *design* engine** (Overleaf/FlowCV/Zety/Resume.io territory) is a large product
  with near-zero differentiation for a job aggregator, and doing ATS-safe multi-format layout well
  is a rabbit hole. We give a clean single-column export and hand off to those tools by name. The
  value we *can* uniquely add — "does this résumé match *this* JD" — we build (§Phase 5).
- **A contact/email database** (Apollo/Hunter/RocketReach/LinkedIn scraping) has **no free,
  ToS-clean, serverless path**. Email-pattern guessing is unreliable and spammy. We give the
  honest free version: pre-built people-search deep-links + reusable outreach snippets.

### 0b. Also considered (asked about, not one of the six)

| Ask | Verdict | Why |
|---|---|---|
| **Refer & earn** (referral rewards, à la some paid platforms) | ❌ **reject** | Attribution + payout needs accounts, a backend, and a money flow — breaks every guardrail at once. Free substitute: plain "share" links + a "★ star us on GitHub" ask. No "earn". |
| **Auto-apply** (a bot fills *and submits* the form, à la Zapply) | ⚠️ **reject the auto-submit; build autofill** | Auto-submission gets user accounts banned, floods employers with low-quality applications, and leaves nobody accountable for what was sent. We do **autofill** — the extension fills the form, *the user* reviews and submits — already specced as [EXTENSION-PLAN.md](EXTENSION-PLAN.md) **X3** (Greenhouse/Lever first, then Ashby/Workday). This plan's Phase 1 profile is its data source. |
| **Feedback / feature board** (à la Simplify) | ✅ **build, thin** | Two options: **(a) zero-account** — a "Send feedback" button that opens a **prefilled GitHub Issue / Discussion**; **(b) polished** — embed/link a free **Featurebase** board (what Simplify itself uses — free tier: unlimited public posts + roadmap + changelog, unbranded, 3 admin seats). Canny (1 free board) is the fallback. Recommend starting with (a), adding (b) if non-developer feedback volume justifies it. Needs one free sign-up — see §11. Belongs in Lane F. |
| **Facet counts in filters** — "Backend (142)", "Germany (37)" | ✅ **recommend — do it** | Standard faceted-search practice (every real job board). Fully client-side: count loaded `site-index.json` items per facet value, recomputed as other filters narrow. New **Lane G8**; small, self-contained, ship any time. |
| **RocketReach-style contact finder** | ❌ (see §0 above) | Paid data, ToS risk, backend. Phase 6 deep-links are the free version. |

---

## 1. Guardrails (identical to the site's)

| Keep | How the toolkit honours it |
|---|---|
| No server / DB / paid API | All tools are static React islands. The only data source is `site-index.json` (already public) + the browser's own storage. |
| No PII collection | Profile, résumé text, tracker rows, cover-letter drafts live **only** in IndexedDB / `localStorage`. Nothing is transmitted anywhere. No analytics on it. |
| No fabricated data | Cover-letter/résumé generators only ever merge fields the user typed. The keyword-gap check is a literal text diff. No tool invents an achievement, a date, or a contact. |
| BYO-key AI, never ours | Any LLM call uses a key the **user** pastes, stored in `localStorage`, sent **only** to that provider's own endpoint from the browser. We never proxy it, never see it, never pay for it. The feature degrades to the templated path when no key is set. |
| Progressive enhancement | Every tool works with an empty profile (guides you to fill it), offline (except the live JD fetch and the optional AI call), and without notifications permission. |
| No dark patterns | No account wall, no gated export, no fake urgency/scarcity, no "upgrade to see your score". Every output is copyable and exportable. |

**Explicitly out of scope:** hosted AI generation, a contact database, inbox/ATS scraping for
stage detection, any email list we operate, any login we operate.

---

## 2. Architecture — one profile, many tools

```
site/src/
  lib/
    profile.ts          # THE unified profile — one versioned type, read by every tool
    profileStore.ts      # IndexedDB wrapper (get/set/export/import/wipe), migration hook
    resume.ts            # résumé text vault + client-side PDF text extraction (pdf.js)
    tracker.ts           # TrackedApplication model + funnel maths (shared with the extension)
    coverLetter.ts       # template engine (merge Profile + posting + notes -> paragraphs)
    resumeLint.ts         # offline rule-based checker (bullets, verbs, length, contact block…)
    keywordGap.ts         # reuse detect_tech_tags (ported to TS) + detect_requirements diff
    aiKey.ts             # BYO-key storage + one callProvider(prompt) shim — Gemini / Anthropic / OpenAI / Ollama URL
    jsonResume.ts        # Profile <-> JSON Resume schema (jsonresume.org) — export/import interchange
    outreach.ts          # people-search URL builders + snippet templates
  pages/
    profile.astro         # /profile          — unified profile + résumé vault
    tracker.astro         # /tracker          — the application board
    toolkit/
      cover-letter.astro  # /toolkit/cover-letter
      resume.astro        # /toolkit/resume   — analyser + gap + export (NOT a designer)
  components/
    profile/ …            # sectioned form islands
    tracker/ …            # board + table + funnel chart
    toolkit/ …            # cover-letter split-pane, resume report, gap table
```

**Pipeline changes: exactly two, both additive.**

1. `scripts/rss_feeds.py` / `build_data_readme.py` — multiply the preset RSS/Atom feeds and add
   per-saved-search feed generation (Lane C3 / F2). No schema change.
2. Port `detect_tech_tags` + `detect_requirements` to `keywordGap.ts` (a generated TS mirror of the
   Python table, with a test that diffs the two lists — same discipline as `formatSalaryShort`).

Everything else is `site/` only. `astro check` + `astro build` clean is the bar; each tool ships
behind its own route, no big-bang.

---

## 3. Build order — the spine

Ship strictly in this order. Each phase is independently useful and unblocks the next.

### Phase 1 — Unified Profile · `/profile` · *foundation* {#phase-1}

> Maps to: **Lane R1** (résumé vault), and the data contract behind R2/R3, C5–C8, X3/X4.

**Why first.** Cover letters, résumé analysis, tracker autofill, extension autofill, and the
"for you" default filter all read from one object. Define it once, version it, and every later
tool is a view over it.

**Data model** (`profile.ts`, `schema_version` field, migration on read):

```
Profile {
  identity:   { fullName, email, phone, location, links: {linkedin, github, portfolio, other[]} }
  eligibility:{ workAuth: string[], needsSponsorship?: bool, willRelocate?: bool, noticePeriod? }
  education:  [{ school, degree, field, start, end, gpa?, notes? }]
  experience: [{ org, title, start, end, current?, location?, bullets: string[] }]
  projects:   [{ name, url?, blurb, bullets: string[] }]
  skills:     { languages[], frameworks[], tools[], other[] }
  targets:    { levels[], roles[], regions[], countries[], mustHave: string[], avoid: string[] }
  answers:    [{ q, a }]        # "master answers" (Lane R3) — why-this-company, etc.
  meta:       { schema_version, updatedAt, completeness: 0..1 }
}
```

`targets` is the same shape as `FilterState` — saving your profile *is* saving your preferences
(closes the "two save concepts" wrinkle in Lane H5). One source of truth.

**UX / production bar:**

- **Single scrolling page, sectioned**, with a sticky mini-nav and a **completeness ring** ("Profile 70% — add 2 work bullets to reach 85%"). No wizard, no forced order.
- **Autosave on blur**, with a quiet "Saved · 2s ago" indicator and full **undo/redo** on every field. Draft recovery if the tab closes mid-edit.
- **Import paths:** upload a résumé PDF → `pdf.js` extracts text client-side (`pdfText.ts`) → `resumeParse.ts` does a best-effort section split the user confirms/corrects (never silently trusted). Paste a LinkedIn "Save to PDF" export. Import a previously exported `tracker` JSON. **No upload ever leaves the browser** — say so, visibly, next to the file picker.
  - *Parser robustness (2026-09-10, from a real CV):* `splitSections` now also matches a heading that pdf.js glued onto the first entry ("Experience Beshara Group…"); `splitEntries` recognises an entry whose right-aligned date landed on its own line; `BULLET_RE` covers more glyphs and a bare "- "; project tech lines no longer leak the trailing "GitHub"/"Live" link labels into skills; an education line's trailing "City, Country" is stripped off the degree/field (gated on a known-country list so "Computer Science" is never truncated). Even a clean parse tops out ~78% completeness — *eligibility* and *targets* aren't in a résumé.
- **Back up / restore:** one plain-language **"Download a copy"** button → a lossless `my-profile-backup.json`; dropping that file back on the import box loads it. That's the entire cross-device story — no account. The **[JSON Resume](https://jsonresume.org)-format** export and the `.md` / `.docx` résumé exports move to **Phase 5c**, grouped with the other "take your résumé elsewhere" outputs where the label can be contextual — a bare "Export JSON Resume" button on the profile page means nothing to a normal user. (`jsonResume.ts` still powers *import* of a JSON Resume file today.)
- **Privacy line, persistent:** a small always-visible banner — *"Everything on this page is stored only in this browser. [Export] anytime · [Erase everything]."* One-tap wipe with a typed confirm.
- **a11y:** every field labelled, visible focus ring, logical tab order, error text tied via `aria-describedby`, `prefers-reduced-motion` respected, works keyboard-only, light/dark, mobile single-column.
- **Empty state:** three example profiles ("new-grad SWE", "career-switcher", "PhD → industry") that pre-fill the structure so the user edits rather than faces a blank form.

**Competitive read:** FlowCV / Enhancv sell "fill once, reuse everywhere" behind an account.
Ours is the same idea with **no account and local-only storage** as the headline, not a caveat.

---

### Phase 2 — Application Tracker · `/tracker` {#phase-2}

> Maps to: **Lane C5** (personal funnel), **X2/X6** (extension writes the same store).

**Data model** (`tracker.ts`, shared verbatim with the extension):

```
TrackedApplication {
  id, company, title, url, source,
  status: "bookmarked" | "applied" | "oa" | "interview" | "offer" | "rejected" | "withdrawn",
  statusHistory: [{ status, at }],          # every transition timestamped
  nextAction?: { label, due },              # "follow up", "OA due" — drives reminders
  contacts: [{ name, role, link, note }],   # from the outreach panel (Phase 6)
  notes: string,
  salaryNote?, locationNote?,
  jdSnapshot?: string,                       # the JD text at time of applying — for interview prep later
  resumeVariantUsed?: string,               # the tailored résumé text sent for THIS role
  coverLetterUsed?: string,                 # the letter sent (Phase 4 can write it straight here)
  matchScore?: number,                      # Phase 5a score at time of tracking (frozen)
  createdAt, updatedAt
}
```

The `jdSnapshot` / `resumeVariantUsed` / `coverLetterUsed` fields (a good call from the
architecture notes) are why the store is **IndexedDB, not `localStorage`** — a few hundred
applications each carrying a JD + résumé variant is well past `localStorage`'s ~5 MB synchronous
budget. Use `idb` or `Dexie.js` as the wrapper. The small `Profile` object can stay in
`localStorage`.

**UX / production bar:**

- **Board ⇄ table toggle.** Board = six columns (`bookmarked → applied → OA → interview → offer` / `rejected`), drag a card between columns (optimistic, keyboard-movable via a "Move to…" menu for a11y). Table = sortable/filterable, bulk status change, virtualised past ~200 rows.
- **Card:** company logo (reuse `CompanyAvatar`), title, age-in-stage, a `⚠ stalled` badge past 21 days with no transition, next-action chip, contact count. Click → a detail drawer (notes, contacts, full status timeline, links).
- **Add a row from anywhere:** a "Track" button on every list/`OpportunityTable` row (prefills company/title/url/source); a manual "+ Add" for off-site applications; import from the extension's store; paste a URL and it resolves against `site-index.json` for company/title.
- **Funnel metrics** (computed from `statusHistory`, all offline): applied→OA median days, OA→interview rate, interview→offer rate, response rate by source/company-type, a small funnel chart. This is Simplify's paid hook — free, local, exportable here.
- **Reminders:** `nextAction.due` surfaces as a local notification (Phase 3 infra) and a "/today" list. **Manual stage changes only** — no inbox scraping (needs a server, crosses the PII line).
- **Export:** `applications.csv` + `applications.json`. **Import** the same.
- **Empty state:** "Nothing tracked yet — find a role on the [board] and hit *Track*, or [+ add one manually]." Plus a 4-row demo set behind a "show me an example" toggle.

**Competitive read:** Teal / Huntr / Simplify trackers are account-gated and cloud-stored. Ours
is **private by construction** (data never leaves the device) and free — lead with that.

---

### Phase 3 — Job / Internship Alerts {#phase-3}

> Maps to: **Lane C3** (saved-search feeds), **C7** (PWA notifications), **F2** (RSS everywhere).

Three delivery channels, cheapest first. All free, none need an account or an email list *we*
run.

**3a — RSS / Atom, generator-side.** *(do this first — ~an afternoon)*
Extend `rss_feeds.py`: global feed, per-region, per-country, per-role, and **per-saved-search**
(the site serialises a `FilterState` to a slug, the generator renders `feeds/<slug>.xml` for the
common ones + a documented "build your own feed URL" scheme). `RssFeedLinks.astro` already
explains RSS in plain language — extend it with a "copy the feed for *this* filter" button.

**3b — PWA local notifications.** *(Lane C7)*
Service worker + `periodicSync` (with a "check on each visit" fallback for browsers without it)
diffs `site-index.json` against the user's saved searches and tracker `nextAction` deadlines,
then fires a `Notification`: *"8 new roles match 'MENA new-grad'"*, *"3 bookmarked roles close
in 48h"*. **No push server needed** — these are local notifications from a background sync.

- **Permission is asked only on an explicit "Turn on alerts" tap**, never on page load, with a one-line explainer of what fires and how often. A "test notification" button. Quiet-hours and digest-vs-instant toggles. An always-available "turn off" that actually unregisters.

**3c — Optional webhook push.** *(Lane C4)*
User pastes their **own** Discord/Slack/Telegram webhook URL (stored in `localStorage`); the
service worker POSTs new matches to it. Secret never leaves the browser, nothing stored our side.

**3d — "Match my profile" on any listing.** *(ties Phase 5a into the main list + alerts)*
Once a `Profile` exists, every row on the board and in an alert gets a small **Match** button /
chip that runs the local keyword-gap algorithm (Phase 5a) against that posting and shows an
inline score + the top 2 missing skills — no navigation, no AI. This is also the signal
Lane C1's "for you" ranking consumes. Hidden entirely until a profile is filled.

**Competitive read:** LinkedIn / Simplify alerts require an account and an email address they
keep. Ours: subscribe with an RSS reader (zero identity) or opt into on-device push.

---

### Phase 4 — Cover Letter Builder · `/toolkit/cover-letter` {#phase-4}

> **Status: 4a shipped 2026-09-10; Automatic/Manual modes + PDF export 2026-09-10 (cont.).**
> `site/src/lib/coverLetter.ts` (`buildCoverLetter` + `recommendCoverLetterOptions` +
> `coverLetterToText` / `coverLetterToMarkdown`) + `CoverLetterBuilder.tsx` on
> `/toolkit/cover-letter` (a "Cover letter" tab in the Workspace sub-nav). Split-pane:
> inputs left (start from a tracked application or type company/title; paste the JD — its
> `detectTechTags` ∩ your profile skills become the "will mention" list; a "why this
> company" box), live preview right with `[bracketed]` prompts highlighted and a
> "N placeholders to fill" line.
>
> **Two modes.** **Automatic** (default) generates from the résumé-derived profile + JD with
> no knobs — `recommendCoverLetterOptions` picks template (impact → narrative → concise by
> what the profile carries), neutral tone, and length; a note shows the pick + skill
> alignment count. **Manual** exposes the template × tone × length selects (seeded from the
> recommendation on switch). Export is **Copy text** + **Download PDF** (browser print dialog
> → *Save as PDF*, filename seeded from `document.title`) + **Save to application**
> (`TrackedApplication.coverLetterUsed`). The "impact" opener and the fit paragraph pull
> different bullets so no line repeats. Every merged value comes from the profile or the
> user's own inputs — nothing invented. **4b (BYO-key AI polish) is still open.**

**4a — Template engine (free, offline, the default).**
Pick a tracked application or paste a JD URL → the tool pulls `company`, `title`, top
`tech_tags`, `location`, `salary` from `site-index.json` (or parses a pasted JD), merges them
with the Profile (`experience` highlights, `skills`, relevant `answers`) and a short "why this
company" free-text box into a structured letter:

- **Automatic mode** (default): zero knobs — the profile + JD alone drive template/tone/length via `recommendCoverLetterOptions`. **Manual mode**: 3–4 templates (concise / narrative / impact-led / referral) × 3 tones (warm / neutral / formal) × length (½ / 1 page), user-set.
- Live **split-pane**: inputs left, formatted preview right, updating as you type.
- Placeholder highlighting for anything unfilled ("`[a metric]`"), counted in a "N placeholders to fill" line.
- Output: **Copy text**, **Download PDF** (browser print dialog → *Save as PDF*; no layout engine, no dependency), and **"save to this application"** (stored on the `TrackedApplication`).

**4b — "Polish with AI" (optional, BYO-key).**
If the user has set a key in `aiKey.ts`, a button sends *the draft + the JD* to their provider
and returns a rewrite shown in a **diff view** — the user accepts hunks, nothing auto-replaces.
Show an estimated token cost before sending. Falls back silently to 4a when no key is set.

*Providers* (`aiKey.ts`, one `callProvider` shim): **Google Gemini (AI Studio free tier) is the
suggested default** — its free tier means the *user* also pays nothing — with Anthropic and
OpenAI keys, and a local Ollama URL, as alternatives. **Privacy caveat, shown in the settings
panel:** free-tier Gemini prompts may be used by Google to improve their products; a user who
wants their draft kept private should use a paid key or Anthropic/OpenAI (no training on API
data by default), or the local option in §10.

**Competitive read:** Kickresume / Teal / Enhancv cover-letter writers are GPT-backed and
paywalled. Ours gives a solid letter with **no key at all**, and "as good as theirs" when you
bring your own — at your cost, not ours, with your data going only to your provider.

---

### Phase 5 — Résumé Tools · `/toolkit/resume` · *analyser, not designer* {#phase-5}

> Maps to: **Lane R2** (keyword-gap) + **R4** (linter). Scoped deliberately narrow.

**5a — Keyword / ATS gap check.** *(Lane R2 — the headline)*
Paste or pick a JD → run the ported `detect_tech_tags` + `detect_requirements` over it → diff
against the Profile skills and résumé text:

- **Present** (JD asks, you have it) · **Missing** (JD asks, you don't) · **Extra** (you have, JD silent).
- A **transparent score** with the rubric shown ("6/9 required skills present, contact block complete, 2 quantified bullets") — never a black-box number.
- "Add to profile" shortcuts for missing skills you actually have.

**5b — Résumé linter (offline, rule-based, no AI).** *(Lane R4)*
Static checks over the vault text: quantified-bullet ratio, weak/passive openers vs action
verbs, bullet length, section presence (contact / experience / education / skills), date-gap
detection, page-length estimate, file-format tips, region-aware "no photo / no age / no marital
status" note. Mirrors what Resume Worded / Novorésumé's structure score does — **fully local, no
upload, no account.**

**5c — Export Profile → ATS-safe résumé.**
One-column, standard headings, no tables/columns/icons, selectable text: `.md`, `.docx` (via a
bundled generator lib), and a print-to-PDF stylesheet. This is a *safe baseline*, explicitly
**not** a designed résumé — the page links out to Overleaf / FlowCV / Resume.io by name for
design, pre-filled from the same profile export where their import supports it.

**5d — "Rewrite this bullet" (optional, BYO-key).**
Per-bullet, opt-in, diff-view accept — same pattern as 4b. Never rewrites the whole document,
never auto-applies.

**Competitive read of the reference list:**

| They do | We do | Free? |
|---|---|---|
| Overleaf / FlowCV / Zety / Resume.io — *design* | Hand off by name; we export a clean base | n/a |
| Jobscan — ATS keyword match vs a JD | 5a keyword-gap, from the same JD-parsing the pipeline already does | ✅ local |
| Resume Worded / VMock — line-by-line scoring | 5b linter + 5a rubric (transparent, not a mystery score) | ✅ local |
| Grammarly — grammar/tone | Out of scope — recommend it; or 5d on the user's own key | ✅ (link out) |
| Kickresume / Rezi / Enhancv — GPT bullet writing | 5d per-bullet, BYO-key | ✅ user's key |

---

### Phase 6 — Outreach (the honest "contact finder") {#phase-6}

**No contact database.** On any tracked application, an **Outreach** panel:

- **People-search deep-links** built from the company name — LinkedIn people search for
  `"<company>" recruiter`, `"<company>" engineering manager`, `"<company>" university recruiting`;
  the company careers page; Levels.fyi; Glassdoor interviews; **and a "look this company up on
  Hunter.io / Apollo.io / RocketReach" link** (their own UI, the user's own free tier — we make
  the URL, we never call their API or hold a key). Zero data stored, zero API, zero ToS risk —
  just well-formed URLs.
- **Outreach snippet library** (`outreach.ts`) — referral ask, recruiter follow-up, post-OA
  nudge, thank-you-after-interview, reconnect — each merged with `Profile.identity` and the
  application's company/title, copy-to-clipboard.
- Any contact the user notes lands on `TrackedApplication.contacts` (name, role, link, note) —
  typed by the user, never guessed.

**Competitive read:** RocketReach / Apollo-style finders need paid data and a backend. We give
the *workflow* (who to look for, where, what to say) for free without pretending to be a data
vendor.

---

## 4. Cross-cutting: the unified-profile contract

One `Profile` object, versioned, is read by: the tracker (autofill new rows), the cover-letter
engine, the résumé tools, the "for you" default sort (C8 — `Profile.targets` *is* the saved
filter), and the browser extension's autofill (X3/X4, via the shared `lib/`). Define it in
`profile.ts` with a `schema_version` and a migrate-on-read step; every consumer imports the type,
none redefine it. Export/import round-trips the whole thing as one JSON file — that plus
`chrome.storage.sync` in the extension is the entire cross-device story (no account, per
[EXTENSION-PLAN.md §5](EXTENSION-PLAN.md)).

### 4a. Profile ⇄ job-record alignment (the match engine)

For the match score to mean anything, every scored dimension of a job record
(`SiteIndexEntry` / `site-index.json`) must have a matching field in `Profile.targets` /
`Profile.eligibility`. Current state:

| Job field (`SiteIndexEntry`) | Profile field | Status | How it scores (`profileMatch.ts`) |
|---|---|---|---|
| `level` | `targets.levels` | ✅ same enum | +3 match · **hard contradiction** if off |
| `role_type` | `targets.roles` | ✅ same enum | +2 |
| `region` | `targets.regions` | ✅ same enum | +2 |
| `country` | `targets.countries` | ✅ | +2 |
| `remote_type` | `targets.remotes` | ✅ **added** (was a `mustHave:"remote"` hack) | +2 |
| `company` | `targets.companies` ("dream companies") | ✅ **added** | +3 |
| `salary {min,max,currency,period}` | `targets.minSalary` + `salaryCurrency` + `salaryPeriod` | ✅ **added** | +3 at/above · −5 + contradiction if the whole range is below · gap note if it straddles |
| `visa_sponsorship` | `eligibility.needsSponsorship` + `eligibility.authorizedCountries` | ✅ **wired** | +4 when needed & offered · gap when needed, not offered, and not an authorised country |
| `degree_required` | `eligibility.hasDegree` | ✅ **added** | +2 when you lack one & it's not required · −6 + contradiction when required |
| `relocation` | `eligibility.willRelocate` | ✅ wired | +1 |
| `min_years_experience` | `deriveYearsOfExperience(experience)` | ✅ **wired** | +2 when met · gap when just under · −3 + contradiction when 2+ years short |
| `languages_required[]` | `eligibility.spokenLanguages` | ✅ **added** | +2 when all covered · gap listing the missing ones |
| `tech_tags[]` | `skills.{languages,frameworks,tools,other}` | ✅ **R2 shipped + wired into the score** — `keywordGap.ts` ports `detect_tech_tags`; `profileMatch.ts` now runs the profile skills through `detectSkillTags()` so the overlap with `item.tech_tags` is an exact canonical-vocabulary set intersection, not a name compare | +1 per matched stack item (cap 5); missing ones surface as "stack to learn". The `/toolkit/resume` gap check does the full Present / Missing / Extra diff. |
| `posted_at` / `age` | — | ✅ | freshness nudge (from `scoreOpportunity`) |

`filterStateFromProfile()` projects the targets onto a `FilterState` so the site's existing
relevance engine (`preferences.ts scoreOpportunity` / `matchReasons` / `contradictsPrefFilter`)
does the shared-dimension weighting with no second set of weights to maintain — this is also the
Lane H5 "your profile *is* your saved preference filter" bridge. `scoreJobForProfile()` adds the
salary / visa / degree / relocation / skills layers and returns `{ score 0–100, reasons[],
gaps[], contradicts }` — explainable, never a black-box number.

**Still to sharpen the match (in priority order):**

1. ~~**R2 — port `detect_tech_tags` to TS and use it in the match.**~~ ✅ **Done** —
   `site/src/lib/keywordGap.ts` mirrors `detect_tech_tags` + `detect_requirements` (parity test in
   `tests/test_patterns.py`); the `/toolkit/resume` page runs the full Present / Missing / Extra
   keyword-gap diff against a pasted JD; and `profileMatch.ts` now canonicalises the profile's
   skills with `detectSkillTags()` (a comma-joined variant so a bare "Go"/"Rust" chip still tags),
   so the score's skills ↔ `tech_tags` overlap is an exact set intersection, not a name compare.
2. ~~**Pipeline: extend `detect_requirements`**~~ ✅ **Done** — `scripts/patterns.py`
   `detect_requirements` now also returns `min_years_experience` (int, lower bound of a
   "N+ years… experience" phrase, `\d{1,2}`-capped, requires an "experience" cue) and
   `languages_required` (spoken languages next to a fluency cue, from a fixed vocab with no
   English and nothing that collides with a programming-language name). Both optional, strict-
   positive, mirrored in `keywordGap.ts` (parity test covers the key names + language vocab),
   added to all three schemas + `types.ts` + `build_data_readme` propagation, surfaced as info
   rows in the `/toolkit/resume` requirements list. Still to do: **#3** derived profile YoE so
   `min_years_experience` can be *compared* (not just shown), and a language check against the
   profile's own languages.
3. ~~**Derived years-of-experience** on the profile~~ ✅ **Done** — `deriveYearsOfExperience(experience)`
   in `profile.ts` sums the `experience[]` date ranges (free-text "YYYY" / "YYYY-MM" / "Mar 2021"
   parsed to a fractional year; a `current` role runs to now; capped at 40). Shown read-only under
   the Experience section ("that's about ~N years"); `profileMatch.ts` compares it to a job's
   `min_years_experience` (+2 / gap / −3 + contradiction when 2+ short), and the `/toolkit/resume`
   Experience row upgrades from info → ok/warn against it. An explicit override field can come later.
4. ~~**Wire the score into the UI**~~ ✅ **Done** — `OpportunityBrowser` loads the profile and
   adds a **"Best for you"** sort mode (disabled until the profile has skills or targets), ranking
   the list by `scoreJobForProfile().raw` and partitioning hard mismatches below a "show anyway"
   line like Relevance does. `OpportunityTable` renders a **`MatchChips`** row per result — a
   `🎯 N% match` pill (green/amber/grey by band) plus up to 3 reason chips and 2 gap chips. The
   score is **frozen onto `TrackedApplication.matchScore`** at track time (`tracker.ts` +
   `handleToggleTrack`), jobs only, only when a usable profile exists. The personal dashboard
   shows the frozen-score distribution (Strong / Fair / Weak + average + a "more weak than
   strong" nudge), and "Best for you" is the default sort for a returning visitor whose profile
   is filled — leaving only a `/today` digest for full C8.

---

## 5. Design & UX standards (the production bar for every tool)

- **Same design system as the site** — Tailwind config, tokens, motion rules from
  WEBSITE-VISION-PLAN §5.2. These tools should feel like the same product, not a bolt-on.
- **Every tool ships with:** a real empty state, loading skeletons, an autosave/"saved"
  indicator, keyboard-first operation, WCAG AA (labels, focus, ARIA, contrast, reduced-motion),
  light + dark, and a mobile layout — not "desktop only for now".
- **Local-first, said out loud:** a persistent, unobtrusive "stored only in this browser —
  export anytime" line on every page that holds user data.
- **No dark patterns:** no gated exports, no score paywall, no fake urgency, no account nag.
- **Performance budget** from WEBSITE-VISION-PLAN §8.4 — each tool is a lazy island, not loaded
  on the main list route.
- **Copy tone:** plain, non-hype, slightly warm — match `RssFeedLinks.astro`'s rewrite.

---

## 6. What is free vs what would cost

| Piece | Cost | Note |
|---|---|---|
| Profile, tracker, linter, keyword-gap, templated cover letter, RSS feeds, local notifications, webhook push, outreach deep-links, ATS-safe export | **$0, forever** | Pure client-side + one generator change. No infra. |
| "Polish with AI" / "rewrite bullet" | **$0 to us** | User's own API key, user's own spend, direct browser→provider. Degrades to templated when absent. |
| Gemini AI Studio free tier as the default suggested key | **$0 to us and to the user** | Rate-limited free tier; privacy caveat surfaced (see §10). |
| Local in-browser LLM (WebLLM / Transformers.js) — opt-in "private / offline AI" | **$0** | ~1–4 GB one-time model download, WebGPU for usable speed. Never the default; a toggle for the technically willing. See §10. |
| `.docx` generation | **$0** | Bundled MIT-licensed lib, runs in-browser. |
| PDF *text extraction* on import | **$0** | `pdfjs-dist` (PDF.js) in-browser; `mammoth` browser build for `.docx`. |
| Facet counts, feedback-to-GitHub-issue, share links | **$0** | Pure client-side / links. |
| A hosted AI we pay for | ❌ **rejected** | Recurring cost + a backend + a rate-limit/abuse surface. Breaks the premise. |
| A contact/email database | ❌ **rejected** | Paid data, ToS risk, needs a backend. Phase 6 is the free substitute. |
| An email digest *we* send | ❌ **rejected** | Needs a subscriber list = PII store + a server. RSS + push cover it. |

---

## 7. Resources / decisions I need from you

1. **BYO-key AI — yes or no?** Recommend **yes**, clearly labelled, off by default, key stored
   locally only. If no, Phases 4b / 5d drop and everything else stands.
2. **Providers for BYO-key** — recommend **Gemini (free tier) as the default** + Anthropic +
   OpenAI + local Ollama URL, via one `callProvider` shim. OK, or narrower?
3. **Local in-browser LLM (WebLLM / Transformers.js)** — add it as an opt-in "private/offline"
   toggle (accepts the ~1–4 GB download), or leave it out of v1?
4. **Approve the client-side libs:** `pdfjs-dist` (PDF text), `mammoth` (`.docx` in), a `.docx`
   generator (e.g. `docx`) for export, otherwise print-CSS only. All MIT/Apache, all in-browser.
5. **PWA / service worker** — the site "manifest + SW already ship" per the vision doc. Confirm
   `periodicSync` is acceptable to add for Phase 3b, and that the host serves the SW at root
   scope.
6. **Design tokens** — follow the existing `site/` Tailwind config (my assumption), or is there
   a Figma / token sheet I should pull from?
7. **`.docx`/PDF fidelity** — is "clean single-column, ATS-safe, hand off to Overleaf/FlowCV for
   design" the right scope for 5c, or do you want a couple of real templates?
8. **Route names** — `/profile`, `/tracker`, `/toolkit/cover-letter`, `/toolkit/resume` OK, or
   fold the last two under `/resume` + `/cover-letter` at the top level?
9. **Facet counts (Lane G8) + feedback-to-GitHub button** — both small and guardrail-safe; want
   them slotted in now (they're independent of the phases) or parked?

---

## 8. Rollout summary

1. **Phase 1 — Unified Profile** (`/profile` + `profile.ts` + IndexedDB store + résumé vault). The spine.
2. **Phase 2 — Application Tracker** (`/tracker`, board + funnel, shared `tracker.ts`).
3. **Phase 3 — Alerts:** 3a RSS feeds (generator) → 3b PWA local notifications → 3c optional webhook.
4. **Phase 4 — Cover Letter:** 4a template engine → 4b optional BYO-key polish.
5. **Phase 5 — Résumé Tools:** 5a keyword-gap → 5b linter → 5c ATS-safe export → 5d optional BYO-key rewrite.
6. **Phase 6 — Outreach panel** (deep-links + snippet library on the tracker).

**Parallel small wins** (independent of the phase order, ship whenever): **Lane G8** facet counts
in the filter bar; a **"Send feedback"** button that opens a prefilled GitHub Issue; **share
links** (no "refer & earn").

Then the browser extension ([EXTENSION-PLAN.md](EXTENSION-PLAN.md)) reuses `profile.ts` /
`tracker.ts` / `keywordGap.ts` wholesale for X2 / X4 / X5, and adds **autofill** (X3) — fill the
form, user reviews and submits; never auto-submit.

---

## 9. Reference platforms, mapped

Every tool named across the research dumps, and where it lands in this plan.

| Platform(s) | Category | Our response |
|---|---|---|
| Overleaf, FlowCV, Resumake *(OSS, JSON Resume)*, Zety, Resume.io, Resume.com, Adobe Express, resume.ai, withresumeai.com, StylingCV, Novorésumé, Enhancv, Kickresume | Résumé **design/build** | **Hand off by name.** We export a clean [JSON Resume](https://jsonresume.org)-schema profile + an ATS-safe base (Phase 5c) and link out for visual design. Not building a studio. |
| Jobscan, Resume Worded, VMock, Cultivated Culture (ResumAI), Teal résumé checker, Novorésumé ATS checker | Résumé **analysis / ATS score** | **Phase 5a + 5b** — algorithmic, local, transparent rubric. No AI, no upload, no account. This is where we can genuinely match the paid tools. |
| Kickresume, Enhancv, Teal, CoverDoc.ai, Rezi | **AI cover letter / bullet tailoring** | **Phase 4** (templated default) **+ 4b / 5d** (BYO-key polish, diff-view). |
| Teal, Simplify, Huntr, Rejectless.app | **Application tracker / career hub** | **Phase 2** — board + funnel metrics, private by construction (data never leaves the device). |
| RocketReach, Apollo, Hunter | **Contact / email finder** | **Phase 6** — deep-links + outreach snippets only. No data vendor. |
| Simplify (Copilot), Zapply | **Autofill / auto-apply extension** | **[EXTENSION-PLAN.md](EXTENSION-PLAN.md) X3** — autofill only, user submits. Auto-submit rejected (§0b). |
| Featurebase *(Simplify uses this)*, Canny, Slashpage | **Feedback / roadmap board** | **§0b (b)** — optional embed/link, free tier. Default is a GitHub-Issue button (§0b (a)). |
| Apollo.io, Hunter.io, RocketReach | **Contact / email finder** | **Phase 6** — outbound deep-link to *their* UI + the user's own free tier. We never call their API or hold a key. |
| Firebase / Supabase / any BaaS | **Backend / auth / sync** | **§11 — not used.** Breaks no-server / no-DB / "data never leaves your browser". Cross-device = export-import + `chrome.storage.sync` + optional user-owned GitHub Gist. |
| "Refer & earn" programs | **Growth / referral** | **§0b — rejected.** Needs accounts + backend + payouts. Share links + GitHub star only. |

---

## 10. Verdict on the "free AI" technical writeup

The research notes (the Gemini blueprint and the two follow-ups) are **technically accurate and
~80% congruent with this plan.** Point by point:

| Claim / suggestion | Verdict | What we take |
|---|---|---|
| **User-provided API keys, $0 to the host** | ✅ **Correct — the primary path.** | Already the plan (BYO-key). Adopt **Gemini AI Studio free tier as the default suggested provider** — it's $0 for the *user* too. |
| **Gemini free tier is "generous, no privacy cost"** | ⚠️ **Half-right.** Free tier is generous; but free-tier prompts *may be used by Google to improve products*. | Surface the caveat in the settings panel. Data-private users pick a paid key / Anthropic / OpenAI / local. |
| **Local in-browser LLM (WebLLM, Transformers.js) = $0** | ✅ **True**, ⚠️ **weight understated.** Useful-quality models are **~1–4 GB** first load, WebGPU for real speed — not "hundreds of MB". | Ship as an **opt-in** "private / offline AI" toggle, never the default. |
| **`window.print()` + `@media print` for PDF** | ✅ **Correct — use it.** Produces selectable-text (ATS-readable) PDFs, no library, no service. | Phase 1 export + Phase 5c already specify this. |
| **Puppeteer / WeasyPrint backend PDF** | ➖ **N/A** — we have no server. | Ignored. |
| **In-browser text extraction: `pdfjs-dist` `getTextContent()`** | ✅ **Correct.** Note `pdf-parse` / `pypdf` / `mammoth`(node) are **server-side**; browser needs `pdfjs-dist` + `mammoth`'s browser build for `.docx`. | Phase 1 import + Phase 5. |
| **Algorithmic scorer: extract → tokenize → stopword-strip → keyword match → regex metric/section/length checks → 0–100** | ✅ **Sound.** A Jobscan-class checker needs **no AI.** | This *is* Phase 5a/5b. Start with plain tokenized overlap + stopwords; add TF-IDF weighting only if the score feels off. |
| **ESCO skills dataset for the keyword dictionary** | ⚠️ **Real but heavier than needed.** | Reuse our maintained `detect_tech_tags` table + a small static `skills.json`; pull from ESCO/O*NET selectively only if we need breadth. |
| **JSON Resume schema (Resumake) as the data structure** | ✅ **Adopt it** as the `Profile` export/import interchange — free ecosystem interop, other OSS tools can read it. | Added to Phase 1 + `jsonResume.ts` in §2. |
| **"FlowCV/Resumake is the builder winner — clone it client-side"** | ➖ **Only the *base export* (Phase 5c).** We still don't build a design studio — low differentiation, high effort. | Clean single-column export + hand-off links. |

**Net:** adopt Gemini-free-tier-as-default, the JSON Resume schema, and the algorithmic-scorer
spec. Reject nothing else outright except "refer & earn" (can't be done under the guardrails).
The plan above already reflects these.

---

## 11. External services & accounts — what needs a sign-up, what doesn't

**The entire toolkit is designed to need zero accounts and zero hosted services.** Everything
below is either not needed, or optional and free.

| Service | Needed? | If used |
|---|---|---|
| **Firebase / Supabase / any backend-as-a-service** | ❌ **No — and recommend against.** | It would give real accounts + cross-device sync + server push, but it breaks the three things that *are* the product: no server, no database, "your data never leaves your browser". The vision doc and [EXTENSION-PLAN.md §5](EXTENSION-PLAN.md) reject accounts on purpose. Only revisit if you decide to change that core principle — a separate, bigger decision, not a toolkit detail. Until then: cross-device = **export/import JSON** + **`chrome.storage.sync`** (extension) + optional **user-owned GitHub Gist**. |
| **Featurebase** (or Canny) — feedback board | ⭕ **Optional.** Only if you want the polished Simplify-style board instead of / alongside the GitHub-Issue button. | One free account, one public project. Free tier: unlimited public posts, roadmap, changelog, unbranded, 3 admin seats. We embed the board in a `/feedback` route or just link it. No user PII flows through us. **If you want this, create the project and share the board slug** — I'll wire it. |
| **Google AI Studio** (Gemini key) | ⭕ **Not for shipping** — end users bring their own key. | Useful for *me* to test the BYO-key flow during Phase 4b/5d dev. You'd paste a free key the same way an end user would; it never gets committed. Optional, later. |
| **GitHub** | ✅ **Already have it.** | The feedback button and "★ star us" use the existing repo. GitHub Issues/Discussions = the zero-account feedback path. |
| **RSS reader, Discord/Slack/Telegram webhook** | — | The *user's* choice for alerts (Phase 3). Nothing to set up on our side. |
| **Anthropic / OpenAI / Ollama** | — | The *user's* own optional key/URL for AI polish. Not ours. |

**So the only thing you might sign up for is Featurebase**, and only if you want that specific
UX. Tell me and I'll integrate it; otherwise Phase «feedback» ships as the GitHub-Issue button.
