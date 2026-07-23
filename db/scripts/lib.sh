#!/bin/bash
#
# db/scripts/lib.sh — shared helpers for db scripts (local docker postgres).
#
# The runtime database is now a `postgres:15-alpine` container managed
# by docker compose (see docker-compose.yml / docker-compose.dev.yml).
# DATABASE_URL is supplied to the compose containers via the `environment:`
# block in the compose file itself; the host-side shell scripts in
# db/scripts/ don't need a multi-step DSN assembly like the old
# docker postgres era. They just need a single helper that:
#
#   - returns $DATABASE_URL if already in env (typical — compose sets it
#     for the container, and host-side scripts that need to talk to the
#     container can `eval "$(scripts/secrets/fetch_secrets.sh eval-db)"`
#     or just hard-code `postgresql://...@localhost:5432/...`)
#   - assembles from POSTGRES_* as a defensive fallback for self-hosted /
#     CI / ad-hoc CLI use
#
# No more:
#   - TENCENT_DB_HOST / TENCENT_DB_USER / TENCENT_DB_PASSWORD env vars
#   - .secrets/db_password / tencent_db_prod_* files
#   - per-branch db name derivation (the mode-2 design was specific to
#     a shared docker postgres; local docker means one fixed db per host)

# Source guard — prevent double-sourcing.
if [ -n "${_DB_LIB_SOURCED:-}" ]; then
    return 0
fi
_DB_LIB_SOURCED=1

# ---------------------------------------------------------------------------
# DSN resolution
# ---------------------------------------------------------------------------
# db_assemble_url — make sure DATABASE_URL is non-empty (and exported),
# so downstream python (migrations.runner, importer) can read it from
# the process env. Don't print, don't write anywhere — pure env var.
#
# Resolution chain:
#   1. $DATABASE_URL already in env (operator set it, or compose did)
#   2. Assemble from POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_HOST /
#      POSTGRES_PORT / POSTGRES_DB (suitable for self-hosted / CI)
#
# "Shell env wins" — same precedent as ops/lib.sh::resolve_docker_registry:
# an explicit empty env (`DATABASE_URL= script`) is honored, not silently
# overwritten with the file value.
db_assemble_url() {
    if [ -n "${DATABASE_URL:-}" ]; then
        export DATABASE_URL
        return 0
    fi

    local user="${POSTGRES_USER:-english_user}"
    local password="${POSTGRES_PASSWORD:-}"
    local host="${POSTGRES_HOST:-localhost}"
    local port="${POSTGRES_PORT:-5432}"
    local db="${POSTGRES_DB:-english_learning}"

    if [ -z "$password" ]; then
        err "DATABASE_URL/POSTGRES_PASSWORD 未设置。"
        err "  1. Docker compose 路径: env DATABASE_URL 由 compose 自动注入,"
        err "     直接跑 python3 -m migrations.runner 即可。"
        err "  2. 自管 / CI 路径: export DATABASE_URL=postgresql://user:pw@host:5432/dbname"
        err "  3. 临时组装: export POSTGRES_USER=foo POSTGRES_PASSWORD=bar POSTGRES_HOST=localhost"
        return 1
    fi

    # url-encode the password (handles special chars). Requires python3.
    local encoded_pw
    encoded_pw="$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$password" 2>/dev/null || echo "$password")"

    export DATABASE_URL="postgresql://${user}:${encoded_pw}@${host}:${port}/${db}"
    return 0
}
