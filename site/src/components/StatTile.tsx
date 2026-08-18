// Per the dataviz skill's figures spec: label in sentence case with no
// trailing colon, value in the default proportional figures (not
// tabular-nums — that's reserved for columns that must align vertically).

interface Props {
  label: string;
  value: number;
  suffix?: string;
}

export default function StatTile({ label, value, suffix = "" }: Props) {
  return (
    <div className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
      <div className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
        {value.toLocaleString()}
        {suffix}
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
    </div>
  );
}
