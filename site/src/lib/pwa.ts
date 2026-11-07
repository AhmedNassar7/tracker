// Install ("add to home screen") nudge — the decision logic, kept pure so it's
// testable without a browser. InstallNudge.tsx only gathers the inputs and
// renders the answer.
//
// Principles: never nag. A visitor must have come back (3+ distinct days —
// the same day-stamps the activity streak uses), must not have installed or
// be using the installed app already, and a "Not now" is remembered for 30
// days. Chromium browsers hand us a real install prompt; iOS Safari has none,
// so there the nudge is a one-line instruction instead.

import { readActivity } from "./activity";

/** Chromium's deferred install prompt (not in lib.dom). Captured by the inline
 *  script in Layout.astro — it fires once, early, possibly before any island
 *  has hydrated — and stashed on `window` for whoever needs it later. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    __trackerInstallEvent?: BeforeInstallPromptEvent | null;
  }
}

/** Show the browser's install dialog using the stashed event. Resolves to what
 *  the visitor chose, or "unavailable" if there's nothing to prompt with. The
 *  event is single-use, so it's cleared either way. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = typeof window === "undefined" ? null : window.__trackerInstallEvent;
  if (!event) return "unavailable";
  window.__trackerInstallEvent = null;
  try {
    await event.prompt();
    return (await event.userChoice).outcome;
  } catch {
    return "unavailable";
  }
}

export const NUDGE_MIN_VISIT_DAYS = 3;
export const NUDGE_SNOOZE_DAYS = 30;

const DISMISSED_KEY = "tracker:installNudgeDismissedAt";
const INSTALLED_KEY = "tracker:installed";

export type NudgeKind = "install" | "ios" | null;

export interface NudgeInputs {
  visitDays: number;
  standalone: boolean;
  installed: boolean;
  /** ms epoch of the last "Not now", or null. */
  dismissedAt: number | null;
  now: number;
  /** A deferred `beforeinstallprompt` event is available (Chromium). */
  canPrompt: boolean;
  ios: boolean;
  /** The first-visit tour has been seen — never stack the two. */
  tourSeen: boolean;
}

export function nudgeDecision(i: NudgeInputs): NudgeKind {
  if (i.standalone || i.installed) return null;
  if (!i.tourSeen) return null;
  if (i.visitDays < NUDGE_MIN_VISIT_DAYS) return null;
  if (i.dismissedAt !== null && i.now - i.dismissedAt < NUDGE_SNOOZE_DAYS * 86_400_000) return null;
  if (i.canPrompt) return "install";
  if (i.ios) return "ios";
  return null;
}

export function visitDays(): number {
  return Object.keys(readActivity()).length;
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true;
}

/** iPhone/iPad Safari — the only mainstream place "Add to Home Screen" exists
 *  with no programmatic prompt. Other iOS browsers (Chrome/Firefox/Edge on iOS)
 *  can't add to the home screen themselves, so they get no nudge. iPadOS
 *  reports itself as a Mac, hence the touch-points check. */
export function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iosDevice = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return iosDevice && safari;
}

export function readDismissedAt(): number | null {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function dismissNudge(now: number = Date.now()): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, String(now));
  } catch {
    // Storage unavailable — the nudge may reappear next visit; harmless.
  }
}

export function readInstalled(): boolean {
  try {
    return window.localStorage.getItem(INSTALLED_KEY) === "1";
  } catch {
    return false;
  }
}
