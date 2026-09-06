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
  clearPrefFilter,
  contradictsPrefFilter,
  filtersEqual,
  isExcluded,
  matchReasons,
  prefFilterIsMeaningful,
  readPrefFilter,
  readRankTune,
  readSortMode,
  scoreOpportunity,
  writePrefFilter,
  writeRankTune,
  writeSortMode,
  type RankTune,
  type SortMode,
} from "../lib/preferences";
import type { SiteIndex, SiteIndexEntry, StoryCard } from "../lib/types";
import { companyTier } from "../lib/companyTiers";
import { countryForItem, regionForItem, REGION_ORDER } from "../lib/geo";
import { readLastVisit, writeLastVisit } from "../lib/visitHistory";
import Pagination from "./Pagination";
import BrowseEveryRole from "./BrowseEveryRole";
import StoryStrip from "./StoryStrip";
import FilterBar from "./FilterBar";
import OpportunityTable from "./OpportunityTable";
import SavedSearches from "./SavedSearches";
import SkeletonTable from "./SkeletonTable";
import SnapshotHero from "./SnapshotHero";

function ageToDays(age: string): number {
  const a = (age || "").trim().toLowerCase();
  let m: RegExpMatchArray | null;
  if ((m = a.match(/^(\d+)d$/))) return +m[1];
  if ((m = a.match(/^(\d+)mo$/))) return +m[1] * 30;
  if ((m = a.match(/^(\d+)yrs?$/))) return +m[1] * 365;
  return Number.MAX_SAFE_INTEGER;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; data: SiteIndex };

const PAGE_SIZE = 50;

const SORT_META: Record<SortMode, { label: string; hint: string }> = {
  tier: { label: "Top companies", hint: "Best-known companies first (FAANG → big-tech → …)." },
  newest: { label: "Newest", hint: "Most recently posted first." },
  relevance: { label: "Relevance", hint: "Ranked to match the filter you saved as your preferences." },
};

function formatGeneratedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function readFiltersFromLocation(): FilterState {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  return filtersFromSearchParams(new URLSearchParams(window.location.search));
}

export default function OpportunityBrowser() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [filters, setFilters] = useState<FilterState>(() => readFiltersFromLocation());
  const [page, setPage] = useState(1);
  const [trackedApps, setTrackedApps] = useState<Map<string, TrackedApplication>>(new Map());
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [lastVisitAt, setLastVisitAt] = useState<string | null>(null);
  const [showOnlyNew, setShowOnlyNew] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [storyCards, setStoryCards] = useState<StoryCard[]>([]);

  // Lane H — "preferences" is a saved FilterState; `rankTune` are the two
  // ranking-only knobs (keyword boost, exclude companies).
  const [prefFilter, setPrefFilter] = useState<FilterState | null>(() => readPrefFilter());
  const [rankTune, setRankTune] = useState<RankTune>(() => readRankTune());
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    const chosen = readSortMode();
    if (chosen) return chosen;
    return prefFilterIsMeaningful(readPrefFilter()) ? "relevance" : "tier";
  });
  const [showLessRelevant, setShowLessRelevant] = useState(false);

  const hasSavedPrefs = prefFilterIsMeaningful(prefFilter);
  const relevanceActive = sortMode === "relevance" && hasSavedPrefs && !!prefFilter;
  const currentIsSaved = !!prefFilter && filtersEqual(filters, prefFilter);

  const updateSortMode = (mode: SortMode) => {
    setSortMode(mode);
    writeSortMode(mode);
  };
  const handleSavePrefs = () => {
    setPrefFilter(filters);
    writePrefFilter(filters);
    // First time you save preferences, show what they do — flip to Relevance
    // unless you'd already deliberately picked another sort.
    if (!readSortMode()) updateSortMode("relevance");
  };
  const handleClearPrefs = () => {
    clearPrefFilter();
    setPrefFilter(null);
    if (sortMode === "relevance") updateSortMode("tier");
  };
  const updateRankTune = (next: RankTune) => {
    setRankTune(next);
    writeRankTune(next);
  };

  useEffect(() => {
    let cancelled = false;
    fetchSiteIndex()
      .then((data) => {
        if (cancelled) return;
        setState({ status: "loaded", data });
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
          setState({ status: "error", message: err instanceof Error ? err.message : "Unknown error" });
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
        /* no story-cards.json yet — the strip stays hidden */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const trackedIds = useMemo(() => new Set(trackedApps.keys()), [trackedApps]);

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

  function handleQuickFilter(patch: Partial<FilterState>) {
    setShowOnlyNew(false);
    setFilters({ ...DEFAULT_FILTERS, ...patch });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  useEffect(() => {
    const query = searchParamsFromFilters(filters).toString();
    const next = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState(null, "", next);
  }, [filters]);

  useEffect(() => {
    setPage(1);
  }, [filters, sortMode, showOnlyNew, rankTune, showLessRelevant]);

  const opportunityItems = useMemo(
    () => (state.status === "loaded" ? state.data.items.filter((i) => i.kind !== "board") : []),
    [state],
  );
  const boardItems = useMemo(
    () => (state.status === "loaded" ? state.data.items.filter((i) => i.kind === "board") : []),
    [state],
  );

  // The list, before the Relevance "less relevant" partition. `lessRelevant`
  // is only ever non-empty in Relevance sort.
  const { primary, lessRelevant } = useMemo(() => {
    if (state.status !== "loaded") return { primary: [] as SiteIndexEntry[], lessRelevant: [] as SiteIndexEntry[] };
    let items = applyFilters(opportunityItems, filters);
    if (showOnlyNew) items = items.filter((item) => newIds.has(item.id));
    if (rankTune.excludeCompanies.length > 0) items = items.filter((item) => !isExcluded(item, rankTune));

    if (relevanceActive && prefFilter) {
      const decorated = items.map((item, i) => ({
        item,
        i,
        score: scoreOpportunity(item, prefFilter, rankTune),
        contradicts: contradictsPrefFilter(item, prefFilter),
      }));
      const byScore = (a: (typeof decorated)[number], b: (typeof decorated)[number]) => b.score - a.score || a.i - b.i;
      const matched = decorated.filter((d) => !d.contradicts).sort(byScore).map((d) => d.item);
      const contra = decorated.filter((d) => d.contradicts).sort(byScore).map((d) => d.item);
      return { primary: matched, lessRelevant: contra };
    }

    if (sortMode === "newest") {
      items = items
        .map((item, i) => ({ item, i, age: ageToDays(item.age) }))
        .sort(
          (a, b) =>
            a.age - b.age ||
            (a.item.company || "").localeCompare(b.item.company || "") ||
            a.i - b.i,
        )
        .map((e) => e.item);
      return { primary: items, lessRelevant: [] };
    }

    // "Top companies" (tier) — the neutral default.
    const decorated = items.map((item, i) => ({
      item,
      i,
      tier: companyTier(item.company),
      company: (item.company || "").toLowerCase(),
      age: ageToDays(item.age),
    }));
    const freshestByCompany = new Map<string, number>();
    for (const d of decorated) {
      const k = `${d.tier} ${d.company}`;
      if (d.age < (freshestByCompany.get(k) ?? Infinity)) freshestByCompany.set(k, d.age);
    }
    items = decorated
      .sort((a, b) => {
        const ka = `${a.tier} ${a.company}`;
        const kb = `${b.tier} ${b.company}`;
        return (
          a.tier - b.tier ||
          freshestByCompany.get(ka)! - freshestByCompany.get(kb)! ||
          a.company.localeCompare(b.company) ||
          a.age - b.age ||
          a.i - b.i
        );
      })
      .map((e) => e.item);
    return { primary: items, lessRelevant: [] };
  }, [state, opportunityItems, filters, showOnlyNew, newIds, rankTune, relevanceActive, prefFilter, sortMode]);

  const filteredItems = useMemo(
    () => (showLessRelevant ? [...primary, ...lessRelevant] : primary),
    [primary, lessRelevant, showLessRelevant],
  );

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const visibleItems = filteredItems.slice(pageStart, pageStart + PAGE_SIZE);

  const reasonsById = useMemo(() => {
    if (!relevanceActive || !prefFilter) return undefined;
    const map = new Map<string, string[]>();
    for (const item of visibleItems) {
      const r = matchReasons(item, prefFilter, rankTune);
      if (r.length > 0) map.set(item.id, r);
    }
    return map;
  }, [relevanceActive, prefFilter, rankTune, visibleItems]);

  // Macro-regions actually present in the loaded data, in canonical order —
  // so "unknown" only shows if something is genuinely unclassified, and a
  // bucket the deployed data doesn't carry yet (apac/latam) still appears
  // because regionForItem derives it from the location string.
  const availableRegions = useMemo(() => {
    const present = new Set<string>();
    for (const item of opportunityItems) present.add(regionForItem(item));
    return REGION_ORDER.filter((r) => present.has(r));
  }, [opportunityItems]);

  const availableCountries = useMemo(() => {
    // countryForItem falls back to detecting from the location string, so
    // Gulf / North-Africa / APAC countries appear here even before the
    // pipeline re-runs detect_country over the public layer.
    const countries = new Set<string>();
    for (const item of opportunityItems) {
      const c = countryForItem(item);
      if (c) countries.add(c);
    }
    return [...countries].sort((a, b) => a.localeCompare(b));
  }, [opportunityItems]);

  // Every company in the loaded data, alphabetical — the MultiSelect caps its
  // own render and has a search box, so a long list is fine.
  const availableCompanies = useMemo(() => {
    const companies = new Set<string>();
    for (const item of opportunityItems) if (item.company) companies.add(item.company);
    return [...companies].sort((a, b) => a.localeCompare(b));
  }, [opportunityItems]);

  const availableTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of opportunityItems) for (const tag of item.tech_tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
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
        <a className="underline" href="https://github.com/AhmedNassar7/tracker/blob/main/data/README.md">
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

      <StoryStrip cards={storyCards} onSelect={handleQuickFilter} />

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
              setShowOnlyNew(false);
            }}
            className="ml-auto text-teal-700 hover:text-teal-900 dark:text-teal-300 dark:hover:text-teal-100"
            aria-label="Dismiss"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Sort</span>
        <div className="inline-flex overflow-hidden rounded-md border border-slate-200 text-sm dark:border-slate-700">
          {(["tier", "newest", "relevance"] as const).map((mode) => {
            const disabled = mode === "relevance" && !hasSavedPrefs;
            const active = sortMode === mode;
            return (
              <button
                key={mode}
                type="button"
                disabled={disabled}
                onClick={() => updateSortMode(mode)}
                aria-pressed={active}
                title={disabled ? "Save a filter as your preferences first" : SORT_META[mode].hint}
                className={
                  "px-3 py-1 font-medium transition-colors " +
                  (active
                    ? "bg-teal-700 text-white dark:bg-teal-600"
                    : disabled
                      ? "cursor-not-allowed text-slate-300 dark:text-slate-600"
                      : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900")
                }
              >
                {SORT_META[mode].label}
              </button>
            );
          })}
        </div>
        <span className="text-xs text-slate-400 dark:text-slate-500">{SORT_META[sortMode].hint}</span>

        {relevanceActive && (
          <details className="relative ml-auto text-sm">
            <summary className="cursor-pointer list-none rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-900">
              Tune ranking
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-64 space-y-2 rounded-md border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
              <label className="block text-xs text-slate-500 dark:text-slate-400">
                Boost keywords (comma-separated)
                <input
                  type="text"
                  defaultValue={rankTune.keywords.join(", ")}
                  onBlur={(e) =>
                    updateRankTune({
                      ...rankTune,
                      keywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                    })
                  }
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </label>
              <label className="block text-xs text-slate-500 dark:text-slate-400">
                Hide companies (comma-separated)
                <input
                  type="text"
                  defaultValue={rankTune.excludeCompanies.join(", ")}
                  onBlur={(e) =>
                    updateRankTune({
                      ...rankTune,
                      excludeCompanies: e.target.value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
                    })
                  }
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </label>
            </div>
          </details>
        )}
      </div>

      <SavedSearches filters={filters} onApply={setFilters} />

      <FilterBar
        filters={filters}
        onChange={setFilters}
        resultCount={primary.length}
        availableRegions={availableRegions}
        availableCountries={availableCountries}
        availableCompanies={availableCompanies}
        availableTags={availableTags}
        hasSavedPrefs={hasSavedPrefs}
        currentIsSaved={currentIsSaved}
        onSavePrefs={handleSavePrefs}
        onClearPrefs={handleClearPrefs}
      />

      {(filters.kind === "all" || filters.kind === "job") && !showOnlyNew && (
        <BrowseEveryRole boards={boardItems} query={filters.q} />
      )}

      {filteredItems.length === 0 && lessRelevant.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-slate-600 dark:text-slate-300">
            {showOnlyNew
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
          />
          {relevanceActive && lessRelevant.length > 0 && (
            <button
              type="button"
              onClick={() => setShowLessRelevant((v) => !v)}
              className="mt-3 w-full rounded-md border border-dashed border-slate-300 py-2 text-center text-sm text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-900"
            >
              {showLessRelevant
                ? `Hide ${lessRelevant.length.toLocaleString()} less-relevant role${lessRelevant.length === 1 ? "" : "s"}`
                : `${lessRelevant.length.toLocaleString()} less-relevant role${lessRelevant.length === 1 ? "" : "s"} (don't match your saved level/kind) — show anyway`}
            </button>
          )}
          {totalPages > 1 && <Pagination page={safePage} totalPages={totalPages} onChange={goToPage} />}
        </>
      )}
    </div>
  );
}
