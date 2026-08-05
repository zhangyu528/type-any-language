#!/bin/bash
#
# ops/prod/release.sh — the "release" orchestrator (build + push prod images).
#
# This is the artifact-release step. It produces a new release of the prod
# image set (db + backend + frontend, all tagged with the same vX.Y.Z)
# and pushes it to the registry. It does NOT deploy / go-live / roll
# out to users. The actual deployment is ops/prod/deploy.sh (which wraps
# lifecycle.sh restart) — see that script for the "go live" step.
#
# Naming history: this script was previously called publish.sh. After
# the release-vs-publish distinction was clarified (release = artifact,
# publish = go-live), the script was renamed back to release.sh to
# align with the workflow name (release-prod.yml) and the job name
# (release). The technical action inside (docker push to registry) is
# still called "publish" — the leaf tool at ops/prod/build/push.sh.
#
# This script does:
#   1. Bump backend/VERSION + frontend/VERSION + db/VERSION (if vX.Y.Z given)
#   2. Run build.sh to build the 3 prod images
#   3. Run build/push.sh to tag + push the 3 images to DOCKER_REGISTRY
#   4. (Optional) git commit the VERSION bumps
#
# Each segment owns one VERSION file (no dev/prod split — single file
# gates the **prod** image tag for that segment):
#
#   cms/VERSION           ← placeholder (cms has no docker image today;
#                            reserved for a future CMS pipeline version
#                            stamp — no reader wired to this file today)
#   backend/VERSION       ← english_backend (prod only)
#   frontend/VERSION      ← english_frontend (prod only)
#
# Bumping backend/VERSION releases a new english_backend at the
# chosen tag; same for frontend/VERSION.
#
# The runtime database is docker postgres — there is no db image in
# the release pipeline. Content goes straight from cms/content/ into
# the db via db/scripts/import_staging.sh (run on the CMS host,
# separately from this release script). Prod hosts only need the
# backend + frontend images. Dev hosts have no docker images at all
# (host-native loop; see ops/dev/native.sh).
#
# Subcommands:
#   show                  Print per-segment VERSION files.
#   prod [X.Y.Z]          Bump backend/VERSION + frontend/VERSION
#                         (if X.Y.Z given) + build + push the prod
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
#                                ./ops/prod/release.sh dev v0.3.0
#                              Or set the GitHub Variable DOCKER_REGISTRY
#                              (single source of truth, see
#                              ops/lib.sh::resolve_docker_registry).
#
# Architecture notes:
#   - `dev` and `prod` both touch the app segments' VERSION files
#     (backend/VERSION + frontend/VERSION). Layer 3 also bumps
#     db/VERSION (the db image is built with the same tag as backend
#     and frontend — one publish = one release set of 3 images).
#   - For multi-machine deployments, run each subcommand on its
#     respective host. The script is self-contained per host.
#
# Examples:
#   ops/prod/release.sh show
#   ops/prod/release.sh prod                           # re-publish current prod versions
#   ops/prod/release.sh prod v0.3.0 -y                 # bump + build + push prod
#
# Requires: shell + git + docker. NO python.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib.sh"

# Each release stream touches its own set of per-segment VERSION files.
# One file per segment, gating prod image tags only:
#   backend/VERSION  → english_backend:vX.Y.Z
#   frontend/VERSION → english_frontend:vX.Y.Z
#   db/VERSION       → english_db:vX.Y.Z  (custom image, has cms/content/ baked in)
# All 3 share the same tag per release (one publish = one release set).
PROD_VERSION_PATHS=(backend/VERSION frontend/VERSION db/VERSION)
ALL_VERSION_PATHS=(cms/VERSION backend/VERSION frontend/VERSION db/VERSION)
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
  show                打印 3 个 per-segment VERSION 文件
  prod [X.Y.Z]        bump backend/VERSION + frontend/VERSION (如指定)
                      + build + push prod 应用镜像
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
  $0 prod     v0.3.0 -y         # prod 流: bump + build + push

架构前提:
  - 不动 db — runtime db 是 docker postgres,没有 image 要 release。Content 用
    db/scripts/import_staging.sh 直接 UPSERT 到 db(在 CMS 主机上,跟
    release 脚本独立)。
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

# git_commit_touched <label> <new_tag> <paths...>
#   label    — "dev" / "prod" (just for the commit message)
#   new_tag  — the tag being committed (also for the commit message)
#   paths... — one or more VERSION file paths to git add
# All paths are added in one commit. No-op if paths is empty.
git_commit_touched() {
    local label="$1" new_tag="$2"
    shift 2
    if ! git rev-parse --git-dir >/dev/null 2>&1; then
        warn "不是 git 仓库 — VERSION 已写盘, 自己 commit"
        return 0
    fi
    local paths=("$@")
    [ ${#paths[@]} -eq 0 ] && return 0

    local msg="release: bump $label to $new_tag"
    git add "${paths[@]}"
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
    info "cms/VERSION      = $(read_version_file cms/VERSION)  (placeholder — no image)"
    info "backend/VERSION  = $(read_version_file backend/VERSION)  (gates prod image tag)"
    info "frontend/VERSION = $(read_version_file frontend/VERSION) (gates prod image tag)"
}

# prepare_version <label> <path> <requested> → echoes the resolved tag.
# Side effects:
#   - writes new value to <path> if requested != current (after confirm)
#   - sets RELEASEd_BUMP=1 if a bump happened, 0 otherwise
# Log messages go to stderr so the function's stdout is JUST the tag
# (callers do `tag="$(prepare_version ...)"`).
#
# <label> is shown in log lines so the caller can pass a per-file label
# like "backend/VERSION" when bumping multiple files in a stream.
prepare_version() {
    local label="$1" path="$2" requested="$3"
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

# bump_stream_paths <stream_label> <requested> <paths...>
#   Bumps every <path> in <paths...> to <requested> (same tag applied to all).
#   Echoes the resolved tag (the resolved value, post-bump — same as input
#   when there was a bump, or current when there wasn't).
#   Sets RELEASEd_BUMP=1 if ANY path actually changed; 0 otherwise.
#   Skips the bump confirmation prompt per-path — one prompt at the top
#   would be ideal but this function is called once per stream with all
#   paths at once, so the prompt is intentionally per-file for clarity
#   (operator sees exactly what they're agreeing to).
bump_stream_paths() {
    local label="$1" requested="$2"
    shift 2
    local paths=("$@")
    local tag=""
    local any_bump=0
    local p
    for p in "${paths[@]}"; do
        local sub_tag
        sub_tag="$(prepare_version "$p" "$p" "$requested")"
        if [ -z "$tag" ]; then tag="$sub_tag"; fi
        if [ "${RELEASEd_BUMP:-0}" = "1" ]; then any_bump=1; fi
    done
    RELEASEd_BUMP=$any_bump
    printf '%s' "$tag"
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
#   role        — "dev app" / "prod app" (just for logging)
#   build_script — ops/<host>/build_image.sh
#   push_script  — ops/<host>/push_image.sh (or empty to skip)
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

cmd_prod() {
    local requested="$1"
    info "=== release prod ==="
    echo ""

    local tag
    tag="$(bump_stream_paths "prod" "$requested" "${PROD_VERSION_PATHS[@]}")"
    local touched_prod=0
    [ "${RELEASEd_BUMP:-0}" = "1" ] && touched_prod=1

    echo ""
    publish_one "prod release set (db + backend + frontend — all tagged $tag)" \
        "./ops/prod/build/image.sh" \
        "./ops/prod/build/push.sh" \
        "$tag"

    if [ "$touched_prod" = "1" ]; then
        git_commit_touched "prod" "$tag" "${PROD_VERSION_PATHS[@]}"
    fi

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