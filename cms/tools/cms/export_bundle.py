#!/usr/bin/env python3
"""
export_bundle.py — dump CMS content into a staging bundle for db image bake.

Used by ./db/scripts/build.sh to stage db image build inputs.
Staging is a plain directory (no tar — keeps `docker build` inputs
inspectable). Output layout:

    {--output-dir}/data-bundle-vYYYYMMDD-HHMMSS/
    ├── dump.sql       pg_dump of 3 content tables (schema + data)
    └── meta.json      bundle provenance + row counts

Audio is NOT in this bundle — it lives in Tencent Cloud COS, uploaded
at generate_audio time. The db image carries only the schema + sentences
table; `sentences.audio_url` is a full COS URL the frontend streams from.

Tools required:
  pg_dump, psql   (from postgresql-client — the CMS host already has
                   them because it runs the db)

Why pg_dump (not SQLAlchemy):
  - Canonical SQL output, no risk of model-vs-DB drift.
  - The CMS host already runs postgres; no extra Python deps.
  - pg_dump handles FK dependency order automatically (libs → words → sentences).

Why --clean --if-exists:
  - The dump.sql is loaded by postgres:15-alpine on first init against
    an empty database. `--clean` makes the SQL idempotent (DROP TABLE
    IF EXISTS before CREATE) so re-runs against a non-empty db don't
    fail. Safe because we're targeting empty dbs anyway.

Why --no-owner --no-acl:
  - The image sets POSTGRES_USER / POSTGRES_DB via env. We don't want
    pg_dump emitting OWNER TO / GRANT statements referencing the CMS
    host's user, which wouldn't exist in the image's runtime user.
"""
import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

# Schema decision: keep the 3 tables (vocabulary_libs / vocabulary_words /
# sentences). See cms/README.md for rationale. The cms host's
# import_vocab.py populates them; export_bundle.py dumps them; the
# runtime serves them read-only.
CONTENT_TABLES = ["vocabulary_libs", "vocabulary_words", "sentences"]


def run(cmd, **kw):
    """subprocess.run(check=True) wrapper — raises CalledProcessError on fail."""
    return subprocess.run(cmd, check=True, **kw)


def _has_binary(name: str) -> bool:
    """Return True if `name` is on PATH (skip .exe so we work on Windows + Unix)."""
    from shutil import which
    return which(name) is not None or which(f"{name}.exe") is not None


def _docker_container_for_db() -> str | None:
    """Return the docker container name that exposes the CMS DB, or None.

    Used as an automatic fallback when host-side pg_dump / psql are
    missing (e.g. Windows dev boxes that run postgres in Docker but
    haven't installed postgresql-client on the host). The convention
    baked into db/scripts/build.sh's doctor is `english_db` (or
    `english_db_dev` for the dev stream). Both names are tried.
    """
    try:
        out = subprocess.run(
            ["docker", "ps", "--format", "{{.Names}}"],
            capture_output=True, text=True, check=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None
    names = {n.strip() for n in out.stdout.splitlines() if n.strip()}
    for cand in ("english_db", "english_db_dev"):
        if cand in names:
            return cand
    return None


def _run_in_docker(container: str, cmd: list[str]) -> str:
    """Run a command inside the named docker container. Returns stdout.

    Forces UTF-8 decoding — Windows defaults to GBK / cp936, which
    can't decode pg_dump's SQL output (lots of high-bit bytes).
    """
    full = ["docker", "exec", container] + cmd
    result = subprocess.run(
        full, capture_output=True, text=True, encoding="utf-8", check=True,
    )
    return result.stdout


def get_database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set (export it from cms/.env)")
    return url


def make_bundle_dir(parent: Path) -> Path:
    """Create {parent}/data-bundle-vYYYYMMDD-HHMMSS/."""
    parent.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    bundle = parent / f"data-bundle-v{ts}"
    bundle.mkdir(exist_ok=False)
    return bundle


def _pg_dump_invocation(db_url: str, out_sql: Path | None) -> tuple[list[str], bool]:
    """Build the (cmd, in_docker) pair for pg_dump.

    `in_docker=True` means cmd starts with `docker exec ...` — used
    when the host has no pg_dump but a matching container is running.
    Returns the command list and a flag indicating whether it's the
    docker-wrapped form.
    """
    pg_args = [
        "--no-owner",  # no OWNER TO statements
        "--no-acl",    # no GRANT/REVOKE statements
        "--clean",     # DROP TABLE IF EXISTS before CREATE
        "--if-exists",
        "--table=vocabulary_libs",
        "--table=vocabulary_words",
        "--table=sentences",
    ]
    if _has_binary("pg_dump"):
        return (["pg_dump", db_url] + pg_args, False)
    container = _docker_container_for_db()
    if container is not None:
        return (["docker", "exec", container, "pg_dump", db_url] + pg_args, True)
    sys.exit(
        "pg_dump not found on host and no english_db / english_db_dev "
        "container is running.\n"
        "  install postgresql-client (scoop install postgresql / "
        "apt-get install postgresql-client) or start the CMS postgres "
        "container so this script can docker-exec into it."
    )


def pg_dump_content(db_url: str, out_sql: Path) -> None:
    """pg_dump the 3 content tables (schema + data) into out_sql.

    Tries host `pg_dump` first; falls back to `docker exec` into a
    running english_db{,_dev} container if the host has no postgres
    client. The fall-back lets a Windows dev box (no postgresql-client
    on PATH) still bake from a Dockerised CMS DB.
    """
    cmd, in_docker = _pg_dump_invocation(db_url, out_sql)
    # docker exec writes to its own stdout — we can't redirect a
    # file-handle on the host side. Capture and write ourselves.
    # Force UTF-8 (see _run_in_docker for rationale).
    if in_docker:
        result = subprocess.run(
            cmd, capture_output=True, text=True, encoding="utf-8", check=True,
        )
        out_sql.write_text(result.stdout, encoding="utf-8")
    else:
        with out_sql.open("w", encoding="utf-8") as f:
            run(cmd, stdout=f)


def count_rows(db_url: str) -> dict:
    """Return {table: row_count} via psql -tAc 'SELECT count(*)...'."""
    counts = {}
    container = None
    use_docker = not _has_binary("psql")
    if use_docker:
        container = _docker_container_for_db()
        if container is None:
            sys.exit(
                "psql not found on host and no english_db / english_db_dev "
                "container is running."
            )
    for table in CONTENT_TABLES:
        if use_docker:
            stdout = _run_in_docker(
                container, ["psql", db_url, "-tAc", f"SELECT count(*) FROM {table}"]
            )
        else:
            # Force UTF-8 to match the docker path (Windows default
            # encoding is GBK, which corrupts SQL output).
            result = run(
                ["psql", db_url, "-tAc", f"SELECT count(*) FROM {table}"],
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
            stdout = result.stdout
        counts[table] = int(stdout.strip() or "0")
    return counts


def write_meta(bundle: Path, db_url: str, counts: dict) -> None:
    """Write meta.json with bundle provenance + counts."""
    parsed = urlparse(db_url)
    meta = {
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "db_host": f"{parsed.hostname}:{parsed.port or 5432}/{parsed.path.lstrip('/')}",
        "row_counts": counts,
    }
    (bundle / "meta.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Dump CMS content into a staging bundle.",
    )
    parser.add_argument(
        "--output-dir",
        default=".bake-staging",
        help="Parent directory; bundle is created as <output-dir>/data-bundle-v.../",
    )
    parser.add_argument(
        "--no-tar",
        action="store_true",
        help="Deprecated no-op (kept for compat with db/scripts/build.sh CLI).",
    )
    parser.add_argument(
        "--keep-staging",
        action="store_true",
        help="Keep --output-dir on error. Default: delete bundle on error.",
    )
    args = parser.parse_args()

    output_parent = Path(args.output_dir).resolve()
    bundle = make_bundle_dir(output_parent)

    try:
        db_url = get_database_url()
        db_host = f"{urlparse(db_url).hostname}:{urlparse(db_url).port or 5432}"
        print(f"[export_bundle] db:   {db_host}")
        print(f"[export_bundle] out:  {bundle}")

        # 1. pg_dump → dump.sql
        dump_sql = bundle / "dump.sql"
        pg_dump_content(db_url, dump_sql)
        print(f"[export_bundle] dump: {dump_sql.stat().st_size:,} bytes")

        # 2. row counts (for the manifest)
        counts = count_rows(db_url)
        for table, n in counts.items():
            print(f"[export_bundle]       {table}: {n} row(s)")

        # 3. meta.json (provenance)
        write_meta(bundle, db_url, counts)
        print(f"[export_bundle] OK   ({bundle})")
    except Exception as exc:
        if not args.keep_staging:
            print(
                f"[export_bundle] error ({exc}) — cleaning up {bundle}",
                file=sys.stderr,
            )
            shutil.rmtree(bundle, ignore_errors=True)
        raise


if __name__ == "__main__":
    main()