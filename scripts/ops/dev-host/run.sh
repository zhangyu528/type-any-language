#!/usr/bin/env bash
#
# dev-host/run.sh — manage DEVELOPMENT container lifecycle.
#
# ─── What this is ─────────────────────────────────────────────────────────
# Runs dev containers with **hot-reload**:
#   • ./backend  and  ./frontend  are bind-mounted INTO the container.
#   • Backend  uses `uvicorn --reload` — restart on .py change.
#   • Frontend uses react-scripts dev server — HMR on .tsx/.css change.
#   • entrypoint.sh is hash-aware: pip install only when requirements.txt
#     SHA256 changes; npm install only when package.json / package-lock.json
#     SHA256 changes. So dependency edits also "just work" — no rebuild.
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

# DOCKER_REGISTRY may be set in the shell env (CI / wrapper). Default to
# "auto-pull off" (local-only mode) when unset.
DOCKER_REGISTRY="${DOCKER_REGISTRY:-}"
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

DB_FULL_IMAGE="${DOCKER_REGISTRY:+${DOCKER_REGISTRY}/}${DB_IMAGE}:${DB_IMAGE_TAG}"
BACKEND_FULL_IMAGE="${DOCKER_REGISTRY:+${DOCKER_REGISTRY}/}${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"
FRONTEND_FULL_IMAGE="${DOCKER_REGISTRY:+${DOCKER_REGISTRY}/}${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"
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
    DB_USER="$(docker inspect "$DB_FULL_IMAGE" \
        --format '{{ index .Config.Labels "type-any-language.db.user" }}' 2>/dev/null || echo "")"
    DB_NAME="$(docker inspect "$DB_FULL_IMAGE" \
        --format '{{ index .Config.Labels "type-any-language.db.name" }}' 2>/dev/null || echo "")"
    DB_VERSION="$(docker inspect "$DB_FULL_IMAGE" \
        --format '{{ index .Config.Labels "type-any-language.content.version" }}' 2>/dev/null || echo "")"
    DB_BAKED_AT="$(docker inspect "$DB_FULL_IMAGE" \
        --format '{{ index .Config.Labels "type-any-language.content.baked-at" }}' 2>/dev/null || echo "")"
    export DB_USER DB_NAME DB_VERSION DB_BAKED_AT
    [ -n "$DB_USER" ] && [ -n "$DB_NAME" ]
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
    info "DOCKER_REGISTRY=$DOCKER_REGISTRY — 拉取最新 dev images (db + backend + frontend)..."
    if ! $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" pull; then
        warn "部分 image 拉取失败 — 将使用本地已 build 的 image（如有）"
    fi
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
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" up -d
    ok "服务已启动（热重载已开启）"
    echo -e "  前端:   ${_LIB_BLUE}http://localhost:3000${_LIB_NC}"
    echo -e "  后端:   ${_LIB_BLUE}http://localhost:8000${_LIB_NC}"
    echo -e "  API文档: ${_LIB_BLUE}http://localhost:8000/docs${_LIB_NC}"
    echo "  db.user=$DB_USER  db.name=$DB_NAME  content.version=$DB_VERSION"
}

cmd_stop() {
    require_docker
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
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" logs -f "$@"
}

cmd_status() {
    require_docker
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps
}

usage() {
    cat <<EOF
用法: ./scripts/ops/dev-host/run.sh <command>

命令:
  doctor   跑完整环境检查（不修改任何东西，纯只读）
  start    启动开发容器（热重载）。如 DOCKER_REGISTRY 配了就 auto-pull (db + backend + frontend)
  stop     停止开发容器
  restart  重启容器并重新读取 secrets (≈5s, 不重 build image)
  reload   同 restart —— 别名，语义更清晰
  logs     跟踪日志 (Ctrl+C 退出)
  status   查看容器状态

典型工作流:
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