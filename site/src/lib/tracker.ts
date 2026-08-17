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

export async function listApplications(): Promise<TrackedApplication[]> {
  const map = await readAll();
  return Object.values(map).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function trackedIdSet(): Promise<Set<string>> {
  const map = await readAll();
  return new Set(Object.keys(map));
}

type TrackableEntry = Pick<SiteIndexEntry, "id" | "kind" | "company" | "title" | "url">;

export async function trackApplication(entry: TrackableEntry): Promise<TrackedApplication> {
  const map = await readAll();
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
  await writeAll(map);
  return record;
}

export async function untrackApplication(id: string): Promise<void> {
  const map = await readAll();
  delete map[id];
  await writeAll(map);
}

export async function updateApplication(
  id: string,
  patch: Partial<Pick<TrackedApplication, "status" | "notes">>,
): Promise<TrackedApplication | undefined> {
  const map = await readAll();
  const existing = map[id];
  if (!existing) return undefined;
  const updated: TrackedApplication = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  map[id] = updated;
  await writeAll(map);
  return updated;
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

export function applicationsToCsv(applications: TrackedApplication[]): string {
  const header = ["company", "title", "status", "kind", "url", "notes", "added_at", "updated_at"];
  const rows = applications.map((app) =>
    [app.company, app.title, STATUS_LABELS[app.status], app.kind, app.url, app.notes, app.addedAt, app.updatedAt]
      .map(csvField)
      .join(","),
  );
  return [header.join(","), ...rows].join("\r\n");
}
