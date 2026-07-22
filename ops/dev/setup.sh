#!/usr/bin/env bash
#
# ops/dev/setup.sh — first-time (or post-reset) bootstrap.
#
# Walks the operator through the image dependency chain so a fresh clone
# is one command away from `./lifecycle.sh start`:
#
#   1. Preflight: docker + compose must be present.
#   2. db image: must be locally present (build reads DB_USER / DB_NAME
#      from its OCI labels — a hard requirement, not a convenience).
#      By default dev hosts do NOT pull the db image from any registry,
#      and do NOT run the CMS pipeline. Instead, if no image is present,
#      we look for cms/staging/ (git-tracked content data — should be
#      present after `git pull`), then run:
#        - db/scripts/import_staging.sh all   (UPSERT staging → staging db)
#        - db/scripts/build.sh                (pg_dump → docker build)
#      with DB_IMAGE=english_db_content_dev DB_IMAGE_TAG=<db/VERSION>
#      so the resulting image uses the dev-specific name (the prod-bound
#      `english_db_content` is reserved for CMS-host bakes that ship
#      to prod targets). The tag is the same per-segment version
#      (e.g. v0.1.0) — the name suffix carries the dev/prod distinction.
#   3. dev app images: call ops/dev/build_image.sh (handles
#      both at once). Skipped if both already present.
#   4. Final summary.
#
# Subcommands:
#   (default)   legacy bootstrap path described above. No CMS re-run.
#   content     on-demand: re-import staging files + rebake the dev
#               db image + restart the dev containers. Used after
#               git pull brings fresh cms/staging/ content. Does NOT call
#               the CMS pipeline — dev hosts treat cms/staging/ as
#               git-tracked read-only input.
#   bootstrap   one-time: first-time setup of per-host credentials in
#               the shared TencentDB instance (cloud-db path). Prompts
#               for the admin DSN, writes .secrets/tencent_db_admin_url
#               (chmod 600), then invokes db/scripts/bootstrap_tencent.sh.
#               Self-hosted postgres users don't need this — skip.
#               the CMS pipeline — dev hosts treat cms/staging/ as
#               git-tracked read-only input.
#
# Does NOT create .secrets/ (the legacy default), start any containers,
# push to a registry, or invoke the CMS pipeline (vocab / sentences /
# audio). Re-run `setup` as many times as you want — nothing destructive.
#
# Counterpart to ops/dev/{lifecycle,doctor,logs,migrate,watch}.sh.

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$COMMON_DIR/../.." && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
setup_dev_host_env

cmd_setup() {
    # Legacy bootstrap (image pull OR build-from-staging fallback, then
    # build dev app images). Body unchanged — preserved verbatim across
    # the introduction of the `content` subcommand. Triggered by either
    # `./setup.sh` (no args) or `./setup.sh setup`.
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
    # dev hosts build it locally as english_db_content_dev:<db/VERSION>
    # (no pull, no registry round-trip — the prod-bound `english_db_content`
    # is reserved for CMS-host bakes that ship to prod targets). The input
    # is cms/staging/, which is git-tracked — `git pull` is the staging
    # transmission layer.
    info "Step 1/2: content-baked db image ($DB_FULL_IMAGE)"
    local got_image=0
    if image_exists "$DB_FULL_IMAGE"; then
        # Image present — but is it FRESH? Compare the image's
        # content.version label (set by db/scripts/build.sh from
        # db/VERSION at bake time) against the current db/VERSION. If
        # they diverge, the image is stale and must be rebaked before
        # the dev app builds against it.
        if inspect_db_image_labels; then
            ok "  本地已有 $DB_FULL_IMAGE"
            local expected_db_version
            expected_db_version="$(read_version_file db/VERSION)"
            if [ "$DB_VERSION" = "$expected_db_version" ]; then
                ok "  db image content.version 跟 db/VERSION 对齐 ($DB_VERSION)"
                got_image=1
            else
                warn "  db image content.version=$DB_VERSION, db/VERSION=$expected_db_version — image 已落后,需要 rebake"
                info "    下面会自动重跑 import + build;或者手动:"
                info "      DB_IMAGE=english_db_content_dev DB_IMAGE_TAG=$expected_db_version ./db/scripts/build.sh"
                got_image=0
            fi
        else
            warn "  content-baked db image 缺 type-any-language.* label — 重新 bake"
            got_image=0
        fi
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
        # db/scripts/build.sh now uses db-side shell defaults and .secrets;
        # no CMS env file is needed on a dev target host.
        info "  跑 db/scripts/import_staging.sh all (UPSERT staging → staging db)..."
        echo ""
        if "$PROJECT_DIR/db/scripts/import_staging.sh" all; then
            echo ""
            info "  跑 db/scripts/build.sh (本地 build, image=english_db_content_dev:$(read_version_file db/VERSION))..."
            echo ""
            if DB_IMAGE=english_db_content_dev DB_IMAGE_TAG="$(read_version_file db/VERSION)" "$PROJECT_DIR/db/scripts/build.sh"; then
                ok "  本地 bake 完成 (db image=english_db_content_dev:$(read_version_file db/VERSION))"
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
    echo ""

    # Re-check label health after the bake / re-bake branch — the
    # image we now have should carry the labels the rest of the dev
    # scripts (build_image.sh, write_secrets) depend on.
    if inspect_db_image_labels; then
        ok "  db.user=$DB_USER  db.name=$DB_NAME  content.version=$DB_VERSION"
    else
        err "  content-baked db image 缺 type-any-language.* label — bake 可能失败"
        info "    再跑一次 ./db/scripts/build.sh 看错误"
        return 1
    fi
    echo ""

    # 3. dev app images
    info "Step 2/2: dev app images"
    if image_exists "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" && \
       image_exists "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"; then
        ok "  ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 已存在"
        ok "  ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 已存在"
        info "  (要 rebuild? 跑: ops/dev/build_image.sh)"
    else
        info "  调 ops/dev/build_image.sh..."
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
    info "  下一步: ./ops/dev/lifecycle.sh start"
    info "  启动后访问:"
    info "    前端: http://localhost:3000"
    info "    后端: http://localhost:8000  (API 文档: /docs)"
}

# ---------------------------------------------------------------------------
# `content` subcommand — on-demand import+bake+restart for the dev host.
#
# Reuses the same proven import+bake chain as the legacy fallback path in
# cmd_setup (lines 96-132 of the legacy structure), but as an explicit,
# operator-invokable command. Used after `git pull` brings fresh
# cms/staging/ content into the repo — turns it into a freshly baked
# english_db_content_dev:<db/VERSION> image (e.g. english_db_content_dev:v0.1.0)
# and restarts the dev containers so the new image is picked up
# immediately.
#
# Does NOT call the CMS pipeline (vocab/sentences/audio). Dev hosts treat
# cms/staging/ as git-tracked read-only input — re-running CMS stages
# there would require a CMS host.
# ---------------------------------------------------------------------------

# cmd_content_preflight — soft checks before import+bake+restart. Print
# hints for missing prerequisites but do NOT hard-fail: an operator may
# legitimately want to bake an empty image (e.g. they're clearing vocab
# libs as part of a reset). The import + bake sub-scripts do their own
# hard checks.
cmd_content_preflight() {
    # Dev hosts do NOT run the CMS pipeline — they read cms/staging/
    # (git-tracked) and hand the files to db/scripts/build.sh's importer.
    # All required credentials come from the process env (typically
    # `eval "$(scripts/secrets/fetch_secrets.sh eval-db)"`) or from
    # .secrets/postgres_password written by ops/dev/lifecycle.sh first start.
    if [ -n "${DATABASE_URL:-}" ] || [ -n "${POSTGRES_PASSWORD:-}" ] || \
       [ -f "$PROJECT_DIR/.secrets/postgres_password" ]; then
        ok "  db 凭据已就绪 (env 或 .secrets/postgres_password)"
    else
        info "  没看到 DATABASE_URL / POSTGRES_PASSWORD / .secrets/postgres_password"
        info "    → eval \"\$(scripts/secrets/fetch_secrets.sh eval-db)\""
        info "    → 或先跑 ./ops/dev/lifecycle.sh start 生成 .secrets/postgres_password"
    fi

    if [ -d "$PROJECT_DIR/cms/staging" ]; then
        ok "  cms/staging/ 存在"
    else
        warn "  cms/staging/ 不存在 — import 会跑空,新 image 将是 empty content"
        info "    → git pull (cms/staging/ 是 git-tracked)"
        info "    → 或 rsync cms-host:cms/staging/ cms/staging/"
    fi
}

cmd_content() {
    info "=== dev content pipeline (on-demand, import+bake+restart) ==="
    echo ""

    # Step 0a: resolve $DOCKER_COMPOSE_CMD. setup.sh's bootstrap path
    # resolves it lazily inside cmd_setup (during the docker
    # preflight), but cmd_content is reached directly through the
    # case dispatcher and never runs that preflight — so resolve it
    # here explicitly. Same call lifecycle.sh uses via
    # gate_preflight → require_docker → detect_compose_cmd.
    detect_compose_cmd

    # Step 0b: ensure DB_USER / DB_NAME are populated for write_secrets.
    # Reuse the code defaults (english_user / english_learning) if no
    # content-baked db image is present yet — matches the shell-side
    # defaults build.sh uses when no POSTGRES_USER / POSTGRES_DB is in
    # env (cms/.env is gone; defaults are in code).
    if ! inspect_db_image_labels; then
        warn "  本地尚无 content-baked db image — 假定 DB_USER/DB_NAME 用代码默认值"
        DB_USER="${DB_USER:-english_user}"
        DB_NAME="${DB_NAME:-english_learning}"
        export DB_USER DB_NAME
    fi

    # Step 1: write_secrets generates .secrets/postgres_password if absent
    # (idempotent — reuses an existing one from a prior lifecycle.sh
    # start). Required by the next two steps: source_db.sh ensure calls
    # db_resolve_password (ops/lib.sh:546-557), and build.sh needs the
    # password to talk to the staging db during the pg_dump snapshot.
    info "Step 1/3: write_secrets (idempotent)"
    write_secrets || return 1
    echo ""

    # Step 2: source_db ensure → import_staging.sh all → build.sh
    # (image=english_db_content_dev:<db/VERSION>, e.g. english_db_content_dev:v0.1.0).
    # Same chain as the legacy fallback in cmd_setup's image-missing
    # branch — just hoisted into a callable subcommand.
    info "Step 2/3: import + bake (image=english_db_content_dev:$(read_version_file db/VERSION))"
    cmd_content_preflight || true        # preflight only warns, never fails
    "$PROJECT_DIR/db/scripts/source_db.sh" ensure || return 1
    "$PROJECT_DIR/db/scripts/import_staging.sh" all || return 1
    if ! DB_IMAGE=english_db_content_dev DB_IMAGE_TAG="$(read_version_file db/VERSION)" "$PROJECT_DIR/db/scripts/build.sh"; then
        err "  bake 失败 — 看上方日志"
        return 1
    fi
    echo ""

    # Step 3: refresh the dev stack against the new image.
    #   - db: `lifecycle.sh restart` only recreates backend+frontend, so
    #     a freshly baked english_db_content_dev db image would not get picked up.
    #     Recreate the db container here explicitly.
    #   - backend + frontend: defer to `lifecycle.sh restart` (single
    #     source of truth for the recreate+restart dance; also
    #     re-reads .secrets in case the password file changed).
    info "Step 3/3: restart dev stack to pick up new image"
    if "$COMMON_DIR/lifecycle.sh" restart; then
        ok "  backend + frontend 已重启"
    else
        warn "  backend/frontend restart 失败 — 手动跑: ./ops/dev/lifecycle.sh restart"
        return 1
    fi
    # Now swap the db container to the freshly-baked image. Separate
    # step because `lifecycle.sh restart` deliberately doesn't touch
    # the db (it assumes the db image is stable across restarts; only
    # the bake pipeline changes it).
    local _compose_file="$PROJECT_DIR/docker-compose.dev.yml"
    local _recreate_log
    if _recreate_log="$("$DOCKER_COMPOSE_CMD" -f "$_compose_file" up -d --force-recreate --no-deps --pull=never db 2>&1)"; then
        printf '%s\n' "$_recreate_log" | tail -5
        ok "  db 容器已用新 image 重建 (english_db_content_dev:$(read_version_file db/VERSION))"
    else
        printf '%s\n' "$_recreate_log" | tail -5
        warn "  db recreate 失败 — 手动跑: docker compose -f docker-compose.dev.yml up -d --force-recreate db"
        return 1
    fi
    echo ""

    ok "=== content pipeline 完成 ==="
    info "  验证:打开任一词库 UI,不应再有 '暂无可练习的句子'"
    info "    curl -s 'http://localhost:8000/api/sentences?lib_id=<id>' | head"
}

# ---------------------------------------------------------------------------
# cmd_bootstrap — first-time cloud-db (TencentDB) setup.
#
# Only meaningful for hosts that point at the shared TencentDB
# instance. Self-hosted postgres users (the `setup` / `content`
# subcommands) do NOT need this.
#
# Steps:
#   1. Resolve admin DSN — either from --admin-url=, TENCENT_DB_ADMIN_URL
#      env (typical GH Secrets path), or interactive prompt.
#   2. Persist it to .secrets/tencent_db_admin_url (chmod 600, gitignored).
#      bootstrap_tencent.sh reads it via resolve_admin_url() and uses
#      it to CREATE ROLE / DATABASE / GRANT on the shared instance.
#   3. Invoke db/scripts/bootstrap_tencent.sh, which:
#      - resolves role password (env TENCENT_DB_PASSWORD > .secrets/
#        tencent_db_password, generated if missing)
#      - computes db name from git state (master → no suffix;
#        feature branch → ...__<sanitized branch or short SHA>)
#      - renders .secrets/database_url (consumed by docker-compose
#        *_FILE indirection)
#
# After cmd_bootstrap, ops/{dev,prod}/lifecycle.sh start can use
# .secrets/database_url (or DATABASE_URL env / .secrets/postgres_password)
# to talk to the cloud db.
#
# Idempotency: re-running with an existing .secrets/tencent_db_admin_url
# is safe (the file is read but not overwritten). bootstrap_tencent.sh
# itself is idempotent end-to-end (CREATE ROLE / DATABASE have IF NOT
# EXISTS guards, GRANT is idempotent).
# ---------------------------------------------------------------------------
cmd_bootstrap() {
    info "=== dev host: cloud-db (TencentDB) bootstrap ==="
    echo ""

    # Pre-flight: psql + python3 are required by bootstrap_tencent.sh
    # (psql for DDL, python3 for url-encoding + db-name sanitization).
    if ! command -v psql &> /dev/null; then
        err "psql 未安装 — TencentDB bootstrap 需要 postgresql-client"
        info "  → Ubuntu/Debian:  sudo apt install postgresql-client"
        info "  → macOS:          brew install postgresql-client"
        info "  → Windows:        使用 stack-postgres 或 WSL"
        return 1
    fi
    if ! command -v python3 &> /dev/null; then
        err "python3 未安装 — bootstrap_tencent.sh 需要它做 url-encode"
        return 1
    fi
    ok "  psql:    $(psql --version 2>&1 | head -1)"
    ok "  python3: $(python3 --version 2>&1 | head -1)"
    echo ""

    # Step 1: resolve admin DSN.
    local admin_url=""
    # CLI flag (rare — for non-interactive testing) or env (GH Secrets path).
    while [ $# -gt 0 ]; do
        case "$1" in
            --admin-url=*) admin_url="${1#*=}"; shift ;;
            *)             err "未知参数: $1"; return 1 ;;
        esac
    done
    if [ -z "$admin_url" ] && [ -n "${TENCENT_DB_ADMIN_URL:-}" ]; then
        admin_url="$TENCENT_DB_ADMIN_URL"
        info "  admin URL from TENCENT_DB_ADMIN_URL env (GH Secrets path)"
    fi

    # Persisted file wins only when no fresh input — if the operator
    # explicitly provided a new URL via flag/env, overwrite.
    local admin_url_file="$PROJECT_DIR/.secrets/tencent_db_admin_url"
    if [ -z "$admin_url" ] && [ -f "$admin_url_file" ] && \
       [ -n "$(awk 'NR==1' "$admin_url_file" 2>/dev/null)" ]; then
        admin_url="$(awk 'NR==1' "$admin_url_file")"
        info "  admin URL from existing $admin_url_file (rerun safe)"
    fi

    if [ -z "$admin_url" ]; then
        echo ""
        info "  Need the postgres:// admin DSN for the shared TencentDB."
        info "  Get it once from the TencentDB console (database > manage"
        info "  > account management), then paste here. After this run"
        info "  it's stored in $admin_url_file (chmod 600) and bootstrap_tencent.sh"
        info "  uses it to CREATE ROLE / DATABASE / GRANT."
        info ""
        info "  快捷通道(GH Secrets): export TENCENT_DB_ADMIN_URL=postgres://... 再重跑本命令"
        echo ""
        read -rs -p "  admin DSN (postgres://...; 不会回显): " admin_url
        echo ""
        if [ -z "$admin_url" ]; then
            err "  admin DSN 为空 — 退出"
            return 1
        fi
        # Sanity check — must look like a postgres DSN.
        if ! [[ "$admin_url" =~ ^postgres(ql)?:// ]]; then
            err "  DSN 格式不像 postgres:// — 退出"
            return 1
        fi
    fi
    echo ""

    # Step 2: persist admin URL.
    mkdir -p "$PROJECT_DIR/.secrets"
    chmod 700 "$PROJECT_DIR/.secrets"
    # Write atomically — write to temp, then move. Avoids half-written
    # file if interrupted (the file is chmod 600 by post-condition).
    local tmp_admin
    tmp_admin="$(mktemp "$PROJECT_DIR/.secrets/.tencent_db_admin_url.XXXXXX")"
    chmod 600 "$tmp_admin"
    printf '%s\n' "$admin_url" > "$tmp_admin"
    mv "$tmp_admin" "$admin_url_file"
    chmod 600 "$admin_url_file"
    ok "  wrote $admin_url_file (chmod 600)"
    echo ""

    # Step 3: hand off to bootstrap_tencent.sh. That script:
    #   - parses the admin DSN to extract host:port (TENCENT_DB_HOST)
    #   - resolves role password (env > file > abort with hint)
    #   - CREATE ROLE english_dev_${USER} LOGIN PASSWORD '...' (idempotent)
    #   - renders db name from render_db_name() (master → no suffix;
    #     feature branch → ...__<sanitized branch or short SHA>)
    #   - CREATE DATABASE (idempotent)
    #   - GRANT ALL on db + schema public (idempotent)
    #   - writes .secrets/database_url (chmod 600) for compose *_FILE
    #   - persists db name to .dev/dev-db-name for cross-restart reuse
    #
    # We pass tier=dev explicitly so the script picks the dev helpers
    # (english_dev_${USER}); prod setup.sh passes tier=prod.
    info "  invoke db/scripts/bootstrap_tencent.sh (tier=dev)..."
    echo ""
    if ! OPS_TIER=dev "$PROJECT_DIR/db/scripts/bootstrap_tencent.sh"; then
        err "  bootstrap_tencent.sh 失败 — 看上方错误"
        info "  注:admin URL 已在 $admin_url_file,直接重跑可复用"
        return 1
    fi
    echo ""

    ok "=== cloud-db bootstrap 完成 ==="
    info "  接下来:"
    info "    eval \"\$(./scripts/secrets/fetch_secrets.sh eval-db)\"   # 注入 DATABASE_URL 到当前 shell"
    info "    ./ops/dev/lifecycle.sh start                            # 起容器,会自动用 .secrets/database_url"
    return 0
}

# ---------------------------------------------------------------------------
# usage + dispatcher
# ---------------------------------------------------------------------------

usage() {
    cat <<EOF
用法: $0 <command>

命令:
  (default) | setup    Legacy bootstrap path: ensure db image locally
                        (build-from-cms/staging if missing) +
                        build dev app images. No CMS re-run.
  content              On-demand content bake: import staging files +
                        bake english_db_content_dev:<db/VERSION> +
                        restart dev containers. Use after 'git pull'
                        brings fresh cms/staging/ content. Does NOT
                        call cms/run.sh.
  bootstrap            One-time cloud-db (TencentDB) setup. Prompts
                        for the admin DSN, writes
                        .secrets/tencent_db_admin_url (chmod 600),
                        invokes db/scripts/bootstrap_tencent.sh to
                        CREATE ROLE / DATABASE / GRANT. Only needed
                        for hosts using cloud-db — self-hosted
                        postgres users skip this.
  -h|--help|help       Show this help.

典型工作流:
  ./ops/dev/setup.sh                    # 首次 bootstrap (self-host)
  # 或 cloud-db 主机:
  ./ops/dev/setup.sh bootstrap          # 一次性 cloud-db setup
  # ...改 CSVs 后 commit,git pull 到 dev 主机...
  ./ops/dev/setup.sh content            # on-demand: rebake + restart
  ./ops/dev/lifecycle.sh start         # 日常起容器
EOF
}

case "${1:-}" in
    ""|setup)               cmd_setup ;;
    content)                cmd_content ;;
    bootstrap)              shift; cmd_bootstrap "$@" ;;
    -h|--help|help)         usage ;;
    *)                      { err "未知命令: $1"; usage; } >&2; exit 1 ;;
esac
