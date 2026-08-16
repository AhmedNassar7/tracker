import { useEffect, useState } from "react";
import { fetchSiteIndex } from "../lib/dataSource";
import type { SiteIndex, SiteIndexEntry } from "../lib/types";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; data: SiteIndex };

const KIND_LABEL: Record<SiteIndexEntry["kind"], string> = {
  job: "Job",
  hackathon: "Hackathon",
  event: "Event",
};

function formatGeneratedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

// The curated layer renders multi-location postings as an HTML
// <details>/<summary> dropdown for the markdown tables (see
// format_location_display in scripts/fetch.py). This walking skeleton
// doesn't have that dropdown UI yet, so strip the markup rather than
// showing raw tags as visible text — a real expandable control is Tier 0
// polish, tracked separately.
function formatLocation(location: string): string {
  if (!location) return "—";
  return location
    .replace(/<summary>/gi, "")
    .replace(/<\/summary>/gi, ": ")
    .replace(/<\/?details>/gi, "")
    .replace(/<\/?strong>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export default function OpportunityTable() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchSiteIndex()
      .then((data) => {
        if (!cancelled) setState({ status: "loaded", data });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Unknown error",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return <p className="py-10 text-center text-slate-500">Loading opportunities…</p>;
  }

  if (state.status === "error") {
    return (
      <p className="py-10 text-center text-red-600">
        Couldn't load listings right now ({state.message}). Try refreshing, or browse{" "}
        <a
          className="underline"
          href="https://github.com/AhmedNassar7/tracker/blob/main/data/README.md"
        >
          data/README.md
        </a>{" "}
        directly.
      </p>
    );
  }

  const { data } = state;

  return (
    <div>
      <p className="mb-4 text-sm text-slate-500">
        {data.count.toLocaleString()} opportunities · data as of{" "}
        {formatGeneratedAt(data.generated_at)}
      </p>
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Kind</th>
              <th className="px-3 py-2">Level</th>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2">Age</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
              <tr key={item.id} className="border-t border-slate-200 hover:bg-slate-50">
                <td className="px-3 py-2 font-medium text-slate-900">{item.company}</td>
                <td className="px-3 py-2">
                  <a
                    className="text-teal-700 underline-offset-2 hover:underline"
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {item.title}
                  </a>
                </td>
                <td className="px-3 py-2 text-slate-500">{KIND_LABEL[item.kind]}</td>
                <td className="px-3 py-2 text-slate-500">{item.level ?? "—"}</td>
                <td className="px-3 py-2 text-slate-500">{formatLocation(item.location)}</td>
                <td className="px-3 py-2 text-slate-500">{item.age || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
