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

Usage
-----
  # Re-check every token already in config/extra_job_boards.yml:
  python scripts/verify_extra_boards.py

  # Check specific candidates (platform:token, space-separated):
  python scripts/verify_extra_boards.py greenhouse:swvl greenhouse:paymob \\
      ashby:telda ashby:nawy lever:mnthalan

  # Check the MENA candidate shortlist baked in below:
  python scripts/verify_extra_boards.py --mena

Exit code is non-zero if any *config* token (not a candidate) came back dead
or empty, so this can gate CI later if wanted.
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

# MENA / Gulf / North Africa shortlist — platform + token guesses.
# `--mena` verifies these; move the confirmed ones into extra_job_boards.yml.
#
# 2026-09-06: a first pass 404'd on every Greenhouse/Lever guess — because
# **Lever/Greenhouse tokens are case-sensitive** and the guesses were all
# lowercase. Hand research then found real boards:
#   Bosta   → jobs.lever.co/Bosta        (Cairo — VERIFIED, added to lever:)
#   Tabby   → tabby.pinpointhq.com       (PinpointHQ — a 6th ATS, no fetcher)
# The checker now auto-retries a few case variants, so a lowercase guess that
# has a Title-case real board will still be found. Update tokens as you learn
# the real ones from a company's "Powered by <ATS>" careers footer.
MENA_CANDIDATES = [
    ("lever", "Bosta"),
    ("lever", "MNT-Halan"),
    ("lever", "mnt-halan"),
    ("lever", "Halan"),
    ("lever", "Trella"),
    ("greenhouse", "swvl"),
    ("greenhouse", "paymob"),
    ("greenhouse", "instabug"),
    ("greenhouse", "rasan"),
    ("greenhouse", "foodics"),
    ("greenhouse", "unifonic"),
    ("greenhouse", "zid"),
    ("greenhouse", "salla"),
    ("greenhouse", "sary"),
    ("greenhouse", "tabby"),
    ("greenhouse", "huspy"),
    ("greenhouse", "nawy"),
    ("greenhouse", "sylndr"),
    ("greenhouse", "telda"),
    ("ashby", "telda"),
    ("ashby", "moneyhash"),
    ("ashby", "nawy"),
    ("ashby", "sylndr"),
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
    """(status, parsed-json) — raises nothing; returns (code, None) on any error."""
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception:
        return 0, None


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


CHECKERS = {
    "greenhouse": check_greenhouse,
    "lever": check_lever,
    "ashby": check_ashby,
    "smartrecruiters": check_smartrecruiters,
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


def main(argv: list[str]) -> int:
    if "--mena" in argv:
        pairs, from_config = MENA_CANDIDATES, False
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
        print(f"{plat:15} {tok:22} {verdict}")
        (real if ok else dead).append((plat, tok))

    if real:
        print(f"\n{GREEN}Confirmed — safe to add to config/extra_job_boards.yml:{RESET}")
        for plat, tok in real:
            print(f"  {plat}:  - {tok}")
    if not from_config and dead:
        print(f"\n{DIM}Not adding ({len(dead)}): "
              + ", ".join(f"{p}:{t}" for p, t in dead) + RESET)

    # Only fail the process for tokens that are supposed to be live already.
    return 1 if (from_config and dead) else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
