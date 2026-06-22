#!/usr/bin/env bash
#
# prod/run.sh — manage PRODUCTION container lifecycle.
#
# ─── What this is ─────────────────────────────────────────────────────────
# Runs **pre-compiled** prod images as-is:
#   • Images come from either:
#       - local builds via ./scripts/ops/prod-host/build_image.sh (backend + frontend), or
#       - the registry (the content-baked db image — start/restart auto-pulls
#         it when DOCKER_REGISTRY is set, no separate pull step needed).
#   • No bind-mounts. No hot-reload. Whatever's in the image at build time
#     is what runs.
#   • Frontend requests are routed through nginx on :80.
#
# ─── Database identity from image labels ─────────────────────────────────
# The db image is baked by ./scripts/ops/db/bake_image.sh with these labels:
#   type-any-language.db.user       (e.g. english_user)
#   type-any-language.db.name       (e.g. english_learning)
#   type-any-language.content.version
#   type-any-language.content.baked-at
# At start time, this script `docker inspect`s the image and exports
# DB_USER / DB_NAME for compose. The host-side POSTGRES_PASSWORD (in .env)
# is written to .secrets/postgres_password (chmod 600) and a derived
# .secrets/database_url is built and exposed via DATABASE_URL_FILE.
# Nothing in the .env file is repeated inside the db image — secrets flow
# through the host filesystem, not env vars.
#
# ─── What this isn't ──────────────────────────────────────────────────────
# Does NOT build images, does NOT edit .env, does NOT bake/push content.
#   • To build backend + frontend images: ./scripts/ops/prod-host/build_image.sh
#   • To bake content into db image:     ./scripts/ops/db/bake_image.sh
#   • To push baked image to registry:   ./scripts/ops/db/push_image.sh
#   • To init .env:                      ./scripts/ops/prod-host/env.sh
#   • To reload .env:                    ./scripts/ops/prod-host/run.sh restart
#
# ─── Usage ────────────────────────────────────────────────────────────────
#   ./scripts/ops/prod-host/run.sh doctor   # run pre-flight environment checks
#   ./scripts/ops/prod-host/run.sh start    # auto-pull (if DOCKER_REGISTRY) + docker compose up -d
#   ./scripts/ops/prod-host/run.sh stop     # docker compose down
#   ./scripts/ops/prod-host/run.sh restart  # auto-pull (if DOCKER_REGISTRY) + force-recreate
#   ./scripts/ops/prod-host/run.sh reload   # alias for restart
#   ./scripts/ops/prod-host/run.sh logs     # docker compose logs -f
#   ./scripts/ops/prod-host/run.sh status   # docker compose ps
#
# Quick reference — when to use what:
#   • Edit .env → ./scripts/ops/prod-host/run.sh restart (no rebuild, ≈5s).
#   • Edit code or Dockerfile → ./scripts/ops/prod-host/build_image.sh && restart.
#   • New content version baked on CMS host → just `restart`. If DOCKER_REGISTRY
#     is set, run.sh auto-pulls the latest baked db image before recreating.
#   • Edit nginx/nginx.conf → rebuild frontend image, then restart.
#
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"
source "$SCRIPT_DIR/../lib.sh"

# Load .env so POSTGRES_PASSWORD, SECRET_KEY, ALLOWED_ORIGINS resolve.
if [ -f .env ]; then
    set -a; . ./.env; set +a
fi

# DOCKER_REGISTRY may be set in .env or by an outer wrapper (CI). Default
# to "auto-pull off" (local-only mode) when unset.
DOCKER_REGISTRY="${DOCKER_REGISTRY:-}"
DB_IMAGE="${DB_IMAGE:-english_db_content}"
DB_IMAGE_TAG="${DB_IMAGE_TAG:-latest}"
DB_FULL_IMAGE="${DOCKER_REGISTRY:+${DOCKER_REGISTRY}/}${DB_IMAGE}:${DB_IMAGE_TAG}"

ENV_FILE=".env"
SECRETS_DIR=".secrets"
PG_PASSWORD_FILE="${SECRETS_DIR}/postgres_password"
DB_URL_FILE="${SECRETS_DIR}/database_url"
COMPOSE_FILE="docker-compose.yml"
BACKEND_IMAGE="english_backend"
FRONTEND_IMAGE="english_frontend"

# ---------------------------------------------------------------------------
# inspect_db_image_labels
#
# Reads the user / db-name / version / baked-at from the db image's
# labels and exports them as DB_USER / DB_NAME / DB_VERSION / DB_BAKED_AT
# for compose env substitution. Exits 1 if the image is missing or the
# labels are absent (the image was not built by bake_image.sh).
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
#   .secrets/postgres_password   (chmod 600) — sourced from .env's POSTGRES_PASSWORD
#   .secrets/database_url        (chmod 600) — assembled from POSTGRES_PASSWORD + DB_USER/DB_NAME
# ---------------------------------------------------------------------------
write_secrets() {
    if [ -z "${POSTGRES_PASSWORD:-}" ]; then
        err "POSTGRES_PASSWORD 未设置 — 在 .env 里跑 ./scripts/ops/prod-host/env.sh 重新生成"
        return 1
    fi
    if [ -z "${DB_USER:-}" ] || [ -z "${DB_NAME:-}" ]; then
        err "DB_USER / DB_NAME 未设置 — db image 的 label 缺失或不正确"
        return 1
    fi

    mkdir -p "$SECRETS_DIR"
    chmod 700 "$SECRETS_DIR"

    # postgres_password: no trailing newline (postgres reads it strictly).
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
# gate_preflight — hard checks used by start / restart before doing work.
# ---------------------------------------------------------------------------
gate_preflight() {
    require_docker
    require_file "$ENV_FILE" "运行 ./scripts/ops/prod-host/env.sh"
    if ! image_exists "$BACKEND_IMAGE"; then
        err "image $BACKEND_IMAGE 未构建"
        info "  → 运行 ./scripts/ops/prod-host/build_image.sh"
        exit 1
    fi
    if ! image_exists "$FRONTEND_IMAGE"; then
        err "image $FRONTEND_IMAGE 未构建"
        info "  → 运行 ./scripts/ops/prod-host/build_image.sh"
        exit 1
    fi
    if ! image_exists "$DB_FULL_IMAGE"; then
        err "db image $DB_FULL_IMAGE 未构建或未拉取"
        if [ -n "$DOCKER_REGISTRY" ]; then
            info "  → 设置 DB_IMAGE_TAG 后由 run.sh 拉取，或: docker pull $DB_FULL_IMAGE"
        else
            info "  → 运行 ./scripts/ops/db/bake_image.sh（可用 --tag v1.0.0 标记）"
        fi
        exit 1
    fi
    warn_port_in_use 80  "nginx 端口 (宿主机 80)"
    warn_port_in_use 5432 "postgres 端口 (宿主机 5432)"
}

# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------

cmd_doctor() {
    local failed=0
    echo "=== Production environment check ==="
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

    if file_exists "$ENV_FILE"; then
        ok "$ENV_FILE 存在"
    else
        err "$ENV_FILE 缺失 → 运行 ./scripts/ops/prod-host/env.sh"; failed=1
    fi

    if check_docker_installed && check_docker_daemon_running; then
        if image_exists "$BACKEND_IMAGE"; then
            ok "image $BACKEND_IMAGE 存在"
        else
            warn "image $BACKEND_IMAGE 缺失 → 运行 ./scripts/ops/prod-host/build_image.sh"
        fi
        if image_exists "$FRONTEND_IMAGE"; then
            ok "image $FRONTEND_IMAGE 存在"
        else
            warn "image $FRONTEND_IMAGE 缺失 → 运行 ./scripts/ops/prod-host/build_image.sh"
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
            warn "db image $DB_FULL_IMAGE 缺失 → ./scripts/ops/prod-host/run.sh restart"
        else
            warn "db image $DB_FULL_IMAGE 缺失 → ./scripts/ops/db/bake_image.sh"
        fi
    fi

    warn_port_in_use 80  "nginx 端口 (宿主机 80)"
    warn_port_in_use 5432 "postgres 端口 (宿主机 5432)"

    if [ -z "$DOCKER_REGISTRY" ]; then
        warn "DOCKER_REGISTRY 未设置（auto-pull 会跳过；本地镜像必须已经构建）"
    else
        ok "DOCKER_REGISTRY=$DOCKER_REGISTRY"
    fi

    echo ""
    if [ $failed -eq 0 ]; then
        ok "所有必需检查通过"
        return 0
    else
        err "部分必需检查未通过"
        return 1
    fi
}

# Auto-pull the content-baked db image when DOCKER_REGISTRY is set.
auto_pull_from_registry() {
    if [ -z "$DOCKER_REGISTRY" ]; then
        return 0
    fi
    info "DOCKER_REGISTRY=$DOCKER_REGISTRY — 拉取最新 baked db image..."
    if ! $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" pull db; then
        err "pull 失败 — 检查 DOCKER_REGISTRY / 网络 / 凭据"
        exit 1
    fi
}

cmd_start() {
    gate_preflight
    if ! inspect_db_image_labels; then
        err "db image 缺少 type-any-language.* labels — 用 ./scripts/ops/db/bake_image.sh 重新烘焙"
        exit 1
    fi
    write_secrets
    auto_pull_from_registry
    info "启动生产容器..."
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" up -d
    ok "服务已启动"
    echo -e "  前端:   ${_LIB_BLUE}http://localhost${_LIB_NC}"
    echo -e "  API:    ${_LIB_BLUE}http://localhost/api/docs${_LIB_NC}"
    echo "  db.user=$DB_USER  db.name=$DB_NAME  content.version=$DB_VERSION"
}

cmd_stop() {
    require_docker
    info "停止生产容器..."
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" down
    ok "服务已停止"
}

# Hard restart: recreate containers so the fresh .env + secrets + (any new
# image) are loaded. `docker compose restart` alone is NOT enough because
# Docker does not re-read environment variables on a soft restart.
cmd_restart() {
    gate_preflight
    if ! inspect_db_image_labels; then
        err "db image 缺少 type-any-language.* labels — 用 ./scripts/ops/db/bake_image.sh 重新烘焙"
        exit 1
    fi
    write_secrets
    auto_pull_from_registry
    info "重启容器（重新加载 $ENV_FILE + secrets）..."

    BACKEND_BEFORE=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "$BACKEND_IMAGE" 2>/dev/null || true)
    FRONTEND_BEFORE=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "$FRONTEND_IMAGE" 2>/dev/null || true)

    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" up -d --no-deps --force-recreate backend frontend

    BACKEND_AFTER=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "$BACKEND_IMAGE" 2>/dev/null || true)
    FRONTEND_AFTER=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "$FRONTEND_IMAGE" 2>/dev/null || true)

    if [ -n "$BACKEND_BEFORE" ] && [ "$BACKEND_BEFORE" != "$BACKEND_AFTER" ]; then
        warn "$BACKEND_IMAGE image ID 变化了 — 你是改了 Dockerfile？"
        warn "  这种情况请用 ./scripts/ops/prod-host/build_image.sh 重 build 后再 restart"
    fi
    if [ -n "$FRONTEND_BEFORE" ] && [ "$FRONTEND_BEFORE" != "$FRONTEND_AFTER" ]; then
        warn "$FRONTEND_IMAGE image ID 变化了 — 你是改了 Dockerfile？"
        warn "  这种情况请用 ./scripts/ops/prod-host/build_image.sh 重 build 后再 restart"
    fi

    ok "服务已重启（$ENV_FILE + secrets 已重读）"
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
用法: ./scripts/ops/prod-host/run.sh <command>

命令:
  doctor   跑完整环境检查（不修改任何东西，纯只读）
  start    启动生产容器 (docker compose up -d). 如果 DOCKER_REGISTRY 配了就先 pull baked db image
  stop     停止生产容器 (docker compose down)
  restart  重启容器并重新读取 $ENV_FILE + secrets (≈5s, 不重 build image)
  reload   同 restart —— 别名，语义更清晰
  logs     跟踪日志 (Ctrl+C 退出)
  status   查看容器状态

典型工作流:
  ./scripts/ops/prod-host/run.sh doctor        # 跑一遍检查，看环境是否就绪
  ./scripts/ops/prod-host/run.sh start         # 启动 (DOCKER_REGISTRY 配了会先 pull)
  ./scripts/ops/prod-host/run.sh restart       # 改 $ENV_FILE 后用这个，5 秒生效
  ./scripts/ops/prod-host/build_image.sh && \\
    ./scripts/ops/prod-host/run.sh restart     # 改代码 / Dockerfile 后
  ./scripts/ops/prod-host/run.sh logs backend  # 跟踪 backend 日志
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
