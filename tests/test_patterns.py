import contextlib
import importlib.util
import io
from pathlib import Path

GREEN = "\033[32m"
RED = "\033[31m"
RESET = "\033[0m"

ROOT = Path(__file__).resolve().parents[1]


def color(text, code):
    return f"{code}{text}{RESET}"


def load_module(rel_path, name):
    module_path = ROOT / rel_path
    spec = importlib.util.spec_from_file_location(name, module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        spec.loader.exec_module(module)
    return module


def check(name, condition, details=""):
    if not condition:
        raise AssertionError(f"{name} failed{': ' + details if details else ''}")


def main():
    p = load_module("scripts/patterns.py", "patterns_module_for_test")

    total = 0

    def run(name, fn):
        nonlocal total
        total += 1
        fn()
        print(color(f"✅ {name}", GREEN))

    # ---- detect_tech_tags -------------------------------------------------
    def _tags_basic():
        tags = p.detect_tech_tags(
            "Strong Python fundamentals and experience with Go; deploy on Kubernetes to AWS."
        )
        check("python found", "Python" in tags)
        check("go found via 'with Go'", "Go" in tags, repr(tags))
        check("k8s found", "Kubernetes" in tags)
        check("aws found", "AWS" in tags)
        check("no phantom java", "Java" not in tags, repr(tags))
        check("golang shorthand also works", "Go" in p.detect_tech_tags("We write everything in Golang."))
    run("detect_tech_tags: python/go/k8s/aws", _tags_basic)

    def _tags_java_not_javascript():
        check("javascript only", p.detect_tech_tags("Strong JavaScript / TypeScript skills") == ["TypeScript", "JavaScript"])
        check("java distinct from javascript", "Java" not in p.detect_tech_tags("modern JavaScript frameworks"))
        check("real java detected", "Java" in p.detect_tech_tags("5 years of Java and Spring Boot"))
    run("detect_tech_tags: Java vs JavaScript", _tags_java_not_javascript)

    def _tags_react_native():
        rn = p.detect_tech_tags("React Native mobile engineer")
        check("react native tag", "React Native" in rn)
        check("bare react not double-counted", "React" not in rn, repr(rn))
        check("plain react still works", "React" in p.detect_tech_tags("React and Redux on the frontend"))
    run("detect_tech_tags: React Native vs React", _tags_react_native)

    def _tags_go_false_positive():
        # "go" as an ordinary verb must not be tagged as the language.
        check("no go from prose", "Go" not in p.detect_tech_tags("a great place to go and grow your career"))
        check("no spark from prose", "Spark" not in p.detect_tech_tags("we want people who spark joy"))
        check("no spring from season", "Spring" not in p.detect_tech_tags("internship starts in Spring 2027"))
        check("no rust from prose", "Rust" not in p.detect_tech_tags("in the rust belt region"))
    run("detect_tech_tags: rejects ambiguous prose", _tags_go_false_positive)

    def _tags_empty():
        check("empty text -> []", p.detect_tech_tags("") == [])
        check("no tech -> []", p.detect_tech_tags("We value teamwork and communication") == [])
    run("detect_tech_tags: empty / none", _tags_empty)

    # ---- detect_requirements -------------------------------------------------
    def _req_visa_positive():
        r = p.detect_requirements("We offer visa sponsorship for the right candidate.")
        check("visa true", r.get("visa_sponsorship") is True, repr(r))
    run("detect_requirements: visa sponsorship (positive)", _req_visa_positive)

    def _req_visa_negative():
        r = p.detect_requirements("Unfortunately we are not able to sponsor visas for this role.")
        check("visa false", r.get("visa_sponsorship") is False, repr(r))
        r2 = p.detect_requirements("Applicants must be authorized to work in the US without sponsorship.")
        check("visa false via authorized-without", r2.get("visa_sponsorship") is False, repr(r2))
    run("detect_requirements: visa sponsorship (negative wins)", _req_visa_negative)

    def _req_visa_silent():
        r = p.detect_requirements("Great team, competitive benefits, hybrid in Berlin.")
        check("visa absent when unstated", "visa_sponsorship" not in r, repr(r))
    run("detect_requirements: visa unstated -> absent", _req_visa_silent)

    def _req_degree():
        check(
            "degree required",
            p.detect_requirements("A Bachelor's degree in Computer Science is required.").get("degree_required") is True,
        )
        check(
            "no degree",
            p.detect_requirements("No degree required — we care about what you can build.").get("degree_required") is False,
        )
        check(
            "equivalent practical experience -> not required",
            p.detect_requirements("Bachelor's degree or equivalent practical experience.").get("degree_required") is False,
        )
        check("degree unstated -> absent", "degree_required" not in p.detect_requirements("Join our platform team."))
    run("detect_requirements: degree", _req_degree)

    def _req_relocation():
        check(
            "relocation offered",
            p.detect_requirements("Relocation assistance is available for this position.").get("relocation") is True,
        )
        check(
            "relocation denied",
            p.detect_requirements("This role offers no relocation.").get("relocation") is False,
        )
        check("relocation unstated -> absent", "relocation" not in p.detect_requirements("Remote-first company."))
    run("detect_requirements: relocation", _req_relocation)

    # ---- parse_salary ---------------------------------------------------------
    def _salary_usd_comma():
        s = p.parse_salary("The base salary range is $120,000 - $160,000 per year plus equity.")
        check("usd range parsed", s == {"min": 120000, "max": 160000, "currency": "USD", "period": "year"}, repr(s))
    run("parse_salary: $120,000 - $160,000 / year", _salary_usd_comma)

    def _salary_k_shorthand():
        s = p.parse_salary("Compensation: £45k–£60k depending on experience")
        check("gbp k-range parsed", s == {"min": 45000, "max": 60000, "currency": "GBP", "period": "year"}, repr(s))
    run("parse_salary: £45k–£60k", _salary_k_shorthand)

    def _salary_hourly():
        s = p.parse_salary("Pay rate: $22 to $28 per hour")
        check("hourly parsed", s == {"min": 22, "max": 28, "currency": "USD", "period": "hour"}, repr(s))
    run("parse_salary: hourly", _salary_hourly)

    def _salary_reject_junk():
        check("no currency -> None", p.parse_salary("between 5 and 10 years of experience") is None)
        check("single number -> None", p.parse_salary("salary is $100,000") is None)
        check("absurd spread -> None", p.parse_salary("$5 - $500,000") is None)
        check("min>max -> None", p.parse_salary("$90,000 - $80,000") is None)
        check("out of annual bounds -> None", p.parse_salary("$5,000 - $9,000 per year") is None)
    run("parse_salary: rejects non-salary / junk ranges", _salary_reject_junk)

    def _salary_euro_infer_year():
        s = p.parse_salary("€55,000 - €70,000")
        check("euro inferred annual", s == {"min": 55000, "max": 70000, "currency": "EUR", "period": "year"}, repr(s))
    run("parse_salary: infers annual from magnitude", _salary_euro_infer_year)

    # ---- extract_job_facets -------------------------------------------------
    def _facets_merge():
        f = p.extract_job_facets(
            "Software Engineer, New Grad",
            "London, UK",
            "You'll write TypeScript and Go. Visa sponsorship available. "
            "Bachelor's degree or equivalent practical experience. "
            "Base pay £55,000 - £75,000 per year.",
        )
        check("tech_tags present", set(f.get("tech_tags", [])) >= {"TypeScript", "Go"}, repr(f))
        check("visa true", f.get("visa_sponsorship") is True, repr(f))
        check("degree not required", f.get("degree_required") is False, repr(f))
        check("salary parsed", f.get("salary", {}).get("currency") == "GBP", repr(f))
    run("extract_job_facets: merges all facets", _facets_merge)

    def _facets_minimal():
        f = p.extract_job_facets("Backend Engineer", "Remote", "")
        check("no fabricated keys", set(f) <= {"tech_tags"}, repr(f))
        check("backend title yields no tech tag", "tech_tags" not in f, repr(f))
    run("extract_job_facets: nothing asserted from a bare title", _facets_minimal)

    print(color(f"✅ ALL PASSED: {total} checks", GREEN))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as exc:
        print(color(f"❌ TEST FAILED: {exc}", RED))
        raise SystemExit(1)
    except Exception as exc:
        print(color(f"❌ TEST ERROR: {exc}", RED))
        raise SystemExit(1)
