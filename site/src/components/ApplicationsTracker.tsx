import { useEffect, useState } from "react";
import { BASE_URL } from "../lib/basePath";
import {
  APPLICATION_STATUSES,
  applicationsToCsv,
  applicationsToJson,
  listApplications,
  STATUS_LABELS,
  untrackApplication,
  updateApplication,
  type ApplicationStatus,
  type TrackedApplication,
} from "../lib/tracker";

type LoadState = { status: "loading" } | { status: "loaded"; applications: TrackedApplication[] };

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

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

export default function ApplicationsTracker() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    listApplications().then((applications) => {
      if (!cancelled) setState({ status: "loaded", applications });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleStatusChange(id: string, status: ApplicationStatus) {
    if (state.status !== "loaded") return;
    setState({
      status: "loaded",
      applications: state.applications.map((app) => (app.id === id ? { ...app, status } : app)),
    });
    await updateApplication(id, { status });
  }

  function handleNotesChange(id: string, notes: string) {
    if (state.status !== "loaded") return;
    setState({
      status: "loaded",
      applications: state.applications.map((app) => (app.id === id ? { ...app, notes } : app)),
    });
  }

  // Persisted on blur, not on every keystroke — an IndexedDB write per
  // character would be wasted work for something the user reads back
  // rarely, and the in-memory state above already keeps the textarea
  // responsive in the meantime.
  async function handleNotesBlur(id: string, notes: string) {
    await updateApplication(id, { notes });
  }

  async function handleRemove(id: string) {
    if (state.status !== "loaded") return;
    const app = state.applications.find((a) => a.id === id);
    if (!app) return;
    if (!window.confirm(`Remove ${app.company} — ${app.title} from your tracked applications? This can't be undone.`)) {
      return;
    }
    setState({ status: "loaded", applications: state.applications.filter((a) => a.id !== id) });
    await untrackApplication(id);
  }

  if (state.status === "loading") {
    return (
      <p className="py-10 text-center text-slate-500 dark:text-slate-400">
        Loading your tracked applications…
      </p>
    );
  }

  const { applications } = state;

  if (applications.length === 0) {
    return (
      <p className="py-10 text-center text-slate-500 dark:text-slate-400">
        No tracked applications yet. Bookmark a job from the{" "}
        <a href={BASE_URL} className="text-teal-700 underline-offset-2 hover:underline dark:text-teal-400">
          listings
        </a>{" "}
        to get started.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {applications.length} tracked, stored only on this device.
        </p>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() =>
              downloadFile("tracker-applications.json", applicationsToJson(applications), "application/json")
            }
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => downloadFile("tracker-applications.csv", applicationsToCsv(applications), "text/csv")}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"
          >
            Export CSV
          </button>
        </div>
      </div>

      <ul className="space-y-3">
        {applications.map((app) => (
          <li key={app.id} className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <a
                  href={app.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-teal-700 underline-offset-2 hover:underline dark:text-teal-400"
                >
                  {app.company} — {app.title}
                </a>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Added {formatDate(app.addedAt)} · updated {formatDate(app.updatedAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={app.status}
                  onChange={(e) => handleStatusChange(app.id, e.target.value as ApplicationStatus)}
                  aria-label={`Status for ${app.company} — ${app.title}`}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                >
                  {APPLICATION_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleRemove(app.id)}
                  aria-label={`Remove ${app.company} — ${app.title} from tracked applications`}
                  className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-500 hover:border-red-300 hover:text-red-600 dark:border-slate-700 dark:text-slate-400 dark:hover:border-red-800 dark:hover:text-red-400"
                >
                  Remove
                </button>
              </div>
            </div>
            <textarea
              value={app.notes}
              onChange={(e) => handleNotesChange(app.id, e.target.value)}
              onBlur={(e) => handleNotesBlur(app.id, e.target.value)}
              placeholder="Notes…"
              rows={2}
              aria-label={`Notes for ${app.company} — ${app.title}`}
              className="mt-2 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
