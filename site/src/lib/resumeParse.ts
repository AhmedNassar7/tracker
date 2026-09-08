import { emptyProfile, newId, type EducationEntry, type ExperienceEntry, type Profile } from "./profile";

// Best-effort résumé-text -> Profile fields. Heuristic, and deliberately
// conservative: it fills the things it can read reliably (contact details,
// links, a skills line) and takes a rough pass at experience / education
// blocks. Everything it produces is shown to the user to confirm or fix
// before anything is saved — the parser never has the final word, matching
// the project's no-fabrication rule. The full text is always kept verbatim
// in `resumeText`, which is what the keyword and cover-letter tools actually
// need; the structured parse is a convenience on top.

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|pub)\/[^\s)|]+/i;
const GITHUB_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/[^\s)|]+/i;
const URL_RE = /(?:https?:\/\/)[^\s)|]+/gi;
const YEAR_RANGE_RE = /\b(19|20)\d{2}\b\s*(?:[-–—]|to)\s*(?:present|current|now|\b(19|20)\d{2}\b)/i;

const HEADINGS: { key: "experience" | "education" | "skills" | "projects" | "summary"; re: RegExp }[] = [
  { key: "experience", re: /^\s*(work\s+experience|professional\s+experience|experience|employment(?:\s+history)?)\s*:?\s*$/i },
  { key: "education", re: /^\s*(education(?:\s+and\s+training)?|academic\s+background)\s*:?\s*$/i },
  { key: "skills", re: /^\s*(technical\s+skills|core\s+skills|skills\s*(?:&|and)\s*(?:tools|technologies)|skills|technologies|tech\s+stack)\s*:?\s*$/i },
  { key: "projects", re: /^\s*(projects|personal\s+projects|selected\s+projects|open\s+source)\s*:?\s*$/i },
  { key: "summary", re: /^\s*(summary|profile|professional\s+summary|objective|about(?:\s+me)?)\s*:?\s*$/i },
];

// A compact skill vocabulary — enough to lift a free-form "Skills" line or
// scattered mentions into chips. Superseded later by the detect_tech_tags
// TS port (Lane R2) which will share the pipeline's canonical list.
const SKILL_VOCAB: { name: string; bucket: "languages" | "frameworks" | "tools" }[] = [
  ...["JavaScript", "TypeScript", "Python", "Java", "Kotlin", "Swift", "Go", "Rust", "C++", "C#", "C", "Ruby", "PHP", "Scala", "Dart", "R", "MATLAB", "Elixir", "Haskell", "SQL", "Bash", "Shell", "HTML", "CSS"].map((name) => ({ name, bucket: "languages" as const })),
  ...["React", "React Native", "Next.js", "Vue", "Nuxt", "Angular", "Svelte", "Astro", "Node.js", "Express", "NestJS", "Django", "Flask", "FastAPI", "Spring", "Spring Boot", "Rails", "Laravel", ".NET", "Flutter", "TensorFlow", "PyTorch", "scikit-learn", "pandas", "NumPy", "GraphQL", "Redux", "Tailwind CSS", "jQuery"].map((name) => ({ name, bucket: "frameworks" as const })),
  ...["Docker", "Kubernetes", "AWS", "GCP", "Azure", "Terraform", "Ansible", "Git", "GitHub Actions", "GitLab CI", "Jenkins", "PostgreSQL", "MySQL", "MongoDB", "Redis", "Elasticsearch", "Kafka", "RabbitMQ", "Nginx", "Linux", "Jira", "Figma", "Postman", "gRPC", "REST", "CI/CD", "Prometheus", "Grafana", "Snowflake", "Spark", "Airflow"].map((name) => ({ name, bucket: "tools" as const })),
];

function firstMatch(text: string, re: RegExp): string {
  const m = text.match(re);
  return m ? m[0].trim().replace(/[|,;]+$/, "") : "";
}

function normalizeUrl(u: string): string {
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

/** A plausible name is one of the first few non-empty lines: 2–4 words, mostly
 *  letters, not an email / URL / heading / all-caps section word. */
function guessName(lines: string[]): string {
  for (const line of lines.slice(0, 6)) {
    const t = line.trim();
    if (!t || t.length > 60) continue;
    if (EMAIL_RE.test(t) || /https?:\/\//i.test(t) || /@/.test(t) || /\d/.test(t)) continue;
    if (HEADINGS.some((h) => h.re.test(t))) continue;
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 4) continue;
    if (!words.every((w) => /^[A-Za-z][A-Za-z'.-]*$/.test(w))) continue;
    return t.replace(/\s+/g, " ");
  }
  return "";
}

interface SectionMap {
  experience?: string;
  education?: string;
  skills?: string;
  projects?: string;
  summary?: string;
}

function splitSections(lines: string[]): SectionMap {
  const marks: { key: keyof SectionMap; at: number }[] = [];
  lines.forEach((line, i) => {
    const h = HEADINGS.find((x) => x.re.test(line));
    if (h) marks.push({ key: h.key, at: i });
  });
  const out: SectionMap = {};
  marks.forEach((mark, idx) => {
    const end = idx + 1 < marks.length ? marks[idx + 1].at : lines.length;
    out[mark.key] = lines.slice(mark.at + 1, end).join("\n").trim();
  });
  return out;
}

function parseSkills(section: string | undefined, wholeText: string): Profile["skills"] {
  const skills = emptyProfile().skills;
  const seen = new Set<string>();
  const add = (bucket: keyof Profile["skills"], name: string) => {
    const k = name.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    skills[bucket].push(name);
  };
  // Vocabulary hits anywhere in the text (word-boundary, case-insensitive).
  for (const { name, bucket } of SKILL_VOCAB) {
    const re = new RegExp(`(?<![A-Za-z0-9+#.])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9+#])`, "i");
    if (re.test(wholeText)) add(bucket, name);
  }
  // Anything else explicitly listed in the Skills section goes to "other".
  if (section) {
    for (const token of section.split(/[,•·|\/\n]+|\s{2,}/).map((s) => s.trim())) {
      if (!token || token.length > 30 || /[.:;]$/.test(token)) continue;
      if (!/^[A-Za-z0-9][A-Za-z0-9 +#.\-]*$/.test(token)) continue;
      if (seen.has(token.toLowerCase())) continue;
      seen.add(token.toLowerCase());
      skills.other.push(token);
    }
  }
  return skills;
}

/** Split a section into blank-line-separated blocks. */
function blocks(section: string | undefined): string[] {
  if (!section) return [];
  return section
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

function parseExperience(section: string | undefined): ExperienceEntry[] {
  return blocks(section)
    .slice(0, 12)
    .map((block): ExperienceEntry => {
      const lines = block.split(/\n/).map((l) => l.trim()).filter(Boolean);
      const header = lines[0] ?? "";
      const dates = firstMatch(block, YEAR_RANGE_RE);
      // "Title — Company" / "Title, Company" / "Company | Title" — take the two
      // sides; the user corrects which is which.
      const sides = header.split(/\s+[-–—|]\s+|,\s+/).map((s) => s.trim()).filter(Boolean);
      const [start = "", end = ""] = dates.split(/\s*(?:[-–—]|to)\s*/i);
      const bullets = lines.slice(1).map((l) => l.replace(/^[-•*·]\s*/, "")).filter(Boolean);
      return {
        id: newId(),
        title: sides[0] ?? header,
        org: sides[1] ?? "",
        location: "",
        start: start.trim(),
        end: /present|current|now/i.test(end) ? "" : end.trim(),
        current: /present|current|now/i.test(dates),
        bullets: bullets.length > 0 ? bullets : lines.slice(1),
      };
    })
    .filter((e) => e.title || e.org || e.bullets.length > 0);
}

function parseEducation(section: string | undefined): EducationEntry[] {
  return blocks(section)
    .slice(0, 8)
    .map((block): EducationEntry => {
      const lines = block.split(/\n/).map((l) => l.trim()).filter(Boolean);
      const dates = firstMatch(block, YEAR_RANGE_RE) || firstMatch(block, /\b(19|20)\d{2}\b/);
      const [start = "", end = ""] = dates.split(/\s*(?:[-–—]|to)\s*/i);
      const gpa = firstMatch(block, /\bGPA[:\s]*([0-4]\.\d{1,2})(?:\s*\/\s*[45](?:\.0)?)?/i).replace(/gpa[:\s]*/i, "");
      return {
        id: newId(),
        school: lines[0] ?? "",
        degree: firstMatch(block, /\b(B\.?S\.?c?|B\.?A|M\.?S\.?c?|M\.?A|Ph\.?D|Bachelor|Master|Diploma)[^\n,]*/i),
        field: "",
        start: start.trim(),
        end: /present|current|now/i.test(end) ? "" : end.trim(),
        gpa,
        notes: lines.slice(1).join(" · "),
      };
    })
    .filter((e) => e.school);
}

export interface ResumeParseResult {
  parsed: Partial<Profile>;
  /** Human-readable list of what was picked up, for the review summary. */
  found: string[];
}

export function parseResume(text: string): ResumeParseResult {
  const clean = text.replace(/\r\n/g, "\n").replace(/ /g, " ");
  const lines = clean.split(/\n/);
  const sections = splitSections(lines);

  const email = firstMatch(clean, EMAIL_RE);
  const linkedin = firstMatch(clean, LINKEDIN_RE);
  const github = firstMatch(clean, GITHUB_RE);
  // A portfolio link = any other URL that isn't the LinkedIn / GitHub one.
  const otherUrl = (clean.match(URL_RE) ?? []).find(
    (u) => !/linkedin\.com|github\.com/i.test(u) && !u.includes("@"),
  );
  // Phone: search the header area only, to avoid grabbing a random number
  // out of a bullet point.
  const phone = firstMatch(lines.slice(0, 12).join("\n"), PHONE_RE);
  const name = guessName(lines);
  const skills = parseSkills(sections.skills, clean);
  const experience = parseExperience(sections.experience);
  const education = parseEducation(sections.education);

  const parsed: Partial<Profile> = {
    identity: {
      ...emptyProfile().identity,
      fullName: name,
      email,
      phone: phone.trim(),
      links: { linkedin: linkedin ? normalizeUrl(linkedin) : "", github: github ? normalizeUrl(github) : "", portfolio: otherUrl ? normalizeUrl(otherUrl) : "", other: [] },
    },
    skills,
    experience,
    education,
    resumeText: clean,
  };

  const found: string[] = [];
  if (name) found.push("name");
  if (email) found.push("email");
  if (phone) found.push("phone");
  if (linkedin) found.push("LinkedIn");
  if (github) found.push("GitHub");
  const skillCount = skills.languages.length + skills.frameworks.length + skills.tools.length + skills.other.length;
  if (skillCount) found.push(`${skillCount} skill${skillCount === 1 ? "" : "s"}`);
  if (experience.length) found.push(`${experience.length} role${experience.length === 1 ? "" : "s"}`);
  if (education.length) found.push(`${education.length} school${education.length === 1 ? "" : "s"}`);

  return { parsed, found };
}

/** Merge a parse result onto the current profile without destroying manual
 *  work: empty scalar fields take the parsed value, arrays union, and the
 *  list sections (experience/education/projects) are only replaced when the
 *  user hasn't added any of their own yet. `resumeText` is always taken from
 *  the import — replacing it is the point of importing. */
export function mergeParsedProfile(current: Profile, parsed: Partial<Profile>): Profile {
  const next: Profile = structuredClone(current);
  const pid = parsed.identity;
  if (pid) {
    const take = (cur: string, inc: string) => (cur.trim() === "" ? inc : cur);
    next.identity.fullName = take(next.identity.fullName, pid.fullName);
    next.identity.email = take(next.identity.email, pid.email);
    next.identity.phone = take(next.identity.phone, pid.phone);
    next.identity.links.linkedin = take(next.identity.links.linkedin, pid.links.linkedin);
    next.identity.links.github = take(next.identity.links.github, pid.links.github);
    next.identity.links.portfolio = take(next.identity.links.portfolio, pid.links.portfolio);
  }
  if (parsed.skills) {
    const u = (a: string[], b: string[]) => {
      const seen = new Set(a.map((x) => x.toLowerCase()));
      return [...a, ...b.filter((x) => !seen.has(x.toLowerCase()))];
    };
    next.skills.languages = u(next.skills.languages, parsed.skills.languages);
    next.skills.frameworks = u(next.skills.frameworks, parsed.skills.frameworks);
    next.skills.tools = u(next.skills.tools, parsed.skills.tools);
    next.skills.other = u(next.skills.other, parsed.skills.other);
  }
  if (parsed.experience && parsed.experience.length > 0 && next.experience.length === 0) {
    next.experience = parsed.experience;
  }
  if (parsed.education && parsed.education.length > 0 && next.education.length === 0) {
    next.education = parsed.education;
  }
  if (typeof parsed.resumeText === "string" && parsed.resumeText.trim() !== "") {
    next.resumeText = parsed.resumeText;
  }
  return next;
}
