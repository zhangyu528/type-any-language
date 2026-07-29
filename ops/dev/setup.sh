#!/usr/bin/env bash
#
# ops/dev/setup.sh — first-time (or post-reset) bootstrap for dev.
#
# Walks the operator through the steps a fresh dev clone needs before
# `make dev-start` succeeds. The dev loop is host-native
# (uvicorn + `next dev` on host) — no dev docker images — so setup is
# just:
#
#   1. Preflight: docker + compose + python3 + node must be present.
#   2. Install host-native deps (backend venv + frontend node_modules).
#   3. Bring up the docker db service (compose-managed).
#
# Subcommands:
#   (default) | setup    First-time dev setup. Idempotent — re-running
#                        on a working setup short-circuits any work
#                        that's already done.
#
# Does NOT start app processes, does NOT push to a registry, does NOT
# touch any cloud infrastructure.

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$COMMON_DIR/../.." && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"

cmd_setup() {
    info "=== dev environment setup (host-native loop) ==="
    echo ""

    # 1. Preflight — print-and-stop on failure so the operator can see
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
    if command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; then
        ok "python: $(command -v python3 || command -v python)"
    else
        err "找不到 python3 / python — native backend 需要"
        preflight_ok=0
    fi
    if command -v node >/dev/null 2>&1; then
        ok "node: $(node --version)"
    else
        err "找不到 node (≥ 20) — native frontend 需要"
        preflight_ok=0
    fi
    if [ $preflight_ok -eq 0 ]; then
        err "preflight 失败 — 修好上面 1-2 项后再跑 setup"
        return 1
    fi
    echo ""

    # 2. Native deps — backend venv + frontend node_modules. This is
    #    the only "build" step on the dev host: dev has no docker
    #    images. Both functions are idempotent (hash-aware).
    info "Step 1/2: native deps (backend venv + frontend node_modules)"
    native_setup_python
    native_setup_node
    echo ""

    # 3. Docker db contract — bring up just the db service.
    info "Step 2/2: docker db (compose-managed postgres on :5432)"
    if ! detect_compose_cmd 2>/dev/null; then
        warn "  compose 不可用 — 跳过 (native.sh start 会再 check)"
    else
        if $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q db &>/dev/null 2>&1 && \
           [ -n "$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q db 2>/dev/null | head -1)" ]; then
            ok "  db 容器存在 (skip create)"
        else
            info "  起 db 服务..."
            $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" up -d --pull=never --no-deps db
        fi
    fi
    echo ""

    ok "=== setup 完成 ==="
    info "  dev loop (host-native,db 还在 docker):"
    info "    make dev-start            # python venv + npm run dev"
    info "    make dev-stop             # 停掉两个进程"
    info ""
    info "  内容更新:"
    info "    make dev-import-content   # UPSERT cms/content/,会自动起 db"
    info ""
    info "  schema 变更:"
    info "    make dev-migrate          # 跑 pending schema migrations"
}

# ─── native_setup_python / native_setup_node ─────────────────────────────────
# Install host-native deps for the new default dev path. Both functions are
# idempotent: they short-circuit when nothing's changed by writing a SHA256 of
# the relevant manifest file next to the install target. Same hash-aware
# pattern the old container entrypoint.sh used, just on the host's filesystem.

# _venv_bindir — returns the venv's binary directory name, OS-aware.
# On Unix this is `bin`; on Windows (and Git Bash on Windows) the venv
# module creates `Scripts/` instead. We detect at runtime by checking
# which one exists.
_venv_bindir() {
    local venv_dir="$1"
    if [ -d "$venv_dir/Scripts" ]; then
        echo "Scripts"
    else
        echo "bin"
    fi
}

native_setup_python() {
    local backend_dir="$PROJECT_DIR/backend"
    local venv_dir="$backend_dir/.venv"
    local bindir
    if [ ! -d "$venv_dir" ]; then
        info "  建 python venv (backend/.venv)..."
        if ! (cd "$backend_dir" && python3 -m venv .venv); then
            err "  python3 -m venv 失败"
            return 1
        fi
    else
        info "  backend/.venv 已存在 (skip create)"
    fi
    bindir="$(_venv_bindir "$venv_dir")"
    local req_hash_file="$backend_dir/.requirements.sha256"
    local current_hash
    current_hash="$(sha256sum "$backend_dir/requirements.txt" 2>/dev/null | awk '{print $1}')"
    local prior_hash=""
    [ -f "$req_hash_file" ] && prior_hash="$(cat "$req_hash_file" 2>/dev/null || echo "")"
    if [ -z "$current_hash" ]; then
        err "  读 backend/requirements.txt 失败"
        return 1
    fi
    if [ "$current_hash" != "$prior_hash" ]; then
        info "  pip install -r backend/requirements.txt ..."
        if ! (cd "$backend_dir" && ".venv/$bindir/pip" install -r requirements.txt); then
            err "  pip install 失败"
            return 1
        fi
        echo "$current_hash" > "$req_hash_file"
    else
        info "  backend deps 已安装 (hash 匹配)"
    fi
}

native_setup_node() {
    local frontend_dir="$PROJECT_DIR/frontend"
    local lock_hash_file="$frontend_dir/.package-lock.sha256"
    local current_hash
    current_hash="$(sha256sum "$frontend_dir/package-lock.json" 2>/dev/null | awk '{print $1}')"
    local did_install=0
    if [ -z "$current_hash" ]; then
        err "  读 frontend/package-lock.json 失败"
        return 1
    fi
    local prior_hash=""
    [ -f "$lock_hash_file" ] && prior_hash="$(cat "$lock_hash_file" 2>/dev/null || echo "")"
    if [ ! -d "$frontend_dir/node_modules" ] || [ "$current_hash" != "$prior_hash" ]; then
        info "  npm install (frontend/node_modules)..."
        if ! (cd "$frontend_dir" && npm install --no-audit --no-fund); then
            err "  npm install 失败"
            return 1
        fi
        echo "$current_hash" > "$lock_hash_file"
        did_install=1
    else
        info "  frontend node_modules 已存在 + lock hash 匹配 (skip)"
    fi
    # Suppress unused-var warning when no install happened
    : "${did_install:=0}"
}

usage() {
    cat <<EOF
用法: $0 <command>

命令:
  (default) | setup    Preflight + install native deps + bring up docker db
                      (idempotent — re-runs short-circuit work that's already done)

典型工作流(全新机器):
  ./ops/dev/setup.sh              # 装 venv + node_modules + 起 db
  make dev-start                  # native: uvicorn + next dev on host
  make dev-import-content         # 把 cms/content/ UPSERT 到 dev db
EOF
}

case "${1:-}" in
    ""|setup)               cmd_setup ;;
    -h|--help|help)         usage ;;
    *)                      { err "未知命令: $1"; usage; } >&2; exit 1 ;;
esac
