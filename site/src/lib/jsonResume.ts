import {
  emptyProfile,
  newId,
  type Profile,
  type ExperienceEntry,
  type EducationEntry,
  type ProjectEntry,
} from "./profile";

// Profile <-> JSON Resume (https://jsonresume.org) — the interchange format
// chosen in docs/APPLICANT-TOOLKIT-PLAN.md §10 so an export from here can be
// read by the wider open-source résumé ecosystem, and a `resume.json` a user
// already has elsewhere can be imported.
//
// Scope note: JSON Resume has no home for a few of our fields — `targets`,
// `eligibility`, `answers`, `resumeText` — so a round-trip through this format
// drops them. That's why the *native* export (exportProfile / importProfile in
// profile.ts) stays the lossless one; this pair is the ecosystem bridge, used
// only when the user picks "JSON Resume" explicitly.

interface JRLocation {
  address?: string;
  city?: string;
  region?: string;
  countryCode?: string;
}

interface JRProfileRef {
  network?: string;
  username?: string;
  url?: string;
}

interface JRBasics {
  name?: string;
  label?: string;
  email?: string;
  phone?: string;
  url?: string;
  summary?: string;
  location?: JRLocation;
  profiles?: JRProfileRef[];
}

interface JRWork {
  name?: string;
  organization?: string;
  position?: string;
  url?: string;
  startDate?: string;
  endDate?: string;
  summary?: string;
  highlights?: string[];
}

interface JREducation {
  institution?: string;
  area?: string;
  studyType?: string;
  startDate?: string;
  endDate?: string;
  score?: string;
  courses?: string[];
}

interface JRProject {
  name?: string;
  description?: string;
  url?: string;
  startDate?: string;
  endDate?: string;
  highlights?: string[];
}

interface JRSkill {
  name?: string;
  level?: string;
  keywords?: string[];
}

export interface JsonResume {
  $schema?: string;
  basics?: JRBasics;
  work?: JRWork[];
  education?: JREducation[];
  projects?: JRProject[];
  skills?: JRSkill[];
}

const SCHEMA_URL = "https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : [];
}

// ---- Profile -> JSON Resume ------------------------------------------------

function profileToJRProfiles(p: Profile): JRProfileRef[] {
  const out: JRProfileRef[] = [];
  if (p.identity.links.linkedin) out.push({ network: "LinkedIn", url: p.identity.links.linkedin });
  if (p.identity.links.github) out.push({ network: "GitHub", url: p.identity.links.github });
  for (const l of p.identity.links.other) {
    if (l.url) out.push({ network: l.label || "Link", url: l.url });
  }
  return out;
}

export function toJsonResume(p: Profile): JsonResume {
  const skills: JRSkill[] = [
    { name: "Languages", keywords: p.skills.languages },
    { name: "Frameworks", keywords: p.skills.frameworks },
    { name: "Tools", keywords: p.skills.tools },
    { name: "Other", keywords: p.skills.other },
  ].filter((s) => s.keywords.length > 0);

  return {
    $schema: SCHEMA_URL,
    basics: {
      name: p.identity.fullName,
      label: p.identity.headline,
      email: p.identity.email,
      phone: p.identity.phone,
      url: p.identity.links.portfolio,
      summary: "",
      location: { address: p.identity.location },
      profiles: profileToJRProfiles(p),
    },
    work: p.experience.map((e) => ({
      name: e.org,
      position: e.title,
      startDate: e.start,
      endDate: e.current ? "" : e.end,
      // JSON Resume has no per-entry location; folded into the summary so it
      // isn't silently lost on a round-trip.
      summary: e.location ? `Location: ${e.location}` : "",
      highlights: e.bullets.filter((b) => b.trim() !== ""),
    })),
    education: p.education.map((ed) => ({
      institution: ed.school,
      studyType: ed.degree,
      area: ed.field,
      startDate: ed.start,
      endDate: ed.end,
      score: ed.gpa,
      // `notes` has no JSON Resume field; keep it visible as a course line
      // rather than drop it.
      courses: ed.notes ? [ed.notes] : [],
    })),
    projects: p.projects.map((pr) => ({
      name: pr.name,
      description: pr.blurb,
      url: pr.url,
      highlights: pr.bullets.filter((b) => b.trim() !== ""),
    })),
    skills,
  };
}

export function toJsonResumeString(p: Profile): string {
  return JSON.stringify(toJsonResume(p), null, 2);
}

// ---- JSON Resume -> Profile ----------------------------------------------

// A skill-category entry name we recognise maps into that bucket; anything
// else (including bare skill entries with no keywords) lands in `other`.
const SKILL_BUCKETS: Record<string, "languages" | "frameworks" | "tools"> = {
  languages: "languages",
  language: "languages",
  "programming languages": "languages",
  frameworks: "frameworks",
  framework: "frameworks",
  libraries: "frameworks",
  "frameworks & libraries": "frameworks",
  tools: "tools",
  tooling: "tools",
  technologies: "tools",
  tech: "tools",
};

function jrLocationToString(loc: JRLocation | undefined): string {
  if (!loc) return "";
  if (loc.address && loc.address.trim() !== "") return loc.address.trim();
  return [loc.city, loc.region, loc.countryCode].filter((x) => x && x.trim() !== "").join(", ");
}

export function fromJsonResume(input: unknown): Profile | null {
  if (!input || typeof input !== "object") return null;
  const jr = input as JsonResume;
  // Require at least one recognisable JSON Resume section, so a random JSON
  // file isn't silently accepted as an empty profile.
  if (!jr.basics && !jr.work && !jr.education && !jr.skills && !jr.projects) return null;

  const p = emptyProfile();
  const basics = jr.basics ?? {};

  p.identity.fullName = str(basics.name);
  p.identity.headline = str(basics.label);
  p.identity.email = str(basics.email);
  p.identity.phone = str(basics.phone);
  p.identity.location = jrLocationToString(basics.location);
  p.identity.links.portfolio = str(basics.url);

  for (const ref of basics.profiles ?? []) {
    const network = str(ref.network).toLowerCase();
    const url = str(ref.url) || (ref.username ? `@${ref.username}` : "");
    if (!url) continue;
    if (network.includes("linkedin") && !p.identity.links.linkedin) p.identity.links.linkedin = url;
    else if (network.includes("github") && !p.identity.links.github) p.identity.links.github = url;
    else p.identity.links.other.push({ label: str(ref.network) || "Link", url });
  }

  p.experience = (jr.work ?? []).map((w): ExperienceEntry => {
    const highlights = strArray(w.highlights);
    return {
      id: newId(),
      org: str(w.name) || str(w.organization),
      title: str(w.position),
      location: "",
      start: str(w.startDate),
      end: str(w.endDate),
      current: str(w.endDate).trim() === "",
      // Prefer explicit highlights; fall back to splitting a prose summary
      // into lines so an import from a summary-only résumé isn't empty.
      bullets: highlights.length > 0 ? highlights : strArray(str(w.summary).split(/\r?\n/)),
    };
  });

  p.education = (jr.education ?? []).map((e): EducationEntry => ({
    id: newId(),
    school: str(e.institution),
    degree: str(e.studyType),
    field: str(e.area),
    start: str(e.startDate),
    end: str(e.endDate),
    gpa: str(e.score),
    notes: strArray(e.courses).join(", "),
  }));

  p.projects = (jr.projects ?? []).map((pr): ProjectEntry => ({
    id: newId(),
    name: str(pr.name),
    url: str(pr.url),
    blurb: str(pr.description),
    bullets: strArray(pr.highlights),
  }));

  for (const s of jr.skills ?? []) {
    const keywords = strArray(s.keywords);
    const bucket = SKILL_BUCKETS[str(s.name).toLowerCase().trim()];
    const values = keywords.length > 0 ? keywords : str(s.name) ? [str(s.name)] : [];
    if (bucket) p.skills[bucket].push(...values);
    else p.skills.other.push(...values);
  }

  return p;
}

export function fromJsonResumeString(json: string): Profile | null {
  try {
    return fromJsonResume(JSON.parse(json));
  } catch {
    return null;
  }
}
