import {
  DEFAULT_FILTERS,
  hasActiveFilters,
  KIND_VALUES,
  LEVEL_VALUES,
  REMOTE_VALUES,
  type FilterState,
} from "../lib/filters";
import { LEVEL_LABELS, REGION_LABELS, REMOTE_LABELS } from "../lib/labels";
import MultiSelect, { type MultiSelectOption } from "./MultiSelect";

// The ONE facet surface (Lane H). Option lists come from filters.ts's
// canonical value arrays (the same ones that validate URL params) so this UI
// and that validation can't drift; only the display label lives here.
const KIND_LABELS: Record<string, string> = {
  all: "All",
  job: "Jobs",
  hackathon: "Hackathons",
  event: "Events",
};
const KIND_TABS = KIND_VALUES.map((value) => ({ value, label: KIND_LABELS[value] }));

const LEVEL_OPTIONS: MultiSelectOption[] = LEVEL_VALUES.map((value) => ({ value, label: LEVEL_LABELS[value] }));
const REMOTE_OPTIONS: MultiSelectOption[] = REMOTE_VALUES.map((value) => ({ value, label: REMOTE_LABELS[value] }));

interface Props {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  resultCount: number;
  // Region / country / company / tech options are whatever the loaded data
  // actually contains, computed by the caller — so an empty bucket (e.g.
  // "unknown" once classification is good) never shows as a dead option.
  availableRegions: string[];
  availableCountries: string[];
  availableCompanies: string[];
  availableTags: string[];
  // Lane H: "Save this filter as my preferences" lives here, next to Clear.
  hasSavedPrefs: boolean;
  currentIsSaved: boolean;
  onSavePrefs: () => void;
  onClearPrefs: () => void;
}

export default function FilterBar({
  filters,
  onChange,
  resultCount,
  availableRegions,
  availableCountries,
  availableCompanies,
  availableTags,
  hasSavedPrefs,
  currentIsSaved,
  onSavePrefs,
  onClearPrefs,
}: Props) {
  const set = <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    onChange({ ...filters, [key]: value });
  };
  const toggleVisa = () => set("visa", filters.visa === "yes" ? "" : "yes");
  // Country options get a real flag image before the name (see <Flag> —
  // emoji flags render as bare letters on Windows).
  const regionOptions: MultiSelectOption[] = availableRegions.map((r) => ({
    value: r,
    label: REGION_LABELS[r] ?? r,
  }));
  const countryOptions: MultiSelectOption[] = availableCountries.map((c) => ({
    value: c,
    label: c,
    flagCountry: c,
  }));
  const companyOptions: MultiSelectOption[] = availableCompanies.map((c) => ({ value: c, label: c }));
  const tagOptions: MultiSelectOption[] = availableTags.map((t) => ({ value: t, label: t }));

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

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={filters.q}
          onChange={(e) => set("q", e.target.value)}
          placeholder="Search company, title, or place…"
          aria-label="Search company, title, or place"
          className="w-full max-w-xs rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:w-56"
        />

        <MultiSelect label="Level" options={LEVEL_OPTIONS} selected={filters.levels} onChange={(v) => set("levels", v)} />
        {regionOptions.length > 0 && (
          <MultiSelect label="Region" options={regionOptions} selected={filters.regions} onChange={(v) => set("regions", v)} />
        )}
        <MultiSelect label="Work type" options={REMOTE_OPTIONS} selected={filters.remotes} onChange={(v) => set("remotes", v)} />
        {countryOptions.length > 0 && (
          <MultiSelect label="Country" options={countryOptions} selected={filters.countries} onChange={(v) => set("countries", v)} searchable />
        )}
        {companyOptions.length > 0 && (
          <MultiSelect label="Company" options={companyOptions} selected={filters.companies} onChange={(v) => set("companies", v)} searchable />
        )}
        {tagOptions.length > 0 && (
          <MultiSelect label="Tech" options={tagOptions} selected={filters.tags} onChange={(v) => set("tags", v)} searchable />
        )}

        <button
          type="button"
          onClick={toggleVisa}
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
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        {hasActiveFilters(filters) && (
          <>
            <button
              type="button"
              onClick={() => onChange(DEFAULT_FILTERS)}
              className="text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
            >
              Clear filters
            </button>
            <button
              type="button"
              onClick={onSavePrefs}
              disabled={currentIsSaved}
              title="Rank future visits to match this filter, and use it for alerts"
              className={
                "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors " +
                (currentIsSaved
                  ? "cursor-default border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-500"
                  : "border-teal-600 text-teal-700 hover:bg-teal-50 dark:border-teal-500 dark:text-teal-300 dark:hover:bg-teal-950")
              }
            >
              {currentIsSaved ? "★ Saved as your preferences" : hasSavedPrefs ? "★ Update your preferences" : "★ Save as my preferences"}
            </button>
          </>
        )}
        {hasSavedPrefs && (
          <button
            type="button"
            onClick={onClearPrefs}
            className="text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline dark:text-slate-500 dark:hover:text-slate-300"
          >
            Forget my preferences
          </button>
        )}
        <span className="ml-auto text-slate-500 dark:text-slate-400">
          {resultCount.toLocaleString()} result{resultCount === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}
