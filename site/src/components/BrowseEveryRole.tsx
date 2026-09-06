import { prettifyCompany } from "../lib/labels";
import type { SiteIndexEntry } from "../lib/types";

// B1 — the "aggregate links" lane. Some companies (Google, Meta, Microsoft,
// Apple, and a few MENA majors) run a bespoke careers site with no public,
// keyless feed the pipeline can enumerate role-by-role. Instead of leaving
// them looking empty, config/aggregate_links.yml gives each ONE hand-verified
// link to its own careers search, pre-filtered to early-career software
// roles. These arrive in site-index.json as kind:"board" and are rendered
// here — deliberately apart from the opportunity list, never counted as
// postings, so nothing here inflates a total or implies a specific role.

interface Props {
  boards: SiteIndexEntry[];
  // The list's free-text search — a board is shown when its company name
  // matches, so "google" surfaces the Google board alongside Google's real
  // postings (of which there are none to enumerate — that's the whole point).
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
    <section className="mb-6 rounded-lg border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/40">
      <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
        Browse every role directly
      </h2>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        These companies run their own careers site with no public feed to list role-by-role. Each link
        is a pre-filtered search on the company&apos;s own site for early-career software roles — not a
        single posting, so it isn&apos;t counted above.
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
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 transition-colors hover:border-teal-500 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-teal-500 dark:hover:text-teal-300"
              >
                {company}
                <span aria-hidden="true" className="text-xs text-slate-400">↗</span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
