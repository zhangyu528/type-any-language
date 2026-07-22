#!/bin/bash
#
# db/run.sh — drive the db side of ETL end-to-end.
#
# The CMS pipeline (cms/run.sh) produces files in cms/staging/. This
# script does the rest: imports them into the staging db, bakes the
# staging db into a content-baked image, and pushes that image to
# $DOCKER_REGISTRY. Symmetric with cms/run.sh (which does E+T; this
# does L + bake + ship).
#
# What it does (in order):
#   (a) db/scripts/import_staging.sh all
#         L 步 — UPSERT cms/staging/*.{json,jsonl} into the staging db.
#         Idempotent. Re-running is safe; only missing/updated rows
#         are written.
#   (b) db/scripts/build.sh
#         export the staging db → assemble into db/init/01-content.sql
#         → docker build the english_db_content image. Prints "Built: <tag>".
#   (c) db/scripts/push.sh -y   (only if DOCKER_REGISTRY is non-empty)
#         Push the image to the registry. Target hosts `docker pull`
#         it on their next lifecycle.sh start.
#
# Notably absent: VERSION bump + git commit. Both are owned by
# ops/release.sh, which is the project-wide release driver (covers
# db/VERSION, backend/VERSION, frontend/VERSION — one file per segment
# gates both the dev and prod image tags for that segment — dev app
# images, prod app images, and the db image). db/run.sh does NOT
# call release.sh — it assumes the operator has already decided on the
# per-segment VERSION values (e.g. by running `ops/release.sh show` or by
# setting DB_IMAGE_TAG).
#
# This script does NOT touch the application runtime db. That lives
# on target hosts and is set up by ops/{dev,prod}/setup.sh on first
# start. After a successful push, operators run
# `ops/{dev,prod}/lifecycle.sh restart` on each target to pull the
# new image.
#
# Configuration (all shell env; no .env file is loaded here):
#   DB_IMAGE_TAG     image tag (default: db/VERSION; shell env wins)
#   DOCKER_REGISTRY  registry namespace; empty = local-only mode
#                     (resolution: shell env > ./REGISTRY > detect).
#                     When empty, push is skipped (image stays local).
#   POSTGRES_*       DATABASE_URL assembly (see ops/lib.sh::db_assemble_url).
#
# Exit codes:
#   0   success
#   1   a step failed (image left in a partial state — fix and re-run)
#
# Usage:
#   ./db/run.sh dev                 # import + build (no push — dev stays local)
#   ./db/run.sh prod                # import + build + push
#   ./db/run.sh prod --no-push      # prod 流但跳过 push (单次 build, 一次性)
#   DB_IMAGE_TAG=v0.5.0 ./db/run.sh dev      # pin a one-off tag for dev iteration
#   DOCKER_REGISTRY= ./db/run.sh prod        # explicit local-only prod build
#
# dev vs prod:
#   dev is the safe "iterate locally" mode: import + build only, never
#   pushes. Use this when you're rebuilding the db image for a dev host
#   that pulls from a local image cache (see ops/dev/setup.sh — its
#   first-time bootstrap pull reads from $DOCKER_REGISTRY, but after
#   that dev never auto-pulls; rebuilds live here).
#   prod is the full release: import + build + push to $DOCKER_REGISTRY.
#   Use this when the new db image needs to be available to a remote
#   target host (or to a teammate's dev host). When DOCKER_REGISTRY is
#   empty, prod auto-skips push (same local-only contract as before).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../ops/lib.sh"

# ---------------------------------------------------------------------------
# usage() — defined up front so arg parsing (which calls it on -h /
# unknown args) can find it. Bash resolves functions at call time, not
# definition time, but only if they've been parsed by the time the
# case branch runs — a one-pass script needs the function body before
# the case.
# ---------------------------------------------------------------------------
usage() {
    cat <<EOF
用法: $0 <dev|prod> [--no-push]

子命令:
  dev                 import + build, 跳过 push(本地迭代, 不污染 registry)
  prod                import + build + push(完整 release 流)

Flags:
  --no-push           跳过 push 步骤 (prod 流有效; dev 流强制 --no-push)
  -h | --help         显示本帮助

环境 (shell env):
  DB_IMAGE_TAG     image tag (默认: db/VERSION; shell env 覆盖)
  DOCKER_REGISTRY  registry 命名空间; 空 = local-only 模式 (prod 自动跳过 push)
                    解析顺序: shell env > ./REGISTRY > 自动检测
  POSTGRES_*       DATABASE_URL 拼装 (见 ops/lib.sh::db_assemble_url)

注意:
  本脚本不 bump VERSION, 那是 ops/release.sh 的事.
  本脚本不碰 application runtime db, 那在 target 主机上由 ops/{dev,prod}/lifecycle.sh 拉 image 启动.
  dev / prod 共享同一个 db image (db 是 prod-bound content, 详见 CLAUDE.md) —
  dev 跳过 push 是为了 "不污染 registry", 不是因为内容不同.

示例:
  $0 dev                          # 本地迭代, build 但不 push
  $0 prod                         # 完整 release: import + build + push
  $0 prod --no-push               # prod 流单次 build 不 push
  DB_IMAGE_TAG=v0.5.0 $0 dev      # dev 流用一次性 tag
  DOCKER_REGISTRY= $0 prod        # prod 流显式 local-only
EOF
}

# ---------------------------------------------------------------------------
# Arg parsing
# ---------------------------------------------------------------------------
# Mode: one of "dev" / "prod" / "" (empty = prod by default).
# The first positional token chooses the mode; --no-push is a flag
# (allowed in either mode; in dev it's redundant but harmless).
# ---------------------------------------------------------------------------
MODE=""
PUSH=1
while [ $# -gt 0 ]; do
    case "$1" in
        dev|prod) MODE="$1"; shift ;;
        --no-push) PUSH=0; shift ;;
        -h|--help|help) usage; exit 0 ;;
        *) err "未知参数: $1"; usage; exit 1 ;;
    esac
done
# Empty mode defaults to prod (the full release path). Keeps the
# "just run ./db/run.sh and you get the whole pipeline" expectation
# for operators who don't want to think about it.
if [ -z "$MODE" ]; then
    MODE="prod"
fi
# dev mode forces push off, regardless of PUSH / DOCKER_REGISTRY.
# The whole point of dev is "iterate locally without polluting the
# registry" — an accidental push would surprise the operator.
if [ "$MODE" = "dev" ]; then
    PUSH=0
fi

# Resolve DOCKER_REGISTRY once so the push/no-push decision is
# consistent with what push.sh itself would do (avoids the case where
# the user runs db/run.sh expecting a push and then push.sh prints
# "DOCKER_REGISTRY 未设置 — push 需要 registry").
resolve_docker_registry

# Resolve DB_IMAGE_TAG from shell env > IMAGE_TAG > db/VERSION.
# Same chain as db/scripts/build.sh — keeps the printed tag in sync
# with what `docker images` will show.
resolve_image_tag DB_IMAGE_TAG db/VERSION
warn_if_version_default "$DB_IMAGE_TAG" db/VERSION

cat <<EOF
=== db/run.sh ===
  mode            = $MODE
  DB_IMAGE_TAG    = $DB_IMAGE_TAG
  DOCKER_REGISTRY = ${DOCKER_REGISTRY:-<empty> (local-only)}
  push step       = $([ "$PUSH" = "1" ] && echo "enabled" || echo "skipped")
  steps:
    1. import_staging.sh all
    2. build.sh
    3. push.sh -y   (if enabled)
EOF
echo

# ---------------------------------------------------------------------------
# Step 1: L — import staging files into the staging db.
# ---------------------------------------------------------------------------
info "[1/3] import_staging — staging files → db"
./db/scripts/import_staging.sh all

echo

# ---------------------------------------------------------------------------
# Step 2: bake — export the staging db into a SQL bundle and build the
# content-baked image.
# ---------------------------------------------------------------------------
info "[2/3] build — pg_dump → docker build"
DB_IMAGE_TAG="$DB_IMAGE_TAG" ./db/scripts/build.sh

echo

# ---------------------------------------------------------------------------
# Step 3: push — only if DOCKER_REGISTRY is set AND --no-push wasn't
# passed. push.sh itself fails loudly when DOCKER_REGISTRY is empty
# (and interactive when -y is absent), so gate it here to match the
# "local-only mode" contract documented in CLAUDE.md.
# ---------------------------------------------------------------------------
if [ "$PUSH" = "1" ]; then
    if [ -z "$DOCKER_REGISTRY" ]; then
        info "[3/3] push — 跳过 (DOCKER_REGISTRY 未设置; image 留在本地)"
    else
        info "[3/3] push — $DOCKER_REGISTRY/english_db_content:$DB_IMAGE_TAG"
        DB_IMAGE_TAG="$DB_IMAGE_TAG" ./db/scripts/push.sh -y
    fi
else
    info "[3/3] push — 跳过 (--no-push)"
fi

echo
ok "db/run.sh done: tag=$DB_IMAGE_TAG"
info "下一步: 各 target 主机跑 ./ops/{dev,prod}/lifecycle.sh restart 自动拉新 image"
