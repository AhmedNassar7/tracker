import type { Profile } from "./profile";

// Résumé keyword-gap check (docs/APPLICANT-TOOLKIT-PLAN.md Phase 5a / Lane R2).
//
// A LITERAL TEXT DIFF — no LLM, no upload, no fabrication. Paste a job
// description, and this reports which tech skills it names, which of those are
// already on your profile, and which are missing. The score is a plain ratio
// with its rubric shown, never a black-box number.
//
// TECH_TAG_PATTERNS / detectTechTags / detectRequirements below are a
// hand-kept TypeScript MIRROR of `TECH_TAG_PATTERNS` / `detect_tech_tags` /
// `detect_requirements` in scripts/patterns.py — same canonical tag names, same
// order (first-match-wins so "React Native" is never also reported as "React"),
// same requirement wording. The site and the pipeline must agree on what a JD
// "asks for", so when one side changes the other must too. tests/test_patterns.py
// has a parity check that fails if the canonical tag list here drifts from the
// Python one — same discipline as formatSalaryShort in labels.ts.

/** Canonical display tag -> matcher. Ordered: a more specific tech is tested
 *  before a token it contains. Keep in lock-step with scripts/patterns.py. */
const TECH_TAG_PATTERNS: [string, RegExp][] = [
  ["React Native", /\breact[ -]native\b/i],
  ["React", /\breact(?:\.?js)?\b(?!\s+native)/i],
  ["Next.js", /\bnext\.js\b/i],
  ["Vue.js", /\bvue(?:\.?js)?\b/i],
  ["Angular", /\bangular(?:js)?\b/i],
  ["Svelte", /\bsvelte(?:kit)?\b/i],
  ["Node.js", /\bnode\.?js\b/i],
  ["TypeScript", /\btype[ -]?script\b/i],
  ["JavaScript", /\bjava[ -]?script\b|\bes6\b/i],
  ["Python", /\bpython\b/i],
  ["Django", /\bdjango\b/i],
  ["Flask", /\bflask\b/i],
  ["FastAPI", /\bfast ?api\b/i],
  ["Java", /\bjava\b(?!\s*script)/i],
  ["Spring", /\bspring\s*(?:boot|framework|mvc|cloud)\b/i],
  ["Kotlin", /\bkotlin\b/i],
  ["Swift", /\bswift ?ui\b|\bswift\b(?=\s*(?:developer|engineer|programming|programmer|language|code\b))/i],
  ["Objective-C", /\bobjective[ -]?c\b/i],
  [
    "Go",
    /\bgolang\b|\b(?:in|with|using|know|knows|learn)\s+go\b|\bwritten\s+in\s+go\b|\bgo\s*\(\s*golang\s*\)|\bgo\s+lang\b|\bgo\b(?=\s+(?:developer|engineer|programmer|programming|routines?|micro-?services?|services)\b)|[,\/]\s*go\s*[,\/]|\b(?:and|or|,|\/)\s*go\b(?=\s*[.,;)\/]|\s*$)/i,
  ],
  ["Rust", /\brust\b(?!\s*(?:belt|ic|y|ling))/i],
  ["C++", /c\+\+/i],
  ["C#", /\bc#|\bc[ -]sharp\b/i],
  [".NET", /\.net\b|\bdotnet\b|\basp\.net\b/i],
  ["Ruby on Rails", /\bruby[ -]on[ -]rails\b|\brails\b/i],
  ["Ruby", /\bruby\b(?!\s*on\s*rails)/i],
  ["PHP", /\bphp\b|\blaravel\b/i],
  ["Scala", /\bscala\b/i],
  ["Elixir", /\belixir\b|\bphoenix framework\b/i],
  ["GraphQL", /\bgraph ?ql\b/i],
  ["gRPC", /\bgrpc\b/i],
  ["Kubernetes", /\bkubernetes\b|\bk8s\b/i],
  ["Docker", /\bdocker\b|\bcontainerd\b/i],
  ["Terraform", /\bterraform\b/i],
  ["AWS", /\baws\b|\bamazon web services\b/i],
  ["GCP", /\bgcp\b|\bgoogle cloud\b/i],
  ["Azure", /\bazure\b/i],
  ["PostgreSQL", /\bpostgres(?:ql)?\b/i],
  ["MySQL", /\bmysql\b/i],
  ["MongoDB", /\bmongo(?:db)?\b/i],
  ["Redis", /\bredis\b/i],
  ["Kafka", /\bkafka\b/i],
  ["Spark", /\bapache spark\b|\bpy ?spark\b/i],
  ["TensorFlow", /\btensor ?flow\b/i],
  ["PyTorch", /\bpy ?torch\b/i],
  ["SQL", /\bsql\b/i],
];

/** The canonical tag names, in order. The parity test in
 *  tests/test_patterns.py asserts this equals the Python list. */
export const CANONICAL_TECH_TAGS: string[] = TECH_TAG_PATTERNS.map(([tag]) => tag);

/** Which profile skills bucket an "Add to profile" click should file a tag
 *  under. Tags not listed here fall back to `other`. */
const TAG_BUCKET: Record<string, keyof Profile["skills"]> = {
  JavaScript: "languages",
  TypeScript: "languages",
  Python: "languages",
  Java: "languages",
  Kotlin: "languages",
  Swift: "languages",
  Go: "languages",
  Rust: "languages",
  "C++": "languages",
  "C#": "languages",
  Ruby: "languages",
  PHP: "languages",
  Scala: "languages",
  Elixir: "languages",
  "Objective-C": "languages",
  SQL: "languages",
  "React Native": "frameworks",
  React: "frameworks",
  "Next.js": "frameworks",
  "Vue.js": "frameworks",
  Angular: "frameworks",
  Svelte: "frameworks",
  "Node.js": "frameworks",
  Django: "frameworks",
  Flask: "frameworks",
  FastAPI: "frameworks",
  Spring: "frameworks",
  ".NET": "frameworks",
  "Ruby on Rails": "frameworks",
  GraphQL: "frameworks",
  TensorFlow: "frameworks",
  PyTorch: "frameworks",
  Spark: "frameworks",
  gRPC: "tools",
  Kubernetes: "tools",
  Docker: "tools",
  Terraform: "tools",
  AWS: "tools",
  GCP: "tools",
  Azure: "tools",
  PostgreSQL: "tools",
  MySQL: "tools",
  MongoDB: "tools",
  Redis: "tools",
  Kafka: "tools",
};

export function bucketForTag(tag: string): keyof Profile["skills"] {
  return TAG_BUCKET[tag] ?? "other";
}

/** Ordered, de-duplicated canonical tech tags explicitly named in `text`.
 *  First-match-wins over TECH_TAG_PATTERNS. Mirror of patterns.detect_tech_tags. */
export function detectTechTags(text: string): string[] {
  if (!text) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  for (const [tag, rx] of TECH_TAG_PATTERNS) {
    if (seen.has(tag)) continue;
    if (rx.test(text)) {
      found.push(tag);
      seen.add(tag);
    }
  }
  return found;
}

const VISA_NEGATIVE_RE =
  /\b(?:no|not|unable|cannot|can['’]?t|will\s+not|won['’]?t|do(?:es)?\s+not|are\s+not\s+able)\b[^.\n]{0,40}\b(?:sponsor(?:ship)?|visa)\b|\bwithout\s+(?:visa\s+)?sponsorship\b|\bsponsorship\s+(?:is\s+)?not\s+(?:available|offered|provided)\b|\bnot\s+(?:able|eligible)\s+to\s+sponsor\b|\bmust\s+(?:be\s+)?(?:legally\s+)?authoriz|authoris\w*\s+to\s+work[^.\n]{0,40}\bwithout\b/i;
const VISA_POSITIVE_RE =
  /\bvisa\s+sponsorship\b|\bsponsor(?:ship)?\s+(?:a\s+|the\s+)?(?:visa|work\s+permit|candidates?|applicants?|employees?)\b|\bwill(?:ing\s+to)?\s+sponsor\b|\bsponsorship\s+(?:is\s+)?(?:available|offered|provided)\b|\bwe\s+(?:can\s+|do\s+|will\s+)?sponsor\b|\bh-?1b\s+sponsor|\bvisa\s+support\b|\brelocation\s+and\s+visa\b|\beligible\s+for\s+(?:visa\s+)?sponsorship\b|\bprovide\s+(?:visa\s+)?sponsorship\b/i;
const NO_DEGREE_RE =
  /\bno\s+degree\s+(?:required|necessary|needed)\b|\bdegree\s+(?:is\s+)?not\s+(?:required|necessary|needed)\b|\bwithout\s+a\s+(?:college\s+|university\s+)?degree\b|\bin\s+lieu\s+of\s+a\s+degree\b|\bor\s+equivalent\s+practical\s+experience\b|\bdo(?:es)?\s+not\s+require\s+a\s+degree\b|\bdegree[- ]optional\b/i;
const DEGREE_REQUIRED_RE =
  /\b(?:bachelor['’]?s?|master['’]?s?|b\.?s\.?c?\.?|m\.?s\.?c?\.?|ph\.?\s?d\.?|bs\/ms|undergraduate\s+degree)\b[^.\n]{0,60}\b(?:is\s+)?(?:required|mandatory|a\s+must)\b|\brequires?\s+(?:a\s+|an\s+)?(?:bachelor|master|degree|ph\.?\s?d|bs\b|ms\b)|\bmust\s+(?:have|possess|hold)\s+(?:a\s+|an\s+)?(?:bachelor|master|degree)|\bminimum\s+(?:of\s+)?(?:a\s+)?(?:bachelor|master)['’]?s?\b/i;
const RELOCATION_NEGATIVE_RE = /\bno\s+relocation\b|\brelocation\s+(?:is\s+)?not\s+(?:available|offered|provided)\b/i;
const RELOCATION_POSITIVE_RE =
  /\brelocation\s+(?:assistance|package|support|benefits?|bonus|allowance|stipend|provided|offered|available)\b|\b(?:assistance|help|support)\s+with\s+relocat|\bwe(?:['’]ll|\s+will)?\s+(?:help\s+you\s+)?relocat|\bwilling\s+to\s+relocate\s+you\b/i;

export interface JdRequirements {
  visaSponsorship?: boolean;
  degreeRequired?: boolean;
  relocation?: boolean;
}

/** Work-authorisation / education / relocation facets a JD is EXPLICIT about.
 *  Only present keys are returned; a silent JD yields `{}`. Mirror of
 *  patterns.detect_requirements. */
export function detectRequirements(text: string): JdRequirements {
  const out: JdRequirements = {};
  if (!text) return out;
  if (VISA_NEGATIVE_RE.test(text)) out.visaSponsorship = false;
  else if (VISA_POSITIVE_RE.test(text)) out.visaSponsorship = true;
  if (NO_DEGREE_RE.test(text)) out.degreeRequired = false;
  else if (DEGREE_REQUIRED_RE.test(text)) out.degreeRequired = true;
  if (RELOCATION_NEGATIVE_RE.test(text)) out.relocation = false;
  else if (RELOCATION_POSITIVE_RE.test(text)) out.relocation = true;
  return out;
}

// ---- the gap analysis -----------------------------------------------------

export interface RequirementCheck {
  label: string;
  status: "ok" | "warn" | "info";
  detail: string;
}

export interface RubricLine {
  label: string;
  ok: boolean;
}

export interface KeywordGapResult {
  /** Every canonical tech tag the JD names. */
  jdTags: string[];
  /** JD tags already on your profile (skills or résumé text). */
  present: string[];
  /** JD tags on neither your skills nor your résumé text — the real gaps. */
  missing: string[];
  /** The subset of `missing` that DOES appear in your résumé text — you have
   *  it, it's just not in your structured skills, so offer a one-tap add. */
  missingInResume: string[];
  /** Canonical tags you list that this JD never mentions — informational. */
  extra: string[];
  /** Degree / visa / relocation checks against your eligibility. */
  requirements: RequirementCheck[];
  /** 0–100 skill coverage (present / jdTags), or `null` when the JD names no
   *  tech at all — then a keyword score would be meaningless. */
  score: number | null;
  /** The transparent breakdown behind the headline — shown, not hidden. */
  rubric: RubricLine[];
  /** True when the pasted text was too short to be a real JD. */
  tooShort: boolean;
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function profileSkillList(p: Profile): string[] {
  return [...p.skills.languages, ...p.skills.frameworks, ...p.skills.tools, ...p.skills.other];
}

function bulletsWithNumbers(p: Profile): number {
  const bullets = [
    ...p.experience.flatMap((e) => e.bullets),
    ...p.projects.flatMap((pr) => pr.bullets),
  ];
  return bullets.filter((b) => /\d/.test(b)).length;
}

export function analyzeKeywordGap(jdText: string, profile: Profile): KeywordGapResult {
  const jd = (jdText || "").trim();
  const tooShort = jd.length < 80;

  const jdTags = detectTechTags(jd);
  const skillTags = detectTechTags(profileSkillList(profile).join(" · "));
  const resumeTags = detectTechTags(profile.resumeText);
  const haveTags = new Set([...skillTags, ...resumeTags]);
  const resumeTagSet = new Set(resumeTags);

  const present = jdTags.filter((t) => haveTags.has(t));
  const missing = jdTags.filter((t) => !haveTags.has(t));
  const missingInResume = missing.filter((t) => resumeTagSet.has(t));
  const extra = skillTags.filter((t) => !jdTags.includes(t));

  const req = detectRequirements(jd);
  const requirements: RequirementCheck[] = [];
  const el = profile.eligibility;

  if (req.degreeRequired === true) {
    if (el.hasDegree === false)
      requirements.push({
        label: "Degree",
        status: "warn",
        detail: "This role requires a degree, and your profile says you don't have one.",
      });
    else if (el.hasDegree === true)
      requirements.push({ label: "Degree", status: "ok", detail: "Degree requirement met." });
    else
      requirements.push({
        label: "Degree",
        status: "info",
        detail: "A degree is required — set it under Eligibility to check.",
      });
  } else if (req.degreeRequired === false) {
    requirements.push({ label: "Degree", status: "info", detail: "No degree required for this role." });
  }

  if (el.needsSponsorship === true) {
    if (req.visaSponsorship === true)
      requirements.push({ label: "Visa", status: "ok", detail: "This role offers visa sponsorship." });
    else if (req.visaSponsorship === false)
      requirements.push({
        label: "Visa",
        status: "warn",
        detail: "This role states it does not sponsor visas, and you marked that you need it.",
      });
    else
      requirements.push({
        label: "Visa",
        status: "info",
        detail: "No sponsorship mentioned — worth confirming, since you marked that you need it.",
      });
  } else if (req.visaSponsorship === true) {
    requirements.push({ label: "Visa", status: "info", detail: "This role offers visa sponsorship." });
  }

  if (req.relocation === true) {
    requirements.push({
      label: "Relocation",
      status: el.willRelocate === true ? "ok" : "info",
      detail: "Relocation support is offered.",
    });
  }

  const quantified = bulletsWithNumbers(profile);
  const rubric: RubricLine[] = [
    {
      label:
        jdTags.length > 0
          ? `${present.length} of ${jdTags.length} tech skills the JD names are on your profile`
          : "The JD names no specific tech skills to match",
      ok: jdTags.length === 0 || present.length / jdTags.length >= 0.7,
    },
    { label: `Résumé text saved (${profile.resumeText.trim().length} chars)`, ok: profile.resumeText.trim().length >= 200 },
    { label: "Contact details present in résumé text", ok: EMAIL_RE.test(profile.resumeText) },
    { label: `${quantified} quantified bullet${quantified === 1 ? "" : "s"} in experience / projects`, ok: quantified >= 1 },
  ];

  const score = jdTags.length > 0 ? Math.round((present.length / jdTags.length) * 100) : null;

  return { jdTags, present, missing, missingInResume, extra, requirements, score, rubric, tooShort };
}
