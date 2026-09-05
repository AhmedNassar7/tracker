import { useState } from "react";
import { faviconForUrl, logoUrl } from "../lib/companyLogos";

// A company mark that is provably correct or absent — never a guess.
//
// If the company's domain is hand-verified (see companyLogos.ts), show its own
// favicon; if that image fails to load, or there's no verified domain, fall
// back to a generated initials avatar. The initials avatar never claims to be
// an official asset, so it can't misattribute — same reasoning GitHub/Slack
// default avatars use. Fetching a logo by a *guessed* domain is exactly what
// this component refuses to do: a wrong domain either 404s or, worse, silently
// renders a different company's real logo.

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
  // For hackathon/event rows only: the organiser's own page URL, used to
  // derive a favicon when the company name has no verified domain. Never
  // pass a job's URL here (it points at an ATS, not the employer).
  fallbackUrl?: string;
}

export default function CompanyAvatar({ company, fallbackUrl }: Props) {
  const [logoFailed, setLogoFailed] = useState(false);
  const src = logoFailed
    ? null
    : logoUrl(company) ?? (fallbackUrl ? faviconForUrl(fallbackUrl) : null);

  if (src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        width={28}
        height={28}
        loading="lazy"
        decoding="async"
        onError={() => setLogoFailed(true)}
        className="h-7 w-7 shrink-0 rounded-md bg-white object-contain p-0.5 ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700"
      />
    );
  }

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
