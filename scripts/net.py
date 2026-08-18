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


# Google Careers is a client-rendered SPA: an expired/removed job id still
# returns HTTP 200 with the generic "Jobs search" shell instead of a 404, so
# a status-code check alone can never catch it dead (unlike the Pinterest
# case in check_url_alive's docstring, where the eventual GET at least
# returns the right code). The one server-rendered difference is the
# og:title meta tag — populated with the real job title on a live posting,
# left empty on an expired one. Confirmed by hand against several live vs.
# expired postings; only add another entry here once a new source's
# soft-404 shape is confirmed the same way, not on suspicion.
_GOOGLE_CAREERS_RESULT_RE = re.compile(
    r"^https?://(?:www\.)?google\.com/about/careers/applications/jobs/results/"
)
_GOOGLE_CAREERS_DEAD_MARKER = '<meta property="og:title" content="">'
# The marker sits ~980KB into a ~1.3MB document; capped read keeps this
# bounded instead of downloading the whole page every time.
_SOFT_404_BODY_CAP = 1_200_000


def _is_google_careers_result(url):
    return bool(_GOOGLE_CAREERS_RESULT_RE.match(url))


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

    Google Careers result pages are a separate case: they always return
    200, live or expired, so this skips the HEAD short-circuit for them and
    reads the GET body far enough to check the og:title marker described
    above — still "can't tell, assume alive" if the marker isn't found.
    """
    if not url:
        return True
    needs_body_check = _is_google_careers_result(url)
    methods = ("GET",) if needs_body_check else ("HEAD", "GET")
    for method in methods:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "tracker-bot/1.0"}, method=method)
            with urllib.request.urlopen(req, timeout=timeout) as response:
                if needs_body_check:
                    body = response.read(_SOFT_404_BODY_CAP).decode("utf-8", errors="replace")
                    return _GOOGLE_CAREERS_DEAD_MARKER not in body
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
