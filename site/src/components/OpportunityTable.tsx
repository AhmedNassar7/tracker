import BookmarkButton from "./BookmarkButton";
import CompanyAvatar from "./CompanyAvatar";
import { BASE_URL } from "../lib/basePath";
import { formatLevel, formatSalaryShort, prettifyCompany } from "../lib/labels";
import type { SiteIndexEntry } from "../lib/types";

const MAX_TECH_CHIPS = 4;

// B3/B4/B5 — signals lifted from the posting's own text. Rendered only when
// present (a silent posting shows nothing), so this quietly no-ops for the
// many rows whose source carries no description.
function FacetChips({ item }: { item: SiteIndexEntry }) {
  const tags = item.tech_tags ?? [];
  const salary = formatSalaryShort(item.salary);
  const hasBenefit =
    item.visa_sponsorship === true || item.degree_required === false || !!salary;
  if (tags.length === 0 && !hasBenefit) return null;

  const shownTags = tags.slice(0, MAX_TECH_CHIPS);
  const restCount = tags.length - shownTags.length;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {shownTags.map((tag) => (
        <span
          key={tag}
          className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        >
          {tag}
        </span>
      ))}
      {restCount > 0 && (
        <span className="text-[10px] text-slate-400" title={tags.join(", ")}>
          +{restCount}
        </span>
      )}
      {salary && (
        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          {salary}
        </span>
      )}
      {item.visa_sponsorship === true && (
        <span
          className="rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 dark:bg-teal-950 dark:text-teal-300"
          title="The posting explicitly offers visa sponsorship"
        >
          🛂 Visa
        </span>
      )}
      {item.degree_required === false && (
        <span
          className="rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 dark:bg-teal-950 dark:text-teal-300"
          title="The posting explicitly says no degree is required"
        >
          No degree
        </span>
      )}
    </div>
  );
}

const KIND_LABEL: Record<SiteIndexEntry["kind"], string> = {
  job: "Job",
  hackathon: "Hackathon",
  event: "Event",
};

// The pipeline unpacks multi-location postings into `item.locations[]` and
// leaves `item.location` as a plain "First, Place +N more" summary (see
// _clean_site_location in scripts/build_data_readme.py) — so LocationCell
// below can render a real <details> control. This fallback only has to cope
// with a stray tag slipping through an un-regenerated site-index.json.
function stripLocationMarkup(location: string): string {
  if (!location) return "—";
  return location
    .replace(/<br\s*\/?>/gi, ", ")
    .replace(/<\/summary>/gi, ": ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim() || "—";
}

function LocationCell({ item }: { item: SiteIndexEntry }) {
  const locs = item.locations;
  if (locs && locs.length > 1) {
    return (
      <details className="group">
        <summary className="cursor-pointer list-none text-slate-600 marker:content-none hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100">
          <span className="underline decoration-dotted underline-offset-2">
            {locs[0]}
          </span>{" "}
          <span className="text-xs text-slate-400">+{locs.length - 1} more</span>
        </summary>
        <ul className="mt-1 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
          {locs.map((loc) => (
            <li key={loc}>{loc}</li>
          ))}
        </ul>
      </details>
    );
  }
  return <>{stripLocationMarkup(item.location)}</>;
}

interface Props {
  items: SiteIndexEntry[];
  // Omit both to render without the bookmark column (e.g. the company page).
  trackedIds?: Set<string>;
  onToggleTrack?: (item: SiteIndexEntry) => void;
  // id → human "why this ranked here" reasons, only passed when the
  // "Best match" sort is active. Absent means don't render match chips.
  matchReasons?: Map<string, string[]>;
}

export default function OpportunityTable({ items, trackedIds, onToggleTrack, matchReasons }: Props) {
  const showBookmark = !!onToggleTrack;
  // Columns adapt to what's actually in view: "Level" only means something
  // for jobs, so it's dropped entirely once the list is all hackathons/
  // events, and the last column is relabelled from "Age" (when a job was
  // posted) to "Deadline" (when a hackathon/event closes).
  const hasJobs = items.some((item) => item.kind === "job");
  const hasNonJobs = items.some((item) => item.kind !== "job");
  const lastColLabel = hasJobs ? (hasNonJobs ? "Age / deadline" : "Age") : "Deadline";

  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            {showBookmark && (
              <th className="px-3 py-2">
                <span className="sr-only">Track</span>
              </th>
            )}
            <th className="px-3 py-2">Company</th>
            <th className="px-3 py-2">Title</th>
            <th className="px-3 py-2">Kind</th>
            {hasJobs && <th className="px-3 py-2">Level</th>}
            <th className="px-3 py-2">Location</th>
            <th className="px-3 py-2">{lastColLabel}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const company = prettifyCompany(item.company);
            return (
            <tr
              key={item.id}
              className="row-enter border-t border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
            >
              {showBookmark && (
                <td className="px-3 py-2">
                  <BookmarkButton
                    tracked={!!trackedIds?.has(item.id)}
                    onToggle={() => onToggleTrack?.(item)}
                    label={`${company} — ${item.title}`}
                  />
                </td>
              )}
              <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                <div className="flex items-center gap-2">
                  <CompanyAvatar
                    company={company}
                    fallbackUrl={item.kind === "job" ? undefined : item.url}
                  />
                  {item.kind === "job" ? (
                    <a
                      href={`${BASE_URL}company?c=${encodeURIComponent(company)}`}
                      className="hover:text-teal-700 hover:underline dark:hover:text-teal-400"
                    >
                      {company}
                    </a>
                  ) : (
                    <span>{company}</span>
                  )}
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
                {matchReasons?.get(item.id) && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {matchReasons.get(item.id)!.map((reason) => (
                      <span
                        key={reason}
                        className="rounded-full bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium capitalize text-teal-700 dark:bg-teal-950 dark:text-teal-300"
                      >
                        {reason}
                      </span>
                    ))}
                  </div>
                )}
                <FacetChips item={item} />
              </td>
              <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{KIND_LABEL[item.kind]}</td>
              {hasJobs && (
                <td className="px-3 py-2 text-slate-500 dark:text-slate-400">
                  {item.kind === "job" ? formatLevel(item.level) : "—"}
                </td>
              )}
              <td className="px-3 py-2 text-slate-500 dark:text-slate-400"><LocationCell item={item} /></td>
              <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{item.age || "—"}</td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
