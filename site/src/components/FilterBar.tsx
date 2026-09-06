import {
  DEFAULT_FILTERS,
  hasActiveFilters,
  KIND_VALUES,
  LEVEL_VALUES,
  REGION_VALUES,
  REMOTE_VALUES,
  type FilterState,
} from "../lib/filters";
import { LEVEL_LABELS, REGION_LABELS, REMOTE_LABELS } from "../lib/labels";

// Option lists are built off filters.ts's canonical value arrays (the same
// ones that validate incoming URL query params) so this UI and that
// validation can never drift apart — only the display label lives here.
const KIND_LABELS: Record<string, string> = {
  all: "All",
  job: "Jobs",
  hackathon: "Hackathons",
  event: "Events",
};
const KIND_TABS = KIND_VALUES.map((value) => ({ value, label: KIND_LABELS[value] }));

// Job-only facets — deliberately just the "available now" fields from the
// plan's filter taxonomy (level/region/remote_type on every job row already).
// Company, posted-age, and company-type filters are a fast-follow, not
// missing by accident. LEVEL_LABELS is shared with GlobalDashboard and
// OpportunityTable via lib/labels.ts so the wording can't drift.
const LEVEL_OPTIONS = LEVEL_VALUES.map((value) => ({ value, label: LEVEL_LABELS[value] }));

const REGION_OPTIONS = REGION_VALUES.map((value) => ({ value, label: REGION_LABELS[value] }));
const REMOTE_OPTIONS = REMOTE_VALUES.map((value) => ({ value, label: REMOTE_LABELS[value] }));

interface Props {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  resultCount: number;
  // Country has no fixed enum (unlike level/region/remote) — it's whatever
  // countries actually appear in the loaded data, computed by the caller
  // from the real dataset. This dropdown only ever offers values that
  // exist right now, so it can never invent a country with zero postings.
  availableCountries: string[];
  // Same idea for B3 tech tags — the caller passes the tags that actually
  // occur in the loaded data (most-common first), so the dropdown never
  // lists a tag with zero matching rows.
  availableTags: string[];
}

export default function FilterBar({
  filters,
  onChange,
  resultCount,
  availableCountries,
  availableTags,
}: Props) {
  const set = <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    onChange({ ...filters, [key]: value });
  };
  const toggleFlag = (key: "visa" | "nodegree") => set(key, filters[key] === "yes" ? "" : "yes");

  return (
    <div className="mb-6 space-y-3">
      <div role="group" aria-label="Filter by kind" className="flex flex-wrap items-center gap-2">
        {KIND_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => set("kind", tab.value)}
            aria-pressed={filters.kind === tab.value}
            className={
              "rounded-full border px-3 py-1 text-sm font-medium transition-colors " +
              (filters.kind === tab.value
                ? "border-teal-700 bg-teal-700 text-white dark:border-teal-600 dark:bg-teal-600"
                : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-900")
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={filters.q}
          onChange={(e) => set("q", e.target.value)}
          placeholder="Search company or title…"
          aria-label="Search company or title"
          className="w-full max-w-xs rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:w-64"
        />

        <select
          value={filters.level}
          onChange={(e) => set("level", e.target.value)}
          aria-label="Filter by level"
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
        >
          <option value="">Any level</option>
          {LEVEL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          value={filters.region}
          onChange={(e) => set("region", e.target.value)}
          aria-label="Filter by region"
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
        >
          <option value="">Any region</option>
          {REGION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          value={filters.remote}
          onChange={(e) => set("remote", e.target.value)}
          aria-label="Filter by work type"
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
        >
          <option value="">Any work type</option>
          {REMOTE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {availableCountries.length > 0 && (
          <select
            value={filters.country}
            onChange={(e) => set("country", e.target.value)}
            aria-label="Filter by country"
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            <option value="">Any country</option>
            {availableCountries.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>
        )}

        {availableTags.length > 0 && (
          <select
            value={filters.tag}
            onChange={(e) => set("tag", e.target.value)}
            aria-label="Filter by tech / skill"
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            <option value="">Any tech</option>
            {availableTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        )}

        {/* B4 — explicit-only facet toggles. "on" ⇒ the posting text said so;
            a silent posting is never a match, so there's deliberately no
            "no visa" / "degree required" state to offer here. */}
        <button
          type="button"
          onClick={() => toggleFlag("visa")}
          aria-pressed={filters.visa === "yes"}
          title="Only postings that explicitly offer visa sponsorship"
          className={
            "rounded-full border px-3 py-1 text-sm font-medium transition-colors " +
            (filters.visa === "yes"
              ? "border-teal-700 bg-teal-700 text-white dark:border-teal-600 dark:bg-teal-600"
              : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-900")
          }
        >
          🛂 Visa sponsorship
        </button>
        <button
          type="button"
          onClick={() => toggleFlag("nodegree")}
          aria-pressed={filters.nodegree === "yes"}
          title="Only postings that explicitly say no degree is required"
          className={
            "rounded-full border px-3 py-1 text-sm font-medium transition-colors " +
            (filters.nodegree === "yes"
              ? "border-teal-700 bg-teal-700 text-white dark:border-teal-600 dark:bg-teal-600"
              : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-900")
          }
        >
          No degree required
        </button>

        {hasActiveFilters(filters) && (
          <button
            type="button"
            onClick={() => onChange(DEFAULT_FILTERS)}
            className="text-sm text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
          >
            Clear filters
          </button>
        )}

        <span className="ml-auto text-sm text-slate-500 dark:text-slate-400">
          {resultCount.toLocaleString()} result{resultCount === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}
