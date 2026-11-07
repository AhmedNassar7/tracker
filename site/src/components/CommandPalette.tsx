import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { trackEvent } from "../lib/analytics";
import { BASE_URL } from "../lib/basePath";
import {
  GROUP_ORDER,
  buildCompanyCommands,
  buildSearchCommand,
  buildStaticCommands,
  rankCommands,
  type Command,
  type CommandGroup,
} from "../lib/commandPalette";
import { fetchSiteIndex } from "../lib/dataSource";
import CompanyAvatar from "./CompanyAvatar";

// E2 — Cmd/Ctrl-K command palette. Jump to a page or company, apply a common
// filter, toggle the theme, copy the current link. Keyboard-first, but the
// header button makes it reachable on touch too (no shortcut needed).
//
// What the commands are and how they rank lives in lib/commandPalette.ts (pure,
// tested); this file only renders, handles keys, and executes the choice.
//
// Companies are the only data-dependent part. They come from site-index.json,
// which is multi-MB, so it is fetched lazily — on first open, or earlier on
// hover/focus of the button — and memoised for the tab's lifetime (re-fetched
// after 30 min so a long-lived tab doesn't list a company that's gone). If the
// fetch fails the fixed commands still work and the list says so.

const COMPANY_TTL_MS = 30 * 60 * 1000;
let companyCache: { at: number; promise: Promise<Command[]> } | null = null;

function loadCompanyCommands(): Promise<Command[]> {
  if (companyCache && Date.now() - companyCache.at < COMPANY_TTL_MS) return companyCache.promise;
  const promise = fetchSiteIndex().then((index) => buildCompanyCommands(index.items, BASE_URL));
  companyCache = { at: Date.now(), promise };
  // A failed load must not poison the cache — the next open retries.
  promise.catch(() => {
    if (companyCache?.promise === promise) companyCache = null;
  });
  return promise;
}

// Astro's client router keeps the page transition feel (and the persisted
// state) the rest of the site has. Imported lazily so server rendering of this
// island never touches a browser-only module; a plain navigation is the
// fallback if the router isn't present.
async function go(href: string): Promise<void> {
  try {
    const { navigate } = await import("astro:transitions/client");
    await navigate(href);
  } catch {
    window.location.assign(href);
  }
}

interface Section {
  group: CommandGroup;
  rows: { command: Command; index: number }[];
}

function toSections(results: Command[]): Section[] {
  const sections: Section[] = [];
  results.forEach((command, index) => {
    let section = sections[sections.length - 1];
    if (!section || section.group !== command.group) {
      section = { group: command.group, rows: [] };
      sections.push(section);
    }
    section.rows.push({ command, index });
  });
  // `results` is already group-ordered; this just guards the invariant.
  return sections.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [companies, setCompanies] = useState<Command[] | null>(null);
  const [companiesFailed, setCompaniesFailed] = useState(false);
  const [toast, setToast] = useState("");
  const [isMac, setIsMac] = useState(false);

  const returnFocusTo = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;

  const staticCommands = useMemo(() => buildStaticCommands(BASE_URL), []);

  const results = useMemo(() => {
    const ranked = rankCommands([...staticCommands, ...(companies ?? [])], query);
    const search = buildSearchCommand(query, BASE_URL);
    return search ? [...ranked, search] : ranked;
  }, [staticCommands, companies, query]);
  const sections = useMemo(() => toSections(results), [results]);

  // Platform label only after hydration, so server and client markup match.
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent));
  }, []);

  const prefetchCompanies = useCallback(() => {
    loadCompanyCommands().catch(() => {});
  }, []);

  const openPalette = useCallback(() => {
    returnFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setActive(0);
    setOpen(true);
  }, []);

  const closePalette = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) {
      const target = returnFocusTo.current;
      // After the dialog unmounts, so focus isn't stolen back by the input.
      requestAnimationFrame(() => target?.focus());
    }
  }, []);

  // Ctrl/⌘ + K toggles from anywhere, including inside a text field — the
  // browser's own Ctrl+K (focus the search bar) is suppressed only while this
  // page is open, which is the convention every site with a palette follows.
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) closePalette(true);
        else openPalette();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, openPalette, closePalette]);

  // While open: lock page scroll, focus the field, and load companies.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();

    let cancelled = false;
    if (companies === null) {
      setCompaniesFailed(false);
      loadCompanyCommands()
        .then((list) => !cancelled && setCompanies(list))
        .catch(() => !cancelled && setCompaniesFailed(true));
    }
    return () => {
      cancelled = true;
      document.body.style.overflow = previousOverflow;
    };
    // Deliberately keyed on `open` only: `companies` is read just to decide
    // whether to start the load, and must not re-run the focus/scroll-lock.
  }, [open]);

  // Keep the highlighted row visible when arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${baseId}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, baseId, results]);

  // The transient confirmation ("Link copied"). Also read out via aria-live.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  async function run(command: Command) {
    // Only the command id and group — never what was typed (analytics.ts's
    // PII rule). A company row is reported as "company", not by name.
    trackEvent("command_palette_run", {
      command_id: command.group === "Companies" ? "company" : command.id,
      group: command.group,
    });
    if (command.run.type === "navigate") {
      closePalette(false);
      await go(command.run.href);
      return;
    }
    closePalette(true);
    if (command.run.action === "toggle-theme") {
      document.getElementById("theme-toggle")?.click();
    } else {
      try {
        await navigator.clipboard.writeText(window.location.href);
        setToast("Link copied");
      } catch {
        setToast("Couldn't copy — use the address bar instead");
      }
    }
  }

  function onInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // Don't act on keys that belong to an IME composition (CJK/Arabic input).
    if (e.nativeEvent.isComposing) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => (results.length ? (i + 1) % results.length : 0));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
        break;
      case "Home":
        if (results.length) {
          e.preventDefault();
          setActive(0);
        }
        break;
      case "End":
        if (results.length) {
          e.preventDefault();
          setActive(results.length - 1);
        }
        break;
      case "Enter": {
        e.preventDefault();
        const chosen = results[active];
        if (chosen) void run(chosen);
        break;
      }
      case "Escape":
        e.preventDefault();
        closePalette(true);
        break;
      case "Tab":
        // A single-field dialog: keep focus inside it.
        e.preventDefault();
        break;
    }
  }

  const loadingCompanies = open && companies === null && !companiesFailed && query.trim() !== "";
  const liveStatus = toast
    ? toast
    : open
      ? `${results.length} ${results.length === 1 ? "result" : "results"}`
      : "";

  const trigger = (
    <button
      type="button"
      onClick={openPalette}
      onPointerEnter={prefetchCompanies}
      onFocus={prefetchCompanies}
      aria-label="Open command palette"
      aria-keyshortcuts="Control+K Meta+K"
      aria-haspopup="dialog"
      title="Search & commands"
      className="flex shrink-0 items-center gap-2 rounded-md border border-slate-300 p-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900 sm:px-2.5"
    >
      <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <span className="hidden sm:inline">Search</span>
      <kbd className="hidden rounded border border-slate-300 px-1.5 text-[11px] font-medium text-slate-500 dark:border-slate-600 dark:text-slate-400 sm:inline">
        {isMac ? "⌘K" : "Ctrl K"}
      </kbd>
    </button>
  );

  const dialog = open
    ? createPortal(
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 px-3 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closePalette(true);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="mx-auto mt-[10vh] w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-center gap-2 border-b border-slate-200 px-3 dark:border-slate-800">
              <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onInputKeyDown}
                role="combobox"
                aria-expanded="true"
                aria-controls={listboxId}
                aria-activedescendant={results.length ? `${baseId}-opt-${active}` : undefined}
                aria-autocomplete="list"
                aria-label="Search commands and companies"
                placeholder="Search a company, page or filter…"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                // 16px: anything smaller makes iOS Safari zoom the page on focus.
                className="h-12 w-full bg-transparent text-base text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
              />
              <kbd className="hidden shrink-0 rounded border border-slate-300 px-1.5 text-[11px] text-slate-500 dark:border-slate-600 dark:text-slate-400 sm:inline">
                esc
              </kbd>
            </div>

            <div id={listboxId} role="listbox" aria-label="Results" className="max-h-[min(60vh,26rem)] overflow-y-auto py-1">
              {sections.map((section) => {
                const headingId = `${baseId}-g-${section.group.replace(/\W+/g, "-")}`;
                return (
                  <div key={section.group} role="group" aria-labelledby={headingId}>
                    <div id={headingId} className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      {section.group}
                    </div>
                    {section.rows.map(({ command, index }) => {
                      const isActive = index === active;
                      return (
                        <div
                          key={command.id}
                          id={`${baseId}-opt-${index}`}
                          role="option"
                          aria-selected={isActive}
                          // mousedown (not click) so the input never loses focus.
                          onMouseDown={(e) => {
                            e.preventDefault();
                            void run(command);
                          }}
                          onMouseMove={() => !isActive && setActive(index)}
                          className={
                            "flex cursor-pointer items-center justify-between gap-3 border-l-2 px-3 py-2 text-sm " +
                            (isActive
                              ? "border-teal-600 bg-teal-50 text-slate-900 dark:border-teal-400 dark:bg-teal-950/50 dark:text-slate-50"
                              : "border-transparent text-slate-700 dark:text-slate-300")
                          }
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            {command.group === "Companies" && <CompanyAvatar company={command.label} />}
                            <span className="truncate">{command.label}</span>
                          </span>
                          {command.hint && (
                            <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{command.hint}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {loadingCompanies && (
                <p className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">Loading companies…</p>
              )}
              {companiesFailed && (
                <p className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                  Company list unavailable right now — pages, filters and actions still work.
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-3 py-2 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <span>
                <kbd className="font-sans">↑↓</kbd> move · <kbd className="font-sans">↵</kbd> select · <kbd className="font-sans">esc</kbd> close
              </span>
              <span className="hidden sm:inline">{isMac ? "⌘K" : "Ctrl K"} anywhere</span>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      {trigger}
      {dialog}
      {/* Result counts and "Link copied" for screen readers, always mounted so
          the live region exists before its text changes. */}
      <div role="status" aria-live="polite" className="sr-only">
        {liveStatus}
      </div>
      {toast && (
        <div
          aria-hidden="true"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-slate-900 px-3 py-2 text-sm text-white shadow-lg dark:bg-slate-100 dark:text-slate-900"
        >
          {toast}
        </div>
      )}
    </>
  );
}
