#!/bin/bash
#
# lib.sh — shared helpers for the init / build / run scripts.
#
# Source this file from any script:
#     SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#     source "$SCRIPT_DIR/lib.sh"
#
# Provides:
#   - ok / warn / err / info      (colored printers)
#   - detect_compose_cmd         (sets DOCKER_COMPOSE_CMD global)
#   - check_docker_installed     (returns 0/1, no print)
#   - check_docker_daemon_running
#   - require_docker             (exit 1 on fail, with friendly error)
#   - file_exists                (returns 0/1)
#   - require_file               (exit 1 on fail)
#   - image_exists               (returns 0/1)
#   - require_image              (exit 1 on fail)
#   - port_in_use                (returns 0/1, no print)
#   - warn_port_in_use           (prints warning if in use)
#   - gen_secret                 (random URL-safe string)
#   - find_repo_root             (walk up to .git or any VERSION* file; "" if neither)
#   - read_version_file [path]   (echo first non-empty/non-comment line of path,
#                                or any VERSION* under repo root; falls back to "v0.0.0")
#   - resolve_image_tag VAR [path] (per-image env > IMAGE_TAG > version file > "v0.0.0")
#   - warn_if_version_default    (one-shot warn when VERSION file is missing/empty)
#   - resolve_docker_registry    (GitHub Variable via `gh`; fail loud; single source of truth)
#   - sed_inplace                (portable sed -i; GNU vs BSD/macOS)
#

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
check_docker_daemon_running() {
    # Check for GNU timeout (Linux) not Windows timeout (Git Bash on Windows)
    # Windows timeout returns error for --version, GNU timeout returns version info
    if command -v timeout &> /dev/null && timeout --version 2>&1 | grep -q "^timeout"; then
        timeout 5 docker info &> /dev/null
    else
        # Fallback: run in background, kill after timeout.
        # This works on macOS, Git Bash, and Windows
        docker info &> /dev/null &
        local pid=$!
        # shellcheck disable=SC2064
        (python -c "import time; time.sleep(5)" && kill -0 $pid 2>/dev/null && kill $pid 2>/dev/null) &
        local watchdog=$!
        wait $pid
        local rc=$?
        kill $watchdog 2>/dev/null
        return $rc
    fi
}

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
file_exists() { [ -f "$1" ]; }

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

require_file() {
    local path="$1"
    local hint="${2:-}"
    if [ ! -f "$path" ]; then
        err "$path 不存在"
        [ -n "$hint" ] && info "  → $hint"
        exit 1
    fi
}

# image_exists <name>  → returns 0 if Docker image is present locally.
image_exists() {
    # Try the name as-given first. If that misses and the name has a
    # registry prefix (e.g. "docker.io/me/foo:tag" → strip to "me/foo:tag"
    # or further to "foo:tag"), retry without it — local images built via
    # bake_image.sh / build_image.sh are tagged without the registry
    # prefix, so callers asking with the prefix should still find them.
    docker image inspect "$1" &> /dev/null && return 0
    local stripped="${1#*/}"          # docker.io/me/foo:tag → me/foo:tag
    [ "$stripped" != "$1" ] && docker image inspect "$stripped" &> /dev/null && return 0
    local bare="${stripped#*/}"       # me/foo:tag → foo:tag
    [ "$bare" != "$stripped" ] && docker image inspect "$bare" &> /dev/null && return 0
    return 1
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

# resolve_image_ref <name> — print a docker-inspectable reference for the
# image (image ID if found, empty if not). Mirrors image_exists's prefix
# stripping so callers asking with a registry prefix still find locally-
# tagged images. Use this before reading labels / config so the inspect
# call doesn't fail on the prefix mismatch.
resolve_image_ref() {
    docker image inspect "$1" --format '{{.Id}}' 2>/dev/null | head -1 | grep -v '^$' && return 0
    local stripped="${1#*/}"
    [ "$stripped" != "$1" ] && docker image inspect "$stripped" --format '{{.Id}}' 2>/dev/null | head -1 | grep -v '^$' && return 0
    local bare="${stripped#*/}"
    [ "$bare" != "$stripped" ] && docker image inspect "$bare" --format '{{.Id}}' 2>/dev/null | head -1 | grep -v '^$' && return 0
    return 1
}

# image_label <name> <label-key> — print the value of an OCI label on the
# given image, or empty string. Uses resolve_image_ref internally so it
# works whether the caller passes a registry-prefixed name or the bare
# local tag. Pairs nicely with image_exists for the gate-check.
image_label() {
    local ref
    ref="$(resolve_image_ref "$1")" || return 1
    [ -z "$ref" ] && return 1
    docker inspect "$ref" --format "{{ index .Config.Labels \"$2\" }}" 2>/dev/null
}

# require_image <name> <fix-hint>  → exits 1 if missing, prints fix hint.
require_image() {
    local name="$1"
    local hint="${2:-run the appropriate build script first}"
    if ! image_exists "$name"; then
        err "image $name 未构建"
        info "  → $hint"
        exit 1
    fi
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

# find_repo_root [start] → echoes the absolute path of the repo root, or "".
# Walks up from $start (default: dir of BASH_SOURCE) until it finds a .git
# directory or any VERSION* file. Returns "" if neither is found.
find_repo_root() {
    local start="${1:-$(dirname "${BASH_SOURCE[0]}")}"
    local dir f
    dir="$(cd "$start" 2>/dev/null && pwd)" || return 0
    while [ -n "$dir" ] && [ "$dir" != "/" ]; do
        if [ -d "$dir/.git" ]; then
            echo "$dir"
            return 0
        fi
        # Match any VERSION* file: catches the per-segment files
        # (db/VERSION, backend/VERSION, ...). The glob is intentionally
        # permissive — repo-root detection doesn't care which segment the
        # file belongs to. nullglob means an empty expansion doesn't
        # produce a literal pattern.
        local _saved; _saved="$(shopt -p nullglob 2>/dev/null || true)"
        shopt -s nullglob
        for f in "$dir"/VERSION*; do
            if [ -f "$f" ]; then
                # shellcheck disable=SC2164
                [ -n "$_saved" ] && eval "$_saved" || shopt -u nullglob
                echo "$dir"
                return 0
            fi
        done
        # shellcheck disable=SC2164
        [ -n "$_saved" ] && eval "$_saved" || shopt -u nullglob
        dir="$(dirname "$dir")"
    done
    echo ""
}

# read_version_file <path>  → echoes the first non-empty, non-comment line
# of $path (stripped of BOM / CR / surrounding whitespace), or "v0.0.0" if
# the file is missing or contains no usable content.
#
# $path is REQUIRED and must be relative to find_repo_root (e.g.
# `db/VERSION`, `backend/VERSION`). The previous back-compat that
# scanned root-level VERSION / VERSION.prod / VERSION.dev was removed when
# the layout moved per-segment — there's nothing at the root to scan now.
# If you forget to pass a path, you get v0.0.0 + a warn_if_version_default
# warning, not a silent fallback to a stale file.
read_version_file() {
    local path="${1:-}"
    if [ -z "$path" ]; then
        echo "v0.0.0"
        return 0
    fi
    if [ ! -f "$path" ]; then
        echo "v0.0.0"
        return 0
    fi
    local v
    v="$(awk 'NF && substr($0,1,1) != "#" {
            gsub(/\r/, "");
            gsub(/^[[:space:]]+|[[:space:]]+$/, "");
            print;
            exit
        }' "$path")"
    if [ -z "$v" ]; then
        echo "v0.0.0"
    else
        echo "$v"
    fi
}

# resolve_image_tag VAR_NAME [path]
#   If $VAR_NAME is already set and non-empty, leave it alone.
#   Otherwise, set it (in the caller's scope, exported) to:
#     ${IMAGE_TAG} if set, else $(read_version_file "$path"), else "v0.0.0".
#
# Usage (callers should always pass the per-segment path):
#       resolve_image_tag DB_IMAGE_TAG       db/VERSION
#       resolve_image_tag BACKEND_IMAGE_TAG  backend/VERSION
#       resolve_image_tag FRONTEND_IMAGE_TAG frontend/VERSION
resolve_image_tag() {
    # Resolution order (highest priority first):
    #   1. Per-image env var (e.g. BACKEND_IMAGE_TAG=v1.2.3)
    #   2. Generic IMAGE_TAG env var (CI convenience — bumps all images at once)
    #   3. The VERSION file path passed in
    #   4. Fail loud (was: "v0.0.0" fallback — silent failure anti-pattern)
    local var="$1"
    local path="${2:-}"
    local cur="${!var:-}"
    if [ -n "$cur" ]; then
        return 0
    fi
    if [ -n "${IMAGE_TAG:-}" ]; then
        printf -v "$var" '%s' "$IMAGE_TAG"
        export "$var"
        return 0
    fi
    if [ -z "$path" ]; then
        err "resolve_image_tag: 缺 path,且 $var / IMAGE_TAG env var 都未设"
        return 1
    fi
    if [ ! -f "$PROJECT_DIR/$path" ]; then
        err "$path 不存在,且 $var / IMAGE_TAG env var 都未设"
        err "  解决: 跑 ./ops/prod/release.sh prod vX.Y.Z(会自动创建)"
        return 1
    fi
    local resolved
    resolved="$(read_version_file "$path")"
    if [ -z "$resolved" ]; then
        err "$path 是空的,version 必填"
        err "  解决: 跑 ./ops/prod/release.sh prod vX.Y.Z(自动写)"
        return 1
    fi
    printf -v "$var" '%s' "$resolved"
    export "$var"
    return 0
}

# warn_if_version_default <tag> [path]  — prints a single warn line if the
# resolved tag is "v0.0.0" (i.e. no VERSION file was found). A per-process
# guard (_LIB_VERSION_WARNED) keeps the message from repeating.
warn_if_version_default() {
    local tag="${1:-}"
    local path="${2:-}"
    if [ "${_LIB_VERSION_WARNED:-0}" = "1" ]; then return 0; fi
    if [ "$tag" = "v0.0.0" ]; then
        if [ -n "$path" ]; then
            warn "VERSION 文件缺失或为空 ($path), 使用默认 v0.0.0"
        else
            warn "VERSION 文件缺失或为空, 使用默认 v0.0.0 — 在仓库根建一个 VERSION 文件"
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
#   2. .secrets/postgres_password (the legacy self-hosted db password file;
#      orphaned after target hosts move to cloud-db — see migration notes
#      in CLAUDE.md "Migrating an existing host")
# It's still useful for ad-hoc CLI use against a self-hosted Postgres
# (e.g. running import_staging.sh against a local docker postgres before
# the cloud db is wired up).
#
# Resolution order (matches the per-script inline blocks this replaced):
#   1. Explicit shell env:    DATABASE_URL already set → use as-is
#   2. POSTGRES_USER / POSTGRES_DB / POSTGRES_HOST / POSTGRES_PORT defaults
#   3. POSTGRES_PASSWORD:    shell env > .secrets/postgres_password > fail
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

# db_url_defaults — echo "user:db:host:port" with code defaults applied
# to any unset component. Doesn't touch the password.
db_url_defaults() {
    local user="${POSTGRES_USER:-english_user}"
    local db="${POSTGRES_DB:-english_learning}"
    local host="${POSTGRES_HOST:-localhost}"
    local port="${POSTGRES_PORT:-5432}"
    echo "$user:$db:$host:$port"
}

# db_resolve_password — set POSTGRES_PASSWORD from .secrets/ if not already
# in the environment. Echoes the resolved password (empty on failure).
db_resolve_password() {
    if [ -n "${POSTGRES_PASSWORD:-}" ]; then
        echo "$POSTGRES_PASSWORD"
        return 0
    fi
    local root="${PROJECT_DIR:-$(find_repo_root)}"
    if [ -f "$root/.secrets/postgres_password" ]; then
        cat "$root/.secrets/postgres_password"
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
        err "POSTGRES_PASSWORD missing — export it, or copy .secrets/postgres_password from the dev/prod host"
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
# Portable sed -i
# ---------------------------------------------------------------------------
# sed_inplace PATTERN FILE — in-place edit, compatible with GNU sed (Linux)
# and BSD sed (macOS). BSD requires an explicit empty argument after -i.
# (Previously used by cms/scripts/env.sh to inject smart defaults into
# cms/.env — that script is gone, but sed_inplace is kept as a generic
# helper since other in-place file edits still benefit from it.)
sed_inplace() {
    if sed --version >/dev/null 2>&1; then
        sed -i "$1" "$2"
    else
        sed -i '' "$1" "$2"
    fi
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
