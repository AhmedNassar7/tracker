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

// Phase 4a — templated, offline cover-letter builder. One flow: the letter is
// generated from your résumé (profile) + the pasted JD, with template / tone /
// length auto-picked from what the profile actually carries. Every control is
// visible to override; anything the tool can't fill from your inputs stays a
// visible [bracket]. No network, no AI.

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
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [jd, setJd] = useState("");
  const [whyCompany, setWhyCompany] = useState("");
  const [referralName, setReferralName] = useState("");
  // null = follow the auto recommendation; a value = user override that sticks.
  const [tplOverride, setTplOverride] = useState<Template | null>(null);
  const [toneOverride, setToneOverride] = useState<Tone | null>(null);
  const [lenOverride, setLenOverride] = useState<Length | null>(null);
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

  // Auto-picked from the profile + JD; each control follows this until overridden.
  const rec = useMemo(() => recommendCoverLetterOptions(p, jd), [p, jd]);
  const template = tplOverride ?? rec.template;
  const tone = toneOverride ?? rec.tone;
  const length = lenOverride ?? rec.length;
  const overridden = tplOverride !== null || toneOverride !== null || lenOverride !== null;

  const letter = useMemo(
    () =>
      buildCoverLetter(
        { company, title, matchedSkills, whyCompany, referralName, template, tone, length },
        p,
      ),
    [company, title, matchedSkills, whyCompany, referralName, template, tone, length, p],
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
          Job description <span className="font-normal text-slate-400">(this is what makes it a match — paste the full posting)</span>
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

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm font-medium">
            Template
            <select
              className={inputCls}
              value={template}
              onChange={(e) => setTplOverride(e.target.value as Template)}
            >
              {TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Tone
            <select className={inputCls} value={tone} onChange={(e) => setToneOverride(e.target.value as Tone)}>
              {TONES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Length
            <select className={inputCls} value={length} onChange={(e) => setLenOverride(e.target.value as Length)}>
              <option value="half">Half page</option>
              <option value="full">Full page</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {overridden ? (
            <>
              {TEMPLATES.find((t) => t.id === template)?.blurb}{" "}
              <button
                type="button"
                onClick={() => {
                  setTplOverride(null);
                  setToneOverride(null);
                  setLenOverride(null);
                }}
                className="font-medium text-teal-600 underline hover:text-teal-700 dark:text-teal-400"
              >
                Reset to auto
              </button>
            </>
          ) : (
            <>
              Auto-picked from your résumé{gap ? ` · aligned on ${gap.present.length} skill${gap.present.length === 1 ? "" : "s"} the JD names` : ""}. Change any of these to override.
            </>
          )}
        </p>

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
