#!/usr/bin/env bash
#
# ops/cvm/bootstrap.sh — host-level preparation for the prod CVM.
#
# One-time idempotent setup. Does NOT build images (CI does that) — only
# makes the host ready to RUN pulled images. Safe to re-run on an
# already-prepared host (each step short-circuits on existing state).
#
# Steps (in order):
#   1. preflight       docker / compose / port 80 ready
#   2. secrets         .secrets/db_password (chmod 600) if missing
#   3. data_dir        /var/lib/type-any-language/postgres (UID 999) if missing
#   4. nginx_site      install ops/cvm/nginx/site.conf via nginx/install.sh
#   5. deploy          (separate script) probe registry + pull + lifecycle
#
# Step 5 lives in ops/cvm/deploy-if-published.sh — it's 3 sub-concerns
# (probe / pull / lifecycle+doctor) and is also runnable standalone.

set -euo pipefail

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$COMMON_DIR/../.." && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
setup_prod_host_env

# ─── Globals ─────────────────────────────────────────────────────────────
DB_PASSWORD_FILE="${SECRETS_DIR}/db_password"
DB_DATA_DIR="/var/lib/type-any-language/postgres"
# Postgres alpine image runs as UID 999 (postgres user). Bind-mount target
# must be owned by the same UID, otherwise container startup fails EACCES.
POSTGRES_UID=999

# ─── step_preflight ──────────────────────────────────────────────────────
# Verifies docker / compose / port 80 are ready. Exits 1 on any failure.
step_preflight() {
    info "=== preflight ==="
    local failed=0

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

    warn_port_in_use 80 "nginx 端口 (宿主机 80)"

    if [ "$failed" -ne 0 ]; then
        err "preflight 失败 — 修好后重跑"
        return 1
    fi
    ok "preflight OK"
}

# ─── step_secrets ────────────────────────────────────────────────────────
# Generate .secrets/db_password if it doesn't exist. Idempotent — if the
# file already exists, we don't touch it (preserves the running prod
# db's credentials on a re-run).
step_secrets() {
    info "=== secrets ==="
    mkdir -p "$PROJECT_DIR/.secrets"
    chmod 700 "$PROJECT_DIR/.secrets"

    if [ -f "$PROJECT_DIR/$DB_PASSWORD_FILE" ]; then
        ok ".secrets/db_password 已存在 — 跳过生成"
        chmod 600 "$PROJECT_DIR/$DB_PASSWORD_FILE"
        return 0
    fi

    info "生成 .secrets/db_password (48 字符 URL-safe)..."
    gen_secret 48 > "$PROJECT_DIR/$DB_PASSWORD_FILE"
    chmod 600 "$PROJECT_DIR/$DB_PASSWORD_FILE"
    ok ".secrets/db_password 已写入 (chmod 600)"
    info "  ⚠️  这个文件不可 commit (.gitignore 已含 .secrets/)"
    info "  ⚠️  改这个密码会让现有 db 数据无法读 — 仅限首次部署"
}

# ─── step_data_dir ───────────────────────────────────────────────────────
# Create /var/lib/type-any-language/postgres if missing. Chown to UID 999
# so the postgres alpine container can read/write it. Uses the
# sudo_run_or_manual helper from _common.sh for non-interactive sudo.
step_data_dir() {
    info "=== 数据目录 ==="

    if [ -d "$DB_DATA_DIR" ]; then
        ok "$DB_DATA_DIR 已存在"
        # Heal wrong ownership on re-run.
        local current_owner
        current_owner="$(stat -c '%u' "$DB_DATA_DIR" 2>/dev/null || echo "?")"
        if [ "$current_owner" = "$POSTGRES_UID" ]; then
            return 0
        fi
        warn "  当前属主 UID=$current_owner,期望 UID=$POSTGRES_UID — 修正中"
        sudo_run_or_manual chown "$POSTGRES_UID:$POSTGRES_UID" "$DB_DATA_DIR" \
            || return 1
        ok "  chown 修正完成"
        return 0
    fi

    info "创建 $DB_DATA_DIR (UID=$POSTGRES_UID,postgres alpine 用户)..."
    sudo_run_or_manual mkdir -p "$DB_DATA_DIR" \
        || return 1
    sudo -n chmod 700 "$DB_DATA_DIR" 2>/dev/null || true
    sudo_run_or_manual chown "$POSTGRES_UID:$POSTGRES_UID" "$DB_DATA_DIR" \
        || return 1
    ok "$DB_DATA_DIR 就绪"
}

# ─── step_nginx_site_link ─────────────────────────────────────────────
# Delegate to ops/cvm/nginx/install.sh so the implementation is testable
# in isolation and re-runnable outside of bootstrap.sh (e.g. after the
# operator hand-edits /etc/nginx/sites-available).
step_nginx_site_link() {
    bash "$PROJECT_DIR/ops/cvm/nginx/install.sh"
}

# ─── cmd_prepare ─────────────────────────────────────────────────────────
cmd_prepare() {
    info "=== prod host prepare (idempotent) ==="
    echo ""
    info "  主机层准备:不起容器、不 build image。"
    info "  build image 走 CI(release/build.yml),"
    info "  起容器走 ./ops/cvm/deploy-if-published.sh(本脚本末步) 或 lifecycle.sh start。"
    echo ""

    step_preflight        || return 1
    echo ""
    step_secrets          || return 1
    echo ""
    step_data_dir         || return 1
    echo ""
    step_nginx_site_link  || return 1
    echo ""

    # Deploy latest + run IF a published image exists (guarded inside).
    bash "$PROJECT_DIR/ops/cvm/deploy-if-published.sh"
    echo ""

    ok "=== prepare 完成 ==="
    info "  主机层已就绪。若 deploy 步骤已拉起容器,访问:"
    info "    前端: http://localhost  (经 nginx :80)"
    info "    API:  http://localhost/api/docs"
    info "  若 deploy 被跳过(无已发布镜像 / BOOTSTRAP_SKIP_DEPLOY=1):"
    info "    ./ops/cvm/lifecycle.sh start   (或 make prod-start)"
}

usage() {
    cat <<EOF
用法: $0 [command]

命令:
  (default) | setup | bootstrap | prepare
      主机层准备(preflight + secrets + data dir + nginx site)。
      准备完成后尝试部署并启动最新镜像(可跳)。

  -h | --help | help
      显示本帮助。

部署行为(默认开启,条件触发):
  准备完成后,若 GHCR 上存在已发布的镜像(默认 :latest tag,或 IMAGE_TAG
  指定的版本),bootstrap 会拉取并启动整套服务。
  - 无已发布镜像 / 未登录 GHCR / 离线 → 跳过部署,只做主机层准备并打印指引。
  - BOOTSTRAP_SKIP_DEPLOY=1 → 强制跳过部署,仅做主机层准备。
  - IMAGE_TAG=vX.Y.Z → 部署该固定版本而非最新的 :latest。

前置依赖: docker, compose, python3, git, openssl, sudo

首次流程 / 日常流程 / 与 publish-prod workflow 的对接见 AGENTS.md。
EOF
}

case "${1:-}" in
    ""|setup|bootstrap|prepare)   cmd_prepare ;;
    -h|--help|help)               usage ;;
    *)                            { err "未知命令: $1"; usage; } >&2; exit 1 ;;
esac
