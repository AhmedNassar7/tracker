import { prettifyCompany } from "../lib/labels";
import type { SiteIndexEntry } from "../lib/types";

// B1 — the "aggregate links" lane. Some companies (Google, Meta, Microsoft,
// Apple, and a few MENA majors) run a bespoke careers site with no public,
// keyless feed the pipeline can enumerate role-by-role. Instead of leaving
// them looking empty, config/aggregate_links.yml gives each ONE hand-verified
// link to its own careers search, pre-filtered to early-career software
// roles. These arrive in site-index.json as kind:"board".
//
// Rendered as a quiet footer block *below* the list and pagination — never
// interleaved with real postings, never counted, so it can't inflate a total
// or imply a specific role. It's a "if your target isn't here, go straight to
// their site" resource, not part of the results.

interface Props {
  boards: SiteIndexEntry[];
  // The list's free-text search — a board is shown when its company name
  // matches, so "google" surfaces the Google board even though there are no
  // Google postings to enumerate (that's the whole point).
  query: string;
}

export default function BrowseEveryRole({ boards, query }: Props) {
  if (boards.length === 0) return null;
  const q = query.trim().toLowerCase();
  const shown = q
    ? boards.filter((b) => `${b.company} ${b.title}`.toLowerCase().includes(q))
    : boards;
  if (shown.length === 0) return null;

  return (
    <section
      aria-label="Companies to check directly"
      className="mt-10 border-t border-slate-200 pt-6 dark:border-slate-800"
    >
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
        <span aria-hidden="true">🔎</span> Check these {shown.length} directly
      </h2>
      <p className="mt-1 max-w-2xl text-xs text-slate-500 dark:text-slate-400">
        These companies run a bespoke careers site with no feed to pull role-by-role. Each link opens a
        pre-filtered early-career software search on the company&apos;s own site — not a single posting, so
        nothing here is counted in the list.
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {shown.map((b) => {
          const company = prettifyCompany(b.company);
          return (
            <li key={b.id}>
              <a
                href={b.url}
                target="_blank"
                rel="noopener noreferrer"
                title={b.title}
                className="group inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 transition-all hover:-translate-y-0.5 hover:border-teal-500 hover:text-teal-700 hover:shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-teal-500 dark:hover:text-teal-300"
              >
                {company}
                <span
                  aria-hidden="true"
                  className="text-xs text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-teal-500"
                >
                  ↗
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
