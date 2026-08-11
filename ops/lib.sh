#!/bin/bash
#
# lib.sh — shared helpers for the init / build / run scripts.
#
# Source this file from any script:
#     SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#     source "$SCRIPT_DIR/lib.sh"
#
# Provides:
#   - check_docker_installed     (returns 0/1, no print)
#   - require_docker             (exit 1 on fail, with friendly error)
#   - port_in_use                (returns 0/1, no print)
#   - warn_port_in_use           (prints warning if in use)
#   - gen_secret                 (random URL-safe string)
#   - resolve_image_tag VAR      (per-image env > IMAGE_TAG > :latest)
#   - warn_if_version_default    (one-shot warn when IMAGE_TAG is unset → :latest)
#   - resolve_docker_registry    (GitHub Variable; fail loud; single source of truth)
#   - sudo_run_or_manual         (run with sudo -n; fall back to "self-run" hint)
#   - setup_prod_host_env        (resolves DOCKER_REGISTRY + 3 image tags + full refs)
#   - drift_check                (post-deploy: container LABEL vs IMAGE_TAG)
#   - image_pullable             (registry reachability check; used by doctor.sh)


# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
    _LIB_RED='\033[0;31m'
    _LIB_GREEN='\033[0;32m'
    _LIB_YELLOW='\033[1;33m'
    _LIB_BLUE='\033[1;34m'
    _LIB_NC='\033[0m'
else
    _LIB_RED=''; _LIB_GREEN=''; _LIB_YELLOW=''; _LIB_BLUE=''; _LIB_NC=''
fi

ok()   { echo -e "${_LIB_GREEN}[OK]${_LIB_NC}   $1"; }
warn() { echo -e "${_LIB_YELLOW}[WARN]${_LIB_NC} $1"; }
info() { echo -e "${_LIB_BLUE}[INFO]${_LIB_NC} $1"; }
err()  { echo -e "${_LIB_RED}[ERR]${_LIB_NC}  $1"; }

# ---------------------------------------------------------------------------
# Docker / Compose detection
# ---------------------------------------------------------------------------
# detect_compose_cmd: populates $DOCKER_COMPOSE_CMD. Returns 0 on success, 1
# if neither docker-compose nor `docker compose` is available.
detect_compose_cmd() {
    if command -v docker-compose &> /dev/null; then
        DOCKER_COMPOSE_CMD="docker-compose"
    elif docker compose version &> /dev/null 2>&1; then
        DOCKER_COMPOSE_CMD="docker compose"
    else
        return 1
    fi
}

# Silent checks (return 0/1, no output).
check_docker_installed() {
    command -v docker &> /dev/null
}

# `docker info` can hang for ~30s when the daemon is not running (e.g. Docker
# Desktop is launching). Bound the wait so that doctor / start don't appear
# frozen. 5 seconds is plenty for a healthy daemon to respond.

# Strict check: prints a friendly error and exits 1 on failure.
# Use at the start of any command that touches Docker.
require_docker() {
    if ! check_docker_installed; then
        err "docker 未安装"
        exit 1
    fi
    if ! check_docker_daemon_running; then
        err "docker daemon 未运行（请先启动 Docker Desktop）"
        exit 1
    fi
    if ! detect_compose_cmd; then
        err "未找到 docker-compose / docker compose"
        exit 1
    fi
}

# ---------------------------------------------------------------------------
# File / image existence
# ---------------------------------------------------------------------------

# py_cmd <args...> — run a python interpreter on the rest of the args.
# Picks host python3 / python (no docker fallback; use run_python_step
# if you need that). Echoes the chosen interpreter; caller invokes it
# (this lets `set -e` track the python invocation, not the chooser).
py_cmd() {
    if command -v python3 &> /dev/null; then
        echo "python3"
    elif command -v python &> /dev/null; then
        echo "python"
    else
        err "未发现 python 或 python3"
        exit 1
    fi
}

# image_pullable <full-ref>  → returns 0 if the image exists in the
# registry and can be PULLED (no docker login needed for PUBLIC registries
# like GHCR). Uses `docker manifest inspect` — a small network call that does
# NOT pull the full image. Use this in prod pre-flight, where images are
# pulled from a remote registry (not built locally on the host), so checking
# local tags (image_exists) is wrong: the image isn't local yet on first
# deploy, and even after a pull its local tag carries the registry prefix
# that image_exists's bare-name check can't match.
image_pullable() {
    docker manifest inspect "$1" &> /dev/null
}

# ---------------------------------------------------------------------------
# Random secret / default registry
# ---------------------------------------------------------------------------
# gen_secret <length>  → prints a URL-safe random string (no trailing newline).
# Tries python3 → openssl → /dev/urandom. Used by init scripts to seed
# POSTGRES_PASSWORD so the resulting .env is immediately usable
# (user can still edit it afterwards).
gen_secret() {
    local len="${1:-48}"
    if command -v python3 &> /dev/null; then
        python3 -c "import secrets; print(secrets.token_urlsafe(${len}))"
    elif command -v openssl &> /dev/null; then
        # 4/3 expansion: 48 base64 chars ≈ 36 bytes of entropy. Trim padding.
        openssl rand -base64 $(( len * 3 / 4 )) | tr -d '\n=' | head -c "$len"
        echo
    else
        # Last-resort: urandom. Not URL-safe in the strict sense, but
        # sufficient as a placeholder the user will replace.
        tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$len"
        echo
    fi
}

# (Note: `detect_default_registry` was removed in the 2026-08-04 refactor.
#  DOCKER_REGISTRY is single source of truth: GitHub Variable only.
#  No auto-detect from $USER, no local-only mode.)

# ---------------------------------------------------------------------------
# Version resolution
# ---------------------------------------------------------------------------
# Each segment's prod image tag is the git TAG created by release-prod
# (which also publishes a GitHub release). The per-segment VERSION files
# (backend/VERSION, frontend/VERSION, db/VERSION) were REMOVED on
# 2026-08-06 — the version is delivered to every environment as the
# IMAGE_TAG env var instead:
#
#   release-prod creates tag vX.Y.Z  →  deploy-prod forwards it as IMAGE_TAG
#                                     →  CVM's resolve_image_tag() uses it
#
# cms/VERSION is a placeholder (cms has no docker image today; reserved
# for a future CMS pipeline version stamp) — see cms/ for its own pipeline.
#
# Dev has no docker images — the dev loop runs host-native (uvicorn +
# `next dev` on the host, talking to the docker `db` container) so there's
# no image tag to resolve for dev iteration.
#
# All callers resolve tags by passing an explicit relative path (relative to
# find_repo_root) — there is no implicit root-level fallback. The path args
# are now only a FALLBACK when IMAGE_TAG (and per-image env vars) are unset.
#
# Resolution order (highest priority first):
#   1. Per-image env var, e.g. BACKEND_IMAGE_TAG=v1.2.3
#   2. Generic IMAGE_TAG env var (the git tag — primary path in CI/prod)
#   3. The VERSION file path passed in (resolved by read_version_file;
#      deprecated — files removed, only reached if IMAGE_TAG is unset)
#   4. Literal "v0.0.0" fallback (won't break a build, but warns once)

# read_version_file <path>  → echoes the first non-empty, non-comment line
# of $path (stripped of BOM / CR / surrounding whitespace), or "v0.0.0" if
# the file is missing or contains no usable content.
#
# resolve_image_tag VAR_NAME [path]
#   If $VAR_NAME is already set and non-empty, leave it alone.
#   Otherwise, set it (in the caller's scope, exported) to:
#     ${IMAGE_TAG} if set, else $(read_version_file "$path"),
#     else "latest" (release-build.yml publishes a :latest tag for every
#     version tag, so a host with no explicit IMAGE_TAG still gets a
#     concrete, pullable image — the newest published build).
#
# Usage (callers should always pass the per-segment path):
#       resolve_image_tag DB_IMAGE_TAG       db/VERSION
#       resolve_image_tag BACKEND_IMAGE_TAG  backend/VERSION
#       resolve_image_tag FRONTEND_IMAGE_TAG frontend/VERSION
# Resolution order (highest priority first):
#   1. Per-image env var, e.g. BACKEND_IMAGE_TAG=v1.2.3
#   2. Generic IMAGE_TAG env var (CI convenience — bumps all images at once)
#   3. Fall back to :latest (release-build.yml guarantees this tag exists;
#      non-pinned = warn_if_version_default() flags it for the operator).
# No VERSION-file fallback — per-segment VERSION files were removed 2026-08-06.
# The version is now delivered to every environment as IMAGE_TAG env.
resolve_image_tag() {
    local var="$1"
    local cur="${!var:-}"
    if [ -n "$cur" ]; then
        return 0
    fi
    if [ -n "${IMAGE_TAG:-}" ]; then
        printf -v "$var" '%s' "$IMAGE_TAG"
        export "$var"
        return 0
    fi
    # No explicit tag → fall back to :latest (release-build.yml publishes it
    # for every version). Non-pinned by design; warn_if_version_default
    # flags this for the operator.
    printf -v "$var" 'latest'
    export "$var"
    return 0
}

# warn_if_version_default <tag> [path]  — prints a single warn line if the
# resolved tag is "latest" (i.e. no IMAGE_TAG / VERSION pin was supplied, so
# the host is running the mutable :latest tag). A per-process guard
# (_LIB_VERSION_WARNED) keeps the message from repeating.
warn_if_version_default() {
    local tag="${1:-}"
    local path="${2:-}"
    if [ "${_LIB_VERSION_WARNED:-0}" = "1" ]; then return 0; fi
    if [ "$tag" = "latest" ]; then
        if [ -n "$path" ]; then
            warn "未指定 IMAGE_TAG 且 $path 缺失 → 使用 :latest(非固定版本,可能与线上漂移)"
        else
            warn "未指定 IMAGE_TAG → 使用 :latest(非固定版本,可能与线上漂移)"
        fi
        _LIB_VERSION_WARNED=1
    fi
}

# ---------------------------------------------------------------------------
# Registry resolution
# ---------------------------------------------------------------------------
# DOCKER_REGISTRY is the shared project-wide namespace prefix used for
# `docker push` / `docker pull` (e.g. ghcr.io/zhangyu528/type-any-language,
# docker.io/youruser). Unlike POSTGRES_PASSWORD or AI_API_KEY, it is NOT a
# personal secret — it is project config that the whole team shares.
#
# **Single source of truth**: GitHub repo Variable "DOCKER_REGISTRY"
# (Settings → Variables → Actions). The build side (GH Actions) reads
# `${{ vars.DOCKER_REGISTRY }}` directly. The run side (CVM scripts)
# receives the same value via the SSH-injected env var set by the
# deploy-prod / bootstrap-prod workflows (which read `${{ vars.DOCKER_REGISTRY }}`).
# The CVM itself never needs gh CLI or registry auth.
#
# There is NO shell-env override, NO REGISTRY file fallback, NO auto-detect.
# This is a deliberate design choice (2026-08-04): a single source means
# a single point to fix when the namespace changes, and zero risk of
# shell-env drift. To temporarily change the registry (e.g. for testing),
# run `gh variable set DOCKER_REGISTRY=...` on the repo, run your
# experiment, then `gh variable set DOCKER_REGISTRY=...` back.
#
# **NEW (2026-08-04)**: the workflow now reads DOCKER_REGISTRY from
# `${{ vars.DOCKER_REGISTRY }}` and SSH-injects it to the CVM as an env
# var. The CVM no longer needs gh CLI or any auth — it just reads
# $DOCKER_REGISTRY from env. This eliminates:
#   - 1 GH Secret (GITHUB_PAT)
#   - 1 CVM dependency (gh CLI)
#   - 1 CVM on-boarding step (gh auth login)
#   - 1 CVM script step (step_gh_cli in bootstrap.sh)
# Operator manual fallback: `export DOCKER_REGISTRY=...` once.
#
# Failure modes (all exit 1, never silent):
#   - DOCKER_REGISTRY env var empty (workflow didn't inject OR manual)
#   - DOCKER_REGISTRY format invalid (no dot in hostname)

# resolve_docker_registry  → sets $DOCKER_REGISTRY in the caller's scope
# (and exports it). Returns 0 on success, 1 if env var missing/invalid.
# _DOCKER_REGISTRY_SOURCE is always "workflow" (no other source exists).
#
# Usage:
#   source lib.sh
#   resolve_docker_registry || exit 1
#   echo "$DOCKER_REGISTRY"
resolve_docker_registry() {
    # DOCKER_REGISTRY is provided by the deploy-prod workflow via SSH env
    # (which got it from `${{ vars.DOCKER_REGISTRY }}` in the GH Variable).
    # This script does NOT need gh CLI — gh lives on the workflow side
    # and never on the CVM itself.
    #
    # Source chain: GitHub Variable → workflow env → CVM env (this var)
    #
    # If unset: either the workflow didn't inject it (GH Variable missing
    # → workflow pre-check fail), or this is a manual run without the env
    # set. Both cases fail loud with clear instructions.

    # 1. Must be non-empty.
    if [ -z "${DOCKER_REGISTRY:-}" ]; then
        err "DOCKER_REGISTRY 未设置"
        err "  这个值应该由 deploy-prod workflow 通过 SSH env 注入"
        err "  让 release-prod/deploy-prod workflow 跑 —— 它会自动注入"
        err "  手动跑: export DOCKER_REGISTRY=ghcr.io/zhangyu528/type-any-language"
        return 1
    fi

    # 2. Basic sanity check — must look like a hostname/path.
    # Reject things like "  " (whitespace) or "no" (clearly not a hostname).
    if ! [[ "$DOCKER_REGISTRY" == *.* ]]; then
        err "DOCKER_REGISTRY 格式不对: $DOCKER_REGISTRY"
        err "  期望: hostname like ghcr.io/zhangyu528/type-any-language"
        return 1
    fi

    DOCKER_REGISTRY="$DOCKER_REGISTRY"
    export DOCKER_REGISTRY
    _DOCKER_REGISTRY_SOURCE="workflow"
    export _DOCKER_REGISTRY_SOURCE
    return 0
}

# ---------------------------------------------------------------------------
# Database URL assembly
# ---------------------------------------------------------------------------
# Defensive fallback for db-side scripts (init_schema.sh / migrate.sh /
# import_staging.sh) that need a DATABASE_URL but haven't been given one
# in the process env. The primary cloud-db path is:
#
#       source db/scripts/lib.sh
#       db_assemble_url         # or db_assemble_url — writes DATABASE_URL
#       exec db/scripts/migrate.sh # etc.
#
# which assembles the DSN from POSTGRES_* env vars (or accepts a
# pre-set DATABASE_URL). The runtime is now docker-compose-managed
# postgres, so the DSN just needs to point at localhost; no role/db
# bootstrap dance. See db/scripts/lib.sh for the helper.
#
# db_assemble_url here is the *ad-hoc CLI* fallback — it builds a DSN from
# POSTGRES_USER / DB / HOST / PORT + a password resolved via:
#   1. POSTGRES_PASSWORD env
#   2. .dbcreds/postgres_password (the legacy self-hosted db password file;
#      orphaned after target hosts move to cloud-db — see migration notes
#      in CLAUDE.md "Migrating an existing host")
# It's still useful for ad-hoc CLI use against a self-hosted Postgres
# (e.g. running import_staging.sh against a local docker postgres before
# the cloud db is wired up).
#
# Resolution order (matches the per-script inline blocks this replaced):
#   1. Explicit shell env:    DATABASE_URL already set → use as-is
#   2. POSTGRES_USER / POSTGRES_DB / POSTGRES_HOST / POSTGRES_PORT defaults
#   3. POSTGRES_PASSWORD:    shell env > .dbcreds/postgres_password > fail
#   4. url-encode each component (defensive — gen_secret output is
#      URL-safe, but operator-supplied passwords may not be)
#
# Usage (from a sourced script):
#       db_assemble_url
#       # $DATABASE_URL is now exported and set in the caller's shell
#
# Behaviour on missing password: prints a friendly `err` and returns 1
# (does NOT exit). Callers decide whether to fail hard or carry on with
# the unset value (e.g. build.sh exits; doctor subcommands warn).

# db_resolve_password — set POSTGRES_PASSWORD from .dbcreds/ if not already
# in the environment. Echoes the resolved password (empty on failure).
db_resolve_password() {
    if [ -n "${POSTGRES_PASSWORD:-}" ]; then
        echo "$POSTGRES_PASSWORD"
        return 0
    fi
    local root="${PROJECT_DIR:-$(find_repo_root)}"
    if [ -f "$root/.dbcreds/postgres_password" ]; then
        cat "$root/.dbcreds/postgres_password"
        return 0
    fi
    return 1
}

# db_assemble_url — populate and export DATABASE_URL using the chain above.
# Returns 0 on success, 1 if POSTGRES_PASSWORD can't be resolved.
# Components are URL-encoded defensively (gen_secret is URL-safe, but
# operator-typed passwords may contain characters psycopg2 won't accept
# without encoding).
db_assemble_url() {
    if [ -n "${DATABASE_URL:-}" ]; then
        export DATABASE_URL
        return 0
    fi
    local password
    if ! password="$(db_resolve_password)"; then
        err "POSTGRES_PASSWORD missing — export it, or copy .dbcreds/postgres_password from the dev/prod host"
        return 1
    fi
    POSTGRES_USER="${POSTGRES_USER:-english_user}"
    POSTGRES_DB="${POSTGRES_DB:-english_learning}"
    POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
    POSTGRES_PORT="${POSTGRES_PORT:-5432}"
    export POSTGRES_USER POSTGRES_DB POSTGRES_HOST POSTGRES_PORT POSTGRES_PASSWORD="$password"
    if command -v python3 &> /dev/null; then
        DATABASE_URL="$(POSTGRES_USER="$POSTGRES_USER" POSTGRES_DB="$POSTGRES_DB" POSTGRES_HOST="$POSTGRES_HOST" POSTGRES_PORT="$POSTGRES_PORT" POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
            python3 -c 'import os, urllib.parse; print("postgresql://%s:%s@%s:%s/%s" % (urllib.parse.quote(os.environ["POSTGRES_USER"], safe=""), urllib.parse.quote(os.environ["POSTGRES_PASSWORD"], safe=""), os.environ["POSTGRES_HOST"], os.environ["POSTGRES_PORT"], os.environ["POSTGRES_DB"]))')"
    else
        # Fallback: rely on shell-side composition. Safe only when the
        # password contains no url-unsafe characters (gen_secret output
        # qualifies; manual input might not).
        DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
    fi
    export DATABASE_URL
}

# ---------------------------------------------------------------------------
# Port checks
# ---------------------------------------------------------------------------
# port_in_use <port>  → returns 0 if the port is listening, 1 otherwise.
# Uses `ss` if available, falls back to `netstat`, then a /proc scan.
port_in_use() {
    local port="$1"
    if command -v ss &> /dev/null; then
        ss -tln 2>/dev/null | grep -qE ":${port}\b" && return 0
    fi
    if command -v netstat &> /dev/null; then
        netstat -tln 2>/dev/null | grep -qE ":${port}\b" && return 0
    fi
    # Last-resort: TCP table on Linux.
    if [ -r /proc/net/tcp ]; then
        awk -v p="$port" 'BEGIN{p=strtonum("0x"p)} $2 ~ ":"p"$" {found=1; exit} END{exit !found}' /proc/net/tcp 2>/dev/null
        return $?
    fi
    return 1
}

# warn_port_in_use <port> <description>  → prints warning if occupied.
# Always returns 0: warnings are advisory, never fail the script under `set -e`.
warn_port_in_use() {
    local port="$1"
    local desc="$2"
    if port_in_use "$port"; then
        warn "$desc (端口 $port) 已被占用"
    fi
    return 0
}

# ---------------------------------------------------------------------------
# Image resolution + drift check (generic, used by both cvm/ and ops/ tools)
# ---------------------------------------------------------------------------
# These belong in lib.sh rather than cvm/_common.sh because they don't depend
# on CVM-specific state (compose wrapper, COMPOSE_FILE) — they only need
# DOCKER_REGISTRY + IMAGE_TAG. The CVM scripts get them transitively via
# ops/cvm/_common.sh sourcing this file; ops/doctor.sh at the repo root
# sources this file directly.

# Canonical image names. The 3 prod images the stack is composed of.
# Centralized here so a 4th image only needs to be added in two places:
# this constant list, and the build_image_for() helper in ops/release/_common.sh.
BACKEND_IMAGE="english_backend"
FRONTEND_IMAGE="english_frontend"
DB_IMAGE="english_db"   # custom build (db/Dockerfile) - NOT postgres:15-alpine

# setup_prod_host_env - resolve the 3 image tags and assemble the FULL_IMAGE
# refs ($DOCKER_REGISTRY/<image>:<tag>) that downstream tooling uses.
# Called by every CVM script before any docker command; also by ops/doctor.sh.
setup_prod_host_env() {
    # Detect compose command FIRST (populates $DOCKER_COMPOSE_CMD).
    if ! detect_compose_cmd; then
        err "\u672a\u627e\u5230 docker-compose / docker compose \u2014 \u5b89\u88c5 Docker Desktop \u6216 docker-compose"
        exit 1
    fi

    # DOCKER_REGISTRY is the single source of truth (GitHub Variable).
    if ! resolve_docker_registry; then
        err "DOCKER_REGISTRY \u89e3\u6790\u5931\u8d25,prod \u7aef\u5fc5\u987b\u6709 registry \u624d\u80fd\u62c9 3 \u4e2a image"
        exit 1
    fi
    info "DOCKER_REGISTRY=$DOCKER_REGISTRY (source=${_DOCKER_REGISTRY_SOURCE:-github})"

    # Resolve the 3 tags from IMAGE_TAG env (the primary path in CI/prod).
    resolve_image_tag BACKEND_IMAGE_TAG
    resolve_image_tag FRONTEND_IMAGE_TAG
    resolve_image_tag DB_IMAGE_TAG
    warn_if_version_default "$BACKEND_IMAGE_TAG"

    # Assemble the full refs the rest of the toolchain uses.
    BACKEND_FULL_IMAGE="${DOCKER_REGISTRY}/${BACKEND_IMAGE}:${BACKEND_IMAGE_TAG}"
    FRONTEND_FULL_IMAGE="${DOCKER_REGISTRY}/${FRONTEND_IMAGE}:${FRONTEND_IMAGE_TAG}"
    DB_FULL_IMAGE="${DOCKER_REGISTRY}/${DB_IMAGE}:${DB_IMAGE_TAG}"
    export BACKEND_FULL_IMAGE FRONTEND_FULL_IMAGE DB_FULL_IMAGE
}

# drift_check - post-deploy health verification:
#   Compares each running container's image LABEL (type-any-language.app.version,
#   baked at build time via --build-arg APP_VERSION=${IMAGE_TAG}) against the
#   tag resolved by setup_prod_host_env from the IMAGE_TAG env.
#
#   Mismatch = drift. Common causes:
#     - someone manually ran `docker pull <image>:latest` skipping lifecycle.sh
#     - IMAGE_TAG env was wrong when lifecycle.sh last ran
#     - someone bumped the IMAGE_TAG env without restarting containers
#
#   Pre-condition: setup_prod_host_env must have been called (populates
#   the *_IMAGE_TAG and *_FULL_IMAGE vars). If no containers are running,
#   returns 0 (no drift to report on).
drift_check() {
    # No-op when nothing is running. compose() wrapper is from
    # ops/cvm/_common.sh (which sources this lib.sh); doctor.sh at ops/
    # root imports it lazily. Fall back to docker ps if compose isn't set up.
    if type compose >/dev/null 2>&1; then
        if ! compose ps -q backend >/dev/null 2>&1; then
            return 0
        fi
    elif ! docker ps -q --filter label=type-any-language.app.version >/dev/null 2>&1; then
        return 0
    fi

    local svc cid expected actual
    for svc in db backend frontend; do
        case "$svc" in
            db)       expected="$DB_IMAGE_TAG" ;;
            backend)  expected="$BACKEND_IMAGE_TAG" ;;
            frontend) expected="$FRONTEND_IMAGE_TAG" ;;
        esac
        cid="$(docker ps -q --filter label=type-any-language.app.version --filter name="tal-$svc" 2>/dev/null | head -1)"
        if [ -z "$cid" ]; then
            continue
        fi
        actual="$(docker inspect "$cid" --format '{{ index .Config.Labels "type-any-language.app.version" }}' 2>/dev/null || echo "")"
        if [ -z "$actual" ]; then
            warn "  $svc: \u65e0 type-any-language.app.version LABEL (image \u65e7?rebuild)"
        elif [ "$actual" != "$expected" ]; then
            warn "  $svc drift: running=$actual, expected=$expected \u2014 restart \u62c9\u65b0 image"
        else
            ok "  $svc drift OK (version=$actual)"
        fi
    done
}
