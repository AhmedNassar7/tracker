"""Shared HTTP + concurrency helpers used by both collector layers
(fetch.py, public_sources.py, fetch_outputs.py, public_outputs.py).
"""

import concurrent.futures
import datetime
import json
import math
import re
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path

# 429 (rate limited) and 5xx (server-side) are worth a backoff-and-retry;
# 4xx otherwise (404, 403, ...) are conclusive answers, not transient.
RETRYABLE_HTTP_STATUSES = {429, 500, 502, 503, 504}


def fetch_with_retry(req, timeout, retries=2, backoff=0.6):
    """Perform urlopen()+read() as one retried unit and return (status, body_bytes).

    Retries transient failures: connection-level errors (timeouts, DNS
    hiccups, resets — including a reset mid-download, since read() happens
    inside the retry loop here rather than in each caller) and 429/5xx HTTP
    responses. A `Retry-After` header on a 429 is honored (capped at 10s) in
    place of the exponential backoff. Non-retryable HTTP errors (404, 403,
    ...) are raised immediately on the first attempt.
    """
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as e:
            if e.code not in RETRYABLE_HTTP_STATUSES or attempt == retries:
                raise
            retry_after = _parse_retry_after(e.headers)
            time.sleep(retry_after if retry_after is not None else backoff * (attempt + 1))
        except urllib.error.URLError:
            if attempt == retries:
                raise
            time.sleep(backoff * (attempt + 1))
    raise AssertionError("unreachable: loop always returns or raises on its last iteration")


def _parse_retry_after(headers, cap_seconds=10):
    value = (headers.get("Retry-After") if headers else None) or ""
    try:
        seconds = float(value)
    except ValueError:
        return None
    if not math.isfinite(seconds):
        return None
    return max(0.0, min(seconds, cap_seconds))


def run_concurrently(fn, arg_tuples, max_workers=10):
    """Run fn(*args) for each entry in arg_tuples on a thread pool and return
    a list of (args, result, exception) triples in arg_tuples order (not
    completion order), so callers get deterministic aggregation. A raised
    exception is captured per-call rather than propagated, so one failing
    call never loses the results already gathered from the others.
    """
    arg_tuples = list(arg_tuples)
    if not arg_tuples:
        return []
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(arg_tuples), max_workers)) as pool:
        futures = [(args, pool.submit(fn, *args)) for args in arg_tuples]
        results = []
        for args, future in futures:
            try:
                results.append((args, future.result(), None))
            except Exception as exc:
                results.append((args, None, exc))
    return results


def run_and_collect(fn, arg_tuples, log_error, max_workers=10, label=None):
    """run_concurrently() plus the aggregation policy both collector layers
    want: concatenate each call's list result (in arg_tuples order), and for
    a call that raised, log the message + full traceback and skip its
    contribution rather than losing every other call's results too.
    `label(args)` customizes the logged identifier for a failed call
    (defaults to `repr(args)`).
    """
    label = label or repr
    combined = []
    for args, result, exc in run_concurrently(fn, arg_tuples, max_workers=max_workers):
        if exc is not None:
            log_error(f"{fn.__name__} failed for {label(args)}: {exc}")
            traceback.print_exception(exc)
        else:
            combined += result
    return combined


# Some career sites are client-rendered SPAs: an expired/removed job id still
# returns HTTP 200 with a generic shell instead of a 404, so a status-code
# check alone can never catch it dead (unlike the Pinterest case in
# check_url_alive's docstring, where the eventual GET at least returns the
# right code). The only tell is a server-rendered marker in the HTML. Each
# entry below is (url_regex, dead_markers, alive_markers) and must be
# confirmed by hand against real live vs. expired postings before being added
# — never on suspicion, since a wrong guess here silently archives a live
# posting. For a matching URL, check_url_alive skips the HEAD short-circuit,
# GETs the body (capped), and calls it dead if any dead_marker is present, or
# if alive_markers is non-empty and none of them are present.
#
# - Google Careers result pages: the og:title meta tag holds the real job
#   title on a live posting and is emptied on an expired one. The marker
#   sits ~980KB into a ~1.3MB document, hence the large cap.
# - jobs.apple.com/*/details/* and joinbytedance.com/search/* are SPA
#   detail pages: a live posting is server-rendered with a
#   `<meta property="og:title">` tag, an expired/removed one falls back to a
#   generic ~155KB / ~69KB shell with no og:title at all. Confirmed by hand
#   2026-09-05 against several live vs. stale postings from the vanshb03
#   tracker (which lists Apple roles months after they close). These are
#   alive-marker rules: dead iff the og:title tag is absent.
_SOFT_404_RULES = (
    (
        re.compile(r"^https?://(?:www\.)?google\.com/about/careers/applications/jobs/results/"),
        ('<meta property="og:title" content="">',),
        (),
    ),
    (
        re.compile(r"^https?://(?:www\.)?jobs\.apple\.com/[^?#]*/details/"),
        (),
        ('property="og:title"',),
    ),
    (
        # joinbytedance.com/{search,jobs}/<id> is the canonical host;
        # jobs.bytedance.com/<locale>/position/<id> 302-redirects to it, so
        # match both — otherwise a jobs.bytedance.com link (Simplify uses
        # these) skips the body check and a removed posting reads as alive.
        re.compile(
            r"^https?://(?:www\.)?(?:joinbytedance\.com/(?:search|jobs)"
            r"|jobs\.bytedance\.com/[a-z-]+/position)/"
        ),
        (),
        ('property="og:title"',),
    ),
)
_SOFT_404_BODY_CAP = 1_200_000

# LinkedIn bot-blocks the plain apply URL (a 999/429 that check_url_alive can
# only read as "can't tell"), but its unauthenticated guest job-posting
# fragment IS reachable with a browser UA and is small. A closed posting
# renders "No longer accepting applications" in that fragment (confirmed by
# hand); a removed id 404s or returns an empty body. Sources like
# LorenzoLaCorte's tracker point every apply link at linkedin.com/jobs/view/<id>,
# so without this the layer republishes closed LinkedIn postings indefinitely.
_LINKEDIN_JOB_RE = re.compile(
    r"^https?://(?:[\w-]+\.)?linkedin\.com/jobs/view/(?:[^/?#]*-)?(\d+)"
)
_LINKEDIN_GUEST_JOB_URL = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{job_id}"
_LINKEDIN_CLOSED_MARKER = "no longer accepting applications"
_LINKEDIN_GUEST_BODY_CAP = 200_000
_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)


def _match_soft_404_rule(url):
    for pattern, dead_markers, alive_markers in _SOFT_404_RULES:
        if pattern.match(url):
            return dead_markers, alive_markers
    return None


def _linkedin_job_id(url):
    match = _LINKEDIN_JOB_RE.match(url or "")
    return match.group(1) if match else None


def _linkedin_posting_alive(job_id, timeout, attempts=3):
    """Liveness for a linkedin.com/jobs/view/<id> apply link via the
    unauthenticated guest fragment.

    Unlike check_url_alive's global "can't tell -> assume alive" default,
    an inconclusive read here (bot-block, empty fragment, timeout — even
    after `attempts` retries) resolves to **dead**. Rationale: LinkedIn
    scraped links (the entire lorenzolacorte_eu feed) are the lowest-trust
    input in the pipeline and go stale within days, LinkedIn aggressively
    rate-limits a burst of guest-API calls from one IP, and a curated-layer
    archive is fully reversible — the row comes straight back on a later run
    once LinkedIn answers. Publishing a "No longer accepting applications"
    page one more time is the worse outcome. A clean fragment with no closed
    marker is still trusted as live.
    """
    for attempt in range(attempts):
        req = urllib.request.Request(
            _LINKEDIN_GUEST_JOB_URL.format(job_id=job_id),
            headers={"User-Agent": _BROWSER_UA, "Accept": "text/html"},
            method="GET",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                body = response.read(_LINKEDIN_GUEST_BODY_CAP).decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                return False
            # 429 / 999 bot-block — back off and retry
        except Exception:
            pass  # timeout / connection reset — back off and retry
        else:
            if _LINKEDIN_CLOSED_MARKER in body.lower():
                return False
            if body.strip():
                return True  # real fragment, no closed marker -> live
            # empty fragment -> fall through to retry
        if attempt < attempts - 1:
            time.sleep(0.7 * (attempt + 1))
    return False  # never got a conclusive "alive" read -> treat as dead


def check_url_alive(url, timeout=6):
    """Best-effort liveness check for a posting's apply link. Shared by both
    collector layers — originally curated-only (fetch.py), now also used by
    the public layer (public_outputs.py), since a Greenhouse/Lever/Workday/
    Ashby/SmartRecruiters/Devpost/Unstop/Devfolio/Luma link can go dead
    exactly the same way a curated one can.

    Only a 404/410 confirmed by a GET counts as dead — a HEAD-only 404 is
    not trusted on its own, since some ATS pages (observed on Pinterest's
    careers site) mishandle HEAD and 404 it while the page is genuinely
    live on GET. Anything else (403 bot-blocking, 429 rate limits,
    timeouts, DNS hiccups) is treated as "can't tell, assume alive" so a
    flaky check never wrongly archives a live posting.

    Two source-specific exceptions to the status-code rule, each confirmed by
    hand (see _SOFT_404_RULES and the LinkedIn helpers above):
    - Soft-404 SPAs (Google Careers result pages, jobs.apple.com and
      joinbytedance.com detail pages) always return 200 live or expired, so
      this skips the HEAD short-circuit and reads the GET body far enough to
      check a dead/alive marker — still "assume alive" if no marker matches.
    - linkedin.com/jobs/view/<id> links are checked via LinkedIn's
      unauthenticated guest fragment instead of the bot-blocked apply URL.
    """
    if not url:
        return True

    linkedin_id = _linkedin_job_id(url)
    if linkedin_id:
        return _linkedin_posting_alive(linkedin_id, timeout)

    soft_404_rule = _match_soft_404_rule(url)
    methods = ("GET",) if soft_404_rule else ("HEAD", "GET")
    for method in methods:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "tracker-bot/1.0"}, method=method)
            with urllib.request.urlopen(req, timeout=timeout) as response:
                if soft_404_rule:
                    dead_markers, alive_markers = soft_404_rule
                    body = response.read(_SOFT_404_BODY_CAP).decode("utf-8", errors="replace")
                    if any(marker in body for marker in dead_markers):
                        return False
                    if alive_markers and not any(marker in body for marker in alive_markers):
                        return False
                    return True
                return response.status < 400
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                if method == "HEAD":
                    continue  # unreliable on some servers; confirm with a GET before trusting it
                return False  # GET also says gone -> genuinely dead
            if e.code == 405 and method == "HEAD":
                continue  # some ATS boards reject HEAD entirely; retry with GET
            return True
        except Exception:
            return True
    return True


# ---------------------------------------------------------------------------
# Persistent link-liveness cache
#
# The hourly run re-verifies every published apply URL, but the vast majority
# were confirmed alive an hour ago and haven't changed. Caching a positive
# result for a short window turns "check ~3000 URLs" into "check the few
# hundred that are new or whose cache entry expired" — the single biggest
# lever on wall-clock time. Only *alive* results are cached (a dead/unknown
# link is always re-checked, so a fixed posting recovers on the next run and
# a stale cache can never keep a dead link published).
# ---------------------------------------------------------------------------

LINK_CACHE_TTL_HOURS = 12
LINK_CACHE_PRUNE_DAYS = 7
_ISO_FMT = "%Y-%m-%dT%H:%M:%SZ"


def _parse_iso(value):
    return datetime.datetime.strptime(value, _ISO_FMT).replace(tzinfo=datetime.timezone.utc)


def load_link_cache(path):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return {}
    entries = data.get("entries") if isinstance(data, dict) else None
    return entries if isinstance(entries, dict) else {}


def save_link_cache(path, entries, now_iso):
    try:
        payload = {"generated_at": now_iso, "entries": dict(sorted(entries.items()))}
        Path(path).write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    except Exception:
        pass


def resolve_link_liveness(urls, *, cache, now_iso, check_fn, max_workers=40, ttl_hours=LINK_CACHE_TTL_HOURS):
    """Return {url: alive_bool} for every url in `urls`.

    A url recorded alive in `cache` within `ttl_hours` is trusted without a
    network call. Everything else is checked concurrently via `check_fn`
    (which must never raise — a caught exception degrades to "assume alive",
    matching check_url_alive's own contract). `cache` is mutated in place:
    fresh alive results are written, dead results are removed, and entries
    older than LINK_CACHE_PRUNE_DAYS (URLs long gone from every feed) are
    pruned. Callers persist it with save_link_cache().
    """
    now = _parse_iso(now_iso)
    result = {}
    to_check = []
    for url in urls:
        if not url:
            result[url] = True
            continue
        entry = cache.get(url)
        if entry and entry.get("alive") is True:
            try:
                age_hours = (now - _parse_iso(entry["at"])).total_seconds() / 3600
            except Exception:
                age_hours = ttl_hours + 1
            if 0 <= age_hours <= ttl_hours:
                result[url] = True
                continue
        to_check.append(url)

    if to_check:
        checked = run_concurrently(check_fn, [(u,) for u in to_check], max_workers=max_workers)
        for (url,), alive, exc in checked:
            is_alive = True if exc is not None else bool(alive)
            result[url] = is_alive
            if is_alive:
                cache[url] = {"alive": True, "at": now_iso}
            else:
                cache.pop(url, None)

    cutoff = now - datetime.timedelta(days=LINK_CACHE_PRUNE_DAYS)
    for url in list(cache):
        try:
            if _parse_iso(cache[url]["at"]) < cutoff:
                del cache[url]
        except Exception:
            del cache[url]

    return result


def find_dead_links(rows, timeout=8):
    """Return the subset of rows whose apply URL is definitively dead.

    This is a project-level audit helper for checking an exported dataset. It
    intentionally mirrors the production liveness policy: only a confirmed GET
    404/410 is treated as dead; everything else is treated as "can't tell" and
    therefore remains alive.
    """
    dead = []
    for row in rows:
        url = (row or {}).get("url")
        if not url:
            continue
        if not check_url_alive(url, timeout=timeout):
            dead.append({
                "company": row.get("company", ""),
                "title": row.get("title", ""),
                "url": url,
                "source": row.get("source", ""),
            })
    return dead
