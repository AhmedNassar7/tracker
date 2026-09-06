import { useMemo } from "react";
import { BASE_URL } from "../lib/basePath";
import type { FilterState } from "../lib/filters";
import type { SiteIndexEntry } from "../lib/types";
import FreshnessPulse from "./FreshnessPulse";

// A small, honest header above the list: how many roles are open, how fresh
// the data is, and four one-tap shortcuts into the most-asked-for slices.
// Every number here is counted from the list right below it.

interface Props {
  items: SiteIndexEntry[];
  generatedAt: string;
  onQuickFilter: (patch: Partial<FilterState>) => void;
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
// stuck (a broken deploy, a failed run) and the list is drifting out of
// date — say so plainly, because that's exactly when "this link is closed"
// starts happening.
const STALE_AFTER_HOURS = 6;

export default function SnapshotHero({ items, generatedAt, onQuickFilter }: Props) {
  const { total, postedToday, chips } = useMemo(() => {
    const count = (pred: (i: SiteIndexEntry) => boolean) => items.filter(pred).length;
    return {
      total: items.length,
      postedToday: count((i) => i.kind === "job" && i.age === "0d"),
      chips: [
        { label: "Internships", value: count((i) => i.kind === "job" && i.level === "internship"), patch: { kind: "job", levels: ["internship"] } },
        { label: "New-grad", value: count((i) => i.kind === "job" && i.level === "new_grad"), patch: { kind: "job", levels: ["new_grad"] } },
        { label: "Remote", value: count((i) => i.remote_type === "remote"), patch: { kind: "job", remotes: ["remote"] } },
        { label: "Hackathons", value: count((i) => i.kind === "hackathon"), patch: { kind: "hackathon" } },
      ] as { label: string; value: number; patch: Partial<FilterState> }[],
    };
  }, [items]);

  const staleHours = hoursSince(generatedAt);
  const isStale = staleHours !== null && staleHours > STALE_AFTER_HOURS;

  return (
    <section className="hero-enter mb-6 rounded-xl border border-slate-200 bg-gradient-to-b from-teal-50/50 to-transparent p-5 dark:border-slate-800 dark:from-teal-950/30">
      {isStale && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          ⚠️ This list was last refreshed <strong>{updatedAgo(generatedAt)}</strong> — the automatic
          hourly update looks stuck, so some roles here may already be closed. Check the posting date on
          each before applying.
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div>
          <p className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-4xl">
            {total.toLocaleString()}{" "}
            <span className="text-base font-medium text-slate-600 dark:text-slate-300">open opportunities</span>
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-slate-500 dark:text-slate-400">
            <FreshnessPulse />
            <span>updated {updatedAgo(generatedAt)}</span>
            {postedToday > 0 && <span>· {postedToday.toLocaleString()} added today</span>}
          </p>
        </div>

        <a
          href={`${BASE_URL}dashboard`}
          className="rounded-md border border-slate-300 px-3.5 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-white dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
        >
          See charts &amp; trends →
        </a>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {chips.map((chip) => (
          <button
            key={chip.label}
            type="button"
            onClick={() => onQuickFilter(chip.patch)}
            className="rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-left transition-colors hover:border-teal-400 hover:bg-white dark:border-slate-800 dark:bg-slate-900/50 dark:hover:border-teal-600 dark:hover:bg-slate-900"
          >
            <span className="block text-lg font-semibold text-slate-900 dark:text-slate-100">
              {chip.value.toLocaleString()}
            </span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">{chip.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
