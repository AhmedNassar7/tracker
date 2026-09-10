import { useEffect, useState } from "react";
import { BASE_URL } from "../lib/basePath";
import { fetchStoryCards } from "../lib/dataSource";
import type { StoryCard } from "../lib/types";
import StoryStrip from "./StoryStrip";

// Thin wrapper that fetches data/story-cards.json and renders the trend cards
// on the Dashboard. Each card links to the jobs page with its filter in the
// URL. Renders nothing until (and unless) the file loads with cards.
export default function DashboardStory() {
  const [cards, setCards] = useState<StoryCard[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchStoryCards()
      .then((data) => {
        if (!cancelled) setCards(Array.isArray(data.cards) ? data.cards : []);
      })
      .catch(() => {
        /* no story-cards.json yet — nothing to show */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <StoryStrip cards={cards} linkBase={BASE_URL} />;
}
