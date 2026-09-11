import type { SiteIndexEntry } from "../lib/types";
import FreshnessPulse from "./FreshnessPulse";

// The page's tagline strip, centered above the list. The brand name and the
// live open-count both already live in the header on every page (HeaderStat)
// — repeating "Tracker" and the count again here was the same two facts
// twice on the same screen. This is what's left that the header doesn't
// already say: what the list actually covers, and how fresh it is.

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
  const postedToday = items.filter((i) => i.kind === "job" && i.age === "0d").length;
  const staleHours = hoursSince(generatedAt);
  const isStale = staleHours !== null && staleHours > STALE_AFTER_HOURS;

  return (
    <section className="hero-enter mx-auto mb-6 max-w-xl text-center">
      {isStale && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-left text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          ⚠️ This list was last refreshed <strong>{updatedAgo(generatedAt)}</strong> — the automatic
          hourly update looks stuck, so some roles here may already be closed. Check the posting date
          before applying.
        </div>
      )}

      <p className="text-sm text-slate-500 dark:text-slate-400">
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

      <p className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
        <FreshnessPulse />
        <span>Updated {updatedAgo(generatedAt)}</span>
        {postedToday > 0 && <span>· {postedToday.toLocaleString()} added today</span>}
      </p>
    </section>
  );
}
