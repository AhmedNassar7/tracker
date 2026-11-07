import type { CompanyHistory } from "./types";

export interface CompanyTrendPoint {
  at: string;
  value: number;
}

/** Daily open-job counts for one company page, summed over every raw company
 *  name the page's own table is built from (an ATS posts the same employer as
 *  "Amazon.com Services LLC", "Amazon Advertising LLC", … — they're one page).
 *
 *  Uses exactly the names that matched today's rows, so the chart can never
 *  claim a different scope than the table under it. A recorded day with no
 *  entry for a name is a real 0 (the pipeline counts the complete published
 *  set), so it's summed as 0, never skipped.
 *
 *  Returns [] when there's no usable history (file missing/old shape, or none
 *  of the names tracked) — the caller then shows no chart rather than a flat
 *  line of zeros. */
export function companyTrendPoints(history: CompanyHistory | null, rawNames: string[]): CompanyTrendPoint[] {
  if (!history || !Array.isArray(history.days) || history.days.length === 0) return [];
  const series = rawNames
    .map((n) => history.companies?.[n])
    .filter((s): s is number[] => Array.isArray(s) && s.length === history.days.length);
  if (series.length === 0) return [];
  return history.days.map((day, i) => ({
    at: day,
    value: series.reduce((sum, s) => sum + (Number.isFinite(s[i]) ? s[i] : 0), 0),
  }));
}
