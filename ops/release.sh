#!/bin/bash
#
# ops/release.sh — bump + build + push a project version.
#
# Each segment owns one VERSION file (no dev/prod split — single file
# gates both the dev and prod image tags for that segment):
#
#   db/VERSION            ← english_db_content (db is prod-bound content
#                            shared by both targets)
#   cms/VERSION           ← placeholder (cms has no docker image today;
#                            reserved for a future CMS pipeline version
#                            stamp — no reader wired to this file today)
#   backend/VERSION       ← english_backend_dev + english_backend
#   frontend/VERSION      ← english_frontend_dev + english_frontend
#
# Bumping backend/VERSION releases a new english_backend_dev AND a new
# english_backend at the same tag; same for frontend/VERSION.
#
# Subcommands:
#   show                  Print all 4 per-segment VERSION files.
#   dev  [X.Y.Z]          Bump backend/VERSION + frontend/VERSION
#                         (if X.Y.Z given) + build the dev app images.
#                         dev never pushes — image lifecycle is local.
#   prod [X.Y.Z]          Bump db/VERSION + backend/VERSION +
#                         frontend/VERSION (if X.Y.Z given) + bake +
#                         push the content-baked db image + build + push
#                         the prod app images.
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
#                                ./ops/release.sh dev v0.3.0
#                              Or commit it to ./REGISTRY at the repo root
#                              (see REGISTRY file header for the rationale —
#                              shared project config, not a personal secret).
#
# Architecture notes:
#   - `dev` touches ONLY the app segments' VERSION files
#     (backend/VERSION + frontend/VERSION). The content-baked db
#     image is prod-bound and reads db/VERSION; if you want dev to see new
#     content, run `prod` first (or just push a new db with db/VERSION).
#   - `prod` includes the db bake. The bake step needs the CMS secrets
#     (AI_*, TENCENT_*, CLOUD_*), which now come from GitHub Environments
#     via `scripts/secrets/fetch_secrets.sh eval-cms` — `prod` therefore
#     must run on a host that has access to the upstream repo's secrets
#     (CMS host, or a single-machine CMS+prod setup). On a dedicated
#     prod target host without secrets access, run db/scripts/build.sh
#     on the CMS host first, then run ops/prod/build_image.sh +
#     push_image.sh on the prod host.
#   - For multi-machine deployments, run each subcommand on its
#     respective host. The script is self-contained per host.
#
# Examples:
#   ops/release.sh show
#   ops/release.sh dev v0.3.0                    # bump backend+frontend dev files + build
#   ops/release.sh dev v0.3.0 -y                 # skip bump prompt
#   ops/release.sh prod                          # re-publish current prod versions
#   IMAGE_TAG=v0.3.0 ./ops/release.sh dev        # env override (belt-and-braces)
#
# Requires: shell + git + docker. NO python.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib.sh"

# Each release stream touches its own set of per-segment VERSION files.
# One file per segment (no dev/prod split): backend/VERSION gates both
# english_backend_dev + english_backend, frontend/VERSION gates both
# english_frontend_dev + english_frontend. dev bumps just the app
# segments (no db — dev never ships a new content-baked db image);
# prod bumps db + backend + frontend in lockstep (same tag applied to
# all three).
#
# ops/release.sh show prints all 4 per-segment files.
DEV_VERSION_PATHS=(backend/VERSION frontend/VERSION)
PROD_VERSION_PATHS=(db/VERSION backend/VERSION frontend/VERSION)
ALL_VERSION_PATHS=(db/VERSION cms/VERSION backend/VERSION frontend/VERSION)
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
  show                打印 4 个 per-segment VERSION 文件
  dev  [X.Y.Z]        bump backend/VERSION + frontend/VERSION (如指定)
                      + build dev 应用镜像
  prod [X.Y.Z]        bump db/VERSION + backend/VERSION + frontend/VERSION
                      (如指定) + bake db + push db + build + push prod 应用镜像
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
  $0 dev  v0.3.0                    # dev 流: bump + build
  $0 prod v0.3.0 -y                 # prod 流: bump + bake db + push + build prod + push
  $0 dev                            # 不 bump, 只 publish 当前 dev VERSION 文件

架构前提:
  - dev  不动 content-baked db image (db 用 db/VERSION)
  - prod 含 db bake — 需要 CMS 密钥(AI_*/TENCENT_*/CLOUD_*),现从 GH Environments
    拉取: eval "$(scripts/secrets/fetch_secrets.sh eval-cms)"。必须能在有 secrets
    权限的机器上跑 (CMS 主机,或单机的 CMS+prod)。无 secrets 权限的 prod target 主机
    请先在 CMS 主机上跑 db/scripts/build.sh,再到 prod 主机跑 push_image.sh。
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
    info "db/VERSION       = $(read_version_file db/VERSION)"
    info "cms/VERSION      = $(read_version_file cms/VERSION)"
    info "backend/VERSION  = $(read_version_file backend/VERSION)"
    info "frontend/VERSION = $(read_version_file frontend/VERSION)"
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
#   role        — "dev app" / "prod app" / "db" (just for logging)
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

cmd_dev() {
    local requested="$1"
    info "=== release dev ==="
    echo ""

    local tag
    tag="$(bump_stream_paths "dev" "$requested" "${DEV_VERSION_PATHS[@]}")"
    local touched_dev=0
    [ "${RELEASEd_BUMP:-0}" = "1" ] && touched_dev=1

    echo ""
    publish_one "dev app images (backend + frontend, local-only — dev never pushes)" \
        "./ops/dev/build_image.sh" \
        "" \
        "$tag"

    if [ "$touched_dev" = "1" ]; then
        git_commit_touched "dev" "$tag" "${DEV_VERSION_PATHS[@]}"
    fi

    echo ""
    ok "release dev done: tag=$tag"
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
    # db first — content-baked, must go before the app images in the registry
    # so target hosts pulling by tag get a consistent set.
    publish_one "content-baked db image (content-baked)" \
        "./db/scripts/build.sh" \
        "./db/scripts/push.sh" \
        "$tag"

    echo ""
    publish_one "prod app images (backend + frontend)" \
        "./ops/prod/build_image.sh" \
        "./ops/prod/push_image.sh" \
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