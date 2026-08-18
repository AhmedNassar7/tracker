import Skeleton from "./Skeleton";

interface Props {
  rows?: number;
  label: string;
}

// The skeleton itself is aria-hidden (it's decorative — real content, not
// data) with a visually-hidden status text alongside it, so a screen
// reader gets "Loading opportunities…" instead of a wall of unlabeled
// pulsing divs.
export default function SkeletonTable({ rows = 8, label }: Props) {
  return (
    <div role="status">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="overflow-hidden rounded-md border border-slate-200 dark:border-slate-800">
        <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
          <Skeleton className="h-3 w-32" />
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-3">
              <Skeleton className="h-7 w-7 shrink-0 rounded-md" />
              <Skeleton className="h-4 w-28 shrink-0" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-16 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
