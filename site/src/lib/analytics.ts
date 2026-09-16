// Central GA4 event helper. Every call in this codebase goes through here so
// the PII rule lives in one place: never pass résumé text, notes, emails,
// phone numbers, or webhook URLs as a param — only facets already public on
// a listing (company, source, kind, level) or UI state (filter values,
// counts, booleans). Best-effort only — a blocked/absent gtag is a silent
// no-op, never a thrown error, so a feature never depends on this firing.

type ParamValue = string | number | boolean | undefined;
export type AnalyticsParams = Record<string, ParamValue>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function trackEvent(name: string, params: AnalyticsParams = {}): void {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  const clean: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) clean[k] = v;
  }
  window.gtag("event", name, clean);
}
