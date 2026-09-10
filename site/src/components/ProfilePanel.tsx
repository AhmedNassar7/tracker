import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LEVEL_VALUES, REGION_VALUES, REMOTE_VALUES, ROLE_VALUES } from "../lib/filters";
import { fromJsonResumeString } from "../lib/jsonResume";
import { extractPdfText } from "../lib/pdfText";
import { mergeParsedProfile, parseResume } from "../lib/resumeParse";
import {
  clearProfile,
  deriveYearsOfExperience,
  emptyProfile,
  exportProfile,
  importProfile,
  loadProfile,
  newId,
  profileCompleteness,
  saveProfile,
  type Completeness,
  type EducationEntry,
  type ExperienceEntry,
  type Profile,
  type ProjectEntry,
} from "../lib/profile";

// Phase 1 of docs/APPLICANT-TOOLKIT-PLAN.md — the unified-profile editor.
// One <Profile> object in state; every edit debounce-saves to IndexedDB
// (profile.ts). No account, no upload, no network. The whole object is
// replaced on each save so there's no merge race to guard against.
//
// The fast path is "drop your résumé" at the top: a client-side PDF/text
// parse pre-fills what it can read (contact, links, skills, a rough pass at
// roles) and the full text is kept for the keyword tools. Manual entry —
// chips, pill toggles, short fields — is the fallback, not the default.

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
  "rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900";

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  hint,
  suggestions,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
  /** Renders a <datalist> — the field stays free text, but the browser
   *  offers these as you type, nudging toward consistent values. */
  suggestions?: string[];
}) {
  const id = useMemo(() => `f-${label.replace(/\s+/g, "-").toLowerCase()}-${newId().slice(0, 4)}`, [label]);
  const listId = suggestions ? `${id}-list` : undefined;
  return (
    <label htmlFor={id} className="block">
      <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{label}</span>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        list={listId}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 ${inputClass}`}
      />
      {listId ? (
        <datalist id={listId}>
          {suggestions!.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
      {hint ? <span className="mt-0.5 block text-xs text-slate-400">{hint}</span> : null}
    </label>
  );
}

const DEGREE_SUGGESTIONS = [
  "Bachelor of Science",
  "Bachelor of Engineering",
  "Bachelor of Computer Science",
  "Master of Science",
  "Master of Engineering",
  "MBA",
  "PhD",
  "Diploma",
  "Associate Degree",
  "Bootcamp Certificate",
];
const FIELD_SUGGESTIONS = [
  "Computer Science",
  "Software Engineering",
  "Computer Engineering",
  "Information Technology",
  "Data Science",
  "Information Systems",
  "Electrical Engineering",
  "Mathematics",
];
const SKILL_POOL: Record<"languages" | "frameworks" | "tools", string[]> = {
  languages: ["Python", "JavaScript", "TypeScript", "Java", "C++", "C#", "Go", "Rust", "Kotlin", "Swift", "SQL", "PHP", "Ruby", "HTML", "CSS"],
  frameworks: ["React", "Next.js", "Vue", "Angular", "Svelte", "Node.js", "Express", "Django", "Flask", "FastAPI", "Spring Boot", ".NET", "Rails", "Flutter", "React Native", "TensorFlow", "PyTorch"],
  tools: ["Docker", "Kubernetes", "AWS", "GCP", "Azure", "Git", "GitHub Actions", "Terraform", "PostgreSQL", "MySQL", "MongoDB", "Redis", "Kafka", "Linux", "Jira", "Postman", "GraphQL", "CI/CD"],
};

/** One-tap chips for the common values of a facet — click to add. Anything
 *  not in the pool is still typeable in the field above. */
function Suggest({ pool, values, onAdd }: { pool: string[]; values: string[]; onAdd: (v: string) => void }) {
  const have = new Set(values.map((v) => v.toLowerCase()));
  const rest = pool.filter((p) => !have.has(p.toLowerCase())).slice(0, 14);
  if (rest.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {rest.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onAdd(p)}
          className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-xs text-slate-500 transition-colors hover:border-teal-500 hover:text-teal-700 dark:border-slate-600 dark:text-slate-400 dark:hover:border-teal-500 dark:hover:text-teal-300"
        >
          + {p}
        </button>
      ))}
    </div>
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
              className="text-slate-400 transition-colors hover:text-red-600 dark:hover:text-red-400"
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
                "rounded-full border px-2.5 py-1 text-xs transition-colors " +
                (on
                  ? "border-teal-600 bg-teal-50 font-medium text-teal-800 dark:border-teal-500 dark:bg-teal-950 dark:text-teal-200"
                  : "border-slate-300 text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:text-slate-400")
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

/** Collapsible card. Closed by default (except where `defaultOpen`) so the
 *  page reads as a short checklist, not a wall of inputs. A small tick shows
 *  which sections the completeness meter already counts as done. */
function Section({
  title,
  subtitle,
  done,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  done?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useMemo(() => `sec-${title.replace(/\s+/g, "-").toLowerCase()}`, [title]);
  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center gap-2 rounded-lg px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-900"
      >
        <span
          aria-hidden="true"
          className={
            "text-xs text-slate-400 motion-safe:transition-transform motion-safe:duration-200 " + (open ? "rotate-90" : "")
          }
        >
          ▶
        </span>
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{title}</span>
        {done ? (
          <span className="text-teal-600 dark:text-teal-400" title="Counted as complete" aria-label="complete">
            ✓
          </span>
        ) : null}
      </button>
      <div id={bodyId} hidden={!open} className="border-t border-slate-200 px-4 py-3 dark:border-slate-800">
        {subtitle ? <p className="-mt-1 mb-3 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p> : null}
        <div className="space-y-3">{children}</div>
      </div>
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
        className="stroke-teal-600 motion-safe:transition-[stroke-dashoffset] motion-safe:duration-500 dark:stroke-teal-400"
      />
      <text x="22" y="22" dominantBaseline="central" textAnchor="middle" className="fill-slate-700 text-[10px] font-semibold dark:fill-slate-200">
        {Math.round(score * 100)}
      </text>
    </svg>
  );
}

// ---- résumé import card ----------------------------------------------

function ImportCard({
  busy,
  onFile,
}: {
  busy: boolean;
  onFile: (file: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={
        "rounded-lg border-2 border-dashed p-5 text-center transition-colors " +
        (drag
          ? "border-teal-500 bg-teal-50 dark:border-teal-400 dark:bg-teal-950"
          : "border-slate-300 dark:border-slate-700")
      }
    >
      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">Start from your résumé</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">
        Drop your résumé here — <strong>PDF</strong> or plain text. It's read in your browser;
        nothing is uploaded. We fill in what we can and you fix the rest. You can also drop a
        backup file to restore a saved profile.
      </p>
      <button type="button" onClick={() => ref.current?.click()} disabled={busy} className={`mt-3 ${btnClass}`}>
        {busy ? "Reading…" : "Choose a file"}
      </button>
      <input
        ref={ref}
        type="file"
        accept=".pdf,.txt,.md,.json,application/pdf,application/json,text/plain,text/markdown"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

// ---- main --------------------------------------------------------------

type SaveState = "idle" | "saving" | "saved" | "error";

const SECTION_DONE = (c: Completeness, key: string) => c.sections.find((s) => s.key === key)?.done ?? false;

export default function ProfilePanel() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [importBusy, setImportBusy] = useState(false);
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

  const handleFile = useCallback(
    async (file: File) => {
      setNotice(null);
      const name = file.name.toLowerCase();
      try {
        if (name.endsWith(".json")) {
          const text = await file.text();
          const parsed = importProfile(text) ?? fromJsonResumeString(text);
          if (!parsed) {
            setNotice({ kind: "err", text: "That .json isn't a profile or a JSON Resume export we can read." });
            return;
          }
          setProfile(parsed);
          queueSave(parsed);
          setNotice({ kind: "ok", text: "Profile loaded from file." });
          return;
        }
        setImportBusy(true);
        let text: string;
        if (name.endsWith(".pdf") || file.type === "application/pdf") {
          text = await extractPdfText(file);
        } else {
          text = await file.text();
        }
        if (!text.trim()) {
          setNotice({ kind: "err", text: "Couldn't get any text out of that file — if it's a scanned PDF, paste the text instead." });
          return;
        }
        const { parsed, found } = parseResume(text);
        setProfile((cur) => {
          const base = cur ?? emptyProfile();
          const merged = mergeParsedProfile(base, parsed);
          queueSave(merged);
          return merged;
        });
        setNotice({
          kind: "ok",
          text:
            found.length > 0
              ? `Imported from your résumé: ${found.join(", ")}. Full text saved. Check each section below and fix anything that's off.`
              : "Résumé text saved. We couldn't confidently pull structured fields — fill the sections below.",
        });
      } catch (err) {
        setNotice({ kind: "err", text: `Couldn't read that file${err instanceof Error ? ` (${err.message})` : ""}.` });
      } finally {
        setImportBusy(false);
      }
    },
    [queueSave],
  );

  if (!profile || !completeness) {
    return <p className="py-10 text-center text-slate-500 dark:text-slate-400">Loading your profile…</p>;
  }

  const id = profile.identity;

  async function handleErase() {
    const typed = window.prompt('This permanently deletes your profile from this browser. Type "ERASE" to confirm.');
    if (typed !== "ERASE") return;
    await clearProfile();
    setProfile(emptyProfile());
    setIsNew(true);
    setSaveState("idle");
    setNotice(null);
  }

  const saveLabel =
    saveState === "saving"
      ? "Saving…"
      : saveState === "error"
        ? "Save failed — storage may be disabled"
        : isNew
          ? "Not saved yet"
          : "All changes saved";

  return (
    <div className="space-y-4">
      <ImportCard busy={importBusy} onFile={handleFile} />

      {notice ? (
        <p
          className={
            "rounded-md border px-3 py-2 text-xs " +
            (notice.kind === "ok"
              ? "border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900 dark:bg-teal-950 dark:text-teal-200"
              : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300")
          }
        >
          {notice.text}
        </p>
      ) : null}

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
            <button
              type="button"
              className={btnClass}
              title="Save a file with everything on this page. Keep it as a backup, or drop it on the box above to load your profile on another browser or device."
              onClick={() => downloadFile("my-profile-backup.json", exportProfile(profile), "application/json")}
            >
              Download a copy
            </button>
            <button
              type="button"
              onClick={handleErase}
              title="Permanently delete this profile from this browser."
              className={`${btnClass} hover:border-red-300 hover:text-red-600 dark:hover:border-red-800 dark:hover:text-red-400`}
            >
              Delete
            </button>
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
        <p className="mt-2 text-xs text-slate-400">
          Everything here is stored only in this browser — nothing is uploaded. Use{" "}
          <span className="font-medium">Download a copy</span> to keep a backup or move your profile to
          another browser (drop the file on the box above to load it back).
        </p>
      </div>

      <Section title="Basics" subtitle="Your name and how to reach you." done={SECTION_DONE(completeness, "name") && SECTION_DONE(completeness, "contact")} defaultOpen>
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

      <Section title="Links" done={SECTION_DONE(completeness, "links")}>
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

      <Section
        title="Work eligibility"
        subtitle="Answers every application form asks — and used to score how well a job fits you."
        done={SECTION_DONE(completeness, "eligibility")}
      >
        <TagInput
          label="Work authorisation"
          values={profile.eligibility.workAuth}
          onChange={(v) => patch((d) => ({ ...d, eligibility: { ...d.eligibility, workAuth: v } }))}
          placeholder="EU citizen, US F-1 OPT, …"
        />
        <TagInput
          label="Countries you can work in without sponsorship"
          values={profile.eligibility.authorizedCountries}
          onChange={(v) => patch((d) => ({ ...d, eligibility: { ...d.eligibility, authorizedCountries: v } }))}
          placeholder="Egypt, Germany, …"
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
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Have a degree?</span>
            <select
              className={`mt-1 ${inputClass}`}
              value={profile.eligibility.hasDegree === null ? "" : profile.eligibility.hasDegree ? "yes" : "no"}
              onChange={(e) =>
                patch((d) => ({
                  ...d,
                  eligibility: { ...d.eligibility, hasDegree: e.target.value === "" ? null : e.target.value === "yes" },
                }))
              }
            >
              <option value="">Prefer not to say</option>
              <option value="yes">Yes (or graduating soon)</option>
              <option value="no">No / in progress</option>
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

      <Section title="Experience" done={SECTION_DONE(completeness, "experience")}>
        {profile.experience.length > 0 && deriveYearsOfExperience(profile.experience) > 0 && (
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
            From your dates below, that's about{" "}
            <strong>{deriveYearsOfExperience(profile.experience)} year(s)</strong> of experience — used
            to check roles that ask for a minimum. Overlapping dates can inflate it slightly.
          </p>
        )}
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

      <Section title="Education" done={SECTION_DONE(completeness, "education")}>
        <ListEditor<EducationEntry>
          items={profile.education}
          onChange={(v) => patch((d) => ({ ...d, education: v }))}
          addLabel="Add a school"
          makeEmpty={() => ({ id: newId(), school: "", degree: "", field: "", start: "", end: "", gpa: "", notes: "" })}
          renderRow={(item, update) => (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="School" value={item.school} onChange={(v) => update({ school: v })} />
              <Field
                label="Degree"
                value={item.degree}
                placeholder="Bachelor of Science"
                suggestions={DEGREE_SUGGESTIONS}
                onChange={(v) => update({ degree: v })}
              />
              <Field
                label="Field"
                value={item.field}
                placeholder="Computer Science"
                suggestions={FIELD_SUGGESTIONS}
                onChange={(v) => update({ field: v })}
              />
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

      <Section
        title="Skills"
        subtitle="Tap the common ones, type anything else. Used to match a job's stack to yours."
        done={SECTION_DONE(completeness, "skills")}
      >
        <div>
          <TagInput
            label="Languages"
            values={profile.skills.languages}
            onChange={(v) => patch((d) => ({ ...d, skills: { ...d.skills, languages: v } }))}
            placeholder="type to add…"
          />
          <Suggest
            pool={SKILL_POOL.languages}
            values={profile.skills.languages}
            onAdd={(s) => patch((d) => ({ ...d, skills: { ...d.skills, languages: [...d.skills.languages, s] } }))}
          />
        </div>
        <div>
          <TagInput
            label="Frameworks & libraries"
            values={profile.skills.frameworks}
            onChange={(v) => patch((d) => ({ ...d, skills: { ...d.skills, frameworks: v } }))}
            placeholder="type to add…"
          />
          <Suggest
            pool={SKILL_POOL.frameworks}
            values={profile.skills.frameworks}
            onAdd={(s) => patch((d) => ({ ...d, skills: { ...d.skills, frameworks: [...d.skills.frameworks, s] } }))}
          />
        </div>
        <div>
          <TagInput
            label="Tools & platforms"
            values={profile.skills.tools}
            onChange={(v) => patch((d) => ({ ...d, skills: { ...d.skills, tools: v } }))}
            placeholder="type to add…"
          />
          <Suggest
            pool={SKILL_POOL.tools}
            values={profile.skills.tools}
            onAdd={(s) => patch((d) => ({ ...d, skills: { ...d.skills, tools: [...d.skills.tools, s] } }))}
          />
        </div>
        <TagInput
          label="Other"
          values={profile.skills.other}
          onChange={(v) => patch((d) => ({ ...d, skills: { ...d.skills, other: v } }))}
        />
      </Section>

      <Section title="What you're looking for" subtitle="Feeds the “for you” ranking and, later, your job alerts." done={SECTION_DONE(completeness, "targets")}>
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
        <CheckGroup
          label="Work type"
          options={REMOTE_VALUES.filter((r) => r !== "unknown")}
          values={profile.targets.remotes}
          onChange={(v) => patch((d) => ({ ...d, targets: { ...d.targets, remotes: v } }))}
        />
        <TagInput
          label="Dream companies"
          values={profile.targets.companies}
          onChange={(v) => patch((d) => ({ ...d, targets: { ...d.targets, companies: v } }))}
          placeholder="Stripe, Careem, Vercel, …"
        />
        <div>
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Minimum pay (optional)</span>
          <div className="mt-1 flex flex-wrap gap-2">
            <input
              type="number"
              min={0}
              step={1000}
              value={profile.targets.minSalary ?? ""}
              placeholder="e.g. 60000"
              onChange={(e) =>
                patch((d) => ({
                  ...d,
                  targets: { ...d.targets, minSalary: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) },
                }))
              }
              aria-label="Minimum pay amount"
              className={`w-36 ${inputClass}`}
            />
            <select
              value={profile.targets.salaryCurrency}
              onChange={(e) => patch((d) => ({ ...d, targets: { ...d.targets, salaryCurrency: e.target.value } }))}
              aria-label="Currency"
              className={`w-24 ${inputClass}`}
            >
              {["USD", "EUR", "GBP", "AED", "SAR", "EGP", "INR", "CAD", "AUD"].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={profile.targets.salaryPeriod}
              onChange={(e) =>
                patch((d) => ({ ...d, targets: { ...d.targets, salaryPeriod: e.target.value as "year" | "month" | "hour" } }))
              }
              aria-label="Per"
              className={`w-28 ${inputClass}`}
            >
              <option value="year">per year</option>
              <option value="month">per month</option>
              <option value="hour">per hour</option>
            </select>
          </div>
          <span className="mt-0.5 block text-xs text-slate-400">
            Only compared against a posting when it discloses pay in the same currency.
          </span>
        </div>
        <TagInput
          label="Must have"
          values={profile.targets.mustHave}
          onChange={(v) => patch((d) => ({ ...d, targets: { ...d.targets, mustHave: v } }))}
          placeholder="4-day week, mentorship, …"
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

      <Section
        title="Résumé text"
        subtitle="Filled automatically when you import a résumé above. Used by the keyword and linter tools; never uploaded."
        done={SECTION_DONE(completeness, "resume")}
      >
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
