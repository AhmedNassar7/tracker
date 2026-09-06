import { useEffect, useId, useMemo, useRef, useState } from "react";

// A compact multi-select: a button showing the facet name (and a count when
// values are picked) that opens a checkbox popover. `searchable` adds an
// inline filter box — used for the long facets (country, tech). Keyboard-
// and screen-reader-friendly; closes on outside click / Escape.

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface Props {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  searchable?: boolean;
}

export default function MultiSelect({ label, options, selected, onChange, searchable }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [options, query]);

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  const count = selected.length;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className={
          "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors " +
          (count > 0
            ? "border-teal-600 bg-teal-50 text-teal-800 dark:border-teal-500 dark:bg-teal-950 dark:text-teal-200"
            : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300")
        }
      >
        {label}
        {count > 0 && (
          <span className="rounded-full bg-teal-600 px-1.5 text-xs font-semibold text-white dark:bg-teal-500">
            {count}
          </span>
        )}
        <span aria-hidden="true" className="text-xs text-slate-400">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div
          id={listId}
          role="group"
          aria-label={label}
          className="absolute z-20 mt-1 max-h-72 w-56 overflow-auto rounded-md border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {searchable && (
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}…`}
              className="mb-1.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus:border-teal-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          )}
          {count > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mb-1 block w-full rounded px-2 py-1 text-left text-xs text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              Clear {label.toLowerCase()}
            </button>
          )}
          {visible.length === 0 ? (
            <p className="px-2 py-1 text-xs text-slate-400">No matches</p>
          ) : (
            visible.map((opt) => (
              <label
                key={opt.value}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(opt.value)}
                  onChange={() => toggle(opt.value)}
                  className="h-3.5 w-3.5 accent-teal-600"
                />
                {opt.label}
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}
