#!/usr/bin/env bash
#
# ops/prod/deploy.sh — THE "go live" step for prod.
#
# This is the actual deployment operation: pull the latest images from
# the registry and recreate the prod containers. After this runs, the
# new version is serving traffic.
#
# Pair with ops/prod/release.sh:
#   - release.sh: bump + build + push images to registry (BEFORE this)
#   - deploy.sh:  pull + recreate containers (THIS)
#
# Pairs with the Makefile target:
#   make release-prod v0.3.0   →  release.sh prod v0.3.0   (publish to registry)
#   make prod-deploy           →  deploy.sh             (roll out to prod)
#
# What this actually does (Layer 3):
#   1. Resolve DOCKER_REGISTRY (shell env → gh variable get → fail loud)
#   2. doctor.sh pre-flight — single source of truth for all env checks
#      (.secrets/db_password, /var/lib/.../postgres, gh CLI, images, etc.)
#      Fail loud here if anything is wrong. Operator fixes and re-runs.
#   3. lifecycle.sh restart — pure action, recreates all 3 containers:
#      - `docker compose up -d --no-deps --force-recreate db backend nginx`
#      - Compose auto-pulls new images if not local
#      - **db image's custom entrypoint auto-applies migrations + imports
#        content on container start** (so schema + data updates ship
#        with the image — no separate "after deploy" steps)
#      - bind-mounted /var/lib/type-any-language/postgres preserves
#        db data across container recreates
#   4. doctor.sh post-flight — verify the deploy actually worked
#      (catches partial failures: e.g. db recreated but backend not started)
#
# Why a wrapper instead of `lifecycle.sh restart` directly:
#   - Clearer name in scripts and Makefile (deploy.sh IS deploy)
#   - Orchestrates the standard "check → act → check" flow
#   - Single point of entry for "I want to ship to prod"
#
# Architecture: lifecycle.sh is pure action, doctor.sh is pure
# validation. deploy.sh orchestrates them. This separation lets
# `make prod-doctor` be run standalone (any time, no side effects).

set -e

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$COMMON_DIR/../.." && pwd)"
# shellcheck source=_common.sh
source "$COMMON_DIR/_common.sh"
setup_prod_host_env

info "=== pre-flight: doctor.sh ==="
"$COMMON_DIR/doctor.sh" || {
    err "doctor pre-flight 失败 — deploy 终止"
    info "  修好上面报告的问题后再跑 (通常是:跑 ./ops/prod/bootstrap.sh / gh auth login / 重新 publish)"
    exit 1
}

if [ -z "$DOCKER_REGISTRY" ]; then
    err "DOCKER_REGISTRY 未设置 — deploy 需要从 registry 拉 image"
    info "  解决: export DOCKER_REGISTRY=ghcr.io/zhangyu528/type-any-language  (CVM 不再需要 gh CLI)"
    exit 1
fi
info "DOCKER_REGISTRY=$DOCKER_REGISTRY (source=${_DOCKER_REGISTRY_SOURCE:-shell})"
info "  3 个 image 待拉: db + backend + frontend, 全部 tag=${BACKEND_IMAGE_TAG}"

info "=== prod deploy: pull all 3 images + recreate containers ==="
"$COMMON_DIR/lifecycle.sh" restart

echo ""
info "=== post-deploy verify: doctor.sh ==="
"$COMMON_DIR/doctor.sh" || warn "doctor 报告了问题 — 看上方详情"