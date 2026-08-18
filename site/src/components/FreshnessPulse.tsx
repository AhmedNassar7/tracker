// Motion with a truthful basis, not decoration (per the plan's motion
// rules) — this only ever appears next to the real generated_at timestamp
// it's describing, never as a standalone "look, it's alive" flourish.

export default function FreshnessPulse() {
  return (
    <span aria-hidden="true" className="relative inline-flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-75 motion-reduce:animate-none dark:bg-teal-500" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-teal-500 dark:bg-teal-400" />
    </span>
  );
}
