import { useEffect, useRef, useState, type ReactElement } from "react";
import { BASE_URL } from "../lib/basePath";
import { hasSeenTour, markTourSeen } from "../lib/tour";

// A short, self-paced walkthrough of what's already here — filters, match
// scores, the application tracker, and how the data stays fresh — for a
// first-time visitor who lands on a dense job table with no explanation.
// Deliberately a content-card carousel, not a spotlight-over-the-live-page
// tour: spotlighting real elements needs per-breakpoint position tracking
// that's easy to get subtly wrong (and hard to verify without a browser in
// the loop), while a modal degrades to "just some text" if anything about
// the page around it changes later. Every claim below describes a feature
// that actually exists — this is a map of the site, not marketing copy.
// Each step instead names its concrete on-page location in a "where" chip,
// so a visitor who dismisses the tour still knows where to look.

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

const TargetIcon: StepIcon = ({ className }) => (
  <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="12" cy="12" r="0.5" fill="currentColor" />
  </svg>
);

const ColumnsIcon: StepIcon = ({ className }) => (
  <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="5" height="16" rx="1" />
    <rect x="9.5" y="4" width="5" height="10" rx="1" />
    <rect x="16" y="4" width="5" height="13" rx="1" />
  </svg>
);

const RssIcon: StepIcon = ({ className }) => (
  <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="5" cy="19" r="1.5" fill="currentColor" stroke="none" />
    <path d="M4 11a9 9 0 0 1 9 9" />
    <path d="M4 4a16 16 0 0 1 16 16" />
  </svg>
);

const PinIcon: StepIcon = ({ className }) => (
  <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.2" />
  </svg>
);

interface Step {
  icon: StepIcon;
  title: string;
  body: string;
  /** Where on the site this feature actually lives — a concrete pointer,
   * not a vague "around here somewhere". */
  where: string;
}

const STEPS: Step[] = [
  {
    icon: RefreshIcon,
    title: "Jobs, hackathons & events — merged hourly",
    body: "Every row here comes straight from a company's own careers API, a hackathon platform, or a hand-checked event page — 20+ sources, no manual copy-pasting.",
    where: "Live count + pulse, top-right of every page",
  },
  {
    icon: FilterIcon,
    title: "Filter down to what's actually yours",
    body: "Company, region, country, level, and role all narrow the list at once. Found a combination worth keeping? Save it as your default view so it's there next time.",
    where: "Filter bar, just below the header",
  },
  {
    icon: TargetIcon,
    title: "Open a role to see the real posting",
    body: "Every listing links straight to the company's own apply page — never a third-party reposting. Set up your profile once and matching listings show a plain-language match score.",
    where: "Any row in the list → your Profile page",
  },
  {
    icon: ColumnsIcon,
    title: "Track applications, not tabs",
    body: "Move anything from the list into Applications and step it through stages as you apply, hear back, and interview. A link that goes dead gets flagged automatically.",
    where: "\"Applications\" in the top navigation",
  },
  {
    icon: RssIcon,
    title: "Prefer email or a feed reader?",
    body: "There's no email-alert server here on purpose — instead, grab an RSS feed (all jobs, internships, new grad, hackathons, or events) and read new postings wherever you already read feeds.",
    where: "RSS links, footer of every page",
  },
];

export default function TourModal() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Exactly once, ever, per browser: mark it seen the moment the automatic
  // tour actually opens — not on close/Skip/complete. Marking only on close
  // meant abandoning the tour mid-way (a direct nav-link click, closing the
  // tab) never set the flag, so it kept reopening on every later visit until
  // someone explicitly dismissed it. The manual "Take the tour" button below
  // is unaffected — it always works, on purpose.
  useEffect(() => {
    if (!hasSeenTour()) {
      setOpen(true);
      markTourSeen();
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
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

  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  return (
    <>
      {/* Persistent re-open trigger — the modal only opens on its own once
          per browser, but the tour stays reachable for anyone who skipped
          it or wants a refresher. */}
      <button
        type="button"
        onClick={() => {
          setStep(0);
          setOpen(true);
        }}
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
        <div
          className="tour-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="tour-title"
            tabIndex={-1}
            className="tour-dialog w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl outline-none dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="mb-4 flex items-center justify-between text-xs font-medium text-slate-400 dark:text-slate-500">
              <span>
                {step + 1} / {STEPS.length}
              </span>
              <button
                type="button"
                onClick={close}
                className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
              >
                Skip
              </button>
            </div>

            {/* key={step} forces React to remount this subtree on every
                Next/Back — that's what re-triggers .tour-step-enter and
                .tour-icon-pop (a fresh element mounting is what plays a
                guarded-CSS animation; see global.css). */}
            <div key={step}>
              <div className="tour-icon-pop mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300">
                <Icon className="h-5 w-5" />
              </div>
              <div className="tour-step-enter">
                <h2 id="tour-title" className="mb-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                  {current.title}
                </h2>
                <p className="mb-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{current.body}</p>
                <p className="mb-5 inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  <PinIcon className="h-3.5 w-3.5 shrink-0" />
                  {current.where}
                </p>
              </div>
            </div>

            <div className="mb-4 flex gap-1.5">
              {STEPS.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${i <= step ? "bg-teal-600 dark:bg-teal-400" : "bg-slate-200 dark:bg-slate-700"}`}
                />
              ))}
            </div>

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={back}
                disabled={step === 0}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-0 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Back
              </button>
              {isLast ? (
                <a
                  href={`${BASE_URL}profile`}
                  onClick={close}
                  className="rounded-md bg-teal-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-700 dark:bg-teal-500 dark:hover:bg-teal-400"
                >
                  Set up your profile
                </a>
              ) : (
                <button
                  type="button"
                  onClick={next}
                  className="rounded-md bg-teal-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-700 dark:bg-teal-500 dark:hover:bg-teal-400"
                >
                  Next
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
