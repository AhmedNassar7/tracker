import contextlib
import importlib.util
import io
import time
import urllib.error
from pathlib import Path
from unittest.mock import patch


GREEN = "\033[32m"
RESET = "\033[0m"


def color(text, code):
    return f"{code}{text}{RESET}"


def load_module():
    module_path = Path(__file__).resolve().parents[1] / "scripts" / "net.py"
    spec = importlib.util.spec_from_file_location("net_module", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        spec.loader.exec_module(module)
    return module


def check(name, condition, details=""):
    if not condition:
        raise AssertionError(f"{name} failed{': ' + details if details else ''}")


class _FakeResponse:
    def __init__(self, status=200, body=b"ok", headers=None):
        self.status = status
        self._body = body
        self.headers = headers or {}

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def main():
    net = load_module()
    total = 0

    def run(name, fn):
        nonlocal total
        total += 1
        fn()
        print(color(f"✅ {name}", GREEN))

    with patch("urllib.request.urlopen", return_value=_FakeResponse(200, b"hello")):
        status, body = net.fetch_with_retry(object(), timeout=5)
        run("fetch_with_retry succeeds on first try", lambda: check(
            "fetch_with_retry succeeds on first try",
            status == 200 and body == b"hello",
        ))

    with patch("urllib.request.urlopen", side_effect=urllib.error.HTTPError("u", 404, "Not Found", {}, None)):
        try:
            net.fetch_with_retry(object(), timeout=5)
            raised = False
        except urllib.error.HTTPError as e:
            raised = e.code == 404
        run("fetch_with_retry does not retry a non-retryable HTTP error", lambda: check(
            "fetch_with_retry does not retry a non-retryable HTTP error",
            raised is True,
        ))

    call_count = {"n": 0}

    def flaky_then_ok(*_args, **_kwargs):
        call_count["n"] += 1
        if call_count["n"] < 3:
            raise urllib.error.URLError("connection reset")
        return _FakeResponse(200, b"recovered")

    with patch("urllib.request.urlopen", side_effect=flaky_then_ok), patch("time.sleep", return_value=None):
        status, body = net.fetch_with_retry(object(), timeout=5, retries=2)
        run("fetch_with_retry retries transient URLError and recovers", lambda: check(
            "fetch_with_retry retries transient URLError and recovers",
            status == 200 and body == b"recovered" and call_count["n"] == 3,
        ))

    with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("timed out")), patch("time.sleep", return_value=None):
        try:
            net.fetch_with_retry(object(), timeout=5, retries=2)
            raised = False
        except urllib.error.URLError:
            raised = True
        run("fetch_with_retry raises after exhausting retries on persistent URLError", lambda: check(
            "fetch_with_retry raises after exhausting retries on persistent URLError",
            raised is True,
        ))

    rate_limit_calls = {"n": 0}

    def rate_limited_then_ok(*_args, **_kwargs):
        rate_limit_calls["n"] += 1
        if rate_limit_calls["n"] == 1:
            raise urllib.error.HTTPError("u", 429, "Too Many Requests", {}, None)
        return _FakeResponse(200, b"ok-after-429")

    with patch("urllib.request.urlopen", side_effect=rate_limited_then_ok), patch("time.sleep", return_value=None):
        status, body = net.fetch_with_retry(object(), timeout=5, retries=2)
        run("fetch_with_retry retries a 429 and recovers", lambda: check(
            "fetch_with_retry retries a 429 and recovers",
            status == 200 and body == b"ok-after-429",
        ))

    sleep_calls = []
    with patch("urllib.request.urlopen", side_effect=urllib.error.HTTPError("u", 429, "Too Many Requests", {"Retry-After": "3"}, None)), \
         patch("time.sleep", side_effect=lambda s: sleep_calls.append(s)):
        try:
            net.fetch_with_retry(object(), timeout=5, retries=1)
        except urllib.error.HTTPError:
            pass
        run("fetch_with_retry honors a Retry-After header on 429", lambda: check(
            "fetch_with_retry honors a Retry-After header on 429",
            sleep_calls == [3.0],
            details=str(sleep_calls),
        ))

    def slow_then_fast(delay, label):
        time.sleep(delay)
        return [label]

    with patch("time.sleep", return_value=None):
        # First arg tuple sleeps "longer" (irrelevant once patched to a no-op),
        # but result order must still follow arg_tuples order, not completion order.
        results = net.run_concurrently(slow_then_fast, [(0.05, "first"), (0.0, "second")], max_workers=2)
        run("run_concurrently preserves arg_tuples order over completion order", lambda: check(
            "run_concurrently preserves arg_tuples order over completion order",
            [r[1] for r in results] == [["first"], ["second"]],
            details=str(results),
        ))

    def maybe_raise(n):
        if n == 2:
            raise ValueError("boom")
        return n * 10

    results = net.run_concurrently(maybe_raise, [(1,), (2,), (3,)], max_workers=3)
    run("run_concurrently isolates a per-call exception without losing other results", lambda: check(
        "run_concurrently isolates a per-call exception without losing other results",
        results[0] == ((1,), 10, None)
        and results[1][1] is None and isinstance(results[1][2], ValueError)
        and results[2] == ((3,), 30, None),
        details=str(results),
    ))

    run("run_concurrently returns empty list for empty input", lambda: check(
        "run_concurrently returns empty list for empty input",
        net.run_concurrently(maybe_raise, []) == [],
    ))

    run("_parse_retry_after clamps a negative Retry-After to zero", lambda: check(
        "_parse_retry_after clamps a negative Retry-After to zero",
        net._parse_retry_after({"Retry-After": "-5"}) == 0.0,
    ))

    run("_parse_retry_after rejects a non-finite Retry-After instead of crashing", lambda: check(
        "_parse_retry_after rejects a non-finite Retry-After instead of crashing",
        net._parse_retry_after({"Retry-After": "nan"}) is None
        and net._parse_retry_after({"Retry-After": "inf"}) is None,
    ))

    run("_parse_retry_after caps an oversized Retry-After", lambda: check(
        "_parse_retry_after caps an oversized Retry-After",
        net._parse_retry_after({"Retry-After": "999"}, cap_seconds=10) == 10.0,
    ))

    def double(n):
        if n == 2:
            raise ValueError("boom")
        return [n * 2]

    errors = []
    combined = net.run_and_collect(double, [(1,), (2,), (3,)], lambda msg: errors.append(msg), max_workers=3)
    run("run_and_collect concatenates successful results and logs a failing call", lambda: check(
        "run_and_collect concatenates successful results and logs a failing call",
        combined == [2, 6] and len(errors) == 1 and "boom" in errors[0],
        details=f"combined={combined!r} errors={errors!r}",
    ))

    labeled_errors = []
    net.run_and_collect(
        double, [(2,)], lambda msg: labeled_errors.append(msg), label=lambda args: f"n={args[0]}",
    )
    run("run_and_collect uses the custom label in its error message", lambda: check(
        "run_and_collect uses the custom label in its error message",
        labeled_errors and "n=2" in labeled_errors[0],
        details=str(labeled_errors),
    ))

    # resolve_link_liveness: a fresh cached "alive" is trusted without a
    # network call; a stale entry, an unknown url, and a previously-dead url
    # are all re-checked; dead results are dropped from the cache.
    calls_made = []

    def fake_check(url):
        calls_made.append(url)
        return url != "https://dead.example"

    now = "2026-09-05T12:00:00Z"
    cache = {
        "https://fresh.example": {"alive": True, "at": "2026-09-05T06:00:00Z"},   # 6h old -> trusted
        "https://stale.example": {"alive": True, "at": "2026-09-04T00:00:00Z"},   # 36h old -> re-check
        "https://ancient.example": {"alive": True, "at": "2026-08-01T00:00:00Z"}, # > prune window
    }
    result = net.resolve_link_liveness(
        ["https://fresh.example", "https://stale.example", "https://new.example", "https://dead.example", ""],
        cache=cache, now_iso=now, check_fn=fake_check,
    )
    run("resolve_link_liveness skips fresh-cached urls and re-checks the rest", lambda: check(
        "resolve_link_liveness",
        "https://fresh.example" not in calls_made
        and set(calls_made) == {"https://stale.example", "https://new.example", "https://dead.example"}
        and result["https://fresh.example"] is True
        and result["https://dead.example"] is False
        and result[""] is True
        and "https://dead.example" not in cache            # dead result not cached
        and "https://ancient.example" not in cache          # pruned
        and cache["https://new.example"]["alive"] is True,  # new alive result stored
        details=f"calls={calls_made} cache_keys={sorted(cache)}",
    ))

    print(color(f"✅ ALL PASSED: {total} checks", GREEN))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
