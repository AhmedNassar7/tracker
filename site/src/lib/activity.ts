// Local, client-only day-stamps of "you did something here today" — a page
// visit (recorded once per HeaderStat mount, so every page counts) or an
// application tracked/updated (recorded in tracker.ts). Powers the streak
// badge + calendar heatmap on the Applications dashboard (Lane C6 — the
// habit loop). Same convention as visitHistory.ts: small, capped, best-effort
// localStorage — losing this only resets a streak, it never breaks a feature.

const ACTIVITY_KEY = "tracker:activityDays";

// ~14 months of one small int per day is a few KB at most — enough to back
// a year-view heatmap with room to spare, bounded so the key can't grow
// forever for someone who's used the site for years.
const MAX_TRACKED_DAYS = 420;

export type ActivityMap = Record<string, number>;

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Parses a "YYYY-MM-DD" key back into a local-midnight Date via explicit
// components — `new Date("YYYY-MM-DD")` parses as UTC midnight, which drifts
// a day off `dayKey`'s local-time output near timezone boundaries.
function parseDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d: Date, delta: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + delta);
  return copy;
}

export function todayKey(): string {
  return dayKey(new Date());
}

export function readActivity(): ActivityMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ACTIVITY_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as ActivityMap) : {};
  } catch {
    return {};
  }
}

export function recordActivityToday(): void {
  if (typeof window === "undefined") return;
  try {
    const activity = readActivity();
    const key = todayKey();
    activity[key] = (activity[key] ?? 0) + 1;

    const cutoff = dayKey(addDays(new Date(), -MAX_TRACKED_DAYS));
    for (const k of Object.keys(activity)) {
      if (k < cutoff) delete activity[k];
    }
    window.localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activity));
  } catch {
    // Storage disabled or quota exceeded — a reset streak, not a broken feature.
  }
}

export interface Streak {
  current: number;
  longest: number;
  lastActiveKey: string | null;
}

// The current streak only counts if the most recent active day is today or
// yesterday — a gap further back than that means the streak already ended,
// even though walking backward from "today" would otherwise silently bridge
// over the missed days.
export function computeStreak(activity: ActivityMap, now: Date = new Date()): Streak {
  const activeDays = Object.keys(activity)
    .filter((k) => activity[k] > 0)
    .sort();
  if (activeDays.length === 0) return { current: 0, longest: 0, lastActiveKey: null };

  const activeSet = new Set(activeDays);
  const lastActiveKey = activeDays[activeDays.length - 1];

  let longest = 0;
  let run = 0;
  let prevKey: string | null = null;
  for (const key of activeDays) {
    run = prevKey !== null && dayKey(addDays(parseDayKey(prevKey), 1)) === key ? run + 1 : 1;
    longest = Math.max(longest, run);
    prevKey = key;
  }

  const todayK = dayKey(now);
  const yesterdayK = dayKey(addDays(now, -1));
  let current = 0;
  if (lastActiveKey === todayK || lastActiveKey === yesterdayK) {
    let cursor = lastActiveKey;
    while (activeSet.has(cursor)) {
      current += 1;
      cursor = dayKey(addDays(parseDayKey(cursor), -1));
    }
  }

  return { current, longest, lastActiveKey };
}

export interface HeatmapDay {
  key: string;
  date: Date;
  count: number;
  inRange: boolean;
}

// GitHub-style calendar: `weeks` columns of 7 days (Sun–Sat), ending on the
// current week so the grid always ends on today regardless of the weekday.
// Days after today (filling out the final week) render blank (inRange:
// false), not as a fake zero-activity day.
export function getHeatmapWeeks(activity: ActivityMap, weeks = 26, now: Date = new Date()): HeatmapDay[][] {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfWeek = addDays(end, 6 - end.getDay());
  const start = addDays(endOfWeek, -(weeks * 7 - 1));

  const days: HeatmapDay[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const date = addDays(start, i);
    const key = dayKey(date);
    days.push({ key, date, count: activity[key] ?? 0, inRange: date <= end });
  }

  const cols: HeatmapDay[][] = [];
  for (let w = 0; w < weeks; w++) cols.push(days.slice(w * 7, w * 7 + 7));
  return cols;
}

// 0 = no activity (an empty cell), 1–4 = intensity steps into the site's
// activity color ramp. A "day" here is visits + status changes — usually a
// handful at most — so the buckets are small integers, not quantiles over a
// wide range.
export function activityLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count <= 4) return 3;
  return 4;
}
