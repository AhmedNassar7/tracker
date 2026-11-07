"""D4 — the monthly "State of Early-Career Tech Hiring" post
(docs/WEBSITE-VISION-PLAN.html §11), generated from this repo's own
``data/stats-history.json`` and written in-repo as plain Markdown, like the
READMEs.

Honesty rules (the whole point — a post nobody can trust is worse than none):

* **Only completed months, and only with a real baseline.** A month gets a post
  once it is over AND there is a dimensioned snapshot from just before it began
  to compare against AND the history covers it well (>= MIN_DAYS distinct days,
  the last of them in the month's final days). No baseline -> no post, never an
  invented comparison. (History only has dimensions from 2026-09-06, so the
  first publishable month is October 2026; September correctly yields nothing.)
* **Coverage is not the market.** Total counts rise whenever a source is added —
  the tracker went from ~2.5k to ~4k published jobs in September mostly because
  coverage grew. So the post leads with *composition* (shares and share changes
  in percentage points), shows the headline total with an explicit caveat, and
  never turns a total's growth into a claim about hiring.
* **Everything is derived, nothing estimated.** Each figure is read straight out
  of a snapshot's ``dimensions``; open-ended ones (countries, companies) are the
  snapshot's own top-N and are labelled as such.
* **Frozen once written.** An existing month's file is never rewritten by the
  hourly run (stable, shareable, no hourly git churn). ``--regen-reports`` on
  ``build_data_readme.py`` forces a rebuild after changing this generator.

Pure functions, stdlib only; no clock or disk reads except in
``write_state_of_hiring_reports``.
"""

from __future__ import annotations

import calendar
import datetime
from pathlib import Path

from patterns import country_flag

# A month needs at least this many distinct days of dimensioned snapshots, and
# its last snapshot must fall within the final END_SLACK_DAYS, to count as covered.
MIN_DAYS = 20
END_SLACK_DAYS = 3
# The baseline snapshot must be no older than this before the month began.
BASELINE_MAX_GAP_DAYS = 10

TOP_COMPANIES = 10
TOP_COUNTRIES = 10
# build_data_readme._SNAPSHOT_COUNTRY_N: how many countries each snapshot retains.
SNAPSHOT_COUNTRIES = 15

# "mid_level" also holds senior/staff/lead titles (patterns.detect_level files
# them there so they can never read as entry-level) — labelled as such so the
# table doesn't claim half the market is "mid level".
LEVEL_LABELS = {
    "internship": "Internship", "new_grad": "New grad", "junior": "Junior",
    "entry_level": "Entry level", "mid_level": "Mid level & senior",
    "unknown": "Level not stated",
}
# The curated layer reports a title with no level word as "unknown", the public
# layer as "other" — the same fact, so the post shows one row.
_LEVEL_MERGE = {"other": "unknown"}
EARLY_CAREER = ("internship", "new_grad", "junior", "entry_level")
REGION_LABELS = {
    "north_america": "North America", "europe": "Europe", "apac": "Asia-Pacific",
    "mena": "Middle East & Africa", "latam": "Latin America", "remote": "Remote (no region)",
    "unknown": "Region not stated",
}
ROLE_LABELS = {
    "software_engineer": "Software engineer", "full_stack": "Full-stack", "backend": "Backend",
    "frontend": "Frontend", "mobile": "Mobile", "platform": "Platform",
    "infrastructure": "Infrastructure / DevOps", "machine_learning": "ML / data",
    "security": "Security", "other_swe": "Other software", "unknown": "Not classified",
}

# Categories that say "we don't know" — never reported as a mover.
_NON_INFORMATIVE = {"unknown", "other", "remote"}


# ---------------------------------------------------------------------------
# Snapshot selection
# ---------------------------------------------------------------------------

def _parse(at: str) -> datetime.datetime:
    return datetime.datetime.strptime(at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)


def _month_bounds(year: int, month: int) -> tuple[datetime.date, datetime.date]:
    first = datetime.date(year, month, 1)
    last = datetime.date(year, month, calendar.monthrange(year, month)[1])
    return first, last


def _dimensioned(history: dict) -> list[dict]:
    snaps = [s for s in (history.get("snapshots") or []) if s.get("dimensions") and s.get("at")]
    return sorted(snaps, key=lambda s: s["at"])


def select_snapshots(history: dict, year: int, month: int):
    """``(baseline, end, days_covered)`` for a month, or ``None`` when the month
    can't honestly be reported. ``baseline`` is the last dimensioned snapshot
    from before the month began (within BASELINE_MAX_GAP_DAYS); ``end`` is the
    last one inside the month."""
    first, last = _month_bounds(year, month)
    snaps = _dimensioned(history)
    inside = [s for s in snaps if _parse(s["at"]).date().replace(day=1) == first]
    if not inside:
        return None
    days = {s["at"][:10] for s in inside}
    end = inside[-1]
    if len(days) < MIN_DAYS:
        return None
    if (last - _parse(end["at"]).date()).days > END_SLACK_DAYS:
        return None
    before = [s for s in snaps if _parse(s["at"]).date() < first]
    if not before:
        return None
    baseline = before[-1]
    if (first - _parse(baseline["at"]).date()).days > BASELINE_MAX_GAP_DAYS:
        return None
    return baseline, end, len(days)


def reportable_months(history: dict, today: datetime.date) -> list[tuple[int, int]]:
    """Completed months (strictly before ``today``'s month) that pass
    ``select_snapshots``, oldest first."""
    snaps = _dimensioned(history)
    months = sorted({(_parse(s["at"]).year, _parse(s["at"]).month) for s in snaps})
    out = []
    for year, month in months:
        if (year, month) >= (today.year, today.month):
            continue
        if select_snapshots(history, year, month):
            out.append((year, month))
    return out


# ---------------------------------------------------------------------------
# Rendering helpers
# ---------------------------------------------------------------------------

def _total(counts: dict) -> int:
    return sum(v for v in counts.values() if isinstance(v, int))


def _merged(counts: dict, merge: dict) -> dict:
    """Fold synonym buckets together (``{"other": "unknown"}`` adds other→unknown)."""
    out: dict = {}
    for key, value in (counts or {}).items():
        target = merge.get(key, key)
        out[target] = out.get(target, 0) + value
    return out


def _levels(dims: dict) -> dict:
    return _merged(dims.get("by_level") or {}, _LEVEL_MERGE)


def _share(count: int, total: int) -> float:
    return (count / total * 100) if total else 0.0


def _fmt_pct(x: float) -> str:
    return f"{x:.1f}%"


def _fmt_delta_pt(delta: float) -> str:
    if abs(delta) < 0.05:
        return "—"
    return f"{'+' if delta > 0 else '−'}{abs(delta):.1f} pt"


def _bar(share: float, width: int = 16) -> str:
    # Scaled so a 100% share fills the bar; tiny shares still show one block.
    n = max(1, round(share / 100 * width)) if share > 0 else 0
    return "█" * n


def _table(header: list[str], rows: list[list[str]]) -> str:
    out = ["| " + " | ".join(header) + " |", "|" + "|".join(" --- " for _ in header) + "|"]
    out += ["| " + " | ".join(r) + " |" for r in rows]
    return "\n".join(out)


def _category_table(label_col: str, labels: dict, end: dict, start: dict, *, limit: int | None = None,
                    flag: bool = False) -> str:
    """Rows for one dimension: end-of-month count, share of all published jobs,
    and the change in that share (percentage points) against the baseline."""
    end_total = _total(end) or 1
    start_total = _total(start)
    rows = []
    ordered = sorted(end.items(), key=lambda kv: (-kv[1], kv[0]))
    for key, count in ordered[:limit] if limit else ordered:
        name = labels.get(key, key)
        if flag:
            name = "Country not stated" if key == "Unknown" else f"{country_flag(key)} {name}".strip()
        share = _share(count, end_total)
        prev = start.get(key)
        delta = _fmt_delta_pt(share - _share(prev, start_total)) if prev is not None and start_total else "new"
        rows.append([name, f"{count:,}", f"{_bar(share)} {_fmt_pct(share)}", delta])
    return _table([label_col, "Roles", "Share", "Δ share"], rows)


def _movers(dims_end: dict, dims_start: dict, limit: int = 3) -> list[tuple[str, str, float]]:
    """The largest share shifts (|Δ| >= 0.5 pt) across level / region / role
    type, skipping the "unknown"-type buckets. ``(dimension, label, delta_pt)``."""
    spec = (("by_level", LEVEL_LABELS, "level"), ("by_region", REGION_LABELS, "region"),
            ("by_role_type", ROLE_LABELS, "role type"))
    found = []
    for dim, labels, noun in spec:
        end, start = dims_end.get(dim) or {}, dims_start.get(dim) or {}
        if dim == "by_level":
            end, start = _merged(end, _LEVEL_MERGE), _merged(start, _LEVEL_MERGE)
        et, st = _total(end), _total(start)
        if not et or not st:
            continue
        for key, count in end.items():
            if key in _NON_INFORMATIVE or key not in start:
                continue
            delta = _share(count, et) - _share(start[key], st)
            if abs(delta) >= 0.5:
                found.append((noun, labels.get(key, key), delta))
    found.sort(key=lambda t: -abs(t[2]))
    return found[:limit]


def _month_name(year: int, month: int) -> str:
    return f"{calendar.month_name[month]} {year}"


def _day_label(at: str) -> str:
    d = _parse(at).date()
    return f"{calendar.month_abbr[d.month]} {d.day}"


# ---------------------------------------------------------------------------
# The post
# ---------------------------------------------------------------------------

def build_state_of_hiring(history: dict, year: int, month: int, generated_on: str) -> str | None:
    """Markdown for one completed month, or ``None`` if it isn't reportable
    (see module docstring). ``generated_on`` is a ``YYYY-MM-DD`` string."""
    picked = select_snapshots(history, year, month)
    if not picked:
        return None
    baseline, end_snap, days_covered = picked
    de, ds = end_snap["dimensions"], baseline["dimensions"]

    lv_end, lv_start = _levels(de), _levels(ds)
    total_end, total_start = _total(lv_end), _total(lv_start)
    early_end = sum(lv_end.get(k, 0) for k in EARLY_CAREER)
    early_start = sum(lv_start.get(k, 0) for k in EARLY_CAREER)
    early_share, early_share_then = _share(early_end, total_end), _share(early_start, total_start)

    end_label, start_label = _day_label(end_snap["at"]), _day_label(baseline["at"])
    name = _month_name(year, month)

    # ---- the short version: one sentence per fact we can actually back ----
    total_line = f"**{total_end:,} published software roles** were being tracked on {end_label}"
    if total_start:
        total_line += (f", against {total_start:,} on {start_label} — but see *How to read these numbers*: "
                       "that total reflects the tracker's coverage as much as the market.")
    else:
        total_line += "."
    early_line = f"**{_fmt_pct(early_share)} were early-career** (internship, new grad, junior or entry level)"
    if total_start:
        d = _fmt_delta_pt(early_share - early_share_then)
        early_line += f" — {'unchanged' if d == '—' else d} since {start_label}."
    else:
        early_line += "."
    bullets = [total_line, early_line]
    regions = sorted(((k, v) for k, v in (de.get("by_region") or {}).items() if k not in _NON_INFORMATIVE),
                     key=lambda kv: -kv[1])
    if regions:
        top = [f"{REGION_LABELS.get(k, k)} ({_fmt_pct(_share(v, total_end))})" for k, v in regions[:2]]
        bullets.append("**Most roles by region:** " + ", then ".join(top) + ".")
    companies = list((de.get("top_companies") or {}).items())[:3]
    if companies:
        bullets.append("**Most open roles by employer:** " + ", ".join(f"{c} ({n:,})" for c, n in companies) + ".")
    movers = _movers(de, ds)
    if movers:
        bullets.append("**Biggest share shifts since " + start_label + ":** "
                       + "; ".join(f"{label} ({noun}) {_fmt_delta_pt(d)}" for noun, label, d in movers) + ".")

    sections = [
        f"# State of Early-Career Tech Hiring — {name}",
        f"*Generated automatically on {generated_on} from this repo's own hourly snapshots "
        f"([`stats-history.json`](../stats-history.json)). Every number is read straight out of a snapshot; "
        f"nothing is estimated. Compared with the snapshot of {start_label}; month-end is {end_label} "
        f"(UTC), with {days_covered} days of data in the month.*",
        "## The short version\n\n" + "\n".join(f"- {b}" for b in bullets),
        "## Early-career mix\n\nHow the published roles break down by the level stated in the posting. "
        "\"Δ share\" is the change in that level's share of all roles, in percentage points.\n\n"
        + _category_table("Level", LEVEL_LABELS, lv_end, lv_start),
        "## Where the roles are\n\n"
        + _category_table("Region", REGION_LABELS, de.get("by_region") or {}, ds.get("by_region") or {})
        + f"\n\n### Top {TOP_COUNTRIES} countries\n\n*Each snapshot keeps only its {SNAPSHOT_COUNTRIES} largest "
        "countries, so shares here are of ALL roles, not of this list.*\n\n"
        + _category_table("Country", {}, de.get("by_country") or {}, ds.get("by_country") or {},
                          limit=TOP_COUNTRIES, flag=True),
        "## What kind of roles\n\n"
        + _category_table("Role type", ROLE_LABELS, de.get("by_role_type") or {}, ds.get("by_role_type") or {}),
        f"## Who has the most open roles\n\n*Top {TOP_COMPANIES}. A big count here mostly means a big employer "
        "with a public job board the tracker covers — see below.*\n\n"
        + _table(["Employer", "Open roles", "Share"],
                 [[c, f"{n:,}", f"{_bar(_share(n, total_end))} {_fmt_pct(_share(n, total_end))}"]
                  for c, n in list((de.get("top_companies") or {}).items())[:TOP_COMPANIES]]),
        "## How to read these numbers\n\n"
        "- **Coverage is not the market.** These are the roles this tracker can see, not all hiring. "
        "Adding a job board or a community source raises counts with no change in the real world, and the "
        "tracker's sources have grown over time. So treat *shares* and *rankings* as the signal and the "
        "*total* as a description of coverage.\n"
        "- **Software roles.** Public company boards (Greenhouse, Lever, Ashby, Workday and similar) are "
        "filtered to software-engineering titles; the community trackers contribute their own scope. "
        "\"Role type\" comes from the title classifier in [`scripts/patterns.py`](../../scripts/patterns.py).\n"
        "- **Levels come from the posting's own title.** A role that doesn't say its level is counted "
        "under *Level not stated*, never guessed. Senior, staff and lead titles are grouped with mid level "
        "so they can never be mistaken for entry-level roles.\n"
        "- **Rules change too.** The title classifier and company-name normalisation are improved over "
        "time, so a shift in a share can come from a better rule rather than the market.\n"
        "- **Work arrangement is not reported**: only some sources state it, so any split would describe "
        "those sources, not hiring.\n"
        "- **Large employers dominate counts.** A handful of companies publish hundreds of openings at "
        "once; one of them changing its board moves the shares.\n"
        "- **Only live, apparently-open roles are counted** — links are re-checked every run and dead ones "
        "are dropped, but no checker catches every closed posting.\n"
        "- Hackathons and events are not included.",
        "---\n\n*Source data: [`stats-history.json`](../stats-history.json) · live view: the "
        "[tracker dashboard](https://ahmednassar7.github.io/tracker/dashboard) · "
        "generator: [`scripts/state_of_hiring.py`](../../scripts/state_of_hiring.py)*",
    ]
    return "\n\n".join(sections) + "\n"


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------

def report_filename(year: int, month: int) -> str:
    return f"state-of-hiring-{year:04d}-{month:02d}.md"


def render_reports_index(reports_dir: Path) -> str:
    files = sorted(reports_dir.glob("state-of-hiring-*.md"), reverse=True)
    lines = [
        "# Reports",
        "",
        "Monthly write-ups generated from this repo's own snapshot history — see "
        "[`scripts/state_of_hiring.py`](../../scripts/state_of_hiring.py) for exactly what is and isn't "
        "claimed. A month is published once it is over and has a proper baseline; it is then frozen.",
        "",
    ]
    if files:
        for f in files:
            stem = f.stem.removeprefix("state-of-hiring-")
            year, month = int(stem[:4]), int(stem[5:7])
            lines.append(f"- [State of Early-Career Tech Hiring — {_month_name(year, month)}]({f.name})")
    else:
        lines.append("*No month has met the publishing bar yet.*")
    return "\n".join(lines) + "\n"


def write_state_of_hiring_reports(history: dict, reports_dir: Path, now_iso: str, *, force: bool = False) -> list[Path]:
    """Write any reportable month's post that isn't on disk yet (or all of them
    with ``force``), refresh the index, and return the paths written. An
    existing month is never touched without ``force`` — see module docstring."""
    today = _parse(now_iso).date()
    written: list[Path] = []
    for year, month in reportable_months(history, today):
        path = reports_dir / report_filename(year, month)
        if path.exists() and not force:
            continue
        text = build_state_of_hiring(history, year, month, today.isoformat())
        if text is None:
            continue
        reports_dir.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        written.append(path)
    if reports_dir.exists():
        index = reports_dir / "README.md"
        text = render_reports_index(reports_dir)
        if not index.exists() or index.read_text(encoding="utf-8") != text:
            index.write_text(text, encoding="utf-8")
            written.append(index)
    return written
