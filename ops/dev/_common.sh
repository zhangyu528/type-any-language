#!/bin/bash
#
# ops/dev/_common.sh — shared setup for the dev scripts.
#
# Sourced by every script in ops/dev/ — it does the bootstrap that
# otherwise would have to be copy-pasted into each command. Single
# source of truth for: image tag resolution, watch process lifecycle,
# port warnings.
#
# Conventions:
#   - $COMMON_DIR is set by the caller (every calling script sets it via
#     `COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`)
#   - setup_dev_host_env must be called before any other helper — it sets
#     all the *_IMAGE / *_FULL_IMAGE / *_IMAGE_TAG globals.
#
# Runtime model:
#   Three services in dev compose:
#     db         — postgres:15-alpine, data bind-mounted to .dev/data/postgres/
#     backend    — FastAPI / uvicorn --reload, ./backend bind-mounted
#     frontend   — Next.js dev server (HMR via compose watch)
#
#   DATABASE_URL is injected by compose via the `environment:` block
#   (no DATABASE_URL indirection — that's a docker postgres-era
#   artifact that's been retired). The backend's entrypoint.sh runs
#   migrations against the db service on every container start.

set -e

: "${PROJECT_DIR:=$(cd "$COMMON_DIR/../.." && pwd)}"
cd "$PROJECT_DIR"
# shellcheck disable=SC1091
source "$PROJECT_DIR/ops/lib.sh"

# ─── Globals set by setup_dev_host_env ─────────────────────────────────────
COMPOSE_FILE="docker-compose.dev.yml"
BACKEND_IMAGE="english_backend_dev"
FRONTEND_IMAGE="english_frontend_dev"
DB_IMAGE="postgres:15-alpine"

# compose-watch background process. The frontend dev container doesn't
# use a bind mount anymore (see docker-compose.dev.yml `develop.watch`)
# — instead, `docker compose watch` runs as a long-lived process that
# syncs src/ + package files into the container. We auto-spawn it from
# start (nohup, detached) and kill it from stop. PID + log live at the
# repo root so they're easy to inspect / clean.
WATCH_PID_FILE=".compose-frontend-watch.pid"
WATCH_LOG_FILE=".compose-frontend-watch.log"

# ─── setup_dev_host_env — must be called once per script invocation ──────
setup_dev_host_env() {
    # Detect compose command FIRST. This is what populates $DOCKER_COMPOSE_CMD
    # ("docker-compose" vs "docker compose") used by every compose call in
    # this file. Without this call, dev_db_is_up / ensure_dev_db_up /
    # start_compose_watch / gate_preflight etc. all silently fail because
    # their $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ... expands to a bare
    # `-f` with no command. lifecycle.sh start happens to work because
    # cmd_start calls gate_preflight first, which calls require_docker,
    # which calls detect_compose_cmd — masking this bug for the start
    # path. Scripts that DON'T go through gate_preflight (import_content.sh,
    # migrate.sh) hit it.
    if ! detect_compose_cmd; then
        err "未找到 docker-compose / docker compose — 安装 Docker Desktop 或 docker-compose"
        exit 1
    fi

    # DOCKER_REGISTRY: shell env > ./REGISTRY file > detect_default_registry().
    # Empty means "local-only mode" — auto-pull from registry is disabled.
    # (Dev never pushes; it's only consulted for the rare case where a
    # teammate bootstrapped dev by pulling a shared dev image.)
    resolve_docker_registry
    if [ -n "$DOCKER_REGISTRY" ]; then
        if [ "${_DOCKER_REGISTRY_SOURCE:-}" = "detect" ]; then
            info "DOCKER_REGISTRY=$DOCKER_REGISTRY (auto-detected — 仅供可能需要时使用)"
        else
            info "DOCKER_REGISTRY=$DOCKER_REGISTRY (setup 一次性 bootstrap 拉取用,start 不再 auto-pull)"
        fi
    else
        info "DOCKER_REGISTRY 未设置 (local-only mode)"
    fi

    # Dev image tags are **content-hash** based, computed by
    # ops/lib.sh::compute_backend_content_hash / compute_frontend_content_hash.
    # Each image segment gets its own hash from the inputs that actually
    # affect its layers (Dockerfile.dev + entrypoint.sh + requirements.txt
    # for backend; + package.json/lock for frontend). See
    # ops/lib.sh::_dev_image_inputs for the authoritative list. VERSION
    # files (backend/VERSION, frontend/VERSION) gate PROD tags only —
    # `release.sh dev` does not touch VERSION files.
    #
    # Honors three override knobs (in order of decreasing precedence):
    #   1. BACKEND_DEV_TAG  / FRONTEND_DEV_TAG  — per-image override
    #   2. IMAGE_DEV_TAG                        — covers both backend + frontend
    #   3. computed content hash                 — default
    if [ -n "${BACKEND_DEV_TAG:-}" ]; then
        BACKEND_IMAGE_TAG="$BACKEND_DEV_TAG"
        info "Using BACKEND_DEV_TAG override: $BACKEND_IMAGE_TAG"
    elif [ -n "${IMAGE_DEV_TAG:-}" ]; then
        BACKEND_IMAGE_TAG="$IMAGE_DEV_TAG"
        info "Using IMAGE_DEV_TAG override (covers backend + frontend): $BACKEND_IMAGE_TAG"
    else
        BACKEND_IMAGE_TAG="$(compute_dev_image_tag backend)"
    fi
    if [ -n "${FRONTEND_DEV_TAG:-}" ]; then
        FRONTEND_IMAGE_TAG="$FRONTEND_DEV_TAG"
        info "Using FRONTEND_DEV_TAG override: $FRONTEND_IMAGE_TAG"
    elif [ -n "${IMAGE_DEV_TAG:-}" ]; then
        FRONTEND_IMAGE_TAG="$IMAGE_DEV_TAG"
        # (info line already printed above for IMAGE_DEV_TAG)
    else
        FRONTEND_IMAGE_TAG="$(compute_dev_image_tag frontend)"
    fi
    info "Dev image tags (content-hash): backend=$BACKEND_IMAGE_TAG frontend=$FRONTEND_IMAGE_TAG"
    export BACKEND_IMAGE_TAG FRONTEND_IMAGE_TAG

    # Image full references (used in inspect / pull paths).
    if [ "${_DOCKER_REGISTRY_SOURCE:-}" = "shell" ] || [ "${_DOCKER_REGISTRY_SOURCE:-}" = "file" ]; then
        BACKEND_FULL_IMAGE="${DOCKER_REGISTRY}/${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"
        FRONTEND_FULL_IMAGE="${DOCKER_REGISTRY}/${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"
    else
        BACKEND_FULL_IMAGE="${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"
        FRONTEND_FULL_IMAGE="${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"
        # Force compose to use bare names too (its image: line re-uses
        # $DOCKER_REGISTRY for the prefix).
        export DOCKER_REGISTRY=""
    fi
    export BACKEND_FULL_IMAGE FRONTEND_FULL_IMAGE
}

# ─── start_compose_watch / stop_compose_watch ──────────────────────────────
start_compose_watch() {
    if [ -f "$WATCH_PID_FILE" ]; then
        local existing_pid
        existing_pid="$(cat "$WATCH_PID_FILE" 2>/dev/null || echo '')"
        if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
            info "compose watch 已在运行 (PID $existing_pid, log: $WATCH_LOG_FILE)"
            return 0
        fi
        rm -f "$WATCH_PID_FILE"
    fi

    info "后台启动 docker compose watch (frontend sync)..."
    # Truncate the log on each (re)start so the file doesn't grow
    # unbounded across long dev sessions. Operators who want history
    # across runs can `cp` the log before restart.
    : > "$WATCH_LOG_FILE"
    nohup $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" watch \
        > "$WATCH_LOG_FILE" 2>&1 &
    local pid=$!
    disown "$pid" 2>/dev/null || true
    echo "$pid" > "$WATCH_PID_FILE"
    info "  compose watch PID=$pid → $WATCH_LOG_FILE"
}

stop_compose_watch() {
    if [ ! -f "$WATCH_PID_FILE" ]; then
        return 0
    fi
    local pid
    pid="$(cat "$WATCH_PID_FILE" 2>/dev/null || echo '')"
    rm -f "$WATCH_PID_FILE"
    if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
        return 0
    fi
    kill "$pid" 2>/dev/null || true
    sleep 0.2
    if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
    fi
    info "compose watch 已停 (PID was $pid)"
}

# restart_compose_watch: stop then start. lifecycle.sh restart uses this
# because --force-recreate tears down the frontend container the watch
# was syncing into, leaving the watch process attaching to a dead
# container.
restart_compose_watch() {
    stop_compose_watch
    start_compose_watch
}

cmd_watch_foreground() {
    require_docker
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" watch
}

# ─── require_dev_db_up ────────────────────────────────────────────────────
# For host-side scripts that talk to the dev docker postgres directly
# (migrate.sh). Verifies the db container is running AND its healthcheck
# reports healthy. Prints a clear hint pointing at lifecycle.sh start
# if the db isn't up; otherwise the host script just fails with a
# confusing psycopg "connection refused" / "database does not exist"
# error.
require_dev_db_up() {
    local cid status
    cid="$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q db 2>/dev/null | head -1 || true)"
    if [ -z "$cid" ]; then
        err "dev db 容器没起 — host-side migrate 无 db 可连"
        info "  → 运行: ./ops/dev/lifecycle.sh start"
        return 1
    fi
    status="$(docker inspect "$cid" --format '{{.State.Health.Status}}' 2>/dev/null || echo "")"
    if [ "$status" != "healthy" ]; then
        err "dev db 容器状态: ${status:-unknown} (need healthy)"
        info "  → 等几秒再试,或: ./ops/dev/lifecycle.sh restart db"
        return 1
    fi
    return 0
}

# ─── ensure_dev_db_up ────────────────────────────────────────────────────
# Self-healing variant of require_dev_db_up, used by import_content.sh.
# If the db container is missing, brings up ONLY the db service
# (no backend/frontend — this script's responsibility is content, not
# the app stack) and waits for its healthcheck to report healthy.
#
# Rationale: import is a content operation the operator may run before
# `./lifecycle.sh start` (e.g. immediately after setup on a fresh
# checkout, or after pulling new cms/content/ from the CMS host).
# Forcing them to also start backend/frontend just to import would
# load the wrong "ready" semantics onto the import command.
ensure_dev_db_up() {
    if dev_db_is_up; then
        return 0
    fi
    info "dev db 容器没起 — 自动起 db 服务(不碰 backend/frontend)..."
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" up -d --pull=never --no-deps db
    # Wait up to 30s for healthcheck.
    local cid i status
    cid="$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q db 2>/dev/null | head -1 || true)"
    if [ -z "$cid" ]; then
        err "  db 服务没起来 — 看 docker compose logs db"
        return 1
    fi
    for i in 1 2 3 4 5 6 7 8 9 10; do
        sleep 3
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
# failure). Also used by lifecycle.sh start for the empty-db warning.
dev_db_is_up() {
    local cid status
    cid="$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q db 2>/dev/null | head -1 || true)"
    [ -z "$cid" ] && return 1
    status="$(docker inspect "$cid" --format '{{.State.Health.Status}}' 2>/dev/null || echo "")"
    [ "$status" = "healthy" ] && return 0
    return 1
}

# ─── warn_if_db_empty ────────────────────────────────────────────────────
# After lifecycle.sh start brings up the stack, check whether the db
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
        # Query failed (e.g. table doesn't exist yet because entrypoint
        # migrations haven't run). Don't false-positive the warning.
        return 0
    fi
    if [ "$count" = "0" ]; then
        warn "db 是空的 (vocabulary_libs = 0 行)"
        info "  → 灌入内容: ./ops/dev/import_content.sh"
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

# ─── gate_preflight ────────────────────────────────────────────────────────
# Verifies dev host readiness before starting the app stack:
#   1. Docker is installed and the daemon is up.
#   2. Backend + frontend images exist locally (built or pulled).
#   3. Postgres image is pullable (compose will pull on first up).
#   4. Port 3000/8000 not bound on the host.
#
# The db service is brought up by compose itself (it pulls the postgres
# image from Docker Hub, bind-mounts .dev/data/postgres, runs the
# healthcheck). gate_preflight doesn't pre-create the data dir —
# compose handles it.
#
# Port check: default is warn (don't break workflows where a stray
# process is on 3000/8000 and the operator knows about it). Set
# STRICT_PORT_CHECK=1 to fail-fast instead — useful in CI or when the
# operator is debugging a "port already in use" compose error.
gate_preflight() {
    require_docker
    if ! image_exists "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"; then
        err "image ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 未构建"
        info "  → 运行 ops/dev/build_image.sh"
        exit 1
    fi
    if ! image_exists "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"; then
        err "image ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 未构建"
        info "  → 运行 ops/dev/build_image.sh"
        exit 1
    fi
    # First-boot hint: warn if the data dir is fresh (not existing).
    # Compose will create it via the volume mount; this hint just helps
    # the operator know what to expect.
    if [ ! -d "./.dev/data/postgres" ]; then
        info "  注意: ./.dev/data/postgres 不存在 — 第一次启动时 docker 会自动创建空 db"
    fi
    if [ "${STRICT_PORT_CHECK:-0}" = "1" ]; then
        if port_in_use 3000; then
            err "宿主机 3000 端口被占 — frontend 容器无法 bind"
            info "  → 找占用: lsof -i :3000 (macOS/Linux) / netstat -ano | findstr :3000 (Windows)"
            exit 1
        fi
        if port_in_use 8000; then
            err "宿主机 8000 端口被占 — backend 容器无法 bind"
            info "  → 找占用: lsof -i :8000 (macOS/Linux) / netstat -ano | findstr :8000 (Windows)"
            exit 1
        fi
    else
        warn_port_in_use 3000 "前端开发端口 (宿主机 3000)"
        warn_port_in_use 8000 "后端开发端口 (宿主机 8000)"
    fi
}

# ─── drift_check ──────────────────────────────────────────────────────────
# Compare running containers' type-any-language.app.dev-tag / version LABEL
# against the locally-resolved *_IMAGE_TAG. Warns on mismatch. Skipped
# silently if no containers are running.
drift_check() {
    if ! $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q backend >/dev/null 2>&1; then
        return 0
    fi
    local svc cid expected actual
    for svc in backend frontend; do
        case "$svc" in
            backend)  expected="$BACKEND_IMAGE_TAG" ;;
            frontend) expected="$FRONTEND_IMAGE_TAG" ;;
        esac
        cid="$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q "$svc" 2>/dev/null | head -1)"
        if [ -z "$cid" ]; then
            continue
        fi
        actual="$(docker inspect "$cid" --format '{{ index .Config.Labels "type-any-language.app.version" }}' 2>/dev/null || echo "")"
        if [ -z "$actual" ]; then
            warn "  $svc: 无 type-any-language.app.version LABEL (image 旧?rebuild)"
        elif [ "$actual" != "$expected" ]; then
            warn "  $svc drift: running=$actual, expected=$expected — restart 拉新 image"
        else
            ok "  $svc drift OK (tag=$actual)"
        fi
    done
}
