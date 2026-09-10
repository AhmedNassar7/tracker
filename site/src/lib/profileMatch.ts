import { companyNameMatches, DEFAULT_FILTERS, type FilterState } from "./filters";
import { countryForItem, regionForItem } from "./geo";
import { detectSkillTags, detectTechTags } from "./keywordGap";
import { matchReasons } from "./preferences";
import { deriveYearsOfExperience, type Profile } from "./profile";
import type { SiteIndexEntry } from "./types";

// Score a job posting against the unified profile. The badge % is
// **earned ÷ assessable** — the share of the signals we could actually check
// for THIS posting that came out in your favour — so it varies posting to
// posting instead of collapsing onto one number, and a job we can barely
// assess can't inflate to 100%. Every contribution is turned into a
// plain-language reason or gap so the match stays explainable, never a
// black-box number (APPLICANT-TOOLKIT-PLAN §5).
//
// `contradicts` marks a posting that flatly conflicts with where you are —
// wrong kind, a hard level mismatch, a Staff/Principal title when you have a
// couple of years, needs a degree you don't have, pays below your floor. The
// caller partitions those below a "show anyway" line and the badge is capped.

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
  /** 0–100 badge — earned ÷ assessable, capped at 12 when `contradicts`. */
  score: number;
  /** Earned fit points (sort key). Negative is possible via `contradicts`. */
  raw: number;
  /** Plain-language positives, strongest first. */
  reasons: string[];
  /** Mismatches worth knowing before applying. */
  gaps: string[];
  /** Flatly contradicts where you are — the caller drops these below a
   *  "show anyway" line rather than interleaving them. */
  contradicts: boolean;
}

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

// --- title seniority -------------------------------------------------------
// `item.level` from the pipeline collapses "Staff / Principal / Lead / Director"
// down to "mid_level" (see detect_level in patterns.py) — it can't tell a
// genuine 3-year mid role from a Staff role. The title can, so read it here.
// Mirrors SENIOR_TITLE_RE / the early-career words in patterns.py.
const SENIOR_TITLE_RE =
  /\b(senior|sr\.?|staff|principal|lead|manager|director|head\s+of|vp|vice\s+president|distinguished|fellow|architect|executive|expert|team\s+lead|tech\s+lead|group\s+lead)\b/i;
const EARLY_TITLE_RE =
  /\b(intern|internship|new.?grad|fresh.?grad|recent.?grad|graduate|campus|early.?career|junior|jr\.?|entry.?level|apprentice|trainee|working\s+student|werkstudent)\b/i;

type Seniority = "early" | "mid" | "senior";
const SEN_RANK: Record<Seniority, number> = { early: 0, mid: 1, senior: 2 };

function titleSeniority(title: string): Seniority {
  if (EARLY_TITLE_RE.test(title)) return "early"; // an early word wins even next to "Senior"
  if (SENIOR_TITLE_RE.test(title)) return "senior";
  return "mid";
}

/** Where the applicant sits — from their stated target levels first, then
 *  their derived years of experience. This is an early-career board, so an
 *  unknown history reads as "early", not "mid". */
function profileSeniority(p: Profile): Seniority {
  const lv = p.targets.levels;
  const early = new Set(["internship", "new_grad", "junior", "entry_level"]);
  if (lv.length > 0 && lv.every((l) => early.has(l))) return "early";
  if (lv.length > 0 && lv.every((l) => l === "mid_level")) return "mid";
  const yoe = deriveYearsOfExperience(p.experience);
  if (yoe >= 6) return "senior";
  if (yoe >= 3) return "mid";
  return "early";
}

const SENIOR_LABEL = (title: string): string => {
  const m = SENIOR_TITLE_RE.exec(title);
  return m ? m[1].toLowerCase() : "senior";
};

export function scoreJobForProfile(item: SiteIndexEntry, p: Profile): JobMatch {
  const pref = filterStateFromProfile(p);
  const reasons = matchReasons(item, pref, { keywords: [], excludeCompanies: [] }).map((r) => r.replace(/_/g, " "));
  const gaps: string[] = [];
  // `contradicts` is set only by the title-seniority check below — a Senior /
  // Staff / Principal title when you have a couple of years. A merely-off
  // target level drags the % down (facet block) without banishing the row.
  let contradicts = false;

  // earned = fit points that came out in your favour; ceil = the points that
  // were on the table for THIS posting (i.e. dimensions we could actually
  // assess). The badge is earned/ceil. A soft mismatch adds to ceil but not
  // earned, so it drags the % down without banishing the row.
  let earned = 0;
  let ceil = 0;

  // -- saved-filter facets (level / role / region / remote / country / company)
  if (pref.levels.length > 0 && item.level) {
    ceil += 3;
    if (pref.levels.includes(item.level)) earned += 3;
  }
  if (pref.roles.length > 0 && item.role_type) {
    ceil += 2;
    if (pref.roles.includes(item.role_type)) earned += 2;
  }
  if (pref.regions.length > 0) {
    ceil += 2;
    if (pref.regions.includes(regionForItem(item))) earned += 2;
  }
  if (pref.remotes.length > 0 && item.remote_type) {
    ceil += 2;
    if (pref.remotes.includes(item.remote_type)) earned += 2;
  }
  if (pref.countries.length > 0) {
    const c = countryForItem(item);
    ceil += 2;
    if (c && pref.countries.includes(c)) earned += 2;
  }
  if (pref.companies.length > 0) {
    ceil += 3;
    if (pref.companies.some((c) => companyNameMatches(item.company, c))) earned += 3;
  }

  // -- title seniority vs where you are (always assessable) ------------------
  const jobSen = titleSeniority(item.title);
  const youSen = profileSeniority(p);
  const senGap = SEN_RANK[jobSen] - SEN_RANK[youSen];
  ceil += 3;
  if (senGap === 0) {
    earned += 3;
    reasons.push(jobSen === "early" ? "early-career level" : `${jobSen}-level, matches you`);
  } else if (jobSen === "mid" && youSen === "early") {
    // An unmarked "Software Engineer" title is not evidence against you.
    earned += 2;
  } else if (senGap >= 2) {
    // Senior/Staff/Principal-titled and you're early-career — not your race.
    contradicts = true;
    gaps.push(`${SENIOR_LABEL(item.title)}-level title — beyond ~${deriveYearsOfExperience(p.experience) || 0} yr of experience`);
  } else if (senGap === 1) {
    earned += 1;
    gaps.push(jobSen === "senior" ? "a senior title — a stretch from where you are" : "a level up from where you are");
  } else if (senGap === -1) {
    earned += 2;
    gaps.push("a notch below your level");
  } else {
    earned += 1;
    gaps.push("well below your level");
  }

  // -- skills <-> tech tags (canonical detect_tech_tags vocabulary, R2) -----
  // `item.tech_tags` come from the pipeline's description-based detector; only
  // Greenhouse/Lever/Ashby carry them. For everything else, fall back to
  // whatever the *title* names so the row still gets a skill signal.
  const mine = canonicalSkillTags(p);
  if (mine.size > 0) {
    const fromTags = item.tech_tags ?? [];
    const tags = fromTags.length > 0 ? fromTags : detectTechTags(item.title);
    if (tags.length > 0) {
      const weight = fromTags.length > 0 ? 5 : 3; // title-only tags are noisier
      const hit = tags.filter((t) => mine.has(t));
      const miss = tags.filter((t) => !mine.has(t));
      ceil += weight;
      earned += Math.min(hit.length, weight);
      if (hit.length > 0) reasons.push(`${hit.length}/${tags.length} of the stack (${hit.slice(0, 3).join(", ")})`);
      if (hit.length > 0 && miss.length > 0) gaps.push(`stack to learn: ${miss.slice(0, 4).join(", ")}`);
    }
  }

  // -- disclosed salary vs your floor (only when currencies match) ----------
  if (p.targets.minSalary && item.salary && item.salary.currency === p.targets.salaryCurrency) {
    const floor = perYear(p.targets.minSalary, p.targets.salaryPeriod);
    const low = perYear(item.salary.min, item.salary.period);
    const high = perYear(item.salary.max, item.salary.period);
    ceil += 3;
    if (low >= floor) {
      earned += 3;
      reasons.push("pays at or above your target");
    } else if (high < floor) {
      contradicts = true;
      gaps.push("pays below your minimum");
    } else {
      gaps.push("pay range starts below your minimum");
    }
  }

  // -- visa sponsorship ----------------------------------------------------
  if (p.eligibility.needsSponsorship === true) {
    if (item.visa_sponsorship === true) {
      ceil += 4;
      earned += 4;
      reasons.push("offers visa sponsorship");
    } else if (item.visa_sponsorship === false) {
      ceil += 4;
      gaps.push("states it won't sponsor — you marked that you need it");
    } else {
      const country = countryForItem(item);
      const authorised =
        !!country && p.eligibility.authorizedCountries.some((c) => c.toLowerCase() === country.toLowerCase());
      if (!authorised) gaps.push("no sponsorship mentioned — you may need it here");
    }
  }

  // -- degree requirement ------------------------------------------------
  if (p.eligibility.hasDegree === false) {
    if (item.degree_required === true) {
      contradicts = true;
      gaps.push("requires a degree");
    } else if (item.degree_required === false) {
      ceil += 2;
      earned += 2;
      reasons.push("no degree required");
    }
  }

  // -- years of experience vs the JD's stated minimum ------------------
  if (typeof item.min_years_experience === "number") {
    const have = deriveYearsOfExperience(p.experience);
    const need = item.min_years_experience;
    if (have > 0) {
      ceil += 2;
      if (have + 0.5 >= need) {
        earned += 2;
        reasons.push(`meets the ${need}+ yr experience bar (~${have} yr)`);
      } else if (need - have >= 2) {
        contradicts = true;
        gaps.push(`wants ${need}+ yrs of experience, your history is ~${have}`);
      } else {
        gaps.push(`just under the ${need}+ yr experience bar (~${have})`);
      }
    }
  }

  // -- relocation support ------------------------------------------------
  if (item.relocation === true && p.eligibility.willRelocate === true) {
    ceil += 1;
    earned += 1;
    reasons.push("relocation support");
  }

  // -- required spoken languages vs your profile -----------------------
  const langNeeded = item.languages_required ?? [];
  if (langNeeded.length > 0) {
    const spoken = new Set(p.eligibility.spokenLanguages.map((l) => l.toLowerCase().trim()));
    const missing = langNeeded.filter((l) => !spoken.has(l.toLowerCase().trim()));
    ceil += 2;
    if (missing.length === 0 && spoken.size > 0) {
      earned += 2;
      reasons.push(`speaks the required language${langNeeded.length === 1 ? "" : "s"}`);
    } else {
      gaps.push(`needs ${missing.join(", ")} — not on your profile`);
    }
  }

  // The raw ratio, then pulled toward a neutral 50 by how little we could
  // actually assess — a posting where only the title told us anything
  // shouldn't read as a confident 0% or 100%. ~12 pts of assessable signal
  // (a full set of targets + tags + eligibility) counts as full confidence.
  const rawPct = ceil > 0 ? (Math.max(0, earned) / ceil) * 100 : 50;
  const confidence = Math.min(1, ceil / 12);
  let score = Math.round(rawPct * confidence + 50 * (1 - confidence));
  score = Math.max(0, Math.min(100, score));
  if (contradicts) score = Math.min(score, 12);

  return { score, raw: contradicts ? earned - 100 : earned, reasons, gaps, contradicts };
}

/** Enough of the profile is filled for a match score to carry meaning. */
export function profileCanMatch(p: Profile): boolean {
  const t = p.targets;
  const targeted =
    t.levels.length + t.roles.length + t.regions.length + t.countries.length + t.remotes.length + t.companies.length > 0;
  const skilled = p.skills.languages.length + p.skills.frameworks.length + p.skills.tools.length > 0;
  return targeted || skilled;
}
