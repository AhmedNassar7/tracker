import { get, set, del } from "idb-keyval";

// The "unified profile" (docs/APPLICANT-TOOLKIT-PLAN.md, Phase 1) — one
// versioned record every later tool reads from: the cover-letter engine, the
// résumé keyword-gap check, the tracker's "prefill a new row", the browser
// extension's form autofill (X3/X4), and the "for you" ranking. The shape is
// defined ONCE here; consumers import the type, they never redefine it.
//
// Storage: IndexedDB via idb-keyval — the same call tracker.ts makes, for the
// same reason. The résumé-vault text plus a library of "master answers" runs
// to tens of KB, and localStorage's budget is a shared ~5MB *synchronous*
// ceiling that the other tracker:* keys already draw on. Local-first by
// construction: no backend exists anywhere in this project, so this browser is
// the only place a profile lives unless the user exports it (exportProfile).
//
// Every accessor is SSR-guarded: Astro renders these islands on the server
// too, where there is no IndexedDB — there, reads resolve to an empty profile
// and writes no-op, rather than throwing.

export const PROFILE_SCHEMA_VERSION = 1;

const STORE_KEY = "tracker:profile";

export interface ProfileLink {
  label: string;
  url: string;
}

export interface ProfileIdentity {
  fullName: string;
  /** JSON Resume `basics.label` — e.g. "Backend Engineer". */
  headline: string;
  email: string;
  phone: string;
  location: string;
  links: {
    linkedin: string;
    github: string;
    portfolio: string;
    other: ProfileLink[];
  };
}

export interface ProfileEligibility {
  /** Free-text tags, e.g. "EU citizen", "US F-1 OPT", "UAE golden visa". */
  workAuth: string[];
  /** Countries you can work in WITHOUT sponsorship — structured, so a job's
   *  `country` can be checked against it. Free-text `workAuth` stays for
   *  anything that doesn't reduce to a country list. */
  authorizedCountries: string[];
  /** `null` = unset / prefer not to say — not the same as an explicit `false`,
   *  the same "absent, not guessed" convention the site-index schema uses. */
  needsSponsorship: boolean | null;
  willRelocate: boolean | null;
  /** `null` = unset. `false` = no degree / in progress — used to surface roles
   *  whose posting does not require one (`degree_required !== true`). */
  hasDegree: boolean | null;
  noticePeriod: string;
}

export interface EducationEntry {
  id: string;
  school: string;
  degree: string;
  field: string;
  /** Free "YYYY" / "YYYY-MM" / "Present" strings — no date-picker tyranny for
   *  the many people whose dates are approximate or ongoing. */
  start: string;
  end: string;
  gpa: string;
  notes: string;
}

export interface ExperienceEntry {
  id: string;
  org: string;
  title: string;
  location: string;
  start: string;
  end: string;
  current: boolean;
  bullets: string[];
}

export interface ProjectEntry {
  id: string;
  name: string;
  url: string;
  blurb: string;
  bullets: string[];
}

export interface ProfileSkills {
  languages: string[];
  frameworks: string[];
  tools: string[];
  other: string[];
}

// Mirrors the scored dimensions of a job record (site-index.json /
// SiteIndexEntry) one-for-one, so profileMatch.ts can score a posting against
// the profile with the same weights the site's own relevance sort uses:
//   levels   -> job.level        roles     -> job.role_type
//   regions  -> job.region       countries -> job.country
//   remotes  -> job.remote_type  companies -> job.company
//   minSalary/salaryCurrency/salaryPeriod -> job.salary
// Kept as bare arrays / primitives here so this module doesn't depend on
// filters.ts; profileMatch.ts does the mapping to a FilterState.
export interface ProfileTargets {
  levels: string[];
  roles: string[];
  regions: string[];
  countries: string[];
  /** Work-type preference — mirrors the site's RemoteType facet
   *  (remote / hybrid / onsite). */
  remotes: string[];
  /** Dream companies — a strong positive weight in match scoring. */
  companies: string[];
  /** Minimum acceptable pay, compared with a posting's disclosed range only
   *  when the currency matches. `null` = no salary floor set. */
  minSalary: number | null;
  salaryCurrency: string;
  salaryPeriod: "year" | "month" | "hour";
  /** Free-text extras the structured fields don't capture. */
  mustHave: string[];
  avoid: string[];
}

export interface MasterAnswer {
  id: string;
  q: string;
  a: string;
}

export interface Profile {
  schemaVersion: number;
  identity: ProfileIdentity;
  eligibility: ProfileEligibility;
  education: EducationEntry[];
  experience: ExperienceEntry[];
  projects: ProjectEntry[];
  skills: ProfileSkills;
  targets: ProfileTargets;
  answers: MasterAnswer[];
  /** The résumé vault: plain text, pasted or extracted client-side from an
   *  uploaded PDF. Never uploaded anywhere. Feeds the Phase 5 keyword-gap and
   *  linter tools. */
  resumeText: string;
  updatedAt: string;
}

/** A short, collision-safe id for list rows (education/experience/…). Guarded
 *  for the SSR pass and for the rare browser with no `crypto.randomUUID`. */
export function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyProfile(): Profile {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    identity: {
      fullName: "",
      headline: "",
      email: "",
      phone: "",
      location: "",
      links: { linkedin: "", github: "", portfolio: "", other: [] },
    },
    eligibility: {
      workAuth: [],
      authorizedCountries: [],
      needsSponsorship: null,
      willRelocate: null,
      hasDegree: null,
      noticePeriod: "",
    },
    education: [],
    experience: [],
    projects: [],
    skills: { languages: [], frameworks: [], tools: [], other: [] },
    targets: {
      levels: [],
      roles: [],
      regions: [],
      countries: [],
      remotes: [],
      companies: [],
      minSalary: null,
      salaryCurrency: "USD",
      salaryPeriod: "year",
      mustHave: [],
      avoid: [],
    },
    answers: [],
    resumeText: "",
    updatedAt: "",
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
}

function asTriBool(value: unknown): boolean | null {
  return value === true || value === false ? value : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// Deep-merge an arbitrary parsed object onto emptyProfile() so an old, partial,
// or hand-edited JSON import can never leave a consumer reading `undefined.map`.
// Unknown keys are dropped rather than trusted. This is also the schema
// migration point — bump PROFILE_SCHEMA_VERSION and branch here when the shape
// changes; v1 has nothing prior to migrate from.
export function normalizeProfile(raw: unknown): Profile {
  const base = emptyProfile();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;

  const identity = (r.identity ?? {}) as Record<string, unknown>;
  const links = (identity.links ?? {}) as Record<string, unknown>;
  const eligibility = (r.eligibility ?? {}) as Record<string, unknown>;
  const skills = (r.skills ?? {}) as Record<string, unknown>;
  const targets = (r.targets ?? {}) as Record<string, unknown>;

  const otherLinks = Array.isArray(links.other)
    ? (links.other as unknown[])
        .map((l) => {
          const o = (l ?? {}) as Record<string, unknown>;
          return { label: asString(o.label), url: asString(o.url) };
        })
        .filter((l) => l.url !== "")
    : [];

  const listRows = <T extends { id: string }>(value: unknown, map: (o: Record<string, unknown>) => Omit<T, "id">): T[] => {
    if (!Array.isArray(value)) return [];
    return value.map((row) => ({ id: newId(), ...map((row ?? {}) as Record<string, unknown>) }) as T);
  };

  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    identity: {
      fullName: asString(identity.fullName),
      headline: asString(identity.headline),
      email: asString(identity.email),
      phone: asString(identity.phone),
      location: asString(identity.location),
      links: {
        linkedin: asString(links.linkedin),
        github: asString(links.github),
        portfolio: asString(links.portfolio),
        other: otherLinks,
      },
    },
    eligibility: {
      workAuth: asStringArray(eligibility.workAuth),
      authorizedCountries: asStringArray(eligibility.authorizedCountries),
      needsSponsorship: asTriBool(eligibility.needsSponsorship),
      willRelocate: asTriBool(eligibility.willRelocate),
      hasDegree: asTriBool(eligibility.hasDegree),
      noticePeriod: asString(eligibility.noticePeriod),
    },
    education: listRows<EducationEntry>(r.education, (o) => ({
      school: asString(o.school),
      degree: asString(o.degree),
      field: asString(o.field),
      start: asString(o.start),
      end: asString(o.end),
      gpa: asString(o.gpa),
      notes: asString(o.notes),
    })),
    experience: listRows<ExperienceEntry>(r.experience, (o) => ({
      org: asString(o.org),
      title: asString(o.title),
      location: asString(o.location),
      start: asString(o.start),
      end: asString(o.end),
      current: o.current === true,
      bullets: asStringArray(o.bullets),
    })),
    projects: listRows<ProjectEntry>(r.projects, (o) => ({
      name: asString(o.name),
      url: asString(o.url),
      blurb: asString(o.blurb),
      bullets: asStringArray(o.bullets),
    })),
    skills: {
      languages: asStringArray(skills.languages),
      frameworks: asStringArray(skills.frameworks),
      tools: asStringArray(skills.tools),
      other: asStringArray(skills.other),
    },
    targets: {
      levels: asStringArray(targets.levels),
      roles: asStringArray(targets.roles),
      regions: asStringArray(targets.regions),
      countries: asStringArray(targets.countries),
      remotes: asStringArray(targets.remotes),
      companies: asStringArray(targets.companies),
      minSalary: typeof targets.minSalary === "number" && isFinite(targets.minSalary) && targets.minSalary > 0 ? targets.minSalary : null,
      salaryCurrency: asString(targets.salaryCurrency) || "USD",
      salaryPeriod: targets.salaryPeriod === "month" || targets.salaryPeriod === "hour" ? targets.salaryPeriod : "year",
      mustHave: asStringArray(targets.mustHave),
      avoid: asStringArray(targets.avoid),
    },
    answers: listRows<MasterAnswer>(r.answers, (o) => ({ q: asString(o.q), a: asString(o.a) })),
    resumeText: asString(r.resumeText),
    updatedAt: asString(r.updatedAt),
  };
}

/** The stored profile, or `null` if the user has never saved one. `null` is
 *  meaningful — the UI shows the intro/example state for it rather than a
 *  blank form. */
export async function loadProfile(): Promise<Profile | null> {
  if (typeof window === "undefined") return null;
  try {
    const raw = await get<unknown>(STORE_KEY);
    if (raw == null) return null;
    return normalizeProfile(raw);
  } catch {
    return null;
  }
}

// No read-modify-write queue (unlike tracker.ts): the editor holds the whole
// Profile in React state and hands the complete object to every save, so
// "last write wins" is exactly right and there's nothing to interleave.
// Debouncing the autosave is the caller's job.
export async function saveProfile(profile: Profile): Promise<Profile> {
  const stamped: Profile = { ...profile, schemaVersion: PROFILE_SCHEMA_VERSION, updatedAt: new Date().toISOString() };
  if (typeof window === "undefined") return stamped;
  try {
    await set(STORE_KEY, stamped);
  } catch {
    /* IndexedDB disabled / quota — the in-memory copy stands for this session */
  }
  return stamped;
}

export async function clearProfile(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await del(STORE_KEY);
  } catch {
    /* ignore */
  }
}

export function exportProfile(profile: Profile): string {
  return JSON.stringify(profile, null, 2);
}

/** Parse a JSON string from the import file picker. Returns a fully-normalized
 *  Profile on success, or `null` if the text isn't JSON at all — the caller
 *  surfaces that as "couldn't read that file". A JSON object that's the wrong
 *  shape still normalizes (missing fields become empty), which is the forgiving
 *  behaviour we want for hand-made or older exports. */
export function importProfile(json: string): Profile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  return normalizeProfile(parsed);
}

// ---- completeness -----------------------------------------------------------

export interface CompletenessSection {
  key: string;
  label: string;
  done: boolean;
  /** Shown when `done` is false — the concrete next action, not a scold. */
  hint: string;
}

export interface Completeness {
  /** 0..1 — the fraction of sections done, for the ring. */
  score: number;
  doneCount: number;
  total: number;
  sections: CompletenessSection[];
}

// ---- derived years of experience -----------------------------------------

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

/** A free-text "YYYY" / "YYYY-MM" / "Mar 2021" / "March 2021" as a fractional
 *  year (2021.17 = Feb 2021). `null` if no year is found. */
function parseFractionalYear(raw: string): number | null {
  const s = (raw || "").trim().toLowerCase();
  if (!s) return null;
  const ym = s.match(/(\d{4})[-/](\d{1,2})/);
  if (ym) return Number(ym[1]) + (Math.min(12, Math.max(1, Number(ym[2]))) - 1) / 12;
  const my = s.match(/([a-z]{3,9})\.?\s+(\d{4})/);
  if (my && my[1].slice(0, 4) in MONTH_INDEX) return Number(my[2]) + MONTH_INDEX[my[1].slice(0, 4)] / 12;
  const y = s.match(/(19|20)\d{2}/);
  return y ? Number(y[0]) : null;
}

/** Rough total years of professional experience, summed from `experience[]`
 *  date ranges (a "current" role runs to now). Overlaps are not de-duplicated
 *  — a rare source of slight over-count the user can correct. Returns a number
 *  rounded to one decimal, capped at 40; 0 when nothing is parseable. */
export function deriveYearsOfExperience(experience: ExperienceEntry[], now: Date = new Date()): number {
  const nowFrac = now.getFullYear() + now.getMonth() / 12;
  let total = 0;
  for (const e of experience) {
    const start = parseFractionalYear(e.start);
    if (start == null) continue;
    const end = e.current ? nowFrac : (parseFractionalYear(e.end) ?? nowFrac);
    if (end > start) total += end - start;
  }
  return Math.min(40, Math.round(total * 10) / 10);
}

/** A transparent checklist, not a black-box score (APPLICANT-TOOLKIT-PLAN §5).
 *  Each section is a plain boolean; the ring is just their ratio. */
export function profileCompleteness(p: Profile): Completeness {
  const hasName = p.identity.fullName.trim() !== "";
  const hasContact = p.identity.email.trim() !== "" || p.identity.phone.trim() !== "";
  const hasLink =
    p.identity.links.linkedin.trim() !== "" ||
    p.identity.links.github.trim() !== "" ||
    p.identity.links.portfolio.trim() !== "" ||
    p.identity.links.other.length > 0;
  const skillCount =
    p.skills.languages.length + p.skills.frameworks.length + p.skills.tools.length + p.skills.other.length;
  const experienceWithBullet = p.experience.some((e) => e.bullets.some((b) => b.trim() !== ""));
  const targetsSet =
    p.targets.levels.length +
      p.targets.roles.length +
      p.targets.regions.length +
      p.targets.countries.length +
      p.targets.remotes.length >
    0;
  const eligibilitySet =
    p.eligibility.needsSponsorship !== null ||
    p.eligibility.hasDegree !== null ||
    p.eligibility.workAuth.length > 0 ||
    p.eligibility.authorizedCountries.length > 0;

  const sections: CompletenessSection[] = [
    { key: "name", label: "Name & headline", done: hasName, hint: "Add your name and a one-line headline." },
    { key: "contact", label: "Contact", done: hasContact, hint: "Add an email or phone number." },
    { key: "links", label: "Links", done: hasLink, hint: "Add a LinkedIn, GitHub, or portfolio link." },
    {
      key: "experience",
      label: "Experience",
      done: experienceWithBullet,
      hint: "Add one role with at least one bullet point.",
    },
    { key: "education", label: "Education", done: p.education.length > 0, hint: "Add a school or programme." },
    { key: "skills", label: "Skills", done: skillCount >= 3, hint: "List at least three skills." },
    { key: "eligibility", label: "Eligibility", done: eligibilitySet, hint: "Set work authorisation, sponsorship, and degree — used in match scoring." },
    { key: "targets", label: "What you want", done: targetsSet, hint: "Pick target levels, roles, regions, or work type." },
    { key: "resume", label: "Résumé text", done: p.resumeText.trim().length >= 200, hint: "Paste your résumé text or import a PDF." },
  ];

  const doneCount = sections.filter((s) => s.done).length;
  return { score: doneCount / sections.length, doneCount, total: sections.length, sections };
}
