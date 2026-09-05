import { useEffect, useMemo, useState } from "react";
import { fetchStatsHistory } from "../lib/dataSource";
import type { FilterState } from "../lib/filters";
import type { SiteIndexEntry, StatsHistory } from "../lib/types";
import FreshnessPulse from "./FreshnessPulse";
import TrendLine from "./TrendLine";

// The hero above the opportunity list. Every element states a real fact from
// the loaded data or the 90-day history file — the open count, what was
// posted today, the level mix, the 30-day trend — so the reader gets the
// shape of the board before scrolling. Not a marketing banner: no claim
// here isn't backed by a number on the page.

interface Props {
  items: SiteIndexEntry[];
  generatedAt: string;
  onQuickFilter: (patch: Partial<FilterState>) => void;
}

function minutesAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "recently";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

interface Stat {
  label: string;
  value: number;
  patch: Partial<FilterState>;
}

export default function SnapshotHero({ items, generatedAt, onQuickFilter }: Props) {
  const [history, setHistory] = useState<StatsHistory | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Independent of the main list load — a missing/stale history file just
    // hides the sparkline, it never blocks the hero counts.
    fetchStatsHistory()
      .then((data) => !cancelled && setHistory(data))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const { totalOpen, postedToday, stats } = useMemo(() => {
    const jobs = items.filter((i) => i.kind === "job");
    const count = (pred: (i: SiteIndexEntry) => boolean) => items.filter(pred).length;
    return {
      totalOpen: items.length,
      postedToday: jobs.filter((i) => i.age === "0d").length,
      stats: [
        { label: "Internships", value: count((i) => i.kind === "job" && i.level === "internship"), patch: { kind: "job", level: "internship" } },
        { label: "New-grad roles", value: count((i) => i.kind === "job" && i.level === "new_grad"), patch: { kind: "job", level: "new_grad" } },
        { label: "Remote", value: count((i) => i.remote_type === "remote"), patch: { kind: "job", remote: "remote" } },
        { label: "Hackathons", value: count((i) => i.kind === "hackathon"), patch: { kind: "hackathon" } },
      ] as Stat[],
    };
  }, [items]);

  const trendPoints = useMemo(() => {
    if (!history) return [];
    return history.snapshots
      .slice(-30)
      .map((s) => ({ at: s.at, value: s.total_items }));
  }, [history]);

  const firstTrend = trendPoints[0]?.value ?? 0;
  const lastTrend = trendPoints[trendPoints.length - 1]?.value ?? 0;
  const trendDelta = lastTrend - firstTrend;

  return (
    <section className="hero-enter mb-8 rounded-xl border border-slate-200 bg-gradient-to-b from-teal-50/60 to-transparent p-5 dark:border-slate-800 dark:from-teal-950/40 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-5xl">
              {totalOpen.toLocaleString()}
            </span>
            <span className="text-base font-medium text-slate-600 dark:text-slate-300">open opportunities</span>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
            <FreshnessPulse />
            <span>updated {minutesAgo(generatedAt)}</span>
            {postedToday > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => onQuickFilter({ kind: "job" })}
                  className="font-medium text-teal-700 underline-offset-2 hover:underline dark:text-teal-400"
                >
                  {postedToday.toLocaleString()} posted today
                </button>
              </>
            )}
          </p>
        </div>

        <a
          href="/dashboard"
          className="rounded-md border border-teal-700 bg-teal-700 px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-teal-800 dark:border-teal-600 dark:bg-teal-600 dark:hover:bg-teal-500"
        >
          Explore the data →
        </a>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map((stat) => (
          <button
            key={stat.label}
            type="button"
            onClick={() => onQuickFilter(stat.patch)}
            className="rounded-lg border border-slate-200 bg-white/70 p-3 text-left transition-colors hover:border-teal-400 hover:bg-white dark:border-slate-800 dark:bg-slate-900/50 dark:hover:border-teal-600 dark:hover:bg-slate-900"
          >
            <div className="text-xl font-semibold text-slate-900 dark:text-slate-100">{stat.value.toLocaleString()}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{stat.label}</div>
          </button>
        ))}
      </div>

      {trendPoints.length >= 2 && (
        <div className="mt-5">
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Opportunities tracked · last {trendPoints.length} days
            </h2>
            {trendDelta !== 0 && (
              <span className={"text-xs font-medium " + (trendDelta > 0 ? "text-teal-700 dark:text-teal-400" : "text-slate-500 dark:text-slate-400")}>
                {trendDelta > 0 ? "+" : ""}
                {trendDelta.toLocaleString()} vs {trendPoints.length} days ago
              </span>
            )}
          </div>
          <TrendLine points={trendPoints} label="Total opportunities tracked" />
        </div>
      )}
    </section>
  );
}
