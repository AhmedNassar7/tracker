// E2 — the Cmd/Ctrl-K command palette's data + ranking, kept free of React and
// the DOM so it's testable on its own. The component (CommandPalette.tsx) only
// renders and executes; what the commands ARE and which ones match a query
// lives here.
//
// Nothing here invents data: filter commands build their links through the
// same searchParamsFromFilters() the story cards and shareable URLs use, labels
// come from labels.ts (the wording the filter bar shows), and company commands
// are derived from the live site-index — a company only appears if it has a
// real job row right now.

import { DEFAULT_FILTERS, searchParamsFromFilters, type FilterState } from "./filters";
import { LEVEL_LABELS, REGION_LABELS, ROLE_LABELS, prettifyCompany } from "./labels";
import type { SiteIndexEntry } from "./types";

export type CommandGroup = "Go to" | "Filter jobs" | "Actions" | "Companies" | "Search";

export type CommandRun =
  | { type: "navigate"; href: string }
  | { type: "action"; action: "toggle-theme" | "copy-link" | "install-app" };

export interface Command {
  id: string;
  group: CommandGroup;
  label: string;
  /** Secondary text shown to the right ("142 open roles"). */
  hint?: string;
  /** Extra words that should match but aren't shown ("remote wfh" for Remote). */
  keywords?: string;
  run: CommandRun;
}

/** Display order of groups in the result list. */
export const GROUP_ORDER: CommandGroup[] = ["Go to", "Filter jobs", "Actions", "Companies", "Search"];

function jobsHref(base: string, patch: Partial<FilterState>): string {
  const params = searchParamsFromFilters({ ...DEFAULT_FILTERS, ...patch }).toString();
  return params ? `${base}?${params}` : base;
}

/** The fixed commands. `base` is BASE_URL (always ends with "/"). */
export function buildStaticCommands(base: string): Command[] {
  const nav = (id: string, label: string, path: string, keywords = ""): Command => ({
    id,
    group: "Go to",
    label,
    keywords,
    run: { type: "navigate", href: `${base}${path}` },
  });
  const filter = (id: string, label: string, patch: Partial<FilterState>, keywords = ""): Command => ({
    id,
    group: "Filter jobs",
    label,
    keywords,
    run: { type: "navigate", href: jobsHref(base, patch) },
  });

  return [
    nav("go-jobs", "Jobs", "", "home list opportunities all"),
    nav("go-dashboard", "Dashboard", "dashboard", "stats trends charts hiring"),
    nav("go-profile", "My Workspace — Profile", "profile", "resume cv vault workspace"),
    nav("go-applications", "My Workspace — Applications", "applications", "tracker kanban applied board"),
    nav("go-resume", "Résumé keyword check", "toolkit/resume", "resume cv ats keywords gap toolkit"),
    nav("go-cover-letter", "Cover letter builder", "toolkit/cover-letter", "letter toolkit"),

    filter("f-internship", `${LEVEL_LABELS.internship} roles`, { levels: ["internship"] }, "intern summer co-op"),
    filter("f-new-grad", `${LEVEL_LABELS.new_grad} roles`, { levels: ["new_grad"] }, "graduate fresh grad campus"),
    filter("f-junior", `${LEVEL_LABELS.junior} roles`, { levels: ["junior"] }, "jr"),
    filter("f-entry", `${LEVEL_LABELS.entry_level} roles`, { levels: ["entry_level"] }, "associate beginner"),
    filter("f-early", "Early career (intern + new grad + junior + entry)", {
      levels: ["internship", "new_grad", "junior", "entry_level"],
    }, "beginner starter"),
    filter("f-remote", "Remote roles", { remotes: ["remote"] }, "wfh work from home"),
    filter("f-visa", "Visa sponsorship offered", { visa: "yes" }, "relocation sponsor h1b work permit"),
    filter("f-mena", `Region: ${REGION_LABELS.mena}`, { regions: ["mena"] }, "mena egypt gulf uae saudi cairo dubai arab africa"),
    filter("f-europe", `Region: ${REGION_LABELS.europe}`, { regions: ["europe"] }, "eu uk germany"),
    filter("f-na", `Region: ${REGION_LABELS.north_america}`, { regions: ["north_america"] }, "us usa canada america"),
    filter("f-apac", `Region: ${REGION_LABELS.apac}`, { regions: ["apac"] }, "asia india japan singapore australia"),
    filter("f-latam", `Region: ${REGION_LABELS.latam}`, { regions: ["latam"] }, "latin america brazil mexico"),
    filter("f-backend", `${ROLE_LABELS.backend} roles`, { roles: ["backend"] }, "server api"),
    filter("f-frontend", `${ROLE_LABELS.frontend} roles`, { roles: ["frontend"] }, "ui web react"),
    filter("f-fullstack", `${ROLE_LABELS.full_stack} roles`, { roles: ["full_stack"] }, "full stack"),
    filter("f-mobile", `${ROLE_LABELS.mobile} roles`, { roles: ["mobile"] }, "ios android"),
    filter("f-infra", `${ROLE_LABELS.infrastructure} roles`, { roles: ["infrastructure"] }, "devops sre cloud"),
    {
      id: "f-hackathons",
      group: "Filter jobs",
      label: "Hackathons",
      keywords: "hack devpost devfolio unstop",
      run: { type: "navigate", href: jobsHref(base, { kind: "hackathon" }) },
    },
    {
      id: "f-events",
      group: "Filter jobs",
      label: "Events & conferences",
      keywords: "conference summit meetup",
      run: { type: "navigate", href: jobsHref(base, { kind: "event" }) },
    },

    {
      id: "a-theme",
      group: "Actions",
      label: "Toggle light / dark theme",
      keywords: "dark mode light appearance",
      run: { type: "action", action: "toggle-theme" },
    },
    {
      id: "a-copy-link",
      group: "Actions",
      label: "Copy link to this page",
      keywords: "share url clipboard",
      run: { type: "action", action: "copy-link" },
    },
  ];
}

/** Only offered when the browser has actually handed us an install prompt
 *  (Chromium, not yet installed) — the component adds it conditionally. */
export const INSTALL_COMMAND: Command = {
  id: "a-install",
  group: "Actions",
  label: "Install tracker as an app",
  keywords: "pwa home screen add desktop app",
  run: { type: "action", action: "install-app" },
};

/** One command per company that has at least one open *job* right now, grouped
 *  by display name (an ATS posts one employer as "Amazon.com Services LLC",
 *  "Amazon Advertising LLC" … — the company page treats those as one). The
 *  href is the same `company?c=<display name>` link the table uses. */
export function buildCompanyCommands(items: SiteIndexEntry[], base: string): Command[] {
  const byName = new Map<string, { count: number; raw: Set<string> }>();
  for (const item of items) {
    if (item.kind !== "job" || !item.company) continue;
    const name = prettifyCompany(item.company);
    if (!name) continue;
    const entry = byName.get(name) ?? { count: 0, raw: new Set<string>() };
    entry.count += 1;
    entry.raw.add(item.company);
    byName.set(name, entry);
  }
  return [...byName.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .map(([name, { count, raw }]) => ({
      id: `company:${name}`,
      group: "Companies" as const,
      label: name,
      hint: `${count.toLocaleString()} open ${count === 1 ? "role" : "roles"}`,
      keywords: [...raw].join(" "),
      run: { type: "navigate" as const, href: `${base}company?c=${encodeURIComponent(name)}` },
    }));
}

/** The "search the job list for what I typed" fallback, shown whenever there's
 *  a query so Enter always does *something* useful. */
export function buildSearchCommand(query: string, base: string): Command | null {
  const q = query.trim();
  if (!q) return null;
  return {
    id: "search-jobs",
    group: "Search",
    label: `Search all listings for “${q}”`,
    run: { type: "navigate", href: jobsHref(base, { q }) },
  };
}

function norm(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

/** Score one query token against one string; 0 = no match.
 *  prefix of the whole string > start of a word > anywhere > in-order letters
 *  (typo-tolerant, tokens of 4+, tight window only). */
function tokenScore(token: string, text: string): number {
  if (!token) return 0;
  if (text.startsWith(token)) return 100;
  if (new RegExp(`(?:^|[^a-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(text)) return 60;
  if (text.includes(token)) return 30;
  // Typo tolerance ("strpe" -> Stripe): the token's letters in order, but only
  // within a tight window. Letters scattered across a long string ("mena" in
  // "sonyinteractiveentertainmentglobal") are noise, not a typo.
  if (token.length >= 4) {
    const slack = 2;
    for (let start = text.indexOf(token[0]); start !== -1; start = text.indexOf(token[0], start + 1)) {
      let i = 1;
      let end = start;
      for (let j = start + 1; j < text.length && i < token.length; j++) {
        if (text[j] === token[i]) {
          i++;
          end = j;
        }
      }
      if (i === token.length && end - start + 1 <= token.length + slack) return 8;
    }
  }
  return 0;
}

/** Every whitespace-separated token must match the label or keywords; the label
 *  counts double so a title hit outranks a hidden-keyword hit. 0 = no match. */
export function matchScore(query: string, command: Pick<Command, "label" | "keywords">): number {
  const tokens = norm(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 1;
  const label = norm(command.label);
  const keywords = norm(command.keywords ?? "");
  let total = 0;
  for (const token of tokens) {
    const inLabel = tokenScore(token, label);
    const inKeywords = tokenScore(token, keywords);
    const best = Math.max(inLabel * 2, inKeywords);
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

/** Filter + rank commands for a query. With an empty query it returns the
 *  curated default view — the static commands in their authored order, with
 *  no companies (hundreds of rows aren't a useful empty state). Results keep
 *  their group order (GROUP_ORDER) so the list reads as sections; within a
 *  group, best score first, ties in original order (stable). */
export function rankCommands(commands: Command[], query: string, limit = 30): Command[] {
  const q = query.trim();
  const scored = commands
    .filter((c) => q !== "" || c.group !== "Companies")
    .map((c, index) => ({ c, index, score: matchScore(q, c) }))
    .filter((x) => x.score > 0);
  const groupRank = (g: CommandGroup) => GROUP_ORDER.indexOf(g);
  scored.sort(
    (a, b) =>
      groupRank(a.c.group) - groupRank(b.c.group) ||
      (q === "" ? 0 : b.score - a.score) ||
      a.index - b.index,
  );
  // Cap per list, but never let the cap swallow a group entirely: a broad
  // query like "a" would otherwise fill all 30 slots with companies.
  const perGroupCap = Math.max(4, Math.ceil(limit / 2));
  const counts = new Map<CommandGroup, number>();
  const out: Command[] = [];
  for (const { c } of scored) {
    const n = counts.get(c.group) ?? 0;
    if (n >= perGroupCap || out.length >= limit) continue;
    counts.set(c.group, n + 1);
    out.push(c);
  }
  return out;
}
