interface Props {
  page: number; // 1-indexed, already clamped to [1, totalPages]
  totalPages: number;
  onChange: (next: number) => void;
}

// Compact page list: always the first and last page, the current page and
// its neighbours, and a single "…" wherever a gap is elided.
function pageList(page: number, total: number): (number | "gap")[] {
  const out: (number | "gap")[] = [];
  const want = new Set<number>([1, total, page - 1, page, page + 1]);
  let last = 0;
  for (let p = 1; p <= total; p++) {
    if (!want.has(p)) continue;
    if (p - last > 1) out.push("gap");
    out.push(p);
    last = p;
  }
  return out;
}

const btn =
  "min-w-[2rem] rounded-md border px-2 py-1 text-sm font-medium transition-colors " +
  "border-slate-300 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 " +
  "dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900";

export default function Pagination({ page, totalPages, onChange }: Props) {
  return (
    <nav
      className="mt-4 flex flex-wrap items-center justify-center gap-1.5"
      aria-label="Pagination"
    >
      <button type="button" className={btn} onClick={() => onChange(page - 1)} disabled={page <= 1}>
        ‹ Prev
      </button>

      {pageList(page, totalPages).map((p, i) =>
        p === "gap" ? (
          <span key={`gap-${i}`} className="px-1 text-slate-400 select-none">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            aria-current={p === page ? "page" : undefined}
            className={
              p === page
                ? "min-w-[2rem] rounded-md border border-teal-600 bg-teal-600 px-2 py-1 text-sm font-semibold text-white dark:border-teal-500 dark:bg-teal-500"
                : btn
            }
          >
            {p.toLocaleString()}
          </button>
        ),
      )}

      <button
        type="button"
        className={btn}
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
      >
        Next ›
      </button>
    </nav>
  );
}
