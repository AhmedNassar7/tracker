import { useEffect, useMemo, useState } from "react";
import { BASE_URL } from "../lib/basePath";
import { SINGLE_SERIES_COLOR } from "../lib/chartColors";
import { companyTier } from "../lib/companyTiers";
import { companyTrendPoints } from "../lib/companyTrend";
import { fetchCompanyHistory, fetchSiteIndex } from "../lib/dataSource";
import { regionForItem } from "../lib/geo";
import { prettifyCompany, formatLevel, REGION_LABELS } from "../lib/labels";
import type { CompanyHistory, SiteIndex, SiteIndexEntry } from "../lib/types";
import BarList from "./BarList";
import CompanyAvatar from "./CompanyAvatar";
import OpportunityTable from "./OpportunityTable";
import SkeletonTable from "./SkeletonTable";
import TrendLine from "./TrendLine";

// One company, every open role, plus a level/region breakdown — the
// "storyteller" view the plain list can't give. Reads the same runtime
// site-index.json as the main page (so it's never staler than an hour) and
// filters client-side; no per-company build step, no redeploy to refresh.

const TIER_LABEL = [
  "FAANG & Microsoft",
  "Big tech",
  "Cloud & AI",
  "Product, SaaS & fintech",
  "Global majors",
  "High-growth tech",
];

function readCompanyParam(): string {
  if (typeof window === "undefined") return "";
  return (new URLSearchParams(window.location.search).get("c") || "").trim();
}

function topCounts(items: SiteIndexEntry[], pick: (i: SiteIndexEntry) => string | undefined, label: (k: string) => string) {
  const counts = new Map<string, number>();
  for (const i of items) {
    const k = pick(i);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([key, value]) => ({ key, label: label(key), value, color: SINGLE_SERIES_COLOR }));
}

export default function CompanyPage() {
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "loaded"; data: SiteIndex }>({
    status: "loading",
  });
  // null until read on the client. The server has no URL query, so reading it
  // during the first render made server HTML ("Loading company…") differ from
  // the client's ("Loading Schneider Electric…") → React hydration error #418
  // and the whole tree re-rendered.
  const [companyParam, setCompanyParam] = useState<string | null>(null);
  useEffect(() => setCompanyParam(readCompanyParam()), []);
  // Optional enhancement: a failed/missing company-history.json (day zero, or
  // an older deploy) just means no trend section — never an error state.
  const [history, setHistory] = useState<CompanyHistory | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSiteIndex()
      .then((data) => !cancelled && setState({ status: "loaded", data }))
      .catch((err: unknown) =>
        !cancelled && setState({ status: "error", message: err instanceof Error ? err.message : "Unknown error" }),
      );
    fetchCompanyHistory()
      .then((h) => !cancelled && setHistory(h))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const name = prettifyCompany(companyParam ?? "");

  const items = useMemo(() => {
    if (state.status !== "loaded" || !companyParam) return [];
    const target = companyParam.toLowerCase();
    return state.data.items.filter((i) => {
      const c = (i.company || "").toLowerCase();
      const p = prettifyCompany(i.company).toLowerCase();
      return c === target || p === target || c.includes(target) || target.includes(c);
    });
  }, [state, companyParam]);

  const tier = companyTier(name);
  const jobs = items.filter((i) => i.kind === "job");
  const trend = useMemo(() => {
    const rawNames = new Set(items.filter((i) => i.kind === "job" && i.company).map((i) => i.company));
    return companyTrendPoints(history, [...rawNames]);
  }, [history, items]);

  const backLink = (
    <a href={BASE_URL} className="text-sm text-teal-700 hover:underline dark:text-teal-400">
      ← all opportunities
    </a>
  );

  if (state.status === "loading" || companyParam === null) return <SkeletonTable label={`Loading ${name || "company"}…`} />;
  if (state.status === "error")
    return (
      <div className="space-y-3">
        {backLink}
        <p className="text-red-600 dark:text-red-400">Couldn't load data ({state.message}).</p>
      </div>
    );
  if (!companyParam)
    return (
      <div className="space-y-3">
        {backLink}
        <p className="text-slate-600 dark:text-slate-300">No company selected — open this page from a company name in the list.</p>
      </div>
    );
  if (items.length === 0)
    return (
      <div className="space-y-3">
        {backLink}
        <p className="text-slate-600 dark:text-slate-300">
          Nothing open at <strong>{name}</strong> right now. It may have rolled off since the last refresh.
        </p>
      </div>
    );

  return (
    <div className="space-y-6">
      {backLink}

      <header className="flex flex-wrap items-center gap-4">
        <span className="scale-150 pl-2">
          <CompanyAvatar company={name} />
        </span>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{name}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {items.length.toLocaleString()} open {items.length === 1 ? "opportunity" : "opportunities"}
            {tier < TIER_LABEL.length && <> · {TIER_LABEL[tier]}</>}
          </p>
        </div>
      </header>

      {jobs.length > 0 && (
        <div className="grid gap-6 sm:grid-cols-2">
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">By level</h2>
            <BarList items={topCounts(jobs, (i) => i.level, (k) => formatLevel(k))} />
          </section>
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">By region</h2>
            <BarList items={topCounts(jobs, (i) => regionForItem(i), (k) => REGION_LABELS[k] ?? k)} />
          </section>
        </div>
      )}

      {trend.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Open roles over time
          </h2>
          <TrendLine points={trend} label="Open roles" />
          {trend.length === 1 && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              We started recording per-company history today — the line fills in one point a day.
            </p>
          )}
        </section>
      )}

      <OpportunityTable items={items} />
    </div>
  );
}
