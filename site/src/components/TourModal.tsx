import { useEffect, useRef, useState } from "react";
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
const STEPS: { title: string; body: string }[] = [
  {
    title: "Jobs, hackathons & events — merged hourly",
    body: "Every row here comes straight from a company's own careers API, a hackathon platform, or a hand-checked event page — 20+ sources, no manual copy-pasting, refreshed on a schedule you can see in the header.",
  },
  {
    title: "Filter down to what's actually yours",
    body: "Company, region, country, level, and role all narrow the list at once. Found a combination worth keeping? Save it as your default view so it's there next time, no re-filtering.",
  },
  {
    title: "Open a role to see the real posting",
    body: "Every listing links straight to the company's own apply page — never a third-party reposting. Set up your Profile once (skills, experience, target roles) and matching listings show a plain-language match score.",
  },
  {
    title: "Track applications, not tabs",
    body: "Move anything from the list into Applications and step it through stages as you apply, hear back, and interview. A link that goes dead gets flagged automatically — you're never left wondering if a posting quietly closed.",
  },
  {
    title: "Prefer email or a feed reader?",
    body: "There's no email-alert server here on purpose — instead, grab an RSS feed (all jobs, internships, new grad, hackathons, or events) from the footer and read new postings wherever you already read feeds.",
  },
];

export default function TourModal() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasSeenTour()) setOpen(true);
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
    markTourSeen();
  }

  function next() {
    if (step < STEPS.length - 1) setStep(step + 1);
    else close();
  }

  function back() {
    if (step > 0) setStep(step - 1);
  }

  const current = STEPS[step];
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6"
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
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl outline-none dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="mb-3 flex items-center justify-between text-xs font-medium text-slate-400 dark:text-slate-500">
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
            <h2 id="tour-title" className="mb-2 text-base font-semibold text-slate-900 dark:text-slate-100">
              {current.title}
            </h2>
            <p className="mb-5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{current.body}</p>

            <div className="mb-4 flex gap-1.5">
              {STEPS.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-teal-600 dark:bg-teal-400" : "bg-slate-200 dark:bg-slate-700"}`}
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
