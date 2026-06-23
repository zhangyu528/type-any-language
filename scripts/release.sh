#!/bin/bash
#
# scripts/release.sh — bump the project version files.
#
# The project carries TWO version files so the dev and prod streams
# can drift independently:
#
#   VERSION.dev   → tag for english_backend_dev / english_frontend_dev
#   VERSION.prod  → tag for english_db_content / english_backend / english_frontend
# (db is "prod-bound" content: it's shared by both targets, so dev always
# reads db's tag from VERSION.prod.)
#
# Subcommands:
#   show                   Print current VERSION.dev / VERSION.prod.
#   bump dev  X.Y.Z        Bump VERSION.dev only (dev stream).
#   bump prod X.Y.Z        Bump VERSION.prod only (prod stream).
#   bump all  X.Y.Z        Bump both files to the same version (synced release).
#   -h | help              Show usage.
#
# bump does NOT build / push images. After bumping, the standard flow is:
#   1. git push  (so each host's next pull brings the new VERSION file)
#   2. On each host, build + push with the new tag:
#        IMAGE_TAG=X.Y.Z ./scripts/ops/<host>/build_image.sh
#        IMAGE_TAG=X.Y.Z ./scripts/ops/<host>/push_image.sh -y
#   3. On target hosts, run.sh start pulls the new image.
#
# Examples:
#   scripts/release.sh show
#   scripts/release.sh bump dev  v0.3.0
#   scripts/release.sh bump prod v0.3.0
#   scripts/release.sh bump all  v0.3.0
#   scripts/release.sh bump dev  v0.3.0-rc.1
#
# Requires: shell + git. NO docker.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib.sh"

VERSION_DEV="VERSION.dev"
VERSION_PROD="VERSION.prod"

usage() {
    cat <<EOF
用法: $0 <command>

命令:
  show                打印当前 VERSION.dev / VERSION.prod
  bump dev  X.Y.Z     只 bump VERSION.dev (dev 流)
  bump prod X.Y.Z     只 bump VERSION.prod (prod 流 + CMS db)
  bump all  X.Y.Z     同步 bump 两份文件 (常规 release)
  -h | help           显示帮助

bump 不 build/push image. 完整发布流程参见 CLAUDE.md 的
"Image version tags" 段.
EOF
}

cmd_show() {
    local dev_v prod_v
    dev_v="$(read_version_file "$VERSION_DEV")"
    prod_v="$(read_version_file "$VERSION_PROD")"
    info "VERSION.dev  = $dev_v"
    info "VERSION.prod = $prod_v"
}

# validate_version <ver> — warn (don't fail) if it doesn't look like semver.
validate_version() {
    local new="$1"
    if ! [[ "$new" =~ ^[vV]?[0-9]+(\.[0-9]+){1,2}([-+][A-Za-z0-9.\-]+)?$ ]]; then
        warn "version 看起来不像 semver: '$new' — 继续 (可作为 docker tag)"
    fi
}

# write_version_file <path> <new> — atomic-ish write (write+rename would be
# safer but VERSION files are short and this is interactive-only).
write_version_file() {
    local path="$1"
    local new="$2"
    printf '%s\n' "$new" > "$path"
}

# git_commit_versions — best-effort: if we're in a git repo, stage the
# touched VERSION files and commit. Silent no-op otherwise.
git_commit_versions() {
    if ! git rev-parse --git-dir >/dev/null 2>&1; then
        warn "不是 git 仓库 — VERSION 已写盘, 自己 commit"
        return 0
    fi
    local to_add=()
    [ -n "${_TOUCHED_DEV:-}" ]  && to_add+=("$VERSION_DEV")
    [ -n "${_TOUCHED_PROD:-}" ] && to_add+=("$VERSION_PROD")
    if [ ${#to_add[@]} -eq 0 ]; then
        return 0
    fi
    git add "${to_add[@]}"
    local msg
    if [ -n "${_TOUCHED_DEV:-}" ] && [ -n "${_TOUCHED_PROD:-}" ]; then
        msg="release: bump all to $_NEW_VER"
    elif [ -n "${_TOUCHED_DEV:-}" ]; then
        msg="release: bump dev to $_NEW_VER"
    else
        msg="release: bump prod to $_NEW_VER"
    fi
    if git commit -m "$msg" >/dev/null 2>&1; then
        ok "已 commit: $msg"
    else
        warn "git commit 失败 (没有 git user? 手动处理)"
    fi
}

# announce_next_steps <stream> <new_ver>
#   stream ∈ dev | prod | all
announce_next_steps() {
    local stream="$1"
    local new="$2"
    echo ""
    info "完整发布流 (在每台主机):"
    case "$stream" in
        dev)
            info "  # CMS 主机 — 不变 (db image 用 VERSION.prod)"
            info "  # dev target:"
            info "  IMAGE_TAG=$new ./scripts/ops/dev-host/build_image.sh"
            info "  IMAGE_TAG=$new ./scripts/ops/dev-host/push_image.sh -y"
            ;;
        prod)
            info "  # CMS 主机 — 烤新 db image:"
            info "  IMAGE_TAG=$new ./scripts/ops/db/bake_image.sh"
            info "  IMAGE_TAG=$new ./scripts/ops/db/push_image.sh -y"
            info "  # prod target:"
            info "  IMAGE_TAG=$new ./scripts/ops/prod-host/build_image.sh"
            info "  IMAGE_TAG=$new ./scripts/ops/prod-host/push_image.sh -y"
            ;;
        all)
            info "  # CMS 主机 — 烤新 db image:"
            info "  IMAGE_TAG=$new ./scripts/ops/db/bake_image.sh"
            info "  IMAGE_TAG=$new ./scripts/ops/db/push_image.sh -y"
            info "  # dev target:"
            info "  IMAGE_TAG=$new ./scripts/ops/dev-host/build_image.sh"
            info "  IMAGE_TAG=$new ./scripts/ops/dev-host/push_image.sh -y"
            info "  # prod target:"
            info "  IMAGE_TAG=$new ./scripts/ops/prod-host/build_image.sh"
            info "  IMAGE_TAG=$new ./scripts/ops/prod-host/push_image.sh -y"
            ;;
        *)
            err "announce_next_steps: unknown stream '$stream'"
            return 1
            ;;
    esac
    echo ""
    info "(IMAGE_TAG 是 belt-and-braces; 主机 git pull 后 VERSION 也会更新)"
}

cmd_bump_stream() {
    local stream="$1"
    local new="$2"
    if [ -z "$new" ]; then
        err "用法: $0 bump $stream <version>"
        info "  e.g. $0 bump $stream v0.2.0"
        exit 1
    fi
    validate_version "$new"

    local old_dev old_prod label=""
    old_dev="$(read_version_file "$VERSION_DEV")"
    old_prod="$(read_version_file "$VERSION_PROD")"

    case "$stream" in
        dev)
            label="VERSION.dev (dev 流)"
            if [ "$old_dev" = "$new" ]; then
                warn "$label 已经是 $new, 无变更"
                exit 0
            fi
            info "当前 $label: $old_dev"
            info "新   $label: $new"
            read -p "确认 bump? [y/N] " ans
            case "$ans" in
                [Yy]|[Yy][Ee][Ss]) ;;
                *) info "已取消"; exit 0 ;;
            esac
            write_version_file "$VERSION_DEV" "$new"
            ok "VERSION.dev 已写: $old_dev → $new"
            _TOUCHED_DEV=1
            _NEW_VER="$new"
            ;;
        prod)
            label="VERSION.prod (prod 流 + CMS db)"
            if [ "$old_prod" = "$new" ]; then
                warn "$label 已经是 $new, 无变更"
                exit 0
            fi
            info "当前 $label: $old_prod"
            info "新   $label: $new"
            read -p "确认 bump? [y/N] " ans
            case "$ans" in
                [Yy]|[Yy][Ee][Ss]) ;;
                *) info "已取消"; exit 0 ;;
            esac
            write_version_file "$VERSION_PROD" "$new"
            ok "VERSION.prod 已写: $old_prod → $new"
            _TOUCHED_PROD=1
            _NEW_VER="$new"
            ;;
        all)
            if [ "$old_dev" = "$new" ] && [ "$old_prod" = "$new" ]; then
                warn "两个文件都已经是 $new, 无变更"
                exit 0
            fi
            info "当前 VERSION.dev  = $old_dev"
            info "当前 VERSION.prod = $old_prod"
            info "新   (两个文件)  = $new"
            read -p "确认 bump? [y/N] " ans
            case "$ans" in
                [Yy]|[Yy][Ee][Ss]) ;;
                *) info "已取消"; exit 0 ;;
            esac
            if [ "$old_dev" != "$new" ]; then
                write_version_file "$VERSION_DEV" "$new"
                ok "VERSION.dev 已写: $old_dev → $new"
                _TOUCHED_DEV=1
            fi
            if [ "$old_prod" != "$new" ]; then
                write_version_file "$VERSION_PROD" "$new"
                ok "VERSION.prod 已写: $old_prod → $new"
                _TOUCHED_PROD=1
            fi
            _NEW_VER="$new"
            ;;
        *)
            err "未知 stream: $stream (应为 dev / prod / all)"
            usage
            exit 1
            ;;
    esac

    git_commit_versions

    announce_next_steps "$stream" "$new"
}

case "${1:-}" in
    show)                            cmd_show ;;
    bump)                            shift; cmd_bump_stream "$@" ;;
    -h|--help|help)                  usage ;;
    "")                              usage ;;
    *)                               err "未知命令: $1"; usage; exit 1 ;;
esac