import { BASE_URL } from "./basePath";
import type { SiteIndex, StatsHistory, StoryCards } from "./types";

// Runtime fetch, not a build-time import — the site must show data that's at
// most ~1h stale without ever being redeployed itself (see the plan's
// "decouple site deploy from hourly data refresh" architectural decision).
//
// raw.githubusercontent.com is tried FIRST because it reflects the branch
// head within seconds of a commit. jsDelivr (a real CDN, better EMEA/APAC
// latency) is the fallback — but it caches an `@main` ref for up to 12h and
// only revalidates on an explicit purge, so leading with it means a failed
// or lagging purge leaves visitors staring at hours-old listings where many
// roles have since closed (the #1 "this link is dead" complaint).
const REPO_BASE = "AhmedNassar7/tracker@main/data";
const JSDELIVR_BASE = `https://cdn.jsdelivr.net/gh/${REPO_BASE}`;
const RAW_GITHUB_BASE = "https://raw.githubusercontent.com/AhmedNassar7/tracker/main/data";

// Changes once per hour, so no browser/proxy/CDN can serve a copy older than
// that even if it ignores `cache: "no-store"`.
function hourlyCacheBuster(): string {
  return `t=${Math.floor(Date.now() / 3_600_000)}`;
}

function prodSourcesFor(filename: string): string[] {
  const bust = hourlyCacheBuster();
  return [
    `${RAW_GITHUB_BASE}/${filename}?${bust}`,
    `${JSDELIVR_BASE}/${filename}?${bust}`,
  ];
}

// Dev-only same-origin fallback: a manually-copied snapshot
// (public/<filename>, gitignored) so local development has real data
// before anything is pushed to main. Never used in a production build.
function sourcesForEnvironment(filename: string): string[] {
  const prod = prodSourcesFor(filename);
  return import.meta.env.DEV ? [...prod, `${BASE_URL}${filename}`] : prod;
}

async function fetchJsonWithFallback<T>(filename: string): Promise<T> {
  let lastError: unknown;
  for (const url of sourcesForEnvironment(filename)) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        lastError = new Error(`${url} responded ${res.status}`);
        continue;
      }
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${filename} from every configured source`);
}

export function fetchSiteIndex(): Promise<SiteIndex> {
  return fetchJsonWithFallback<SiteIndex>("site-index.json");
}

// data/stats-history.json — one snapshot per hourly pipeline run, capped to
// 90 days server-side (see scripts/build_data_readme.py's
// update_stats_history). This is what makes the global dashboard's trend
// line real data instead of a client-side reconstruction of this repo's
// git history against GitHub's rate-limited API.
export function fetchStatsHistory(): Promise<StatsHistory> {
  return fetchJsonWithFallback<StatsHistory>("stats-history.json");
}

// data/story-cards.json — 3-4 auto-generated "state of hiring" cards built by
// build_story_cards() from stats-history.json's dimensions. A small, purely
// derived file; the caller treats a fetch failure (e.g. an older deploy that
// predates this file) as "no strip", not an error.
export function fetchStoryCards(): Promise<StoryCards> {
  return fetchJsonWithFallback<StoryCards>("story-cards.json");
}
