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
#   - compute_backend_content_hash / compute_frontend_content_hash
#                                  (7-char SHA256 of inputs that affect each dev image)
#   - compute_dev_image_tag [backend|frontend]
#                                  (c<content-hash7>[-dirty] — no branch)
#   - resolve_docker_registry    (shell env > REGISTRY file > detect_default_registry())
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
# Each segment owns its own VERSION file for **prod** tags (semver,
# manually bumped via `release.sh prod X.Y.Z`):
#
#   backend/VERSION                  ← english_backend (prod only)
#   frontend/VERSION                 ← english_frontend (prod only)
#   cms/VERSION                      ← placeholder (cms has no docker image
#                                       today; reserved for a future CMS pipeline
#                                       version stamp)
#
# **Dev** tags are NOT versioned. They are derived from current image
# CONTENT via `compute_backend_content_hash` /
# `compute_frontend_content_hash` and assembled by
# `compute_dev_image_tag [segment]` (format `c<hash7>[-dirty]`).
# Every change to an image input file (Dockerfile.dev / entrypoint.sh /
# requirements.txt / package*.json) produces a new tag; docs-only or
# bind-mount-src changes do not. This is by design:
#
#   - dev tag is automatic → no VERSION-file edits during dev iteration
#   - dev tag is content-derived → same content = same tag, even across branches
#   - dev tag is local-only → never pushed to any registry
#   - prod tag is explicit → semver, bumped only by `release.sh prod`
#
# The two paths are intentionally different: dev is fluid, prod is
# frozen at release points.
#
# One file per segment (no dev/prod split): backend/VERSION gates both the
# dev and prod backend image tags, frontend/VERSION gates both frontend
# image tags. Dev and prod streams therefore always release at the same
# per-segment version — when you bump backend, you bump both backend
# images at once.
#
# All callers resolve tags by passing an explicit relative path (relative to
# find_repo_root) — there is no implicit root-level fallback. There is no
# VERSION file at the repo root in the current layout; every segment owns
# its own file (e.g. db/VERSION, backend/VERSION) and callers pass the
# per-segment path explicitly.
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

# ---------------------------------------------------------------------------
# Dev image tag — content-hash based
# ---------------------------------------------------------------------------
# Dev tags reflect **image content** (what's baked into the image layers),
# NOT git state. Two builds at different commits that don't change any
# image-affecting file produce the same tag — no tag thrash, no phantom
# tags in `docker image ls`.
#
# Format: c<content-hash7>[-dirty]
#   clean working tree at HEAD         → cabc1234
#   local edit to a content input      → cabc1234-dirty
#
# Why "c" prefix:
#   A bare 7-char hex string looks ambiguous (could be a git sha). The
#   `c` prefix makes it unambiguous: `c1234af0` reads as "content hash
#   1234af0", distinct from git sha `1234af0`.
#
# Why NO branch in the tag:
#   - Same content on master / feat_x / detached HEAD should produce the
#     same tag — branch is a git workflow concept, not an image content
#     concept. Including branch just makes the same image wear N tags
#     for no benefit.
#   - If two branches really produce different content, their content
#     hashes will differ anyway — that's the signal that matters.
#
# Why content hash, not git SHA:
#   - docs-only commits → image unchanged → tag unchanged ✓
#   - bind-mount src changes (app/, frontend/src/) → image unchanged
#     (those files aren't COPY'd into the image) → tag unchanged ✓
#   - requirements.txt / package.json changes → image unchanged but
#     expected runtime behavior differs → tag SHOULD change (entrypoint
#     hash-aware reinstall picks it up) → tag changes ✓
#   - Dockerfile.dev / entrypoint.sh changes → image layers change →
#     tag changes ✓
#
# Why dirty, not git-state:
#   `-dirty` means "your local working tree differs from HEAD in a way
#   that affects image content". If you only edited CLAUDE.md, the
#   image is bit-identical to HEAD's — no `-dirty`. If you edited
#   backend/requirements.txt, the image's baked-in hash expectation
#   differs — `-dirty` so you don't accidentally reuse an image built
#   before your local edit.
#
# Each image segment computes its own content hash (its inputs differ):
#   - english_backend_dev  ← Dockerfile.dev + entrypoint.sh + requirements.txt
#   - english_frontend_dev ← Dockerfile.dev + entrypoint.sh + package.json/lock
# db/migrations/** is intentionally NOT included — migrations run
# host-side via ops/dev/migrate.sh, never inside the dev image. A
# migration change requires no image rebuild.

# _dev_image_inputs <segment> — print newline-separated list of files
# whose content affects the given segment's dev image. Used by
# compute_dev_image_tag. Hidden helper (underscore prefix).
#
# Args: backend | frontend
# Output: one path per line, relative to repo root.
_dev_image_inputs() {
    case "$1" in
        backend)
            printf '%s\n' \
                "backend/Dockerfile.dev" \
                "backend/entrypoint.sh" \
                "backend/requirements.txt"
            ;;
        frontend)
            printf '%s\n' \
                "frontend/Dockerfile.dev" \
                "frontend/entrypoint.sh" \
                "frontend/package.json" \
                "frontend/package-lock.json"
            ;;
        *)
            echo "[ERR] _dev_image_inputs: unknown segment '$1' (use backend|frontend)" >&2
            return 1
            ;;
    esac
}

# _file_content_for_hash <relpath> — emit the file's current content
# bytes for hashing. Prefers the HEAD-committed version (so two builds
# on the same commit produce identical hashes even if the working tree
# has unrelated dirty files), but falls back to the working-tree file
# when the file is locally modified.
#
# Why HEAD-first: the tag should be stable across commits that don't
# touch image inputs. A README typo shouldn't perturb the hash.
#
# Why fall back to working tree: a locally-edited requirements.txt must
# change the hash — otherwise we'd reuse the old image and silently
# ignore the local edit. Detect "locally modified" via `git diff` for
# the file, and use the working-tree content in that case.
_file_content_for_hash() {
    local relpath="$1"
    if git diff --quiet -- "$relpath" 2>/dev/null \
       && git diff --cached --quiet -- "$relpath" 2>/dev/null; then
        # File matches HEAD (no unstaged, no staged changes). Hash the
        # committed version — stable across unrelated dirty files.
        git show "HEAD:${relpath}" 2>/dev/null
    else
        # File is locally modified. Use working-tree content so the hash
        # reflects what would actually be baked into the image.
        cat -- "$relpath"
    fi
}

# _dev_image_content_dirty <segment> — print 1 if any input file for the
# segment differs from HEAD (working tree or staged), 0 if all inputs
# match HEAD. Used by compute_dev_image_tag to decide the `-dirty`
# suffix.
_dev_image_content_dirty() {
    local relpath
    while IFS= read -r relpath; do
        [ -z "$relpath" ] && continue
        if ! git diff --quiet -- "$relpath" 2>/dev/null \
           || ! git diff --cached --quiet -- "$relpath" 2>/dev/null; then
            return 0  # 0 = "this segment is dirty"
        fi
    done < <(_dev_image_inputs "$1")
    return 1  # 1 = "this segment is clean"
}

# compute_backend_content_hash / compute_frontend_content_hash — echo
# the 7-char content hash for the segment's dev image. Format: lowercase
# hex, no `c` prefix (caller adds it when assembling the tag).
#
# Returns the empty string on hash failure. Callers should treat empty
# as "couldn't compute" and abort.
_compute_dev_content_hash() {
    local segment="$1"
    if ! git rev-parse --git-dir >/dev/null 2>&1; then
        echo "[ERR] compute_${segment}_content_hash: not in a git repo" >&2
        return 1
    fi

    local hasher=""
    if command -v sha256sum &> /dev/null; then
        hasher="sha256sum"
    elif command -v shasum &> /dev/null; then
        hasher="shasum -a 256"
    else
        echo "[ERR] compute_${segment}_content_hash: need sha256sum or shasum" >&2
        return 1
    fi

    # Concatenate every input file's content (in declared order) and
    # hash the concatenation. The declared order is stable, so two
    # calls with the same inputs produce the same hash. We hash the
    # raw bytes — no file separators — because adding separators would
    # be redundant (each file's bytes are already distinct enough).
    #
    # Use git ls-files --error-unmatch to fail loudly if an input path
    # is missing from the index (typo in _dev_image_inputs, or file
    # never committed). Better to error here than silently hash empty
    # input and produce a hash that collides with other missing files.
    local relpath content
    local concat=""
    while IFS= read -r relpath; do
        [ -z "$relpath" ] && continue
        if ! git ls-files --error-unmatch -- "$relpath" >/dev/null 2>&1; then
            echo "[ERR] compute_${segment}_content_hash: input not in index: $relpath" >&2
            return 1
        fi
        content="$(_file_content_for_hash "$relpath")" || {
            echo "[ERR] compute_${segment}_content_hash: cannot read $relpath" >&2
            return 1
        }
        concat="${concat}${content}"
    done < <(_dev_image_inputs "$segment")

    # Hash + truncate to 7 hex chars.
    printf '%s' "$concat" | $hasher | awk '{print substr($1,1,7)}'
}
compute_backend_content_hash()  { _compute_dev_content_hash backend;  }
compute_frontend_content_hash() { _compute_dev_content_hash frontend; }

# compute_dev_image_tag [segment] — echo the dev image tag for the
# given segment (default: backend). Output format: c<hash7>[-dirty].
#
# Args: backend (default) | frontend
# Errors: returns 1 if not in a git repo, no usable hasher, or any
# input file is missing from the index.
compute_dev_image_tag() {
    local segment="${1:-backend}"

    local content_hash dirty=""
    content_hash="$(_compute_dev_content_hash "$segment")" || return 1
    if [ -z "$content_hash" ]; then
        echo "[ERR] compute_dev_image_tag($segment): empty content hash" >&2
        return 1
    fi

    # `-dirty` iff the segment's inputs are locally modified. Document /
    # cms/ migrations edits don't trigger `-dirty` for either image.
    if _dev_image_content_dirty "$segment"; then
        dirty="-dirty"
    fi

    printf 'c%s%s' "$content_hash" "$dirty"
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
# committed REGISTRY file at the repo root (symmetric with the per-segment
# VERSION files like db/VERSION / backend/VERSION), not in a gitignored
# .env (the historical cms/.env is gone; secrets now live in GH Environments
# and are fetched via scripts/secrets/fetch_secrets.sh eval-cms).
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
