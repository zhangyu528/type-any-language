#!/bin/bash
#
# dev/_common.sh — shared helpers for the dev scripts.
#
# Sourced by every script in dev/. Provides db-lifecycle helpers
# (start the docker db, check it's healthy, warn if it's empty) and a
# staging-files inventory check. No image / registry / watch machinery
# — the dev loop is host-native (dev/native.sh), the only docker
# artifact on a dev host is the `db` service in docker-compose.dev.yml.
#
# Conventions:
#   - $COMMON_DIR is set by the caller (every calling script sets it via
#     `COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`)
#   - `detect_compose_cmd` must be called before any helper that uses
#     $DOCKER_COMPOSE_CMD (require_dev_db_up, ensure_dev_db_up, dev_db_is_up).
#     Most callers run it at the top of the script; native.sh does it
#     explicitly because it doesn't go through the host env that other
#     dev scripts set up.
#
# Runtime model:
#   db         — postgres:15-alpine, data bind-mounted to .dev/data/postgres/
#   backend    — runs on the host (uvicorn --reload, see dev/native.sh)
#   frontend   — runs on the host (next dev, see dev/native.sh)
#
# DATABASE_URL on the host is `postgresql://english_dev:devpw@localhost:5432/english_dev`
# (the same credentials as the db service exposes on the host's :5432).
# No compose `environment:` block for the app — they're host processes.

set -e

: "${PROJECT_DIR:=$(cd "$COMMON_DIR/../.." && pwd)}"
cd "$PROJECT_DIR"
# shellcheck disable=SC1091
source "$PROJECT_DIR/ops/lib.sh"  # dev/ is sibling to ops/, lib.sh still lives under ops/

# ─── Globals ───────────────────────────────────────────────────────────────
COMPOSE_FILE="docker-compose.dev.yml"

# ─── require_dev_db_up ────────────────────────────────────────────────────
# For host-side scripts that talk to the dev docker postgres directly
# (migrate.sh). Verifies the db container is running AND its healthcheck
# reports healthy. Prints a clear hint pointing at native.sh start
# if the db isn't up; otherwise the host script just fails with a
# confusing psycopg "connection refused" / "database does not exist"
# error.
require_dev_db_up() {
    local cid status
    cid="$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q db 2>/dev/null | head -1 || true)"
    if [ -z "$cid" ]; then
        err "dev db 容器没起 — host-side migrate 无 db 可连"
        info "  → 运行: ./dev/native.sh start"
        return 1
    fi
    status="$(docker inspect "$cid" --format '{{.State.Health.Status}}' 2>/dev/null || echo "")"
    if [ "$status" != "healthy" ]; then
        err "dev db 容器状态: ${status:-unknown} (need healthy)"
        info "  → 等几秒再试,或: docker compose -f docker-compose.dev.yml restart db"
        return 1
    fi
    return 0
}

# ─── ensure_dev_db_up ────────────────────────────────────────────────────
# Self-healing variant of require_dev_db_up, used by import_content.sh.
# If the db container is missing, brings up ONLY the db service
# (no backend/frontend — the app stack runs on the host) and waits
# for its healthcheck to report healthy.
#
# Rationale: import is a content operation the operator may run before
# `native.sh start` (e.g. immediately after setup on a fresh
# checkout, or after pulling new cms/content/ from the CMS host).
# Forcing them to also start backend/frontend just to import would
# load the wrong "ready" semantics onto the import command.
ensure_dev_db_up() {
    if dev_db_is_up; then
        return 0
    fi
    info "dev db 容器没起 — 自动起 db 服务..."
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" up -d --pull=never --no-deps db
    # Wait up to 30s for healthcheck.
    local cid i status
    cid="$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q db 2>/dev/null | head -1 || true)"
    if [ -z "$cid" ]; then
        err "  db 服务没起来 — 看 docker compose logs db"
        return 1
    fi
    for i in 1 2 3 4 5 6 7 8 9 10; do
        python -c "import time; time.sleep(3)"
        status="$(docker inspect "$cid" --format '{{.State.Health.Status}}' 2>/dev/null || echo "")"
        if [ "$status" = "healthy" ]; then
            ok "  db 容器已 healthy"
            return 0
        fi
    done
    err "  db 容器 30s 内未 healthy (last status: ${status:-unknown})"
    info "  → 看日志: docker compose logs db"
    return 1
}

# ─── dev_db_is_up ─────────────────────────────────────────────────────────
# Silent boolean probe for "is the db container running and healthy?".
# Returns 0 (true) / 1 (false); no print. Shared by require_dev_db_up
# (which prints on failure) and ensure_dev_db_up (which heals on
# failure). Also used by native.sh start for the empty-db warning.
dev_db_is_up() {
    local cid status
    cid="$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q db 2>/dev/null | head -1 || true)"
    [ -z "$cid" ] && return 1
    status="$(docker inspect "$cid" --format '{{.State.Health.Status}}' 2>/dev/null || echo "")"
    [ "$status" = "healthy" ] && return 0
    return 1
}

# ─── warn_if_db_empty ────────────────────────────────────────────────────
# After native.sh start brings up the db, check whether the db
# has any content (vocabulary_libs row count). 0 rows → warn + hint
# at import_content.sh. Skip silently if the db container isn't up
# (which would mean start itself failed — already surfaced elsewhere).
#
# psql is part of the postgres image but not in $PATH on the host; run
# it via `docker compose exec db` so the operator doesn't need to
# install psql locally.
warn_if_db_empty() {
    if ! dev_db_is_up; then
        return 0
    fi
    local count
    count="$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" exec -T db \
        psql -U english_dev -d english_dev -tAc \
        "SELECT count(*) FROM vocabulary_libs;" 2>/dev/null | tr -d ' ' || echo "")"
    if [ -z "$count" ]; then
        # Query failed (e.g. table doesn't exist yet because migrations
        # haven't run). Don't false-positive the warning.
        return 0
    fi
    if [ "$count" = "0" ]; then
        warn "db 是空的 (vocabulary_libs = 0 行)"
        info "  → 灌入内容: ./dev/import_content.sh"
        info "    (会自动起 db,如果没起;需要 cms/content/{vocabulary,sentences}/ 已有 staging 文件)"
    fi
}

# ─── require_staging_files ────────────────────────────────────────────────
# import_content.sh: refuse to run if cms/content/ has no staging files.
# Without this guard, calling import with an empty source dir causes the
# importer to UPSERT zero rows — which for vocab means wiping the table.
#
# On success, prints the file inventory so the operator can confirm
# "yes, these are the files I want imported" before db rows change.
require_staging_files() {
    local content_dir="$PROJECT_DIR/cms/content"
    local vocab_count sentence_count
    local vocab_files=() sentence_files=()
    while IFS= read -r f; do
        [ -n "$f" ] && vocab_files+=("$f")
    done < <(find "$content_dir/vocabulary" -maxdepth 1 -name '*.json' 2>/dev/null | sort)
    while IFS= read -r f; do
        [ -n "$f" ] && sentence_files+=("$f")
    done < <(find "$content_dir/sentences" -maxdepth 1 -name '*.jsonl' 2>/dev/null | sort)
    vocab_count=${#vocab_files[@]}
    sentence_count=${#sentence_files[@]}
    if [ "$vocab_count" -eq 0 ] && [ "$sentence_count" -eq 0 ]; then
        err "cms/content/ 下没有 staging 文件"
        info "  → 先跑: ./cms/run.sh        # 产出 cms/content/{vocabulary,sentences}/"
        info "  → 或:    ./cms/scripts/cmd_vocab.sh + cmd_sentences.sh (拆开跑)"
        return 1
    fi
    info "  staging 文件: vocabulary=$vocab_count, sentences=$sentence_count"
    if [ "$vocab_count" -gt 0 ]; then
        info "  vocabulary:"
        for f in "${vocab_files[@]}"; do
            info "    $(basename "$f")"
        done
    fi
    if [ "$sentence_count" -gt 0 ]; then
        info "  sentences:"
        for f in "${sentence_files[@]}"; do
            info "    $(basename "$f")"
        done
    fi
    return 0
}
