#!/usr/bin/env bash
#
# dev-host/run.sh — manage DEVELOPMENT container lifecycle.
#
# ─── What this is ─────────────────────────────────────────────────────────
# Runs dev containers with **hot-reload** via two mechanisms:
#
#   Backend  — bind-mounted: ./backend → /app, with `uvicorn --reload`
#              picking up .py changes. Pip deps are baked into the image
#              at build time (backend/Dockerfile.dev). Edit
#              requirements.txt → rebuild via build_image.sh, then
#              restart.
#
#   Frontend — compose-watch layout: source baked into the image as a
#              baseline; `develop.watch` rules in docker-compose.dev.yml
#              sync hot paths into the container at runtime via a
#              background `docker compose watch` process. `start` spawns
#              this process automatically (PID in
#              .compose-frontend-watch.pid, log in
#              .compose-frontend-watch.log); `stop` kills it. `watch`
#              runs the same process in the foreground for users who
#              want to see sync events live.
#
#              Hot path semantics:
#                • src/* edits           → next dev HMR (live, no restart)
#                • package.json edits    → sync overlay; run.sh restart
#                                          makes entrypoint.sh detect
#                                          hash mismatch and re-install
#                • Dockerfile / configs  → build_image.sh && restart
#
#              npm deps are NOT protected by a named volume anymore —
#              container recreate wipes node_modules. entrypoint.sh
#              reinstalls on cold start (or skips on warm start via
#              hash + .package-lock.json gate).
#
# ─── Database identity from image labels ─────────────────────────────────
# Same as prod: the db image's labels (type-any-language.db.user / .db.name)
# are read at start time and exported for compose. POSTGRES_PASSWORD is
# generated on first start (or reused if .secrets/postgres_password already
# exists) and materialised to .secrets/postgres_password + .secrets/database_url,
# both chmod 600. ALLOWED_ORIGINS is read from the shell env, falling back
# to the compose-level default (http://localhost,http://localhost:3000).
#
# ─── What this isn't ──────────────────────────────────────────────────────
# Does NOT build images, does NOT manage secrets, does NOT pull images
# from the registry on start/restart (dev's image lifecycle is local —
# `setup` does the one-time bootstrap pull when needed, otherwise
# build_image.sh / bake_image.sh keep local images fresh).
#   • To build dev images:    ./scripts/ops/dev-host/build_image.sh
#   • To pull a registry image manually:  docker pull <full-image>
#       (find it via: ./scripts/ops/dev-host/run.sh doctor)
#   • To reset the dev db:    rm .secrets/postgres_password && docker volume rm <db-data>
#   • To change ALLOWED_ORIGINS: export ALLOWED_ORIGINS=... before start,
#     or edit the default in docker-compose.dev.yml.
#
# ─── Usage ────────────────────────────────────────────────────────────────
#   ./scripts/ops/dev-host/run.sh setup    # first-time: 拉/检查 db image + build dev apps
#   ./scripts/ops/dev-host/run.sh doctor   # run pre-flight environment checks
#   ./scripts/ops/dev-host/run.sh start    # docker compose up -d + background compose watch
#   ./scripts/ops/dev-host/run.sh stop     # stop compose watch + docker compose down
#   ./scripts/ops/dev-host/run.sh restart  # hard restart (recreate)
#   ./scripts/ops/dev-host/run.sh reload   # alias for restart
#   ./scripts/ops/dev-host/run.sh watch    # foreground compose watch (Ctrl+C to exit)
#   ./scripts/ops/dev-host/run.sh logs     # docker compose logs -f
#   ./scripts/ops/dev-host/run.sh status   # docker compose ps
#
# Quick reference — when to use what:
#   • Edit backend/*.py              → just save. uvicorn --reload handles it.
#   • Edit frontend/src/*            → just save. compose watch + next dev HMR.
#   • Edit frontend/package.json     → save + ./run.sh restart (entrypoint re-installs).
#   • Edit backend/requirements.txt  → ./scripts/ops/dev-host/build_image.sh && restart.
#   • Edit Dockerfile / .dockerignore → ./scripts/ops/dev-host/build_image.sh && restart.
#   • Edit docker-compose.dev.yml (e.g. ALLOWED_ORIGINS default, develop.watch) → restart.
#   • Edit nginx/* → not applicable (dev has no nginx).
#
# Troubleshooting the watch process:
#   • tail -f .compose-frontend-watch.log   # see what compose watch is doing
#   • kill $(cat .compose-frontend-watch.pid)  # kill it manually
#   • rm .compose-frontend-watch.pid         # clear stale PID after manual kill
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$PROJECT_DIR"
source "$SCRIPT_DIR/../../lib.sh"

# DOCKER_REGISTRY: shell env > ./REGISTRY file > detect_default_registry().
# Empty (after the chain) means "local-only mode" — auto-pull from registry
# is disabled, but the dev compose still works (it pulls the local image).
resolve_docker_registry
if [ -n "$DOCKER_REGISTRY" ]; then
    if [ "${_DOCKER_REGISTRY_SOURCE:-}" = "detect" ]; then
        info "DOCKER_REGISTRY=$DOCKER_REGISTRY (auto-detected — 仅 push_image.sh 用,setup 也不会拉)"
    else
        info "DOCKER_REGISTRY=$DOCKER_REGISTRY (setup 一次性 bootstrap 拉取用,start 不再 auto-pull)"
    fi
else
    info "DOCKER_REGISTRY 未设置 (local-only mode — 仅本机使用)"
fi
DB_IMAGE="${DB_IMAGE:-english_db_content}"
# *_IMAGE_TAG resolve to:
#   DB_IMAGE_TAG       ← VERSION.prod (db is "prod-bound" content shared by both targets)
#   BACKEND_IMAGE_TAG  ← VERSION.dev
#   FRONTEND_IMAGE_TAG ← VERSION.dev
# Shell env still overrides. Exported for compose interpolation.
resolve_image_tag DB_IMAGE_TAG       VERSION.prod
resolve_image_tag BACKEND_IMAGE_TAG  VERSION.dev
resolve_image_tag FRONTEND_IMAGE_TAG VERSION.dev
warn_if_version_default "$BACKEND_IMAGE_TAG" VERSION.dev

# Image full references (used in inspect / pull paths).
# Prepend the registry prefix ONLY when DOCKER_REGISTRY was explicitly
# configured (shell env or REGISTRY file). Auto-detected registries
# (docker.io/$USER) are guesses — prepending them makes compose look
# for "zhangyu528/english_db_content:v0.2.0-rc.1" locally, which fails
# because locally-built images are tagged "english_db_content:v0.2.0-rc.1"
# (no prefix). So when the source is "detect", force DOCKER_REGISTRY to
# empty for the rest of the script — compose's
#   image: ${DOCKER_REGISTRY:+${DOCKER_REGISTRY}/}${DB_IMAGE}:${DB_IMAGE_TAG}
# interpolates to the bare local name. Local-only mode effectively.
if [ "${_DOCKER_REGISTRY_SOURCE:-}" = "shell" ] || [ "${_DOCKER_REGISTRY_SOURCE:-}" = "file" ]; then
    DB_FULL_IMAGE="${DOCKER_REGISTRY}/${DB_IMAGE}:${DB_IMAGE_TAG}"
    BACKEND_FULL_IMAGE="${DOCKER_REGISTRY}/${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"
    FRONTEND_FULL_IMAGE="${DOCKER_REGISTRY}/${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"
else
    DB_FULL_IMAGE="${DB_IMAGE}:${DB_IMAGE_TAG}"
    BACKEND_FULL_IMAGE="${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"
    FRONTEND_FULL_IMAGE="${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"
    # Force compose to use bare names too (its own image: line re-uses
    # $DOCKER_REGISTRY for the prefix).
    export DOCKER_REGISTRY=""
fi
export BACKEND_FULL_IMAGE FRONTEND_FULL_IMAGE

SECRETS_DIR=".secrets"
PG_PASSWORD_FILE="${SECRETS_DIR}/postgres_password"
DB_URL_FILE="${SECRETS_DIR}/database_url"
COMPOSE_FILE="docker-compose.dev.yml"
BACKEND_IMAGE="english_backend_dev"
FRONTEND_IMAGE="english_frontend_dev"

# compose-watch background process. The frontend dev container doesn't
# use a bind mount anymore (see docker-compose.dev.yml `develop.watch`)
# — instead, `docker compose watch` runs as a long-lived process that
# syncs src/ + package files into the container. We auto-spawn it from
# cmd_start (nohup, detached) and kill it from cmd_stop. PID + log live
# at the repo root so they're easy to inspect / clean.
WATCH_PID_FILE=".compose-frontend-watch.pid"
WATCH_LOG_FILE=".compose-frontend-watch.log"

# ---------------------------------------------------------------------------
# inspect_db_image_labels
# Same as prod/run.sh.
# ---------------------------------------------------------------------------
inspect_db_image_labels() {
    if ! image_exists "$DB_FULL_IMAGE"; then
        return 1
    fi
    DB_USER="$(image_label "$DB_FULL_IMAGE" "type-any-language.db.user" || echo "")"
    DB_NAME="$(image_label "$DB_FULL_IMAGE" "type-any-language.db.name" || echo "")"
    DB_VERSION="$(image_label "$DB_FULL_IMAGE" "type-any-language.content.version" || echo "")"
    DB_BAKED_AT="$(image_label "$DB_FULL_IMAGE" "type-any-language.content.baked-at" || echo "")"
    export DB_USER DB_NAME DB_VERSION DB_BAKED_AT
    [ -n "$DB_USER" ] && [ -n "$DB_NAME" ]
}

# export_db_identity_for_compose — make sure DB_USER / DB_NAME are set
# so compose interpolation (${DB_USER:?...} / ${DB_NAME:?...} in
# docker-compose.dev.yml) doesn't fail. Used by read-only subcommands
# (`status` / `stop` / `logs`) where the *actual* values don't matter
# for the operation — we just need *some* non-empty value to satisfy
# compose's strict interpolation.
#
# Falls back to the same defaults bake_image.sh uses (english_user /
# english_learning) when the db image isn't around locally. Those
# defaults are the ones that ship with the project, so compose's
# evaluated result matches what a fresh bake would produce — `ps` will
# show the right container names, `down` will target the right project,
# `logs` will stream from the right services.
#
# NOT a substitute for inspect_db_image_labels in cmd_start /
# cmd_restart — those need the *real* values to assemble the right
# DATABASE_URL and POSTGRES_PASSWORD.
export_db_identity_for_compose() {
    if inspect_db_image_labels; then
        return 0
    fi
    DB_USER="${DB_USER:-english_user}"
    DB_NAME="${DB_NAME:-english_learning}"
    export DB_USER DB_NAME
}

# ---------------------------------------------------------------------------
# write_secrets
#
# Materialises host-side secrets on disk so compose can mount them as
# files into the db and backend containers (via POSTGRES_PASSWORD_FILE
# and DATABASE_URL_FILE).
#
#   .secrets/postgres_password   (chmod 600) — generated on first start,
#                                              reused across restarts
#   .secrets/database_url        (chmod 600) — assembled from above +
#                                              DB_USER / DB_NAME from image
#
# Idempotent: existing .secrets/postgres_password is preserved across
# restarts so the db volume's password stays stable. To reset the dev
# db, delete the file (and the db-data volume).
# ---------------------------------------------------------------------------
write_secrets() {
    if [ -z "${DB_USER:-}" ] || [ -z "${DB_NAME:-}" ]; then
        err "DB_USER / DB_NAME 未设置 — db image 的 label 缺失或不正确"
        return 1
    fi

    mkdir -p "$SECRETS_DIR"
    chmod 700 "$SECRETS_DIR"

    if [ -f "$PG_PASSWORD_FILE" ]; then
        # Reuse existing password so the db-data volume keeps its user
        # credentials (changing it would make the existing db unreachable).
        POSTGRES_PASSWORD="$(cat "$PG_PASSWORD_FILE")"
        info "复用现有 $(basename "$PG_PASSWORD_FILE")"
    else
        # First start on this host — generate a fresh 24-char URL-safe secret.
        POSTGRES_PASSWORD="$(gen_secret 24)"
        info "新生成 POSTGRES_PASSWORD → $(basename "$PG_PASSWORD_FILE")"
    fi
    # No trailing newline (postgres reads it strictly).
    printf '%s' "$POSTGRES_PASSWORD" > "$PG_PASSWORD_FILE"
    chmod 600 "$PG_PASSWORD_FILE"

    # database_url: postgresql://<user>:<password>@db:5432/<name>
    # password is URL-encoded as %xx if needed. We use python if available
    # for proper escaping; fall back to a noop pass.
    if command -v python3 &> /dev/null; then
        encoded_pw="$(DB_USER="$DB_USER" DB_NAME="$DB_NAME" POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
            python3 -c 'import os, urllib.parse; print("postgresql://%s:%s@db:5432/%s" % (urllib.parse.quote(os.environ["DB_USER"]), urllib.parse.quote(os.environ["POSTGRES_PASSWORD"], safe=""), os.environ["DB_NAME"]))')"
    else
        # Fallback: trust that secrets.token_urlsafe output is URL-safe
        # (it is — alphabet is A-Z a-z 0-9 - _).
        encoded_pw="postgresql://${DB_USER}:${POSTGRES_PASSWORD}@db:5432/${DB_NAME}"
    fi
    printf '%s' "$encoded_pw" > "$DB_URL_FILE"
    chmod 600 "$DB_URL_FILE"
}

# ---------------------------------------------------------------------------
# start_compose_watch
# Detach `docker compose watch` so it runs alongside the up -d containers.
# No-op if already running (PID file + kill -0 check). The watch process
# reads `develop.watch` from docker-compose.dev.yml and syncs src/ +
# package files into the frontend container at runtime — replacing the
# old bind-mount hot-reload path.
#
# Idempotent: re-running start while watch is alive just logs and returns.
# ---------------------------------------------------------------------------
start_compose_watch() {
    if [ -f "$WATCH_PID_FILE" ]; then
        local existing_pid
        existing_pid="$(cat "$WATCH_PID_FILE" 2>/dev/null || echo '')"
        if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
            info "compose watch 已在运行 (PID $existing_pid, log: $WATCH_LOG_FILE)"
            return 0
        fi
        # Stale PID file (process gone) — clean up and proceed.
        rm -f "$WATCH_PID_FILE"
    fi

    info "后台启动 docker compose watch (frontend sync)..."
    # nohup + & detaches the process from this shell so it survives
    # run.sh exit. Redirect to log file (not /dev/null) so operators
    # can debug sync issues. The `disown` is belt-and-suspenders on
    # shells that otherwise keep watch in the job table.
    nohup $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" watch \
        > "$WATCH_LOG_FILE" 2>&1 &
    local pid=$!
    disown "$pid" 2>/dev/null || true
    echo "$pid" > "$WATCH_PID_FILE"
    info "  compose watch PID=$pid → $WATCH_LOG_FILE"
}

# ---------------------------------------------------------------------------
# stop_compose_watch
# Kill the background compose watch (if running). SIGTERM first, escalate
# to SIGKILL after a short grace period. Idempotent — safe to call when
# no watch is running.
# ---------------------------------------------------------------------------
stop_compose_watch() {
    if [ ! -f "$WATCH_PID_FILE" ]; then
        return 0
    fi
    local pid
    pid="$(cat "$WATCH_PID_FILE" 2>/dev/null || echo '')"
    rm -f "$WATCH_PID_FILE"
    if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
        return 0
    fi
    info "停止 compose watch (PID $pid)..."
    kill "$pid" 2>/dev/null || true
    local i
    for i in 1 2 3 4 5; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 1
    done
    if kill -0 "$pid" 2>/dev/null; then
        warn "compose watch 5s 内未退出 — SIGKILL"
        kill -9 "$pid" 2>/dev/null || true
    fi
}

# ---------------------------------------------------------------------------
# gate_preflight
# ---------------------------------------------------------------------------
gate_preflight() {
    require_docker
    if ! image_exists "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"; then
        err "image ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 未构建"
        info "  → 运行 ./scripts/ops/dev-host/build_image.sh"
        exit 1
    fi
    if ! image_exists "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"; then
        err "image ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 未构建"
        info "  → 运行 ./scripts/ops/dev-host/build_image.sh"
        exit 1
    fi
    if ! image_exists "$DB_FULL_IMAGE"; then
        err "db image $DB_FULL_IMAGE 未构建或未拉取"
        if [ -n "$DOCKER_REGISTRY" ]; then
            info "  → 设置 DB_IMAGE_TAG 后由 run.sh 拉取，或: docker pull $DB_FULL_IMAGE"
        else
            info "  → 运行 ./scripts/ops/db/bake_image.sh（可用 --tag dev 标记）"
            info "  → 之后再次运行 ./scripts/ops/dev-host/run.sh start"
        fi
        exit 1
    fi
    warn_port_in_use 3000 "前端开发端口 (宿主机 3000)"
    warn_port_in_use 8000 "后端开发端口 (宿主机 8000)"
    warn_port_in_use 5432 "postgres 端口 (宿主机 5432)"
}

# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------
cmd_doctor() {
    local failed=0
    echo "=== Development environment check ==="
    echo ""

    if check_docker_installed; then
        ok "docker 已安装: $(docker --version 2>&1 | head -1)"
    else
        err "docker 未安装"; failed=1
    fi

    if check_docker_daemon_running; then
        ok "docker daemon 运行中"
    else
        err "docker daemon 未运行"; failed=1
    fi

    if detect_compose_cmd 2>/dev/null; then
        ok "compose: $DOCKER_COMPOSE_CMD"
    else
        err "未找到 docker-compose / docker compose"; failed=1
    fi

    if [ -f "$PG_PASSWORD_FILE" ]; then
        ok ".secrets/postgres_password 存在（密码稳定，db 不会重置）"
    else
        info ".secrets/postgres_password 缺失 — 下次 start 会现场生成"
    fi

    if check_docker_installed && check_docker_daemon_running; then
        if image_exists "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"; then
            ok "image ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 存在"
        else
            warn "image ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 缺失 → 运行 ./scripts/ops/dev-host/build_image.sh"
        fi
        if image_exists "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"; then
            ok "image ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 存在"
        else
            warn "image ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 缺失 → 运行 ./scripts/ops/dev-host/build_image.sh"
        fi
        if image_exists "$DB_FULL_IMAGE"; then
            ok "db image $DB_FULL_IMAGE 存在"
            if inspect_db_image_labels; then
                ok "  db.user = $DB_USER"
                ok "  db.name = $DB_NAME"
                ok "  content.version = $DB_VERSION"
                ok "  content.baked-at = $DB_BAKED_AT"
            else
                warn "  db image 缺少 type-any-language.* labels — 重新 bake？"
            fi
        elif [ -n "$DOCKER_REGISTRY" ]; then
            warn "db image $DB_FULL_IMAGE 缺失 → docker pull $DB_FULL_IMAGE"
        else
            warn "db image $DB_FULL_IMAGE 缺失 → ./scripts/ops/db/bake_image.sh"
        fi
    fi

    warn_port_in_use 3000 "前端开发端口 (宿主机 3000)"
    warn_port_in_use 8000 "后端开发端口 (宿主机 8000)"
    warn_port_in_use 5432 "postgres 端口 (宿主机 5432)"

    echo "--- drift check (running containers vs local VERSION) ---"
    drift_check

    echo ""
    if [ $failed -eq 0 ]; then
        ok "所有必需检查通过"
        return 0
    else
        err "部分必需检查未通过"
        return 1
    fi
}

# ---------------------------------------------------------------------------
# (auto_pull_from_registry was removed: dev iteration never pulls from
# the registry on start/restart. Image lifecycle is local — `setup`
# does the one-time bootstrap pull when needed, otherwise
# build_image.sh / bake_image.sh keep local images fresh. Auto-pulling
# on every start overwrote fresh local builds with stale registry
# versions, which was the dominant pain point. If you want to pull
# explicitly: docker pull <full-image>.)
# ---------------------------------------------------------------------------

# Auto-bake chain lives in scripts/ops/db/full_bake.sh (single-host CMS+dev
# fallback when .env.db is present and the registry has no db image to pull).
# This file just calls it — see cmd_setup below.

# ---------------------------------------------------------------------------
# cmd_setup — first-time (or post-reset) environment bootstrap.
#
# Walks the operator through the image dependency chain so a fresh clone is
# one command away from `./dev.sh start`:
#
#   1. Preflight: docker + compose must be present.
#   2. db image: must be locally present (build_image.sh reads DB_USER /
#      DB_NAME from its OCI labels — a hard requirement, not a convenience).
#      If missing, try:
#        - DOCKER_REGISTRY set → docker pull
#        - .env.db present (or scaffolded via env.sh init, validated by
#          doctor) → single-host auto-bake (full CMS pipeline on this host)
#      env.sh init is idempotent (no-op when .env.db already exists); doctor
#      runs unconditionally as a gate so empty templates / missing keys
#      fail-fast before the expensive bake starts. If auto-bake itself
#      fails, exit 1 with manual-troubleshooting pointers (the dev app build
#      below would fail with a less actionable error anyway).
#   3. dev app images: call ./scripts/ops/dev-host/build_image.sh (it
#      builds both backend + frontend in one shot). Skipped if both
#      already present (idempotent — no need to rebuild cached layers).
#   4. Final summary.
#
# This command does NOT create .secrets/, start any containers, or push
# to a registry. It's strictly an image-management pass. Re-run as many
# times as you want — nothing destructive.
# ---------------------------------------------------------------------------
cmd_setup() {
    info "=== dev environment setup ==="
    echo ""

    # 1. Preflight — same checks as the rest of run.sh, but the failure
    #    mode is "print and stop" (not "exit 1") so the operator can see
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

    # 2. db image — must be present locally for the dev app build below.
    #    Resolution chain (each step falls through to the next on miss):
    #      a. local image already present
    #      b. DOCKER_REGISTRY set → docker pull (fast path; bypasses local CMS work)
    #      c. .env.db present or scaffoldable via env.sh init (validated by
    #         doctor) → single-host CMS+dev auto-bake (full pipeline)
    #    env.sh init is idempotent — second run skips silently. Doctor runs
    #    unconditionally as a gate so empty templates / partial .env.db
    #    fail-fast before the expensive bake starts.
    info "Step 1/2: db image ($DB_FULL_IMAGE)"
    local got_image=0
    if image_exists "$DB_FULL_IMAGE"; then
        ok "  本地已有 $DB_FULL_IMAGE"
        got_image=1
    else
        warn "db image 不在本地"
        if [ -n "$DOCKER_REGISTRY" ]; then
            info "  DOCKER_REGISTRY=$DOCKER_REGISTRY — 尝试 docker pull..."
            echo ""
            if docker pull "$DB_FULL_IMAGE"; then
                echo ""
                ok "  pull 成功"
                got_image=1
            else
                # Don't exit — fall through to auto-bake below. The pull
                # might've failed because the registry is rate-limited
                # (HTTP 429) or the image genuinely isn't there yet.
                # Local content pipeline (scaffold → doctor → bake) can
                # pick up the slack whether .env.db exists or not.
                warn "  pull 失败 — fallback 到本地 auto-bake"
            fi
        fi
        if [ "$got_image" = "0" ]; then
            # .env.db 缺失 → 先 scaffold (env.sh init 幂等,已存在会跳过)。
            # 把 init 放在这里而不是 fallback 的最后,目的是把"先填 secrets"
            # 接到同一个 setup 流程里 — 操作员不用切到另一条命令链。
            if [ ! -f "$PROJECT_DIR/.env.db" ]; then
                info "  本机没有 .env.db — 先 scaffold 一个:"
                echo ""
                if ! "$SCRIPT_DIR/../db/env.sh" init; then
                    err "  env.sh init 失败 — 检查 .env.example.db 是否存在"
                    return 1
                fi
                echo ""
                warn "  ↑ 上面只是 scaffold,secrets 还要手动填 (nano .env.db)"
                echo ""
            fi
            # doctor 当 gate:空模板 / 缺 key 都 fail-fast,避免带着空
            # .env.db 进 auto_bake 浪费一次完整 bake。
            if ! "$SCRIPT_DIR/../db/env.sh" doctor; then
                err "  .env.db 还差 key — 填好后重跑 setup"
                return 1
            fi
            # 单机 CMS+dev:auto-bake 跑完整链 (source db + 内容 + 烘焙)。
            # 每步都是幂等的,已部署的 host 重跑也不会浪费 API 调用。
            info "  调 scripts/ops/db/full_bake.sh (source db + 内容 + 烘焙)..."
            echo ""
            if "$SCRIPT_DIR/../db/full_bake.sh"; then
                echo ""
                ok "  自动 bake 完成"
                got_image=1
            else
                err "  自动 bake 失败 — 上面的错误说明哪步挂了"
                info "  手动排查:"
                info "    docker logs english_db          # 如果 source db 起不来"
                info "    ./scripts/ops/db/full_bake.sh doctor   # 内容管线 preflight"
                return 1
            fi
        fi
    fi
    if inspect_db_image_labels; then
        ok "  db.user=$DB_USER  db.name=$DB_NAME  content.version=$DB_VERSION"
    else
        warn "  db image 缺 type-any-language.* label — 重新 bake"
        return 1
    fi
    echo ""

    # 3. dev app images — call build_image.sh (handles both at once).
    #    Skipped when both already exist; otherwise build_image.sh is
    #    fast (cached layers) and idempotent.
    info "Step 2/2: dev app images"
    if image_exists "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" && \
       image_exists "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"; then
        ok "  ${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG} 已存在"
        ok "  ${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG} 已存在"
        info "  (要 rebuild? 跑: ./scripts/ops/dev-host/build_image.sh)"
    else
        info "  调 ./scripts/ops/dev-host/build_image.sh..."
        echo ""
        if "$SCRIPT_DIR/build_image.sh"; then
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
    info "  下一步: ./dev.sh start"
    info "  启动后访问:"
    info "    前端: http://localhost:3000"
    info "    后端: http://localhost:8000  (API 文档: /docs)"
}

# drift_check — compare running containers' type-any-language.app.version
# LABEL against the locally-resolved *_IMAGE_TAG. Warns on mismatch.
# Skipped silently if no containers are running.
drift_check() {
    if ! $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q db >/dev/null 2>&1; then
        return 0
    fi
    local svc cid expected actual
    for svc in db backend frontend; do
        case "$svc" in
            db)      expected="$DB_IMAGE_TAG" ;;
            backend) expected="$BACKEND_IMAGE_TAG" ;;
            frontend) expected="$FRONTEND_IMAGE_TAG" ;;
        esac
        cid="$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q "$svc" 2>/dev/null | head -1)"
        if [ -z "$cid" ]; then
            continue
        fi
        actual="$(docker inspect "$cid" --format '{{ index .Config.Labels "type-any-language.app.version" }}' 2>/dev/null || echo "")"
        if [ -z "$actual" ]; then
            warn "  $svc: 无 type-any-language.app.version LABEL (image 旧？rebuild)"
        elif [ "$actual" != "$expected" ]; then
            warn "  $svc drift: running=$actual, expected=$expected — run.sh restart 拉新 image"
        else
            ok "  $svc drift OK (version=$actual)"
        fi
    done
}

# ---------------------------------------------------------------------------
# cmd_migrate — apply pending schema migrations to the running runtime db.
#
# Lightweight dev iteration path. Equivalent to running `content.sh
# init-schema` against the source db, but targets the runtime db directly
# via a one-shot sidecar container on the compose network — so no image
# bake, no registry, no volume drop.
#
# Why a sidecar: the runtime db container is postgres:15-alpine, which
# has psql but no python. The migration runner is Python. We use the
# already-cached `english_backend_dev:${TAG}` image as the sidecar —
# it's FROM python:3.11-slim with psycopg2-binary + sqlalchemy already
# pip-installed (the backend image's Dockerfile builds on them). So no
# extra `docker pull` is needed and no network mirror is involved.
#
# We mount db/ and backend/ read-only into the sidecar and run
# `pipeline.migrations.runner` against `db:5432` (the compose-network
# hostname of the runtime db). PYTHONPATH=/db makes `pipeline.env` and
# `pipeline.migrations.*` importable; runner.py + the migrations
# auto-add `backend/` for the SQLAlchemy model imports in 0001_baseline.
#
# Idempotent: runner.py uses IF NOT EXISTS / IF EXISTS and stamps
# applied versions in schema_migrations. Re-runs are no-ops.
#
# Backend picks up the new schema on the next request (no restart needed
# — uvicorn hot-reload handles Python changes; SQL schema is read per
# query). But ./run.sh restart works fine too if you want to be sure.
#
# Offline fallback: db/pipeline/migrations/apply_to_runtime.sql is a
# pre-rolled SQL file that brings a stale db up to head in one shot.
# Use it when no backend image is cached and python:3.11-slim can't be
# pulled either. Only covers "upgrade old db to head" — does NOT handle
# dev-iteration of a brand-new migration.
# ---------------------------------------------------------------------------
cmd_migrate() {
    info "=== dev db migrate ==="
    echo ""
    require_docker

    # Compose evaluates the whole file (incl. ${DB_USER:?...} /
    # ${DB_NAME:?...} in the db service's environment block) for ANY
    # subcommand — including `ps -q db`. Populate DB_USER / DB_NAME
    # from image labels (or fall back to bake defaults) so compose can
    # parse the file without dying. See export_db_identity_for_compose
    # + the matching note in cmd_stop / cmd_logs.
    export_db_identity_for_compose

    # Find the running runtime db container (via compose, not the literal
    # `type-any-language-db-1` — project name may differ).
    local db_cid
    db_cid="$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q db 2>/dev/null | head -1)"
    if [ -z "$db_cid" ]; then
        err "db 容器没在跑 — 先 ./scripts/ops/dev-host/run.sh start"
        return 1
    fi

    # The compose network the db is on (don't hardcode ${project}_default).
    local network
    network="$(docker inspect "$db_cid" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' 2>/dev/null | head -1)"
    if [ -z "$network" ]; then
        err "找不到 db 容器的 compose network"
        return 1
    fi

    # Connection params: user/db from .env.db defaults (matches the image
    # label), password from .secrets/postgres_password written by
    # write_secrets on first start.
    local pg_user="${POSTGRES_USER:-english_user}"
    local pg_db="${POSTGRES_DB:-english_learning}"
    if [ ! -f "$PG_PASSWORD_FILE" ]; then
        err "$PG_PASSWORD_FILE 不存在 — 先跑 start (它会现场生成)"
        return 1
    fi
    local pg_pass
    pg_pass="$(cat "$PG_PASSWORD_FILE")"

    # Pick the sidecar image. Prefer the running backend container's image
    # (already on disk, has python + psycopg2 + sqlalchemy from the
    # backend's Dockerfile.dev install) so we don't need to pull anything.
    # Fall back to python:3.11-slim if the backend isn't running yet.
    local sidecar_image
    local backend_cid
    backend_cid="$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q backend 2>/dev/null | head -1)"
    if [ -n "$backend_cid" ]; then
        sidecar_image="$(docker inspect "$backend_cid" --format '{{.Config.Image}}' 2>/dev/null)"
        info "用 backend 镜像做 sidecar (无 pull 开销): $sidecar_image"
    elif image_exists "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"; then
        sidecar_image="${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"
        info "用本地 backend 镜像做 sidecar (无 pull 开销): $sidecar_image"
    else
        info "backend 没在跑也没本地镜像 — 尝试拉 python:3.11-slim ..."
        if ! docker pull -q python:3.11-slim >/dev/null 2>&1; then
            warn "pull python:3.11-slim 失败 (offline?)"
            info "  离线 fallback: docker exec -i -e PGPASSWORD=\$(cat $PG_PASSWORD_FILE) \\"
            info "    $db_cid psql -U $pg_user -d $pg_db \\"
            info "    < db/pipeline/migrations/apply_to_runtime.sql"
            return 1
        fi
        sidecar_image="python:3.11-slim"
    fi

    echo ""
    info "在 sidecar 里跑 pipeline.migrations.runner (target=db:5432)..."
    # On Windows (Git Bash + Docker Desktop), MSYS path translation turns
    # MSYS-style paths like /d/work/... into Windows paths when bash
    # interpolates them into `docker -v`. That translation is unreliable
    # across mount points, so we explicitly convert via cygpath -w and
    # feed a Windows-style absolute path that Docker Desktop accepts
    # verbatim. POSIX hosts leave $PROJECT_DIR unchanged and cygpath
    # errors out — fall through to the original POSIX path in that case.
    local db_mount backend_mount env_mount secrets_mount
    if command -v cygpath >/dev/null 2>&1; then
        db_mount="$(cygpath -w "$PROJECT_DIR/db")"
        backend_mount="$(cygpath -w "$PROJECT_DIR/backend")"
        env_mount="$(cygpath -w "$PROJECT_DIR/.env.db")"
        secrets_mount="$(cygpath -w "$PROJECT_DIR/.secrets")"
    else
        db_mount="$PROJECT_DIR/db"
        backend_mount="$PROJECT_DIR/backend"
        env_mount="$PROJECT_DIR/.env.db"
        secrets_mount="$PROJECT_DIR/.secrets"
    fi
    # PYTHONPATH is set inside the container via the bash -c wrapper
    # rather than via `docker -e PYTHONPATH=/db`. Docker Desktop on
    # Windows rewrites single-leading-slash env values (e.g. /db →
    # C:/Program Files/Git/db), which corrupts Python's sys.path.
    # Setting it inside the shell sidesteps that rewriting entirely.
    # We also mount .env.db + .secrets/ at the container's filesystem
    # root — pipeline.env._project_root() walks up from /db/pipeline to
    # `/`, and setup_env() expects .env.db + .secrets/postgres_password
    # there. 0001_baseline imports app.database (backend models), so
    # /backend goes on PYTHONPATH too.
    if ! MSYS_NO_PATHCONV=1 docker run --rm \
            --network "$network" \
            -v "$db_mount:/db:ro" \
            -v "$backend_mount:/backend:ro" \
            -v "$env_mount:/.env.db:ro" \
            -v "$secrets_mount:/.secrets:ro" \
            -e POSTGRES_HOST="db" \
            -e POSTGRES_PORT="5432" \
            -e POSTGRES_USER="$pg_user" \
            -e POSTGRES_DB="$pg_db" \
            -e POSTGRES_PASSWORD="$pg_pass" \
            --entrypoint bash \
            "$sidecar_image" \
            -c "PYTHONPATH=/db:/backend exec python -m pipeline.migrations.runner"
    then
        err "migrate 失败 — 见上面错误"
        return 1
    fi

    echo ""
    ok "=== migrate 完成 ==="
    info "  backend hot reload 自动捡新 schema;要确认:"
    info "    ./scripts/ops/dev-host/run.sh restart"
}

cmd_start() {
    gate_preflight
    if ! inspect_db_image_labels; then
        err "db image 缺少 type-any-language.* labels — 用 ./scripts/ops/db/bake_image.sh 重新烘焙"
        exit 1
    fi
    write_secrets
    info "启动开发容器..."
    # `--pull=never`: dev never auto-pulls on start. Image lifecycle is
    # local — `setup` does the one-time bootstrap pull when needed,
    # otherwise build_image.sh / bake_image.sh keep local images
    # fresh. Without --pull=never, compose up -d defaults to
    # `--pull=missing` and would re-pull, overwriting a fresh local
    # build or hitting 429 on registries that don't host the image.
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" up -d --pull=never

    # Spawn the compose watch process in background — it consumes
    # `develop.watch` from docker-compose.dev.yml and syncs src/ +
    # package files into the frontend container (replacing the old
    # bind-mount hot-reload). Detached via nohup; PID + log tracked so
    # `stop` can clean up. Idempotent — re-running start is a no-op
    # if watch is already alive.
    start_compose_watch

    ok "服务已启动（热重载已开启）"
    echo -e "  前端:   ${_LIB_BLUE}http://localhost:3000${_LIB_NC}"
    echo -e "  后端:   ${_LIB_BLUE}http://localhost:8000${_LIB_NC}"
    echo -e "  API文档: ${_LIB_BLUE}http://localhost:8000/docs${_LIB_NC}"
    echo "  db.user=$DB_USER  db.name=$DB_NAME  content.version=$DB_VERSION"
    echo "  compose watch: tail -f $WATCH_LOG_FILE   (前台跑: $0 watch)"
}

cmd_stop() {
    require_docker
    # Stop the watch process FIRST so it doesn't try to sync into a
    # container that's being torn down (would log noise + maybe race
    # against file removal).
    stop_compose_watch

    # Compose evaluates the full file at every subcommand (including
    # `down`), so DB_USER / DB_NAME must be exported first — otherwise
    # the ${DB_USER:?...} interpolation in the db service's environment
    # block fails before docker even looks at running containers.
    # Fall back to the bake defaults when the db image isn't local —
    # see export_db_identity_for_compose.
    export_db_identity_for_compose
    info "停止开发容器..."
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" down
    ok "服务已停止"
}

# ---------------------------------------------------------------------------
# cmd_watch — foreground compose watch (alternative to the background one
# auto-spawned by `start`). Useful when you want to SEE the sync events
# in your terminal (Ctrl+C to stop). `start` already runs a detached
# watch — running `watch` in another terminal is fine too (compose
# tolerates multiple watchers but the second one just re-syncs whatever
# the first already synced).
# ---------------------------------------------------------------------------
cmd_watch() {
    require_docker
    info "启动 compose watch (前台,Ctrl+C 退出)..."
    # If a background watch is already running, kill it first so we
    # don't end up with two watchers competing.
    stop_compose_watch
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" watch
}

cmd_restart() {
    gate_preflight
    if ! inspect_db_image_labels; then
        err "db image 缺少 type-any-language.* labels — 用 ./scripts/ops/db/bake_image.sh 重新烘焙"
        exit 1
    fi
    write_secrets
    info "重启开发容器（重新加载 secrets）..."

    BACKEND_BEFORE=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" 2>/dev/null || true)
    FRONTEND_BEFORE=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}" 2>/dev/null || true)

    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" up -d --no-deps --force-recreate backend frontend

    BACKEND_AFTER=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}" 2>/dev/null || true)
    FRONTEND_AFTER=$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" images -q "${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}" 2>/dev/null || true)

    if [ -n "$BACKEND_BEFORE" ] && [ "$BACKEND_BEFORE" != "$BACKEND_AFTER" ]; then
        warn "$BACKEND_IMAGE image ID 变化了 — 你是改了 Dockerfile？"
        warn "  这种情况请用 ./scripts/ops/dev-host/build_image.sh 重 build 后再 restart"
    fi
    if [ -n "$FRONTEND_BEFORE" ] && [ "$FRONTEND_BEFORE" != "$FRONTEND_AFTER" ]; then
        warn "$FRONTEND_IMAGE image ID 变化了 — 你是改了 Dockerfile？"
        warn "  这种情况请用 ./scripts/ops/dev-host/build_image.sh 重 build 后再 restart"
    fi

    ok "服务已重启（secrets 已重读）"
}

cmd_reload() { cmd_restart "$@"; }

cmd_logs() {
    require_docker
    # See cmd_stop for the why — compose evaluates the file even for
    # read-only ops like `logs`.
    export_db_identity_for_compose
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" logs -f "$@"
}

cmd_status() {
    require_docker
    # See cmd_stop for the why — `ps` is read-only but compose still
    # evaluates the whole file.
    export_db_identity_for_compose
    $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps
}

usage() {
    cat <<EOF
用法: ./scripts/ops/dev-host/run.sh <command>

命令:
  setup    首次环境引导: 拉/检查 db image,build 缺失的 dev app images,无 start 副作用
  doctor   跑完整环境检查（不修改任何东西，纯只读）
  start    启动开发容器（热重载）+ 后台 spawn compose watch,自动 sync 源码/依赖变更
  stop     停止 compose watch + 开发容器
  restart  重启容器并重新读取 secrets (≈5s, 不重 build image)
  reload   同 restart —— 别名，语义更清晰
  watch    前台跑 compose watch (Ctrl+C 退出) —— start 已自动 spawn 后台 watch,这个是给想看 sync 日志的人
  migrate  对运行中的 runtime db 跑 pending schema migrations (sidecar python + runner.py)
  logs     跟踪日志 (Ctrl+C 退出)
  status   查看容器状态

典型工作流:
  ./scripts/ops/dev-host/run.sh setup         # 首次或重置后: 一次性就位所有 image
  ./scripts/ops/dev-host/run.sh doctor        # 跑一遍检查，看环境是否就绪
  ./scripts/ops/dev-host/run.sh start         # 启动 (本地 image,不再 auto-pull,后台 watch 自动跑)
  ./scripts/ops/dev-host/run.sh restart       # 改 docker-compose.dev.yml / .secrets 后用这个
  ./scripts/ops/dev-host/run.sh migrate       # 改 db/pipeline/migrations/versions/*.py 后
  ./scripts/ops/dev-host/build_image.sh && \\
    ./scripts/ops/dev-host/run.sh restart     # 改代码 / Dockerfile 后
  ./scripts/ops/dev-host/run.sh logs backend  # 跟踪 backend 日志
  tail -f .compose-frontend-watch.log         # 看前端 sync 日志
  kill \$(cat .compose-frontend-watch.pid)     # 手动停后台 watch（一般不用）

热重载机制:
  • 改 frontend/src/*       → compose watch sync → next dev HMR（无需重启）
  • 改 frontend/package.json → compose watch sync → run.sh restart 让 entrypoint 重装
  • 改 Dockerfile / 配置     → run.sh build_image.sh && run.sh restart

环境覆盖:
  ALLOWED_ORIGINS=https://my.domain ./scripts/ops/dev-host/run.sh start
  DOCKER_REGISTRY=ghcr.io/me \
    DB_IMAGE_TAG=v1.2 BACKEND_IMAGE_TAG=v1.2 FRONTEND_IMAGE_TAG=v1.2 \
    ./scripts/ops/dev-host/run.sh start
  # IMAGE_TAG=v1.2 一次性给所有 image 设同 tag（CI 用）
EOF
}

case "${1:-}" in
    setup)   cmd_setup "$@" ;;
    doctor)  cmd_doctor "$@" ;;
    start)   cmd_start "$@" ;;
    stop)    cmd_stop "$@" ;;
    restart) cmd_restart "$@" ;;
    reload)  cmd_reload "$@" ;;
    watch)   cmd_watch "$@" ;;
    migrate) cmd_migrate "$@" ;;
    logs)    shift; cmd_logs "$@" ;;
    status)  cmd_status "$@" ;;
    -h|--help|help|"") usage ;;
    *) err "未知命令: $1"; usage; exit 1 ;;
esac