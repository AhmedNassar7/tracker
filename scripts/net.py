"""Shared HTTP + concurrency helpers used by both collector layers
(fetch.py, public_sources.py, fetch_outputs.py, public_outputs.py).
"""

import concurrent.futures
import math
import re
import time
import traceback
import urllib.error
import urllib.request

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
        re.compile(r"^https?://(?:www\.)?joinbytedance\.com/(?:search|jobs)/"),
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


def check_url_alive(url, timeout=8):
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
