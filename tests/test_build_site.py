from datetime import date
import json
from pathlib import Path
import tempfile
import unittest

from scripts.build_site import (
    STATIC_FILES, ValidationError, aggregate, build_site, collect_cases, completion_date,
)


class CaseActivityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "Case Study").mkdir()

    def note(self, name="Simple/Case 001.md", status="completed", difficulty="simple",
             completed="2026-09-03", kind="case-study", extra=""):
        path = self.root / "Case Study" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            f"---\ntype: {kind}\ndifficulty: {difficulty}\nstatus: {status}\n"
            f"date: {completed}\n{extra}---\n\n# Case body remains private\n",
            encoding="utf-8",
        )
        return path

    def activity(self):
        return aggregate(collect_cases(self.root))

    def test_completed_case_counted(self):
        self.note()
        self.assertEqual(self.activity(), {"2026-09-03": 1})

    def test_in_progress_ignored_even_with_date(self):
        self.note(status="in-progress")
        self.assertEqual(self.activity(), {})

    def test_not_started_blank_date_ignored(self):
        self.note(status="not-started", completed="")
        self.assertEqual(self.activity(), {})

    def test_in_progress_blank_date_allowed(self):
        self.note(status="in-progress", completed="")
        self.assertEqual(self.activity(), {})

    def test_same_day_aggregated_and_different_days_separated(self):
        self.note("one.md")
        self.note("two.md")
        self.note("three.md", completed="2026-09-04")
        self.assertEqual(self.activity(), {"2026-09-03": 2, "2026-09-04": 1})

    def test_template_directories_and_files_ignored(self):
        for name in ["Templates/Simple.md", "Template/Complex.md",
                     "Case Study Templates/Intermediate.md", "Simple/Case Template.md",
                     "Simple/template-example.md", "Nested/Templates/deep.md"]:
            self.note(name, completed="invalid")
        self.assertEqual(self.activity(), {})

    def test_shared_templates_and_other_categories_outside_scan(self):
        for folder in ["Templates/Case Study Templates", "ICD", "CPT", "HCPCS II", "_site"]:
            destination = self.root / folder / "unrelated.md"
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(self.note().read_text(encoding="utf-8"), encoding="utf-8")
        self.assertEqual(self.activity(), {"2026-09-03": 1})

    def test_unrelated_markdown_ignored(self):
        self.note(kind="study-note")
        (self.root / "Case Study" / "index.md").write_text("# Study index", encoding="utf-8")
        self.assertEqual(self.activity(), {})

    def test_completed_missing_date_fails_with_path_and_property(self):
        self.note(completed="")
        with self.assertRaisesRegex(ValidationError, r"Simple/Case 001.md: date:.*YYYY-MM-DD"):
            self.activity()

    def test_malformed_dates_fail(self):
        for value in ['"09/03/2026"', '"2026-9-03"', '"2026-02-30"',
                      "2026-02-30", "2026-09-03T00:00:00Z", "42", "[2026-09-03]"]:
            with self.subTest(value=value):
                self.note(completed=value)
                with self.assertRaisesRegex(ValidationError, r"date:.*YYYY-MM-DD"):
                    self.activity()

    def test_all_difficulties_work_and_metadata_retained(self):
        for difficulty in ["simple", "intermediate", "complex"]:
            self.note(f"{difficulty}.md", difficulty=difficulty)
        cases = collect_cases(self.root)
        self.assertEqual({case.difficulty for case in cases}, {"simple", "intermediate", "complex"})
        self.assertTrue(all(case.path.startswith("Case Study/") for case in cases))
        self.assertEqual(aggregate(cases), {"2026-09-03": 3})

    def test_unsupported_status_detected(self):
        for value in ["done", "Completed", "[completed]", ""]:
            self.note(status=value)
            with self.assertRaisesRegex(ValidationError, "status: expected"):
                self.activity()

    def test_unsupported_difficulty_detected(self):
        self.note(difficulty="easy")
        with self.assertRaisesRegex(ValidationError, "difficulty: expected"):
            self.activity()

    def test_yaml_date_object_supported(self):
        self.note()
        self.assertEqual(collect_cases(self.root)[0].date, date(2026, 9, 3))
        self.assertEqual(completion_date(date(2026, 9, 3)), date(2026, 9, 3))

    def test_yaml_string_date_supported(self):
        self.note(completed='"2026-09-03"')
        self.assertEqual(self.activity(), {"2026-09-03": 1})

    def test_leap_day_and_year_boundaries(self):
        for value in ["2024-02-29", "2025-12-31", "2026-01-01"]:
            self.note(f"{value}.md", completed=value)
        self.assertEqual(self.activity(), {"2024-02-29": 1, "2025-12-31": 1, "2026-01-01": 1})
        self.note("bad.md", completed='"2025-02-29"')
        with self.assertRaises(ValidationError):
            self.activity()

    def test_duplicate_keys_are_not_silently_overridden(self):
        self.note(extra="status: in-progress\n")
        with self.assertRaisesRegex(ValidationError, "duplicate property: status"):
            self.activity()

    def test_unsafe_yaml_and_invalid_frontmatter_fail(self):
        path = self.note()
        for content in ["---\n[invalid]\n---\n", "---\ntype: case-study\n",
                        "---\nx: !!python/object/apply:os.system ['echo forbidden']\n---\n"]:
            path.write_text(content, encoding="utf-8")
            with self.assertRaises(ValidationError):
                self.activity()

    def test_missing_type_for_case_properties_is_diagnosed(self):
        path = self.note()
        path.write_text(path.read_text().replace("type: case-study\n", ""), encoding="utf-8")
        with self.assertRaisesRegex(ValidationError, "type: expected"):
            self.activity()

    def test_bom_unicode_spaces_and_other_properties_preserved(self):
        path = self.note("Intermediate/Case résumé.md", extra="cssclasses:\n  - cornell-note\n")
        path.write_bytes(b"\xef\xbb\xbf" + path.read_bytes())
        before = path.read_bytes()
        self.assertEqual(self.activity(), {"2026-09-03": 1})
        self.assertEqual(path.read_bytes(), before)

    def test_all_errors_reported_together(self):
        self.note("one.md", completed="")
        self.note("two.md", status="bad")
        with self.assertRaises(ValidationError) as result:
            self.activity()
        self.assertIn("one.md", str(result.exception))
        self.assertIn("two.md", str(result.exception))

    def static_sources(self):
        source = self.root / "site"
        source.mkdir()
        for name in STATIC_FILES:
            (source / name).write_text("static source", encoding="utf-8")
        (source / "private.md").write_text("never deploy this", encoding="utf-8")

    def test_build_cleans_stale_output_and_exports_only_aggregate(self):
        self.note()
        self.static_sources()
        output = self.root / "_site"
        output.mkdir()
        (output / "stale.json").touch()
        self.assertEqual(build_site(self.root), {"2026-09-03": 1})
        payload = json.loads((output / "data/case_activity.json").read_text())
        self.assertEqual(payload, {"activity": {"2026-09-03": 1}})
        self.assertEqual({p.relative_to(output).as_posix() for p in output.rglob("*") if p.is_file()},
                         {*STATIC_FILES, ".nojekyll", "data/case_activity.json"})

    def test_failed_validation_preserves_last_build(self):
        self.note()
        self.static_sources()
        build_site(self.root)
        data = self.root / "_site/data/case_activity.json"
        before = data.read_bytes()
        self.note(completed="")
        with self.assertRaises(ValidationError):
            build_site(self.root)
        self.assertEqual(data.read_bytes(), before)

    def test_missing_case_directory_fails(self):
        (self.root / "Case Study").rmdir()
        with self.assertRaisesRegex(ValidationError, "expected a real"):
            self.activity()

    def test_empty_case_folder_builds_empty_activity(self):
        self.static_sources()
        self.assertEqual(build_site(self.root), {})


if __name__ == "__main__":
    unittest.main()
