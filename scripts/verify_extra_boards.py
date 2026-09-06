#!/usr/bin/env python3
"""Verify Greenhouse / Lever / Ashby / SmartRecruiters board tokens before
they go into config/extra_job_boards.yml.

CLAUDE.md rule: never add a board token without confirming a real, non-empty
postings response by hand — a bare "not a 404" is not enough. This is the
"by hand" step, automated: it hits each board's public API and reports
whether it's real, how many postings it has, and a few sample titles /
locations so you can eyeball that it's the *right* company.

Nothing here touches the hourly pipeline — it's a standalone maintenance
tool. Standard library only, same as the rest of the repo.

The normal workflow for a new company:
  1. Open its careers page. Find "Powered by <Greenhouse|Lever|Ashby|...>" in
     the footer (a custom domain like mercor.com/careers or jobs.halan.com is
     usually just a skin over one of these).
  2. Copy the EXACT-CASE company slug from an apply URL.
  3. Run this against it:
       python scripts/verify_extra_boards.py ashby:mercor
  4. If it says "✓ REAL", add that slug to the matching section of
     config/extra_job_boards.yml. If the careers site is genuinely bespoke
     (no ATS), add a one-liner to config/aggregate_links.yml instead.
  LinkedIn is NOT a path here — scraping a company's LinkedIn job list is
  against this repo's source-terms rule, and those listings are cross-posts
  of the ATS board anyway.

Usage
-----
  # Re-check every token already in config/extra_job_boards.yml:
  python scripts/verify_extra_boards.py

  # Check specific candidates (platform:token, space-separated):
  python scripts/verify_extra_boards.py ashby:mercor lever:Bosta greenhouse:stripe

  # Check the MENA candidate shortlist baked in below:
  python scripts/verify_extra_boards.py --mena

Exit code is non-zero if any *config* token (not a candidate) came back dead
or empty, so this can gate CI later if wanted. A "couldn't reach" line
(network/proxy blocked the request) is NOT counted as a failure.
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config" / "extra_job_boards.yml"
UA = {"User-Agent": "tracker-bot/1.0 (board verification)"}
TIMEOUT = 15

# MENA / Gulf / North Africa re-check list. `--mena` runs these.
#
# 2026-09-06 findings (checker now auto-retries case variants + knows
# bamboohr):
#   ✓ Bosta   → jobs.lever.co/Bosta       Cairo, 64 postings — ADDED to lever:
#   ✓ Mercor  → api.ashbyhq.com/.../mercor 96 jobs — ADDED to ashby: (SF, not MENA)
#   ? Instabug/**Luciq** → instabug.bamboohr.com  (BambooHR — check below)
#   ⚠ MoneyHash → Ashby board exists, 0 open
#   ✗ everything else guessed (Swvl, Paymob, MNT-Halan, Tabby, …) — not on
#     Greenhouse/Lever/Ashby. They're on Workable / BambooHR / bespoke sites.
# Keep editing the tokens as you learn real ones from "Powered by <ATS>"
# footers; a bespoke careers site → an aggregate_links.yml row instead.
MENA_CANDIDATES = [
    ("lever", "Bosta"),           # ✓ Cairo, added
    ("lever", "telda"),
    ("ashby", "mercor"),          # ✓ SF, added
    ("bamboohr", "instabug"),     # Luciq (ex-Instabug) — Cairo/SF
    ("bamboohr", "swvl"),
    ("bamboohr", "paymob"),
    ("recruitee", "moneyhash"),   # on Recruitee (0 open when checked)
    ("pinpoint", "moneyfellows"),
    ("pinpoint", "careers.moneyfellows.com"),
    ("pinpoint", "tabby"),
    ("smartrecruiters", "Talabat"),
    ("smartrecruiters", "Noon"),
]


def _case_variants(token: str) -> list[str]:
    """Casing forms to try for a case-sensitive Greenhouse/Lever token — the
    lowercase guess, the company's likely real form, and Title-case."""
    seen, out = set(), []
    for v in (token, token.lower(), token.capitalize(), token.title(), token.upper()):
        if v not in seen:
            seen.add(v)
            out.append(v)
    return out

GREEN, RED, YELLOW, DIM, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"


def _get(url: str) -> tuple[int, object]:
    """(status, parsed-json) — raises nothing.

    status is the real HTTP code, or -1 for a connection-level failure
    (timeout, reset, DNS, refused). -1 is important: on a locked-down /
    proxied network the request may never reach the API, and that must NOT be
    read as "board doesn't exist" — it's "can't tell from here".
    """
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception:
        return -1, None


def _sample(rows: list[dict], title_key: str, loc_key) -> str:
    out = []
    for r in rows[:3]:
        title = (r.get(title_key) or "").strip()
        if callable(loc_key):
            loc = loc_key(r)
        else:
            loc = r.get(loc_key)
        loc = (loc or "").strip() if isinstance(loc, str) else ""
        out.append(f"      {DIM}· {title}{(' — ' + loc) if loc else ''}{RESET}")
    return "\n".join(out)


def _check_greenhouse_exact(token: str) -> tuple[str, bool] | None:
    """None ⇒ 404 (try another casing); otherwise the final verdict."""
    _, name_body = _get(f"https://boards-api.greenhouse.io/v1/boards/{token}")
    board_name = (name_body or {}).get("name") if isinstance(name_body, dict) else None
    status, body = _get(f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true")
    if status == -1:
        return f"{YELLOW}⚠ couldn't reach boards-api.greenhouse.io — network/proxy? not a verdict{RESET}", False
    if status == 404:
        return None
    if not isinstance(body, dict):
        return f"{YELLOW}⚠ unexpected response ({status}){RESET}", False
    jobs = body.get("jobs") or []
    if not jobs:
        return f"{YELLOW}⚠ valid board '{token}' but 0 jobs — do NOT add{RESET}", False
    label = f' {DIM}[board name: "{board_name}"]{RESET}' if board_name else ""
    return (
        f"{GREEN}✓ REAL — token '{token}', {len(jobs)} jobs{RESET}{label}\n"
        + _sample(jobs, "title", lambda r: (r.get("location") or {}).get("name")),
        True,
    )


def _check_lever_exact(token: str) -> tuple[str, bool] | None:
    status, body = _get(f"https://api.lever.co/v0/postings/{token}?mode=json")
    if status == -1:
        return f"{YELLOW}⚠ couldn't reach api.lever.co — network/proxy? not a verdict{RESET}", False
    if status == 404:
        return None
    if not isinstance(body, list):
        return f"{YELLOW}⚠ unexpected response ({status}){RESET}", False
    if not body:
        return f"{YELLOW}⚠ valid board '{token}' but 0 postings — do NOT add{RESET}", False
    return (
        f"{GREEN}✓ REAL — token '{token}', {len(body)} postings{RESET}\n"
        + _sample(body, "text", lambda r: (r.get("categories") or {}).get("location")),
        True,
    )


def _with_case_retry(token: str, exact) -> tuple[str, bool]:
    """Try `exact(variant)` for each casing of `token`; first hit wins.
    All-404 ⇒ a single 'no such board' verdict."""
    for variant in _case_variants(token):
        verdict = exact(variant)
        if verdict is not None:
            return verdict
    return f"{RED}✗ 404 — no such board (tried: {', '.join(_case_variants(token))}){RESET}", False


def check_greenhouse(token: str) -> tuple[str, bool]:
    return _with_case_retry(token, _check_greenhouse_exact)


def check_lever(token: str) -> tuple[str, bool]:
    return _with_case_retry(token, _check_lever_exact)


def check_ashby(token: str) -> tuple[str, bool]:
    status, body = _get(f"https://api.ashbyhq.com/posting-api/job-board/{token}")
    if status == -1:
        return f"{YELLOW}⚠ couldn't reach api.ashbyhq.com — network/proxy? not a verdict{RESET}", False
    if status == 404:
        return f"{RED}✗ 404 — no such Ashby board{RESET}", False
    if not isinstance(body, dict):
        return f"{YELLOW}⚠ unexpected response ({status}){RESET}", False
    jobs = body.get("jobs") or []
    if not jobs:
        return f"{YELLOW}⚠ valid board but 0 jobs — do NOT add{RESET}", False
    return (
        f"{GREEN}✓ REAL — {len(jobs)} jobs{RESET}\n" + _sample(jobs, "title", "location"),
        True,
    )


def check_smartrecruiters(token: str) -> tuple[str, bool]:
    status, body = _get(f"https://api.smartrecruiters.com/v1/companies/{token}/postings?limit=10")
    # SmartRecruiters returns 200 + empty for ANY slug, so a non-empty result
    # is the only signal — and even then, confirm the company out of band.
    rows = (body or {}).get("content") if isinstance(body, dict) else None
    if not rows:
        return (
            f"{YELLOW}⚠ SmartRecruiters always 200s — 0 postings here means "
            f"either wrong slug OR a real company with nothing open. "
            f"Confirm the slug out of band.{RESET}",
            False,
        )
    total = (body or {}).get("totalFound", len(rows))
    return (
        f"{GREEN}✓ {total} postings{RESET} {DIM}(still confirm the slug is this company){RESET}\n"
        + _sample(rows, "name", lambda r: ((r.get("location") or {}).get("city"))),
        True,
    )


def check_bamboohr(token: str) -> tuple[str, bool]:
    """BambooHR careers subdomain (e.g. instabug.bamboohr.com). Public JSON
    at /careers/list — keyless. `token` is the subdomain, NOT the brand name
    (Instabug rebranded to Luciq but the board is still instabug.bamboohr.com)."""
    status, body = _get(f"https://{token}.bamboohr.com/careers/list")
    if status == -1:
        return f"{YELLOW}⚠ couldn't reach {token}.bamboohr.com — network/proxy? not a verdict{RESET}", False
    if status in (403, 404) or not isinstance(body, dict):
        return f"{RED}✗ no BambooHR careers board at {token}.bamboohr.com ({status}){RESET}", False
    rows = body.get("result") or []
    if not rows:
        return f"{YELLOW}⚠ valid BambooHR board but 0 openings — do NOT add{RESET}", False
    return (
        f"{GREEN}✓ REAL — {token}.bamboohr.com, {len(rows)} openings{RESET}\n"
        + _sample(rows, "jobOpeningName", "locationLabel"),
        True,
    )


def check_recruitee(token: str) -> tuple[str, bool]:
    """Recruitee careers subdomain (e.g. moneyhash.recruitee.com). Public
    keyless JSON at /api/offers/ — {"offers": [...]}."""
    status, body = _get(f"https://{token}.recruitee.com/api/offers/")
    if status == -1:
        return f"{YELLOW}⚠ couldn't reach {token}.recruitee.com — network/proxy? not a verdict{RESET}", False
    if status in (403, 404) or not isinstance(body, dict):
        return f"{RED}✗ no Recruitee board at {token}.recruitee.com ({status}){RESET}", False
    rows = body.get("offers") or []
    if not rows:
        return f"{YELLOW}⚠ valid Recruitee board but 0 offers — do NOT add{RESET}", False
    return (
        f"{GREEN}✓ REAL — {token}.recruitee.com, {len(rows)} offers{RESET}\n"
        + _sample(rows, "title", "location"),
        True,
    )


def check_pinpoint(token: str) -> tuple[str, bool]:
    """PinpointHQ. Tries the <token>.pinpointhq.com subdomain and, if the
    token looks like a full host (has a dot), that host directly — Pinpoint
    boards are often on a custom domain like careers.<company>.com.
    JSON at /postings.json — {"data": [...]}."""
    hosts = [f"{token}.pinpointhq.com"] if "." not in token else [token]
    for host in hosts:
        status, body = _get(f"https://{host}/postings.json")
        if status == -1:
            return f"{YELLOW}⚠ couldn't reach {host} — network/proxy? not a verdict{RESET}", False
        if status in (403, 404) or not isinstance(body, dict):
            continue
        rows = body.get("data") or body.get("postings") or []
        if not rows:
            return f"{YELLOW}⚠ valid Pinpoint board at {host} but 0 postings — do NOT add{RESET}", False
        return (
            f"{GREEN}✓ REAL — {host}, {len(rows)} postings{RESET}\n"
            + _sample(rows, "title", lambda r: (r.get("attributes") or r).get("location_name") or (r.get("attributes") or r).get("location")),
            True,
        )
    return f"{RED}✗ no Pinpoint board for '{token}' (tried {', '.join(h + '/postings.json' for h in hosts)}){RESET}", False


CHECKERS = {
    "greenhouse": check_greenhouse,
    "lever": check_lever,
    "ashby": check_ashby,
    "smartrecruiters": check_smartrecruiters,
    "bamboohr": check_bamboohr,
    "recruitee": check_recruitee,
    "pinpoint": check_pinpoint,
}


def tokens_from_config() -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    section = None
    for raw in CONFIG.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].rstrip()
        if not line:
            continue
        if not line.startswith((" ", "-", "\t")) and line.endswith(":"):
            section = line[:-1].strip()
            continue
        if line.lstrip().startswith("-") and section in CHECKERS:
            token = line.lstrip()[1:].strip()
            if section == "workday":  # "Name | host | site" — different check, skip here
                continue
            if token:
                out.append((section, token))
    return out


# Platforms the pipeline can actually poll today (public_sources.py has a
# fetcher + load_extra_job_boards reads the section). A ✓ on any OTHER
# platform is real, but adding it needs a new fetcher first (Lane M3).
PIPELINE_SUPPORTED = {"greenhouse", "lever", "ashby", "smartrecruiters", "pinpoint"}


def _dump(plat: str, tok: str) -> int:
    """Print the raw first posting for a token — so a fetcher can be built
    against the actual field shapes, not a guess. Prints the full top-level
    key list first (so nothing important is lost to truncation), then the
    pretty JSON up to a generous cap."""
    urls = {
        "greenhouse": f"https://boards-api.greenhouse.io/v1/boards/{tok}/jobs?content=true",
        "lever": f"https://api.lever.co/v0/postings/{tok}?mode=json",
        "ashby": f"https://api.ashbyhq.com/posting-api/job-board/{tok}",
        "smartrecruiters": f"https://api.smartrecruiters.com/v1/companies/{tok}/postings?limit=3",
        "bamboohr": f"https://{tok}.bamboohr.com/careers/list",
        "recruitee": f"https://{tok}.recruitee.com/api/offers/",
        "pinpoint": (tok if "." in tok else f"{tok}.pinpointhq.com") + "/postings.json",
    }
    url = urls.get(plat)
    if not url:
        print(f"no dump URL for {plat}")
        return 1
    if not url.startswith("http"):
        url = "https://" + url
    status, body = _get(url)
    print(f"# {url}  (HTTP {status})")

    first = None
    for key in ("jobs", "data", "postings", "offers", "result", "content"):
        if isinstance(body, dict) and isinstance(body.get(key), list) and body[key]:
            print(f"# list key: {key!r}  ({len(body[key])} items)")
            first = body[key][0]
            break
    if first is None and isinstance(body, list) and body:
        print(f"# top-level list  ({len(body)} items)")
        first = body[0]
    if first is None:
        print(json.dumps(body, indent=2, ensure_ascii=False)[:2000] if body else "(empty / unreachable)")
        return 0

    if isinstance(first, dict):
        print("# top-level keys: " + ", ".join(sorted(first)))
        # Nested objects worth seeing in full (Pinpoint stashes a lot under 'job').
        for k in ("job", "location", "locations", "structured_location", "position"):
            if k in first:
                print(f"# first[{k!r}] = " + json.dumps(first[k], ensure_ascii=False)[:1200])
    # Trim only the big HTML-body fields, then pretty-print generously.
    trimmed = {
        k: (v[:120] + "…[trimmed]" if isinstance(v, str) and len(v) > 200 else v)
        for k, v in (first.items() if isinstance(first, dict) else [])
    } or first
    print(json.dumps(trimmed, indent=2, ensure_ascii=False)[:12000])
    return 0


def main(argv: list[str]) -> int:
    if argv and argv[0] == "--dump":
        rest = argv[1:]
        if not rest or ":" not in rest[0]:
            print("usage: verify_extra_boards.py --dump platform:token")
            return 1
        plat, tok = rest[0].split(":", 1)
        return _dump(plat, tok)

    if "--mena" in argv:
        pairs, from_config = MENA_CANDIDATES, False
        print("Candidates surfaced during the MENA push. NB: not all are MENA —\n"
              "e.g. Mercor is San Francisco. Check the sample locations below.\n")
    elif argv:
        pairs, from_config = [], False
        for a in argv:
            if ":" not in a:
                print(f"skip {a!r} — use platform:token")
                continue
            plat, tok = a.split(":", 1)
            if plat not in CHECKERS:
                print(f"skip {a!r} — platform must be one of {', '.join(CHECKERS)}")
                continue
            pairs.append((plat, tok))
    else:
        pairs, from_config = tokens_from_config(), True
        print(f"Re-checking {len(pairs)} tokens already in {CONFIG.name}\n")

    real, dead = [], []
    for plat, tok in pairs:
        verdict, ok = CHECKERS[plat](tok)
        print(f"{plat:15} {tok:24} {verdict}")
        (real if ok else dead).append((plat, tok))

    add_now = [(p, t) for p, t in real if p in PIPELINE_SUPPORTED]
    need_fetcher = [(p, t) for p, t in real if p not in PIPELINE_SUPPORTED]
    if add_now:
        print(f"\n{GREEN}Confirmed — add to config/extra_job_boards.yml now"
              f" (with a '# <city>' note from the samples above):{RESET}")
        for plat, tok in add_now:
            print(f"  {plat}:  - {tok}")
    if need_fetcher:
        print(f"\n{YELLOW}Confirmed real, but the pipeline has no fetcher for these platforms yet"
              f" — build one first (Lane M3), THEN add:{RESET}")
        for plat, tok in need_fetcher:
            print(f"  {plat}:{tok}   (run:  verify_extra_boards.py --dump {plat}:{tok}  to see its JSON shape)")
    if not from_config and dead:
        print(f"\n{DIM}Not confirmed ({len(dead)}): "
              + ", ".join(f"{p}:{t}" for p, t in dead) + RESET)

    return 1 if (from_config and dead) else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
