// Single-series line chart, per the dataviz skill's "trend over time" form
// (line, one hue) and interaction spec (a line chart ships a crosshair by
// default — this isn't optional polish). Plain SVG, no charting library,
// same reasoning as BarList.

import { useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { SINGLE_SERIES_COLOR } from "../lib/chartColors";

export interface TrendPoint {
  at: string;
  value: number;
}

interface Props {
  points: TrendPoint[];
  label: string;
  valueFormatter?: (n: number) => string;
}

const WIDTH = 600;
const HEIGHT = 160;
const PADDING = 20;

type LineStyle = CSSProperties & { "--line-light"?: string; "--line-dark"?: string };
const LINE_STYLE: LineStyle = { "--line-light": SINGLE_SERIES_COLOR.light, "--line-dark": SINGLE_SERIES_COLOR.dark };

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

export default function TrendLine({ points, label, valueFormatter = (n) => n.toLocaleString() }: Props) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const { path, coords } = useMemo(() => {
    if (points.length === 0) return { path: "", coords: [] as { x: number; y: number }[] };
    const values = points.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const usableWidth = WIDTH - PADDING * 2;
    const usableHeight = HEIGHT - PADDING * 2;
    const coords = points.map((p, i) => ({
      x: points.length === 1 ? PADDING : PADDING + (i / (points.length - 1)) * usableWidth,
      y: PADDING + usableHeight - ((p.value - min) / span) * usableHeight,
    }));
    const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
    return { path, coords };
  }, [points]);

  function handlePointerMove(e: PointerEvent<SVGSVGElement>) {
    if (!svgRef.current || coords.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * WIDTH;
    let nearest = 0;
    let nearestDist = Infinity;
    coords.forEach((c, i) => {
      const dist = Math.abs(c.x - relX);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    });
    setHoverIndex(nearest);
  }

  if (points.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Not enough history yet.</p>;
  }

  // A single point can't draw a line — still worth showing as a lone dot
  // rather than an empty chart, since that's exactly what day one of this
  // history file looks like.
  const hovered = hoverIndex !== null ? points[hoverIndex] : null;
  const hoveredCoord = hoverIndex !== null ? coords[hoverIndex] : null;
  const last = coords[coords.length - 1];
  const first = points[0];
  const lastPoint = points[points.length - 1];

  return (
    <div className="relative" style={LINE_STYLE}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full touch-none"
        role="img"
        aria-label={`${label}: ${valueFormatter(first.value)} on ${formatDate(first.at)}, most recently ${valueFormatter(
          lastPoint.value,
        )} on ${formatDate(lastPoint.at)}`}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        <line
          x1={PADDING}
          y1={HEIGHT - PADDING}
          x2={WIDTH - PADDING}
          y2={HEIGHT - PADDING}
          className="stroke-slate-200 dark:stroke-slate-800"
          strokeWidth={1}
        />
        {hoveredCoord && (
          <line
            x1={hoveredCoord.x}
            y1={PADDING}
            x2={hoveredCoord.x}
            y2={HEIGHT - PADDING}
            className="stroke-slate-300 dark:stroke-slate-700"
            strokeWidth={1}
          />
        )}
        {path && (
          <path
            d={path}
            fill="none"
            className="stroke-[var(--line-light)] dark:stroke-[var(--line-dark)]"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        <circle
          cx={last.x}
          cy={last.y}
          r={4}
          className="fill-[var(--line-light)] stroke-white dark:fill-[var(--line-dark)] dark:stroke-slate-950"
          strokeWidth={2}
        />
        {hoveredCoord && (
          <circle
            cx={hoveredCoord.x}
            cy={hoveredCoord.y}
            r={4}
            className="fill-[var(--line-light)] stroke-white dark:fill-[var(--line-dark)] dark:stroke-slate-950"
            strokeWidth={2}
          />
        )}
      </svg>
      {hovered && hoveredCoord && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-[calc(100%+8px)] whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow-sm dark:border-slate-700 dark:bg-slate-900"
          style={{ left: `${(hoveredCoord.x / WIDTH) * 100}%`, top: `${(hoveredCoord.y / HEIGHT) * 100}%` }}
        >
          <div className="font-semibold text-slate-900 dark:text-slate-100">{valueFormatter(hovered.value)}</div>
          <div className="text-slate-500 dark:text-slate-400">{formatDate(hovered.at)}</div>
        </div>
      )}
      <div className="mt-1 flex justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>{formatDate(first.at)}</span>
        <span>{formatDate(lastPoint.at)}</span>
      </div>
    </div>
  );
}
