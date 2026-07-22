#!/bin/bash
#
# db/scripts/lib.sh — shared helpers for cloud-db (TencentDB) scripts.
#
# This file is the cloud-db counterpart to ops/lib.sh's
# db_assemble_url: both build DATABASE_URL, but they target different
# physical dbs. They are intentionally kept parallel, not chained, so
# either can be invoked depending on which script the caller is running.
#
# What's here:
#   - resolve_tencent_db_host        : host:port from .secrets/tencent_db_host
#   - resolve_tencent_db_user        : "english_dev_${USER}" (or english_prod_user)
#   - resolve_tencent_db_password    : from .secrets/tencent_db_password (or _prod_)
#   - render_db_name [tier]          : "english_dev_${USER}__${SHA}" or "english_dev_${USER}"
#                                      tier = "prod" → "english_prod", "dev" → default
#   - resolve_dev_db_url             : full DSN for dev target (alice's db)
#   - resolve_prod_db_url            : full DSN for prod target (english_prod db)
#
# Layout of .secrets/ (all chmod 600, all gitignored):
#   tencent_db_host              # host:port of the TencentDB instance (shared infra)
#   tencent_db_user              # english_dev_alice (dev host)
#   tencent_db_password          # 24-char url-safe (dev host)
#   tencent_db_admin_url         # postgres://postgres:admin-pwd@host/postgres
#                                #   used ONCE by bootstrap_tencent.sh, then locked down
#   tencent_db_prod_user         # english_prod_user (prod host)
#   tencent_db_prod_password     # (prod host)
#   database_url                 # rendered DSN, consumed by docker-compose *_FILE
#
# Layout of .dev/ (gitignored):
#   dev-db-name                  # persisted db name for current branch/SHA
#
# Resolution chain (all functions follow this pattern):
#   1. Shell env (explicit override, e.g. CI / GH Secrets — operator
#      usually runs `eval $(scripts/secrets/fetch_secrets.sh eval-db)`
#      once per shell to populate TENCENT_DB_* / TENCENT_DB_ADMIN_URL
#      from GitHub Actions Secrets without writing to disk)
#   2. Persisted file (.secrets/... or .dev/dev-db-name)
#   3. Derived from $USER + git state
#   4. Friendly error
#
# "Shell env wins" — same precedent as ops/lib.sh::resolve_docker_registry:
# an explicit empty env (`DATABASE_URL= script`) is honored, not silently
# overwritten with the file value.

# Source guard — prevent double-sourcing.
if [ -n "${_DB_LIB_SOURCED:-}" ]; then
    return 0
fi
_DB_LIB_SOURCED=1

# ---------------------------------------------------------------------------
# Project root
# ---------------------------------------------------------------------------
_db_lib_find_repo_root() {
    local start="${1:-$(dirname "${BASH_SOURCE[1]:-$0}")}"
    local dir
    dir="$(cd "$start" 2>/dev/null && pwd)" || return 0
    while [ -n "$dir" ] && [ "$dir" != "/" ]; do
        if [ -d "$dir/.git" ]; then
            echo "$dir"
            return 0
        fi
        if [ -f "$dir/REGISTRY" ] || [ -f "$dir/db/VERSION" ]; then
            echo "$dir"
            return 0
        fi
        dir="$(dirname "$dir")"
    done
    echo ""
}

# ---------------------------------------------------------------------------
# Host
# ---------------------------------------------------------------------------
# resolve_tencent_db_host — echoes "host:port" from .secrets/tencent_db_host,
# or TENCENT_DB_HOST env. Falls back to localhost:5432 (dev-loopback default;
# operator is expected to be SSH-tunneling or on the same VPC).
# Returns 1 with a friendly err if neither is set on a fresh host.
resolve_tencent_db_host() {
    if [ -n "${TENCENT_DB_HOST:-}" ]; then
        echo "$TENCENT_DB_HOST"
        return 0
    fi
    local root="$(_db_lib_find_repo_root)"
    if [ -n "$root" ] && [ -f "$root/.secrets/tencent_db_host" ]; then
        cat "$root/.secrets/tencent_db_host"
        return 0
    fi
    echo "[ERR]  TENCENT_DB_HOST is not set and .secrets/tencent_db_host missing." >&2
    echo "       Run ./ops/dev/setup.sh bootstrap first, or export TENCENT_DB_HOST=host:port" >&2
    return 1
}

# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------
# _read_secret <path>  — echoes the trimmed contents of <path>, or "" if missing.
# Internal helper. External callers should use the resolve_*_password funcs.
_read_secret() {
    local path="$1"
    [ -f "$path" ] || return 0
    # Trim CR + leading/trailing whitespace + final newline.
    awk '{ gsub(/\r/, ""); sub(/^[[:space:]]+|[[:space:]]+$/, ""); print }' "$path"
}

# resolve_tencent_db_user [tier]  → "english_dev_${USER}" (tier=dev, default)
#                                  or "english_prod_user"      (tier=prod)
# Override via TENCENT_DB_USER / TENCENT_DB_PROD_USER env, then .secrets/.
resolve_tencent_db_user() {
    local tier="${1:-dev}"
    if [ "$tier" = "prod" ]; then
        if [ -n "${TENCENT_DB_PROD_USER:-}" ]; then
            echo "$TENCENT_DB_PROD_USER"
            return 0
        fi
        local root="$(_db_lib_find_repo_root)"
        if [ -n "$root" ] && [ -f "$root/.secrets/tencent_db_prod_user" ]; then
            _read_secret "$root/.secrets/tencent_db_prod_user"
            return 0
        fi
        echo "english_prod_user"
        return 0
    fi
    # dev tier
    if [ -n "${TENCENT_DB_USER:-}" ]; then
        echo "$TENCENT_DB_USER"
        return 0
    fi
    local root="$(_db_lib_find_repo_root)"
    if [ -n "$root" ] && [ -f "$root/.secrets/tencent_db_user" ]; then
        _read_secret "$root/.secrets/tencent_db_user"
        return 0
    fi
    # Derived default. Uses $USER if set, else "runner" (CI / containers).
    local user="${USER:-}"
    if [ -z "$user" ] && command -v whoami &> /dev/null; then
        user=$(whoami 2>/dev/null || echo "")
    fi
    if [ -z "$user" ]; then
        user="runner"
    fi
    echo "english_dev_${user}"
}

# resolve_tencent_db_password [tier] — echoes the password for the given tier.
# Returns 1 with friendly err if missing. The error message points at the
# right .secrets/ file for the tier.
resolve_tencent_db_password() {
    local tier="${1:-dev}"
    if [ "$tier" = "prod" ]; then
        if [ -n "${TENCENT_DB_PROD_PASSWORD:-}" ]; then
            echo "$TENCENT_DB_PROD_PASSWORD"
            return 0
        fi
        local root="$(_db_lib_find_repo_root)"
        if [ -n "$root" ] && [ -f "$root/.secrets/tencent_db_prod_password" ]; then
            _read_secret "$root/.secrets/tencent_db_prod_password"
            return 0
        fi
        echo "[ERR]  TENCENT_DB_PROD_PASSWORD missing — run ./ops/prod/setup.sh bootstrap" >&2
        return 1
    fi
    # dev tier
    if [ -n "${TENCENT_DB_PASSWORD:-}" ]; then
        echo "$TENCENT_DB_PASSWORD"
        return 0
    fi
    local root="$(_db_lib_find_repo_root)"
    if [ -n "$root" ] && [ -f "$root/.secrets/tencent_db_password" ]; then
        _read_secret "$root/.secrets/tencent_db_password"
        return 0
    fi
    echo "[ERR]  TENCENT_DB_PASSWORD missing — run ./ops/dev/setup.sh bootstrap" >&2
    return 1
}

# ---------------------------------------------------------------------------
# DB name (per-user / per-branch)
# ---------------------------------------------------------------------------
# render_db_name [start_dir] — echoes the database name for the current
# git state of [start_dir] (default: repo root).
#
# Naming rules:
#   - On master/main:        english_dev_${USER}
#   - On any other branch:   english_dev_${USER}__<sanitized branch or short SHA>
#   - Detached HEAD:         english_dev_${USER}__<short SHA>
#   - $USER empty (CI):      english_dev_runner__<short SHA>
#
# Override chain:
#   1. DEV_DB_NAME env             (CI / tests / explicit override)
#   2. .dev/dev-db-name            (persisted by ops/dev/setup.sh after first render)
#   3. Derived from git
#
# The persisted file lets the same db be reused across restarts on the
# same branch — without it, switching git branches and back would mint
# a new db name every time, defeating the "preserve state across
# lifecycle.sh restart" goal.
#
# Sanitization: branch names can contain '/' and other URL-unsafe chars.
# We allow [A-Za-z0-9_-] only, collapse others to '_', and cap at 40
# chars (Postgres identifier limit is 63, this leaves headroom for the
# fixed prefix).
render_db_name() {
    local start="${1:-$(_db_lib_find_repo_root)}"
    if [ -z "$start" ]; then
        echo "[ERR]  render_db_name: cannot find repo root" >&2
        return 1
    fi
    # 1. Explicit override.
    if [ -n "${DEV_DB_NAME:-}" ]; then
        echo "$DEV_DB_NAME"
        return 0
    fi
    # 2. Persisted.
    if [ -f "$start/.dev/dev-db-name" ]; then
        _read_secret "$start/.dev/dev-db-name"
        return 0
    fi
    # 3. Derived.
    local branch short_sha user prefix suffix
    branch="$(cd "$start" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
    short_sha="$(cd "$start" && git rev-parse --short HEAD 2>/dev/null || echo "")"
    user="${USER:-}"
    if [ -z "$user" ] && command -v whoami &> /dev/null; then
        user=$(whoami 2>/dev/null || echo "")
    fi
    if [ -z "$user" ]; then
        user="runner"
    fi

    prefix="english_dev_${user}"

    # Detached HEAD or non-branch state → SHA only.
    if [ -z "$branch" ] || [ "$branch" = "HEAD" ]; then
        if [ -z "$short_sha" ]; then
            echo "[ERR]  render_db_name: not in a git repo (no branch, no SHA)" >&2
            return 1
        fi
        echo "${prefix}__${short_sha}"
        return 0
    fi
    # On master/main → no suffix.
    if [ "$branch" = "master" ] || [ "$branch" = "main" ]; then
        echo "$prefix"
        return 0
    fi
    # Other branch → sanitize and append.
    suffix="$(echo "$branch" | sed -E 's|[^A-Za-z0-9_-]|_|g' | cut -c1-40)"
    echo "${prefix}__${suffix}"
}

# persist_db_name <name> — writes <name> to .dev/dev-db-name for future
# calls. Caller has already decided what name to use; this just records it.
persist_db_name() {
    local name="$1"
    local root="$(_db_lib_find_repo_root)"
    if [ -z "$root" ]; then
        echo "[ERR]  persist_db_name: cannot find repo root" >&2
        return 1
    fi
    mkdir -p "$root/.dev"
    chmod 700 "$root/.dev"
    printf '%s\n' "$name" > "$root/.dev/dev-db-name"
    chmod 600 "$root/.dev/dev-db-name"
}

# ---------------------------------------------------------------------------
# Full DSN assembly
# ---------------------------------------------------------------------------
# _url_quote <str> — url-encodes a string using python3 if available,
# else emits it as-is (gen_secret output is already url-safe; manual
# passwords may not be, so we encode defensively).
_url_quote() {
    if command -v python3 &> /dev/null; then
        python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
    else
        echo "$1"
    fi
}

# _tencent_assemble <user> <password> <db_name> — assembles a postgres://
# DSN. Internal; use resolve_dev_db_url / resolve_prod_db_url from outside.
_tencent_assemble() {
    local user="$1" password="$2" db_name="$3"
    local host
    if ! host="$(resolve_tencent_db_host)"; then
        return 1
    fi
    local enc_user enc_pw
    enc_user="$(_url_quote "$user")"
    enc_pw="$(_url_quote "$password")"
    echo "postgresql://${enc_user}:${enc_pw}@${host}/${db_name}"
}

# resolve_dev_db_url  → renders and exports DATABASE_URL for the dev host.
# Resolution chain: shell env > .secrets/database_url > computed.
# Side effect: exports DATABASE_URL in the caller's shell.
resolve_dev_db_url() {
    # 1. Explicit shell env wins (also honors explicit empty).
    if [ -n "${DATABASE_URL+x}" ]; then
        export DATABASE_URL
        return 0
    fi
    # 2. Persisted file (written by setup.sh after first resolve).
    local root="$(_db_lib_find_repo_root)"
    if [ -n "$root" ] && [ -f "$root/.secrets/database_url" ]; then
        local persisted
        persisted="$(_read_secret "$root/.secrets/database_url")"
        if [ -n "$persisted" ]; then
            DATABASE_URL="$persisted"
            export DATABASE_URL
            return 0
        fi
    fi
    # 3. Compute from .secrets/ + render_db_name().
    local user password db_name
    user="$(resolve_tencent_db_user dev)"
    if ! password="$(resolve_tencent_db_password dev)"; then
        return 1
    fi
    if ! db_name="$(render_db_name)"; then
        return 1
    fi
    if ! DATABASE_URL="$(_tencent_assemble "$user" "$password" "$db_name")"; then
        return 1
    fi
    export DATABASE_URL
}

# resolve_prod_db_url → renders and exports DATABASE_URL for the prod host.
# prod db name is fixed at "english_prod" — no $USER / SHA derivation.
resolve_prod_db_url() {
    if [ -n "${DATABASE_URL+x}" ]; then
        export DATABASE_URL
        return 0
    fi
    local root="$(_db_lib_find_repo_root)"
    if [ -n "$root" ] && [ -f "$root/.secrets/database_url" ]; then
        local persisted
        persisted="$(_read_secret "$root/.secrets/database_url")"
        if [ -n "$persisted" ]; then
            DATABASE_URL="$persisted"
            export DATABASE_URL
            return 0
        fi
    fi
    local user password db_name="english_prod"
    user="$(resolve_tencent_db_user prod)"
    if ! password="$(resolve_tencent_db_password prod)"; then
        return 1
    fi
    if ! DATABASE_URL="$(_tencent_assemble "$user" "$password" "$db_name")"; then
        return 1
    fi
    export DATABASE_URL
}

# resolve_admin_url → echoes the admin DSN from .secrets/tencent_db_admin_url.
# Bootstrap-only. Returns 1 if missing. The file is intentionally not
# chmod-locked here so bootstrap_tencent.sh can decide what to do after
# using it once (typically: chmod 600 + move out of easy reach).
resolve_admin_url() {
    if [ -n "${TENCENT_DB_ADMIN_URL:-}" ]; then
        echo "$TENCENT_DB_ADMIN_URL"
        return 0
    fi
    local root="$(_db_lib_find_repo_root)"
    if [ -n "$root" ] && [ -f "$root/.secrets/tencent_db_admin_url" ]; then
        _read_secret "$root/.secrets/tencent_db_admin_url"
        return 0
    fi
    echo "[ERR]  admin URL missing — bootstrap not done yet" >&2
    echo "       Run ./ops/dev/setup.sh bootstrap (or ./ops/prod/setup.sh bootstrap) first" >&2
    return 1
}