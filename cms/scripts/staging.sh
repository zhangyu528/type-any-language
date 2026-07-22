#!/usr/bin/env bash
#
# cms/scripts/staging.sh — thin dispatcher over cms/scripts/cmd_*.sh.
#
# 真正的 sub-command 逻辑在 ./cmd_vocab.sh, ./cmd_sentences.sh, ./cmd_audio.sh,
# ./cmd_export.sh。这里只做路由 + usage,以保持历史肌肉记忆:
#
#   ./cms/scripts/staging.sh vocab       # → exec cmd_vocab.sh
#   ./cms/scripts/staging.sh sentences   # → exec cmd_sentences.sh
#   ./cms/scripts/staging.sh audio       # → exec cmd_audio.sh
#   ./cms/scripts/staging.sh export      # → exec cmd_export.sh
#
# cms/run.sh 已经直走 cmd_*.sh,所以 staging.sh 的 dispatcher 是兼容入口
# (一个 50 行的 case)。任何新加的 sub-command:
#   1. 写 cms/scripts/cmd_<name>.sh
#   2. 在下面 dispatch() 的 case 加一行 "exec cmd_<name>.sh"
#
# 旧的 cms/scripts/env.sh(manage cms/.env)与 cms/.env 本身都已退役。
# 现在 CMS 端唯一 secrets 来源是 fetch_secrets.sh eval-cms(inject 进程 env)。
# 旧的 doctor 子命令也已退役 —— 那条线被 cms/scripts/bootstrap.sh(一次性
# 装 Python deps)+ cms/run.sh 入口的 fetch_secrets.sh check 取代。

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Use git rev-parse to find the project root — the naive
# `cd "$SCRIPT_DIR/../.."` breaks under Git Bash on Windows (the `..`
# resolution eats a hyphenated path segment). See cms/run.sh for the
# same fix.
PROJECT_DIR="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
cd "$PROJECT_DIR"

source "$SCRIPT_DIR/_lib_common.sh"

# ---------------------------------------------------------------------------
# dispatch <sub-command> [args...]
# 单一路由表 — 加新 sub-command 时只动这里。
# ---------------------------------------------------------------------------
dispatch() {
    local sub="$1"; shift || true
    case "$sub" in
        vocab)        exec "$SCRIPT_DIR/cmd_vocab.sh"     "$@" ;;
        sentences)    exec "$SCRIPT_DIR/cmd_sentences.sh" "$@" ;;
        audio)        exec "$SCRIPT_DIR/cmd_audio.sh"     "$@" ;;
        export)       exec "$SCRIPT_DIR/cmd_export.sh"    "$@" ;;
        publish)
            err "publish 子命令已移除 — schema 没有 published 标志"
            err "  直接跑: ./db/scripts/build.sh"
            exit 1 ;;
        -h|--help|help|"") usage ;;
        *) err "未知子命令: $sub"; usage; exit 1 ;;
    esac
}

# ---------------------------------------------------------------------------
# usage — 唯一来源。任何一个 cmd_*.sh 出错不该再写一份 usage — 用这个。
# ---------------------------------------------------------------------------
usage() {
    staging_usage_body
}

dispatch "${1:-help}"
