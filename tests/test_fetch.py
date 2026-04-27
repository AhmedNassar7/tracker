import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


def load_fetch_module():
    module_path = Path(__file__).resolve().parents[1] / "scripts" / "fetch.py"
    spec = importlib.util.spec_from_file_location("fetch_module", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class FetchPipelineTests(unittest.TestCase):
    def setUp(self):
        self.fetch = load_fetch_module()

    def test_make_id_is_stable_and_16_chars(self):
        a = self.fetch.make_id("Google", "Software Engineer", "https://example.com/1")
        b = self.fetch.make_id("Google", "Software Engineer", "https://example.com/1")
        c = self.fetch.make_id("Meta", "Software Engineer", "https://example.com/1")

        self.assertEqual(a, b)
        self.assertNotEqual(a, c)
        self.assertEqual(len(a), 16)

    def test_detect_level_region_and_remote_type(self):
        self.assertEqual(self.fetch.detect_level("Software Engineer Intern"), "internship")
        self.assertEqual(self.fetch.detect_level("Junior Backend Engineer"), "junior")
        self.assertEqual(self.fetch.detect_region("Toronto, Canada"), "canada")
        self.assertEqual(self.fetch.detect_region("Berlin, Germany"), "emea")
        self.assertEqual(self.fetch.detect_region("Remote - Worldwide"), "remote")
        self.assertEqual(self.fetch.detect_remote_type("Remote - Worldwide"), "remote")
        self.assertEqual(self.fetch.detect_remote_type("Hybrid - London"), "hybrid")
        self.assertEqual(self.fetch.detect_remote_type("Austin, USA"), "onsite")

    def test_is_allowed_company_works_with_substring(self):
        with patch.object(self.fetch, "ALLOWLIST", ["google", "microsoft"]):
            self.assertTrue(self.fetch.is_allowed_company("Google LLC"))
            self.assertTrue(self.fetch.is_allowed_company("Microsoft Corporation"))
            self.assertFalse(self.fetch.is_allowed_company("Small Startup Inc"))

    def test_normalize_has_required_keys(self):
        with patch.object(self.fetch, "NOW_ISO", "2026-01-01T00:00:00Z"):
            row = self.fetch.normalize(
                company="Google",
                title="Software Engineer Intern",
                location="Remote - USA",
                url="https://example.com/job",
                posted_at="2026-01-02",
                source="remotive",
                source_url="https://remotive.com",
            )

        required = {
            "id",
            "company",
            "title",
            "level",
            "region",
            "country",
            "location",
            "remote_type",
            "url",
            "source",
            "source_url",
            "posted_at",
            "collected_at",
            "tags",
        }
        self.assertTrue(required.issubset(set(row.keys())))
        self.assertEqual(row["level"], "internship")
        self.assertEqual(row["region"], "remote")
        self.assertEqual(row["remote_type"], "remote")

    def test_dedupe_removes_duplicates(self):
        rows = [
            {
                "id": "1111111111111111",
                "company": "Google",
                "title": "Software Engineer",
            },
            {
                "id": "1111111111111111",
                "company": "Google",
                "title": "Software Engineer",
            },
            {
                "id": "2222222222222222",
                "company": "Meta",
                "title": "Backend Engineer",
            },
        ]
        out = self.fetch.dedupe(rows)
        self.assertEqual(len(out), 2)

    def test_fetch_remotive_filters_and_normalizes(self):
        fake_payload = {
            "jobs": [
                {
                    "company_name": "Google",
                    "title": "Software Engineer Intern",
                    "candidate_required_location": "Remote - USA",
                    "url": "https://example.com/g1",
                    "publication_date": "2026-01-10",
                },
                {
                    "company_name": "Random Co",
                    "title": "Software Engineer Intern",
                    "candidate_required_location": "Remote - USA",
                    "url": "https://example.com/r1",
                    "publication_date": "2026-01-10",
                },
            ]
        }

        with tempfile.TemporaryDirectory() as tmp:
            data_raw = Path(tmp)
            remotive_file = data_raw / "remotive.json"

            def fake_fetch(_url, dest, timeout=25):
                self.assertEqual(dest, remotive_file)
                dest.write_text(json.dumps(fake_payload), encoding="utf-8")
                return True

            with patch.object(self.fetch, "DATA_RAW", data_raw), patch.object(
                self.fetch, "ALLOWLIST", ["google"]
            ), patch.object(self.fetch, "fetch_url", side_effect=fake_fetch):
                out = self.fetch.fetch_remotive()

        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["company"], "Google")
        self.assertEqual(out[0]["source"], "remotive")

    def test_fetch_simplify_internships_parses_markdown(self):
        md = "\n".join(
            [
                "| Company | Position | Location | Link |",
                "|---|---|---|---|",
                "| Google | Software Engineer Intern | Remote - USA | [Apply](https://example.com/g2) |",
                "| UnknownCo | Software Engineer Intern | Remote - USA | [Apply](https://example.com/u2) |",
            ]
        )

        with tempfile.TemporaryDirectory() as tmp:
            data_raw = Path(tmp)
            md_file = data_raw / "simplify_internships.md"

            def fake_fetch(_url, dest, timeout=25):
                self.assertEqual(dest, md_file)
                dest.write_text(md, encoding="utf-8")
                return True

            with patch.object(self.fetch, "DATA_RAW", data_raw), patch.object(
                self.fetch, "ALLOWLIST", ["google"]
            ), patch.object(self.fetch, "fetch_url", side_effect=fake_fetch):
                out = self.fetch.fetch_simplify_internships()

        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["company"], "Google")
        self.assertEqual(out[0]["source"], "simplify_internships")

    def test_write_outputs_creates_expected_files(self):
        rows = [
            {
                "id": "aaaaaaaaaaaaaaaa",
                "company": "Google",
                "title": "Software Engineer Intern",
                "level": "internship",
                "region": "remote",
                "country": "REMOTE",
                "location": "Remote - USA",
                "remote_type": "remote",
                "url": "https://example.com/g3",
                "source": "remotive",
                "source_url": "https://remotive.com",
                "posted_at": "2026-01-12",
                "collected_at": "2026-01-12T00:00:00Z",
                "tags": ["software"],
            }
        ]

        with tempfile.TemporaryDirectory() as tmp:
            data_out = Path(tmp)
            with patch.object(self.fetch, "DATA_OUT", data_out), patch.object(
                self.fetch, "NOW_ISO", "2026-01-12T00:00:00Z"
            ), patch.object(self.fetch, "TODAY", "2026-01-12"):
                self.fetch.write_outputs(rows)

            self.assertTrue((data_out / "jobs-global.json").exists())
            self.assertTrue((data_out / "jobs-global-latest.md").exists())
            self.assertTrue((data_out / "stats.json").exists())

            payload = json.loads((data_out / "jobs-global.json").read_text(encoding="utf-8"))
            self.assertEqual(payload["total"], 1)

    def test_main_calls_each_source_once(self):
        with patch.object(self.fetch, "fetch_remotive", return_value=[]) as remotive_mock, patch.object(
            self.fetch, "fetch_arbeitnow", return_value=[]
        ) as arbeitnow_mock, patch.object(self.fetch, "fetch_simplify_internships", return_value=[]) as internships_mock, patch.object(
            self.fetch, "fetch_simplify_newgrad", return_value=[]
        ) as newgrad_mock, patch.object(self.fetch, "dedupe", return_value=[]), patch.object(
            self.fetch, "write_outputs"
        ) as write_outputs, patch.object(self.fetch, "log_warn"):
            self.fetch.main()

        remotive_mock.assert_called_once()
        arbeitnow_mock.assert_called_once()
        internships_mock.assert_called_once()
        newgrad_mock.assert_called_once()
        write_outputs.assert_not_called()


if __name__ == "__main__":
    unittest.main()
