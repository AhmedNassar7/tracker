import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LEVEL_VALUES, REGION_VALUES, ROLE_VALUES } from "../lib/filters";
import { fromJsonResumeString, toJsonResumeString } from "../lib/jsonResume";
import {
  clearProfile,
  emptyProfile,
  exportProfile,
  importProfile,
  loadProfile,
  newId,
  profileCompleteness,
  saveProfile,
  type EducationEntry,
  type ExperienceEntry,
  type Profile,
  type ProjectEntry,
} from "../lib/profile";

// Phase 1 of docs/APPLICANT-TOOLKIT-PLAN.md — the unified-profile editor.
// One <Profile> object in state; every edit debounce-saves to IndexedDB
// (profile.ts). No account, no upload, no network. The whole object is
// replaced on each save so there's no merge race to guard against.

const SAVE_DEBOUNCE_MS = 700;

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---- small field primitives ----------------------------------------------

const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
const btnClass =
  "rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900";

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
}) {
  const id = useMemo(() => `f-${label.replace(/\s+/g, "-").toLowerCase()}-${newId().slice(0, 4)}`, [label]);
  return (
    <label htmlFor={id} className="block">
      <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{label}</span>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 ${inputClass}`}
      />
      {hint ? <span className="mt-0.5 block text-xs text-slate-400">{hint}</span> : null}
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  rows = 3,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  hint?: string;
}) {
  const id = useMemo(() => `t-${label.replace(/\s+/g, "-").toLowerCase()}-${newId().slice(0, 4)}`, [label]);
  return (
    <label htmlFor={id} className="block">
      <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{label}</span>
      <textarea
        id={id}
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 ${inputClass}`}
      />
      {hint ? <span className="mt-0.5 block text-xs text-slate-400">{hint}</span> : null}
    </label>
  );
}

/** Comma / Enter to add a chip, Backspace on an empty box removes the last —
 *  the standard tag-input gesture. Values are trimmed and de-duped. */
function TagInput({
  label,
  values,
  onChange,
  placeholder,
  suggestions,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
}) {
  const [draft, setDraft] = useState("");
  const listId = useMemo(() => `dl-${label.replace(/\s+/g, "-").toLowerCase()}`, [label]);

  function commit(raw: string) {
    const next = raw.trim().replace(/,$/, "").trim();
    if (!next) return;
    if (!values.some((v) => v.toLowerCase() === next.toLowerCase())) onChange([...values, next]);
    setDraft("");
  }

  return (
    <div>
      <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{label}</span>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1.5 focus-within:border-teal-600 focus-within:ring-1 focus-within:ring-teal-600 dark:border-slate-700 dark:bg-slate-900">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x !== v))}
              aria-label={`Remove ${v}`}
              className="text-slate-400 hover:text-red-600 dark:hover:text-red-400"
            >
              &times;
            </button>
          </span>
        ))}
        <input
          value={draft}
          list={suggestions ? listId : undefined}
          placeholder={values.length === 0 ? placeholder : undefined}
          onChange={(e) => {
            if (e.target.value.includes(",")) commit(e.target.value);
            else setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(draft);
            } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={() => commit(draft)}
          className="min-w-[8rem] flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
        />
      </div>
      {suggestions ? (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
    </div>
  );
}

/** A checkbox group over a fixed enum (levels / roles / regions) — better than
 *  free text for the values that must line up with the site's own filters. */
function CheckGroup({
  label,
  options,
  values,
  onChange,
}: {
  label: string;
  options: readonly string[];
  values: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div>
      <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{label}</span>
      <div className="mt-1 flex flex-wrap gap-2">
        {options.map((opt) => {
          const on = values.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? values.filter((v) => v !== opt) : [...values, opt])}
              className={
                on
                  ? "rounded-full border border-teal-600 bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-800 dark:border-teal-500 dark:bg-teal-950 dark:text-teal-200"
                  : "rounded-full border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:text-slate-400"
              }
            >
              {titleCase(opt)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{title}</h2>
      {subtitle ? <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p> : null}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

/** Add / remove / reorder for a list of records. Reorder is buttons, not
 *  drag — keyboard-usable and enough for a handful of rows. */
function ListEditor<T extends { id: string }>({
  items,
  onChange,
  makeEmpty,
  addLabel,
  renderRow,
}: {
  items: T[];
  onChange: (v: T[]) => void;
  makeEmpty: () => T;
  addLabel: string;
  renderRow: (item: T, update: (patch: Partial<T>) => void) => React.ReactNode;
}) {
  function move(index: number, dir: -1 | 1) {
    const next = [...items];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={item.id} className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
          <div className="mb-2 flex items-center justify-end gap-1">
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className={`${btnClass} px-2 py-1`}>
              ↑
            </button>
            <button
              type="button"
              onClick={() => move(i, 1)}
              disabled={i === items.length - 1}
              aria-label="Move down"
              className={`${btnClass} px-2 py-1`}
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => onChange(items.filter((x) => x.id !== item.id))}
              className={`${btnClass} px-2 py-1 hover:border-red-300 hover:text-red-600 dark:hover:border-red-800 dark:hover:text-red-400`}
            >
              Remove
            </button>
          </div>
          {renderRow(item, (patch) => onChange(items.map((x) => (x.id === item.id ? { ...x, ...patch } : x))))}
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, makeEmpty()])} className={btnClass}>
        + {addLabel}
      </button>
    </div>
  );
}

function bulletsField(bullets: string[], update: (v: string[]) => void) {
  return (
    <TextArea
      label="Bullet points (one per line)"
      value={bullets.join("\n")}
      onChange={(v) => update(v.split(/\r?\n/))}
      rows={4}
      hint="Each line becomes a bullet. Blank lines are dropped on save."
    />
  );
}

// ---- completeness ring --------------------------------------------------

function Ring({ score }: { score: number }) {
  const R = 18;
  const C = 2 * Math.PI * R;
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true" className="shrink-0">
      <circle cx="22" cy="22" r={R} fill="none" strokeWidth="4" className="stroke-slate-200 dark:stroke-slate-800" />
      <circle
        cx="22"
        cy="22"
        r={R}
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - score)}
        transform="rotate(-90 22 22)"
        className="stroke-teal-600 transition-[stroke-dashoffset] duration-500 dark:stroke-teal-400"
      />
      <text x="22" y="22" dominantBaseline="central" textAnchor="middle" className="fill-slate-700 text-[10px] font-semibold dark:fill-slate-200">
        {Math.round(score * 100)}
      </text>
    </svg>
  );
}

// ---- main --------------------------------------------------------------

type SaveState = "idle" | "saving" | "saved" | "error";

export default function ProfilePanel() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [importError, setImportError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Profile | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadProfile().then((p) => {
      if (cancelled) return;
      if (p) setProfile(p);
      else {
        setProfile(emptyProfile());
        setIsNew(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const flush = useCallback(async () => {
    if (!pending.current) return;
    const toSave = pending.current;
    pending.current = null;
    setSaveState("saving");
    try {
      const stamped = await saveProfile(toSave);
      setProfile((cur) => (cur ? { ...cur, updatedAt: stamped.updatedAt } : cur));
      setSaveState("saved");
      setIsNew(false);
    } catch {
      setSaveState("error");
    }
  }, []);

  // Debounced autosave + a flush on tab-hide / unmount so a quick edit right
  // before navigating away isn't lost.
  const queueSave = useCallback(
    (next: Profile) => {
      pending.current = next;
      setSaveState("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      if (timer.current) clearTimeout(timer.current);
      flush();
    };
  }, [flush]);

  const patch = useCallback(
    (mut: (draft: Profile) => Profile) => {
      setProfile((cur) => {
        if (!cur) return cur;
        const next = mut(cur);
        queueSave(next);
        return next;
      });
    },
    [queueSave],
  );

  const completeness = useMemo(() => (profile ? profileCompleteness(profile) : null), [profile]);

  if (!profile || !completeness) {
    return <p className="py-10 text-center text-slate-500 dark:text-slate-400">Loading your profile…</p>;
  }

  const id = profile.identity;

  function handleImportFile(file: File) {
    setImportError("");
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const parsed = importProfile(text) ?? fromJsonResumeString(text);
      if (!parsed) {
        setImportError("That file isn't a profile or a JSON Resume export we can read.");
        return;
      }
      setProfile(parsed);
      queueSave(parsed);
    };
    reader.onerror = () => setImportError("Couldn't read that file.");
    reader.readAsText(file);
  }

  async function handleErase() {
    const typed = window.prompt('This permanently deletes your profile from this browser. Type "ERASE" to confirm.');
    if (typed !== "ERASE") return;
    await clearProfile();
    setProfile(emptyProfile());
    setIsNew(true);
    setSaveState("idle");
  }

  const saveLabel =
    saveState === "saving"
      ? "Saving…"
      : saveState === "saved"
        ? "All changes saved"
        : saveState === "error"
          ? "Save failed — storage may be disabled"
          : isNew
            ? "Not saved yet"
            : "All changes saved";

  return (
    <div className="space-y-4">
      {/* sticky status + completeness + data controls */}
      <div className="sticky top-0 z-10 -mx-1 rounded-lg border border-slate-200 bg-white/95 p-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="flex flex-wrap items-center gap-3">
          <Ring score={completeness.score} />
          <div className="min-w-[10rem]">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
              Profile {completeness.doneCount}/{completeness.total} sections
            </p>
            <p className={`text-xs ${saveState === "error" ? "text-red-600 dark:text-red-400" : "text-slate-500 dark:text-slate-400"}`}>
              {saveLabel}
            </p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" className={btnClass} onClick={() => downloadFile("tracker-profile.json", exportProfile(profile), "application/json")}>
              Export JSON
            </button>
            <button
              type="button"
              className={btnClass}
              onClick={() => downloadFile("resume.json", toJsonResumeString(profile), "application/json")}
            >
              Export JSON Resume
            </button>
            <button type="button" className={btnClass} onClick={() => fileRef.current?.click()}>
              Import
            </button>
            <button
              type="button"
              onClick={handleErase}
              className={`${btnClass} hover:border-red-300 hover:text-red-600 dark:hover:border-red-800 dark:hover:text-red-400`}
            >
              Erase
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImportFile(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>
        {completeness.doneCount < completeness.total ? (
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            {completeness.sections
              .filter((s) => !s.done)
              .map((s) => (
                <li key={s.key}>• {s.hint}</li>
              ))}
          </ul>
        ) : null}
        {importError ? <p className="mt-2 text-xs text-red-600 dark:text-red-400">{importError}</p> : null}
        <p className="mt-2 text-xs text-slate-400">
          Stored only in this browser (IndexedDB). Nothing is uploaded. Export to move it to another device.
        </p>
      </div>

      <Section title="Basics" subtitle="Your name and how to reach you.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name" value={id.fullName} onChange={(v) => patch((d) => ({ ...d, identity: { ...d.identity, fullName: v } }))} />
          <Field
            label="Headline"
            value={id.headline}
            placeholder="Backend Engineer"
            onChange={(v) => patch((d) => ({ ...d, identity: { ...d.identity, headline: v } }))}
          />
          <Field label="Email" type="email" value={id.email} onChange={(v) => patch((d) => ({ ...d, identity: { ...d.identity, email: v } }))} />
          <Field label="Phone" value={id.phone} onChange={(v) => patch((d) => ({ ...d, identity: { ...d.identity, phone: v } }))} />
          <Field
            label="Location"
            value={id.location}
            placeholder="Cairo, Egypt"
            onChange={(v) => patch((d) => ({ ...d, identity: { ...d.identity, location: v } }))}
          />
        </div>
      </Section>

      <Section title="Links">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="LinkedIn"
            value={id.links.linkedin}
            onChange={(v) => patch((d) => ({ ...d, identity: { ...d.identity, links: { ...d.identity.links, linkedin: v } } }))}
          />
          <Field
            label="GitHub"
            value={id.links.github}
            onChange={(v) => patch((d) => ({ ...d, identity: { ...d.identity, links: { ...d.identity.links, github: v } } }))}
          />
          <Field
            label="Portfolio / website"
            value={id.links.portfolio}
            onChange={(v) => patch((d) => ({ ...d, identity: { ...d.identity, links: { ...d.identity.links, portfolio: v } } }))}
          />
        </div>
      </Section>

      <Section title="Work eligibility" subtitle="Answers to the questions every application form asks.">
        <TagInput
          label="Work authorisation"
          values={profile.eligibility.workAuth}
          onChange={(v) => patch((d) => ({ ...d, eligibility: { ...d.eligibility, workAuth: v } }))}
          placeholder="EU citizen, US F-1 OPT, …"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Need visa sponsorship?</span>
            <select
              className={`mt-1 ${inputClass}`}
              value={profile.eligibility.needsSponsorship === null ? "" : profile.eligibility.needsSponsorship ? "yes" : "no"}
              onChange={(e) =>
                patch((d) => ({
                  ...d,
                  eligibility: { ...d.eligibility, needsSponsorship: e.target.value === "" ? null : e.target.value === "yes" },
                }))
              }
            >
              <option value="">Prefer not to say</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Open to relocation?</span>
            <select
              className={`mt-1 ${inputClass}`}
              value={profile.eligibility.willRelocate === null ? "" : profile.eligibility.willRelocate ? "yes" : "no"}
              onChange={(e) =>
                patch((d) => ({
                  ...d,
                  eligibility: { ...d.eligibility, willRelocate: e.target.value === "" ? null : e.target.value === "yes" },
                }))
              }
            >
              <option value="">Prefer not to say</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <Field
            label="Notice period"
            value={profile.eligibility.noticePeriod}
            placeholder="2 weeks"
            onChange={(v) => patch((d) => ({ ...d, eligibility: { ...d.eligibility, noticePeriod: v } }))}
          />
        </div>
      </Section>

      <Section title="Experience">
        <ListEditor<ExperienceEntry>
          items={profile.experience}
          onChange={(v) => patch((d) => ({ ...d, experience: v }))}
          addLabel="Add a role"
          makeEmpty={() => ({ id: newId(), org: "", title: "", location: "", start: "", end: "", current: false, bullets: [] })}
          renderRow={(item, update) => (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Company / org" value={item.org} onChange={(v) => update({ org: v })} />
                <Field label="Title" value={item.title} onChange={(v) => update({ title: v })} />
                <Field label="Location" value={item.location} onChange={(v) => update({ location: v })} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Start" value={item.start} placeholder="2024" onChange={(v) => update({ start: v })} />
                  <Field label="End" value={item.end} placeholder="Present" onChange={(v) => update({ end: v })} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                <input type="checkbox" checked={item.current} onChange={(e) => update({ current: e.target.checked })} />
                I currently work here
              </label>
              {bulletsField(item.bullets, (v) => update({ bullets: v }))}
            </div>
          )}
        />
      </Section>

      <Section title="Education">
        <ListEditor<EducationEntry>
          items={profile.education}
          onChange={(v) => patch((d) => ({ ...d, education: v }))}
          addLabel="Add a school"
          makeEmpty={() => ({ id: newId(), school: "", degree: "", field: "", start: "", end: "", gpa: "", notes: "" })}
          renderRow={(item, update) => (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="School" value={item.school} onChange={(v) => update({ school: v })} />
              <Field label="Degree" value={item.degree} placeholder="BSc" onChange={(v) => update({ degree: v })} />
              <Field label="Field" value={item.field} placeholder="Computer Science" onChange={(v) => update({ field: v })} />
              <Field label="GPA / grade" value={item.gpa} onChange={(v) => update({ gpa: v })} />
              <Field label="Start" value={item.start} onChange={(v) => update({ start: v })} />
              <Field label="End" value={item.end} onChange={(v) => update({ end: v })} />
              <div className="sm:col-span-2">
                <Field label="Notes" value={item.notes} onChange={(v) => update({ notes: v })} />
              </div>
            </div>
          )}
        />
      </Section>

      <Section title="Projects">
        <ListEditor<ProjectEntry>
          items={profile.projects}
          onChange={(v) => patch((d) => ({ ...d, projects: v }))}
          addLabel="Add a project"
          makeEmpty={() => ({ id: newId(), name: "", url: "", blurb: "", bullets: [] })}
          renderRow={(item, update) => (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name" value={item.name} onChange={(v) => update({ name: v })} />
                <Field label="URL" value={item.url} onChange={(v) => update({ url: v })} />
              </div>
              <Field label="One-line description" value={item.blurb} onChange={(v) => update({ blurb: v })} />
              {bulletsField(item.bullets, (v) => update({ bullets: v }))}
            </div>
          )}
        />
      </Section>

      <Section title="Skills" subtitle="Used by the résumé keyword check to see what a job wants that you have.">
        <TagInput
          label="Languages"
          values={profile.skills.languages}
          onChange={(v) => patch((d) => ({ ...d, skills: { ...d.skills, languages: v } }))}
          placeholder="Python, TypeScript, Go, …"
        />
        <TagInput
          label="Frameworks & libraries"
          values={profile.skills.frameworks}
          onChange={(v) => patch((d) => ({ ...d, skills: { ...d.skills, frameworks: v } }))}
          placeholder="Django, React, …"
        />
        <TagInput
          label="Tools & platforms"
          values={profile.skills.tools}
          onChange={(v) => patch((d) => ({ ...d, skills: { ...d.skills, tools: v } }))}
          placeholder="Docker, AWS, Postgres, …"
        />
        <TagInput
          label="Other"
          values={profile.skills.other}
          onChange={(v) => patch((d) => ({ ...d, skills: { ...d.skills, other: v } }))}
        />
      </Section>

      <Section title="What you're looking for" subtitle="Feeds the “for you” ranking and, later, your job alerts.">
        <CheckGroup
          label="Target levels"
          options={LEVEL_VALUES.filter((l) => l !== "unknown" && l !== "other")}
          values={profile.targets.levels}
          onChange={(v) => patch((d) => ({ ...d, targets: { ...d.targets, levels: v } }))}
        />
        <CheckGroup
          label="Target roles"
          options={ROLE_VALUES}
          values={profile.targets.roles}
          onChange={(v) => patch((d) => ({ ...d, targets: { ...d.targets, roles: v } }))}
        />
        <CheckGroup
          label="Regions"
          options={REGION_VALUES}
          values={profile.targets.regions}
          onChange={(v) => patch((d) => ({ ...d, targets: { ...d.targets, regions: v } }))}
        />
        <TagInput
          label="Countries"
          values={profile.targets.countries}
          onChange={(v) => patch((d) => ({ ...d, targets: { ...d.targets, countries: v } }))}
          placeholder="Egypt, Germany, …"
        />
        <TagInput
          label="Must have"
          values={profile.targets.mustHave}
          onChange={(v) => patch((d) => ({ ...d, targets: { ...d.targets, mustHave: v } }))}
          placeholder="remote, visa sponsorship, …"
        />
        <TagInput
          label="Avoid"
          values={profile.targets.avoid}
          onChange={(v) => patch((d) => ({ ...d, targets: { ...d.targets, avoid: v } }))}
        />
      </Section>

      <Section title="Master answers" subtitle="Save your answer to a question once, copy it into any form.">
        <ListEditor
          items={profile.answers}
          onChange={(v) => patch((d) => ({ ...d, answers: v }))}
          addLabel="Add a question"
          makeEmpty={() => ({ id: newId(), q: "", a: "" })}
          renderRow={(item, update) => (
            <div className="space-y-2">
              <Field label="Question" value={item.q} onChange={(v) => update({ q: v })} placeholder="Why do you want to work here?" />
              <TextArea label="Your answer" value={item.a} onChange={(v) => update({ a: v })} rows={3} />
            </div>
          )}
        />
      </Section>

      <Section title="Résumé text" subtitle="Paste your résumé as plain text. PDF import comes next. Used by the keyword and linter tools; never uploaded.">
        <TextArea
          label="Résumé"
          value={profile.resumeText}
          onChange={(v) => patch((d) => ({ ...d, resumeText: v }))}
          rows={12}
          hint={`${profile.resumeText.trim().length} characters`}
        />
      </Section>
    </div>
  );
}
