import type { SiteIndexEntry } from "../lib/types";
import FreshnessPulse from "./FreshnessPulse";

// The page's hero, centered above the list: the product name, a one-line
// rotating descriptor, the open-count, and how fresh the data is. Per-slice
// counts (internships, remote, …) live in the filter bar and the dashboard,
// not here — this is just the headline.

interface Props {
  items: SiteIndexEntry[];
  generatedAt: string;
}

function hoursSince(iso: string): number | null {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, (Date.now() - then) / 3_600_000);
}

function updatedAgo(iso: string): string {
  const h = hoursSince(iso);
  if (h === null) return "recently";
  const mins = Math.round(h * 60);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(h);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

// The pipeline refreshes hourly. Past ~6h without an update, something is
// stuck and the list is drifting out of date — say so plainly.
const STALE_AFTER_HOURS = 6;

export default function SnapshotHero({ items, generatedAt }: Props) {
  const total = items.length;
  const postedToday = items.filter((i) => i.kind === "job" && i.age === "0d").length;
  const staleHours = hoursSince(generatedAt);
  const isStale = staleHours !== null && staleHours > STALE_AFTER_HOURS;

  return (
    <section className="hero-enter mb-6">
      {isStale && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-left text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          ⚠️ This list was last refreshed <strong>{updatedAgo(generatedAt)}</strong> — the automatic
          hourly update looks stuck, so some roles here may already be closed. Check the posting date
          before applying.
        </div>
      )}

      {/* Two columns on a wide-enough screen — brand/tagline on the left,
          the live count/freshness on the right, so the hero actually uses
          the page's width instead of one narrow centered column with two
          empty margins. Stacks (brand above stats, both centered) below
          md, where there isn't room for both side by side. */}
      <div className="flex flex-col items-center gap-5 text-center md:flex-row md:items-center md:justify-between md:gap-6 md:text-left">
        <div>
          <h1 className="flex items-center justify-center gap-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 md:justify-start">
            <svg aria-hidden="true" className="h-7 w-7 shrink-0" viewBox="0 0 128 128">
              <rect width="128" height="128" rx="28" className="fill-teal-700 dark:fill-teal-500" />
              <g fill="none" stroke="#fff" strokeWidth="9">
                <circle cx="64" cy="64" r="34" />
                <circle cx="64" cy="64" r="15" />
              </g>
              <circle cx="64" cy="64" r="6" fill="#fff" />
              <g stroke="#fff" strokeWidth="9" strokeLinecap="round">
                <path d="M64 18v14M64 96v14M18 64h14M96 64h14" />
              </g>
            </svg>
            Tracker
          </h1>

          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Software-Engineering{" "}
            <span className="tagline-rotate">
              <span className="tagline-sizer" aria-hidden="true">Internships</span>
              <span className="tagline-word" aria-hidden="true">Roles</span>
              <span className="tagline-word" aria-hidden="true">Internships</span>
              <span className="tagline-word" aria-hidden="true">Hackathons</span>
              <span className="tagline-word" aria-hidden="true">Events</span>
              <span className="sr-only">Roles, internships, hackathons and events</span>
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            Refreshed hourly · no signup · no fabricated data
          </p>
        </div>

        <div className="shrink-0 md:text-right">
          <p className="text-slate-900 dark:text-slate-50">
            <span className="align-baseline text-4xl font-bold tracking-tight tabular-nums">
              {total.toLocaleString()}
            </span>{" "}
            <span className="align-baseline text-sm font-medium text-slate-500 dark:text-slate-400">
              open opportunities
            </span>
          </p>

          <p className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400 md:justify-end">
            <FreshnessPulse />
            <span>Updated {updatedAgo(generatedAt)}</span>
            {postedToday > 0 && <span>· {postedToday.toLocaleString()} added today</span>}
          </p>
        </div>
      </div>
    </section>
  );
}
