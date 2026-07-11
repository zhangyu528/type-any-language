#!/usr/bin/env bash
#
# prod-host/run.sh — manage PRODUCTION container lifecycle.
#
# ─── What this is ─────────────────────────────────────────────────────────
# Runs **pre-compiled** prod images as-is:
#   • Images come from either:
#       - local builds via ./scripts/ops/prod-host/build_image.sh (backend + frontend), or
#       - the registry (the content-baked content-baked db image — start/restart auto-pulls
#         it when DOCKER_REGISTRY is set, no separate pull step needed).
#   • No bind-mounts. No hot-reload. Whatever's in the image at build time
#     is what runs.
#   • Frontend requests are routed through nginx on :80.
#
# ─── Database identity from image labels ─────────────────────────────────
# The content-baked db image is baked by ./scripts/ops/cms/bake_image.sh with these labels:
#   type-any-language.db.user       (e.g. english_user)
#   type-any-language.db.name       (e.g. english_learning)
#   type-any-language.content.version
#   type-any-language.content.baked-at
# At start time, this script `docker inspect`s the image and exports
# DB_USER / DB_NAME for compose. POSTGRES_PASSWORD is generated on first
# start (or reused if .secrets/postgres_password already exists) and
# materialised to .secrets/postgres_password + .secrets/database_url,
# both chmod 600. ALLOWED_ORIGINS is read from the shell env, falling back
# to the compose-level default (http://localhost).
#
# ─── What this isn't ──────────────────────────────────────────────────────
# Does NOT build images, does NOT manage secrets, does NOT bake/push content.
#   • To build backend + frontend images: ./scripts/ops/prod-host/build_image.sh
#   • To bake content into db image:     ./scripts/ops/cms/bake_image.sh
#   • To push baked image to registry:   ./scripts/ops/cms/push_image.sh
#   • To change ALLOWED_ORIGINS:         export ALLOWED_ORIGINS=... before start,
#                                         or edit the default in docker-compose.yml.
#
# ─── Usage ────────────────────────────────────────────────────────────────
#   ./scripts/ops/prod-host/run.sh setup    # first-time: 拉 content-baked db image + build prod apps
#   ./scripts/ops/prod-host/run.sh doctor   # run pre-flight environment checks
#   ./scripts/ops/prod-host/run.sh start    # auto-pull (if DOCKER_REGISTRY) + docker compose up -d
#   ./scripts/ops/prod-host/run.sh stop     # docker compose down
#   ./scripts/ops/prod-host/run.sh restart  # auto-pull (if DOCKER_REGISTRY) + force-recreate
#   ./scripts/ops/prod-host/run.sh reload   # alias for restart
#   ./scripts/ops/prod-host/run.sh logs     # docker compose logs -f
#   ./scripts/ops/prod-host/run.sh status   # docker compose ps
#
# Quick reference — when to use what:
#   • Edit code or Dockerfile → ./scripts/ops/prod-host/build_image.sh && restart.
#   • New content version baked on CMS host → just `restart`. If DOCKER_REGISTRY
#     is set, run.sh auto-pulls the latest baked content-baked db image before recreating.
#   • Edit nginx/nginx.conf → rebuild frontend image, then restart.
#   • Edit docker-compose.yml (e.g. ALLOWED_ORIGINS default) → restart.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$PROJECT_DIR"
source "$SCRIPT_DIR/../../lib.sh"

# DOCKER_REGISTRY: shell env > ./REGISTRY file > detect_default_registry().
# Empty (after the chain) means "local-only mode" — auto-pull from registry
# is disabled, but the prod compose still works (it uses the local image).
# Note: on prod, auto-pull ONLY pulls the content-baked db image (per design — backend
# and frontend are built locally on the prod host, not pulled from registry).
resolve_docker_registry
if [ -n "$DOCKER_REGISTRY" ]; then
    if [ "${_DOCKER_REGISTRY_SOURCE:-}" = "detect" ]; then
        info "DOCKER_REGISTRY=$DOCKER_REGISTRY (auto-detected, auto-pull off — 本地模式)"
    else
        info "DOCKER_REGISTRY=$DOCKER_REGISTRY (auto-pull on for db image)"
    fi
else
    info "DOCKER_REGISTRY 未设置 (auto-pull off, local-only mode)"
fi
DB_IMAGE="${DB_IMAGE:-english_db_content}"
# All three *_IMAGE_TAG resolve from VERSION.prod (this is the prod host).
# Shell env still overrides. Exported for compose interpolation.
resolve_image_tag DB_IMAGE_TAG       VERSION.prod
resolve_image_tag BACKEND_IMAGE_TAG  VERSION.prod
resolve_image_tag FRONTEND_IMAGE_TAG VERSION.prod
warn_if_version_default "$BACKEND_IMAGE_TAG" VERSION.prod

# Image full references. Same registry-prefix guard as dev-host: only
# prepend when DOCKER_REGISTRY was explicitly configured (shell env or
# REGISTRY file). Auto-detected registries are guesses — locally-built
# images have no prefix, so we'd otherwise look for an image that
# doesn't exist and confuse compose / pull.
if [ "${_DOCKER_REGISTRY_SOURCE:-}" = "shell" ] || [ "${_DOCKER_REGISTRY_SOURCE:-}" = "file" ]; then
    DB_FULL_IMAGE="${DOCKER_REGISTRY}/${DB_IMAGE}:${DB_IMAGE_TAG}"
    BACKEND_FULL_IMAGE="${DOCKER_REGISTRY}/${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"
    FRONTEND_FULL_IMAGE="${DOCKER_REGISTRY}/${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"
else
    DB_FULL_IMAGE="${DB_IMAGE}:${DB_IMAGE_TAG}"
    BACKEND_FULL_IMAGE="${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"
    FRONTEND_FULL_IMAGE="${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"
    # Force compose's image: line interpolation to bare local names too.
    export DOCKER_REGISTRY=""
fi
export BACKEND_FULL_IMAGE FRONTEND_FULL_IMAGE

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
    DB_USER="$(image_label "$DB_FULL_IMAGE" "type-any-language.db.user" || echo "")"
    DB_NAME="$(image_label "$DB_FULL_IMAGE" "type-any-language.db.name" || echo "")"
    DB_VERSION="$(image_label "$DB_FULL_IMAGE" "type-any-language.content.version" || echo "")"
    DB_BAKED_AT="$(image_label "$DB_FULL_IMAGE" "type-any-language.content.baked-at" || echo "")"
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
# restarts so the db volume's password stays stable. To reset the prod
# db, delete the file (and the db-data volume).
# ---------------------------------------------------------------------------
write_secrets() {
    if [ -z "${DB_USER:-}" ] || [ -z "${DB_NAME:-}" ]; then
        err "DB_USER / DB_NAME 未设置 — content-baked db image 的 label 缺失或不正确"
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
# gate_preflight — hard checks used by start / restart before doing work.
# ---------------------------------------------------------------------------
gate_preflight() {
    require_docker
    if ! image_exists "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"; then
        err "image ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 未构建"
        info "  → 运行 ./scripts/ops/prod-host/build_image.sh"
        exit 1
    fi
    if ! image_exists "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"; then
        err "image ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 未构建"
        info "  → 运行 ./scripts/ops/prod-host/build_image.sh"
        exit 1
    fi
    if ! image_exists "$DB_FULL_IMAGE"; then
        err "content-baked db image $DB_FULL_IMAGE 未构建或未拉取"
        if [ -n "$DOCKER_REGISTRY" ]; then
            info "  → 设置 DB_IMAGE_TAG 后由 run.sh 拉取，或: docker pull $DB_FULL_IMAGE"
        else
            info "  → 运行 ./scripts/ops/cms/bake_image.sh（可用 --tag v1.0.0 标记）"
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

    if [ -f "$PG_PASSWORD_FILE" ]; then
        ok ".secrets/postgres_password 存在（密码稳定，db 不会重置）"
    else
        info ".secrets/postgres_password 缺失 — 下次 start 会现场生成"
    fi

    if check_docker_installed && check_docker_daemon_running; then
        if image_exists "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"; then
            ok "image ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 存在"
        else
            warn "image ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 缺失 → 运行 ./scripts/ops/prod-host/build_image.sh"
        fi
        if image_exists "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"; then
            ok "image ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 存在"
        else
            warn "image ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 缺失 → 运行 ./scripts/ops/prod-host/build_image.sh"
        fi
        if image_exists "$DB_FULL_IMAGE"; then
            ok "content-baked db image $DB_FULL_IMAGE 存在"
            if inspect_db_image_labels; then
                ok "  db.user = $DB_USER"
                ok "  db.name = $DB_NAME"
                ok "  content.version = $DB_VERSION"
                ok "  content.baked-at = $DB_BAKED_AT"
            else
                warn "  content-baked db image 缺少 type-any-language.* labels — 重新 bake？"
            fi
        elif [ -n "$DOCKER_REGISTRY" ]; then
            warn "content-baked db image $DB_FULL_IMAGE 缺失 → ./scripts/ops/prod-host/run.sh restart"
        else
            warn "content-baked db image $DB_FULL_IMAGE 缺失 → ./scripts/ops/cms/bake_image.sh"
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

# Auto-pull the content-baked content-baked db image when DOCKER_REGISTRY is set.
# (Backend/frontend are NOT pulled here: the prod host builds them
# locally via prod-host/build_image.sh. Only the content-baked db
# image is registry-distributed.)
auto_pull_from_registry() {
    if [ -z "$DOCKER_REGISTRY" ]; then
        return 0
    fi
    # Same guard as dev-host: an auto-detected registry (docker.io/$USER)
    # is a guess, not operator intent. Prod's pull is a hard fail, so the
    # guard prevents an unconfigured prod host from 429-ing on a guess.
    if [ "${_DOCKER_REGISTRY_SOURCE:-}" = "detect" ]; then
        info "DOCKER_REGISTRY=$DOCKER_REGISTRY (auto-detected — 跳过 auto-pull)"
        return 0
    fi
    info "DOCKER_REGISTRY=$DOCKER_REGISTRY — 拉取最新 baked db image..."
    if ! $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" pull db; then
        err "pull 失败 — 检查 DOCKER_REGISTRY / 网络 / 凭据"
        exit 1
    fi
}

# ---------------------------------------------------------------------------
# cmd_setup — first-time (or post-reset) environment bootstrap.
#
# Walks the operator through the image dependency chain so a fresh prod
# host is one command away from `./scripts/ops/prod-host/run.sh start`:
#
#   1. Preflight: docker + compose must be present.
#   2. db image: must be locally present (prod build_image.sh reads
#      DB_USER / DB_NAME from its OCI labels). The prod host NEVER bakes
#      db content itself — it only pulls from a registry or expects a
#      pre-loaded image:
#        - DOCKER_REGISTRY set → docker pull
#        - otherwise → "go bake it on the CMS host, then come back"
#   3. prod app images: call ./scripts/ops/prod-host/build_image.sh.
#      Skipped if both already present.
#   4. Final summary.
#
# This command does NOT create .secrets/, start any containers, or push
# to a registry. Re-run as many times as you want — nothing destructive.
# ---------------------------------------------------------------------------
cmd_setup() {
    info "=== prod environment setup ==="
    echo ""

    # 1. Preflight — same checks as the rest of run.sh.
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

    # 2. content-baked db image — pull-only on prod host.
    info "Step 1/2: content-baked db image ($DB_FULL_IMAGE)"
    if ! image_exists "$DB_FULL_IMAGE"; then
        warn "content-baked db image 不在本地"
        if [ -n "$DOCKER_REGISTRY" ]; then
            info "  DOCKER_REGISTRY 已设,尝试 docker pull..."
            echo ""
            if docker pull "$DB_FULL_IMAGE"; then
                echo ""
                ok "  pull 成功"
            else
                err "  pull 失败 — 检查 registry / 网络 / 凭据"
                err "  或: 在 CMS 主机上先 push: ./scripts/ops/cms/push_image.sh -y"
                return 1
            fi
        else
            info "  prod 主机不 bake content,content-baked db image 必须从 CMS 主机过来:"
            info "    1. CMS 主机: ./scripts/ops/cms/bake_image.sh"
            info "    2. CMS 主机: ./scripts/ops/cms/push_image.sh -y     # 推 registry"
            info "    3. 本机配置 REGISTRY / DOCKER_REGISTRY,再跑一次 ./scripts/ops/prod-host/run.sh setup"
            info "  (或: 手动 docker load/tar 把 content-baked db image 搬过来)"
            err "content-baked db image 缺失 — 完成上面的步骤后,再跑一次 setup"
            return 1
        fi
    fi
    if inspect_db_image_labels; then
        ok "  db.user=$DB_USER  db.name=$DB_NAME  content.version=$DB_VERSION"
    else
        warn "  content-baked db image 缺 type-any-language.* label — 重新 bake"
        return 1
    fi
    echo ""

    # 3. prod app images.
    info "Step 2/2: prod app images"
    if image_exists "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" && \
       image_exists "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"; then
        ok "  ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 已存在"
        ok "  ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 已存在"
        info "  (要 rebuild? 跑: ./scripts/ops/prod-host/build_image.sh)"
    else
        info "  调 ./scripts/ops/prod-host/build_image.sh..."
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
    info "  下一步: ./scripts/ops/prod-host/run.sh start"
    info "  启动后访问:"
    info "    前端: http://localhost  (经 nginx :80)"
    info "    API:  http://localhost/api/docs"
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
        err "content-baked db image 缺少 type-any-language.* labels — 用 ./scripts/ops/cms/bake_image.sh 重新烘焙"
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

# Hard restart: recreate containers so fresh secrets + (any new image) are
# loaded. `docker compose restart` alone is NOT enough because Docker does
# not re-read environment variables on a soft restart.
cmd_restart() {
    gate_preflight
    if ! inspect_db_image_labels; then
        err "content-baked db image 缺少 type-any-language.* labels — 用 ./scripts/ops/cms/bake_image.sh 重新烘焙"
        exit 1
    fi
    write_secrets
    auto_pull_from_registry
    info "重启容器（重新加载 secrets）..."

    BACKEND_BEFORE=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" 2>/dev/null || true)
    FRONTEND_BEFORE=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}" 2>/dev/null || true)

    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" up -d --no-deps --force-recreate backend frontend

    BACKEND_AFTER=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" 2>/dev/null || true)
    FRONTEND_AFTER=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}" 2>/dev/null || true)

    if [ -n "$BACKEND_BEFORE" ] && [ "$BACKEND_BEFORE" != "$BACKEND_AFTER" ]; then
        warn "$BACKEND_IMAGE image ID 变化了 — 你是改了 Dockerfile？"
        warn "  这种情况请用 ./scripts/ops/prod-host/build_image.sh 重 build 后再 restart"
    fi
    if [ -n "$FRONTEND_BEFORE" ] && [ "$FRONTEND_BEFORE" != "$FRONTEND_AFTER" ]; then
        warn "$FRONTEND_IMAGE image ID 变化了 — 你是改了 Dockerfile？"
        warn "  这种情况请用 ./scripts/ops/prod-host/build_image.sh 重 build 后再 restart"
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
用法: ./scripts/ops/prod-host/run.sh <command>

命令:
  setup    首次环境引导: 拉 db image,build 缺失的 prod app images,无 start 副作用
  doctor   跑完整环境检查（不修改任何东西，纯只读）
  start    启动生产容器 (docker compose up -d). 如果 DOCKER_REGISTRY 配了就先 pull baked content-baked db image
  stop     停止生产容器 (docker compose down)
  restart  重启容器并重新读取 secrets (≈5s, 不重 build image)
  reload   同 restart —— 别名，语义更清晰
  logs     跟踪日志 (Ctrl+C 退出)
  status   查看容器状态

典型工作流:
  ./scripts/ops/prod-host/run.sh setup         # 首次或重置后: 一次性就位所有 image
  ./scripts/ops/prod-host/run.sh doctor        # 跑一遍检查，看环境是否就绪
  ./scripts/ops/prod-host/run.sh start         # 启动 (DOCKER_REGISTRY 配了会先 pull)
  ./scripts/ops/prod-host/run.sh restart       # 改 docker-compose.yml / .secrets 后用这个，5 秒生效
  ./scripts/ops/prod-host/build_image.sh && \\
    ./scripts/ops/prod-host/run.sh restart     # 改代码 / Dockerfile 后
  ./scripts/ops/prod-host/run.sh logs backend  # 跟踪 backend 日志

环境覆盖:
  ALLOWED_ORIGINS=https://my.domain ./scripts/ops/prod-host/run.sh start
  DOCKER_REGISTRY=ghcr.io/me \
    DB_IMAGE_TAG=v1.2 BACKEND_IMAGE_TAG=v1.2 FRONTEND_IMAGE_TAG=v1.2 \
    ./scripts/ops/prod-host/run.sh start
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