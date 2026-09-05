import { useEffect, useState } from "react";
import { hasActiveFilters, searchParamsFromFilters, type FilterState } from "../lib/filters";
import {
  filtersForSavedSearch,
  listSavedSearches,
  removeSavedSearch,
  saveSearch,
  type SavedSearch,
} from "../lib/savedSearches";

interface Props {
  filters: FilterState;
  onApply: (filters: FilterState) => void;
}

export default function SavedSearches({ filters, onApply }: Props) {
  const [saved, setSaved] = useState<SavedSearch[]>([]);

  useEffect(() => {
    setSaved(listSavedSearches());
  }, []);

  const currentQuery = searchParamsFromFilters(filters).toString();
  const alreadySaved = saved.some((s) => s.query === currentQuery);
  const canSave = hasActiveFilters(filters) && !alreadySaved;

  if (saved.length === 0 && !canSave) return null;

  const handleSave = () => {
    const name = window.prompt("Name this search (e.g. “Remote new-grad”):");
    if (name && name.trim()) setSaved(saveSearch(name, filters));
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
      {saved.length > 0 && (
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Saved</span>
      )}
      {saved.map((s) => {
        const active = s.query === currentQuery;
        return (
          <span
            key={s.id}
            className={
              "inline-flex items-center gap-1 rounded-full border py-0.5 pl-3 pr-1 " +
              (active
                ? "border-teal-700 bg-teal-700 text-white dark:border-teal-600 dark:bg-teal-600"
                : "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300")
            }
          >
            <button type="button" onClick={() => onApply(filtersForSavedSearch(s))} className="font-medium">
              {s.name}
            </button>
            <button
              type="button"
              onClick={() => setSaved(removeSavedSearch(s.id))}
              aria-label={`Delete saved search ${s.name}`}
              className={
                "rounded-full px-1 text-xs leading-none " +
                (active ? "hover:bg-teal-800/60" : "text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800")
              }
            >
              ×
            </button>
          </span>
        );
      })}
      {canSave && (
        <button
          type="button"
          onClick={handleSave}
          className="rounded-full border border-dashed border-slate-300 px-3 py-0.5 font-medium text-slate-500 hover:border-teal-500 hover:text-teal-700 dark:border-slate-700 dark:text-slate-400 dark:hover:border-teal-600 dark:hover:text-teal-400"
        >
          + Save this search
        </button>
      )}
    </div>
  );
}
