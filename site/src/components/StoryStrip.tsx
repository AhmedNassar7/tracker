import { DEFAULT_FILTERS, searchParamsFromFilters, type FilterState } from "../lib/filters";
import type { StoryCard } from "../lib/types";

// D1 — the "story strip". A row of 3-4 auto-generated stat cards (built by
// build_story_cards() in the pipeline, so every word of `title`/`detail` is
// generated, not hand-written here). Lives on the Dashboard now (moved off
// the main list 2026-09-10 — the roles come first there). Two call shapes:
//   • onSelect  — apply the card's filter in place (unused today)
//   • linkBase  — render each card as a link to the jobs page, filter in the URL
// Purely additive: if data/story-cards.json is missing or empty, it doesn't render.
//
// Everything in *this* file is presentation only — the emoji, the trend
// arrow/colour, the motion. None of it invents a fact: the emoji is chosen
// from the card's stable `id`, and the ▲/▼ + tint are read back out of the
// generated `detail` string ("… up 12%" / "… down 7%"). No `detail` text is
// rewritten, only decorated.

interface Props {
  cards: StoryCard[];
  /** In-place: apply the card's filter to the current list. */
  onSelect?: (patch: Partial<FilterState>) => void;
  /** Link mode: each card is a link to `${linkBase}?<filter params>`. */
  linkBase?: string;
}

function cardHref(base: string, filter: StoryCard["filter"]): string {
  const params = searchParamsFromFilters({ ...DEFAULT_FILTERS, ...(filter as Partial<FilterState>) }).toString();
  return params ? `${base}?${params}` : base;
}

type Trend = "up" | "down" | "flat";

interface CardSkin {
  emoji: string;
  /** tint for the emoji badge + hover ring */
  accent: string;
}

const SKIN_BY_ID: Record<string, CardSkin> = {
  "internship-trend": { emoji: "🎓", accent: "sky" },
  "new_grad-trend": { emoji: "🚀", accent: "violet" },
  "top-companies": { emoji: "🔥", accent: "amber" },
  geography: { emoji: "🌍", accent: "teal" },
};
const DEFAULT_SKIN: CardSkin = { emoji: "✨", accent: "teal" };

// Static class fragments per accent so Tailwind's scanner keeps them.
const ACCENT: Record<string, { badge: string; hoverBorder: string }> = {
  sky: {
    badge: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
    hoverBorder: "hover:border-sky-400 dark:hover:border-sky-500",
  },
  violet: {
    badge: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
    hoverBorder: "hover:border-violet-400 dark:hover:border-violet-500",
  },
  amber: {
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    hoverBorder: "hover:border-amber-400 dark:hover:border-amber-500",
  },
  teal: {
    badge: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
    hoverBorder: "hover:border-teal-400 dark:hover:border-teal-500",
  },
};

/** Pull "up 12%" / "down 7%" out of a generated detail string, if present. */
function splitTrend(detail: string): { lead: string; trend: Trend; move: string } {
  const m = detail.match(/^(.*?)\s*(up|down)\s+(\d+(?:\.\d+)?%)\s*$/i);
  if (!m) return { lead: detail, trend: "flat", move: "" };
  return { lead: m[1].trim(), trend: m[2].toLowerCase() as Trend, move: m[3] };
}

const TREND_TEXT: Record<Trend, string> = {
  up: "text-emerald-600 dark:text-emerald-400",
  down: "text-rose-600 dark:text-rose-400",
  flat: "",
};
const TREND_ARROW: Record<Trend, string> = { up: "▲", down: "▼", flat: "" };

export default function StoryStrip({ cards, onSelect, linkBase }: Props) {
  if (cards.length === 0) return null;

  return (
    <section aria-label="This week's hiring snapshot">
      <h2 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        <span aria-hidden="true">📊</span> This week&apos;s hiring trends
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card, i) => {
          const skin = SKIN_BY_ID[card.id] ?? DEFAULT_SKIN;
          const accent = ACCENT[skin.accent] ?? ACCENT.teal;
          const hasFilter = Object.keys(card.filter).length > 0;
          const { lead, trend, move } = splitTrend(card.detail);

          const inner = (
            <>
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={
                    "grid h-8 w-8 flex-none place-items-center rounded-lg text-base transition-transform duration-200 " +
                    "motion-safe:group-hover:-rotate-6 motion-safe:group-hover:scale-110 " +
                    accent.badge
                  }
                >
                  {skin.emoji}
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  {card.title}
                </span>
              </div>

              <span className="mt-2 block text-[15px] font-semibold leading-snug text-slate-800 dark:text-slate-100">
                {move ? (
                  <>
                    {lead}{" "}
                    <span className={"whitespace-nowrap font-bold " + TREND_TEXT[trend]}>
                      <span aria-hidden="true">{TREND_ARROW[trend]}</span> {trend} {move}
                    </span>
                  </>
                ) : (
                  card.detail
                )}
              </span>

              {hasFilter && (
                <span className="mt-auto flex items-center gap-1 pt-2 text-[11px] font-medium text-teal-700 dark:text-teal-400">
                  Show these
                  <span
                    aria-hidden="true"
                    className="transition-transform duration-200 motion-safe:group-hover:translate-x-1"
                  >
                    →
                  </span>
                </span>
              )}
            </>
          );

          const shared =
            "story-card-enter group flex min-h-[7.5rem] flex-col rounded-xl border border-slate-200 " +
            "bg-white p-3.5 text-left shadow-sm transition-all duration-200 " +
            "dark:border-slate-800 dark:bg-slate-900 " +
            accent.hoverBorder +
            " motion-safe:hover:-translate-y-1 hover:shadow-lg " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950";

          if (!hasFilter) {
            return (
              <div key={card.id} className={shared} style={{ animationDelay: `${i * 70}ms` }}>
                {inner}
              </div>
            );
          }
          const interactiveCls = shared + " cursor-pointer active:translate-y-0 motion-safe:active:scale-[0.98]";
          if (linkBase) {
            return (
              <a
                key={card.id}
                href={cardHref(linkBase, card.filter)}
                style={{ animationDelay: `${i * 70}ms` }}
                className={interactiveCls}
              >
                {inner}
              </a>
            );
          }
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => onSelect?.(card.filter as Partial<FilterState>)}
              style={{ animationDelay: `${i * 70}ms` }}
              className={interactiveCls}
            >
              {inner}
            </button>
          );
        })}
      </div>
    </section>
  );
}
