// Hand-written rather than plugin-generated. vite-plugin-pwa's closeBundle
// hook never actually ran against Astro's multi-page static build (no
// sw.js was ever emitted, no manifest link or registration got injected
// into the HTML), and @vite-pwa/astro — the dedicated Astro integration
// package for exactly this — doesn't support Astro 7 yet (peer dependency
// caps at ^5.0.0). The real requirement here is narrow: cache the shell
// and the two known data endpoints so the site "opens and shows
// last-known data offline" (this phase's own exit criteria) — a
// hand-written worker covers that directly instead of fighting a plugin
// integration gap.
//
// Hardcodes the /tracker/ base path rather than templating it in, matching
// every other repo-specific constant already hardcoded across this site
// (astro.config.mjs's site/base, dataSource.ts's jsDelivr URL) — this file
// is a static public/ asset, not processed by Astro, so it can't read
// Astro's own base config at build time anyway.
const CACHE_VERSION = "tracker-v1";
const BASE = "/tracker/";
const DATA_ORIGINS = new Set(["cdn.jsdelivr.net", "raw.githubusercontent.com"]);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll([BASE, `${BASE}favicon.svg`])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION && key !== "tracker-data").map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Network-first, cache-as-you-go: this site's whole architecture is "at
// most ~1h stale, fetched live at runtime" (see dataSource.ts) — a service
// worker that served something staler than that by default, even while
// online, would quietly undermine that guarantee. Always try the network
// first; only fall back to whatever was last cached when the network is
// genuinely unavailable.
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (DATA_ORIGINS.has(url.hostname)) {
    event.respondWith(networkFirst(request, "tracker-data"));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      networkFirst(request, CACHE_VERSION).catch(() => caches.open(CACHE_VERSION).then((cache) => cache.match(BASE))),
    );
    return;
  }

  event.respondWith(networkFirst(request, CACHE_VERSION));
});
