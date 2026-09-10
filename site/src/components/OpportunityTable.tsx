import BookmarkButton from "./BookmarkButton";
import CompanyAvatar from "./CompanyAvatar";
import Flag from "./Flag";
import { BASE_URL } from "../lib/basePath";
import { formatAge, formatLevel, formatRelativeTime, formatSalaryShort, prettifyCompany } from "../lib/labels";
import { countryForItem } from "../lib/geo";
import type { JobMatch } from "../lib/profileMatch";
import type { SiteIndexEntry } from "../lib/types";

const MAX_TECH_CHIPS = 4;

// A1 — a positive-only signal, like the community boards' ✅ column: shown
// when the pipeline's own liveness check confirmed the apply URL reachable,
// and nothing at all otherwise (an "unverified" row isn't a dead link, so
// flagging every one of them would be alarming noise). Jobs only — "open" is
// a job word.
function LivenessBadge({ item }: { item: SiteIndexEntry }) {
  if (item.kind !== "job" || item.liveness !== "verified") return null;
  const checked = formatRelativeTime(item.last_checked);
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500"
      title={checked ? `Apply link confirmed reachable ${checked}` : "Apply link confirmed reachable"}
    >
      <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
      {checked || "verified"}
    </span>
  );
}

// B3/B4/B5 — signals lifted from the posting's own text. Rendered only when
// present (a silent posting shows nothing), so this quietly no-ops for the
// many rows whose source carries no description.
function FacetChips({ item, hideTags = false }: { item: SiteIndexEntry; hideTags?: boolean }) {
  const tags = hideTags ? [] : item.tech_tags ?? [];
  const salary = formatSalaryShort(item.salary);
  if (tags.length === 0 && !salary && item.visa_sponsorship !== true) return null;

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
    </div>
  );
}

// "Best match" sort — a compact pill plus one line of "why". The pill's
// tooltip carries the full reason / gap breakdown for anyone who wants it;
// the row itself stays to a single headline so the list reads cleanly
// (profileMatch.ts computes the score).
function MatchChips({ m }: { m: JobMatch }) {
  const tone =
    m.score >= 70
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
      : m.score >= 40
        ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  // Lead with the stack overlap ("9/15 of the stack") — the number that
  // actually moves per posting; fall back to the first reason, or the gap on
  // a contradiction. Full +reason / −gap breakdown is in the pill's tooltip.
  const stackReason = m.reasons.find((r) => /of the stack/.test(r));
  const headlineIsGap = m.contradicts && !!m.gaps[0];
  const headline = headlineIsGap ? m.gaps[0] : stackReason ?? m.reasons[0] ?? m.gaps[0] ?? null;
  const detail = [...m.reasons.map((r) => `+ ${r}`), ...m.gaps.map((g) => `− ${g}`)].join("\n");
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      <span
        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tone}`}
        title={detail || undefined}
      >
        <span aria-hidden="true">🎯</span> {m.score}% match
      </span>
      {headline && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize ${
            headlineIsGap
              ? "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
              : "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300"
          }`}
        >
          {headline}
        </span>
      )}
    </div>
  );
}

const KIND_LABEL: Record<SiteIndexEntry["kind"], string> = {
  job: "Job",
  hackathon: "Hackathon",
  event: "Event",
  // Board items (kind:"board") are filtered out before this table and shown
  // in the site footer instead; this entry just keeps the Record exhaustive.
  board: "Company board",
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
  // A real country flag image in front of the location — resolved from the
  // item's country or, failing that, its location string (client-side), so
  // it works before the pipeline re-runs country detection and on every OS.
  const flag =
    item.kind === "job" ? <Flag country={countryForItem(item)} className="mr-1.5 align-[-2px]" /> : null;
  const locs = item.locations;
  if (locs && locs.length > 1) {
    return (
      <details className="group">
        <summary className="cursor-pointer list-none text-slate-600 marker:content-none hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100">
          <span className="underline decoration-dotted underline-offset-2">
            {flag}
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
  return (
    <>
      {flag}
      {stripLocationMarkup(item.location)}
    </>
  );
}

interface Props {
  items: SiteIndexEntry[];
  // Omit both to render without the bookmark column (e.g. the company page).
  trackedIds?: Set<string>;
  onToggleTrack?: (item: SiteIndexEntry) => void;
  // id → human "why this ranked here" reasons, only passed when the
  // "Relevance" sort is active. Absent means don't render relevance chips.
  matchReasons?: Map<string, string[]>;
  // id → full profile-match result, only passed when "Best for you" sort is
  // active. Takes precedence over matchReasons for that row.
  matchById?: Map<string, JobMatch>;
}

export default function OpportunityTable({
  items,
  trackedIds,
  onToggleTrack,
  matchReasons,
  matchById,
}: Props) {
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
            <th
              className="px-3 py-2"
              title={
                hasJobs
                  ? "How long ago this listing was first seen here (community-tracker rows can pre-date this — the original posting may be older)"
                  : "Time until the deadline"
              }
            >
              {lastColLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, rowIndex) => {
            const company = prettifyCompany(item.company);
            return (
            <tr
              key={item.id}
              // Staggered fade-up on a filter/sort change — capped at the
              // first ~14 rows so a long list doesn't ripple for a second
              // (WEBSITE-VISION-PLAN §5.2).
              style={{ animationDelay: `${Math.min(rowIndex, 14) * 18}ms` }}
              className="row-enter border-t border-slate-200 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
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
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                  <span>
                    via{" "}
                    <a
                      href={item.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {item.source}
                    </a>
                  </span>
                  <LivenessBadge item={item} />
                </div>
                {matchById?.get(item.id) ? (
                  <MatchChips m={matchById.get(item.id)!} />
                ) : (
                  matchReasons?.get(item.id) && (
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
                  )
                )}
                <FacetChips item={item} hideTags={matchById?.has(item.id)} />
              </td>
              <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{KIND_LABEL[item.kind]}</td>
              {hasJobs && (
                <td className="px-3 py-2 text-slate-500 dark:text-slate-400">
                  {item.kind === "job" ? formatLevel(item.level) : "—"}
                </td>
              )}
              <td className="px-3 py-2 text-slate-500 dark:text-slate-400"><LocationCell item={item} /></td>
              <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{formatAge(item.age)}</td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
