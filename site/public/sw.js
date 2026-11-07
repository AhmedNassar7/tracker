// Hand-written rather than plugin-generated. vite-plugin-pwa's closeBundle
// hook never actually ran against Astro's multi-page static build (no
// sw.js was ever emitted, no manifest link or registration got injected
// into the HTML), and @vite-pwa/astro — the dedicated Astro integration
// package for exactly this — doesn't support Astro 7 yet (peer dependency
// caps at ^5.0.0). The real requirement here is narrow, so a hand-written
// worker covers it directly instead of fighting a plugin integration gap.
//
// Hardcodes the /tracker/ base path rather than templating it in, matching
// every other repo-specific constant already hardcoded across this site
// (astro.config.mjs's site/base, dataSource.ts's jsDelivr URL) — this file
// is a static public/ asset, not processed by Astro, so it can't read
// Astro's own base config at build time anyway.
//
// What "offline" means here (E7):
//  • Pages and assets are cached as they're visited (network-first), so a page
//    you've opened keeps opening. An unvisited page gets /offline.html rather
//    than silently showing the home page under the wrong URL.
//  • The data files (site-index.json, counts.json, …) keep ONE saved copy each,
//    keyed WITHOUT dataSource.ts's hourly `?t=` cache-buster. Keying on the full
//    URL (the first version) meant an offline lookup only hit within the same
//    hour, and stored another multi-MB copy every hour, forever.
//  • A saved copy is stamped `x-tracker-saved-at` when stored and flagged
//    `x-tracker-from-cache` when served in place of the network, so the page can
//    tell the visitor "this is a saved snapshot from 3h ago" instead of showing
//    stale listings as if they were verified-open (the site's core promise).
const CACHE_VERSION = "tracker-v2";
const DATA_CACHE = "tracker-data";
const BASE = "/tracker/";
const OFFLINE_URL = `${BASE}offline.html`;
const PRECACHE = [BASE, OFFLINE_URL, `${BASE}favicon.svg`, `${BASE}icons/icon-192.png`];
const DATA_ORIGINS = new Set(["cdn.jsdelivr.net", "raw.githubusercontent.com"]);
// Hashed /_astro/* assets from every past deploy would otherwise accumulate.
const MAX_RUNTIME_ENTRIES = 150;

// Cache key = origin + path, no query string (see header comment).
const keyFor = (url) => url.origin + url.pathname;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_VERSION && k !== DATA_CACHE).map((k) => caches.delete(k)));
      // v1 stored data under the full URL incl. the hourly `?t=` buster — drop
      // those orphans (each was a full multi-MB copy that can never be hit again).
      const data = await caches.open(DATA_CACHE);
      for (const request of await data.keys()) {
        if (new URL(request.url).search) await data.delete(request);
      }
      await self.clients.claim();
    })(),
  );
});

// The saved copy: only what the page needs to read it back, plus our stamp.
function stamp(response) {
  const headers = new Headers();
  headers.set("content-type", response.headers.get("content-type") || "application/json");
  headers.set("x-tracker-saved-at", new Date().toISOString());
  return new Response(response.body, { status: 200, headers });
}

function flagged(cached) {
  const headers = new Headers(cached.headers);
  headers.set("x-tracker-from-cache", "1");
  return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
}

// Network-first: this site's whole architecture is "at most ~1h stale, fetched
// live at runtime" (see dataSource.ts) — a worker that served something staler
// by default, even while online, would quietly undermine that. Only fall back
// to the saved copy when the network is genuinely unavailable.
async function dataNetworkFirst(event, request, url) {
  const cache = await caches.open(DATA_CACHE);
  const key = keyFor(url);
  try {
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(cache.put(key, stamp(copy)));
    }
    return response;
  } catch (err) {
    const cached = await cache.match(key);
    if (cached) return flagged(cached);
    throw err;
  }
}

// Astro builds directory-style pages, so /dashboard and /dashboard/ are the
// same document — look under both spellings.
async function matchPage(cache, url) {
  const p = url.pathname;
  const alt = p.endsWith("/") ? p.slice(0, -1) : `${p}/`;
  return (await cache.match(url.origin + p)) || (await cache.match(url.origin + alt));
}

async function trim(cache) {
  const keep = new Set(PRECACHE.map((p) => self.location.origin + p));
  const evictable = (await cache.keys()).filter((r) => {
    const u = new URL(r.url);
    return !keep.has(u.origin + u.pathname);
  });
  // cache.keys() is insertion-ordered, so the front of the list is the oldest.
  for (const request of evictable.slice(0, Math.max(0, evictable.length - MAX_RUNTIME_ENTRIES))) {
    await cache.delete(request);
  }
}

async function runtimeNetworkFirst(event, request, url) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    // Never store a redirect or an error page: a redirected response can't be
    // served back to a navigation, and a 404/500 shouldn't replace a good copy.
    if (response.ok && !response.redirected && response.type === "basic") {
      const copy = response.clone();
      event.waitUntil(cache.put(keyFor(url), copy).then(() => trim(cache)));
    }
    return response;
  } catch (err) {
    // The page HTML doesn't depend on the query string (company?c=…, /?levels=…
    // are rendered client-side), so one saved copy serves them all.
    const cached = await matchPage(cache, url);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const offline = await cache.match(OFFLINE_URL);
      if (offline) return offline;
    }
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (DATA_ORIGINS.has(url.hostname)) {
    event.respondWith(dataNetworkFirst(event, request, url));
    return;
  }

  if (url.origin !== self.location.origin) return;
  // Scope is /tracker/ already; this guards a stray same-origin request.
  if (!url.pathname.startsWith(BASE)) return;

  event.respondWith(runtimeNetworkFirst(event, request, url));
});
