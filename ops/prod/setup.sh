#!/usr/bin/env bash
#
# ops/prod/setup.sh — first-time (or post-reset) bootstrap.
#
# Walks the operator through the steps a fresh prod host needs before
# `./lifecycle.sh start` will succeed. With the cloud-db write path,
# the bootstrap is:
#
#   1. Preflight: docker + compose must be present.
#   2. Cloud-db (TencentDB) bootstrap — one-time per host. Creates the
#      prod ROLE + DATABASE on the shared instance, writes
#      .secrets/database_url. Optional here: only invoked when the
#      operator asks for it (`./ops/prod/setup.sh bootstrap`). Re-running
#      setup after a working bootstrap skips this step.
#   3. prod app images: call ops/prod/build_image.sh. Skipped if both
#      already present.
#   4. Final summary.
#
# Subcommands:
#   (default) | setup    Preflight + build prod app images. Assumes
#                        the cloud-db has already been bootstrapped
#                        (run `./ops/prod/setup.sh bootstrap` once for
#                        a new host, or copy .secrets/database_url
#                        from a peer host). Self-hosted postgres
#                        users configure DATABASE_URL via shell env
#                        instead.
#   bootstrap            One-time cloud-db (TencentDB) setup. Prompts
#                        for the admin DSN, writes
#                        .secrets/tencent_db_admin_url (chmod 600),
#                        then invokes db/scripts/bootstrap_tencent.sh
#                        with tier=prod. Self-hosted postgres users
#                        skip this.
#
# Does NOT create .secrets/database_url on its own (only bootstrap does),
# does NOT start containers, does NOT push to a registry.

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$COMMON_DIR/../.." && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
setup_prod_host_env

cmd_setup() {
    info "=== prod environment setup ==="
    echo ""

    # 1. Preflight.
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

    # 2. Cloud-db contract.
    if [ -f "$DB_URL_FILE" ]; then
        ok "cloud-db: .secrets/database_url 已就绪"
    elif [ -n "${DATABASE_URL:-}" ]; then
        info "cloud-db: DATABASE_URL 在 shell env(自管 db / CI)"
    else
        err "cloud-db 未配置 — 缺 .secrets/database_url 或 DATABASE_URL"
        info "  → 云 db 主机(首次): ./ops/prod/setup.sh bootstrap"
        info "  → 复用:               scp peer-prod:.secrets/database_url .secrets/"
        info "  → 自管 / CI:          export DATABASE_URL=postgres://..."
        return 1
    fi
    echo ""

    # 3. prod app images
    info "Step 1/1: prod app images"
    if image_exists "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" && \
       image_exists "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"; then
        ok "  ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 已存在"
        ok "  ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 已存在"
        info "  (要 rebuild? 跑: ops/prod/build_image.sh)"
    else
        info "  调 ops/prod/build_image.sh..."
        echo ""
        if "$COMMON_DIR/build_image.sh"; then
            echo ""
            ok "  build done"
        else
            err "  build 失败 — 见上面的错误"
            return 1
        fi
    fi
    echo ""

    ok "=== setup 完成 ==="
    info "  下一步: ./ops/prod/lifecycle.sh start"
    info "  启动后访问:"
    info "    前端: http://localhost  (经 nginx :80)"
    info "    API:  http://localhost/api/docs"
}

# ---------------------------------------------------------------------------
# cmd_bootstrap — first-time cloud-db (TencentDB) setup, prod tier.
#
# Mirrors ops/dev/setup.sh::cmd_bootstrap. Differences:
#   - tier=prod → db/scripts/lib.sh uses TENCENT_DB_PROD_USER /
#     TENCENT_DB_PROD_PASSWORD env (or .secrets/tencent_db_prod_*
#     files); db name is fixed at "english_prod" (no $USER / SHA
#     suffix) — render_db_name is bypassed for prod.
#   - The prod admin DSN is the same postgres superuser as dev's
#     (both target the same shared instance); bootstrap_tencent.sh
#     uses it to CREATE ROLE english_prod_user (idempotent).
#   - bootstrap_tencent.sh writes .secrets/database_url exactly once;
#     subsequent runs reuse the file.
# ---------------------------------------------------------------------------
cmd_bootstrap() {
    info "=== prod host: cloud-db (TencentDB) bootstrap (tier=prod) ==="
    echo ""

    if ! command -v psql &> /dev/null; then
        err "psql 未安装 — TencentDB bootstrap 需要 postgresql-client"
        info "  → Ubuntu/Debian:  sudo apt install postgresql-client"
        info "  → macOS:          brew install postgresql-client"
        info "  → Windows:        使用 stack-postgres 或 WSL"
        return 1
    fi
    if ! command -v python3 &> /dev/null; then
        err "python3 未安装 — bootstrap_tencent.sh 需要它做 url-encode"
        return 1
    fi
    ok "  psql:    $(psql --version 2>&1 | head -1)"
    ok "  python3: $(python3 --version 2>&1 | head -1)"
    echo ""

    local admin_url=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --admin-url=*) admin_url="${1#*=}"; shift ;;
            *)             err "未知参数: $1"; return 1 ;;
        esac
    done
    if [ -z "$admin_url" ] && [ -n "${TENCENT_DB_ADMIN_URL:-}" ]; then
        admin_url="$TENCENT_DB_ADMIN_URL"
        info "  admin URL from TENCENT_DB_ADMIN_URL env (GH Secrets path)"
    fi

    local admin_url_file="$PROJECT_DIR/.secrets/tencent_db_admin_url"
    if [ -z "$admin_url" ] && [ -f "$admin_url_file" ] && \
       [ -n "$(awk 'NR==1' "$admin_url_file" 2>/dev/null)" ]; then
        admin_url="$(awk 'NR==1' "$admin_url_file")"
        info "  admin URL from existing $admin_url_file (rerun safe)"
    fi

    if [ -z "$admin_url" ]; then
        echo ""
        info "  Need the postgres:// admin DSN for the shared TencentDB."
        info "  Get it once from the TencentDB console (database > manage"
        info "  > account management), then paste here. After this run"
        info "  it's stored in $admin_url_file (chmod 600) and bootstrap_tencent.sh"
        info "  uses it to CREATE ROLE english_prod_user / DATABASE english_prod"
        info "  / GRANT."
        info ""
        info "  快捷通道(GH Secrets): export TENCENT_DB_ADMIN_URL=postgres://... 再重跑本命令"
        echo ""
        read -rs -p "  admin DSN (postgres://...; 不会回显): " admin_url
        echo ""
        if [ -z "$admin_url" ]; then
            err "  admin DSN 为空 — 退出"
            return 1
        fi
        if ! [[ "$admin_url" =~ ^postgres(ql)?:// ]]; then
            err "  DSN 格式不像 postgres:// — 退出"
            return 1
        fi
    fi
    echo ""

    mkdir -p "$PROJECT_DIR/.secrets"
    chmod 700 "$PROJECT_DIR/.secrets"
    local tmp_admin
    tmp_admin="$(mktemp "$PROJECT_DIR/.secrets/.tencent_db_admin_url.XXXXXX")"
    chmod 600 "$tmp_admin"
    printf '%s\n' "$admin_url" > "$tmp_admin"
    mv "$tmp_admin" "$admin_url_file"
    chmod 600 "$admin_url_file"
    ok "  wrote $admin_url_file (chmod 600)"
    echo ""

    info "  invoke db/scripts/bootstrap_tencent.sh (tier=prod)..."
    echo ""
    if ! OPS_TIER=prod "$PROJECT_DIR/db/scripts/bootstrap_tencent.sh"; then
        err "  bootstrap_tencent.sh 失败 — 看上方错误"
        info "  注:admin URL 已在 $admin_url_file,直接重跑可复用"
        return 1
    fi
    echo ""

    ok "=== prod cloud-db bootstrap 完成 ==="
    info "  接下来:"
    info "    eval \"\$(./scripts/secrets/fetch_secrets.sh eval-db)\"   # 注入 DATABASE_URL 到当前 shell"
    info "    ./ops/prod/lifecycle.sh start                            # 起容器,会自动用 .secrets/database_url"
    return 0
}

usage() {
    cat <<EOF
用法: $0 <command>

命令:
  (default) | setup    Preflight + build prod app images. Requires
                        cloud-db already bootstrapped (or DATABASE_URL
                        in env). No CMS re-run.
  bootstrap            One-time cloud-db (TencentDB) setup (tier=prod).
                        Prompts for the admin DSN, writes
                        .secrets/tencent_db_admin_url (chmod 600),
                        invokes db/scripts/bootstrap_tencent.sh to
                        CREATE ROLE / DATABASE / GRANT. Only needed
                        for prod hosts using cloud-db — self-hosted
                        postgres users skip this.

典型工作流:
  ./ops/prod/setup.sh bootstrap          # 首次 (cloud-db 主机)
  ./ops/prod/setup.sh                    # 之后每次都跑 (build prod images)
  ./ops/prod/lifecycle.sh start          # 日常起容器
EOF
}

case "${1:-}" in
    ""|setup)               cmd_setup ;;
    bootstrap)              shift; cmd_bootstrap "$@" ;;
    -h|--help|help)         usage ;;
    *)                      { err "未知命令: $1"; usage; } >&2; exit 1 ;;
esac