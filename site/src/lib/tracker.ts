import { get, set } from "idb-keyval";
import type { SiteIndexEntry, SiteIndexKind } from "./types";

// IndexedDB, not localStorage — a year of tracked applications with notes
// can outgrow localStorage's ~5MB-ish ceiling; IndexedDB doesn't have that
// ceiling. Local-first by design: no backend exists anywhere in this
// project, so this is the only place tracked-application data lives unless
// the user exports it themselves (see toCsv/toJson below).

export type ApplicationStatus = "bookmarked" | "applied" | "oa" | "interview" | "offer" | "rejected";

export const APPLICATION_STATUSES: readonly ApplicationStatus[] = [
  "bookmarked",
  "applied",
  "oa",
  "interview",
  "offer",
  "rejected",
];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  bookmarked: "Bookmarked",
  applied: "Applied",
  oa: "Online Assessment",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
};

export interface TrackedApplication {
  id: string;
  kind: SiteIndexKind;
  company: string;
  title: string;
  url: string;
  status: ApplicationStatus;
  notes: string;
  addedAt: string;
  updatedAt: string;
}

type ApplicationMap = Record<string, TrackedApplication>;

const STORE_KEY = "tracker:applications";

async function readAll(): Promise<ApplicationMap> {
  return (await get<ApplicationMap>(STORE_KEY)) ?? {};
}

async function writeAll(map: ApplicationMap): Promise<void> {
  await set(STORE_KEY, map);
}

// Every mutation below is a read-modify-write against the same key, and
// idb-keyval's get/set aren't transactional across that gap. Two calls
// fired close together (e.g. bookmarking two different jobs in quick
// succession, or a status change racing a notes blur-save) would otherwise
// interleave and the second write would silently clobber the first's
// change — real data loss for the one place this data lives. Chaining
// every mutation onto a single module-level promise serializes them
// without needing real IndexedDB transactions.
let writeQueue: Promise<unknown> = Promise.resolve();

function enqueueMutation<T>(mutate: (map: ApplicationMap) => T | Promise<T>): Promise<T> {
  const result = writeQueue.then(async () => {
    const map = await readAll();
    const value = await mutate(map);
    await writeAll(map);
    return value;
  });
  // Swallow rejections in the queue chain itself so one failed mutation
  // doesn't permanently wedge every mutation queued after it; the actual
  // error still propagates to the caller of this specific call via `result`.
  writeQueue = result.catch(() => undefined);
  return result;
}

export async function listApplications(): Promise<TrackedApplication[]> {
  const map = await readAll();
  return Object.values(map).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

type TrackableEntry = Pick<SiteIndexEntry, "id" | "kind" | "company" | "title" | "url">;

export function trackApplication(entry: TrackableEntry): Promise<TrackedApplication> {
  return enqueueMutation((map) => {
    const now = new Date().toISOString();
    const record: TrackedApplication = map[entry.id] ?? {
      id: entry.id,
      kind: entry.kind,
      company: entry.company,
      title: entry.title,
      url: entry.url,
      status: "bookmarked",
      notes: "",
      addedAt: now,
      updatedAt: now,
    };
    map[entry.id] = record;
    return record;
  });
}

export function untrackApplication(id: string): Promise<void> {
  return enqueueMutation((map) => {
    delete map[id];
  });
}

export function updateApplication(
  id: string,
  patch: Partial<Pick<TrackedApplication, "status" | "notes">>,
): Promise<TrackedApplication | undefined> {
  return enqueueMutation((map) => {
    const existing = map[id];
    if (!existing) return undefined;
    const updated: TrackedApplication = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    map[id] = updated;
    return updated;
  });
}

export function applicationsToJson(applications: TrackedApplication[]): string {
  return JSON.stringify(applications, null, 2);
}

// Deliberately minimal CSV writer (no library) — the field set is small
// and fully under this module's control, so a hand-rolled RFC 4180 quote
// pass covers every real input without pulling in a dependency for it.
function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

// Leading UTF-8 BOM: without it, Excel (the most common consumer of an
// exported CSV) guesses the wrong encoding for any non-ASCII character in
// a company or job title and renders it as mojibake. Built from a char
// code rather than typed as a literal invisible character in source, so
// it can't be silently stripped or mangled by an editor/tool that doesn't
// render invisible codepoints.
const UTF8_BOM = String.fromCharCode(0xfeff);

export function applicationsToCsv(applications: TrackedApplication[]): string {
  const header = ["company", "title", "status", "kind", "url", "notes", "added_at", "updated_at"];
  const rows = applications.map((app) =>
    [app.company, app.title, STATUS_LABELS[app.status], app.kind, app.url, app.notes, app.addedAt, app.updatedAt]
      .map(csvField)
      .join(","),
  );
  return UTF8_BOM + [header.join(","), ...rows].join("\r\n");
}
