import { useEffect, useMemo, useState } from "react";
import { BASE_URL } from "../lib/basePath";
import {
  buildCoverLetter,
  coverLetterToText,
  recommendCoverLetterOptions,
  TEMPLATES,
  TONES,
  type Length,
  type Template,
  type Tone,
} from "../lib/coverLetter";
import { analyzeKeywordGap } from "../lib/keywordGap";
import { emptyProfile, loadProfile, type Profile } from "../lib/profile";
import { listApplications, updateApplication, type TrackedApplication } from "../lib/tracker";

// Phase 4a — templated, offline cover-letter builder. Two modes:
//   • Automatic — generate straight from your résumé (profile) + the JD, no knobs.
//   • Manual    — pick template / tone / length yourself.
// Either way it merges only what the user has typed; anything it can't fill from
// the profile or the "why this company" box stays a visible [bracket]. No AI.

type Mode = "auto" | "manual";

function printLetter(text: string, docTitle: string) {
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  // Browsers seed the "Save as PDF" filename from document.title.
  w.document.title = docTitle;
  const style = w.document.createElement("style");
  style.textContent =
    "body{font:12pt/1.6 Georgia,'Times New Roman',serif;max-width:38em;margin:3em auto;" +
    "padding:0 1em;white-space:pre-wrap;color:#111}@media print{body{margin:1em auto}}";
  w.document.head.appendChild(style);
  w.document.body.textContent = text;
  w.focus();
  setTimeout(() => w.print(), 200);
}

const inputCls =
  "mt-1 w-full rounded-md border border-slate-300 bg-white p-2 text-sm shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 dark:border-slate-700 dark:bg-slate-900";

function Highlighted({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[[^\]]+\])/g).map((part, i) =>
        part.startsWith("[") && part.endsWith("]") ? (
          <mark key={i} className="rounded bg-amber-100 px-0.5 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export default function CoverLetterBuilder() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [apps, setApps] = useState<TrackedApplication[]>([]);
  const [appId, setAppId] = useState("");
  const [mode, setMode] = useState<Mode>("auto");
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [jd, setJd] = useState("");
  const [whyCompany, setWhyCompany] = useState("");
  const [referralName, setReferralName] = useState("");
  const [template, setTemplate] = useState<Template>("concise");
  const [tone, setTone] = useState<Tone>("neutral");
  const [length, setLength] = useState<Length>("half");
  const [flash, setFlash] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadProfile().then((p) => !cancelled && setProfile(p));
    listApplications().then((a) => !cancelled && setApps(a.filter((x) => x.kind === "job")));
    return () => {
      cancelled = true;
    };
  }, []);

  function pickApp(id: string) {
    setAppId(id);
    const a = apps.find((x) => x.id === id);
    if (a) {
      setCompany(a.company);
      setTitle(a.title);
    }
  }

  const p = profile ?? emptyProfile();

  const gap = useMemo(() => (jd.trim() ? analyzeKeywordGap(jd, p) : null), [jd, p]);
  const matchedSkills = gap?.present ?? [];

  // Automatic mode drives the knobs from the profile + JD; manual uses the selects.
  const rec = useMemo(() => recommendCoverLetterOptions(p, jd), [p, jd]);
  const effTemplate = mode === "auto" ? rec.template : template;
  const effTone = mode === "auto" ? rec.tone : tone;
  const effLength = mode === "auto" ? rec.length : length;

  function switchMode(m: Mode) {
    // Hand the recommended settings to the manual selects so it's a smooth switch.
    if (m === "manual" && mode === "auto") {
      setTemplate(rec.template);
      setTone(rec.tone);
      setLength(rec.length);
    }
    setMode(m);
  }

  const letter = useMemo(
    () =>
      buildCoverLetter(
        {
          company,
          title,
          matchedSkills,
          whyCompany,
          referralName,
          template: effTemplate,
          tone: effTone,
          length: effLength,
        },
        p,
      ),
    [company, title, matchedSkills, whyCompany, referralName, effTemplate, effTone, effLength, p],
  );

  const text = coverLetterToText(letter);
  const docTitle = `Cover letter${company.trim() ? ` — ${company.trim()}` : ""}`;

  async function saveToApp() {
    if (!appId) return;
    await updateApplication(appId, { coverLetterUsed: text });
    setFlash("Saved to this application.");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* ---- inputs ---- */}
      <div className="space-y-4">
        <div className="inline-flex rounded-md border border-slate-300 p-0.5 text-sm dark:border-slate-700">
          {(["auto", "manual"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={
                mode === m
                  ? "rounded bg-teal-600 px-3 py-1 font-medium text-white"
                  : "px-3 py-1 text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
              }
            >
              {m === "auto" ? "Automatic" : "Manual"}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {mode === "auto"
            ? "Generated from your résumé and the job description — no settings to touch."
            : "You choose the template, tone, and length."}
        </p>

        {!profile && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            No profile yet — the letter will be mostly brackets.{" "}
            <a className="font-medium underline" href={`${BASE_URL}profile`}>
              Fill in your profile
            </a>{" "}
            first.
          </div>
        )}

        {apps.length > 0 && (
          <label className="block text-sm font-medium">
            Start from a tracked application
            <select className={inputCls} value={appId} onChange={(e) => pickApp(e.target.value)}>
              <option value="">— none / enter manually —</option>
              {apps.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.company} — {a.title}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Company
            <input className={inputCls} value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme" />
          </label>
          <label className="block text-sm font-medium">
            Role title
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Backend Engineer" />
          </label>
        </div>

        <label className="block text-sm font-medium">
          Job description{" "}
          <span className="font-normal text-slate-400">
            {mode === "auto" ? "(this is what makes it a match — paste the full posting)" : "(optional — pulls the skills to mention)"}
          </span>
          <textarea
            className={inputCls}
            rows={5}
            value={jd}
            onChange={(e) => setJd(e.target.value)}
            placeholder="Paste the posting so the letter names the tools it actually asks for…"
          />
          {matchedSkills.length > 0 && (
            <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
              Will mention: {matchedSkills.join(", ")}
            </span>
          )}
        </label>

        <label className="block text-sm font-medium">
          Why this company <span className="font-normal text-slate-400">(your own words — 2–3 sentences)</span>
          <textarea
            className={inputCls}
            rows={3}
            value={whyCompany}
            onChange={(e) => setWhyCompany(e.target.value)}
            placeholder="What actually draws you to them — the product, the team, the problem…"
          />
          <span className="mt-1 block text-xs text-slate-400">
            Left blank, this stays a highlighted prompt — nothing is invented for you.
          </span>
        </label>

        {mode === "auto" ? (
          <p className="rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            Auto-picked: <strong>{TEMPLATES.find((t) => t.id === effTemplate)?.label}</strong> ·{" "}
            {TONES.find((t) => t.id === effTone)?.label} · {effLength === "half" ? "half page" : "full page"}.
            {gap && ` Aligned on ${gap.present.length} skill${gap.present.length === 1 ? "" : "s"} the JD names.`}
            {" "}Switch to <strong>Manual</strong> to change any of it.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-sm font-medium">
                Template
                <select className={inputCls} value={template} onChange={(e) => setTemplate(e.target.value as Template)}>
                  {TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium">
                Tone
                <select className={inputCls} value={tone} onChange={(e) => setTone(e.target.value as Tone)}>
                  {TONES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium">
                Length
                <select className={inputCls} value={length} onChange={(e) => setLength(e.target.value as Length)}>
                  <option value="half">Half page</option>
                  <option value="full">Full page</option>
                </select>
              </label>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">{TEMPLATES.find((t) => t.id === template)?.blurb}</p>

            {template === "referral" && (
              <label className="block text-sm font-medium">
                Referral name
                <input
                  className={inputCls}
                  value={referralName}
                  onChange={(e) => setReferralName(e.target.value)}
                  placeholder="Who pointed you here"
                />
              </label>
            )}
          </>
        )}
      </div>

      {/* ---- preview ---- */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(text);
              setFlash("Copied.");
            }}
            className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700"
          >
            Copy text
          </button>
          <button
            type="button"
            onClick={() => printLetter(text, docTitle)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Download PDF
          </button>
          {appId && (
            <button
              type="button"
              onClick={saveToApp}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              Save to application
            </button>
          )}
        </div>
        <p className="text-xs text-slate-400">
          Download PDF opens your browser's print dialog — choose <em>Save as PDF</em>.
        </p>

        {letter.placeholders.length > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            {letter.placeholders.length} placeholder{letter.placeholders.length === 1 ? "" : "s"} still to fill —
            highlighted below.
          </p>
        )}
        {flash && <p className="text-xs text-emerald-700 dark:text-emerald-300">{flash}</p>}

        <article className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-4 font-serif text-[13px] leading-relaxed text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
          <p>{letter.greeting}</p>
          {letter.paragraphs.map((para, i) => (
            <p key={i} className="mt-3">
              <Highlighted text={para} />
            </p>
          ))}
          <p className="mt-3">{letter.signoff}</p>
          {letter.signature.map((line, i) => (
            <p key={i} className={i === 0 ? "font-semibold" : ""}>
              <Highlighted text={line} />
            </p>
          ))}
        </article>
      </div>
    </div>
  );
}
