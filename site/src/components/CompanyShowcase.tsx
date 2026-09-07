import { useState } from "react";
import { logoCandidates } from "../lib/companyLogos";
import type { FilterState } from "../lib/filters";

// A moving "logo wall" of FAANG + big-tech names tracked on this site — pure
// visual attractor between the hero and the list. Real hand-verified logos
// (companyLogos.ts) via CompanyShowcaseLogo below, not guessed favicons.
// Clicking a logo applies it as a quick search, same mechanic as the
// SnapshotHero chips and StoryStrip cards it sits between.

const SHOWCASE_COMPANIES = [
  "Google",
  "Meta",
  "Apple",
  "Amazon",
  "Netflix",
  "Microsoft",
  "Nvidia",
  "IBM",
  "Oracle",
  "Salesforce",
  "Adobe",
  "Cisco",
  "SAP",
  "Samsung",
] as const;

interface LogoProps {
  company: string;
  onSelect: (patch: Partial<FilterState>) => void;
  // True for the duplicate track (the seamless-loop copy) — kept out of tab
  // order so keyboard users don't hit an invisible-to-screen-readers repeat
  // of every logo before reaching the real content below.
  decorative?: boolean;
}

function CompanyShowcaseLogo({ company, onSelect, decorative = false }: LogoProps) {
  const candidates = logoCandidates(company, 96);
  const [srcIndex, setSrcIndex] = useState(0);
  const src = candidates[srcIndex];

  return (
    <button
      type="button"
      tabIndex={decorative ? -1 : 0}
      aria-hidden={decorative}
      onClick={() => onSelect({ q: company })}
      title={`Show ${company} roles`}
      className="group mx-2 flex w-28 shrink-0 flex-col items-center gap-2 rounded-xl border border-transparent p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-teal-300 hover:bg-white hover:shadow-md dark:hover:border-teal-700 dark:hover:bg-slate-900"
    >
      {src ? (
        <img
          src={src}
          alt=""
          aria-hidden="true"
          width={40}
          height={40}
          loading="lazy"
          decoding="async"
          onError={() => setSrcIndex((i) => i + 1)}
          className="h-10 w-10 rounded-lg bg-white object-contain p-1.5 ring-1 ring-slate-200 grayscale transition-all duration-200 group-hover:grayscale-0 dark:bg-slate-800 dark:ring-slate-700"
        />
      ) : (
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          {company.slice(0, 2).toUpperCase()}
        </span>
      )}
      <span className="text-xs font-medium text-slate-500 transition-colors group-hover:text-slate-900 dark:text-slate-400 dark:group-hover:text-slate-100">
        {company}
      </span>
    </button>
  );
}

interface Props {
  onSelect: (patch: Partial<FilterState>) => void;
}

export default function CompanyShowcase({ onSelect }: Props) {
  return (
    <section aria-label="Companies tracked on this site" className="mb-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        Tracking roles at FAANG &amp; big tech
      </p>
      <div className="logo-marquee-viewport rounded-xl border border-slate-200 bg-slate-50/60 py-3 dark:border-slate-800 dark:bg-slate-900/40">
        <div className="logo-marquee-track">
          <div className="logo-marquee-group">
            {SHOWCASE_COMPANIES.map((company) => (
              <CompanyShowcaseLogo key={company} company={company} onSelect={onSelect} />
            ))}
          </div>
          <div className="logo-marquee-group" aria-hidden="true">
            {SHOWCASE_COMPANIES.map((company) => (
              <CompanyShowcaseLogo key={`${company}-dup`} company={company} onSelect={onSelect} decorative />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
