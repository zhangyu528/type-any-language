#!/usr/bin/env python3
"""
db/builder.py — assemble + build the content-baked db image.

Sister to db/Dockerfile: that file describes *how the
runtime image runs* (postgres:15-alpine + /docker-entrypoint-initdb.d);
this one describes *how it gets assembled*.

Two public entry points:

    assemble(bundle_dir, target="db")
        Copy the staging bundle (output of db/scripts/export_bundle.py) into the
        runtime build context:
            {bundle}/dump.sql   -> {target}/init/01-content.sql
        Idempotent. Re-running with the same target + the same bundle
        produces the same staged inputs (overwrite in place).

    build_image(target, tag, labels, build_args)
        Run `docker build {target}` with the supplied labels + build-args.
        Subprocess — Docker CLI instead of the docker-py SDK; the CMS
        host already has docker and we don't want to grow the Python
        dependency surface.

The db/scripts/build.sh shell script is now a thin wrapper that calls both
(doctors the env, loads cms/.env, picks a python, invokes this file).

Public API:
    assemble(bundle_dir, target) -> Path
    build_image(target, tag, labels, build_args) -> str   # the tag

Usage:
    # from db/scripts/build.sh (after export_bundle.py)
    python db/builder.py \
        --bundle .bake-staging/data-bundle-v20260101-000000 \
        --tag english_db_content:vX.Y.Z \
        --db-user english_user --db-name english_learning \
        --content-version vX.Y.Z --baked-at <utc> --git-sha <sha>

Why a separate builder.py (not db/scripts/build.sh):
- db/ owns the question "what does it take to be buildable?"
- shell deals with operator-facing preflight (env, secret loading,
  python discovery); python deals with artifact staging + docker CLI.

Audio note: db image carries no audio. MP3s are uploaded to Tencent
Cloud COS by cms/cms_pipeline/generate_audio.py at bake time; the
sentences.audio_url column stores the full COS URL. The frontend
streams audio from COS directly.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


# Where the runtime build context lives, project-root relative.
# Keep this single source of truth here; db/scripts/build.sh reads it via
# its CLI flag (--target default), not via duplicating the constant.
DEFAULT_TARGET = "db"


# ---------------------------------------------------------------------------
# Stage 1: assemble — copy the export bundle into the runtime build context
# ---------------------------------------------------------------------------
def assemble(bundle_dir: Path, target: Path | None = None) -> Path:
    """Stage the export bundle into the runtime build context.

    Args:
        bundle_dir: path to a `data-bundle-vYYYYMMDD-HHMMSS/` produced
            by db/scripts/export_bundle.py. Must contain `dump.sql`.
        target: project-root-relative runtime directory. Defaults to
            `db`. Accepts either a relative path (resolved
            against CWD, assumed to be the project root) or an absolute
            path (used as-is).

    Returns:
        target_path — useful for caller-side banner.

    Raises:
        SystemExit on missing bundle, missing dump.sql, or target == bundle
        (would self-corrupt).
    """
    bundle = Path(bundle_dir).resolve()
    if not bundle.is_dir():
        sys.exit(f"bundle dir not found: {bundle}")
    dump_sql = bundle / "dump.sql"
    if not dump_sql.is_file():
        sys.exit(f"bundle missing dump.sql: {bundle}")

    target_path = _resolve_target(target)
    if target_path.resolve() == bundle:
        sys.exit(f"refusing to assemble target == bundle: {target_path}")

    init_dir = target_path / "init"
    init_dir.mkdir(parents=True, exist_ok=True)

    # dump.sql — single file, copy with metadata.
    shutil.copy2(dump_sql, init_dir / "01-content.sql")

    return target_path


def _resolve_target(target: Path | None) -> Path:
    if target is None:
        target = Path(DEFAULT_TARGET)
    p = Path(target)
    if not p.is_absolute():
        p = (Path.cwd() / p).resolve()
    return p


# ---------------------------------------------------------------------------
# Stage 2: build_image — `docker build` with our OCI labels
# ---------------------------------------------------------------------------
def build_image(
    target: Path,
    tag: str,
    labels: dict[str, str],
    build_args: dict[str, str],
) -> str:
    """Run `docker build` against `target` and tag the result.

    Args:
        target: runtime build context (output of assemble()).
        tag: full image:tag like `english_db_content:v0.2.0`.
        labels: OCI label dict, applied via `--label key=value`.
        build_args: passed via `--build-arg key=value`. These become
            ARGs inside the Dockerfile.

    Returns:
        The tag that was built. Raises CalledProcessError on docker
        failure, after stderr has been streamed through.

    Why not docker-py: introduces a new Python dep on the CMS host
    (psycopg2 + openai + tencentcloud already pin). The docker CLI is
    the one tool the CMS host definitely has, and it's already on the
    path every db/scripts/build.sh invocation uses.
    """
    cmd: list[str] = ["docker", "build", "--tag", tag]
    for k, v in build_args.items():
        cmd.extend(["--build-arg", f"{k}={v}"])
    for k, v in labels.items():
        cmd.extend(["--label", f"{k}={v}"])
    cmd.append(str(target))

    # surface docker's own stderr straight to our stderr so the operator
    # can see the build context + each layer as it streams
    print(f"[builder] $ {' '.join(cmd)}", file=sys.stderr)
    subprocess.run(cmd, check=True)
    return tag


# ---------------------------------------------------------------------------
# OCI labels + build args — single source of truth
# ---------------------------------------------------------------------------
def compute_labels(args: argparse.Namespace) -> dict[str, str]:
    """The full set of labels written into the db image.

    Why these specific keys:
        - org.opencontainers.image.{source,created} : standard OCI attrs
        - type-any-language.role : sanity-check on docker inspect
        - type-any-language.db.{user,name} : read at runtime by
          dev/prod run.sh via `docker inspect` to populate DB_USER /
          DB_NAME (these aren't in `.env`)
        - type-any-language.content.{version,baked-at} : metadata the
          run.sh doctor logs
        - type-any-language.app.{version,git-sha} : drift detection
          against the local VERSION files
    """
    return {
        "org.opencontainers.image.source": "https://github.com/zhangyu528/type-any-language",
        "org.opencontainers.image.created": args.baked_at,
        "type-any-language.role": "content-baked-db",
        "type-any-language.db.user": args.db_user,
        "type-any-language.db.name": args.db_name,
        "type-any-language.content.version": args.content_version,
        "type-any-language.content.baked-at": args.baked_at,
        "type-any-language.app.version": args.content_version,
        "type-any-language.app.git-sha": args.git_sha,
    }


def compute_build_args(args: argparse.Namespace) -> dict[str, str]:
    """ARGS consumed by db/Dockerfile.

    These have defaults in the Dockerfile so a bare `docker build .`
    works too — but the bake flow always passes them explicitly so the
    labels stay consistent.
    """
    return {
        "DB_USER": args.db_user,
        "DB_NAME": args.db_name,
        "CONTENT_VERSION": args.content_version,
        "BAKED_AT": args.baked_at,
        "APP_VERSION": args.content_version,
        "GIT_SHA": args.git_sha,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def _now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Assemble + build the content-baked db image (used by db/scripts/build.sh).",
    )
    parser.add_argument(
        "--bundle", required=True, type=Path,
        help="Staging bundle dir from db/scripts/export_bundle.py (data-bundle-v...).",
    )
    parser.add_argument(
        "--target", default=DEFAULT_TARGET,
        help=f"Runtime build context (default: {DEFAULT_TARGET}).",
    )
    parser.add_argument(
        "--tag", required=True,
        help="Full image:tag, e.g. english_db_content:v0.2.0.",
    )
    parser.add_argument("--db-user", default="english_user")
    parser.add_argument("--db-name", default="english_learning")
    parser.add_argument(
        "--content-version", required=True,
        help="The image's content version (= DB_IMAGE_TAG = db/VERSION).",
    )
    parser.add_argument(
        "--baked-at", default=None,
        help="ISO 8601 UTC timestamp. Default: now().",
    )
    parser.add_argument(
        "--git-sha", default="unknown",
        help="Short git SHA baked into type-any-language.app.git-sha label.",
    )
    parser.add_argument(
        "--no-build", action="store_true",
        help="Only stage (assemble). Skip the docker build step. Useful "
             "for testing the staging step alone.",
    )
    args = parser.parse_args()

    if args.baked_at is None:
        args.baked_at = _now_utc()

    # Stage 1: copy bundle into the runtime build context
    target_path = assemble(args.bundle, Path(args.target))
    sql_size = (target_path / "init" / "01-content.sql").stat().st_size
    print(f"[builder] staged: target={target_path}")
    print(f"[builder]   → init/01-content.sql ({sql_size:,} bytes)")

    if args.no_build:
        print(f"[builder] --no-build set; skipping docker build")
        return 0

    # Stage 2: docker build
    labels = compute_labels(args)
    build_args = compute_build_args(args)
    build_image(target_path, args.tag, labels, build_args)

    print(f"[builder] Built: {args.tag}")
    print(f"[builder] labels:")
    for k, v in labels.items():
        # short summary — operators usually only care about identity / version
        if k.startswith("type-any-language."):
            print(f"[builder]   {k}={v}")
    return 0


if __name__ == "__main__":
    sys.exit(main())