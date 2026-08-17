import { DEFAULT_FILTERS, hasActiveFilters, type FilterState } from "../lib/filters";
import type { SiteIndexKind } from "../lib/types";

const KIND_TABS: { value: SiteIndexKind | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "job", label: "Jobs" },
  { value: "hackathon", label: "Hackathons" },
  { value: "event", label: "Events" },
];

// Job-only facets — deliberately just the "available now" fields from the
// plan's filter taxonomy (level/region/remote_type on every job row already).
// Company, posted-age, and company-type filters are a fast-follow, not
// missing by accident.
const LEVEL_OPTIONS: { value: string; label: string }[] = [
  { value: "internship", label: "Internship" },
  { value: "new_grad", label: "New grad" },
  { value: "junior", label: "Junior" },
  { value: "entry_level", label: "Entry level" },
  { value: "mid_level", label: "Mid level" },
  { value: "other", label: "Other" },
  { value: "unknown", label: "Unknown" },
];

const REGION_OPTIONS: { value: string; label: string }[] = [
  { value: "us", label: "United States" },
  { value: "canada", label: "Canada" },
  { value: "emea", label: "EMEA" },
  { value: "remote", label: "Remote" },
  { value: "unknown", label: "Unknown" },
];

const REMOTE_OPTIONS: { value: string; label: string }[] = [
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "onsite", label: "Onsite" },
  { value: "unknown", label: "Unknown" },
];

interface Props {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  resultCount: number;
}

export default function FilterBar({ filters, onChange, resultCount }: Props) {
  const set = <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    onChange({ ...filters, [key]: value });
  };

  return (
    <div className="mb-6 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
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
