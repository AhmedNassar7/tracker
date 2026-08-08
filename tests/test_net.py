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

    print(color(f"✅ ALL PASSED: {total} checks", GREEN))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
