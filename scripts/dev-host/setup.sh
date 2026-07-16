#!/usr/bin/env bash
#
# scripts/dev-host/setup.sh — first-time (or post-reset) bootstrap.
#
# Walks the operator through the image dependency chain so a fresh clone
# is one command away from `./lifecycle.sh start`:
#
#   1. Preflight: docker + compose must be present.
#   2. db image: must be locally present (build reads DB_USER / DB_NAME
#      from its OCI labels — a hard requirement, not a convenience).
#      dev hosts do NOT pull db image from any registry, and do NOT run
#      the CMS pipeline. Instead, if no image is present, we look for
#      cms/staging/ (git-tracked content data — should be present after
#      `git pull`), then run:
#        - db/scripts/import_staging.sh all   (UPSERT staging → staging db)
#        - db/scripts/build.sh                (pg_dump → docker build)
#      with DB_IMAGE_TAG=dev-local so the resulting image doesn't collide
#      with the team's VERSION.prod tag.
#   3. dev app images: call scripts/dev-host/build_image.sh (handles
#      both at once). Skipped if both already present.
#   4. Final summary.
#
# Does NOT create .secrets/, start any containers, push to a registry,
# or invoke the CMS pipeline (sync / sentences / audio).
# Re-run as many times as you want — nothing destructive.
#
# Counterpart to scripts/dev-host/{lifecycle,doctor,logs,migrate,watch}.sh.

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$COMMON_DIR/../.." && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
setup_dev_host_env

cmd_setup() {
    info "=== dev environment setup ==="
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
    if [ $preflight_ok -eq 0 ]; then
        err "preflight 失败 — 修好上面 1-2 项后再跑 setup"
        return 1
    fi
    echo ""

    # 2. content-baked db image — must be present locally for the dev app build.
    #    dev hosts build it locally with DB_IMAGE_TAG=dev-local (no pull,
    #    no registry round-trip). The input is cms/staging/, which is
    #    git-tracked — `git pull` is the staging transmission layer.
    info "Step 1/2: content-baked db image ($DB_FULL_IMAGE)"
    local got_image=0
    if image_exists "$DB_FULL_IMAGE"; then
        ok "  本地已有 $DB_FULL_IMAGE"
        got_image=1
    else
        warn "content-baked db image 不在本地"
        info "  dev 主机不 pull image — 改为本地 build"
        # Check cms/staging/ — the git-tracked content data.
        if [ ! -d "$PROJECT_DIR/cms/staging" ]; then
            err "  cms/staging/ 不存在 — dev 主机需要先有 CMS 内容数据"
            info "    1. git pull (cms/staging/ 已 git tracked)"
            info "    2. 或 rsync cms-host:cms/staging/ cms/staging/"
            return 1
        fi
        # cms/.env — db/scripts/build.sh checks for it. dev hosts don't
        # need real keys (we're not running the CMS pipeline), so scaffold
        # an empty file just to pass build.sh's existence check. The
        # POSTGRES_PASSWORD used at db-init time comes from .secrets/,
        # not cms/.env, so leaving AI/TENCENT keys empty is fine.
        CONTENT_ENV_FILE_PATH="$(resolve_content_env_file)"
        if [ ! -f "$CONTENT_ENV_FILE_PATH" ]; then
            info "  scaffold 一份空 $CONTENT_ENV_FILE_PATH(只过存在性检查,key 留空)"
            touch "$CONTENT_ENV_FILE_PATH"
        fi
        info "  跑 db/scripts/import_staging.sh all (UPSERT staging → staging db)..."
        echo ""
        if "$PROJECT_DIR/db/scripts/import_staging.sh" all; then
            echo ""
            info "  跑 db/scripts/build.sh (本地 build, tag=dev-local)..."
            echo ""
            if DB_IMAGE_TAG=dev-local "$PROJECT_DIR/db/scripts/build.sh"; then
                ok "  本地 bake 完成 (db image tag=dev-local)"
                got_image=1
            else
                err "  db bake 失败 — 看上面错误"
                info "    cms/staging/ 已就位,staging db + import 都已 ok"
                return 1
            fi
        else
            err "  db import 失败 — 看上面错误"
            info "    ./db/scripts/import_staging.sh doctor  # importer preflight"
            return 1
        fi
    fi
    if inspect_db_image_labels; then
        ok "  db.user=$DB_USER  db.name=$DB_NAME  content.version=$DB_VERSION"
    else
        warn "  content-baked db image 缺 type-any-language.* label — 重新 bake"
        return 1
    fi
    echo ""

    # 3. dev app images
    info "Step 2/2: dev app images"
    if image_exists "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" && \
       image_exists "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"; then
        ok "  ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 已存在"
        ok "  ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 已存在"
        info "  (要 rebuild? 跑: scripts/dev-host/build_image.sh)"
    else
        info "  调 scripts/dev-host/build_image.sh..."
        echo ""
        if "$COMMON_DIR/build_image.sh"; then
            echo ""
            ok "  build done"
        else
            err "  build 失败 — 见上面的错误"
            return 1
        fi
    fi
    echo ""

    # 4. Final summary
    ok "=== setup 完成 ==="
    info "  下一步: ./scripts/dev-host/lifecycle.sh start"
    info "  启动后访问:"
    info "    前端: http://localhost:3000"
    info "    后端: http://localhost:8000  (API 文档: /docs)"
}

cmd_setup
