"""
content/tools/cms/manifest.py — load and validate content/source/manifest.yaml.

The manifest is the single source of truth for "what content does this app
ship" — adding a new vocabulary lib, a new difficulty level, or tweaking
the LLM prompt are all yaml edits, not Python edits.

This module is the only place that knows the manifest schema. Pipeline
modules (import_vocab, generate_sentences, ...) consume the dataclasses
returned here; they never parse yaml themselves.

Usage:
    from cms.manifest import load_manifest

    m = load_manifest()                     # default path (content/source/manifest.yaml)
    for lib in m.all_libs():                # iterate libs
        print(lib.id, lib.display)
    m.get_lib("cet4")                       # one lib by id, or None
    m.difficulties_for("cet4")              # ["beginner", "intermediate", "advanced"]
    m.bucket_target_size()                  # 200
"""
from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import yaml

# Manifest schema version this loader understands. Bump together with the
# yaml's `version:` field if incompatible shape changes are made.
_SUPPORTED_VERSIONS = (1,)


# ---------------------------------------------------------------------------
# Project root + manifest path resolution
# ---------------------------------------------------------------------------
# Mirrors the pattern in content/tools/cms/env.py:_project_root(): this file lives
# at content/tools/cms/manifest.py, so project root is two parents up.
def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _default_manifest_path() -> Path:
    return _project_root() / "content" / "source" / "manifest.yaml"


# ---------------------------------------------------------------------------
# Dataclasses — frozen after parse. Pipeline modules read these, never mutate.
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class LibDef:
    """One entry from manifest.yaml's `libs:` list.

    `lesson_size` and `description` have defaults so the first-pass libs list
    (built before defaults are parsed) can construct valid objects. The
    enriched-libs pass below replaces them with the actual manifest values.
    """
    id: str
    display: str
    level: str
    description: Optional[str] = None  # user-facing tagline; nullable, backward compat
    csv_path: Path = field(default_factory=Path)  # absolute, project-root-relative resolved
    difficulties: tuple[str, ...] = ()
    csv_exists: bool = False            # False → file missing on disk, sync will skip
    lesson_size: int = 5               # words per lesson (Target-Word Lesson feature)


@dataclass(frozen=True)
class Defaults:
    difficulty: str
    bucket_target_size: int
    lesson_size: int


@dataclass(frozen=True)
class Manifest:
    version: int
    libs: tuple[LibDef, ...]
    defaults: Defaults

    def all_libs(self) -> tuple[LibDef, ...]:
        return self.libs

    def all_lib_ids(self) -> tuple[str, ...]:
        return tuple(lib.id for lib in self.libs)

    def get_lib(self, lib_id: str) -> Optional[LibDef]:
        for lib in self.libs:
            if lib.id == lib_id:
                return lib
        return None

    def difficulties_for(self, lib_id: str) -> tuple[str, ...]:
        lib = self.get_lib(lib_id)
        if lib is None:
            return ()
        return lib.difficulties

    def all_difficulties(self) -> tuple[str, ...]:
        """Union of all difficulties across all libs (preserves first-seen order)."""
        seen: list[str] = []
        for lib in self.libs:
            for d in lib.difficulties:
                if d not in seen:
                    seen.append(d)
        return tuple(seen)

    def bucket_target_size(self) -> int:
        return self.defaults.bucket_target_size

    def lesson_size_for(self, lib_id: str) -> int:
        """Words-per-lesson for a given lib (per-lib override or default)."""
        lib = self.get_lib(lib_id)
        if lib is not None:
            return lib.lesson_size
        return self.defaults.lesson_size


# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------
def load_manifest(path: Path | None = None) -> Manifest:
    """Parse manifest.yaml and return a validated `Manifest`.

    Args:
        path: optional override; defaults to content/source/manifest.yaml.

    Raises:
        SystemExit on validation error (file not found, missing keys, wrong
        types, unsupported version). Uses sys.exit so callers don't need to
        wrap in try/except — a bad manifest is a fatal operator error.
    """
    manifest_path = path or _default_manifest_path()
    if not manifest_path.is_file():
        sys.exit(
            f"manifest not found at {manifest_path}\n"
            f"  Expected: content/source/manifest.yaml at the project root.\n"
            f"  Run from the project root, or check that the file is committed."
        )

    raw = yaml.safe_load(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        sys.exit(f"manifest root must be a mapping, got {type(raw).__name__} ({manifest_path})")

    version = raw.get("version")
    if version not in _SUPPORTED_VERSIONS:
        sys.exit(
            f"manifest version={version!r} not supported "
            f"(this loader understands versions {_SUPPORTED_VERSIONS}). "
            f"Bump _SUPPORTED_VERSIONS in content/tools/cms/manifest.py."
        )

    raw_libs = raw.get("libs")
    if not isinstance(raw_libs, list) or not raw_libs:
        sys.exit(f"manifest 'libs' must be a non-empty list ({manifest_path})")

    project_root = _project_root()
    libs: list[LibDef] = []
    for i, entry in enumerate(raw_libs):
        if not isinstance(entry, dict):
            sys.exit(f"manifest libs[{i}] must be a mapping, got {type(entry).__name__}")
        for required in ("id", "display", "level", "csv", "difficulties"):
            if required not in entry:
                sys.exit(f"manifest libs[{i}] missing required key '{required}'")

        lib_id = str(entry["id"]).strip()
        display = str(entry["display"]).strip()
        level = str(entry["level"]).strip()
        # `description` is optional for backward compatibility with existing
        # manifests. Empty string / missing key both normalize to None, which
        # downstream code (import_vocab.py + UI) treats as "no tagline".
        desc_raw = entry.get("description")
        description: Optional[str] = None
        if desc_raw is not None:
            desc_str = str(desc_raw).strip()
            if desc_str:
                description = desc_str

        csv_rel = str(entry["csv"]).strip()
        diffs_raw = entry["difficulties"]
        if not isinstance(diffs_raw, list) or not diffs_raw:
            sys.exit(f"manifest libs[{i}] ({lib_id}) difficulties must be a non-empty list")
        difficulties = tuple(str(d).strip() for d in diffs_raw if str(d).strip())
        if not difficulties:
            sys.exit(f"manifest libs[{i}] ({lib_id}) difficulties contains no non-empty strings")

        # CSV path: yaml is project-root-relative. Resolve to absolute.
        csv_path = (project_root / csv_rel).resolve()
        csv_exists = csv_path.is_file()

        # id uniqueness across libs (used by argparse choices downstream).
        if any(l.id == lib_id for l in libs):
            sys.exit(f"manifest has duplicate lib id: {lib_id!r}")

        libs.append(LibDef(
            id=lib_id,
            display=display,
            level=level,
            description=description,
            csv_path=csv_path,
            difficulties=difficulties,
            csv_exists=csv_exists,
        ))

    raw_defaults = raw.get("defaults") or {}
    if not isinstance(raw_defaults, dict):
        sys.exit(f"manifest 'defaults' must be a mapping ({manifest_path})")

    default_difficulty = str(raw_defaults.get("difficulty", "")).strip()
    if not default_difficulty:
        sys.exit("manifest defaults.difficulty is required and non-empty")
    all_diffs = Manifest(  # noqa: F841 — used only to call all_difficulties below
        version=version, libs=tuple(libs), defaults=Defaults("", 0, 5)
    ).all_difficulties()
    if default_difficulty not in all_diffs:
        sys.exit(
            f"manifest defaults.difficulty={default_difficulty!r} is not declared "
            f"in any lib's difficulties list. Add it to one lib, or change the default."
        )

    bucket_size_raw = raw_defaults.get("bucket_target_size", 200)
    try:
        bucket_size = int(bucket_size_raw)
    except (TypeError, ValueError):
        sys.exit(f"manifest defaults.bucket_target_size must be an int, got {bucket_size_raw!r}")
    if bucket_size <= 0:
        sys.exit(f"manifest defaults.bucket_target_size must be > 0, got {bucket_size}")

    lesson_size_raw = raw_defaults.get("lesson_size", 5)
    try:
        default_lesson_size = int(lesson_size_raw)
    except (TypeError, ValueError):
        sys.exit(f"manifest defaults.lesson_size must be an int, got {lesson_size_raw!r}")
    if default_lesson_size <= 0:
        sys.exit(f"manifest defaults.lesson_size must be > 0, got {default_lesson_size}")

    # Per-lib lesson_size override. Libs may declare `lesson_size: N` to
    # override the default (e.g. ielts ships 7-word lessons). Missing or
    # invalid values fall back to the default.
    enriched_libs: list[LibDef] = []
    for i, entry in enumerate(raw_libs):
        lib_size_raw = entry.get("lesson_size", default_lesson_size)
        try:
            lib_size = int(lib_size_raw)
            if lib_size <= 0:
                raise ValueError
        except (TypeError, ValueError):
            sys.exit(
                f"manifest libs[{i}] ({entry.get('id')}) lesson_size must be a positive int, "
                f"got {lib_size_raw!r}"
            )
        base = libs[len(enriched_libs)]
        enriched_libs.append(LibDef(
            id=base.id,
            display=base.display,
            level=base.level,
            description=base.description,
            csv_path=base.csv_path,
            difficulties=base.difficulties,
            csv_exists=base.csv_exists,
            lesson_size=lib_size,
        ))
    libs = enriched_libs

    return Manifest(
        version=version,
        libs=tuple(libs),
        defaults=Defaults(
            difficulty=default_difficulty,
            bucket_target_size=bucket_size,
            lesson_size=default_lesson_size,
        ),
    )


# ---------------------------------------------------------------------------
# CLI — quick sanity check + dry-run print. Useful for `python -m cms.manifest`.
# ---------------------------------------------------------------------------
def _print_summary(m: Manifest) -> None:
    print(f"manifest version={m.version}")
    print(
        f"defaults: difficulty={m.defaults.difficulty} "
        f"bucket_target_size={m.defaults.bucket_target_size} "
        f"lesson_size={m.defaults.lesson_size}"
    )
    print(f"libs ({len(m.libs)}):")
    for lib in m.libs:
        marker = "ok" if lib.csv_exists else "MISSING"
        print(
            f"  [{marker:7s}] {lib.id:10s} display={lib.display!r:30s} "
            f"difficulties={list(lib.difficulties)} lesson_size={lib.lesson_size} "
            f"csv={lib.csv_path}"
        )


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="Validate content/source/manifest.yaml")
    parser.add_argument("--path", type=Path, default=None, help="Override manifest path")
    args = parser.parse_args()

    m = load_manifest(args.path)
    _print_summary(m)


if __name__ == "__main__":
    main()