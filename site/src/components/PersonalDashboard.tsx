import { useEffect, useMemo, useState } from "react";
import { BASE_URL } from "../lib/basePath";
import { FUNNEL_RAMP, REJECTED_COLOR, SINGLE_SERIES_COLOR } from "../lib/chartColors";
import {
  APPLICATION_STATUSES,
  listApplications,
  STATUS_LABELS,
  type ApplicationStatus,
  type TrackedApplication,
} from "../lib/tracker";
import BarList from "./BarList";
import StatTile from "./StatTile";

type LoadState = { status: "loading" } | { status: "loaded"; applications: TrackedApplication[] };

const FUNNEL_STAGES: ApplicationStatus[] = ["bookmarked", "applied", "oa", "interview", "offer"];

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function daysBetween(a: string, b: string): number {
  return Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

// Median days from one stage's first appearance to the very next status
// change after it, across every application that actually made that
// transition — real elapsed time read from statusHistory, never estimated.
// Records written before statusHistory existed have none (`?? []`), so
// they're simply excluded rather than treated as a zero-day transition.
function medianDaysFrom(applications: TrackedApplication[], fromStatus: ApplicationStatus): number | null {
  const durations: number[] = [];
  for (const app of applications) {
    const history = app.statusHistory ?? [];
    const idx = history.findIndex((change) => change.status === fromStatus);
    if (idx === -1 || idx + 1 >= history.length) continue;
    durations.push(daysBetween(history[idx].at, history[idx + 1].at));
  }
  return median(durations);
}

export default function PersonalDashboard() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    listApplications().then((applications) => {
      if (!cancelled) setState({ status: "loaded", applications });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    const applications = state.status === "loaded" ? state.applications : [];

    const funnelCounts = new Map<ApplicationStatus, number>();
    for (const status of APPLICATION_STATUSES) funnelCounts.set(status, 0);
    for (const app of applications) funnelCounts.set(app.status, (funnelCounts.get(app.status) ?? 0) + 1);

    const companyCounts = new Map<string, number>();
    for (const app of applications) companyCounts.set(app.company, (companyCounts.get(app.company) ?? 0) + 1);
    const topCompanies = [...companyCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

    // Frozen profile-match scores captured when each role was tracked.
    const scored = applications.filter((a) => typeof a.matchScore === "number");
    const matchBands = { strong: 0, fair: 0, weak: 0 };
    for (const a of scored) {
      const s = a.matchScore as number;
      if (s >= 70) matchBands.strong += 1;
      else if (s >= 40) matchBands.fair += 1;
      else matchBands.weak += 1;
    }
    const avgMatch = scored.length
      ? Math.round(scored.reduce((n, a) => n + (a.matchScore as number), 0) / scored.length)
      : null;

    return {
      funnelCounts,
      topCompanies,
      bookmarkedToApplied: medianDaysFrom(applications, "bookmarked"),
      appliedToNext: medianDaysFrom(applications, "applied"),
      scoredCount: scored.length,
      matchBands,
      avgMatch,
    };
  }, [state]);

  if (state.status === "loading") {
    return <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">Loading your dashboard…</p>;
  }

  if (state.applications.length === 0) {
    return (
      <p className="py-6 text-sm text-slate-500 dark:text-slate-400">
        No tracked applications yet. Bookmark a job from the{" "}
        <a href={BASE_URL} className="text-teal-700 underline-offset-2 hover:underline dark:text-teal-400">
          listings
        </a>{" "}
        to see your funnel here.
      </p>
    );
  }

  const { funnelCounts, topCompanies, bookmarkedToApplied, appliedToNext, scoredCount, matchBands, avgMatch } = stats;
  const total = state.applications.length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Tracked" value={total} />
        <StatTile label="Applied or further" value={total - (funnelCounts.get("bookmarked") ?? 0)} />
        <StatTile label="Offers" value={funnelCounts.get("offer") ?? 0} />
        <StatTile label="Rejected" value={funnelCounts.get("rejected") ?? 0} />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Funnel</h3>
        <BarList
          items={[
            ...FUNNEL_STAGES.map((status, i) => ({
              key: status,
              label: STATUS_LABELS[status],
              value: funnelCounts.get(status) ?? 0,
              color: FUNNEL_RAMP[i],
            })),
            {
              key: "rejected",
              label: STATUS_LABELS.rejected,
              value: funnelCounts.get("rejected") ?? 0,
              color: REJECTED_COLOR,
            },
          ]}
        />
      </div>

      {(bookmarkedToApplied !== null || appliedToNext !== null) && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {bookmarkedToApplied !== null && (
            <StatTile label="Median days to apply" value={Math.round(bookmarkedToApplied)} suffix="d" />
          )}
          {appliedToNext !== null && (
            <StatTile label="Median days to next update" value={Math.round(appliedToNext)} suffix="d" />
          )}
        </div>
      )}

      {scoredCount > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
            Match quality <span className="font-normal text-slate-400">· at track time</span>
          </h3>
          <BarList
            items={[
              { key: "strong", label: "Strong (70+)", value: matchBands.strong, color: SINGLE_SERIES_COLOR },
              { key: "fair", label: "Fair (40–69)", value: matchBands.fair, color: SINGLE_SERIES_COLOR },
              { key: "weak", label: "Weak (<40)", value: matchBands.weak, color: SINGLE_SERIES_COLOR },
            ]}
          />
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Average {avgMatch}% across {scoredCount} scored application{scoredCount === 1 ? "" : "s"}
            {matchBands.weak > matchBands.strong
              ? " — you're tracking more weak matches than strong ones."
              : "."}
          </p>
        </div>
      )}

      {topCompanies.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">By company</h3>
          <BarList
            items={topCompanies.map(([company, count]) => ({
              key: company,
              label: company,
              value: count,
              color: SINGLE_SERIES_COLOR,
            }))}
          />
        </div>
      )}
    </div>
  );
}
