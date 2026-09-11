import { useEffect, useState } from "react";
import { fetchCounts } from "../lib/dataSource";
import { BASE_URL } from "../lib/basePath";
import FreshnessPulse from "./FreshnessPulse";
import Skeleton from "./Skeleton";

// The header's right-hand cluster, on every page (not just the homepage,
// where SnapshotHero already shows the big version of this number). Reads
// data/counts.json — a few hundred bytes — rather than the multi-MB
// site-index.json, since a page that isn't already loading the full item
// list (e.g. /profile, /applications) shouldn't have to pull it just for
// this chip. Renders nothing on a fetch failure — a missing stat chip is
// never worth breaking the header over.
type State = { status: "loading" } | { status: "error" } | { status: "loaded"; total: number };

export default function HeaderStat() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchCounts()
      .then((counts) => {
        if (!cancelled) setState({ status: "loaded", total: counts.total });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "error") return null;

  return (
    <a
      href={BASE_URL}
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-teal-300 hover:bg-teal-50/60 dark:border-slate-700 dark:text-slate-300 dark:hover:border-teal-800 dark:hover:bg-teal-950/40"
      aria-label={state.status === "loaded" ? `${state.total.toLocaleString()} open opportunities — go to the jobs list` : "Loading open-opportunity count"}
    >
      {state.status === "loading" ? (
        <Skeleton className="h-3.5 w-16" />
      ) : (
        <>
          <FreshnessPulse />
          <span className="tabular-nums text-slate-900 dark:text-slate-100">{state.total.toLocaleString()}</span>
          <span className="hidden sm:inline">open</span>
        </>
      )}
    </a>
  );
}
