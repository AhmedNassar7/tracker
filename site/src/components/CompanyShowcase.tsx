import { useEffect, useRef, useState } from "react";
import { logoCandidates } from "../lib/companyLogos";
import { companyNameMatches, type FilterState } from "../lib/filters";

// A moving "logo wall" of FAANG + big-tech names tracked on this site — pure
// visual attractor between the hero and the list. Real hand-verified logos
// (companyLogos.ts) via CompanyShowcaseLogo below, not guessed favicons.
// Clicking a logo applies it as a quick search, same mechanic as the
// SnapshotHero chips above it.
//
// The scroll itself is driven from a rAF loop (not CSS @keyframes) so a drag
// can share the exact same position variable: grabbing the strip and moving
// the mouse scrolls it 1:1 in that direction, and releasing resumes the
// automatic drift from wherever it was left — no jump back to a keyframe's
// start position, which a CSS-animation-plus-manual-transform hybrid would
// cause. Hovering (no drag needed) still just pauses it, same as before.

const SHOWCASE_COMPANIES = [
  "Google",
  "Meta",
  "Apple",
  "Amazon",
  "Netflix",
  "Microsoft",
  "Nvidia",
  "IBM",
  "Oracle",
  "Salesforce",
  "Adobe",
  "Cisco",
  "SAP",
  "Samsung",
] as const;

// Auto-scroll speed in px/second. A constant speed (rather than a fixed
// duration for a loop of varying width) is the standard marquee approach.
const AUTO_SCROLL_SPEED = 45;
// A pointer that has moved less than this many px doesn't count as a drag
// yet — pointer capture (which starts the manual scroll) only engages past
// this. Capturing immediately on every pointerdown, before this check, was
// a real bug: a captured pointer's eventual "click" retargets to the
// capturing element instead of the button under the cursor, so a plain
// click on a logo never reached its onClick at all, dragged or not.
const DRAG_CLICK_THRESHOLD = 6;

interface LogoProps {
  company: string;
  onSelect: (patch: Partial<FilterState>) => void;
  // True while this exact company is the active filter — confirms the click
  // actually landed, since otherwise nothing near the strip itself changes.
  active: boolean;
  // True for the duplicate track (the seamless-loop copy) — kept out of tab
  // order so keyboard users don't hit an invisible-to-screen-readers repeat
  // of every logo before reaching the real content below.
  decorative?: boolean;
}

function CompanyShowcaseLogo({ company, onSelect, active, decorative = false }: LogoProps) {
  const candidates = logoCandidates(company, 96);
  const [srcIndex, setSrcIndex] = useState(0);
  const src = candidates[srcIndex];

  return (
    <button
      type="button"
      tabIndex={decorative ? -1 : 0}
      aria-hidden={decorative}
      aria-pressed={active}
      onClick={() => onSelect({ companies: active ? [] : [company] })}
      title={active ? `Showing ${company} roles — click to clear` : `Show ${company} roles`}
      className={
        "group mx-2 flex w-28 shrink-0 flex-col items-center gap-2 rounded-xl border p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-teal-300 hover:bg-white hover:shadow-md dark:hover:border-teal-700 dark:hover:bg-slate-900 " +
        (active
          ? "border-teal-500 bg-white shadow-md dark:border-teal-500 dark:bg-slate-900"
          : "border-transparent")
      }
    >
      {src ? (
        <img
          src={src}
          alt=""
          aria-hidden="true"
          width={40}
          height={40}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setSrcIndex((i) => i + 1)}
          className={
            "h-10 w-10 rounded-lg bg-white object-contain p-1.5 ring-1 transition-all duration-200 dark:bg-slate-800 " +
            (active ? "ring-2 ring-teal-500 dark:ring-teal-500" : "ring-slate-200 dark:ring-slate-700")
          }
        />
      ) : (
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          {company.slice(0, 2).toUpperCase()}
        </span>
      )}
      <span
        className={
          "text-xs font-medium transition-colors group-hover:text-slate-900 dark:group-hover:text-slate-100 " +
          (active ? "font-semibold text-teal-700 dark:text-teal-300" : "text-slate-500 dark:text-slate-400")
        }
      >
        {company}
      </span>
    </button>
  );
}

interface Props {
  onSelect: (patch: Partial<FilterState>) => void;
  // The current company filter (FilterState.companies) — used only to detect
  // when it names one of this strip's own companies, so the strip can
  // confirm "yes, that click worked" right where the click happened. A
  // word-boundary match (companyNameMatches), same as the filter itself, not
  // a plain substring check.
  activeCompanies: string[];
}

export default function CompanyShowcase({ onSelect, activeCompanies }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const pointerDownRef = useRef(false);
  const draggingRef = useRef(false);
  const hoveredRef = useRef(false);
  const lastXRef = useRef(0);
  const dragDistanceRef = useRef(0);
  const reducedMotionRef = useRef(false);

  const activeCompany = SHOWCASE_COMPANIES.find((c) =>
    activeCompanies.some((ac) => companyNameMatches(c, ac) || companyNameMatches(ac, c)),
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionRef.current = mq.matches;
    const onChange = () => {
      reducedMotionRef.current = mq.matches;
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // The auto-scroll loop. Skipped entirely under reduced motion — the track
  // then keeps CSS's static wrapped-grid layout with no inline transform,
  // and drag is disabled too (nothing to grab-scroll on a wrapped grid).
  useEffect(() => {
    if (reducedMotionRef.current) return;
    let raf = 0;
    let last: number | null = null;

    function wrap(track: HTMLDivElement) {
      const half = track.scrollWidth / 2;
      if (half <= 0) return;
      if (offsetRef.current <= -half) offsetRef.current += half;
      if (offsetRef.current > 0) offsetRef.current -= half;
    }

    function tick(now: number) {
      const track = trackRef.current;
      if (last === null) last = now;
      const dt = (now - last) / 1000;
      last = now;
      if (track) {
        if (!draggingRef.current && !hoveredRef.current) {
          offsetRef.current -= AUTO_SCROLL_SPEED * dt;
          wrap(track);
        }
        track.style.transform = `translateX(${offsetRef.current}px)`;
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  function applyDelta(dx: number) {
    const track = trackRef.current;
    offsetRef.current += dx;
    if (track) {
      const half = track.scrollWidth / 2;
      if (half > 0) {
        if (offsetRef.current <= -half) offsetRef.current += half;
        if (offsetRef.current > 0) offsetRef.current -= half;
      }
      track.style.transform = `translateX(${offsetRef.current}px)`;
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (reducedMotionRef.current) return;
    pointerDownRef.current = true;
    dragDistanceRef.current = 0;
    lastXRef.current = e.clientX;
    // Deliberately NOT calling setPointerCapture here yet — see the
    // DRAG_CLICK_THRESHOLD comment above. It's engaged in onPointerMove only
    // once real dragging is detected, so a plain click's native click event
    // still reaches the logo button normally.
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointerDownRef.current) return;
    const dx = e.clientX - lastXRef.current;
    lastXRef.current = e.clientX;
    dragDistanceRef.current += Math.abs(dx);
    if (!draggingRef.current && dragDistanceRef.current > DRAG_CLICK_THRESHOLD) {
      draggingRef.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (draggingRef.current) applyDelta(dx);
  }
  function endDrag() {
    pointerDownRef.current = false;
    draggingRef.current = false;
  }
  // Runs before the click reaches a logo <button> — a real drag (moved past
  // the threshold) suppresses the click so dragging never also triggers that
  // logo's "show these roles" filter. Kept as a second layer on top of the
  // deferred setPointerCapture above, not a replacement for it.
  function onClickCapture(e: React.MouseEvent<HTMLDivElement>) {
    if (dragDistanceRef.current > DRAG_CLICK_THRESHOLD) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  return (
    <section aria-label="Companies tracked on this site" className="mb-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        Companies we track
      </p>
      <div
        className="logo-marquee-viewport touch-pan-y cursor-grab select-none rounded-xl border border-slate-200 bg-slate-50/60 py-3 active:cursor-grabbing dark:border-slate-800 dark:bg-slate-900/40"
        onMouseEnter={() => {
          hoveredRef.current = true;
        }}
        onMouseLeave={() => {
          hoveredRef.current = false;
          endDrag();
        }}
        onFocus={() => {
          hoveredRef.current = true;
        }}
        onBlur={() => {
          hoveredRef.current = false;
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
      >
        <div className="logo-marquee-track" ref={trackRef}>
          <div className="logo-marquee-group">
            {SHOWCASE_COMPANIES.map((company) => (
              <CompanyShowcaseLogo
                key={company}
                company={company}
                onSelect={onSelect}
                active={company === activeCompany}
              />
            ))}
          </div>
          <div className="logo-marquee-group" aria-hidden="true">
            {SHOWCASE_COMPANIES.map((company) => (
              <CompanyShowcaseLogo
                key={`${company}-dup`}
                company={company}
                onSelect={onSelect}
                active={company === activeCompany}
                decorative
              />
            ))}
          </div>
        </div>
      </div>
      {activeCompany && (
        <div
          key={activeCompany}
          className="row-enter mt-2 flex items-center gap-2 rounded-md border border-teal-200 bg-teal-50 px-3 py-1.5 text-sm text-teal-900 dark:border-teal-900 dark:bg-teal-950 dark:text-teal-100"
        >
          <span>
            Showing roles at <strong>{activeCompany}</strong>
          </span>
          <button
            type="button"
            onClick={() => onSelect({ companies: [] })}
            className="ml-auto text-teal-700 underline underline-offset-2 hover:text-teal-900 dark:text-teal-300 dark:hover:text-teal-100"
          >
            Clear
          </button>
        </div>
      )}
    </section>
  );
}
