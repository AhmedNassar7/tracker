// motion-reduce:animate-none respects prefers-reduced-motion (the plan's
// own rule 4/5: "every animation respects prefers-reduced-motion") — the
// bar still renders as a static placeholder, it just doesn't pulse.

interface Props {
  className?: string;
}

export default function Skeleton({ className = "" }: Props) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded bg-slate-200 motion-reduce:animate-none dark:bg-slate-800 ${className}`}
    />
  );
}
