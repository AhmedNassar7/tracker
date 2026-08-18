// Plain-HTML bar chart, per the dataviz skill's own reference technique —
// no charting library. Every value is real DOM text (not canvas/SVG-only),
// so this is accessible and has a "table view" by construction: a screen
// reader gets the label and count regardless of the bar's visual width.

import type { CSSProperties } from "react";

// CSS custom properties aren't in React's CSSProperties type — this is the
// standard escape hatch for setting them via an inline style object.
type BarStyle = CSSProperties & { "--bar-light"?: string; "--bar-dark"?: string };

export interface BarListItem {
  key: string;
  label: string;
  value: number;
  color: { light: string; dark: string };
}

interface Props {
  items: BarListItem[];
  valueFormatter?: (n: number) => string;
}

const defaultFormatter = (n: number) => n.toLocaleString();

export default function BarList({ items, valueFormatter = defaultFormatter }: Props) {
  const max = Math.max(1, ...items.map((item) => item.value));

  return (
    <ul className="space-y-2">
      {items.map((item) => {
        const pct = Math.max((item.value / max) * 100, item.value > 0 ? 2 : 0);
        return (
          <li key={item.key} className="flex items-center gap-3">
            <span className="w-28 shrink-0 truncate text-sm text-slate-600 dark:text-slate-400" title={item.label}>
              {item.label}
            </span>
            <div aria-hidden="true" className="h-3 flex-1 rounded-sm bg-slate-100 dark:bg-slate-800">
              <div
                className="h-3 rounded-r-sm bg-[var(--bar-light)] transition-[width] dark:bg-[var(--bar-dark)]"
                style={
                  {
                    width: `${pct}%`,
                    "--bar-light": item.color.light,
                    "--bar-dark": item.color.dark,
                  } as BarStyle
                }
                title={`${item.label}: ${valueFormatter(item.value)}`}
              />
            </div>
            <span className="w-12 shrink-0 text-right text-sm font-medium tabular-nums text-slate-700 dark:text-slate-300">
              {valueFormatter(item.value)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
