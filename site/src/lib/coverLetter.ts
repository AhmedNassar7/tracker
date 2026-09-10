import { deriveYearsOfExperience, type Profile } from "./profile";

// Phase 4a of docs/APPLICANT-TOOLKIT-PLAN.md — the templated, offline cover-letter
// engine. It ONLY ever merges values the user typed (their profile, the role,
// their "why this company" text). Anything it can't fill from those stays a
// visible `[bracketed prompt]` for the user to complete — it never invents an
// achievement, a metric, or a reason. No network, no AI (that's optional 4b).

export type Template = "concise" | "narrative" | "impact" | "referral";
export type Tone = "warm" | "neutral" | "formal";
export type Length = "half" | "full";

export const TEMPLATES: { id: Template; label: string; blurb: string }[] = [
  { id: "concise", label: "Concise", blurb: "Three short paragraphs, straight to the point." },
  { id: "narrative", label: "Narrative", blurb: "A short arc — where you are, why this role, what you bring." },
  { id: "impact", label: "Impact-led", blurb: "Opens with a concrete result from your experience." },
  { id: "referral", label: "Referral", blurb: "Opens by naming the person who pointed you here." },
];

export const TONES: { id: Tone; label: string }[] = [
  { id: "warm", label: "Warm" },
  { id: "neutral", label: "Neutral" },
  { id: "formal", label: "Formal" },
];

export interface CoverLetterInput {
  company: string;
  title: string;
  /** Profile skills the job description also names — the real overlap. */
  matchedSkills: string[];
  /** The user's own words on why this company. */
  whyCompany: string;
  /** Only used by the "referral" template. */
  referralName: string;
  template: Template;
  tone: Tone;
  length: Length;
}

export interface CoverLetter {
  greeting: string;
  paragraphs: string[];
  signoff: string;
  signature: string[];
  /** Distinct `[bracketed]` prompts still in the body — the "N to fill" hint. */
  placeholders: string[];
}

const OPENERS: Record<Tone, string> = {
  warm: "I was excited to see the",
  neutral: "I'm writing to apply for the",
  formal: "I am writing to express my interest in the",
};
const SIGNOFFS: Record<Tone, string> = { warm: "Best,", neutral: "Best regards,", formal: "Sincerely," };
const CLOSERS: Record<Tone, string> = {
  warm: "I'd love the chance to talk it through. Thanks so much for considering me.",
  neutral: "I'd welcome the chance to discuss the role. Thank you for your time and consideration.",
  formal: "I would welcome the opportunity to discuss my application further. Thank you for your consideration.",
};

const COMPANY = (c: string) => c.trim() || "[Company]";
const TITLE = (t: string) => t.trim() || "[the role]";

function list(items: string[]): string {
  const xs = items.filter(Boolean);
  if (xs.length === 0) return "[the tools this role uses]";
  if (xs.length === 1) return xs[0];
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(", ")}, and ${xs[xs.length - 1]}`;
}

function latestRole(p: Profile) {
  return p.experience.find((e) => e.current) ?? p.experience[0];
}

/** A bullet that carries a number — the closest thing to a quantified result. */
function quantifiedBullet(p: Profile): string | null {
  for (const e of p.experience) {
    const b = e.bullets.find((x) => /\d/.test(x));
    if (b) return b.replace(/^[•\-*\s]+/, "").trim();
  }
  for (const pr of p.projects) {
    const b = pr.bullets.find((x) => /\d/.test(x));
    if (b) return b.replace(/^[•\-*\s]+/, "").trim();
  }
  return null;
}

export function buildCoverLetter(input: CoverLetterInput, p: Profile): CoverLetter {
  const company = COMPANY(input.company);
  const title = TITLE(input.title);
  const role = latestRole(p);
  const roleAt = role?.org ? ` at ${role.org}` : "";
  const skills = list(input.matchedSkills);
  const yoe = deriveYearsOfExperience(p.experience);
  const yoePhrase = yoe >= 1 ? `about ${yoe} year${yoe === 1 ? "" : "s"}` : "the past couple of years";
  const why = input.whyCompany.trim();
  const companyForPrompt = input.company.trim() || "this company";
  const whyPara =
    why || `[Why ${companyForPrompt} — a few sentences on what draws you to the team, the product, or the mission.]`;
  const win = quantifiedBullet(p);
  // The fit paragraph names one concrete contribution — but not the same bullet
  // the "impact" opener already led with, or the letter repeats itself.
  const roleBullets = (role?.bullets ?? []).map((b) => b.replace(/^[•\-*\s]+/, "").trim()).filter(Boolean);
  const usedAsOpener = input.template === "impact" ? win : null;
  const rawContribution =
    roleBullets.find((b) => b !== usedAsOpener) ||
    (usedAsOpener ? "[another concrete thing you shipped or owned there]" : "[a concrete thing you shipped or owned there]");
  // Reads as "At Acme, built X" — lowercase the leading verb after the comma.
  const contribution =
    role?.org && !rawContribution.startsWith("[")
      ? rawContribution.charAt(0).toLowerCase() + rawContribution.slice(1)
      : rawContribution;

  const paragraphs: string[] = [];

  if (input.template === "referral") {
    const who = input.referralName.trim() || "[name]";
    paragraphs.push(
      `${who} suggested I get in touch about the ${title} role${company !== "[Company]" ? ` at ${company}` : ""}. ` +
        `Having heard about the team from ${who.split(" ")[0] || "them"}, I was keen to apply.`,
    );
  } else if (input.template === "impact") {
    const opener = win || "[a result you're proud of — with a number]";
    paragraphs.push(
      `${opener}. That's the kind of work I want to keep doing, which is why I'm applying for the ${title} role at ${company}.`,
    );
  } else if (input.template === "narrative") {
    paragraphs.push(
      `${OPENERS[input.tone]} ${title} role at ${company}. I've spent ${yoePhrase}${roleAt} working on ` +
        `${skills}, and this looks like the kind of problem I want to spend the next few years on.`,
    );
  } else {
    paragraphs.push(`${OPENERS[input.tone]} ${title} role at ${company}, and I think it's a strong fit.`);
  }

  // Fit paragraph — the skills overlap + one concrete contribution.
  paragraphs.push(
    `The role calls for ${skills}, which is most of what I work with day to day. ` +
      `${role?.org ? `At ${role.org}, ` : ""}${contribution}${/[.!?]$/.test(contribution) ? "" : "."}`,
  );

  // Why-this-company paragraph.
  paragraphs.push(whyPara);

  // Full length gets a short "what I'd bring" paragraph before the close.
  if (input.length === "full") {
    paragraphs.push(
      `Beyond the checklist, I care about [what you value in how a team works — e.g. code review, shipping small, owning outcomes]. ` +
        `I'd bring that to the ${title} role from day one.`,
    );
  }

  paragraphs.push(CLOSERS[input.tone]);

  const signature = [
    p.identity.fullName.trim() || "[Your name]",
    p.identity.headline.trim(),
    [p.identity.email.trim(), p.identity.phone.trim()].filter(Boolean).join(" · "),
    [p.identity.links.linkedin.trim(), p.identity.links.github.trim()].filter(Boolean).join(" · "),
  ].filter(Boolean);

  const body = paragraphs.join("\n\n");
  const placeholders = Array.from(new Set(body.match(/\[[^\]]+\]/g) ?? []));

  return {
    greeting: input.tone === "formal" ? "Dear Hiring Manager," : "Dear Hiring Team,",
    paragraphs,
    signoff: SIGNOFFS[input.tone],
    signature,
    placeholders,
  };
}

/**
 * "Automatic" mode: pick sensible template/tone/length from what the profile and
 * JD actually contain, so the user can generate without touching a single knob.
 * Never returns "referral" — that needs a name only the user has.
 */
export function recommendCoverLetterOptions(
  p: Profile,
  jd: string,
): { template: Template; tone: Tone; length: Length } {
  const hasQuantified = quantifiedBullet(p) != null;
  const expCount = p.experience.length;
  const template: Template = hasQuantified ? "impact" : expCount >= 1 ? "narrative" : "concise";
  const length: Length = expCount >= 2 && jd.trim().length > 1200 ? "full" : "half";
  return { template, tone: "neutral", length };
}

export function coverLetterToText(cl: CoverLetter): string {
  return [cl.greeting, "", cl.paragraphs.join("\n\n"), "", cl.signoff, ...cl.signature].join("\n");
}

export function coverLetterToMarkdown(cl: CoverLetter): string {
  return [
    cl.greeting,
    "",
    cl.paragraphs.join("\n\n"),
    "",
    cl.signoff,
    "",
    cl.signature.map((l, i) => (i === 0 ? `**${l}**` : l)).join("  \n"),
  ].join("\n");
}
