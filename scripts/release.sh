#!/bin/bash
#
# scripts/release.sh — bump + build + push a project version.
#
# The project carries TWO version files so the dev and prod streams
# can drift independently:
#
#   VERSION.dev   → tag for english_backend_dev / english_frontend_dev
#   VERSION.prod  → tag for english_db_content / english_backend / english_frontend
#
# (db is "prod-bound" content: it's shared by both targets, so a dev
# host always reads db's tag from VERSION.prod.)
#
# Subcommands:
#   show                  Print VERSION.dev / VERSION.prod.
#   dev  [X.Y.Z]          Bump VERSION.dev (if X.Y.Z given) + build +
#                         push the dev app images.
#   prod [X.Y.Z]          Bump VERSION.prod (if X.Y.Z given) + bake +
#                         push the content-baked db image + build + push the prod
#                         app images.
#   -h | help             Show usage.
#
# Flags (apply to dev / prod):
#   -y | --yes            Skip the bump-confirmation prompt.
#
# X.Y.Z is optional: omit it to publish the current VERSION without
# bumping. Pass a new version to bump first.
#
# Local vs remote:
#   - DOCKER_REGISTRY unset  → "local" mode: builds images, leaves them
#                              local, no push.
#   - DOCKER_REGISTRY=ns     → "remote" mode: builds + tags + pushes to
#                              that namespace. Set it in the shell:
#                                export DOCKER_REGISTRY=docker.io/you
#                                ./scripts/release.sh dev v0.3.0
#                              Or commit it to ./REGISTRY at the repo root
#                              (see REGISTRY file header for the rationale —
#                              shared project config, not a personal secret).
#
# Architecture notes:
#   - `dev` touches ONLY the dev app images. The content-baked db image is prod-bound
#     and reads VERSION.prod; if you want dev to see new content, bump
#     prod first (or just push a new db with VERSION.prod).
#   - `prod` includes the db bake. That step needs .env.db, so `prod`
#     must run on the CMS host (or a single-machine CMS+prod setup).
#     On a dedicated prod target host without .env.db, run
#     scripts/ops/content/bake_image.sh on the CMS host first, then run
#     scripts/ops/prod-host/build_image.sh + push_image.sh on the prod
#     host.
#   - For multi-machine deployments, run each subcommand on its
#     respective host. The script is self-contained per host.
#
# Examples:
#   scripts/release.sh show
#   scripts/release.sh dev v0.3.0                    # bump + build + push
#   scripts/release.sh dev v0.3.0 -y                 # skip bump prompt
#   scripts/release.sh prod                          # re-publish current VERSION.prod
#   IMAGE_TAG=v0.3.0 ./scripts/release.sh dev        # env override (belt-and-braces)
#
# Requires: shell + git + docker. NO python.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib.sh"

VERSION_DEV="VERSION.dev"
VERSION_PROD="VERSION.prod"
YES=0

# Resolve DOCKER_REGISTRY once at startup. The chain is:
#   shell env > ./REGISTRY file > detect_default_registry() (auto-detect).
# publish_one() later checks $DOCKER_REGISTRY to decide push vs local-only.
resolve_docker_registry
if [ -n "$DOCKER_REGISTRY" ]; then
    info "DOCKER_REGISTRY=$DOCKER_REGISTRY (push mode)"
else
    info "DOCKER_REGISTRY 未设置 (local-only mode — 只 build, 不 push)"
fi

# ---------------------------------------------------------------------------
# Tiny arg helpers
# ---------------------------------------------------------------------------
usage() {
    cat <<EOF
用法: $0 <command> [X.Y.Z] [-y]

命令:
  show                打印当前 VERSION.dev / VERSION.prod
  dev  [X.Y.Z]        bump VERSION.dev (如指定) + build + push dev 应用镜像
  prod [X.Y.Z]        bump VERSION.prod (如指定) + bake + push db + build + push prod 应用镜像
  -h | help           显示帮助

Flags:
  -y | --yes          跳过 bump 确认提示

版本号可选: 不传 = 用当前 VERSION 文件 (不 bump, 仅 publish)

环境:
  DOCKER_REGISTRY     留空 = 本地模式 (只 build, 不 push)
                      设置 = remote 模式 (build + tag + push 到该 namespace)
                      解析顺序: shell env > ./REGISTRY 文件 > 自动检测 (docker.io/$USER)

示例:
  $0 show
  $0 dev  v0.3.0                    # dev 流: bump + build + push
  $0 prod v0.3.0 -y                 # prod 流: bump + bake db + push + build prod + push
  $0 dev                            # 不 bump, 只 publish 当前 VERSION.dev

架构前提:
  - dev  不动 content-baked db image (db 用 VERSION.prod)
  - prod 含 db bake — 需要 .env.db,必须在 CMS 主机跑(或单机的 CMS+prod)
  - 多机部署: 在各自主机上跑对应的 subcommand
EOF
}

# Pull -y off the arg list (it's allowed anywhere after the subcommand).
extract_yes_flag() {
    local out=()
    while [ $# -gt 0 ]; do
        case "$1" in
            -y|--yes) YES=1; shift ;;
            *) out+=("$1"); shift ;;
        esac
    done
    if [ ${#out[@]} -gt 0 ]; then
        printf '%s\n' "${out[@]}"
    fi
}

# confirm_bump — interactive y/N. No-op if YES=1 or stdin isn't a TTY
# (CI / piped input).
confirm_bump() {
    if [ "$YES" = "1" ] || [ ! -t 0 ]; then
        return 0
    fi
    read -p "确认 bump? [y/N] " ans
    case "$ans" in
        [Yy]|[Yy][Ee][Ss]) return 0 ;;
        *) return 1 ;;
    esac
}

# write + git-commit (best-effort). Caller passes which files were touched.
write_version_file() {
    local path="$1" new="$2"
    printf '%s\n' "$new" > "$path"
}

git_commit_touched() {
    local touched_dev="$1" touched_prod="$2" new="$3"
    if ! git rev-parse --git-dir >/dev/null 2>&1; then
        warn "不是 git 仓库 — VERSION 已写盘, 自己 commit"
        return 0
    fi
    local files=() msg
    [ "$touched_dev" = "1" ]  && files+=("$VERSION_DEV")
    [ "$touched_prod" = "1" ] && files+=("$VERSION_PROD")
    [ ${#files[@]} -eq 0 ] && return 0

    if [ "$touched_dev" = "1" ] && [ "$touched_prod" = "1" ]; then
        msg="release: bump all to $new"
    elif [ "$touched_dev" = "1" ]; then
        msg="release: bump dev to $new"
    else
        msg="release: bump prod to $new"
    fi
    git add "${files[@]}"
    if git commit -m "$msg" >/dev/null 2>&1; then
        ok "已 commit: $msg"
    else
        warn "git commit 失败 (没有 git user? 手动处理)"
    fi
}

# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------

cmd_show() {
    local dev_v prod_v
    dev_v="$(read_version_file "$VERSION_DEV")"
    prod_v="$(read_version_file "$VERSION_PROD")"
    info "VERSION.dev  = $dev_v"
    info "VERSION.prod = $prod_v"
}

# prepare_version <path> <label> <requested> → echoes the resolved tag.
# Side effects:
#   - writes new value to <path> if requested != current (after confirm)
#   - sets RELEASEd_BUMP=1 if a bump happened, 0 otherwise
# Log messages go to stderr so the function's stdout is JUST the tag
# (callers do `tag="$(prepare_version ...)"`).
prepare_version() {
    local path="$1" label="$2" requested="$3"
    local current
    current="$(read_version_file "$path")"
    if [ -z "$requested" ]; then
        info "$label = $current (publish only, no bump)" >&2
        RELEASEd_BUMP=0
        printf '%s' "$current"
        return 0
    fi
    if [ "$current" = "$requested" ]; then
        info "$label 已经是 $requested (无 bump, 直接 publish)" >&2
        RELEASEd_BUMP=0
        printf '%s' "$requested"
        return 0
    fi
    info "当前 $label: $current" >&2
    info "新   $label: $requested" >&2
    if ! confirm_bump; then
        info "已取消" >&2
        exit 0
    fi
    write_version_file "$path" "$requested"
    ok "$label: $current → $requested" >&2
    RELEASEd_BUMP=1
    printf '%s' "$requested"
}

# run_step <description> <command...> — invoke a sub-script; propagate failure.
run_step() {
    local desc="$1"; shift
    info "[step] $desc"
    if ! "$@"; then
        err "[step] 失败: $desc"
        err "  command: $*"
        exit 1
    fi
    ok "[step] ok: $desc"
}

# publish_one <role> <build_script> <push_script> <tag>
#   role        — "dev app" / "prod app" / "db" (just for logging)
#   build_script — scripts/ops/<host>/build_image.sh
#   push_script  — scripts/ops/<host>/push_image.sh (or empty to skip)
#   tag          — IMAGE_TAG value
publish_one() {
    local role="$1" build="$2" push="$3" tag="$4"
    IMAGE_TAG="$tag" run_step "build $role (tag=$tag)" "$build"

    if [ -n "${DOCKER_REGISTRY:-}" ]; then
        IMAGE_TAG="$tag" run_step "push $role → $DOCKER_REGISTRY (tag=$tag)" \
            "$push" -y
    else
        info "DOCKER_REGISTRY 未设置 — 跳过 push ($role 留在本地)"
    fi
}

cmd_dev() {
    local requested="$1"
    info "=== release dev ==="
    echo ""

    local tag
    tag="$(prepare_version "$VERSION_DEV" "VERSION.dev" "$requested")"
    local touched_dev=0
    [ "${RELEASEd_BUMP:-0}" = "1" ] && touched_dev=1

    echo ""
    publish_one "dev app images (backend + frontend)" \
        "./scripts/ops/dev-host/build_image.sh" \
        "./scripts/ops/dev-host/push_image.sh" \
        "$tag"

    git_commit_touched "$touched_dev" 0 "$tag"

    echo ""
    ok "release dev done: tag=$tag"
}

cmd_prod() {
    local requested="$1"
    info "=== release prod ==="
    echo ""

    local tag
    tag="$(prepare_version "$VERSION_PROD" "VERSION.prod" "$requested")"
    local touched_prod=0
    [ "${RELEASEd_BUMP:-0}" = "1" ] && touched_prod=1

    echo ""
    # db first — content-baked, must go before the app images in the registry
    # so target hosts pulling by tag get a consistent set.
    publish_one "content-baked db image (content-baked)" \
        "./scripts/ops/content/bake_image.sh" \
        "./scripts/ops/content/push_image.sh" \
        "$tag"

    echo ""
    publish_one "prod app images (backend + frontend)" \
        "./scripts/ops/prod-host/build_image.sh" \
        "./scripts/ops/prod-host/push_image.sh" \
        "$tag"

    git_commit_touched 0 "$touched_prod" "$tag"

    echo ""
    ok "release prod done: tag=$tag"
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
case "${1:-}" in
    show)
        shift
        extract_yes_flag "$@" >/dev/null
        cmd_show
        ;;
    dev)
        shift
        # Extract -y out, leaving the (optional) version as $1.
        local_args="$(extract_yes_flag "$@")"
        # `local_args` may be empty (no version given) or a single token.
        set -- $local_args
        cmd_dev "${1:-}"
        ;;
    prod)
        shift
        local_args="$(extract_yes_flag "$@")"
        set -- $local_args
        cmd_prod "${1:-}"
        ;;
    -h|--help|help)
        usage
        ;;
    "")
        usage
        ;;
    *)
        err "未知命令: $1"
        usage
        exit 1
        ;;
esac