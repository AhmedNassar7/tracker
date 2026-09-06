import type { FilterState } from "../lib/filters";
import type { StoryCard } from "../lib/types";

// D1 — the "story strip". A row of 3-4 auto-generated stat cards (built by
// build_story_cards() in the pipeline, so every word is generated, not
// hand-written here) sitting between the hero and the list. Clicking a card
// applies its pre-baked filter and jumps to the results. Purely additive:
// if data/story-cards.json is missing or empty, the strip just doesn't render.

interface Props {
  cards: StoryCard[];
  onSelect: (patch: Partial<FilterState>) => void;
}

export default function StoryStrip({ cards, onSelect }: Props) {
  if (cards.length === 0) return null;
  return (
    <section aria-label="This week's hiring snapshot" className="mb-6">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cards.map((card) => {
          const hasFilter = Object.keys(card.filter).length > 0;
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => onSelect(card.filter as Partial<FilterState>)}
              className="group flex flex-col rounded-lg border border-slate-200 bg-white p-3 text-left transition-colors hover:border-teal-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-500"
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {card.title}
              </span>
              <span className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-100">
                {card.detail}
              </span>
              {hasFilter && (
                <span className="mt-auto pt-1.5 text-[11px] text-teal-700 opacity-0 transition-opacity group-hover:opacity-100 dark:text-teal-400">
                  Show these →
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
