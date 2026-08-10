#!/usr/bin/env bash
#
# ops/cvm/bootstrap.sh — host-level preparation for the prod CVM.
#
# Thin orchestrator. Each step is a separate script in ops/cvm/:
#   docker/install.sh        - install Docker Engine + Compose plugin if missing
#   preflight.sh             - read-only env check (docker / compose / :80)
#   secrets/install.sh       - generate .secrets/db_password
#   data-dir/install.sh      - mkdir + chown UID 999 for postgres bind-mount
#   nginx/install.sh         - install ops/cvm/nginx/site.conf to system nginx
#   deploy-if-published.sh   - probe registry, pull, lifecycle.sh start, doctor
#
# Each step is idempotent and standalone-runnable (handy for re-runs
# after operator hand-edits + for debugging one step at a time).
# Safe to re-run the whole bootstrap.sh — every step short-circuits
# on existing state.
#
# See AGENTS.md for the deploy-prod workflow that pairs with this script.

set -euo pipefail

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$COMMON_DIR/../.." && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
setup_prod_host_env

cmd_prepare() {
    info "=== prod host prepare (idempotent) ==="
    echo ""
    info "  主机层准备:不起容器、不 build image。"
    info "  build image 走 CI(release/build.yml),"
    info "  起容器走 ./ops/cvm/deploy-if-published.sh 或 lifecycle.sh start。"
    echo ""

    # docker first — preflight needs docker to be installed to be useful.
    bash "$COMMON_DIR/docker/install.sh"        || return 1; echo ""
    bash "$COMMON_DIR/preflight.sh"             || return 1; echo ""
    bash "$COMMON_DIR/secrets/install.sh"       || return 1; echo ""
    bash "$COMMON_DIR/data-dir/install.sh"      || return 1; echo ""
    bash "$COMMON_DIR/nginx/install.sh"         || return 1; echo ""

    bash "$COMMON_DIR/deploy-if-published.sh"
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
      主机层准备(docker install + preflight + secrets + data dir + nginx site)。
      准备完成后尝试部署并启动最新镜像(可跳)。

  -h | --help | help
      显示本帮助。

部署行为(默认开启,条件触发):
  准备完成后,若 GHCR 上存在已发布的镜像(默认 :latest tag,或 IMAGE_TAG
  指定的版本),bootstrap 会拉取并启动整套服务。
  - 无已发布镜像 / 未登录 GHCR / 离线 → 跳过部署,只做主机层准备并打印指引。
  - BOOTSTRAP_SKIP_DEPLOY=1 → 强制跳过部署,仅做主机层准备。
  - IMAGE_TAG=vX.Y.Z → 部署该固定版本而非最新的 :latest。

前置依赖: sudo(其他前置如 git / openssl / python3 通常 CVM 镜像自带)。

首次流程 / 日常流程 / 与 publish-prod workflow 的对接见 AGENTS.md。
EOF
}

case "${1:-}" in
    ""|setup|bootstrap|prepare)   cmd_prepare ;;
    -h|--help|help)               usage ;;
    *)                            { err "未知命令: $1"; usage; } >&2; exit 1 ;;
esac
