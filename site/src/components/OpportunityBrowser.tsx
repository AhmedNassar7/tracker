import { useEffect, useMemo, useState } from "react";
import { fetchSiteIndex } from "../lib/dataSource";
import {
  applyFilters,
  DEFAULT_FILTERS,
  filtersFromSearchParams,
  searchParamsFromFilters,
  type FilterState,
} from "../lib/filters";
import { trackApplication, trackedIdSet, untrackApplication } from "../lib/tracker";
import type { SiteIndex, SiteIndexEntry } from "../lib/types";
import FilterBar from "./FilterBar";
import OpportunityTable from "./OpportunityTable";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; data: SiteIndex };

const PAGE_SIZE = 50;

function formatGeneratedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

// Astro renders this island with no server-side URL to read, so filters
// start at the default and get replaced by whatever's in the address bar
// on mount (client-only, matches how the data fetch itself already works).
function readFiltersFromLocation(): FilterState {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  return filtersFromSearchParams(new URLSearchParams(window.location.search));
}

export default function OpportunityBrowser() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  // Lazy initializer, not a post-mount effect: reading the URL synchronously
  // on the first render (both the server-rendered pass, where the window
  // guard falls back to defaults, and the client hydration pass) avoids a
  // render where filters are briefly the defaults — which would otherwise
  // race the URL-sync effect below into clobbering a real incoming query
  // string with an empty one for one commit before self-correcting.
  const [filters, setFilters] = useState<FilterState>(() => readFiltersFromLocation());
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [trackedIds, setTrackedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    fetchSiteIndex()
      .then((data) => {
        if (!cancelled) setState({ status: "loaded", data });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Unknown error",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    trackedIdSet().then((ids) => {
      if (!cancelled) setTrackedIds(ids);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Optimistic: the toggle updates on-screen state immediately, then fires
  // the IndexedDB write. A failure there is exceedingly unlikely at this
  // data size (no realistic quota pressure) and not worth blocking a click
  // on — this mirrors how the rest of the site treats local storage as
  // reliable-by-default.
  function handleToggleTrack(item: SiteIndexEntry) {
    const isTracked = trackedIds.has(item.id);
    setTrackedIds((prev) => {
      const next = new Set(prev);
      if (isTracked) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
    if (isTracked) {
      void untrackApplication(item.id);
    } else {
      void trackApplication(item);
    }
  }

  // replaceState, not pushState — a filtered view is still a link someone
  // can copy and share, but adjusting a dropdown shouldn't spam the
  // browser's back-button history with every keystroke.
  useEffect(() => {
    const query = searchParamsFromFilters(filters).toString();
    const next = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState(null, "", next);
  }, [filters]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filters]);

  const filteredItems = useMemo(() => {
    if (state.status !== "loaded") return [];
    return applyFilters(state.data.items, filters);
  }, [state, filters]);

  if (state.status === "loading") {
    return <p className="py-10 text-center text-slate-500 dark:text-slate-400">Loading opportunities…</p>;
  }

  if (state.status === "error") {
    return (
      <p className="py-10 text-center text-red-600 dark:text-red-400">
        Couldn't load listings right now ({state.message}). Try refreshing, or browse{" "}
        <a
          className="underline"
          href="https://github.com/AhmedNassar7/tracker/blob/main/data/README.md"
        >
          data/README.md
        </a>{" "}
        directly.
      </p>
    );
  }

  const { data } = state;
  const visibleItems = filteredItems.slice(0, visibleCount);
  const hasMore = visibleCount < filteredItems.length;

  return (
    <div>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        {data.count.toLocaleString()} opportunities tracked · data as of{" "}
        {formatGeneratedAt(data.generated_at)}
      </p>

      <FilterBar filters={filters} onChange={setFilters} resultCount={filteredItems.length} />

      {filteredItems.length === 0 ? (
        <p className="py-10 text-center text-slate-500 dark:text-slate-400">No results match these filters.</p>
      ) : (
        <>
          <OpportunityTable items={visibleItems} trackedIds={trackedIds} onToggleTrack={handleToggleTrack} />
          {hasMore && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"
              >
                Load more ({(filteredItems.length - visibleCount).toLocaleString()} remaining)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
