import { useEffect, useMemo, useState } from "react";
import { BASE_URL } from "../lib/basePath";
import { analyzeKeywordGap, bucketForTag, type KeywordGapResult } from "../lib/keywordGap";
import { emptyProfile, loadProfile, saveProfile, type Profile } from "../lib/profile";

// Lane R2 / APPLICANT-TOOLKIT-PLAN Phase 5a — paste a job description, diff the
// tech skills it names against your saved profile. Pure client-side text diff:
// no upload, no LLM, no network. The score is a shown ratio, not a mystery number.

const EXAMPLE_JD = `Backend Engineer (New Grad)

We're looking for an early-career backend engineer to join our platform team.

What you'll do:
- Build and operate services in Go and Python behind a GraphQL API
- Work with PostgreSQL and Redis, and help move workloads onto Kubernetes
- Ship with Docker, Terraform, and AWS

What we're looking for:
- Familiarity with at least one of Go, Python, or Java
- Exposure to SQL databases and containerised deployments
- A Bachelor's degree in Computer Science or equivalent practical experience

We offer visa sponsorship and relocation assistance for the right candidate.`;

type LoadState =
  | { status: "loading" }
  | { status: "ready"; profile: Profile; hasProfile: boolean };

function Chip({ label, tone }: { label: string; tone: "present" | "missing" | "extra" }) {
  const cls =
    tone === "present"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300"
      : tone === "missing"
        ? "bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300"
        : "bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${cls}`}>
      {label}
    </span>
  );
}

export default function ResumeGapCheck() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [jd, setJd] = useState("");
  const [analyzed, setAnalyzed] = useState<KeywordGapResult | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadProfile().then((p) => {
      if (cancelled) return;
      setState({ status: "ready", profile: p ?? emptyProfile(), hasProfile: p != null });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const profile = state.status === "ready" ? state.profile : emptyProfile();

  const result = useMemo(() => {
    if (!analyzed) return null;
    // Re-run against the (possibly updated) profile so "Add to profile" moves
    // a tag from Missing to Present live.
    return analyzeKeywordGap(jd, profile);
  }, [analyzed, jd, profile]);

  function handleAnalyze() {
    setAdded(new Set());
    setFlash("");
    setAnalyzed(analyzeKeywordGap(jd, profile));
  }

  async function handleAdd(tag: string) {
    if (state.status !== "ready") return;
    const bucket = bucketForTag(tag);
    const current = state.profile.skills[bucket];
    if (current.some((s) => s.toLowerCase() === tag.toLowerCase())) return;
    const next: Profile = {
      ...state.profile,
      skills: { ...state.profile.skills, [bucket]: [...current, tag] },
    };
    setState({ status: "ready", profile: next, hasProfile: true });
    setAdded((prev) => new Set(prev).add(tag));
    setFlash(`Added ${tag} to your ${bucket}.`);
    await saveProfile(next);
  }

  if (state.status === "loading") {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Loading your profile…</p>;
  }

  return (
    <div className="space-y-6">
      {!state.hasProfile && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          You haven't saved a profile yet. The check still runs, but it can only tell you what a
          job asks for — not what you already have. {" "}
          <a className="font-medium underline" href={`${BASE_URL}profile`}>
            Fill in your profile
          </a>{" "}
          (skills and résumé text) to get the gap.
        </div>
      )}

      <div>
        <label htmlFor="jd" className="block text-sm font-medium">
          Paste a job description
        </label>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          The full posting works best — the requirements and "about the role" sections are where
          the skills live.
        </p>
        <textarea
          id="jd"
          value={jd}
          onChange={(e) => setJd(e.target.value)}
          rows={10}
          placeholder="Paste the full job description here…"
          className="mt-2 w-full rounded-md border border-slate-300 bg-white p-3 text-sm shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 dark:border-slate-700 dark:bg-slate-900"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={jd.trim().length === 0}
            className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Check the gap
          </button>
          <button
            type="button"
            onClick={() => setJd(EXAMPLE_JD)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Load an example
          </button>
          {jd.trim().length > 0 && (
            <button
              type="button"
              onClick={() => {
                setJd("");
                setAnalyzed(null);
              }}
              className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {result && (
        <div className="space-y-6">
          {result.tooShort && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              That's quite short for a job description — the result may be thin. Paste the full
              posting for a better read.
            </p>
          )}

          {result.jdTags.length > 0 ? (
            <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">Skill coverage</h2>
                <span className="text-2xl font-semibold tabular-nums">
                  {result.score}
                  <span className="text-sm font-normal text-slate-500">/100</span>
                </span>
              </div>
              <ul className="mt-3 space-y-1.5 text-xs">
                {result.rubric.map((line, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className={line.ok ? "text-emerald-600" : "text-slate-400"}>
                      {line.ok ? "✓" : "•"}
                    </span>
                    <span className={line.ok ? "" : "text-slate-500 dark:text-slate-400"}>{line.label}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                The score is just <em>present ÷ skills the JD names</em>. It is not a verdict on
                your résumé.
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              This posting doesn't name any specific technologies we recognise, so there's no
              keyword gap to show. The requirement checks below still apply.
            </p>
          )}

          {result.jdTags.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  In the JD &amp; on your profile ({result.present.length})
                </h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {result.present.length === 0 ? (
                    <span className="text-xs text-slate-400">None yet</span>
                  ) : (
                    result.present.map((t) => <Chip key={t} label={t} tone="present" />)
                  )}
                </div>
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  In the JD, missing from your profile ({result.missing.length})
                </h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {result.missing.length === 0 ? (
                    <span className="text-xs text-slate-400">Nothing missing — nice.</span>
                  ) : (
                    result.missing.map((t) => {
                      const inResume = result.missingInResume.includes(t);
                      const isAdded = added.has(t);
                      return (
                        <span key={t} className="inline-flex items-center gap-1">
                          <Chip label={t} tone={isAdded ? "present" : "missing"} />
                          {inResume && !isAdded && (
                            <button
                              type="button"
                              onClick={() => handleAdd(t)}
                              title={`"${t}" is in your résumé text but not your skills list`}
                              className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                              + add
                            </button>
                          )}
                        </span>
                      );
                    })
                  )}
                </div>
                {result.missingInResume.length > 0 && (
                  <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                    “+ add” appears for skills already in your résumé text — one tap files them in
                    your profile skills.
                  </p>
                )}
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  On your profile, not in this JD ({result.extra.length})
                </h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {result.extra.length === 0 ? (
                    <span className="text-xs text-slate-400">—</span>
                  ) : (
                    result.extra.map((t) => <Chip key={t} label={t} tone="extra" />)
                  )}
                </div>
              </div>
            </div>
          )}

          {result.requirements.length > 0 && (
            <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
              <h3 className="text-sm font-semibold">Requirements</h3>
              <ul className="mt-2 space-y-1.5 text-xs">
                {result.requirements.map((r, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      className={
                        r.status === "ok"
                          ? "text-emerald-600"
                          : r.status === "warn"
                            ? "text-rose-600"
                            : "text-slate-400"
                      }
                    >
                      {r.status === "ok" ? "✓" : r.status === "warn" ? "!" : "•"}
                    </span>
                    <span>
                      <span className="font-medium">{r.label}:</span> {r.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {flash && <p className="text-xs text-emerald-700 dark:text-emerald-300">{flash}</p>}
        </div>
      )}
    </div>
  );
}
