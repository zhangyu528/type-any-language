#!/bin/bash
#
# scripts/release.sh — bump the project version (the root VERSION file).
#
# Subcommands:
#   show           Print current VERSION.
#   bump X.Y.Z     Set VERSION, commit, print next-step hints.
#   -h | help      Show usage.
#
# bump does NOT build / push images. After bumping, the standard flow is:
#   1. git push  (so each host's next pull brings the new VERSION)
#   2. On each host, build + push with the new tag:
#        IMAGE_TAG=X.Y.Z ./scripts/ops/<host>/build_image.sh
#        IMAGE_TAG=X.Y.Z ./scripts/ops/<host>/push_image.sh -y
#   3. On target hosts, run.sh start pulls the new image.
# (The IMAGE_TAG explicit pass is belt-and-braces; reading VERSION
# would also work once the new VERSION file is on the host.)
#
# Examples:
#   scripts/release.sh show
#   scripts/release.sh bump v0.2.0
#   scripts/release.sh bump 0.2.0-rc.1
#
# Requires: shell + git. NO docker.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib.sh"

usage() {
    cat <<EOF
用法: $0 <command>

命令:
  show          打印当前 VERSION
  bump X.Y.Z    把 VERSION 改成 X.Y.Z, 提交, 提示下一步
  -h | help     显示帮助

bump 不 build/push image. 完整发布流程参见 CLAUDE.md 的
"Image version tags" 段.
EOF
}

cmd_show() {
    if [ ! -f VERSION ]; then
        err "VERSION 文件不存在 (应在仓库根)"
        exit 1
    fi
    cat VERSION
}

cmd_bump() {
    local new="${1:-}"
    if [ -z "$new" ]; then
        err "用法: $0 bump <version>"
        info "  e.g. $0 bump v0.2.0"
        exit 1
    fi
    # Lightweight shape check: optional v/V, 2-3 numeric segments, optional
    # -rc.N / +meta suffix. Not strict semver — this is a docker tag, not a
    # library version, so we just warn and proceed.
    if ! [[ "$new" =~ ^[vV]?[0-9]+(\.[0-9]+){1,2}([-+][A-Za-z0-9.\-]+)?$ ]]; then
        warn "version 看起来不像 semver: '$new' — 继续 (可作为 docker tag)"
    fi

    local old
    old="$(read_version_file)"
    if [ "$old" = "$new" ]; then
        warn "VERSION 已经是 $new, 无变更"
        exit 0
    fi

    info "当前 VERSION: $old"
    info "新 VERSION:   $new"
    read -p "确认 bump? [y/N] " ans
    case "$ans" in
        [Yy]|[Yy][Ee][Ss]) ;;
        *) info "已取消"; exit 0 ;;
    esac

    printf '%s\n' "$new" > VERSION
    ok "VERSION 已写: $old → $new"

    # Commit (best-effort; if git user isn't set, leave the file change for
    # the operator to handle).
    if git rev-parse --git-dir >/dev/null 2>&1; then
        git add VERSION
        if git commit -m "release: $new" >/dev/null 2>&1; then
            ok "已 commit"
            echo ""
            info "下一步:"
            info "  git push                                  # 推送 VERSION bump"
            info "  (各主机 git pull 后即可 IMAGE_TAG=$new build+push)"
        else
            warn "git commit 失败 (没有 git user? 手动处理)"
        fi
    else
        warn "不是 git 仓库 — VERSION 已写盘, 自己 commit"
    fi

    echo ""
    info "完整发布流 (在每台主机):"
    info "  IMAGE_TAG=$new ./scripts/ops/db/bake_image.sh"
    info "  IMAGE_TAG=$new ./scripts/ops/db/push_image.sh -y"
    info "  IMAGE_TAG=$new ./scripts/ops/dev-host/build_image.sh"
    info "  IMAGE_TAG=$new ./scripts/ops/dev-host/push_image.sh -y"
    info "  IMAGE_TAG=$new ./scripts/ops/prod-host/build_image.sh"
    info "  IMAGE_TAG=$new ./scripts/ops/prod-host/push_image.sh -y"
}

case "${1:-}" in
    show)           cmd_show ;;
    bump)           shift; cmd_bump "$@" ;;
    -h|--help|help) usage ;;
    "")             usage ;;
    *)              err "未知命令: $1"; usage; exit 1 ;;
esac
