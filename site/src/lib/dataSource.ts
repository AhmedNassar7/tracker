import type { SiteIndex } from "./types";

// Runtime fetch, not a build-time import — the site must show data that's at
// most ~1h stale without ever being redeployed itself (see the plan's
// "decouple site deploy from hourly data refresh" architectural decision).
// jsDelivr fronts GitHub's raw host with a real CDN (helps EMEA/APAC
// latency); raw.githubusercontent.com is the fallback if jsDelivr is ever
// slow to pick up a new commit.
const PROD_SOURCES = [
  "https://cdn.jsdelivr.net/gh/AhmedNassar7/tracker@main/data/site-index.json",
  "https://raw.githubusercontent.com/AhmedNassar7/tracker/main/data/site-index.json",
];

// Dev-only same-origin fallback: a manually-copied snapshot (public/site-index.json,
// gitignored) so local development has real data before anything is pushed to
// main. Never used in a production build.
// import.meta.env.BASE_URL isn't guaranteed to carry a trailing slash (it
// doesn't in this Astro version) — normalize before concatenating.
const BASE = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;
const DEV_FALLBACK_SOURCE = `${BASE}site-index.json`;

function sourcesForEnvironment(): string[] {
  return import.meta.env.DEV ? [...PROD_SOURCES, DEV_FALLBACK_SOURCE] : PROD_SOURCES;
}

export async function fetchSiteIndex(): Promise<SiteIndex> {
  let lastError: unknown;
  for (const url of sourcesForEnvironment()) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        lastError = new Error(`${url} responded ${res.status}`);
        continue;
      }
      return (await res.json()) as SiteIndex;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to fetch site-index.json from every configured source");
}
