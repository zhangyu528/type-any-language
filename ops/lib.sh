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
#   - detect_default_registry    (docker.io/$USER or empty)
#   - find_repo_root             (walk up to .git or any VERSION* file; "" if neither)
#   - read_version_file [path]   (echo first non-empty/non-comment line of path,
#                                or any VERSION* under repo root; falls back to "v0.0.0")
#   - resolve_image_tag VAR [path] (per-image env > IMAGE_TAG > version file > "v0.0.0")
#   - warn_if_version_default    (one-shot warn when VERSION file is missing/empty)
#   - resolve_docker_registry    (shell env > REGISTRY file > detect_default_registry())
#   - resolve_content_env_file   (shell env CONTENT_ENV_FILE > default cms/.env)
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
    if command -v timeout &> /dev/null; then
        timeout 5 docker info &> /dev/null
    else
        # Fallback: run in background, kill after timeout.
        docker info &> /dev/null &
        local pid=$!
        # shellcheck disable=SC2064
        (sleep 5 && kill -0 $pid 2>/dev/null && kill $pid 2>/dev/null) &
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

# detect_default_registry  → prints "docker.io/<user>" (or "" if unknown).
# Used as a best-effort guess for DOCKER_REGISTRY when the user hasn't
# configured one. The user is expected to edit .env afterwards.
detect_default_registry() {
    local user="${USER:-}"
    if [ -z "$user" ] && command -v whoami &> /dev/null; then
        user=$(whoami 2>/dev/null || echo "")
    fi
    if [ -n "$user" ] && [ "$user" != "root" ]; then
        echo "docker.io/${user}"
    else
        # No usable username (root, container, no whoami): leave empty so
        # the user picks one explicitly. Empty = local-only mode.
        echo ""
    fi
}

# ---------------------------------------------------------------------------
# Version resolution
# ---------------------------------------------------------------------------
# The project's image tags (db + backend + frontend) all default to the
# contents of a VERSION file in the repo root, with shell-env overrides.
# The dev and prod run scripts also call resolve_image_tag so the image
# they pull matches the one that was built.
#
# The repo now carries TWO version files so dev and prod can drift
# independently:
#   VERSION.dev   → tag for english_backend_dev / english_frontend_dev
#   VERSION.prod  → tag for english_db_content / english_backend / english_frontend
# (db is "prod-bound" content: it's shared by both targets, so dev always
# reads db's tag from VERSION.prod.)
#
# Resolution order (highest priority first):
#   1. Per-image env var, e.g. BACKEND_IMAGE_TAG=v1.2.3
#   2. Generic IMAGE_TAG env var (CI convenience — bumps all images at once)
#   3. The VERSION file path passed in (resolved by read_version_file)
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
        # Match any VERSION* file (VERSION, VERSION.dev, VERSION.prod, ...).
        # nullglob means an empty expansion doesn't produce a literal pattern.
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

# read_version_file [path]  → echoes the first non-empty, non-comment line
# of $path (stripped of BOM / CR / surrounding whitespace), or "v0.0.0" if
# the file is missing or contains no usable content.
#
# If $path is empty/unset, falls back to scanning the repo root for any
# VERSION* file (priority: VERSION → VERSION.prod → VERSION.dev) — this is
# the back-compat path for callers that haven't been updated yet.
read_version_file() {
    local path="${1:-}"
    if [ -z "$path" ]; then
        local root
        root="$(find_repo_root)"
        if [ -z "$root" ]; then
            echo "v0.0.0"
            return 0
        fi
        # Priority order for the implicit lookup. New callers should always
        # pass the path explicitly; this is purely a safety net.
        for path in "$root/VERSION" "$root/VERSION.prod" "$root/VERSION.dev"; do
            if [ -f "$path" ]; then break; fi
            path=""
        done
        if [ -z "$path" ]; then
            echo "v0.0.0"
            return 0
        fi
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
# Usage (callers should always pass the path of the VERSION file):
#       resolve_image_tag DB_IMAGE_TAG       VERSION.prod
#       resolve_image_tag BACKEND_IMAGE_TAG  VERSION.dev
#       resolve_image_tag FRONTEND_IMAGE_TAG VERSION.prod
resolve_image_tag() {
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
    local resolved
    resolved="$(read_version_file "$path")"
    printf -v "$var" '%s' "$resolved"
    export "$var"
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
# `docker push` / `docker pull` (e.g. docker.io/zhangyu528, ghcr.io/myorg).
# Unlike POSTGRES_PASSWORD or AI_API_KEY, it is NOT a personal secret — it
# is project config that the whole team shares. It therefore lives in a
# committed REGISTRY file at the repo root (symmetric with VERSION.dev /
# VERSION.prod), not in the gitignored cms/.env.
#
# Resolution order (highest priority first):
#   1. Shell env:    export DOCKER_REGISTRY=docker.io/youruser
#   2. REGISTRY file at repo root (first non-empty/non-comment DOCKER_REGISTRY= line)
#   3. Auto-detect:  detect_default_registry() (docker.io/$USER or "")
#   4. ""           (local-only mode — push is disabled)
#
# An empty/unset result is NOT an error: target hosts in local-only mode
# (no DOCKER_REGISTRY anywhere) work fine — they just skip the push /
# skip the auto-pull. Push scripts treat empty as a hard fail (since
# pushing with no namespace is meaningless), but the resolver itself
# always succeeds.

# read_registry_file [path]  → echoes the first non-empty/non-comment
# DOCKER_REGISTRY= value found in $path (strips `DOCKER_REGISTRY=` prefix,
# surrounding whitespace, CR, and any inline comment after a `#`).
# Echoes "" if the file is missing or has no usable line.
read_registry_file() {
    local path="${1:-}"
    if [ -z "$path" ] || [ ! -f "$path" ]; then
        echo ""
        return 0
    fi
    local v
    v="$(awk 'NF && substr($0,1,1) != "#" {
            if (match($0, /^[[:space:]]*DOCKER_REGISTRY[[:space:]]*=/)) {
                val = substr($0, RSTART + RLENGTH);
                gsub(/\r/, "", val);
                sub(/[[:space:]]*#.*/, "", val);
                gsub(/^[[:space:]]+|[[:space:]]+$/, "", val);
                print val;
                exit
            }
        }' "$path")"
    echo "${v:-}"
}

# resolve_docker_registry  → sets $DOCKER_REGISTRY in the caller's scope
# (and exports it) following the chain above. Always succeeds; an empty
# result means "local-only mode".
#
# "Shell env wins" is checked by set-ness, not by non-emptiness — so
# `DOCKER_REGISTRY= ./script` (explicit empty) forces local-only mode
# instead of falling through to auto-detect. Without this, an empty
# DOCKER_REGISTRY env var would be silently re-detected to
# `docker.io/$USER` on hosts where that succeeds, turning an
# operator's "I want local-only" intent into a push-mode run.
#
# Usage:
#   source lib.sh
#   resolve_docker_registry
#   echo "$DOCKER_REGISTRY"
resolve_docker_registry() {
    # 1. Shell env wins — even if explicitly empty (see note above).
    if [ -n "${DOCKER_REGISTRY+x}" ]; then
        export DOCKER_REGISTRY
        _DOCKER_REGISTRY_SOURCE="shell"
        export _DOCKER_REGISTRY_SOURCE
        return 0
    fi
    # 2. REGISTRY file at repo root.
    local root registry_path file_val
    root="$(find_repo_root)"
    if [ -n "$root" ]; then
        registry_path="$root/REGISTRY"
        file_val="$(read_registry_file "$registry_path")"
        if [ -n "$file_val" ]; then
            DOCKER_REGISTRY="$file_val"
            export DOCKER_REGISTRY
            _DOCKER_REGISTRY_SOURCE="file"
            export _DOCKER_REGISTRY_SOURCE
            return 0
        fi
    fi
    # 3. Auto-detect (best effort). Recorded as "detect" so callers that
    #    care about user intent (e.g. auto_pull_from_registry) can tell
    #    the difference between "operator configured a registry" and
    #    "we just guessed docker.io/$USER". Auto-detect is fine for push
    #    (solo dev convenience) but should NOT trigger auto-pull — that
    #    would fail with 429 on registries that don't host our image.
    DOCKER_REGISTRY="$(detect_default_registry)"
    export DOCKER_REGISTRY
    _DOCKER_REGISTRY_SOURCE="detect"
    export _DOCKER_REGISTRY_SOURCE
}

# ---------------------------------------------------------------------------
# Content-env-file resolution
# ---------------------------------------------------------------------------
# CONTENT_ENV_FILE is the path to the CMS-host secrets file (default
# cms/.env). It holds AI / TTS provider keys + optional POSTGRES_USER
# / POSTGRES_DB overrides. Resolved once at script start; consumers read
# the returned path and source it.
#
# Why `cms/.env` (not project root): the only consumer of this file
# is the CMS content-production runtime. Co-locating it with `cms/`
# keeps the runtime self-contained — it pairs with `cms/.local/audio`
# (audio staging dir) and lets the migrate sidecar reuse the existing
# `-v content:/content:ro` bind mount instead of a separate `-v $env:/$env`
# (less Docker plumbing, fewer Windows path-rewrite edge cases).
#
# Resolution order:
#   1. Shell env:    export CONTENT_ENV_FILE=staging.env
#   2. Default:      cms/.env under $PROJECT_ROOT
#
# Relative paths are project-root-relative (computed from $PROJECT_DIR if
# the caller has set it, otherwise from find_repo_root). Absolute paths
# are returned as-is.

# resolve_content_env_file  → echoes the absolute path to the CMS-host
# secrets file. Always succeeds — defaults to $PROJECT_ROOT/cms/.env.
#
# Callers should use this exactly once at the top of a script and store
# the result in a local var:
#   local env_file; env_file="$(resolve_content_env_file)"
#   [ -f "$env_file" ] || err "$env_file 不存在 — 跑 ./cms/scripts/env.sh init"
#   set -a; . "$env_file"; set +a
resolve_content_env_file() {
    local root="${PROJECT_DIR:-$(find_repo_root)}"
    local f="${CONTENT_ENV_FILE:-cms/.env}"
    if [[ "$f" = /* ]]; then
        echo "$f"
    else
        echo "$root/$f"
    fi
}

# ---------------------------------------------------------------------------
# Portable sed -i
# ---------------------------------------------------------------------------
# sed_inplace PATTERN FILE — in-place edit, compatible with GNU sed (Linux)
# and BSD sed (macOS). BSD requires an explicit empty argument after -i.
# Used by cms/scripts/env.sh to inject smart defaults into cms/.env.
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
