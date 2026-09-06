import { useEffect, useMemo, useState } from "react";
import { fetchSiteIndex, fetchStoryCards } from "../lib/dataSource";
import {
  applyFilters,
  DEFAULT_FILTERS,
  filtersFromSearchParams,
  hasActiveFilters,
  searchParamsFromFilters,
  type FilterState,
} from "../lib/filters";
import { listApplications, STATUS_LABELS, trackApplication, untrackApplication, type TrackedApplication } from "../lib/tracker";
import {
  hasPreferences,
  isExcluded,
  matchReasons,
  readPreferences,
  readSortMode,
  scoreOpportunity,
  writePreferences,
  writeSortMode,
  type Preferences,
  type SortMode,
} from "../lib/preferences";
import type { SiteIndex, SiteIndexEntry, StoryCard } from "../lib/types";
import { companyTier } from "../lib/companyTiers";
import { readLastVisit, writeLastVisit } from "../lib/visitHistory";
import { addDismissed, clearDismissed, readDismissed, removeDismissed } from "../lib/dismissed";
import Pagination from "./Pagination";

function ageToDays(age: string): number {
  const a = (age || "").trim().toLowerCase();
  let m: RegExpMatchArray | null;
  if ((m = a.match(/^(\d+)d$/))) return +m[1];
  if ((m = a.match(/^(\d+)mo$/))) return +m[1] * 30;
  if ((m = a.match(/^(\d+)yrs?$/))) return +m[1] * 365;
  return Number.MAX_SAFE_INTEGER;
}
import BrowseEveryRole from "./BrowseEveryRole";
import StoryStrip from "./StoryStrip";
import FilterBar from "./FilterBar";
import OpportunityTable from "./OpportunityTable";
import PreferencesPanel from "./PreferencesPanel";
import SavedSearches from "./SavedSearches";
import SkeletonTable from "./SkeletonTable";
import SnapshotHero from "./SnapshotHero";

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
  const [page, setPage] = useState(1);
  const [trackedApps, setTrackedApps] = useState<Map<string, TrackedApplication>>(new Map());
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [lastVisitAt, setLastVisitAt] = useState<string | null>(null);
  const [showOnlyNew, setShowOnlyNew] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [prefs, setPrefs] = useState<Preferences>(() => readPreferences());
  const [sortMode, setSortMode] = useState<SortMode>(() => readSortMode());
  // C2 — "not interested" ids (localStorage). `showDismissed` flips the list
  // to *only* those, so a viewer can review and undo.
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => readDismissed());
  const [showDismissed, setShowDismissed] = useState(false);
  // D1 — auto-generated story cards. Non-critical: a fetch failure (older
  // deploy without the file) just leaves the strip unrendered.
  const [storyCards, setStoryCards] = useState<StoryCard[]>([]);

  const handleDismiss = (item: SiteIndexEntry) => setDismissedIds(addDismissed(item.id));
  const handleRestore = (item: SiteIndexEntry) => {
    const next = removeDismissed(item.id);
    setDismissedIds(next);
    if (next.size === 0) setShowDismissed(false);
  };
  const handleClearDismissed = () => {
    setDismissedIds(clearDismissed());
    setShowDismissed(false);
  };

  const updatePrefs = (next: Preferences) => {
    setPrefs(next);
    writePreferences(next);
  };
  const updateSortMode = (mode: SortMode) => {
    setSortMode(mode);
    writeSortMode(mode);
  };
  const matchActive = sortMode === "match" && hasPreferences(prefs);

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
        // "New since your last visit" is about opportunities, not the fixed
        // set of aggregate-links board rows — exclude kind:"board" from both
        // the diff and the stored baseline.
        const opps = data.items.filter((item) => item.kind !== "board");
        const lastVisit = readLastVisit();
        if (lastVisit.at !== null) {
          const freshIds = new Set(opps.filter((item) => !lastVisit.ids.has(item.id)).map((item) => item.id));
          setNewIds(freshIds);
          setLastVisitAt(lastVisit.at);
        }
        writeLastVisit(opps.map((item) => item.id), data.generated_at);
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

  useEffect(() => {
    let cancelled = false;
    fetchStoryCards()
      .then((data) => {
        if (!cancelled) setStoryCards(Array.isArray(data.cards) ? data.cards : []);
      })
      .catch(() => {
        /* no story-cards.json yet — the strip just stays hidden */
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

  // A hero stat-chip click replaces the filter set with just that facet
  // (plus resets any "only new" narrowing), so the list jumps straight to
  // what the chip counts. Merges onto DEFAULT_FILTERS, not the current
  // filters, so it's a clean pivot rather than an additive narrowing.
  function handleQuickFilter(patch: Partial<FilterState>) {
    setShowOnlyNew(false);
    setFilters({ ...DEFAULT_FILTERS, ...patch });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // replaceState, not pushState — a filtered view is still a link someone
  // can copy and share, but adjusting a dropdown shouldn't spam the
  // browser's back-button history with every keystroke.
  useEffect(() => {
    const query = searchParamsFromFilters(filters).toString();
    const next = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState(null, "", next);
  }, [filters]);

  // Any change that reshuffles or refilters the list sends the reader back
  // to page 1 — landing on "page 7 of 3" after tightening a filter is
  // disorienting.
  useEffect(() => {
    setPage(1);
  }, [filters, sortMode, showOnlyNew, prefs, showDismissed]);

  // kind:"board" rows (config/aggregate_links.yml) are not opportunities —
  // they're rendered by <BrowseEveryRole> and kept out of the list, the
  // counts, the hero, and the filter facets entirely.
  const opportunityItems = useMemo(
    () => (state.status === "loaded" ? state.data.items.filter((i) => i.kind !== "board") : []),
    [state],
  );
  const boardItems = useMemo(
    () => (state.status === "loaded" ? state.data.items.filter((i) => i.kind === "board") : []),
    [state],
  );

  const filteredItems = useMemo(() => {
    if (state.status !== "loaded") return [];
    let items = applyFilters(opportunityItems, filters);
    // C2 — "not interested" rows are hidden by default; the review mode
    // (`showDismissed`) inverts that to show *only* them.
    items = showDismissed
      ? items.filter((item) => dismissedIds.has(item.id))
      : items.filter((item) => !dismissedIds.has(item.id));
    if (showOnlyNew) items = items.filter((item) => newIds.has(item.id));
    // "Companies to hide" is a hard preference — applied in either sort mode.
    if (prefs.excludeCompanies.length > 0) items = items.filter((item) => !isExcluded(item, prefs));
    if (matchActive) {
      // Stable re-sort by fit score; applyFilters already returned them in
      // the pipeline's newest-first order, which stays as the tiebreak.
      items = items
        .map((item, i) => ({ item, i, score: scoreOpportunity(item, prefs) }))
        .sort((a, b) => b.score - a.score || a.i - b.i)
        .map((entry) => entry.item);
    } else if (sortMode === "tier") {
      // Best-known companies first (FAANG → big-tech → …). Within a tier, all
      // of one company's roles stay together as a block, blocks ordered by
      // the company's freshest posting, each block newest-first — so the list
      // reads "Google (5), then Amazon (3), …" instead of interleaving them.
      const decorated = items.map((item, i) => ({
        item,
        i,
        tier: companyTier(item.company),
        company: (item.company || "").toLowerCase(),
        age: ageToDays(item.age),
      }));
      const freshestByCompany = new Map<string, number>();
      for (const d of decorated) {
        const k = `${d.tier} ${d.company}`;
        if (d.age < (freshestByCompany.get(k) ?? Infinity)) freshestByCompany.set(k, d.age);
      }
      items = decorated
        .sort((a, b) => {
          const ka = `${a.tier} ${a.company}`;
          const kb = `${b.tier} ${b.company}`;
          return (
            a.tier - b.tier ||
            (freshestByCompany.get(ka)! - freshestByCompany.get(kb)!) ||
            a.company.localeCompare(b.company) ||
            a.age - b.age ||
            a.i - b.i
          );
        })
        .map((entry) => entry.item);
    }
    return items;
  }, [state, opportunityItems, filters, showOnlyNew, newIds, prefs, matchActive, sortMode, dismissedIds, showDismissed]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const visibleItems = filteredItems.slice(pageStart, pageStart + PAGE_SIZE);

  const reasonsById = useMemo(() => {
    if (!matchActive) return undefined;
    const map = new Map<string, string[]>();
    for (const item of visibleItems) {
      const r = matchReasons(item, prefs);
      if (r.length > 0) map.set(item.id, r);
    }
    return map;
  }, [matchActive, visibleItems, prefs]);

  // Country has no fixed enum (curated-layer only, free-form per
  // job-entry.schema.json) — the filter dropdown is populated from
  // whatever countries actually exist in the loaded data, so it always
  // reflects real coverage and never lists a country with zero postings.
  const availableCountries = useMemo(() => {
    const countries = new Set<string>();
    for (const item of opportunityItems) {
      if (item.country) countries.add(item.country);
    }
    return [...countries].sort((a, b) => a.localeCompare(b));
  }, [opportunityItems]);

  // B3 — tech tags that actually occur, most-common first so the dropdown
  // leads with the useful ones; capped so a long tail of one-off tags
  // doesn't bloat the control. Only a subset of sources carry a description,
  // so this list can legitimately be short or empty.
  const availableTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of opportunityItems) {
      for (const tag of item.tech_tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 40)
      .map(([tag]) => tag);
  }, [opportunityItems]);

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
  const rangeStart = filteredItems.length === 0 ? 0 : pageStart + 1;
  const rangeEnd = pageStart + visibleItems.length;

  const goToPage = (next: number) => {
    setPage(Math.min(Math.max(1, next), totalPages));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div>
      <SnapshotHero items={opportunityItems} generatedAt={data.generated_at} onQuickFilter={handleQuickFilter} />

      {!showDismissed && <StoryStrip cards={storyCards} onSelect={handleQuickFilter} />}

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

      <PreferencesPanel prefs={prefs} onChange={updatePrefs} />

      <div className="mb-4 flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Sort</span>
        <div className="inline-flex overflow-hidden rounded-md border border-slate-200 text-sm dark:border-slate-700">
          {(["tier", "newest", "match"] as const).map((mode) => {
            const disabled = mode === "match" && !hasPreferences(prefs);
            const active = sortMode === mode;
            const label = mode === "tier" ? "Top companies" : mode === "newest" ? "Newest" : "Best match";
            return (
              <button
                key={mode}
                type="button"
                disabled={disabled}
                onClick={() => updateSortMode(mode)}
                aria-pressed={active}
                title={disabled ? "Set at least one preference above to rank by fit" : undefined}
                className={
                  "px-3 py-1 font-medium transition-colors " +
                  (active
                    ? "bg-teal-700 text-white dark:bg-teal-600"
                    : disabled
                      ? "cursor-not-allowed text-slate-300 dark:text-slate-600"
                      : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900")
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <SavedSearches filters={filters} onApply={setFilters} />

      <FilterBar
        filters={filters}
        onChange={setFilters}
        resultCount={filteredItems.length}
        availableCountries={availableCountries}
        availableTags={availableTags}
      />

      {/* Aggregate-links lane — only alongside jobs (a board isn't a
          hackathon or an event), and it ignores every filter but the search
          box since a board carries no level/region/etc. of its own. */}
      {(filters.kind === "all" || filters.kind === "job") && !showOnlyNew && !showDismissed && (
        <BrowseEveryRole boards={boardItems} query={filters.q} />
      )}

      {dismissedIds.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <span>
            <strong>{dismissedIds.size.toLocaleString()}</strong> hidden as “not interested”
          </span>
          <button
            type="button"
            onClick={() => setShowDismissed((v) => !v)}
            aria-pressed={showDismissed}
            className="underline-offset-2 hover:text-slate-700 hover:underline dark:hover:text-slate-200"
          >
            {showDismissed ? "Back to the list" : "Review hidden"}
          </button>
          <button
            type="button"
            onClick={handleClearDismissed}
            className="underline-offset-2 hover:text-slate-700 hover:underline dark:hover:text-slate-200"
          >
            Clear all
          </button>
        </div>
      )}

      {filteredItems.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-slate-600 dark:text-slate-300">
            {showDismissed
              ? "None of your hidden opportunities match these filters."
              : showOnlyNew
                ? "Nothing new since your last visit that matches these filters."
                : "No opportunities match these filters right now."}
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-3 text-sm">
            {hasActiveFilters(filters) && (
              <button
                type="button"
                onClick={() => setFilters(DEFAULT_FILTERS)}
                className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
              >
                Clear filters
              </button>
            )}
            {showOnlyNew && (
              <button
                type="button"
                onClick={() => setShowOnlyNew(false)}
                className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
              >
                Show all, not just new
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>
              Showing <strong>{rangeStart.toLocaleString()}</strong>–<strong>{rangeEnd.toLocaleString()}</strong> of{" "}
              <strong>{filteredItems.length.toLocaleString()}</strong>
            </span>
            <span>
              Page {safePage.toLocaleString()} / {totalPages.toLocaleString()}
            </span>
          </div>
          <OpportunityTable
            items={visibleItems}
            trackedIds={trackedIds}
            onToggleTrack={handleToggleTrack}
            matchReasons={reasonsById}
            onDismiss={handleDismiss}
            onRestore={handleRestore}
            dismissedIds={showDismissed ? dismissedIds : undefined}
          />
          {totalPages > 1 && (
            <Pagination page={safePage} totalPages={totalPages} onChange={goToPage} />
          )}
        </>
      )}
    </div>
  );
}
