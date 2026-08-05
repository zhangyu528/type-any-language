#!/usr/bin/env bash
#
# scripts/fetch_cms_content.sh — pull CMS staging files to a target host.
#
# ⚠️  **DEV-ONLY** as of Layer 3. On prod, content ships baked into the
# db image (db/Dockerfile + db/image-entrypoint.sh auto-imports on every
# container start). Prod CVMs no longer need to fetch content at runtime.
# This script is kept for dev hosts (host-native, no db image) and
# CI / ad-hoc test scenarios.
#
# For dev: dev hosts run uvicorn + next dev natively (no db container
# running with the custom entrypoint). Dev importer reads
# `cms/content/` from the host directly. So dev DOES need this script
# (or just a plain `git pull`).
#
# Subcommands:
#   auto                   (default) rsync if $CMS_HOST set, else git pull.
#                          Best for "I don't care, just get the content".
#   rsync                  rsync from $CMS_HOST over SSH.
#                          Requires: CMS_HOST=user@host:/abs/path/to/repo
#                          Optional: CMS_SSH_KEY=/path/to/private/key
#   git                    git pull (cms/content/ is repo-tracked).
#                          Requires: working tree clean OR --autostash-able.
#   from <local-path>      Copy vocabulary/*.json + sentences/*.jsonl from
#                          a local directory (testing / offline / restore
#                          from a tarball).
#
# Common usage:
#   # Dev host (cms/content/ tracked in repo):
#   scripts/fetch_cms_content.sh git        # → git pull
#
#   # Dev with SSH access to CMS host:
#   export CMS_HOST=cms-user@cms.internal:/opt/type-any-language
#   scripts/fetch_cms_content.sh            # → auto → rsync
#
#   # Test / CI (no network):
#   scripts/fetch_cms_content.sh from /tmp/cms-staging-snapshot
#
# Idempotent: re-running just refreshes local cms/content/.
# Side effects: overwrites local cms/content/{vocabulary,sentences}/.
#
# Why this lives at scripts/ (not ops/prod/):
#   Both dev and prod hosts consume CMS content. ops/prod/ is for prod
#   runtime; scripts/ holds cross-host utilities (cf. scripts/secrets/
#   fetch_secrets.sh, which has the same shape).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CMS_CONTENT_DIR="$PROJECT_DIR/cms/content"

# ─── info / err ──────────────────────────────────────────────────────────
if [ -t 1 ]; then
    _RED='\033[0;31m'; _GREEN='\033[0;32m'; _BLUE='\033[1;34m'; _NC='\033[0m'
else
    _RED=''; _GREEN=''; _BLUE=''; _NC=''
fi
info() { echo -e "${_BLUE}[INFO]${_NC} $1"; }
err()  { echo -e "${_RED}[ERR]${_NC}  $1" >&2; }
ok()   { echo -e "${_GREEN}[OK]${_NC}   $1"; }

# ─── count_files <dir> ───────────────────────────────────────────────────
count_files() {
    local dir="$1"
    local vocab=0 sentences=0
    [ -d "$dir/vocabulary" ] && vocab=$(find "$dir/vocabulary" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
    [ -d "$dir/sentences" ]  && sentences=$(find "$dir/sentences" -maxdepth 1 -name '*.jsonl' 2>/dev/null | wc -l | tr -d ' ')
    echo "vocabulary=$vocab, sentences=$sentences"
}

# ─── cmd_rsync ───────────────────────────────────────────────────────────
cmd_rsync() {
    if [ -z "${CMS_HOST:-}" ]; then
        err "CMS_HOST 未设置 — rsync 模式需要 export CMS_HOST=user@host:/path/to/repo"
        return 1
    fi
    if ! command -v rsync >/dev/null 2>&1; then
        err "rsync 未安装 — apt install rsync (or apk add rsync on Alpine)"
        return 1
    fi

    info "rsync 从 ${CMS_HOST}:cms/content/ → $CMS_CONTENT_DIR"
    mkdir -p "$CMS_CONTENT_DIR"

    local ssh_opts="-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null"
    [ -n "${CMS_SSH_KEY:-}" ] && ssh_opts="$ssh_opts -i $CMS_SSH_KEY"

    if ! rsync -avz --delete \
            -e "ssh $ssh_opts" \
            "${CMS_HOST}:cms/content/" \
            "$CMS_CONTENT_DIR/"; then
        err "rsync 失败 — 检查 CMS_HOST、SSH 凭据、网络"
        return 1
    fi

    ok "rsync done"
    info "  $(count_files "$CMS_CONTENT_DIR")"
}

# ─── cmd_git ─────────────────────────────────────────────────────────────
cmd_git() {
    if ! git -C "$PROJECT_DIR" rev-parse --git-dir >/dev/null 2>&1; then
        err "$PROJECT_DIR 不是 git 仓库 — git 模式需要仓库里有 cms/content/ 的历史"
        return 1
    fi

    info "git pull (cms/content/ 是 repo-tracked)..."
    if ! git -C "$PROJECT_DIR" pull --rebase --autostash; then
        err "git pull 失败 — 看上方 git 错误(可能 working tree 不干净 / 没配 remote)"
        return 1
    fi

    ok "git pull done"
    info "  $(count_files "$CMS_CONTENT_DIR")"
}

# ─── cmd_from <path> ─────────────────────────────────────────────────────
cmd_from() {
    local src="$1"
    if [ -z "$src" ]; then
        err "用法: $0 from <local-path>  (path 应包含 vocabulary/*.json + sentences/*.jsonl)"
        return 1
    fi
    if [ ! -d "$src" ]; then
        err "$src 不是目录"
        return 1
    fi

    info "从本地路径复制: $src → $CMS_CONTENT_DIR"
    mkdir -p "$CMS_CONTENT_DIR/vocabulary" "$CMS_CONTENT_DIR/sentences"

    local copied=0
    if [ -d "$src/vocabulary" ]; then
        for f in "$src/vocabulary"/*.json; do
            [ -f "$f" ] || continue
            cp "$f" "$CMS_CONTENT_DIR/vocabulary/" && copied=$((copied + 1))
        done
    fi
    if [ -d "$src/sentences" ]; then
        for f in "$src/sentences"/*.jsonl; do
            [ -f "$f" ] || continue
            cp "$f" "$CMS_CONTENT_DIR/sentences/" && copied=$((copied + 1))
        done
    fi

    ok "copied $copied 文件"
    info "  $(count_files "$CMS_CONTENT_DIR")"
}

# ─── cmd_auto ────────────────────────────────────────────────────────────
cmd_auto() {
    if [ -n "${CMS_HOST:-}" ]; then
        info "auto 模式: 检测到 CMS_HOST → 走 rsync"
        cmd_rsync
    else
        info "auto 模式: 无 CMS_HOST → 走 git pull"
        cmd_git
    fi
}

usage() {
    cat <<EOF
用法: $0 <subcommand> [args]

Subcommands:
  auto                (默认)rsync 若 \$CMS_HOST 设置,否则 git pull。
  rsync               从 \$CMS_HOST 拉(SSH rsync)。
                      需要: export CMS_HOST=user@host:/abs/path/to/repo
                      可选: export CMS_SSH_KEY=/path/to/key
  git                 git pull(假设 cms/content/ 在 repo 里 tracked)。
  from <local-path>   从本地目录复制(测试 / 离线)。

典型用法:
  # Prod(配置好 SSH 到 CMS 主机):
  export CMS_HOST=cms-user@cms.internal:/opt/type-any-language
  $0                          # auto → rsync

  # Dev(没有 CMS 主机,直接走 git):
  $0 git

  # CI / 离线测试:
  $0 from /tmp/cms-staging

幂等:重新跑 = 刷新 cms/content/。
EOF
}

case "${1:-auto}" in
    auto)              cmd_auto ;;
    rsync)             cmd_rsync ;;
    git)               cmd_git ;;
    from)              shift; cmd_from "$@" ;;
    -h|--help|help)    usage ;;
    *)                 { err "未知子命令: $1"; usage; } >&2; exit 1 ;;
esac