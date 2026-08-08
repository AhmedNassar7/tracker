"""Shared HTTP + concurrency helpers used by both collector layers
(fetch.py, public_sources.py, fetch_outputs.py).
"""

import concurrent.futures
import math
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
