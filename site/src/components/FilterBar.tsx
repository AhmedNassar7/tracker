import {
  DEFAULT_FILTERS,
  hasActiveFilters,
  KIND_VALUES,
  LEVEL_VALUES,
  REGION_VALUES,
  REMOTE_VALUES,
  type FilterState,
} from "../lib/filters";

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
// missing by accident.
const LEVEL_LABELS: Record<string, string> = {
  internship: "Internship",
  new_grad: "New grad",
  junior: "Junior",
  entry_level: "Entry level",
  mid_level: "Mid level",
  other: "Other",
  unknown: "Unknown",
};
const LEVEL_OPTIONS = LEVEL_VALUES.map((value) => ({ value, label: LEVEL_LABELS[value] }));

const REGION_LABELS: Record<string, string> = {
  us: "United States",
  canada: "Canada",
  emea: "EMEA",
  remote: "Remote",
  unknown: "Unknown",
};
const REGION_OPTIONS = REGION_VALUES.map((value) => ({ value, label: REGION_LABELS[value] }));

const REMOTE_LABELS: Record<string, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "Onsite",
  unknown: "Unknown",
};
const REMOTE_OPTIONS = REMOTE_VALUES.map((value) => ({ value, label: REMOTE_LABELS[value] }));

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
