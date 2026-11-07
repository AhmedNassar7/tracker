import { useEffect, useState } from "react";
import { CACHED_DATA_EVENT, readCachedData, savedAgo } from "../lib/offlineState";

// E7 — "last synced" view. The site's promise is that a listing shown is one
// we believe is open; a saved offline snapshot can't keep that promise, so
// whenever what's on screen came from the service worker's saved copy (or the
// device is offline) this says so, with how old the copy is, instead of
// presenting stale listings as live.
//
// Two independent signals: the browser's online/offline state, and dataSource
// reporting that a data request was answered from the saved copy (which also
// covers "online but the data host is unreachable"). Renders nothing in the
// normal case.

type Cached = { savedAt: string | null } | null;

export default function OfflineBanner() {
  const [cached, setCached] = useState<Cached>(null);
  const [online, setOnline] = useState(true);
  // Re-render as the copy ages ("3 min ago" → "4 min ago") without a reload.
  const [, tick] = useState(0);

  useEffect(() => {
    setOnline(navigator.onLine);
    // The data fetch may have finished before this island mounted.
    setCached(readCachedData());
    const onCached = (e: Event) => setCached((e as CustomEvent<{ savedAt: string | null }>).detail);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener(CACHED_DATA_EVENT, onCached);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    const timer = setInterval(() => tick((n) => n + 1), 60_000);
    return () => {
      window.removeEventListener(CACHED_DATA_EVENT, onCached);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      clearInterval(timer);
    };
  }, []);

  if (online && !cached) return null;

  const ago = savedAgo(cached?.savedAt);

  let message: string;
  if (!online && cached) {
    message = `You're offline — showing listings saved ${ago || "earlier"}. Some may have closed since.`;
  } else if (!online) {
    message = "You're offline. Pages you've already opened are still available.";
  } else {
    message = `Couldn't reach the live data — showing a copy saved ${ago || "earlier"}. Some listings may have closed since.`;
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
    >
      <span>{message}</span>
      {online && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded border border-amber-400 px-2 py-0.5 text-xs font-medium hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900"
        >
          Reload
        </button>
      )}
    </div>
  );
}
