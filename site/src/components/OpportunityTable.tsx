import BookmarkButton from "./BookmarkButton";
import CompanyAvatar from "./CompanyAvatar";
import type { SiteIndexEntry } from "../lib/types";

const KIND_LABEL: Record<SiteIndexEntry["kind"], string> = {
  job: "Job",
  hackathon: "Hackathon",
  event: "Event",
};

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

interface Props {
  items: SiteIndexEntry[];
  trackedIds: Set<string>;
  onToggleTrack: (item: SiteIndexEntry) => void;
}

export default function OpportunityTable({ items, trackedIds, onToggleTrack }: Props) {
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            <th className="px-3 py-2">
              <span className="sr-only">Track</span>
            </th>
            <th className="px-3 py-2">Company</th>
            <th className="px-3 py-2">Title</th>
            <th className="px-3 py-2">Kind</th>
            <th className="px-3 py-2">Level</th>
            <th className="px-3 py-2">Location</th>
            <th className="px-3 py-2">Age</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              className="row-enter border-t border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
            >
              <td className="px-3 py-2">
                <BookmarkButton
                  tracked={trackedIds.has(item.id)}
                  onToggle={() => onToggleTrack(item)}
                  label={`${item.company} — ${item.title}`}
                />
              </td>
              <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                <div className="flex items-center gap-2">
                  <CompanyAvatar company={item.company} />
                  <span>{item.company}</span>
                </div>
              </td>
              <td className="px-3 py-2">
                <a
                  className="text-teal-700 underline-offset-2 hover:underline dark:text-teal-400"
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {item.title}
                </a>
                <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  via{" "}
                  <a
                    href={item.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {item.source}
                  </a>
                </div>
              </td>
              <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{KIND_LABEL[item.kind]}</td>
              <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{item.level ?? "—"}</td>
              <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{formatLocation(item.location)}</td>
              <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{item.age || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
