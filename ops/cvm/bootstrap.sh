#!/usr/bin/env bash
#
# ops/cvm/bootstrap.sh — host-level preparation for the prod TARGET host.
#
# This script is **only** for the runtime/serve side of the deploy —
# i.e. the CVM that will run the prod containers. It does NOT build
# images. Image construction is CI's job
# (.github/workflows/release-build.yml).
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
#      The password is consumed by the compose file's `secrets:` block
#      (ops/cvm/compose/docker-compose.yml) and POSTGRES_PASSWORD_FILE
#      in the db service. It is written to the REPO ROOT .secrets/,
#      which is why every compose call goes through _common.sh's
#      compose() wrapper with --project-directory pinned to the root.
#   4. Data dir — create /var/lib/type-any-language/postgres owned by
#      UID 999 (postgres alpine user) if missing. Without this, the
#      bind-mounted db container fails on first boot with EACCES.
#   5. nginx site — install ops/cvm/nginx/site.conf into
#      /etc/nginx/sites-{available,enabled} (delegated to
#      ops/cvm/nginx/install.sh).
#
# What this script does NOT do (and why):
#   - Build images — that's .github/workflows/release-build.yml. On the
#     run side, compose auto-pulls from $DOCKER_REGISTRY when images
#     are missing locally.
#   - Start any containers — UNLESS a published image is reachable: the
#     final step (step_deploy_if_published) pulls the `latest` tag and runs
#     ./ops/cvm/lifecycle.sh start when one exists. On a host with nothing
#     published yet (or with BOOTSTRAP_SKIP_DEPLOY=1 set), bootstrap stays
#     host-prep-only and just prints the bring-up command. Set IMAGE_TAG to
#     pin an exact release instead of the mutable `latest` tag.
#   - Apply schema migrations / import CMS content — the custom db
#     image's entrypoint does both on every container start, so they
#     happen automatically the first time lifecycle.sh brings db up.
#   - Set DOCKER_REGISTRY — it is injected by the deploy workflow via
#     SSH env; export it manually for ad-hoc runs.
#   - Provision TLS / DNS / firewall (host-level, run before this).
#
# Typical first-time flow on the prod CVM:
#   ./ops/cvm/bootstrap.sh        # host prep + (if a published image exists) deploy latest + run
#   # ↑ if no image is published yet, it stops after host prep and tells
#   #   you to run release-build.yml, then re-run. Re-running redeploys latest.
#
# Daily flow (after bootstrap.sh has been run once):
#   ./ops/cvm/lifecycle.sh start|stop|restart
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

# ─── step_nginx_site_link ─────────────────────────────────────────────
# Delegate to ops/cvm/nginx/install.sh so the implementation is
# testable in isolation and can be re-run outside of bootstrap.sh
# (e.g. after the operator hand-edits /etc/nginx/sites-available).
# The script itself is idempotent and safe to re-run.
step_nginx_site_link() {
    bash "$PROJECT_DIR/ops/cvm/nginx/install.sh"
}

# ─── step_deploy_if_published ──────────────────────────────────────────
# Final bootstrap step: if a published image is reachable for the resolved
# tag (default `latest`, or IMAGE_TAG if set), pull it and bring the stack
# up via lifecycle.sh. This makes a single `bootstrap.sh` take a fresh CVM
# from zero to a running, newest-version service — the user's "如果有已经
# 发布的产品 就部署最新的 并运行" intent.
#
# Guards (so bootstrap stays safe / idempotent):
#   - BOOTSTRAP_SKIP_DEPLOY=1  → skip deploy entirely (host prep only).
#   - No reachable image (never published / not logged into GHCR / offline)
#     → skip with guidance, exit 0 (host prep still succeeded).
#   - Pull succeeds → lifecycle.sh start + a best-effort doctor check.
step_deploy_if_published() {
    if [ "${BOOTSTRAP_SKIP_DEPLOY:-0}" = "1" ]; then
        info "=== deploy === (跳过: BOOTSTRAP_SKIP_DEPLOY=1)"
        return 0
    fi
    info "=== deploy (if published) ==="

    # Resolve the full image ref the same way lifecycle/compose will use.
    # setup_prod_host_env already set BACKEND_FULL_IMAGE / tag; we just need
    # the bare repo path for a reachability probe.
    local probe="${BACKEND_FULL_IMAGE}"
    info "  探针镜像: $probe"
    if ! docker manifest inspect "$probe" >/dev/null 2>&1; then
        warn "未检测到已发布的镜像 ($probe)"
        info "  → 先跑 .github/workflows/release-build.yml 发布镜像,然后重跑本脚本即可部署并运行"
        info "  → 或设 BOOTSTRAP_SKIP_DEPLOY=1 仅做主机层准备"
        return 0
    fi

    info "检测到已发布镜像,拉取并启动 (tag=$BACKEND_IMAGE_TAG)..."
    if ! compose pull; then
        warn "拉取镜像失败($probe)— 可能未登录 GHCR 或无网络,跳过部署"
        info "  → 确保 CVM 能拉取 GHCR(ghcr.io login),然后重跑本脚本"
        return 0
    fi

    bash "$PROJECT_DIR/ops/cvm/lifecycle.sh" start
    # Best-effort health check — don't fail bootstrap if doctor is unhappy.
    bash "$PROJECT_DIR/ops/cvm/doctor.sh" || true
    ok "=== 部署并启动完成 (tag=$BACKEND_IMAGE_TAG) ==="
    info "  访问: 前端 http://localhost  API http://localhost/api/docs"
}

# ─── cmd_prepare ─────────────────────────────────────────────────────────
cmd_prepare() {
    info "=== prod host prepare (idempotent, run env only) ==="
    echo ""
    info "  ⚠️  这个脚本只做主机层准备:不起容器、不 build image。"
    info "      build image 走 CI(.github/workflows/release-build.yml),"
    info "      起容器走 ./ops/cvm/lifecycle.sh start(run 端)。"
    echo ""

    step_preflight    || return 1
    echo ""
    step_secrets      || return 1
    echo ""
    step_data_dir     || return 1
    echo ""
    step_nginx_site_link || return 1
    echo ""

    # Deploy latest + run IF a published image exists (guarded inside).
    step_deploy_if_published
    echo ""

    ok "=== prepare 完成 ==="
    info "  主机层已就绪。若上面 deploy 步骤已拉起容器,访问:"
    info "    前端: http://localhost  (经 nginx :80)"
    info "    API:  http://localhost/api/docs"
    info "  若 deploy 被跳过(无已发布镜像 / BOOTSTRAP_SKIP_DEPLOY=1):"
    info "    ./ops/cvm/lifecycle.sh start   (或 make prod-start)"
}

usage() {
    cat <<EOF
用法: $0 [command]

命令:
  (default) | setup    主机层准备(preflight + secrets + data dir)。
                        幂等,可以反复跑。准备完成后会尝试部署并启动
                        最新镜像(见下「部署行为」)。
  -h | --help | help   显示本帮助。

部署行为(默认开启,条件触发):
  准备完成后,若 GHCR 上存在已发布的镜像(默认 :latest tag,或 IMAGE_TAG
  指定的版本),bootstrap 会拉取并启动整套服务(lifecycle.sh start)。
  - 无已发布镜像 / 未登录 GHCR / 离线 → 跳过部署,只做主机层准备并打印指引。
  - BOOTSTRAP_SKIP_DEPLOY=1 → 强制跳过部署,仅做主机层准备。
  - 设 IMAGE_TAG=vX.Y.Z → 部署该固定版本而非最新的 :latest。
  这样一条 bootstrap.sh 即可让全新 CVM 从零到「跑着最新版」,且反复重跑
  会重新拉取 :latest 并升级(recreate)。

跟前置依赖:
  - docker / compose / 80 端口
  - python3(用于 host-side ops 脚本)
  - git(克隆仓库用)
  - openssl(生成 db password)
  - sudo(创建 /var/lib/.../postgres)
  - **不需要 gh CLI**(2026-08-04 移走,workflow 替它读 GH Variable)

跟其他脚本的分工:
  ops/cvm/bootstrap.sh        主机层(幂等,不起容器,不 build)   ← RUN 端
  ops/cvm/lifecycle.sh        日常(start / stop / restart)      ← RUN 端
  ops/cvm/doctor.sh           只读体检(部署前后各跑一次)        ← RUN 端
  ops/cvm/nginx/install.sh    装 / 重载系统 nginx site          ← RUN 端
  ops/publish/deploy-prod.sh   打包 + scp + 远程编排              ← CI 端
  .github/workflows/          build / release / publish         ← CI 端

典型首次流程(RUN 端,在 prod CVM 上):
  apt install -y docker.io python3 git openssl rsync
  ./ops/cvm/bootstrap.sh        # 主机层准备(无需 gh auth)
  ./ops/cvm/lifecycle.sh start  # 首次运行时 bring-up
#    ^^^^^^^^^^^^^^^^^^^^^^^^
#    DOCKER_REGISTRY 由 deploy-prod workflow 通过 SSH env 注入

典型发布流程(走 GH Actions,automated):
  release-build.yml   → 出 rc tag + 3 个 image
  staging.yml (mode: validate)  → 临时 staging 验证
  publish-prod.yml    → 调 ops/publish/deploy-prod.sh 部署到 prod

日常(RUN 端,自动):
  # 由 GH Actions publish-prod workflow 触发
  # 本地手动:export DOCKER_REGISTRY=... && make prod-restart && make prod-doctor
EOF
}

case "${1:-}" in
    ""|setup|bootstrap|prepare)   cmd_prepare ;;
    -h|--help|help)            usage ;;
    *)                         { err "未知命令: $1"; usage; } >&2; exit 1 ;;
esac