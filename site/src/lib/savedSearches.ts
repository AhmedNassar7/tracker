// Named filter combinations, saved locally so a repeat visitor can jump
// straight back to "internships, remote, US" without rebuilding it. Same
// storage story as visitHistory.ts / preferences.ts — plain localStorage,
// guarded, nothing leaves the browser. A saved search is just the URL query
// string the filter bar already produces, so applying one is a plain
// filters-from-params call.

import { filtersFromSearchParams, searchParamsFromFilters, type FilterState } from "./filters";

export interface SavedSearch {
  id: string;
  name: string;
  query: string; // e.g. "kind=job&level=internship&remote=remote"
}

const KEY = "tracker:savedSearches";

function read(): SavedSearch[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is SavedSearch =>
        !!s && typeof s.id === "string" && typeof s.name === "string" && typeof s.query === "string",
    );
  } catch {
    return [];
  }
}

function write(list: SavedSearch[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full / disabled — feature silently no-ops, same as preferences.ts */
  }
}

export function listSavedSearches(): SavedSearch[] {
  return read();
}

export function saveSearch(name: string, filters: FilterState): SavedSearch[] {
  const query = searchParamsFromFilters(filters).toString();
  const trimmed = name.trim();
  if (!trimmed || !query) return read();
  const list = read().filter((s) => s.query !== query && s.name !== trimmed);
  list.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: trimmed, query });
  write(list);
  return list;
}

export function removeSavedSearch(id: string): SavedSearch[] {
  const list = read().filter((s) => s.id !== id);
  write(list);
  return list;
}

export function filtersForSavedSearch(search: SavedSearch): FilterState {
  return filtersFromSearchParams(new URLSearchParams(search.query));
}
