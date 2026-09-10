import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BASE_URL } from "../lib/basePath";
import { fetchSiteIndex } from "../lib/dataSource";
import { formatRelativeTime, prettifyCompany } from "../lib/labels";
import { loadProfile, type Profile } from "../lib/profile";
import { profileCanMatch, scoreJobForProfile, type JobMatch } from "../lib/profileMatch";
import { listApplications, type TrackedApplication } from "../lib/tracker";
import { readLastVisit } from "../lib/visitHistory";
import type { SiteIndexEntry } from "../lib/types";

// C8 — "/today". A once-a-day glance built entirely from what's already
// local: the hourly site-index, the saved profile, the "new since last
// visit" set, and the tracked-application store. No new data, no network
// beyond the same site-index fetch the main list makes. Read-only w.r.t.
// visit history — only the Jobs page advances "last visit".

type Load =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      items: SiteIndexEntry[];
      generatedAt: string;
      profile: Profile | null;
      lastVisitAt: string | null;
      newIds: Set<string>;
      apps: TrackedApplication[];
    };

function greeting(d: Date): string {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function MatchPill({ score }: { score: number }) {
  const tone =
    score >= 70
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
      : score >= 40
        ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  return (
    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tone}`}>
      <span aria-hidden="true">🎯</span> {score}%
    </span>
  );
}

function RoleRow({ item, match }: { item: SiteIndexEntry; match?: JobMatch }) {
  return (
    <li className="flex items-start gap-2 py-2">
      {match && <MatchPill score={match.score} />}
      <div className="min-w-0">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-teal-700 underline-offset-2 hover:underline dark:text-teal-400"
        >
          {item.title}
        </a>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          {prettifyCompany(item.company)}
          {item.location ? ` · ${item.location.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}` : ""}
        </div>
        {match && match.reasons.length > 0 && (
          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{match.reasons.slice(0, 2).join(" · ")}</div>
        )}
      </div>
    </li>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h2>
      <div className="mt-1">{children}</div>
    </section>
  );
}

export default function TodayDigest() {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchSiteIndex(), loadProfile(), listApplications()])
      .then(([index, profile, apps]) => {
        if (cancelled) return;
        const items = index.items.filter((i) => i.kind !== "board");
        const lv = readLastVisit();
        const newIds = new Set(lv.at ? items.filter((i) => !lv.ids.has(i.id)).map((i) => i.id) : []);
        setLoad({ status: "ready", items, generatedAt: index.generated_at, profile, lastVisitAt: lv.at, newIds, apps });
      })
      .catch(() => {
        if (!cancelled) setLoad({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const derived = useMemo(() => {
    if (load.status !== "ready") return null;
    const { items, profile, newIds, apps } = load;
    const canMatch = !!profile && profileCanMatch(profile);
    const trackedIds = new Set(apps.map((a) => a.id));

    const newItems = items.filter((i) => newIds.has(i.id));
    const newForYou = canMatch
      ? newItems
          .map((i) => ({ i, m: scoreJobForProfile(i, profile as Profile) }))
          .filter((x) => !x.m.contradicts && x.m.score >= 40)
          .sort((a, b) => b.m.raw - a.m.raw)
          .slice(0, 6)
      : newItems.slice(0, 6).map((i) => ({ i, m: undefined as JobMatch | undefined }));

    const shown = new Set(newForYou.map((x) => x.i.id));
    const topPicks = canMatch
      ? items
          .filter((i) => i.kind === "job" && !shown.has(i.id) && !trackedIds.has(i.id))
          .map((i) => ({ i, m: scoreJobForProfile(i, profile as Profile) }))
          .filter((x) => !x.m.contradicts)
          .sort((a, b) => b.m.raw - a.m.raw)
          .slice(0, 5)
      : [];

    const pipeline = {
      bookmarked: apps.filter((a) => a.status === "bookmarked").length,
      inProgress: apps.filter((a) => ["applied", "oa", "interview"].includes(a.status)).length,
      offer: apps.filter((a) => a.status === "offer").length,
    };

    return { canMatch, newForYou, topPicks, pipeline };
  }, [load]);

  if (load.status === "loading") {
    return <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">Putting your day together…</p>;
  }
  if (load.status === "error" || !derived) {
    return <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">Couldn't load your digest — try again in a moment.</p>;
  }

  const now = new Date();
  const dateLabel = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const since = formatRelativeTime(load.lastVisitAt);
  const { canMatch, newForYou, topPicks, pipeline } = derived;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header>
        <h1 className="text-2xl font-semibold">
          {greeting(now)} <span className="text-slate-400">·</span> {dateLabel}
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {load.lastVisitAt
            ? `${newForYou.length} ${newForYou.length === 1 ? "role" : "roles"} ${
                canMatch ? "matching your profile" : "new"
              }${since ? ` · last visit ${since}` : ""}`
            : "First look — visit the Jobs page once so tomorrow can show you what's new."}
        </p>
      </header>

      {!canMatch && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <a className="font-medium underline" href={`${BASE_URL}profile`}>
            Fill in your profile
          </a>{" "}
          (skills and what you're looking for) and this becomes a ranked, personal shortlist.
        </div>
      )}

      <Section title={canMatch ? "New for you" : "New since your last visit"}>
        {newForYou.length === 0 ? (
          <p className="py-2 text-sm text-slate-500 dark:text-slate-400">
            Nothing new to show{load.lastVisitAt && since ? ` since ${since}` : ""}. Check back later.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {newForYou.map(({ i, m }) => (
              <RoleRow key={i.id} item={i} match={m} />
            ))}
          </ul>
        )}
      </Section>

      {topPicks.length > 0 && (
        <Section title="Top picks for you">
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {topPicks.map(({ i, m }) => (
              <RoleRow key={i.id} item={i} match={m} />
            ))}
          </ul>
        </Section>
      )}

      <Section title="Your pipeline">
        {pipeline.bookmarked + pipeline.inProgress + pipeline.offer === 0 ? (
          <p className="py-2 text-sm text-slate-500 dark:text-slate-400">
            Nothing tracked yet — hit <span className="font-medium">Track</span> on a role to build your pipeline.
          </p>
        ) : (
          <p className="py-1 text-sm text-slate-600 dark:text-slate-300">
            <strong>{pipeline.bookmarked}</strong> bookmarked, not applied · <strong>{pipeline.inProgress}</strong> in progress
            {pipeline.offer > 0 && (
              <>
                {" "}
                · <strong>{pipeline.offer}</strong> offer{pipeline.offer === 1 ? "" : "s"}
              </>
            )}{" "}
            <a className="text-teal-700 hover:underline dark:text-teal-400" href={`${BASE_URL}applications`}>
              open tracker →
            </a>
          </p>
        )}
      </Section>

      <p className="text-center text-xs text-slate-400 dark:text-slate-500">
        Built from the {formatRelativeTime(load.generatedAt) || "latest"} data snapshot · all local, nothing sent anywhere.
      </p>
    </div>
  );
}
