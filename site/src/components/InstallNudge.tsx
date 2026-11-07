import { useEffect, useState } from "react";
import { trackEvent } from "../lib/analytics";
import {
  dismissNudge,
  isIosSafari,
  isStandalone,
  nudgeDecision,
  promptInstall,
  readDismissedAt,
  readInstalled,
  visitDays,
  type NudgeKind,
} from "../lib/pwa";
import { hasSeenTour } from "../lib/tour";

// E7 — the add-to-home-screen nudge. All the "should we show it" rules live in
// lib/pwa.ts's nudgeDecision (3+ visit days, not installed, tour already seen,
// 30-day snooze after "Not now"); this just gathers the inputs and renders.
//
// Waits a few seconds after load so it never competes with the page's first
// paint or lands the instant a returning visitor arrives.

const DELAY_MS = 4000;

export default function InstallNudge() {
  const [kind, setKind] = useState<NudgeKind>(null);

  useEffect(() => {
    let ready = false;
    const evaluate = () =>
      nudgeDecision({
        visitDays: visitDays(),
        standalone: isStandalone(),
        installed: readInstalled(),
        dismissedAt: readDismissedAt(),
        now: Date.now(),
        canPrompt: !!window.__trackerInstallEvent,
        ios: isIosSafari(),
        tourSeen: hasSeenTour(),
      });
    const refresh = () => ready && setKind(evaluate());
    const timer = setTimeout(() => {
      ready = true;
      setKind(evaluate());
    }, DELAY_MS);
    // Chromium can fire beforeinstallprompt late, or the app can get installed
    // from the browser's own UI while this page is open.
    window.addEventListener("tracker:installable", refresh);
    window.addEventListener("tracker:installed", refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("tracker:installable", refresh);
      window.removeEventListener("tracker:installed", refresh);
    };
  }, []);

  if (!kind) return null;

  async function install() {
    const outcome = await promptInstall();
    trackEvent("pwa_install_prompt", { outcome });
    setKind(null);
    // Cancelling the browser dialog counts as "not now" so we don't re-ask at once.
    if (outcome === "dismissed") dismissNudge();
  }

  function notNow() {
    trackEvent("pwa_nudge_dismiss", { kind: kind ?? "" });
    dismissNudge();
    setKind(null);
  }

  return (
    <aside
      role="region"
      aria-label="Install tracker"
      className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-sm rounded-xl border border-slate-200 bg-white p-4 shadow-lg dark:border-slate-700 dark:bg-slate-900 sm:inset-x-auto sm:right-4 sm:mx-0"
    >
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Add tracker to your home screen</p>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        {kind === "ios"
          ? "Tap the Share button, then “Add to Home Screen”. It opens like an app and keeps your last-seen listings when you're offline."
          : "It opens like an app, and still shows your last-seen listings when you're offline."}
      </p>
      <div className="mt-3 flex gap-2">
        {kind === "install" && (
          <button
            type="button"
            onClick={install}
            className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
          >
            Install
          </button>
        )}
        <button
          type="button"
          onClick={notNow}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {kind === "ios" ? "Got it" : "Not now"}
        </button>
      </div>
    </aside>
  );
}
