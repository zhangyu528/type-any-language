#!/usr/bin/env bash
#
# ops/prod/prepare.sh — host-level preparation for the prod TARGET host.
#
# This script is **only** for the runtime/serve side of the deploy —
# i.e. the CVM that will run the prod containers. It does NOT build
# images. Image construction is the BUILD side's job (release.sh prod,
# build_image.sh on a build host / CI runner).
#
# Why the split:
#   The build env (release machine / CI) and the run env (prod CVM)
#   are conceptually different — build needs source code + docker build
#   daemon; run needs /var/lib bind-mounts + secrets + registry access
#   to pull images. Conflating them means the run env "helpfully"
#   builds local images that drift from the registry, or the build env
#   creates /var/lib dirs it will never use. This script enforces the
#   run-side contract only.
#
# Idempotent: safe to re-run on an already-prepared host. Each step
# checks current state and only acts when something is missing.
#
# What this script does:
#   1. Preflight — docker installed, daemon up, compose available,
#      port 80 not bound by another process.
#   2. gh CLI — verify installed + authed. Required for fetching
#      DOCKER_REGISTRY from the GitHub Variable (see ops/lib.sh::
#      resolve_docker_registry's tier-2 source). This step only
#      VERIFIES + gives instructions; gh auth login is interactive
#      (requires GitHub account + 2FA) so it can't be auto-done.
#   3. Secrets — generate .secrets/db_password (chmod 600) if missing.
#      The password is consumed by docker-compose.yml's `secrets:`
#      block and POSTGRES_PASSWORD_FILE in the db service.
#   4. Data dir — create /var/lib/type-any-language/postgres owned by
#      UID 999 (postgres alpine user) if missing. Without this, the
#      bind-mounted db container fails on first boot with EACCES.
#
# What this script does NOT do (and why):
#   - Build images — that's ./ops/prod/build/image.sh, called on the
#     BUILD side. On the run side, compose auto-pulls from
#     $DOCKER_REGISTRY when images are missing locally.
#   - Start any containers — use ./ops/prod/deploy.sh for first-time
#     runtime bring-up, ./ops/prod/lifecycle.sh for daily operations.
#   - Apply schema migrations — bootstrap.sh does that.
#   - Import CMS content — bootstrap.sh does that (and
#     scripts/fetch_cms_content.sh if it needs to pull staging files).
#   - Edit REGISTRY — set DOCKER_REGISTRY env or edit REGISTRY file
#     before running this script.
#   - Provision TLS / DNS / firewall (host-level, run before this).
#
# Typical first-time flow on the prod CVM:
#   ./ops/prod/prepare.sh        # host prep (this script — idempotent)
#   ./ops/prod/deploy.sh      # first-time runtime bring-up
#
# Daily flow (after both prepare.sh and bootstrap.sh have been run once):
#   ./ops/prod/lifecycle.sh start|stop|restart
#
# Subcommands:
#   (default) | setup    Idempotent host-level preparation.
#   -h | --help | help   Show usage.

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$COMMON_DIR/../.." && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
setup_prod_host_env

# ─── Globals ─────────────────────────────────────────────────────────────
DB_PASSWORD_FILE="${SECRETS_DIR}/db_password"
DB_DATA_DIR="/var/lib/type-any-language/postgres"
# Postgres alpine image runs as UID 999 (postgres user). Bind-mount
# target must be owned by the same UID, otherwise container startup
# fails with permission denied on the data directory.
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

# (Note: step_gh_cli was removed in 2026-08-04.
#  DOCKER_REGISTRY is now injected by the deploy workflow via SSH env — CVM
#  no longer needs or uses gh CLI. See ops/lib.sh::resolve_docker_registry
#  for the simplified env-var-only path.)

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

    info "生成 .secrets/db_password (64 字符随机 hex)..."
    gen_secret 48 > "$PROJECT_DIR/$DB_PASSWORD_FILE"
    chmod 600 "$PROJECT_DIR/$DB_PASSWORD_FILE"
    ok ".secrets/db_password 已写入 (chmod 600)"
    info "  ⚠️  这个文件不可 commit (.gitignore 已含 .secrets/)"
    info "  ⚠️  改这个密码会让现有 db 数据无法读 — 仅限首次部署"
}

# ─── step_data_dir ───────────────────────────────────────────────────────
# Create /var/lib/type-any-language/postgres if missing. Chown to UID 999
# so the postgres alpine container can read/write it.
#
# Uses sudo -n (non-interactive). Fails fast with a clear hint if the
# current user can't escalate without a password (typical for the
# initial deploy user before sudoers is configured).
step_data_dir() {
    info "=== 数据目录 ==="

    if [ -d "$DB_DATA_DIR" ]; then
        ok "$DB_DATA_DIR 已存在"
        # Verify ownership — re-running prepare on a host whose data
        # dir was somehow re-created with wrong perms should still heal.
        local current_owner
        current_owner="$(stat -c '%u' "$DB_DATA_DIR" 2>/dev/null || echo "?")"
        if [ "$current_owner" != "$POSTGRES_UID" ]; then
            warn "  当前属主 UID=$current_owner,期望 UID=$POSTGRES_UID — 修正中"
            if command -v sudo >/dev/null 2>&1; then
                sudo -n chown "$POSTGRES_UID:$POSTGRES_UID" "$DB_DATA_DIR" || \
                    { err "  sudo 失败 — 自己跑: sudo chown $POSTGRES_UID:$POSTGRES_UID $DB_DATA_DIR"; return 1; }
                ok "  chown 修正完成"
            else
                err "  sudo 不存在 — 自己跑: chown $POSTGRES_UID:$POSTGRES_UID $DB_DATA_DIR"
                return 1
            fi
        fi
        return 0
    fi

    info "创建 $DB_DATA_DIR (UID=$POSTGRES_UID,postgres alpine 用户)..."
    if command -v sudo >/dev/null 2>&1; then
        if ! sudo -n mkdir -p "$DB_DATA_DIR"; then
            err "  sudo mkdir 失败 — 自己跑:"
            err "    sudo mkdir -p $DB_DATA_DIR"
            err "    sudo chown $POSTGRES_UID:$POSTGRES_UID $DB_DATA_DIR"
            return 1
        fi
        sudo -n chmod 700 "$DB_DATA_DIR" || true
        sudo -n chown "$POSTGRES_UID:$POSTGRES_UID" "$DB_DATA_DIR" || \
            { err "  chown 失败 — 自己跑: sudo chown $POSTGRES_UID:$POSTGRES_UID $DB_DATA_DIR"; return 1; }
    else
        err "  sudo 不存在 — 自己跑:"
        err "    mkdir -p $DB_DATA_DIR"
        err "    chown $POSTGRES_UID:$POSTGRES_UID $DB_DATA_DIR"
        return 1
    fi
    ok "$DB_DATA_DIR 就绪"
}

# ─── cmd_prepare ─────────────────────────────────────────────────────────
cmd_prepare() {
    info "=== prod host prepare (idempotent, run env only) ==="
    echo ""
    info "  ⚠️  这个脚本只做主机层准备:不起容器、不 build image。"
    info "      build image 走 ./ops/prod/build/image.sh(BUILD 端),"
    info "      起容器走 ./ops/prod/deploy.sh(run 端)。"
    echo ""

    step_preflight    || return 1
    echo ""
    step_secrets      || return 1
    echo ""
    step_data_dir     || return 1
    echo ""

    ok "=== prepare 完成 ==="
    info "  下一步: ./ops/prod/deploy.sh"
    info "    (首次运行时 bring-up:fetch content → 起 db → apply migrations"
    info "     → import content → start full stack)"
    info "  起完后访问:"
    info "    前端: http://localhost  (经 nginx :80)"
    info "    API:  http://localhost/api/docs"
}

usage() {
    cat <<EOF
用法: $0 [command]

命令:
  (default) | setup    主机层准备(preflight + secrets + data dir)。
                        幂等,可以反复跑。**不起容器、不 build image**。
  -h | --help | help   显示本帮助。

跟前置依赖:
  - docker / compose / 80 端口
  - python3(用于 host-side ops 脚本)
  - git(克隆仓库用)
  - openssl(生成 db password)
  - sudo(创建 /var/lib/.../postgres)
  - **不需要 gh CLI**(2026-08-04 移走,workflow 替它读 GH Variable)

跟其他脚本的分工:
  prepare.sh     主机层(幂等,不起容器,不 build image)  ← RUN 端
  deploy.sh      THE go-live(doctor pre + lifecycle + doctor post)  ← RUN 端
  lifecycle.sh   日常(start / stop / restart)         ← RUN 端
  release.sh     bump VERSION + build + push(发布编排)      ← BUILD 端

典型首次流程(RUN 端,在 prod CVM 上):
  apt install -y docker.io python3 git openssl rsync
  ./ops/prod/prepare.sh        # 主机层准备(无需 gh auth)
  ./ops/prod/deploy.sh         # 首次运行时 bring-up
#    ^^^^^^^^^^^^^^^^^^^^^^^^
#    DOCKER_REGISTRY 由 deploy-prod workflow 通过 SSH env 注入

典型发布流程(走 GH Actions,automated):
  git tag v0.3.0 && git push
#  → release-prod + deploy-prod 自动跑

日常(RUN 端,自动):
  # 由 GH Actions deploy-prod workflow 触发
  # 本地手动:export DOCKER_REGISTRY=... && ./ops/prod/deploy.sh
EOF
}

case "${1:-}" in
    ""|setup|prepare)          cmd_prepare ;;
    -h|--help|help)            usage ;;
    *)                         { err "未知命令: $1"; usage; } >&2; exit 1 ;;
esac