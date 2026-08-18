import { useEffect, useMemo, useState } from "react";
import { fetchSiteIndex } from "../lib/dataSource";
import {
  applyFilters,
  DEFAULT_FILTERS,
  filtersFromSearchParams,
  searchParamsFromFilters,
  type FilterState,
} from "../lib/filters";
import { listApplications, STATUS_LABELS, trackApplication, untrackApplication, type TrackedApplication } from "../lib/tracker";
import type { SiteIndex, SiteIndexEntry } from "../lib/types";
import { readLastVisit, writeLastVisit } from "../lib/visitHistory";
import FilterBar from "./FilterBar";
import FreshnessPulse from "./FreshnessPulse";
import OpportunityTable from "./OpportunityTable";
import SkeletonTable from "./SkeletonTable";

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
  const [trackedApps, setTrackedApps] = useState<Map<string, TrackedApplication>>(new Map());
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [lastVisitAt, setLastVisitAt] = useState<string | null>(null);
  const [showOnlyNew, setShowOnlyNew] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSiteIndex()
      .then((data) => {
        if (cancelled) return;
        setState({ status: "loaded", data });

        // A prior visit (`at !== null`) is what makes "new" a meaningful
        // signal — on the very first-ever visit, everything is trivially
        // "new" against an empty baseline, which isn't useful information
        // and would just be noise. Compare, then immediately re-baseline
        // to this visit's full id set, so a same-session reload correctly
        // shows zero new (already seen) rather than re-flagging the same
        // items — the same behavior an inbox's "unread" count has.
        const lastVisit = readLastVisit();
        if (lastVisit.at !== null) {
          const freshIds = new Set(data.items.filter((item) => !lastVisit.ids.has(item.id)).map((item) => item.id));
          setNewIds(freshIds);
          setLastVisitAt(lastVisit.at);
        }
        writeLastVisit(data.items.map((item) => item.id), data.generated_at);
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
    listApplications().then((apps) => {
      if (!cancelled) setTrackedApps(new Map(apps.map((app) => [app.id, app])));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const trackedIds = useMemo(() => new Set(trackedApps.keys()), [trackedApps]);

  // Optimistic: the toggle updates on-screen state immediately, then fires
  // the IndexedDB write. A failure there is exceedingly unlikely at this
  // data size (no realistic quota pressure) and not worth blocking a click
  // on — this mirrors how the rest of the site treats local storage as
  // reliable-by-default.
  //
  // Un-tracking here calls the same delete this table's star button always
  // has — but by the time someone has moved a bookmark to "Interview" and
  // added notes on the /applications page, clicking the same star back on
  // this listings page would silently destroy that history with no warning
  // otherwise. Confirm only in that case; a plain bookmark toggle (still
  // "bookmarked" status, no notes) stays a single frictionless click.
  function handleToggleTrack(item: SiteIndexEntry) {
    const existing = trackedApps.get(item.id);
    if (existing) {
      const hasProgress = existing.status !== "bookmarked" || existing.notes.trim() !== "";
      if (
        hasProgress &&
        !window.confirm(
          `${item.company} — ${item.title} is marked "${STATUS_LABELS[existing.status]}"${
            existing.notes.trim() ? " with notes" : ""
          }. Remove it from your tracked applications? This can't be undone.`,
        )
      ) {
        return;
      }
      setTrackedApps((prev) => {
        const next = new Map(prev);
        next.delete(item.id);
        return next;
      });
      void untrackApplication(item.id);
    } else {
      const now = new Date().toISOString();
      const optimistic: TrackedApplication = {
        id: item.id,
        kind: item.kind,
        company: item.company,
        title: item.title,
        url: item.url,
        level: item.level,
        status: "bookmarked",
        notes: "",
        statusHistory: [{ status: "bookmarked", at: now }],
        addedAt: now,
        updatedAt: now,
      };
      setTrackedApps((prev) => new Map(prev).set(item.id, optimistic));
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
    const filtered = applyFilters(state.data.items, filters);
    return showOnlyNew ? filtered.filter((item) => newIds.has(item.id)) : filtered;
  }, [state, filters, showOnlyNew, newIds]);

  // Country has no fixed enum (curated-layer only, free-form per
  // job-entry.schema.json) — the filter dropdown is populated from
  // whatever countries actually exist in the loaded data, so it always
  // reflects real coverage and never lists a country with zero postings.
  const availableCountries = useMemo(() => {
    if (state.status !== "loaded") return [];
    const countries = new Set<string>();
    for (const item of state.data.items) {
      if (item.country) countries.add(item.country);
    }
    return [...countries].sort((a, b) => a.localeCompare(b));
  }, [state]);

  if (state.status === "loading") {
    return <SkeletonTable label="Loading opportunities…" />;
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
      <p className="mb-4 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <FreshnessPulse />
        {data.count.toLocaleString()} opportunities tracked · data as of{" "}
        {formatGeneratedAt(data.generated_at)}
      </p>

      {newIds.size > 0 && !bannerDismissed && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-teal-200 bg-teal-50 px-4 py-2.5 text-sm dark:border-teal-900 dark:bg-teal-950">
          <span className="text-teal-900 dark:text-teal-100">
            <strong>{newIds.size.toLocaleString()}</strong> new since your last visit
            {lastVisitAt && <> ({formatGeneratedAt(lastVisitAt)})</>}
          </span>
          <button
            type="button"
            onClick={() => setShowOnlyNew((v) => !v)}
            aria-pressed={showOnlyNew}
            className={
              "rounded-full border px-3 py-0.5 text-xs font-medium " +
              (showOnlyNew
                ? "border-teal-700 bg-teal-700 text-white dark:border-teal-600 dark:bg-teal-600"
                : "border-teal-300 text-teal-800 hover:bg-teal-100 dark:border-teal-700 dark:text-teal-200 dark:hover:bg-teal-900")
            }
          >
            {showOnlyNew ? "Showing only new" : "Show only new"}
          </button>
          <button
            type="button"
            onClick={() => {
              setBannerDismissed(true);
              // Dismissing hides the "Show only new" toggle along with it —
              // reset so dismissing never leaves the list silently stuck
              // filtered to new-only with no visible way to undo it.
              setShowOnlyNew(false);
            }}
            className="ml-auto text-teal-700 hover:text-teal-900 dark:text-teal-300 dark:hover:text-teal-100"
            aria-label="Dismiss"
          >
            Dismiss
          </button>
        </div>
      )}

      <FilterBar
        filters={filters}
        onChange={setFilters}
        resultCount={filteredItems.length}
        availableCountries={availableCountries}
      />

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
