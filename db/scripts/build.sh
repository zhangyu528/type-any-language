#!/bin/bash
#
# db/scripts/build.sh — bake content into a portable db image.
#
# The image is a postgres:15-alpine wrapper that pre-loads the schema
# + content tables (vocabulary_libs / vocabulary_words / sentences).
# Fresh hosts `docker pull` this image and have immediate content
# without any AI calls.
#
# This script is a thin wrapper. The two responsibilities that used to
# live here are now in db/builder.py (sister to the Dockerfile):
#   1. assemble the bundle into db/init/01-content.sql
#   2. run `docker build` with the right --build-arg / --label
# What stays in shell:
#   - preflight (docker installed? source content present?)
#   - host-side env loading (cms/.env → POSTGRES_PASSWORD → DATABASE_URL)
#   - calling db/scripts/export_bundle.py to produce the staging bundle
#   - timestamp + git SHA capture (host-bound, easier in shell)
#   - invoking builder.py and printing the resulting "Built: <tag>" line
#
# Image labels baked in (read by prod/dev run.sh via `docker inspect`):
#   type-any-language.db.user           POSTGRES_USER (default: english_user; shell env override)
#   type-any-language.db.name           POSTGRES_DB   (default: english_learning; shell env override)
#   type-any-language.content.version   DB_IMAGE_TAG  (default: db/VERSION; cms/.env / shell env override)
#   type-any-language.content.baked-at  <UTC timestamp>
#
# Subcommands:
#   (default)  Bake: export content from DB → assemble into db/ → docker build
#   doctor     Pre-flight: docker installed? source content present?
#
# Image naming:
#   Local:  ${DB_IMAGE:-english_db_content}:${DB_IMAGE_TAG:-latest}
#   DOCKER_REGISTRY is NOT used here — push is a separate concern.
#   Source the registry from the shell when you're ready to push:
#     export DOCKER_REGISTRY=... && ./db/scripts/push.sh
#   All other vars sourced from cms/.env (defaults match docker-compose.yml).
#
# This script does NOT modify content. It only packages whatever is
# currently in the DB. To update content, run
# `cms/scripts/staging.sh {sync,sentences,audio,publish}` first.
# Audio lives in Tencent Cloud COS (uploaded by staging.sh audio), not
# in this image — see CLAUDE.md for the full architecture.
#
# This script does NOT push. Pushing is a separate, intentional step:
# you might bake many times locally and only push when ready.
# Use ./db/scripts/push.sh for that.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"
source "$SCRIPT_DIR/../../ops/lib.sh"

# Load cms/.env so $DB_IMAGE / $DB_IMAGE_TAG / any user-supplied secrets
# (AI_API_KEY, TENCENT_*, AUDIO_DIR) resolve. Refuses to continue if
# cms/.env is missing — run cms/scripts/env.sh first.
#
# DATABASE_URL is NOT in cms/.env by convention — see CLAUDE.md. We
# assemble it from POSTGRES_PASSWORD (env var or .secrets/postgres_password)
# + code defaults below.
CONTENT_ENV_FILE_PATH="$(resolve_content_env_file)"
if [ -f "$CONTENT_ENV_FILE_PATH" ]; then
    set -a; . "$CONTENT_ENV_FILE_PATH"; set +a
else
    echo "[ERR] $CONTENT_ENV_FILE_PATH 不存在 — 跑 ./cms/scripts/env.sh 先引导一份" >&2
    exit 1
fi

DB_IMAGE="${DB_IMAGE:-english_db_content}"
# DB_IMAGE_TAG defaults to db/VERSION (db is prod-bound content, shared
# by both dev and prod targets). Callers can still pin a specific tag by
# setting DB_IMAGE_TAG in cms/.env or the shell.
resolve_image_tag DB_IMAGE_TAG db/VERSION
warn_if_version_default "$DB_IMAGE_TAG" db/VERSION
FULL_IMAGE="${DB_IMAGE}:${DB_IMAGE_TAG}"

# Source-of-truth for what's inside the image. These get baked into
# image labels so target hosts can discover them via `docker inspect`.
POSTGRES_USER="${POSTGRES_USER:-english_user}"
POSTGRES_DB="${POSTGRES_DB:-english_learning}"

# DATABASE_URL assembly — see ops/lib.sh::db_assemble_url for the chain
# (shell env > POSTGRES_PASSWORD env > .secrets/postgres_password; defaults
# for the rest). The db scripts no longer import any cms Python module.
if [ -z "${DATABASE_URL:-}" ]; then
    if ! db_assemble_url; then
        exit 1
    fi
fi

# SOURCE_OF_TRUTH_FOR_SQL_DUMP — db/scripts/export_bundle.py.
# Lives next to build.sh because it's the db image's *interface* (it
# produces the SQL file the db image bakes from). It does NOT import
# any cms Python module — it works against any db with the 3 content
# tables. The CMS pipeline writes that db (via cms/cms_pipeline/*.py);
# export_bundle just reads.
EXPORT_BUNDLE="db/scripts/export_bundle.py"
STAGING_DIR=".bake-staging"
RUNTIME_BUILDER="db/builder.py"
RUNTIME_TARGET="db"


# ---------------------------------------------------------------------------
# doctor
# ---------------------------------------------------------------------------
cmd_doctor() {
    local ok=1

    echo "Checking environment for bake..."

    if ! check_docker_installed; then
        err "Docker not installed"
        ok=0
    else
        ok "Docker installed"
    fi

    if ! check_docker_daemon_running; then
        err "Docker daemon not running"
        ok=0
    else
        ok "Docker daemon running"
    fi

    if [ ! -d "cms/seed" ]; then
        # cms/seed is the CMS pipeline's input. The db image bake
        # doesn't read it directly — export_bundle.py reads the
        # staging db, not the CSVs. But we still warn here because
        # an empty cms/seed often means the operator forgot to
        # run `cms/scripts/env.sh init` (which scaffolds the
        # example CSVs into cms/seed/).
        warn "cms/seed directory missing — CMS pipeline output (staging db) may be empty"
        info "  (db bake reads from staging db, not cms/seed — but if you're"
        info "   seeing empty data, run ./cms/scripts/env.sh init to scaffold the example CSVs)"
    fi

    if [ ! -f "$EXPORT_BUNDLE" ]; then
        err "$EXPORT_BUNDLE missing — db/ lost its export entry"
        ok=0
    else
        ok "$EXPORT_BUNDLE present"
    fi

    if [ ! -f "$RUNTIME_BUILDER" ]; then
        err "$RUNTIME_BUILDER missing — db/ lost its builder entry"
        ok=0
    else
        ok "$RUNTIME_BUILDER present"
    fi

    # Staging db status — check via db/scripts/source_db.sh status so
    # the doctor doesn't need to know the container name itself.
    if "$SCRIPT_DIR/source_db.sh" status 2>/dev/null | grep -q "RUNNING"; then
        ok "staging db is up — export_bundle will source from it"
    elif PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" \
            -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT 1" &>/dev/null 2>&1; then
        ok "local postgres reachable — export_bundle will source from it"
    else
        warn "No staging db container or local postgres reachable. export_bundle will fail"
        info "  (db/scripts/source_db.sh ensure to start a cms-source-db container, or"
        info "   set POSTGRES_HOST/PORT to point at an existing postgres)"
    fi

    if [ "$ok" = "1" ]; then return 0; else return 1; fi
}


# ---------------------------------------------------------------------------
# main: the bake (default action — no subcommand needed)
# ---------------------------------------------------------------------------
cmd_bake() {
    cmd_doctor || exit 1

    # Pick a python interpreter.
    PY="$(py_cmd)"

    echo
    info "Exporting content from current DB..."
    rm -rf "$STAGING_DIR"
    mkdir -p "$STAGING_DIR"

    # export_bundle creates a dated subdir; capture its path.
    # export_bundle is now part of db/scripts/ — no PYTHONPATH dance
    # needed, no cms dependency.
    if ! "$PY" "$EXPORT_BUNDLE" \
            --keep-staging \
            --output-dir "$STAGING_DIR"; then
        err "export_bundle failed"
        rm -rf "$STAGING_DIR"
        exit 1
    fi

    bundle_path="$(ls -td "$STAGING_DIR"/data-bundle-v* 2>/dev/null | head -1)"
    if [ -z "$bundle_path" ] || [ ! -f "$bundle_path/dump.sql" ]; then
        err "Export did not produce dump.sql — see errors above"
        rm -rf "$STAGING_DIR"
        exit 1
    fi

    # UTC timestamp for the image label.
    baked_at="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)"
    # Best-effort short git SHA. Same convention as dev/prod build scripts.
    git_sha="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

    echo
    info "Building image: ${FULL_IMAGE}"
    info "  labels: db.user=$POSTGRES_USER  db.name=$POSTGRES_DB  version=$DB_IMAGE_TAG  baked_at=$baked_at"
    info "          app.version=$DB_IMAGE_TAG  app.git-sha=$git_sha"

    # Hand off the assembly + build to db/builder.py. That module
    # is db/'s own description of how it gets built; this shell
    # is just the host-side coordinator (env, secrets, timestamps).
    if ! "$PY" "$RUNTIME_BUILDER" \
            --bundle "$bundle_path" \
            --target "$RUNTIME_TARGET" \
            --tag "${FULL_IMAGE}" \
            --db-user "${POSTGRES_USER}" \
            --db-name "${POSTGRES_DB}" \
            --content-version "${DB_IMAGE_TAG}" \
            --baked-at "${baked_at}" \
            --git-sha "${git_sha}"; then
        err "builder.py failed"
        rm -rf "$STAGING_DIR"
        exit 1
    fi

    # Clean staging — db/ now owns the staged inputs.
    rm -rf "$STAGING_DIR"

    echo
    ok "Built: ${FULL_IMAGE}"
    info "To push: export DOCKER_REGISTRY=... && ./db/scripts/push.sh"
}

usage() {
    cat <<EOF
Usage: $0 [doctor]

  (no args)   Bake: export content from DB → assemble into db/ → docker build
  doctor      Pre-flight environment check

Push is a separate step: ./db/scripts/push.sh

Environment (sourced from cms/.env):
  DB_IMAGE        Image name (default: english_db_content)
  DB_IMAGE_TAG    Image tag (default: db/VERSION) — also baked into image label
  POSTGRES_USER   Baked into image label as type-any-language.db.user
                  (default: english_user). The dump.sql's OWNER must match.
  POSTGRES_DB     Baked into image label as type-any-language.db.name
                  (default: english_learning). The dump.sql's database must match.

DOCKER_REGISTRY is NOT used by this script (push is a separate concern).
Set it in the shell before running db/scripts/push.sh:
  export DOCKER_REGISTRY=... && ./db/scripts/push.sh

Versioning:
  DB_IMAGE_TAG       resolves from db/VERSION (or IMAGE_TAG env override).
  The db segment has a single VERSION file (db/VERSION) — see CLAUDE.md
  for the full per-segment VERSION layout and ops/release.sh for the
  bump-and-publish flow.

The actual image-build steps (assemble bundle, copy into db/init/,
run docker build with the right labels) live in db/builder.py —
a sibling of the db/Dockerfile, owned by the db/ segment.
EOF
}

case "${1:-}" in
    doctor)     cmd_doctor ;;
    -h|--help|help) usage ;;
    "")         cmd_bake ;;
    *)          usage; err "Unknown subcommand: $1"; exit 1 ;;
esac