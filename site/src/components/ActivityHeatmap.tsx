// Plain-HTML calendar heatmap, same technique as BarList — no charting
// library, native `title` tooltips as the hover layer, real DOM cells so a
// screen reader still gets a date + count regardless of the fill color.

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { activityLevel, computeStreak, getHeatmapWeeks, readActivity, type ActivityMap } from "../lib/activity";
import { ACTIVITY_RAMP } from "../lib/chartColors";

type CellStyle = CSSProperties & { "--cell-light"?: string; "--cell-dark"?: string };

const WEEKS = 26;

function cellStyle(level: 0 | 1 | 2 | 3 | 4): { className: string; style?: CellStyle } {
  if (level === 0) {
    return { className: "h-2.5 w-2.5 rounded-sm bg-slate-100 dark:bg-slate-800" };
  }
  const color = ACTIVITY_RAMP[level - 1];
  return {
    className: "h-2.5 w-2.5 rounded-sm bg-[var(--cell-light)] dark:bg-[var(--cell-dark)]",
    style: { "--cell-light": color.light, "--cell-dark": color.dark },
  };
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function ActivityHeatmap() {
  // Read after mount only — localStorage isn't available during SSR, and
  // reading it during render would make the server- and client-rendered
  // markup disagree (a hydration mismatch).
  const [activity, setActivity] = useState<ActivityMap | null>(null);

  useEffect(() => {
    setActivity(readActivity());
  }, []);

  if (activity === null) return null;

  const streak = computeStreak(activity);
  const weeks = getHeatmapWeeks(activity, WEEKS);
  const hasAny = Object.values(activity).some((n) => n > 0);

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Activity</h3>
        {streak.current > 0 && (
          <span className="text-sm text-slate-600 dark:text-slate-400">🔥 {streak.current}-day streak</span>
        )}
        {streak.current === 0 && streak.lastActiveKey !== null && (
          <span className="text-sm text-slate-500 dark:text-slate-400">
            No streak right now — come back to start a new one
          </span>
        )}
        {streak.longest > streak.current && (
          <span className="text-xs text-slate-400 dark:text-slate-500">Best: {streak.longest}d</span>
        )}
      </div>

      {hasAny ? (
        <>
          <div className="mt-3 overflow-x-auto">
            <div className="inline-flex gap-[3px]">
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-[3px]">
                  {week.map((day) => {
                    const { className, style } = cellStyle(activityLevel(day.count));
                    return (
                      <div
                        key={day.key}
                        aria-hidden={!day.inRange}
                        title={
                          day.inRange
                            ? `${formatDate(day.date)}: ${day.count} ${day.count === 1 ? "action" : "actions"}`
                            : undefined
                        }
                        className={day.inRange ? className : "h-2.5 w-2.5 rounded-sm"}
                        style={day.inRange ? style : undefined}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-2 flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
            <span>Less</span>
            <div className="h-2.5 w-2.5 rounded-sm bg-slate-100 dark:bg-slate-800" />
            {ACTIVITY_RAMP.map((color, i) => (
              <div
                key={i}
                className="h-2.5 w-2.5 rounded-sm bg-[var(--cell-light)] dark:bg-[var(--cell-dark)]"
                style={{ "--cell-light": color.light, "--cell-dark": color.dark } as CellStyle}
              />
            ))}
            <span>More</span>
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Visit the jobs list or track an application to start your activity history.
        </p>
      )}
    </div>
  );
}
