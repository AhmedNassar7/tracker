import {
  emptyProfile,
  newId,
  type EducationEntry,
  type ExperienceEntry,
  type Profile,
  type ProfileSkills,
  type ProjectEntry,
} from "./profile";

// Best-effort résumé-text -> Profile fields. Heuristic, and deliberately
// conservative: everything it produces is shown to the user to confirm or fix
// before it's saved (no-fabrication rule). The full text is always kept in
// `resumeText` — that's what the keyword and cover-letter tools need; the
// structured parse is a convenience on top.
//
// Real résumés don't put blank lines between entries — a new entry begins at
// a fresh header line (a company + a date range, or a "Name | tech" line for
// projects). splitEntries() keys off that, not off blank lines.

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_RE = /\+?\d[\d\s().\-]{7,}\d/;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/[^\s)|,]+/i;
const GITHUB_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/[^\s)|,]+/i;
// Bare or absolute personal-site URL (common TLDs / hosts). Excludes the
// linkedin / github / email domains at the call site.
const SITE_RE =
  /(?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:github\.io|vercel\.app|netlify\.app|pages\.dev|io|com|dev|me|app|net|org|co|ai|xyz|page|site|tech)(?:\/[^\s)|,]*)?/i;

const MONTHS =
  "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december";
const DATE_TOKEN = `(?:(?:${MONTHS})\\.?\\s+)?(?:19|20)\\d{2}`;
const DATE_RANGE_RE = new RegExp(
  `(${DATE_TOKEN})\\s*(?:[–—-]|to)\\s*(${DATE_TOKEN}|present|current|now|ongoing)`,
  "i",
);
// Leading bullet glyph. pdf.js renders symbol-font bullets from all over the
// map: standalone Unicode bullet glyphs, or a dash / asterisk / middot that is
// then followed by whitespace ("- Built X", but not "-5 years").
const BULLET_RE = /^\s*(?:[•‣◦▪▸►●■◆∙‧・]|[·*‐‑–—-]\s)\s*/;
// A trailing "City, Country" — city 1–3 capitalised words, country 1–2.
const CITY_COUNTRY_RE = /([A-Z][A-Za-z.\-']+(?:[\s-][A-Z][A-Za-z.\-']+){0,2},\s*[A-Z][A-Za-z.\-']+(?:\s[A-Z][A-Za-z.\-']+)?)\s*$/;
// Same, but the country must be one we recognise — used where a false strip
// would truncate real content (e.g. a degree's field of study).
const COUNTRY_WORDS =
  "Egypt|USA|U\\.S\\.A?\\.?|United States|UK|U\\.K\\.|United Kingdom|Ireland|Germany|France|Spain|Italy|Netherlands|Portugal|Poland|Sweden|Norway|Denmark|Finland|Switzerland|Austria|Belgium|Greece|Romania|Serbia|Türkiye|Turkey|Israel|UAE|United Arab Emirates|Saudi Arabia|KSA|Qatar|Kuwait|Bahrain|Oman|Jordan|Lebanon|Morocco|Tunisia|Algeria|Nigeria|Kenya|Ghana|South Africa|India|Pakistan|Bangladesh|Singapore|Australia|New Zealand|Canada|Brazil|Mexico|Argentina|Chile|Colombia|Japan|China|Hong Kong|South Korea|Korea|Vietnam|Indonesia|Philippines|Malaysia|Thailand";
// One city word + a known country (a wider city match would eat the last word
// of a two-word field like "Computer Science").
const TRAILING_CITY_COUNTRY_RE = new RegExp(`\\s+[A-Z][A-Za-z.\\-']+,\\s*(?:${COUNTRY_WORDS})\\s*$`);
const WORKMODE_RE = /\b(remote|hybrid|on[- ]?site)\b/i;
const EMP_TYPE_RE =
  /\b(full[\s-]?time|part[\s-]?time|contractor|contract|internship|intern|freelance|volunteer|permanent|temporary|apprenticeship|co[\s-]?op|seasonal|trainee)\b/gi;
const PRESENT_RE = /present|current|now|ongoing/i;

/** Pull the location out of a right-hand column: an explicit work mode, or a
 *  "City, Country", after stripping any employment-type word. */
function pickLocation(text: string): string {
  const t = text.replace(EMP_TYPE_RE, "").replace(/\s{2,}/g, " ").trim();
  const cc = t.match(CITY_COUNTRY_RE);
  if (cc) return cc[1].replace(/\s+/g, " ").trim();
  const wm = t.match(WORKMODE_RE);
  if (wm) return wm[1][0].toUpperCase() + wm[1].slice(1).toLowerCase().replace(/\s/, "-");
  return "";
}

type SectionKey = "summary" | "experience" | "education" | "projects" | "skills" | "other";

const HEADINGS: { key: SectionKey; re: RegExp }[] = [
  { key: "summary", re: /^(summary|profile|professional summary|objective|about(?:\s+me)?)\s*:?\s*$/i },
  { key: "experience", re: /^(?:work|professional|relevant)?\s*experience\s*:?\s*$|^employment(?:\s+history)?\s*:?\s*$/i },
  { key: "education", re: /^education(?:\s+and\s+training)?\s*:?\s*$|^academic\s+background\s*:?\s*$/i },
  { key: "projects", re: /^(?:personal|selected|academic|open[- ]source|key)?\s*projects?\s*:?\s*$/i },
  {
    key: "skills",
    re: /^(?:technical|core|key)?\s*skills(?:\s*(?:&|and)\s*(?:tools|technologies|interests))?\s*:?\s*$|^technologies\s*:?\s*$|^tech\s+stack\s*:?\s*$/i,
  },
  {
    key: "other",
    re: /^(?:achievements?|activities|awards?|honou?rs?|certifications?|licen[cs]es?|publications?|volunteering?|interests|references|leadership|languages)\s*:?\s*$/i,
  },
];

const SKILL_VOCAB: { name: string; bucket: "languages" | "frameworks" | "tools" }[] = [
  ...["JavaScript", "TypeScript", "Python", "Java", "Kotlin", "Swift", "Go", "Rust", "C++", "C#", "C", "Ruby", "PHP", "Scala", "Dart", "R", "MATLAB", "Elixir", "Haskell", "SQL", "Bash", "Shell", "HTML", "CSS", "SCSS"].map((name) => ({ name, bucket: "languages" as const })),
  ...["React", "React Native", "Next.js", "Vue", "Nuxt", "Angular", "Svelte", "Astro", "Node.js", "Express", "NestJS", "Django", "Django REST Framework", "DRF", "Flask", "FastAPI", "Spring", "Spring Boot", "Rails", "Laravel", ".NET", "Flutter", "TensorFlow", "PyTorch", "scikit-learn", "Scikit-learn", "XGBoost", "pandas", "Pandas", "NumPy", "GraphQL", "Redux", "Zustand", "Zod", "TanStack Query", "Tailwind", "Tailwind CSS", "Bootstrap", "jQuery", "Vite", "Selenium", "Playwright", "Workbox", "EmailJS", "Firebase"].map((name) => ({ name, bucket: "frameworks" as const })),
  ...["Docker", "Kubernetes", "AWS", "GCP", "Azure", "Terraform", "Ansible", "Git", "GitHub", "GitHub Actions", "GitLab CI", "Jenkins", "PostgreSQL", "MySQL", "SQLite", "MongoDB", "Redis", "Oracle DB", "MS SQL Server", "Elasticsearch", "Kafka", "RabbitMQ", "Nginx", "Linux", "Jira", "Figma", "Postman", "Swagger", "gRPC", "REST", "RESTful APIs", "CI/CD", "Prometheus", "Grafana", "Snowflake", "Spark", "Airflow"].map((name) => ({ name, bucket: "tools" as const })),
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function normalizeUrl(u: string): string {
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}
function firstMatch(text: string, re: RegExp): string {
  const m = text.match(re);
  return m ? m[0].trim().replace(/[|,;·]+$/, "").trim() : "";
}
/** Split a "A · B, C | D" list into clean tokens. Keeps "CI/CD" whole. */
function splitTokens(s: string): string[] {
  return s
    .split(/\s*[·•|,]\s*|\s{2,}|\s+[–—]\s+/)
    .map((t) => t.trim().replace(/\.$/, ""))
    .filter(Boolean);
}

// ---- header ---------------------------------------------------------------

function guessName(lines: string[]): { name: string; index: number } {
  for (let i = 0; i < Math.min(lines.length, 6); i++) {
    const t = lines[i].trim();
    if (!t || t.length > 60) continue;
    if (EMAIL_RE.test(t) || /https?:\/\/|@|\d/.test(t) || t.includes("|")) continue;
    if (HEADINGS.some((h) => h.re.test(t))) continue;
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 4) continue;
    if (!words.every((w) => /^[A-Za-z][A-Za-z'.\-]*$/.test(w))) continue;
    return { name: t.replace(/\s+/g, " "), index: i };
  }
  return { name: "", index: -1 };
}

function guessHeadline(lines: string[], nameIndex: number): string {
  for (let i = nameIndex + 1; i < Math.min(nameIndex + 3, lines.length); i++) {
    const t = (lines[i] ?? "").trim();
    if (!t || t.length > 55) continue;
    if (EMAIL_RE.test(t) || /https?:\/\/|@|\d{3}|\|/.test(t)) continue;
    if (HEADINGS.some((h) => h.re.test(t))) continue;
    const wc = t.split(/\s+/).length;
    if (wc >= 1 && wc <= 6 && /^[A-Za-z][A-Za-z /&,'\-.]+$/.test(t)) return t;
  }
  return "";
}

function guessLocation(headLines: string[]): string {
  for (const line of headLines) {
    for (const part of line.split(/\s*[|·•]\s*/)) {
      const p = part.trim();
      if (!p || EMAIL_RE.test(p) || /^\+?[\d\s().\-]{7,}$/.test(p) || /https?:\/\//i.test(p)) continue;
      if (/^[A-Z][A-Za-z.\-' ]+,\s*[A-Z][A-Za-z.\-' ]+$/.test(p)) return p.replace(/\s+/g, " ");
    }
  }
  for (const line of headLines) {
    const m = line.match(CITY_COUNTRY_RE);
    if (m && !EMAIL_RE.test(m[1])) return m[1].replace(/\s+/g, " ");
  }
  return "";
}

// ---- entry splitter -----------------------------------------------------

interface RawEntry {
  header: string[];
  bullets: string[];
}

const BARE_DATE_LINE_RE = new RegExp(`^\\s*${DATE_TOKEN}\\s*(?:[–—-]|to)\\s*(?:${DATE_TOKEN}|present|current|now|ongoing)\\s*$`, "i");

function splitEntries(section: string): RawEntry[] {
  const lines = section.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const entries: RawEntry[] = [];
  let cur: RawEntry | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isBullet = BULLET_RE.test(line);
    // A header line either carries the date range / "Name | tech" itself, or
    // is immediately followed by a line that is only a date range (pdf.js
    // often drops a right-aligned date onto its own line).
    const next = lines[i + 1] ?? "";
    const startsEntry =
      !isBullet &&
      (DATE_RANGE_RE.test(line) || / \| /.test(line) || (!BULLET_RE.test(next) && BARE_DATE_LINE_RE.test(next)));
    if (startsEntry && (!cur || cur.bullets.length > 0 || cur.header.length === 0)) {
      cur = { header: [line], bullets: [] };
      entries.push(cur);
    } else if (cur) {
      if (isBullet) cur.bullets.push(line.replace(BULLET_RE, "").replace(/\s{2,}/g, " ").trim());
      else if (cur.bullets.length === 0) cur.header.push(line);
      else cur.bullets[cur.bullets.length - 1] += ` ${line.replace(/\s{2,}/g, " ")}`; // wrapped bullet
    }
  }
  return entries;
}

/** Pull a "Tech: A · B · C" bullet out of the list and return the rest +
 *  the extracted tokens. */
function extractTechBullets(bullets: string[]): { kept: string[]; tech: string[] } {
  const tech: string[] = [];
  const kept = bullets.filter((b) => {
    const m = b.match(/^(?:tech|technologies|tech\s+stack|stack|tools)\s*[:–—-]\s*(.+)$/i);
    if (m) {
      tech.push(...splitTokens(m[1]));
      return false;
    }
    return true;
  });
  return { kept, tech };
}

// ---- sections ---------------------------------------------------------

// Same section keywords, but matched as a *prefix* of the line. pdf.js text
// extraction sometimes glues the first entry onto the heading when their
// baselines are close ("Experience Beshara Group  Nov 2025 – Present"), which
// left whole sections undetected before.
const HEADING_PREFIX: { key: SectionKey; re: RegExp }[] = [
  { key: "summary", re: /^(?:professional\s+)?(?:summary|profile|objective|about(?:\s+me)?)\b/i },
  { key: "experience", re: /^(?:work|professional|relevant)?\s*(?:experience|employment(?:\s+history)?)\b/i },
  { key: "education", re: /^(?:education(?:\s+and\s+training)?|academic\s+background)\b/i },
  { key: "projects", re: /^(?:personal|selected|academic|open[- ]source|key)?\s*projects?\b/i },
  { key: "skills", re: /^(?:technical|core|key)?\s*(?:skills|technologies|tech\s+stack)\b/i },
  {
    key: "other",
    re: /^(?:achievements?|activities|awards?|honou?rs?|certifications?|licen[cs]es?|publications?|volunteering?|leadership|languages)\b/i,
  },
];

function splitSections(lines: string[]): Partial<Record<SectionKey, string>> {
  const marks: { key: SectionKey; at: number; rest: string }[] = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t || t.length > 80 || BULLET_RE.test(t)) return;
    const strict = HEADINGS.find((x) => x.re.test(t));
    if (strict) {
      marks.push({ key: strict.key, at: i, rest: "" });
      return;
    }
    const loose = HEADING_PREFIX.find((x) => x.re.test(t));
    if (!loose) return;
    const rest = t.replace(loose.re, "").replace(/^[\s:–—|-]+/, "").trim();
    // Only a heading if what follows it reads like the start of an entry
    // (a name, a date range, a "Name | tech" line) — not prose, so a Summary
    // sentence beginning "Experience building X…" isn't mistaken for one.
    if (rest === "" || DATE_RANGE_RE.test(rest) || / \| /.test(rest) || /^[A-Z0-9]/.test(rest)) {
      marks.push({ key: loose.key, at: i, rest });
    }
  });
  const out: Partial<Record<SectionKey, string>> = {};
  marks.forEach((mark, idx) => {
    const end = idx + 1 < marks.length ? marks[idx + 1].at : lines.length;
    // First occurrence wins (a résumé rarely repeats a section header).
    if (!(mark.key in out)) {
      const body = lines.slice(mark.at + 1, end).join("\n").trim();
      out[mark.key] = mark.rest ? `${mark.rest}\n${body}` : body;
    }
  });
  return out;
}

/** Break a header line into its left part and an optional right "column"
 *  (a wide gap became a double space in pdfText.ts). */
function cols(line: string): { left: string; right: string } {
  const parts = line.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return { left: line.trim(), right: "" };
  return { left: parts[0], right: parts.slice(1).join(" ") };
}

function parseExperience(section: string | undefined): { entries: ExperienceEntry[]; tech: string[] } {
  if (!section) return { entries: [], tech: [] };
  const allTech: string[] = [];
  const entries = splitEntries(section)
    .slice(0, 15)
    .map((raw): ExperienceEntry => {
      // A right-aligned date range that pdf.js dropped onto its own line isn't
      // the org or the title — keep it for date parsing, drop it from both.
      const hdr = raw.header.filter((h) => !BARE_DATE_LINE_RE.test(h.trim()));
      const line0 = cols(hdr[0] ?? raw.header[0] ?? "");
      const line1 = hdr[1] ? cols(hdr[1]) : { left: "", right: "" };

      // dates: from either column of line 0, else anywhere in the header
      const dm = (line0.right + " " + line0.left + " " + raw.header.join("  ")).match(DATE_RANGE_RE);
      const start = dm ? dm[1].trim() : "";
      const endRaw = dm ? dm[2].trim() : "";
      const current = PRESENT_RE.test(endRaw);

      let org = line0.left.replace(DATE_RANGE_RE, "").replace(/[|•·–—-]\s*$/, "").replace(/\s{2,}/g, " ").trim();
      let location = pickLocation(line0.right) || (DATE_RANGE_RE.test(line0.right) ? "" : pickLocation(line0.left));

      let title = "";
      if (line1.left) {
        title = line1.left.split(/\s+[–—-]\s+/)[0].replace(EMP_TYPE_RE, "").replace(/\s{2,}/g, " ").trim();
        location = location || pickLocation(line1.right) || pickLocation(line1.left);
      } else {
        const bare = line0.left.replace(DATE_RANGE_RE, "").replace(CITY_COUNTRY_RE, "").trim();
        const p = bare.split(/\s*[|,]\s*/);
        title = (p[0] ?? "").trim();
        if (!org && p[1]) org = p[1].trim();
      }

      const { kept, tech } = extractTechBullets(raw.bullets);
      allTech.push(...tech);
      return { id: newId(), org, title, location, start, end: current ? "" : endRaw, current, bullets: kept };
    })
    .filter((e) => e.org || e.title || e.bullets.length > 0);
  return { entries, tech: allTech };
}

function parseEducation(section: string | undefined): EducationEntry[] {
  if (!section) return [];
  return splitEntries(section)
    .slice(0, 8)
    .map((raw): EducationEntry => {
      const dm = raw.header.join("  ").match(DATE_RANGE_RE);
      const start = dm ? dm[1].trim() : "";
      const endRaw = dm ? dm[2].trim() : "";

      const hdr = raw.header.filter((h) => !BARE_DATE_LINE_RE.test(h.trim()));
      const l0 = cols(hdr[0] ?? raw.header[0] ?? "");
      const l1 = hdr[1] ? cols(hdr[1]) : { left: "", right: "" };

      let location = pickLocation(l0.right);
      // Pull (and remember) a trailing "City, Country" that the column split
      // didn't peel off — happens on a plain-text import or a tight layout.
      const takeCity = (s: string): string => {
        const m = s.match(CITY_COUNTRY_RE);
        if (m && !location) location = m[1].trim();
        return m ? s.slice(0, m.index).trim() : s;
      };
      const school = takeCity(l0.left.replace(DATE_RANGE_RE, ""))
        .replace(/[|•·–—-]\s*$/, "")
        .replace(/\s{2,}/g, " ")
        .trim();

      let degree = "";
      let field = "";
      if (l1.left) {
        degree = l1.left.replace(DATE_RANGE_RE, "").replace(/\s{2,}/g, " ").trim();
        location = location || pickLocation(l1.right);
        // "Bachelor of Computer Science  Cairo, Egypt" (single spaces, so
        // cols() couldn't peel the location) — strip a trailing "<City>,
        // <Country>" only when the last token is a recognised country, so a
        // real two-word field like "Computer Science" is never truncated.
        const tc = degree.match(TRAILING_CITY_COUNTRY_RE);
        if (tc && tc.index != null) {
          if (!location) location = degree.slice(tc.index).replace(/^\s+/, "");
          degree = degree.slice(0, tc.index).trim();
        }
        const fm = degree.match(/\b(?:of|in)\s+(.+?)\s*$/i);
        if (fm) field = fm[1].trim();
      }

      let gpa = "";
      const notes: string[] = [];
      const { kept } = extractTechBullets(raw.bullets);
      for (const b of kept) {
        const gm = b.match(
          /\b(?:C?GPA|Grade|Score)\s*[:\-]?\s*([0-4](?:\.\d{1,2})?\s*\/\s*[0-9.]+|[0-4]\.\d{1,2}|[A-F][+\-]?)\b/i,
        );
        if (gm && !gpa) {
          gpa = gm[1].replace(/\s+/g, "");
          continue;
        }
        notes.push(b);
      }
      void location; // captured for future use; EducationEntry has no location field today
      return {
        id: newId(),
        school,
        degree,
        field,
        start,
        end: PRESENT_RE.test(endRaw) ? "" : endRaw,
        gpa,
        notes: notes.join(" · "),
      };
    })
    .filter((e) => e.school);
}

const LINK_WORDS = "github|gitlab|bitbucket|live|demo|source|code|website|link|paper|certificate|cert|slides|video";
const LINK_WORD_RE = new RegExp(`^(?:${LINK_WORDS})$`, "i");
// A résumé's project line ends "…· CSS GitHub | Live" — the last tech token
// absorbs the link label because there's no separator. Strip a trailing run
// of link words (and the leftover separators) off any token.
const TRAILING_LINK_RE = new RegExp(`(?:\\s*[|·•\\-]?\\s*(?:${LINK_WORDS}))+\\s*$`, "i");

function parseProjects(section: string | undefined): { entries: ProjectEntry[]; tech: string[] } {
  if (!section) return { entries: [], tech: [] };
  const allTech: string[] = [];
  const entries = splitEntries(section)
    .slice(0, 15)
    .map((raw): ProjectEntry => {
      const line = raw.header.join(" ");
      const segs = line.split(/\s*\|\s*/);
      const name = (segs[0] ?? "").replace(/\s{2,}/g, " ").trim();
      const techTokens = splitTokens(segs.slice(1).join(" | "))
        .map((t) => t.replace(TRAILING_LINK_RE, "").trim())
        .filter((t) => t && !LINK_WORD_RE.test(t));
      allTech.push(...techTokens);
      const { kept } = extractTechBullets(raw.bullets);
      return {
        id: newId(),
        name,
        url: "",
        blurb: kept[0] ?? "",
        bullets: kept.slice(1),
      };
    })
    .filter((p) => p.name && !LINK_WORD_RE.test(p.name));
  return { entries, tech: allTech };
}

const SKILL_LABELS: { re: RegExp; bucket: keyof ProfileSkills }[] = [
  { re: /programming\s+languages?|^languages?$/i, bucket: "languages" },
  { re: /frameworks?|libraries|front[- ]?end|back[- ]?end/i, bucket: "frameworks" },
  { re: /tools?|platforms?|databases?|dev\s?ops|cloud|infrastructure|technologies/i, bucket: "tools" },
  { re: /concepts?|practices|methodolog|principles|paradigms|soft\s+skills|other/i, bucket: "other" },
];

function parseSkills(section: string | undefined, wholeText: string, extraTech: string[]): ProfileSkills {
  const skills = emptyProfile().skills;
  const seen = new Set<string>();
  const push = (bucket: keyof ProfileSkills, name: string) => {
    const clean = name.trim().replace(/\.$/, "");
    const k = clean.toLowerCase();
    if (!k || clean.length > 40 || seen.has(k)) return;
    if (!/^[A-Za-z0-9][\w +#./&'\-]*$/.test(clean)) return;
    seen.add(k);
    skills[bucket].push(clean);
  };

  if (section) {
    for (const raw of section.split(/\n/).map((l) => l.trim()).filter(Boolean)) {
      const m = raw.match(/^([A-Za-z][A-Za-z /&+]{1,30}):\s*(.+)$/);
      if (m) {
        const bucket = SKILL_LABELS.find((l) => l.re.test(m[1].trim()))?.bucket ?? "other";
        for (const tok of splitTokens(m[2])) push(bucket, tok);
      } else {
        for (const tok of splitTokens(raw)) push("other", tok);
      }
    }
  }
  for (const { name, bucket } of SKILL_VOCAB) {
    if (new RegExp(`(?<![\\w+#.])${escapeRe(name)}(?![\\w+#])`, "i").test(wholeText)) push(bucket, name);
  }
  for (const t of extraTech) {
    const v = SKILL_VOCAB.find((s) => s.name.toLowerCase() === t.toLowerCase());
    push(v?.bucket ?? "other", v?.name ?? t);
  }
  return skills;
}

// ---- top level -------------------------------------------------------

export interface ResumeParseResult {
  parsed: Partial<Profile>;
  found: string[];
}

export function parseResume(text: string): ResumeParseResult {
  const clean = text.replace(/\r\n/g, "\n").replace(/ /g, " ");
  const lines = clean.split(/\n/);
  const sections = splitSections(lines);

  const firstHeadingAt = lines.findIndex((l) => HEADINGS.some((h) => h.re.test(l.trim())));
  const headLines = lines.slice(0, firstHeadingAt > 0 ? firstHeadingAt : 8).map((l) => l.trim());

  const { name, index: nameIdx } = guessName(headLines);
  const headline = nameIdx >= 0 ? guessHeadline(headLines, nameIdx) : "";
  const email = firstMatch(clean, EMAIL_RE);
  const phone = firstMatch(headLines.join("\n"), PHONE_RE).trim();
  const location = guessLocation(headLines);
  const linkedin = firstMatch(clean, LINKEDIN_RE);
  const github = firstMatch(clean, GITHUB_RE);
  const portfolio = (headLines.join(" ").match(new RegExp(SITE_RE, "gi")) ?? []).find(
    (u) => !/linkedin\.com|github\.com|@|gmail\.|outlook\.|yahoo\.|hotmail\./i.test(u),
  );

  const exp = parseExperience(sections.experience);
  const proj = parseProjects(sections.projects);
  const education = parseEducation(sections.education);
  const skills = parseSkills(sections.skills, clean, [...exp.tech, ...proj.tech]);

  const parsed: Partial<Profile> = {
    identity: {
      ...emptyProfile().identity,
      fullName: name,
      headline,
      email,
      phone,
      location,
      links: {
        linkedin: linkedin ? normalizeUrl(linkedin) : "",
        github: github ? normalizeUrl(github) : "",
        portfolio: portfolio ? normalizeUrl(portfolio) : "",
        other: [],
      },
    },
    skills,
    experience: exp.entries,
    education,
    projects: proj.entries,
    // The vault keeps the readable text; the double spaces were only a parsing
    // aid for column detection.
    resumeText: clean.replace(/ {2,}/g, " "),
  };

  const found: string[] = [];
  if (name) found.push("name");
  if (headline) found.push("headline");
  if (email) found.push("email");
  if (phone) found.push("phone");
  if (location) found.push("location");
  if (linkedin) found.push("LinkedIn");
  if (github) found.push("GitHub");
  if (portfolio) found.push("portfolio");
  const skillCount = skills.languages.length + skills.frameworks.length + skills.tools.length + skills.other.length;
  if (skillCount) found.push(`${skillCount} skills`);
  if (exp.entries.length) found.push(`${exp.entries.length} role${exp.entries.length === 1 ? "" : "s"}`);
  if (education.length) found.push(`${education.length} school${education.length === 1 ? "" : "s"}`);
  if (proj.entries.length) found.push(`${proj.entries.length} project${proj.entries.length === 1 ? "" : "s"}`);

  return { parsed, found };
}

/** Merge a parse result onto the current profile without destroying manual
 *  work: empty scalar fields take the parsed value, arrays union, list
 *  sections are only filled when the user has none of their own yet, and
 *  `resumeText` is always taken from the import. */
export function mergeParsedProfile(current: Profile, parsed: Partial<Profile>): Profile {
  const next: Profile = structuredClone(current);
  const pid = parsed.identity;
  if (pid) {
    const take = (cur: string, inc: string) => (cur.trim() === "" ? inc : cur);
    next.identity.fullName = take(next.identity.fullName, pid.fullName);
    next.identity.headline = take(next.identity.headline, pid.headline);
    next.identity.email = take(next.identity.email, pid.email);
    next.identity.phone = take(next.identity.phone, pid.phone);
    next.identity.location = take(next.identity.location, pid.location);
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
  if (parsed.experience && parsed.experience.length > 0 && next.experience.length === 0) next.experience = parsed.experience;
  if (parsed.education && parsed.education.length > 0 && next.education.length === 0) next.education = parsed.education;
  if (parsed.projects && parsed.projects.length > 0 && next.projects.length === 0) next.projects = parsed.projects;
  if (typeof parsed.resumeText === "string" && parsed.resumeText.trim() !== "") next.resumeText = parsed.resumeText;
  return next;
}
