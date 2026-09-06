import { useEffect, useMemo, useState } from "react";
import { fetchSiteIndex, fetchStatsHistory } from "../lib/dataSource";
import { SINGLE_SERIES_COLOR } from "../lib/chartColors";
import type { SiteIndex, StatsHistory } from "../lib/types";
import BarList from "./BarList";
import StatTile from "./StatTile";
import TrendLine from "./TrendLine";
import { LEVEL_LABELS } from "../lib/labels";

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "loaded"; data: SiteIndex };

// Independent of the main load state — a stale or missing history file
// (e.g. before this feature's first hourly run) shouldn't block the rest
// of the dashboard from rendering.
type HistoryState = { status: "loading" | "error" } | { status: "loaded"; data: StatsHistory };

const REGION_LABELS: Record<string, string> = {
  us: "United States",
  canada: "Canada",
  mena: "Middle East & Africa",
  emea: "EMEA",
  remote: "Remote",
  unknown: "Unknown",
};

function formatGeneratedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function topEntries(counts: Map<string, number>, limit: number): [string, number][] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

export default function GlobalDashboard() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [historyState, setHistoryState] = useState<HistoryState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchSiteIndex()
      .then((data) => {
        if (!cancelled) setState({ status: "loaded", data });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: err instanceof Error ? err.message : "Unknown error" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchStatsHistory()
      .then((data) => {
        if (!cancelled) setHistoryState({ status: "loaded", data });
      })
      .catch(() => {
        if (!cancelled) setHistoryState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    // kind:"board" rows (aggregate_links.yml) aren't opportunities — keep
    // them out of every count, region/level/source breakdown.
    const items = state.status === "loaded" ? state.data.items.filter((i) => i.kind !== "board") : [];

    const kindCounts = new Map<string, number>();
    const regionCounts = new Map<string, number>();
    const levelCounts = new Map<string, number>();
    const sourceCounts = new Map<string, number>();

    for (const item of items) {
      kindCounts.set(item.kind, (kindCounts.get(item.kind) ?? 0) + 1);
      sourceCounts.set(item.source, (sourceCounts.get(item.source) ?? 0) + 1);
      if (item.region) regionCounts.set(item.region, (regionCounts.get(item.region) ?? 0) + 1);
      if (item.level) levelCounts.set(item.level, (levelCounts.get(item.level) ?? 0) + 1);
    }

    return { kindCounts, regionCounts, levelCounts, sourceCounts };
  }, [state]);

  if (state.status === "loading") {
    return <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">Loading tracker overview…</p>;
  }

  if (state.status === "error") {
    return (
      <p className="py-6 text-sm text-red-600 dark:text-red-400">
        Couldn't load overview data right now ({state.message}).
      </p>
    );
  }

  const { data } = state;
  const { kindCounts, regionCounts, levelCounts, sourceCounts } = stats;

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Data as of {formatGeneratedAt(data.generated_at)}
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Total tracked" value={data.count} />
        <StatTile label="Jobs" value={kindCounts.get("job") ?? 0} />
        <StatTile label="Hackathons" value={kindCounts.get("hackathon") ?? 0} />
        <StatTile label="Events" value={kindCounts.get("event") ?? 0} />
      </div>

      {historyState.status === "loaded" && historyState.data.snapshots.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
            Total opportunities over time
          </h3>
          <TrendLine
            label="Total opportunities tracked"
            points={historyState.data.snapshots.map((snapshot) => ({ at: snapshot.at, value: snapshot.total_items }))}
          />
        </div>
      )}

      {regionCounts.size > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Jobs by region</h3>
          <BarList
            items={topEntries(regionCounts, 6).map(([region, count]) => ({
              key: region,
              label: REGION_LABELS[region] ?? region,
              value: count,
              color: SINGLE_SERIES_COLOR,
            }))}
          />
        </div>
      )}

      {levelCounts.size > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Jobs by level</h3>
          <BarList
            items={topEntries(levelCounts, 7).map(([level, count]) => ({
              key: level,
              label: LEVEL_LABELS[level] ?? level,
              value: count,
              color: SINGLE_SERIES_COLOR,
            }))}
          />
        </div>
      )}

      {sourceCounts.size > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Top sources</h3>
          <BarList
            items={topEntries(sourceCounts, 8).map(([source, count]) => ({
              key: source,
              label: source,
              value: count,
              color: SINGLE_SERIES_COLOR,
            }))}
          />
        </div>
      )}
    </div>
  );
}
