#!/usr/bin/env bash
#
# dev-host/run.sh — manage DEVELOPMENT container lifecycle.
#
# ─── What this is ─────────────────────────────────────────────────────────
# Runs dev containers with **hot-reload**:
#   • ./backend  and  ./frontend  are bind-mounted INTO the container.
#   • Backend  uses `uvicorn --reload` — restart on .py change.
#   • Frontend uses `next dev` (Next.js dev server) — HMR on .tsx/.css change.
#   • Backend pip deps are baked into the image at build time
#     (backend/Dockerfile.dev). Edit requirements.txt → rebuild via
#     build_image.sh, then restart.
#   • Frontend npm deps are hash-gated at start via frontend/entrypoint.sh:
#     npm install only when package.json / package-lock.json SHA256
#     changes. Named docker volume (frontend_dev-node_modules) on
#     /app/node_modules keeps installed deps across container recreates.
#
# ─── Database identity from image labels ─────────────────────────────────
# Same as prod: the db image's labels (type-any-language.db.user / .db.name)
# are read at start time and exported for compose. POSTGRES_PASSWORD is
# generated on first start (or reused if .secrets/postgres_password already
# exists) and materialised to .secrets/postgres_password + .secrets/database_url,
# both chmod 600. ALLOWED_ORIGINS is read from the shell env, falling back
# to the compose-level default (http://localhost,http://localhost:3000).
#
# ─── What this isn't ──────────────────────────────────────────────────────
# Does NOT build images, does NOT manage secrets.
#   • To build dev images:    ./scripts/ops/dev-host/build_image.sh
#   • To reset the dev db:    rm .secrets/postgres_password && docker volume rm <db-data>
#   • To change ALLOWED_ORIGINS: export ALLOWED_ORIGINS=... before start,
#     or edit the default in docker-compose.dev.yml.
#
# ─── Usage ────────────────────────────────────────────────────────────────
#   ./scripts/ops/dev-host/run.sh setup    # first-time: 拉/检查 db image + build dev apps
#   ./scripts/ops/dev-host/run.sh doctor   # run pre-flight environment checks
#   ./scripts/ops/dev-host/run.sh start    # docker compose up -d (dev compose)
#   ./scripts/ops/dev-host/run.sh stop     # docker compose down
#   ./scripts/ops/dev-host/run.sh restart  # hard restart (recreate)
#   ./scripts/ops/dev-host/run.sh reload   # alias for restart
#   ./scripts/ops/dev-host/run.sh logs     # docker compose logs -f
#   ./scripts/ops/dev-host/run.sh status   # docker compose ps
#
# Quick reference — when to use what:
#   • Edit backend/*.py / frontend/src/* → just save. Hot-reload handles it.
#   • Edit backend/requirements.txt or frontend/package.json → just save.
#     entrypoint.sh picks it up on next container recreate (use `restart`).
#   • Edit Dockerfile / .dockerignore → ./scripts/ops/dev-host/build_image.sh && restart.
#   • Edit docker-compose.dev.yml (e.g. ALLOWED_ORIGINS default) → restart.
#   • Edit nginx/* → not applicable (dev has no nginx).
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$PROJECT_DIR"
source "$SCRIPT_DIR/../../lib.sh"

# DOCKER_REGISTRY: shell env > ./REGISTRY file > detect_default_registry().
# Empty (after the chain) means "local-only mode" — auto-pull from registry
# is disabled, but the dev compose still works (it pulls the local image).
resolve_docker_registry
if [ -n "$DOCKER_REGISTRY" ]; then
    if [ "${_DOCKER_REGISTRY_SOURCE:-}" = "detect" ]; then
        info "DOCKER_REGISTRY=$DOCKER_REGISTRY (auto-detected, auto-pull off — 本地模式)"
    else
        info "DOCKER_REGISTRY=$DOCKER_REGISTRY (auto-pull on)"
    fi
else
    info "DOCKER_REGISTRY 未设置 (auto-pull off, local-only mode)"
fi
DB_IMAGE="${DB_IMAGE:-english_db_content}"
# *_IMAGE_TAG resolve to:
#   DB_IMAGE_TAG       ← VERSION.prod (db is "prod-bound" content shared by both targets)
#   BACKEND_IMAGE_TAG  ← VERSION.dev
#   FRONTEND_IMAGE_TAG ← VERSION.dev
# Shell env still overrides. Exported for compose interpolation.
resolve_image_tag DB_IMAGE_TAG       VERSION.prod
resolve_image_tag BACKEND_IMAGE_TAG  VERSION.dev
resolve_image_tag FRONTEND_IMAGE_TAG VERSION.dev
warn_if_version_default "$BACKEND_IMAGE_TAG" VERSION.dev

# Image full references (used in inspect / pull paths).
# Prepend the registry prefix ONLY when DOCKER_REGISTRY was explicitly
# configured (shell env or REGISTRY file). Auto-detected registries
# (docker.io/$USER) are guesses — prepending them makes compose look
# for "zhangyu528/english_db_content:v0.2.0-rc.1" locally, which fails
# because locally-built images are tagged "english_db_content:v0.2.0-rc.1"
# (no prefix). So when the source is "detect", force DOCKER_REGISTRY to
# empty for the rest of the script — compose's
#   image: ${DOCKER_REGISTRY:+${DOCKER_REGISTRY}/}${DB_IMAGE}:${DB_IMAGE_TAG}
# interpolates to the bare local name. Local-only mode effectively.
if [ "${_DOCKER_REGISTRY_SOURCE:-}" = "shell" ] || [ "${_DOCKER_REGISTRY_SOURCE:-}" = "file" ]; then
    DB_FULL_IMAGE="${DOCKER_REGISTRY}/${DB_IMAGE}:${DB_IMAGE_TAG}"
    BACKEND_FULL_IMAGE="${DOCKER_REGISTRY}/${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"
    FRONTEND_FULL_IMAGE="${DOCKER_REGISTRY}/${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"
else
    DB_FULL_IMAGE="${DB_IMAGE}:${DB_IMAGE_TAG}"
    BACKEND_FULL_IMAGE="${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"
    FRONTEND_FULL_IMAGE="${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"
    # Force compose to use bare names too (its own image: line re-uses
    # $DOCKER_REGISTRY for the prefix).
    export DOCKER_REGISTRY=""
fi
export BACKEND_FULL_IMAGE FRONTEND_FULL_IMAGE

SECRETS_DIR=".secrets"
PG_PASSWORD_FILE="${SECRETS_DIR}/postgres_password"
DB_URL_FILE="${SECRETS_DIR}/database_url"
COMPOSE_FILE="docker-compose.dev.yml"
BACKEND_IMAGE="english_backend_dev"
FRONTEND_IMAGE="english_frontend_dev"

# ---------------------------------------------------------------------------
# inspect_db_image_labels
# Same as prod/run.sh.
# ---------------------------------------------------------------------------
inspect_db_image_labels() {
    if ! image_exists "$DB_FULL_IMAGE"; then
        return 1
    fi
    DB_USER="$(image_label "$DB_FULL_IMAGE" "type-any-language.db.user" || echo "")"
    DB_NAME="$(image_label "$DB_FULL_IMAGE" "type-any-language.db.name" || echo "")"
    DB_VERSION="$(image_label "$DB_FULL_IMAGE" "type-any-language.content.version" || echo "")"
    DB_BAKED_AT="$(image_label "$DB_FULL_IMAGE" "type-any-language.content.baked-at" || echo "")"
    export DB_USER DB_NAME DB_VERSION DB_BAKED_AT
    [ -n "$DB_USER" ] && [ -n "$DB_NAME" ]
}

# export_db_identity_for_compose — make sure DB_USER / DB_NAME are set
# so compose interpolation (${DB_USER:?...} / ${DB_NAME:?...} in
# docker-compose.dev.yml) doesn't fail. Used by read-only subcommands
# (`status` / `stop` / `logs`) where the *actual* values don't matter
# for the operation — we just need *some* non-empty value to satisfy
# compose's strict interpolation.
#
# Falls back to the same defaults bake_image.sh uses (english_user /
# english_learning) when the db image isn't around locally. Those
# defaults are the ones that ship with the project, so compose's
# evaluated result matches what a fresh bake would produce — `ps` will
# show the right container names, `down` will target the right project,
# `logs` will stream from the right services.
#
# NOT a substitute for inspect_db_image_labels in cmd_start /
# cmd_restart — those need the *real* values to assemble the right
# DATABASE_URL and POSTGRES_PASSWORD.
export_db_identity_for_compose() {
    if inspect_db_image_labels; then
        return 0
    fi
    DB_USER="${DB_USER:-english_user}"
    DB_NAME="${DB_NAME:-english_learning}"
    export DB_USER DB_NAME
}

# ---------------------------------------------------------------------------
# write_secrets
#
# Materialises host-side secrets on disk so compose can mount them as
# files into the db and backend containers (via POSTGRES_PASSWORD_FILE
# and DATABASE_URL_FILE).
#
#   .secrets/postgres_password   (chmod 600) — generated on first start,
#                                              reused across restarts
#   .secrets/database_url        (chmod 600) — assembled from above +
#                                              DB_USER / DB_NAME from image
#
# Idempotent: existing .secrets/postgres_password is preserved across
# restarts so the db volume's password stays stable. To reset the dev
# db, delete the file (and the db-data volume).
# ---------------------------------------------------------------------------
write_secrets() {
    if [ -z "${DB_USER:-}" ] || [ -z "${DB_NAME:-}" ]; then
        err "DB_USER / DB_NAME 未设置 — db image 的 label 缺失或不正确"
        return 1
    fi

    mkdir -p "$SECRETS_DIR"
    chmod 700 "$SECRETS_DIR"

    if [ -f "$PG_PASSWORD_FILE" ]; then
        # Reuse existing password so the db-data volume keeps its user
        # credentials (changing it would make the existing db unreachable).
        POSTGRES_PASSWORD="$(cat "$PG_PASSWORD_FILE")"
        info "复用现有 $(basename "$PG_PASSWORD_FILE")"
    else
        # First start on this host — generate a fresh 24-char URL-safe secret.
        POSTGRES_PASSWORD="$(gen_secret 24)"
        info "新生成 POSTGRES_PASSWORD → $(basename "$PG_PASSWORD_FILE")"
    fi
    # No trailing newline (postgres reads it strictly).
    printf '%s' "$POSTGRES_PASSWORD" > "$PG_PASSWORD_FILE"
    chmod 600 "$PG_PASSWORD_FILE"

    # database_url: postgresql://<user>:<password>@db:5432/<name>
    # password is URL-encoded as %xx if needed. We use python if available
    # for proper escaping; fall back to a noop pass.
    if command -v python3 &> /dev/null; then
        encoded_pw="$(DB_USER="$DB_USER" DB_NAME="$DB_NAME" POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
            python3 -c 'import os, urllib.parse; print("postgresql://%s:%s@db:5432/%s" % (urllib.parse.quote(os.environ["DB_USER"]), urllib.parse.quote(os.environ["POSTGRES_PASSWORD"], safe=""), os.environ["DB_NAME"]))')"
    else
        # Fallback: trust that secrets.token_urlsafe output is URL-safe
        # (it is — alphabet is A-Z a-z 0-9 - _).
        encoded_pw="postgresql://${DB_USER}:${POSTGRES_PASSWORD}@db:5432/${DB_NAME}"
    fi
    printf '%s' "$encoded_pw" > "$DB_URL_FILE"
    chmod 600 "$DB_URL_FILE"
}

# ---------------------------------------------------------------------------
# gate_preflight
# ---------------------------------------------------------------------------
gate_preflight() {
    require_docker
    if ! image_exists "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"; then
        err "image ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 未构建"
        info "  → 运行 ./scripts/ops/dev-host/build_image.sh"
        exit 1
    fi
    if ! image_exists "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"; then
        err "image ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 未构建"
        info "  → 运行 ./scripts/ops/dev-host/build_image.sh"
        exit 1
    fi
    if ! image_exists "$DB_FULL_IMAGE"; then
        err "db image $DB_FULL_IMAGE 未构建或未拉取"
        if [ -n "$DOCKER_REGISTRY" ]; then
            info "  → 设置 DB_IMAGE_TAG 后由 run.sh 拉取，或: docker pull $DB_FULL_IMAGE"
        else
            info "  → 运行 ./scripts/ops/db/bake_image.sh（可用 --tag dev 标记）"
            info "  → 之后再次运行 ./scripts/ops/dev-host/run.sh start"
        fi
        exit 1
    fi
    warn_port_in_use 3000 "前端开发端口 (宿主机 3000)"
    warn_port_in_use 8000 "后端开发端口 (宿主机 8000)"
    warn_port_in_use 5432 "postgres 端口 (宿主机 5432)"
}

# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------
cmd_doctor() {
    local failed=0
    echo "=== Development environment check ==="
    echo ""

    if check_docker_installed; then
        ok "docker 已安装: $(docker --version 2>&1 | head -1)"
    else
        err "docker 未安装"; failed=1
    fi

    if check_docker_daemon_running; then
        ok "docker daemon 运行中"
    else
        err "docker daemon 未运行"; failed=1
    fi

    if detect_compose_cmd 2>/dev/null; then
        ok "compose: $DOCKER_COMPOSE_CMD"
    else
        err "未找到 docker-compose / docker compose"; failed=1
    fi

    if [ -f "$PG_PASSWORD_FILE" ]; then
        ok ".secrets/postgres_password 存在（密码稳定，db 不会重置）"
    else
        info ".secrets/postgres_password 缺失 — 下次 start 会现场生成"
    fi

    if check_docker_installed && check_docker_daemon_running; then
        if image_exists "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"; then
            ok "image ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 存在"
        else
            warn "image ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 缺失 → 运行 ./scripts/ops/dev-host/build_image.sh"
        fi
        if image_exists "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"; then
            ok "image ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 存在"
        else
            warn "image ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 缺失 → 运行 ./scripts/ops/dev-host/build_image.sh"
        fi
        if image_exists "$DB_FULL_IMAGE"; then
            ok "db image $DB_FULL_IMAGE 存在"
            if inspect_db_image_labels; then
                ok "  db.user = $DB_USER"
                ok "  db.name = $DB_NAME"
                ok "  content.version = $DB_VERSION"
                ok "  content.baked-at = $DB_BAKED_AT"
            else
                warn "  db image 缺少 type-any-language.* labels — 重新 bake？"
            fi
        elif [ -n "$DOCKER_REGISTRY" ]; then
            warn "db image $DB_FULL_IMAGE 缺失 → docker pull $DB_FULL_IMAGE"
        else
            warn "db image $DB_FULL_IMAGE 缺失 → ./scripts/ops/db/bake_image.sh"
        fi
    fi

    warn_port_in_use 3000 "前端开发端口 (宿主机 3000)"
    warn_port_in_use 8000 "后端开发端口 (宿主机 8000)"
    warn_port_in_use 5432 "postgres 端口 (宿主机 5432)"

    echo "--- drift check (running containers vs local VERSION) ---"
    drift_check

    echo ""
    if [ $failed -eq 0 ]; then
        ok "所有必需检查通过"
        return 0
    else
        err "部分必需检查未通过"
        return 1
    fi
}

auto_pull_from_registry() {
    if [ -z "$DOCKER_REGISTRY" ]; then
        return 0
    fi
    # Auto-detected registries (docker.io/$USER) are a guess, not a
    # configured destination. If the operator never set DOCKER_REGISTRY
    # (shell env or REGISTRY file), they're probably on a single-host
    # setup that bakes locally — pulling from a registry they never
    # pushed to will just 429. Skip silently; the message at the top
    # of cmd_setup already explained why.
    if [ "${_DOCKER_REGISTRY_SOURCE:-}" = "detect" ]; then
        info "DOCKER_REGISTRY=$DOCKER_REGISTRY (auto-detected — 跳过 auto-pull)"
        return 0
    fi
    info "DOCKER_REGISTRY=$DOCKER_REGISTRY — 拉取最新 dev images (db + backend + frontend)..."
    if ! $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" pull; then
        warn "部分 image 拉取失败 — 将使用本地已 build 的 image（如有）"
    fi
}

# ---------------------------------------------------------------------------
# Auto-bake helpers (used by cmd_setup when local CMS env is sufficient)
#
# On a single-host CMS+dev setup (.env.db present + DOCKER_REGISTRY unset),
# the CMS content-production pipeline normally requires several manual
# steps (start postgres, sync, sentences, audio, bake). These helpers let
# cmd_setup run the whole chain automatically. Every helper is idempotent
# — re-running setup on a populated host is cheap, and `sentences` / `audio`
# are skip-existing on their end so re-runs don't burn API calls.
# ---------------------------------------------------------------------------

# setup_resolve_pg_password — print POSTGRES_PASSWORD (no trailing newline).
# Sources (in order): shell env > .secrets/postgres_password > .env.db.
setup_resolve_pg_password() {
    if [ -n "${POSTGRES_PASSWORD:-}" ]; then
        printf '%s' "$POSTGRES_PASSWORD"
        return 0
    fi
    if [ -f "$SECRETS_DIR/postgres_password" ]; then
        cat "$SECRETS_DIR/postgres_password"
        return 0
    fi
    if [ -f "$PROJECT_DIR/.env.db" ]; then
        local pw
        pw="$(grep -E '^POSTGRES_PASSWORD=' "$PROJECT_DIR/.env.db" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
        if [ -n "$pw" ]; then
            printf '%s' "$pw"
            return 0
        fi
    fi
    err "POSTGRES_PASSWORD 不可解析 — 在 .env.db 里设 POSTGRES_PASSWORD=... 或"
    err "确保 .secrets/postgres_password 存在"
    return 1
}

# setup_ensure_source_db — make sure a postgres source for the bake is
# reachable. Tries three strategies, in order:
#   1. english_db / english_db_dev container already running — use it.
#   2. local postgres reachable at POSTGRES_HOST:POSTGRES_PORT — use it.
#   3. spin up a fresh english_db container (postgres:15-alpine) with the
#      right POSTGRES_USER / POSTGRES_DB / POSTGRES_PASSWORD, published on
#      $POSTGRES_PORT (default 5432) so content.sh on the host can reach it.
# Returns 0 if a source db is reachable after the call; 1 otherwise.
setup_ensure_source_db() {
    # 1. named container already running?
    local running
    running="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -E '^(english_db|english_db_dev)$' | head -1 || true)"
    if [ -n "$running" ]; then
        ok "  source db: container '$running' 已在跑"
        return 0
    fi

    local pg_user="${POSTGRES_USER:-english_user}"
    local pg_db="${POSTGRES_DB:-english_learning}"
    local pg_host="${POSTGRES_HOST:-localhost}"
    local pg_port="${POSTGRES_PORT:-5432}"

    # 2. local postgres reachable at POSTGRES_HOST:POSTGRES_PORT?
    #    Skip silently if host has no psql — fall through to docker run.
    if command -v psql &>/dev/null && \
       PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$pg_host" -p "$pg_port" \
            -U "$pg_user" -d "$pg_db" -tAc "SELECT 1" &>/dev/null; then
        ok "  source db: 本地 postgres ($pg_host:$pg_port) 可达"
        return 0
    fi

    # 3. spin up a fresh english_db container. Re-use a stopped one if present
    #    (typical after a `docker stop` between sessions — keeps the data vol).
    info "  source db: 本地无可达 postgres — 自动起 english_db 容器..."
    if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qE '^english_db$'; then
        info "    english_db 容器存在但未跑 — 启动"
        if ! docker start english_db >/dev/null; then
            err "    docker start english_db 失败"
            return 1
        fi
    else
        info "    创建 english_db (postgres:15-alpine)..."
        if ! docker run -d \
                --name english_db \
                -e "POSTGRES_USER=$pg_user" \
                -e "POSTGRES_DB=$pg_db" \
                -e "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" \
                -p "${pg_port}:5432" \
                -v cms-source-data:/var/lib/postgresql/data \
                postgres:15-alpine >/dev/null; then
            err "    docker run english_db 失败 — 检查 docker / 端口冲突 (${pg_host}:${pg_port})"
            return 1
        fi
    fi

    # Wait up to 30s for the container to accept connections. Use docker exec
    # so this works even on hosts without psql (Windows / macOS without
    # postgres-client installed) — pg_isready is bundled inside the image.
    info "    等 english_db 就绪 (最多 30s)..."
    local i
    for i in $(seq 1 30); do
        if docker exec english_db pg_isready -U "$pg_user" -d "$pg_db" &>/dev/null; then
            ok "  source db: english_db 就绪"
            return 0
        fi
        sleep 1
    done
    err "    english_db 30s 内未就绪 — 看 docker logs english_db 找原因"
    return 1
}

# setup_run_content_step <desc> <subcommand> [args...]
# Run a content.sh subcommand with progress logging. Returns 0/1.
setup_run_content_step() {
    local desc="$1"; shift
    info "  [content.sh] $desc..."
    if ! "$SCRIPT_DIR/../db/content.sh" "$@"; then
        err "  [content.sh] $desc 失败 (退出码 $?)"
        return 1
    fi
    ok "  [content.sh] $desc ok"
    return 0
}

# setup_auto_bake — full auto-bake chain, used by cmd_setup when local
# CMS env is sufficient (.env.db present + DOCKER_REGISTRY unset).
#
# Hard-fail on init-schema / sync / bake — those should only fail if env
# is broken (no .env.db, no docker, etc.) and there's no useful recovery.
# Best-effort on sentences / audio — those depend on external services
# (OpenAI / Tencent TTS) that can rate-limit or run out of quota. If they
# fail, log loud warnings and let the bake proceed with whatever content
# sync produced. The dev runtime will still come up; /api/sentences just
# returns [] until the next setup run fills them in.
setup_auto_bake() {
    # Resolve POSTGRES_PASSWORD (also exports it so content.sh + bake can read).
    POSTGRES_PASSWORD="$(setup_resolve_pg_password)" || return 1
    export POSTGRES_PASSWORD

    # Source .env.db so POSTGRES_USER/HOST/PORT/DB / AI_* / TENCENT_* / AUDIO_DIR resolve.
    set -a; . "$PROJECT_DIR/.env.db"; set +a

    # (a) ensure source db.
    info "  (a) ensure source db"
    setup_ensure_source_db || return 1

    # (b) schema (idempotent — CREATE TABLE IF NOT EXISTS).
    setup_run_content_step "init-schema" init-schema || return 1

    # (c) vocab CSVs → DB (idempotent — skip-existing per commit 0a14705).
    setup_run_content_step "sync (CSVs → vocab)" sync || return 1

    # (d) AI-fill sentences. Best-effort: AI_* missing → skip; API fails →
    # warn and continue (dev will still come up, /api/sentences returns []).
    if [ -n "${AI_API_KEY:-}" ] && [ -n "${AI_BASE_URL:-}" ] && [ -n "${AI_MODEL:-}" ]; then
        setup_run_content_step "sentences (AI-fill)" sentences || \
            warn "  sentences 失败 — 跳过 (dev 起来后 /api/sentences 会返回空)"
    else
        warn "  跳过 sentences (AI_API_KEY / AI_BASE_URL / AI_MODEL 没设齐)"
    fi

    # (e) TTS audio. All-or-nothing: any TENCENT_* missing → skip.
    if [ -n "${TENCENT_SECRET_ID:-}" ] && [ -n "${TENCENT_SECRET_KEY:-}" ] && \
       [ -n "${TENCENT_APP_ID:-}" ]; then
        setup_run_content_step "audio (TTS-fill)" audio || \
            warn "  audio 失败 — 跳过 (sentences.audio_url 没填 /audio/<hash>.mp3 会 404)"
    else
        warn "  跳过 audio (TENCENT_* 没填齐)"
    fi

    # (f) bake.
    info "  (f) bake_image.sh"
    if ! "$SCRIPT_DIR/../db/bake_image.sh"; then
        err "  bake_image.sh 失败 — 看上面 export_bundle 的错误"
        return 1
    fi
    ok "  bake_image.sh ok"
    return 0
}

# ---------------------------------------------------------------------------
# cmd_setup — first-time (or post-reset) environment bootstrap.
#
# Walks the operator through the image dependency chain so a fresh clone is
# one command away from `./dev.sh start`:
#
#   1. Preflight: docker + compose must be present.
#   2. db image: must be locally present (build_image.sh reads DB_USER /
#      DB_NAME from its OCI labels — a hard requirement, not a convenience).
#      If missing, try:
#        - DOCKER_REGISTRY set → docker pull
#        - .env.db present (or scaffolded via env.sh init, validated by
#          doctor) → single-host auto-bake (full CMS pipeline on this host)
#      env.sh init is idempotent (no-op when .env.db already exists); doctor
#      runs unconditionally as a gate so empty templates / missing keys
#      fail-fast before the expensive bake starts. If auto-bake itself
#      fails, exit 1 with manual-troubleshooting pointers (the dev app build
#      below would fail with a less actionable error anyway).
#   3. dev app images: call ./scripts/ops/dev-host/build_image.sh (it
#      builds both backend + frontend in one shot). Skipped if both
#      already present (idempotent — no need to rebuild cached layers).
#   4. Final summary.
#
# This command does NOT create .secrets/, start any containers, or push
# to a registry. It's strictly an image-management pass. Re-run as many
# times as you want — nothing destructive.
# ---------------------------------------------------------------------------
cmd_setup() {
    info "=== dev environment setup ==="
    echo ""

    # 1. Preflight — same checks as the rest of run.sh, but the failure
    #    mode is "print and stop" (not "exit 1") so the operator can see
    #    every missing prerequisite in one go.
    local preflight_ok=1
    if check_docker_installed; then
        ok "docker 已安装: $(docker --version 2>&1 | head -1)"
    else
        err "docker 未安装"; preflight_ok=0
    fi
    if [ $preflight_ok -eq 1 ] && check_docker_daemon_running; then
        ok "docker daemon 运行中"
    else
        err "docker daemon 未运行 (启动 Docker Desktop)"; preflight_ok=0
    fi
    if [ $preflight_ok -eq 1 ] && detect_compose_cmd 2>/dev/null; then
        ok "compose: $DOCKER_COMPOSE_CMD"
    else
        err "未找到 docker-compose / docker compose"; preflight_ok=0
    fi
    if [ $preflight_ok -eq 0 ]; then
        err "preflight 失败 — 修好上面 1-2 项后再跑 setup"
        return 1
    fi
    echo ""

    # 2. db image — must be present locally for the dev app build below.
    #    Resolution chain (each step falls through to the next on miss):
    #      a. local image already present
    #      b. DOCKER_REGISTRY set → docker pull (fast path; bypasses local CMS work)
    #      c. .env.db present or scaffoldable via env.sh init (validated by
    #         doctor) → single-host CMS+dev auto-bake (full pipeline)
    #    env.sh init is idempotent — second run skips silently. Doctor runs
    #    unconditionally as a gate so empty templates / partial .env.db
    #    fail-fast before the expensive bake starts.
    info "Step 1/2: db image ($DB_FULL_IMAGE)"
    local got_image=0
    if image_exists "$DB_FULL_IMAGE"; then
        ok "  本地已有 $DB_FULL_IMAGE"
        got_image=1
    else
        warn "db image 不在本地"
        if [ -n "$DOCKER_REGISTRY" ]; then
            info "  DOCKER_REGISTRY=$DOCKER_REGISTRY — 尝试 docker pull..."
            echo ""
            if docker pull "$DB_FULL_IMAGE"; then
                echo ""
                ok "  pull 成功"
                got_image=1
            else
                # Don't exit — fall through to auto-bake below. The pull
                # might've failed because the registry is rate-limited
                # (HTTP 429) or the image genuinely isn't there yet.
                # Local content pipeline (scaffold → doctor → bake) can
                # pick up the slack whether .env.db exists or not.
                warn "  pull 失败 — fallback 到本地 auto-bake"
            fi
        fi
        if [ "$got_image" = "0" ]; then
            # .env.db 缺失 → 先 scaffold (env.sh init 幂等,已存在会跳过)。
            # 把 init 放在这里而不是 fallback 的最后,目的是把"先填 secrets"
            # 接到同一个 setup 流程里 — 操作员不用切到另一条命令链。
            if [ ! -f "$PROJECT_DIR/.env.db" ]; then
                info "  本机没有 .env.db — 先 scaffold 一个:"
                echo ""
                if ! "$SCRIPT_DIR/../db/env.sh" init; then
                    err "  env.sh init 失败 — 检查 .env.example.db 是否存在"
                    return 1
                fi
                echo ""
                warn "  ↑ 上面只是 scaffold,secrets 还要手动填 (nano .env.db)"
                echo ""
            fi
            # doctor 当 gate:空模板 / 缺 key 都 fail-fast,避免带着空
            # .env.db 进 auto_bake 浪费一次完整 bake。
            if ! "$SCRIPT_DIR/../db/env.sh" doctor; then
                err "  .env.db 还差 key — 填好后重跑 setup"
                return 1
            fi
            # 单机 CMS+dev:auto-bake 跑完整链 (source db + 内容 + 烘焙)。
            # 每步都是幂等的,已部署的 host 重跑也不会浪费 API 调用。
            info "  调 setup_auto_bake (source db + 内容 + 烘焙)..."
            echo ""
            if setup_auto_bake; then
                echo ""
                ok "  自动 bake 完成"
                got_image=1
            else
                err "  自动 bake 失败 — 上面的错误说明哪步挂了"
                info "  手动排查:"
                info "    docker logs english_db          # 如果 source db 起不来"
                info "    ./scripts/ops/db/content.sh doctor   # 内容管线 preflight"
                return 1
            fi
        fi
    fi
    if inspect_db_image_labels; then
        ok "  db.user=$DB_USER  db.name=$DB_NAME  content.version=$DB_VERSION"
    else
        warn "  db image 缺 type-any-language.* label — 重新 bake"
        return 1
    fi
    echo ""

    # 3. dev app images — call build_image.sh (handles both at once).
    #    Skipped when both already exist; otherwise build_image.sh is
    #    fast (cached layers) and idempotent.
    info "Step 2/2: dev app images"
    if image_exists "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" && \
       image_exists "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"; then
        ok "  ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 已存在"
        ok "  ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 已存在"
        info "  (要 rebuild? 跑: ./scripts/ops/dev-host/build_image.sh)"
    else
        info "  调 ./scripts/ops/dev-host/build_image.sh..."
        echo ""
        if "$SCRIPT_DIR/build_image.sh"; then
            echo ""
            ok "  build done"
        else
            err "  build 失败 — 见上面的错误"
            return 1
        fi
    fi
    echo ""

    # 4. Final summary
    ok "=== setup 完成 ==="
    info "  下一步: ./dev.sh start"
    info "  启动后访问:"
    info "    前端: http://localhost:3000"
    info "    后端: http://localhost:8000  (API 文档: /docs)"
}

# drift_check — compare running containers' type-any-language.app.version
# LABEL against the locally-resolved *_IMAGE_TAG. Warns on mismatch.
# Skipped silently if no containers are running.
drift_check() {
    if ! $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q db >/dev/null 2>&1; then
        return 0
    fi
    local svc cid expected actual
    for svc in db backend frontend; do
        case "$svc" in
            db)      expected="$DB_IMAGE_TAG" ;;
            backend) expected="$BACKEND_IMAGE_TAG" ;;
            frontend) expected="$FRONTEND_IMAGE_TAG" ;;
        esac
        cid="$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q "$svc" 2>/dev/null | head -1)"
        if [ -z "$cid" ]; then
            continue
        fi
        actual="$(docker inspect "$cid" --format '{{ index .Config.Labels "type-any-language.app.version" }}' 2>/dev/null || echo "")"
        if [ -z "$actual" ]; then
            warn "  $svc: 无 type-any-language.app.version LABEL (image 旧？rebuild)"
        elif [ "$actual" != "$expected" ]; then
            warn "  $svc drift: running=$actual, expected=$expected — run.sh restart 拉新 image"
        else
            ok "  $svc drift OK (version=$actual)"
        fi
    done
}

cmd_start() {
    gate_preflight
    if ! inspect_db_image_labels; then
        err "db image 缺少 type-any-language.* labels — 用 ./scripts/ops/db/bake_image.sh 重新烘焙"
        exit 1
    fi
    write_secrets
    auto_pull_from_registry
    info "启动开发容器..."
    # `--pull=never`: auto_pull_from_registry above is the single source
    # of pull attempts (best-effort). Without this flag, compose up -d
    # would default to `--pull=missing` and re-pull, hitting 429 on
    # registries that don't host the image (or pulling mismatched tags
    # when the local image was built without the registry prefix).
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" up -d --pull=never
    ok "服务已启动（热重载已开启）"
    echo -e "  前端:   ${_LIB_BLUE}http://localhost:3000${_LIB_NC}"
    echo -e "  后端:   ${_LIB_BLUE}http://localhost:8000${_LIB_NC}"
    echo -e "  API文档: ${_LIB_BLUE}http://localhost:8000/docs${_LIB_NC}"
    echo "  db.user=$DB_USER  db.name=$DB_NAME  content.version=$DB_VERSION"
}

cmd_stop() {
    require_docker
    # Compose evaluates the full file at every subcommand (including
    # `down`), so DB_USER / DB_NAME must be exported first — otherwise
    # the ${DB_USER:?...} interpolation in the db service's environment
    # block fails before docker even looks at running containers.
    # Fall back to the bake defaults when the db image isn't local —
    # see export_db_identity_for_compose.
    export_db_identity_for_compose
    info "停止开发容器..."
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" down
    ok "服务已停止"
}

cmd_restart() {
    gate_preflight
    if ! inspect_db_image_labels; then
        err "db image 缺少 type-any-language.* labels — 用 ./scripts/ops/db/bake_image.sh 重新烘焙"
        exit 1
    fi
    write_secrets
    auto_pull_from_registry
    info "重启开发容器（重新加载 secrets）..."

    BACKEND_BEFORE=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" 2>/dev/null || true)
    FRONTEND_BEFORE=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}" 2>/dev/null || true)

    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" up -d --no-deps --force-recreate backend frontend

    BACKEND_AFTER=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" 2>/dev/null || true)
    FRONTEND_AFTER=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}" 2>/dev/null || true)

    if [ -n "$BACKEND_BEFORE" ] && [ "$BACKEND_BEFORE" != "$BACKEND_AFTER" ]; then
        warn "$BACKEND_IMAGE image ID 变化了 — 你是改了 Dockerfile？"
        warn "  这种情况请用 ./scripts/ops/dev-host/build_image.sh 重 build 后再 restart"
    fi
    if [ -n "$FRONTEND_BEFORE" ] && [ "$FRONTEND_BEFORE" != "$FRONTEND_AFTER" ]; then
        warn "$FRONTEND_IMAGE image ID 变化了 — 你是改了 Dockerfile？"
        warn "  这种情况请用 ./scripts/ops/dev-host/build_image.sh 重 build 后再 restart"
    fi

    ok "服务已重启（secrets 已重读）"
}

cmd_reload() { cmd_restart "$@"; }

cmd_logs() {
    require_docker
    # See cmd_stop for the why — compose evaluates the file even for
    # read-only ops like `logs`.
    export_db_identity_for_compose
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" logs -f "$@"
}

cmd_status() {
    require_docker
    # See cmd_stop for the why — `ps` is read-only but compose still
    # evaluates the whole file.
    export_db_identity_for_compose
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps
}

usage() {
    cat <<EOF
用法: ./scripts/ops/dev-host/run.sh <command>

命令:
  setup    首次环境引导: 拉/检查 db image,build 缺失的 dev app images,无 start 副作用
  doctor   跑完整环境检查（不修改任何东西，纯只读）
  start    启动开发容器（热重载）。如 DOCKER_REGISTRY 配了就 auto-pull (db + backend + frontend)
  stop     停止开发容器
  restart  重启容器并重新读取 secrets (≈5s, 不重 build image)
  reload   同 restart —— 别名，语义更清晰
  logs     跟踪日志 (Ctrl+C 退出)
  status   查看容器状态

典型工作流:
  ./scripts/ops/dev-host/run.sh setup         # 首次或重置后: 一次性就位所有 image
  ./scripts/ops/dev-host/run.sh doctor        # 跑一遍检查，看环境是否就绪
  ./scripts/ops/dev-host/run.sh start         # 启动 (DOCKER_REGISTRY 配了会先 auto-pull)
  ./scripts/ops/dev-host/run.sh restart       # 改 docker-compose.dev.yml / .secrets 后用这个
  ./scripts/ops/dev-host/build_image.sh && \\
    ./scripts/ops/dev-host/run.sh restart     # 改代码 / Dockerfile 后
  ./scripts/ops/dev-host/run.sh logs backend  # 跟踪 backend 日志

环境覆盖:
  ALLOWED_ORIGINS=https://my.domain ./scripts/ops/dev-host/run.sh start
  DOCKER_REGISTRY=ghcr.io/me \
    DB_IMAGE_TAG=v1.2 BACKEND_IMAGE_TAG=v1.2 FRONTEND_IMAGE_TAG=v1.2 \
    ./scripts/ops/dev-host/run.sh start
  # IMAGE_TAG=v1.2 一次性给所有 image 设同 tag（CI 用）
EOF
}

case "${1:-}" in
    setup)   cmd_setup "$@" ;;
    doctor)  cmd_doctor "$@" ;;
    start)   cmd_start "$@" ;;
    stop)    cmd_stop "$@" ;;
    restart) cmd_restart "$@" ;;
    reload)  cmd_reload "$@" ;;
    logs)    shift; cmd_logs "$@" ;;
    status)  cmd_status "$@" ;;
    -h|--help|help|"") usage ;;
    *) err "未知命令: $1"; usage; exit 1 ;;
esac