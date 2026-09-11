import { useEffect, useRef, useState, type ReactElement } from "react";
import { BASE_URL } from "../lib/basePath";
import { hasSeenTour, markTourSeen } from "../lib/tour";

// A real spotlight tour: each step finds its actual on-page element via
// `[data-tour-target="…"]` (set on the real DOM node in FilterBar.tsx,
// HeaderStat.tsx, Layout.astro's nav/footer, and OpportunityTable.tsx's
// first row — see those files), scrolls it into view, cuts a highlighted
// hole for it in a dimming overlay, and anchors a small arrow-pointed
// callout right next to it. Never a centered dialog describing a button by
// name — the tour moves to the actual button, filter, or section and points
// at it directly.
//
// Position tracking is a continuous requestAnimationFrame loop (not a mix
// of scroll/resize/MutationObserver listeners) — it's one querySelector +
// getBoundingClientRect() per frame, only while the tour is open, and it
// correctly self-heals from every case that would break a listener-based
// approach for free: the target not existing yet (data still loading — the
// callout just shows a centered fallback until the element appears next
// frame), the page reflowing, or the user scrolling manually mid-step.

type StepIcon = (props: { className: string }) => ReactElement;

const RefreshIcon: StepIcon = ({ className }) => (
  <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 0 1 15.3-6.4L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15.3 6.4L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
);

const FilterIcon: StepIcon = ({ className }) => (
  <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="6" x2="20" y2="6" />
    <circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <circle cx="16" cy="12" r="2" fill="currentColor" stroke="none" />
    <line x1="4" y1="18" x2="20" y2="18" />
    <circle cx="11" cy="18" r="2" fill="currentColor" stroke="none" />
  </svg>
);

const SortIcon: StepIcon = ({ className }) => (
  <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 4v16" />
    <path d="M3 8l4-4 4 4" />
    <path d="M17 20V4" />
    <path d="M13 16l4 4 4-4" />
  </svg>
);

const TargetIcon: StepIcon = ({ className }) => (
  <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="12" cy="12" r="0.5" fill="currentColor" />
  </svg>
);

const UserIcon: StepIcon = ({ className }) => (
  <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="3.5" />
    <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
  </svg>
);

const RssIcon: StepIcon = ({ className }) => (
  <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="5" cy="19" r="1.5" fill="currentColor" stroke="none" />
    <path d="M4 11a9 9 0 0 1 9 9" />
    <path d="M4 4a16 16 0 0 1 16 16" />
  </svg>
);

interface Step {
  /** Matches a `data-tour-target="…"` attribute somewhere on the current
   * page. If it can't be found (not rendered yet, or genuinely absent) the
   * callout falls back to a plain centered card for that step instead of
   * getting stuck. */
  target: string;
  icon: StepIcon;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    target: "header-stat",
    icon: RefreshIcon,
    title: "Live, right now",
    body: "This count updates as the pipeline refreshes hourly — no stale number, nothing to manually reload.",
  },
  {
    target: "filters",
    icon: FilterIcon,
    title: "Filter it down",
    body: "Company, region, country, level, and role all narrow the list at once. Save a combination as your default view.",
  },
  {
    target: "sort-mode",
    icon: SortIcon,
    title: "Choose how it's ranked",
    body: "Top companies, Newest, or Best match — match ranks against your profile (or a saved filter) once you've set one up.",
  },
  {
    target: "job-row",
    icon: TargetIcon,
    title: "Every link is the real posting",
    body: "Straight to the company's own apply page, never a third-party reposting. A dead link gets flagged automatically.",
  },
  {
    target: "workspace-nav",
    icon: UserIcon,
    title: "Your workspace",
    body: "Set up a profile for a match score on every listing, track applications through stages, or run the résumé check.",
  },
  {
    target: "rss-feeds",
    icon: RssIcon,
    title: "No email server here, on purpose",
    body: "Grab an RSS feed instead and read new postings wherever you already read feeds.",
  },
];

const SPOTLIGHT_PADDING = 8;
const CALLOUT_GAP = 14;
const VIEWPORT_MARGIN = 16;
const DEFAULT_CALLOUT_SIZE = { width: 300, height: 180 };

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function findTargetRect(target: string): Rect | null {
  const el = document.querySelector(`[data-tour-target="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export default function TourModal() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [calloutSize, setCalloutSize] = useState(DEFAULT_CALLOUT_SIZE);
  const calloutRef = useRef<HTMLDivElement | null>(null);
  const stepRef = useRef(0);
  stepRef.current = step;

  // Exactly once, ever, per browser: mark it seen the moment the automatic
  // tour actually opens — not on close/Skip/complete. Marking only on close
  // meant abandoning the tour mid-way (a direct nav-link click, closing the
  // tab) never set the flag, so it kept reopening on every later visit. The
  // manual "Take the tour" button below is unaffected — it always works.
  useEffect(() => {
    if (!hasSeenTour()) {
      setOpen(true);
      markTourSeen();
    }
  }, []);

  // Scroll the current step's real element into view whenever the step (or
  // open state) changes.
  useEffect(() => {
    if (!open) return;
    const el = document.querySelector(`[data-tour-target="${STEPS[step].target}"]`);
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center", inline: "nearest" });
  }, [open, step]);

  // Continuous position tracking — see the file-level comment for why a
  // rAF loop instead of scroll/resize/MutationObserver listeners.
  useEffect(() => {
    if (!open) {
      setTargetRect(null);
      return;
    }
    let raf = 0;
    function tick() {
      setTargetRect(findTargetRect(STEPS[stepRef.current].target));
      const calloutEl = calloutRef.current;
      if (calloutEl) {
        const r = calloutEl.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          setCalloutSize((prev) => (prev.width === r.width && prev.height === r.height ? prev : { width: r.width, height: r.height }));
        }
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  function close() {
    setOpen(false);
  }
  function next() {
    if (step < STEPS.length - 1) setStep(step + 1);
    else close();
  }
  function back() {
    if (step > 0) setStep(step - 1);
  }
  function start() {
    setStep(0);
    setCalloutSize(DEFAULT_CALLOUT_SIZE);
    setOpen(true);
  }

  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  const spotlight = targetRect && {
    top: targetRect.top - SPOTLIGHT_PADDING,
    left: targetRect.left - SPOTLIGHT_PADDING,
    width: targetRect.width + SPOTLIGHT_PADDING * 2,
    height: targetRect.height + SPOTLIGHT_PADDING * 2,
  };

  let calloutStyle: { top: number | string; left: number | string; transform?: string };
  let arrow: { side: "top" | "bottom"; left: number } | null = null;

  if (spotlight && typeof window !== "undefined") {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const spaceBelow = vh - (spotlight.top + spotlight.height);
    const spaceAbove = spotlight.top;
    const placeBelow = spaceBelow >= calloutSize.height + CALLOUT_GAP + VIEWPORT_MARGIN || spaceBelow >= spaceAbove;

    let top = placeBelow
      ? spotlight.top + spotlight.height + CALLOUT_GAP
      : spotlight.top - CALLOUT_GAP - calloutSize.height;
    top = Math.min(Math.max(top, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, vh - calloutSize.height - VIEWPORT_MARGIN));

    const targetCenterX = spotlight.left + spotlight.width / 2;
    let left = targetCenterX - calloutSize.width / 2;
    left = Math.min(Math.max(left, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, vw - calloutSize.width - VIEWPORT_MARGIN));

    calloutStyle = { top, left };
    arrow = { side: placeBelow ? "top" : "bottom", left: Math.min(Math.max(targetCenterX - left, 20), calloutSize.width - 20) };
  } else {
    // Fallback while the target hasn't rendered yet (or genuinely isn't on
    // this page) — a plain centered card instead of getting stuck.
    calloutStyle = { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }

  return (
    <>
      {/* Persistent re-open trigger — the tour only opens on its own once
          per browser, but it stays reachable for anyone who skipped it or
          wants a refresher. */}
      <button
        type="button"
        onClick={start}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        aria-label="Take the tour"
      >
        <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 1.9-2.4 3.7" />
          <path d="M12 17h.01" />
        </svg>
        Take the tour
      </button>

      {open && (
        <>
          <div className="tour-backdrop fixed inset-0 z-50 bg-slate-950/60" onClick={close} />

          {spotlight && (
            <div
              aria-hidden="true"
              className="tour-spotlight pointer-events-none fixed z-50 rounded-xl ring-2 ring-teal-400 dark:ring-teal-300"
              style={{
                top: spotlight.top,
                left: spotlight.left,
                width: spotlight.width,
                height: spotlight.height,
                boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.6)",
              }}
            />
          )}

          <div
            ref={calloutRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="tour-title"
            className="tour-callout fixed z-[60] w-[min(300px,calc(100vw-32px))] rounded-xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-800 dark:bg-slate-900"
            style={calloutStyle}
            onClick={(e) => e.stopPropagation()}
          >
            {arrow && (
              <span
                aria-hidden="true"
                className={
                  "absolute h-3 w-3 rotate-45 border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 " +
                  (arrow.side === "top" ? "-top-1.5 border-b-0 border-r-0" : "-bottom-1.5 border-l-0 border-t-0")
                }
                style={{ left: arrow.left - 6 }}
              />
            )}

            {/* key={step} replays .tour-callout-enter / .tour-icon-pop for
                the new content each time Next/Back is clicked. */}
            <div key={step}>
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="tour-icon-pop flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300">
                  <Icon className="h-4 w-4" />
                </div>
                <button
                  type="button"
                  onClick={close}
                  className="mt-1 shrink-0 text-xs text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
                >
                  Skip
                </button>
              </div>
              <div className="tour-callout-enter">
                <h2 id="tour-title" className="mb-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {current.title}
                </h2>
                <p className="mb-3 text-xs leading-relaxed text-slate-600 dark:text-slate-400">{current.body}</p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                {step + 1} / {STEPS.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={back}
                  disabled={step === 0}
                  className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-0 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Back
                </button>
                {isLast ? (
                  <a
                    href={`${BASE_URL}profile`}
                    onClick={close}
                    className="rounded-md bg-teal-600 px-3 py-1 text-xs font-medium text-white hover:bg-teal-700 dark:bg-teal-500 dark:hover:bg-teal-400"
                  >
                    Set up your profile
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={next}
                    className="rounded-md bg-teal-600 px-3 py-1 text-xs font-medium text-white hover:bg-teal-700 dark:bg-teal-500 dark:hover:bg-teal-400"
                  >
                    Next
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
