import { useEffect, useRef, useState } from "react";
import { logoCandidates } from "../lib/companyLogos";
import type { FilterState } from "../lib/filters";

// A moving "logo wall" of FAANG + big-tech names tracked on this site — pure
// visual attractor between the hero and the list. Real hand-verified logos
// (companyLogos.ts) via CompanyShowcaseLogo below, not guessed favicons.
// Clicking a logo applies it as a quick search, same mechanic as the
// SnapshotHero chips and StoryStrip cards it sits between.
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
// A pointer that moved less than this many px between down and up counts as
// a click (applies the company filter), not a drag (just repositioned the
// strip) — without this, starting a drag on a logo would also fire its
// filter navigation.
const DRAG_CLICK_THRESHOLD = 6;

interface LogoProps {
  company: string;
  onSelect: (patch: Partial<FilterState>) => void;
  // True for the duplicate track (the seamless-loop copy) — kept out of tab
  // order so keyboard users don't hit an invisible-to-screen-readers repeat
  // of every logo before reaching the real content below.
  decorative?: boolean;
}

function CompanyShowcaseLogo({ company, onSelect, decorative = false }: LogoProps) {
  const candidates = logoCandidates(company, 96);
  const [srcIndex, setSrcIndex] = useState(0);
  const src = candidates[srcIndex];

  return (
    <button
      type="button"
      tabIndex={decorative ? -1 : 0}
      aria-hidden={decorative}
      onClick={() => onSelect({ q: company })}
      title={`Show ${company} roles`}
      className="group mx-2 flex w-28 shrink-0 flex-col items-center gap-2 rounded-xl border border-transparent p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-teal-300 hover:bg-white hover:shadow-md dark:hover:border-teal-700 dark:hover:bg-slate-900"
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
          className="h-10 w-10 rounded-lg bg-white object-contain p-1.5 ring-1 ring-slate-200 transition-all duration-200 dark:bg-slate-800 dark:ring-slate-700"
        />
      ) : (
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          {company.slice(0, 2).toUpperCase()}
        </span>
      )}
      <span className="text-xs font-medium text-slate-500 transition-colors group-hover:text-slate-900 dark:text-slate-400 dark:group-hover:text-slate-100">
        {company}
      </span>
    </button>
  );
}

interface Props {
  onSelect: (patch: Partial<FilterState>) => void;
}

export default function CompanyShowcase({ onSelect }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const draggingRef = useRef(false);
  const hoveredRef = useRef(false);
  const lastXRef = useRef(0);
  const dragDistanceRef = useRef(0);
  const reducedMotionRef = useRef(false);

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
    draggingRef.current = true;
    dragDistanceRef.current = 0;
    lastXRef.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    const dx = e.clientX - lastXRef.current;
    lastXRef.current = e.clientX;
    dragDistanceRef.current += Math.abs(dx);
    applyDelta(dx);
  }
  function endDrag() {
    draggingRef.current = false;
  }
  // Runs before the click reaches a logo <button> — a real drag (moved past
  // the threshold) suppresses the click so dragging never also triggers that
  // logo's "show these roles" filter.
  function onClickCapture(e: React.MouseEvent<HTMLDivElement>) {
    if (dragDistanceRef.current > DRAG_CLICK_THRESHOLD) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  return (
    <section aria-label="Companies tracked on this site" className="mb-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        Tracking roles at FAANG &amp; big tech
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
              <CompanyShowcaseLogo key={company} company={company} onSelect={onSelect} />
            ))}
          </div>
          <div className="logo-marquee-group" aria-hidden="true">
            {SHOWCASE_COMPANIES.map((company) => (
              <CompanyShowcaseLogo key={`${company}-dup`} company={company} onSelect={onSelect} decorative />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
