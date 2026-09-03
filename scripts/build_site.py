"""Build a static dashboard from case-study Properties, never Git timestamps."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime
import json
import os
from pathlib import Path
import re
import shutil
import sys

import yaml


ROOT = Path(__file__).resolve().parents[1]
CASE_DIRECTORY = "Case Study"
STATUSES = {"not-started", "in-progress", "completed"}
DIFFICULTIES = {"simple", "intermediate", "complex"}
DATE_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}\Z")
TEMPLATE_PATTERN = re.compile(r"(?:^|[\s_-])templates?(?:$|[\s_-])", re.IGNORECASE)
STATIC_FILES = ("index.html", "styles.css", "app.js", "calendar.js")


class ValidationError(ValueError):
    """One or more notes need their Properties corrected."""


class UniqueKeyLoader(yaml.SafeLoader):
    """Safe YAML loading with explicit errors for ambiguous duplicate keys."""


def unique_mapping(loader, node):
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=True)
        if not isinstance(key, str):
            raise ValidationError("frontmatter property names must be text")
        if key in result:
            raise ValidationError(f"duplicate property: {key}")
        result[key] = loader.construct_object(value_node, deep=True)
    return result


UniqueKeyLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_mapping
)


@dataclass(frozen=True)
class Case:
    path: str
    difficulty: str
    status: str
    date: date | None


def is_template(path: Path) -> bool:
    return any(TEMPLATE_PATTERN.search(part) for part in (*path.parts[:-1], path.stem))


def is_link(path: Path) -> bool:
    return path.is_symlink() or path.is_junction()


def case_paths(root: Path):
    """Only scan the case folder; shared Obsidian templates are outside this scope."""
    folder = root / CASE_DIRECTORY
    if not folder.is_dir() or is_link(folder):
        raise ValidationError(f"{CASE_DIRECTORY}/: expected a real case-study directory")
    for directory, subdirs, filenames in os.walk(folder, followlinks=False):
        parent = Path(directory)
        subdirs[:] = sorted(
            name for name in subdirs
            if not name.startswith((".", "_"))
            and not is_template(Path(name))
            and not is_link(parent / name)
        )
        for name in sorted(filenames):
            path = parent / name
            if (path.suffix.lower() == ".md" and not name.startswith(".")
                    and not is_template(path.relative_to(folder)) and not is_link(path)):
                yield path


def frontmatter(path: Path) -> dict:
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    closing = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if closing is None:
        raise ValidationError("frontmatter is missing its closing --- delimiter")
    try:
        properties = yaml.load("\n".join(lines[1:closing]), Loader=UniqueKeyLoader)
    except ValidationError:
        raise
    except yaml.YAMLError as error:
        raise ValidationError("frontmatter: expected valid YAML Properties between --- delimiters") from error
    except (ValueError, TypeError) as error:
        raise ValidationError("date: expected a real calendar date in YYYY-MM-DD format") from error
    if properties is None:
        return {}
    if not isinstance(properties, dict):
        raise ValidationError("frontmatter must be a mapping of property names to values")
    return properties


def completion_date(value) -> date | None:
    if value is None or value == "":
        return None
    # PyYAML constructs unquoted YYYY-MM-DD as datetime.date. Reject timestamps.
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, str) and DATE_PATTERN.fullmatch(value):
        try:
            return date.fromisoformat(value)
        except ValueError:
            pass
    raise ValidationError("date: expected a real calendar date in YYYY-MM-DD format")


def parse_case(path: Path, root: Path) -> Case | None:
    properties = frontmatter(path)
    if properties.get("type") != "case-study":
        if "type" not in properties and {"difficulty", "status"} & properties.keys():
            raise ValidationError("type: expected case-study for a note with case Properties")
        return None
    status = properties.get("status")
    difficulty = properties.get("difficulty")
    if not isinstance(status, str) or status not in STATUSES:
        raise ValidationError("status: expected not-started, in-progress, or completed")
    if not isinstance(difficulty, str) or difficulty not in DIFFICULTIES:
        raise ValidationError("difficulty: expected simple, intermediate, or complex")
    completed_on = completion_date(properties.get("date"))
    if status == "completed" and completed_on is None:
        raise ValidationError('date: status is "completed"; expected date: YYYY-MM-DD')
    return Case(path.relative_to(root).as_posix(), difficulty, status, completed_on)


def collect_cases(root: Path) -> list[Case]:
    cases, errors = [], []
    for path in case_paths(root):
        try:
            case = parse_case(path, root)
            if case is not None:
                cases.append(case)
        except (ValidationError, OSError, UnicodeError) as error:
            errors.append(f"{path.relative_to(root).as_posix()}: {error}")
    if errors:
        raise ValidationError("\n".join(errors))
    return cases


def aggregate(cases: list[Case]) -> dict[str, int]:
    counts = Counter(
        case.date.isoformat() for case in cases
        if case.status == "completed" and case.date is not None
    )
    return dict(sorted(counts.items()))


def build_site(root: Path = ROOT) -> dict[str, int]:
    root = root.resolve()
    # Validate first so a bad note cannot erase the last successful local preview.
    activity = aggregate(collect_cases(root))
    source = root / "site"
    for name in STATIC_FILES:
        if not (source / name).is_file() or is_link(source / name):
            raise ValidationError(f"site/{name}: expected a static source file")
    output = root / "_site"
    if is_link(output) or output.resolve().parent != root:
        raise ValidationError("_site/: output must be a real directory directly inside the repository")
    if output.exists():
        shutil.rmtree(output)
    (output / "data").mkdir(parents=True)
    # An allowlist keeps notes, attachments, and future source-side files out of Pages.
    for name in STATIC_FILES:
        shutil.copyfile(source / name, output / name)
    (output / ".nojekyll").touch()
    (output / "data" / "case_activity.json").write_text(
        json.dumps({"activity": activity}, indent=2) + "\n", encoding="utf-8"
    )
    return activity


def main() -> int:
    try:
        activity = build_site()
    except (ValidationError, OSError) as error:
        print(f"ERROR:\n{error}", file=sys.stderr)
        return 1
    print(f"Built _site/: {sum(activity.values())} completed case(s) on {len(activity)} date(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
