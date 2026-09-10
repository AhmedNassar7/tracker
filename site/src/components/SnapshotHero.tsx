import { BASE_URL } from "../lib/basePath";
import type { SiteIndexEntry } from "../lib/types";
import FreshnessPulse from "./FreshnessPulse";

// A compact, honest line above the list: how many opportunities are open and
// how fresh the data is. Per-slice counts (internships, remote, …) live in
// the filter bar and the dashboard, not here — this is just the headline.

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
    <section className="hero-enter mb-5">
      {isStale && (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          ⚠️ This list was last refreshed <strong>{updatedAgo(generatedAt)}</strong> — the automatic
          hourly update looks stuck, so some roles here may already be closed. Check the posting date
          before applying.
        </div>
      )}
      <p className="mb-1 text-sm text-slate-500 dark:text-slate-400">
        Software engineering{" "}
        <span className="tagline-rotate" aria-hidden="true">
          <span>jobs</span>
          <span>internships</span>
          <span>hackathons</span>
          <span>events</span>
        </span>
        <span className="sr-only">jobs, internships, hackathons and events</span> — refreshed hourly. No
        signup, no fabricated data.
      </p>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          {total.toLocaleString()}{" "}
          <span className="text-sm font-medium text-slate-500 dark:text-slate-400">open opportunities</span>
        </p>
        <p className="flex items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400">
          <FreshnessPulse />
          <span>updated {updatedAgo(generatedAt)}</span>
          {postedToday > 0 && <span>· {postedToday.toLocaleString()} added today</span>}
          <a
            href={`${BASE_URL}dashboard`}
            className="text-teal-700 underline-offset-2 hover:underline dark:text-teal-400"
          >
            · charts &amp; trends →
          </a>
        </p>
      </div>
    </section>
  );
}
