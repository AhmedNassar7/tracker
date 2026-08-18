import { useEffect, useRef, useState } from "react";

interface Props {
  tracked: boolean;
  onToggle: () => void;
  label: string;
}

export default function BookmarkButton({ tracked, onToggle, label }: Props) {
  const [popping, setPopping] = useState(false);
  const isFirstRender = useRef(true);

  // Pop only on the transition *into* tracked, and never on mount (an
  // already-bookmarked row loading from storage shouldn't pop) — motion
  // explains a state change, it doesn't decorate the initial render.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (!tracked) return;
    setPopping(true);
    const timeout = setTimeout(() => setPopping(false), 300);
    return () => clearTimeout(timeout);
  }, [tracked]);

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={tracked}
      aria-label={tracked ? `Remove ${label} from your tracked applications` : `Track ${label}`}
      className={
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors active:scale-90 " +
        (popping ? "motion-safe:animate-pop " : "") +
        (tracked
          ? "border-amber-400 bg-amber-50 text-amber-600 dark:border-amber-500 dark:bg-amber-950 dark:text-amber-400"
          : "border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600 dark:border-slate-700 dark:text-slate-500 dark:hover:text-slate-300")
      }
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill={tracked ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      >
        <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
      </svg>
    </button>
  );
}
