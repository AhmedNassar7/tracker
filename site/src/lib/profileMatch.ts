import { DEFAULT_FILTERS, type FilterState } from "./filters";
import { countryForItem } from "./geo";
import { detectSkillTags } from "./keywordGap";
import { contradictsPrefFilter, EMPTY_RANK_TUNE, matchReasons, scoreOpportunity } from "./preferences";
import { deriveYearsOfExperience, type Profile } from "./profile";
import type { SiteIndexEntry } from "./types";

// Score a job posting against the unified profile, reusing the site's own
// relevance engine (preferences.ts) for the dimensions it already knows how
// to weigh — level / role / region / country / work-type / company — and
// adding the job-record fields the saved-filter model doesn't cover:
// disclosed salary, visa sponsorship, degree requirement, relocation, and
// the skills <-> tech_tags overlap. Every contribution is turned into a
// plain-language reason or gap so the match is explainable, never a
// black-box number (APPLICANT-TOOLKIT-PLAN §5).
//
// The profile's `targets` mirror SiteIndexEntry field-for-field on purpose
// (see ProfileTargets in profile.ts), so this projection is 1:1.

/** Project the profile's job targets onto a FilterState — this is also the
 *  Lane H5 "your profile IS your saved preference filter" bridge. */
export function filterStateFromProfile(p: Profile): FilterState {
  return {
    ...DEFAULT_FILTERS,
    levels: [...p.targets.levels],
    roles: [...p.targets.roles],
    regions: [...p.targets.regions],
    countries: [...p.targets.countries],
    remotes: [...p.targets.remotes],
    companies: [...p.targets.companies],
  };
}

export interface JobMatch {
  /** 0–100, for a badge. A display normalisation of `raw` — sort on `raw`. */
  score: number;
  raw: number;
  /** Plain-language positives, strongest first. */
  reasons: string[];
  /** Mismatches worth knowing before applying. */
  gaps: string[];
  /** Flatly contradicts a hard target (wrong level/kind, needs a degree the
   *  user doesn't have, pays below the floor) — the caller drops these below
   *  a "show anyway" line rather than interleaving them. */
  contradicts: boolean;
}

// Roughly the raw score a posting hitting every signal would reach; used only
// to map `raw` onto 0–100 for the badge.
const SCORE_CEIL = 20;

const perYear = (n: number, period: string): number =>
  period === "hour" ? n * 2080 : period === "month" ? n * 12 : n;

/** The profile's declared skills, normalised to the SAME canonical tech-tag
 *  vocabulary the pipeline tags jobs with (`detect_tech_tags` in patterns.py,
 *  mirrored in keywordGap.ts). So "reactjs" / "React.js" / "REACT" all collapse
 *  to the "React" tag that `item.tech_tags` carries, and the overlap below is
 *  an exact set intersection instead of a fuzzy name compare. */
function canonicalSkillTags(p: Profile): Set<string> {
  return new Set(
    detectSkillTags([...p.skills.languages, ...p.skills.frameworks, ...p.skills.tools, ...p.skills.other]),
  );
}

export function scoreJobForProfile(item: SiteIndexEntry, p: Profile): JobMatch {
  const pref = filterStateFromProfile(p);
  let raw = scoreOpportunity(item, pref, EMPTY_RANK_TUNE);
  const reasons = matchReasons(item, pref, EMPTY_RANK_TUNE).map((r) => r.replace(/_/g, " "));
  const gaps: string[] = [];
  let contradicts = contradictsPrefFilter(item, pref);

  // skills <-> tech_tags, both on the canonical detect_tech_tags vocabulary
  // (R2): `item.tech_tags` come straight from the pipeline's detector, and
  // canonicalSkillTags() runs the profile's skills through the same one, so
  // this is an exact intersection. Tags keep their display casing here.
  const tags = item.tech_tags ?? [];
  if (tags.length > 0) {
    const mine = canonicalSkillTags(p);
    const hit = tags.filter((t) => mine.has(t));
    const miss = tags.filter((t) => !mine.has(t));
    raw += Math.min(hit.length, 5);
    if (hit.length > 0) reasons.push(`${hit.length}/${tags.length} of the stack (${hit.slice(0, 3).join(", ")})`);
    if (hit.length > 0 && miss.length > 0) gaps.push(`stack to learn: ${miss.slice(0, 4).join(", ")}`);
  }

  // disclosed salary vs the user's floor (only when currencies match)
  if (p.targets.minSalary && item.salary && item.salary.currency === p.targets.salaryCurrency) {
    const floor = perYear(p.targets.minSalary, p.targets.salaryPeriod);
    const low = perYear(item.salary.min, item.salary.period);
    const high = perYear(item.salary.max, item.salary.period);
    if (low >= floor) {
      raw += 3;
      reasons.push("pays at or above your target");
    } else if (high < floor) {
      raw -= 5;
      contradicts = true;
      gaps.push("pays below your minimum");
    } else {
      gaps.push("pay range starts below your minimum");
    }
  }

  // visa sponsorship
  if (p.eligibility.needsSponsorship === true) {
    if (item.visa_sponsorship === true) {
      raw += 4;
      reasons.push("offers visa sponsorship");
    } else {
      const country = countryForItem(item);
      const authorised =
        !!country && p.eligibility.authorizedCountries.some((c) => c.toLowerCase() === country.toLowerCase());
      if (!authorised) gaps.push("no sponsorship mentioned — you may need it here");
    }
  }

  // degree requirement
  if (p.eligibility.hasDegree === false) {
    if (item.degree_required === true) {
      raw -= 6;
      contradicts = true;
      gaps.push("requires a degree");
    } else if (item.degree_required === false) {
      raw += 2;
      reasons.push("no degree required");
    }
  }

  // years of experience vs the JD's stated minimum (derived from experience[])
  if (typeof item.min_years_experience === "number") {
    const have = deriveYearsOfExperience(p.experience);
    const need = item.min_years_experience;
    if (have > 0) {
      if (have + 0.5 >= need) {
        raw += 2;
        reasons.push(`meets the ${need}+ yr experience bar (~${have} yr)`);
      } else if (need - have >= 2) {
        raw -= 3;
        contradicts = true;
        gaps.push(`wants ${need}+ yrs of experience, your history is ~${have}`);
      } else {
        gaps.push(`just under the ${need}+ yr experience bar (~${have})`);
      }
    }
  }

  // relocation support
  if (item.relocation === true && p.eligibility.willRelocate === true) {
    raw += 1;
    reasons.push("relocation support");
  }

  // required spoken languages vs the ones on your profile
  const langNeeded = item.languages_required ?? [];
  if (langNeeded.length > 0) {
    const mine = new Set(p.eligibility.spokenLanguages.map((l) => l.toLowerCase().trim()));
    const missing = langNeeded.filter((l) => !mine.has(l.toLowerCase().trim()));
    if (missing.length === 0 && mine.size > 0) {
      raw += 2;
      reasons.push(`speaks the required language${langNeeded.length === 1 ? "" : "s"}`);
    } else if (missing.length > 0) {
      gaps.push(`needs ${missing.join(", ")} — not on your profile`);
    }
  }

  const score = Math.max(0, Math.min(100, Math.round((raw / SCORE_CEIL) * 100)));
  return { score, raw, reasons, gaps, contradicts };
}

/** Enough of the profile is filled for a match score to carry meaning. */
export function profileCanMatch(p: Profile): boolean {
  const t = p.targets;
  const targeted =
    t.levels.length + t.roles.length + t.regions.length + t.countries.length + t.remotes.length + t.companies.length > 0;
  const skilled = p.skills.languages.length + p.skills.frameworks.length + p.skills.tools.length > 0;
  return targeted || skilled;
}
