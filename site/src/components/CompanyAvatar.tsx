// Deliberately not a fetched brand logo (see tracker-website-plan.html §2's
// "Company logos" section — the obvious approach is guessing a domain via
// Clearbit's logo API, but that's a guess: a wrong domain either 404s or,
// worse, silently renders a *different* company's real logo, which breaks
// the project's no-fabricated-data rule harder than showing nothing would.
// A generated initials avatar never claims to be an official asset, so it
// can't misattribute — same reasoning GitHub/Slack default avatars use.

// A handful of AA-contrast-safe background/text pairs (verified ~7:1+ in
// both themes) to rotate through, purely for visual variety row-to-row.
const PALETTE = [
  "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
  "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200",
  "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
];

// Small deterministic string hash (djb2-ish) — same company name always
// lands on the same color, without needing to persist an assignment
// anywhere.
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

interface Props {
  company: string;
}

export default function CompanyAvatar({ company }: Props) {
  const paletteClass = PALETTE[hashString(company) % PALETTE.length];
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${paletteClass}`}
    >
      {initialsFor(company)}
    </span>
  );
}
