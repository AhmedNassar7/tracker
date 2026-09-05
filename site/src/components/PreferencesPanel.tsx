import { useId, useState } from "react";
import { LEVEL_LABELS, REGION_LABELS, REMOTE_LABELS } from "../lib/labels";
import { EMPTY_PREFERENCES, hasPreferences, type Preferences } from "../lib/preferences";

// Local-only preference editor for the "Best match" sort. No account, no
// network — everything here is written to localStorage by the parent.

const LEVEL_CHOICES = ["internship", "new_grad", "junior", "entry_level", "mid_level"];
const REGION_CHOICES = ["us", "canada", "mena", "emea", "remote"];
const REMOTE_CHOICES = ["remote", "hybrid", "onsite"];

interface Props {
  prefs: Preferences;
  onChange: (next: Preferences) => void;
}

function CheckGroup({
  legend,
  choices,
  labels,
  selected,
  onToggle,
}: {
  legend: string;
  choices: string[];
  labels: Record<string, string>;
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {choices.map((value) => {
          const on = selected.includes(value);
          return (
            <button
              key={value}
              type="button"
              onClick={() => onToggle(value)}
              aria-pressed={on}
              className={
                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors " +
                (on
                  ? "border-teal-700 bg-teal-700 text-white dark:border-teal-600 dark:bg-teal-600"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900")
              }
            >
              {labels[value] ?? value}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export default function PreferencesPanel({ prefs, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const toggleIn = (key: "levels" | "regions" | "remote", value: string) => {
    const set = new Set(prefs[key]);
    set.has(value) ? set.delete(value) : set.add(value);
    onChange({ ...prefs, [key]: [...set] });
  };

  const parseCsv = (raw: string) =>
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  return (
    <div className="mb-4 rounded-lg border border-slate-200 dark:border-slate-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium text-slate-700 dark:text-slate-200"
      >
        <span>
          Your preferences
          {hasPreferences(prefs) && (
            <span className="ml-2 rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-800 dark:bg-teal-900 dark:text-teal-200">
              on
            </span>
          )}
        </span>
        <span aria-hidden="true" className="text-slate-400">
          {open ? "−" : "+"}
        </span>
      </button>

      {open && (
        <div id={panelId} className="space-y-4 border-t border-slate-200 px-4 py-4 dark:border-slate-800">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Used only to rank the list when “Best match” is on. Stored in this browser — never uploaded.
          </p>

          <div className="grid gap-4 sm:grid-cols-3">
            <CheckGroup
              legend="Level"
              choices={LEVEL_CHOICES}
              labels={LEVEL_LABELS}
              selected={prefs.levels}
              onToggle={(v) => toggleIn("levels", v)}
            />
            <CheckGroup
              legend="Region"
              choices={REGION_CHOICES}
              labels={REGION_LABELS}
              selected={prefs.regions}
              onToggle={(v) => toggleIn("regions", v)}
            />
            <CheckGroup
              legend="Work type"
              choices={REMOTE_CHOICES}
              labels={REMOTE_LABELS}
              selected={prefs.remote}
              onToggle={(v) => toggleIn("remote", v)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Keywords to boost
              <input
                key={`kw:${prefs.keywords.join(",")}`}
                type="text"
                defaultValue={prefs.keywords.join(", ")}
                onBlur={(e) => onChange({ ...prefs, keywords: parseCsv(e.target.value) })}
                placeholder="rust, distributed systems, ml"
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm font-normal normal-case text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Companies to hide
              <input
                key={`ex:${prefs.excludeCompanies.join(",")}`}
                type="text"
                defaultValue={prefs.excludeCompanies.join(", ")}
                onBlur={(e) =>
                  onChange({ ...prefs, excludeCompanies: parseCsv(e.target.value).map((c) => c.toLowerCase()) })
                }
                placeholder="acme, example corp"
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm font-normal normal-case text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
          </div>

          {hasPreferences(prefs) && (
            <button
              type="button"
              onClick={() => onChange({ ...EMPTY_PREFERENCES })}
              className="text-xs text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
            >
              Clear preferences
            </button>
          )}
        </div>
      )}
    </div>
  );
}
