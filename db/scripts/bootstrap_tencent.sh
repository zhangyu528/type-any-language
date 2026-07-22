#!/bin/bash
#
# bootstrap_tencent.sh — first-time setup of per-host credentials in
# the shared TencentDB instance.
#
# What this does:
#   1. Reads the admin DSN from .secrets/tencent_db_admin_url (created
#      by setup.sh from the operator-supplied bootstrap password).
#   2. Creates ROLE english_dev_${USER} (LOGIN, with a freshly-generated
#      password). Idempotent — skips if role exists.
#   3. Resolves the role password with this precedence:
#        a. TENCENT_DB_PASSWORD env var (GH Secrets path — no disk write)
#        b. .secrets/tencent_db_password file (legacy standalone mode)
#      If neither is present and no role exists, abort with a hint to
#      run `eval $(scripts/secrets/fetch_secrets.sh eval-db)` or to
#      generate a password manually.
#   4. Computes the db name for the current git state (master →
#      english_dev_${USER}, feature branch → ...__<sha>).
#   5. Creates the DATABASE (idempotent — skips if exists).
#   6. GRANTs ALL on that database to the role (idempotent).
#   7. Renders the final DSN to .secrets/database_url (the file the
#      docker-compose *FILE indirection reads — kept on disk because
#      compose secrets indirection requires a file mount).
#   8. Persists the db name to .dev/dev-db-name (so subsequent restarts
#      on the same branch reuse the same db).
#
# What this does NOT do:
#   - Apply schema migrations. That's db/scripts/migrate.sh's job.
#   - Import staging files. That's db/scripts/import_staging.sh's job.
#   - Lock down the admin URL. setup.sh handles that (it writes the
#     admin URL into .secrets/ then chmods 600; this script assumes
#     it's already in place when it runs).
#
# Idempotency contract:
#   - Safe to re-run on an already-bootstrapped host: CREATE ROLE IF NOT
#     EXISTS, CREATE DATABASE IF NOT EXISTS (via pg_database lookup),
#     GRANT is idempotent, the persisted password is reused.
#   - The one non-idempotent case is: password was deleted from
#     .secrets/tencent_db_password while the role still exists in db.
#     In that case the role will retain the OLD password, but the local
#     file gets a NEW password → DSN won't authenticate. To recover,
#     either manually \password english_dev_${USER} in psql, or delete
#     the role first: DROP ROLE english_dev_${USER}; (then re-run).
#
# Usage:
#   ./ops/dev/setup.sh bootstrap   # typical entry — does all of:
#                                   #   1. ask for admin URL,
#                                   #   2. write .secrets/tencent_db_admin_url,
#                                   #   3. invoke this script,
#                                   #   4. lock down admin URL.
#   ./db/scripts/bootstrap_tencent.sh   # direct invocation (rare)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$SCRIPT_DIR/lib.sh"

# Source ops/lib.sh only for gen_secret. We don't import its db_assemble_url
# (that's the self-hosted chain; we want the cloud-db one from db/scripts/lib.sh).
source "$PROJECT_DIR/ops/lib.sh"

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------
if ! command -v psql &> /dev/null; then
    err "psql not found — install postgresql-client"
    exit 1
fi

if ! command -v python3 &> /dev/null; then
    err "python3 not found — required for url-encoding"
    exit 1
fi

# Resolve admin URL — this is the entry gate. If it's not there, the
# operator hasn't run setup.sh yet (which prompts for the bootstrap
# password and writes the admin URL file).
if ! ADMIN_URL="$(resolve_admin_url 2>/dev/null)"; then
    err "Cannot resolve admin URL"
    err "  Run ./ops/dev/setup.sh bootstrap first — it will prompt you for"
    err "  the one-time bootstrap password from the TencentDB console."
    exit 1
fi

USER_NAME="${USER:-}"
if [ -z "$USER_NAME" ] && command -v whoami &> /dev/null; then
    USER_NAME=$(whoami 2>/dev/null || echo "")
fi
if [ -z "$USER_NAME" ]; then
    USER_NAME="runner"
fi

ROLE_NAME="english_dev_${USER_NAME}"
PASSWORD_FILE="$PROJECT_DIR/.secrets/tencent_db_password"
USER_FILE="$PROJECT_DIR/.secrets/tencent_db_user"
HOST_FILE="$PROJECT_DIR/.secrets/tencent_db_host"

mkdir -p "$PROJECT_DIR/.secrets"
chmod 700 "$PROJECT_DIR/.secrets"

# ---------------------------------------------------------------------------
# Step 1: persist the host (one-time, from admin URL)
# ---------------------------------------------------------------------------
# Parse "postgres://postgres:xxx@host:port/postgres" → host:port.
# python3's urllib.parse is the most robust way on Windows where
# hostname extraction from a DSN is messy.
TENCENT_HOST="$(python3 -c '
import sys, urllib.parse
url = sys.argv[1]
p = urllib.parse.urlparse(url)
print(f"{p.hostname}:{p.port}" if p.port else p.hostname)
' "$ADMIN_URL")"

if [ -z "$TENCENT_HOST" ]; then
    err "Failed to parse host from admin URL"
    exit 1
fi

if [ ! -f "$HOST_FILE" ] || [ -z "$(cat "$HOST_FILE" 2>/dev/null)" ]; then
    if [ -n "${TENCENT_DB_HOST:-}" ]; then
        info "TENCENT_DB_HOST in env (GH Secrets path) - skip $HOST_FILE write"
    else
        printf '%s\n' "$TENCENT_HOST" > "$HOST_FILE"
        chmod 600 "$HOST_FILE"
        ok "wrote $HOST_FILE (TENCENT_HOST=$TENCENT_HOST)"
    fi
else
    info "host already known: $(cat "$HOST_FILE")"
fi

# Persist user name (cheap; lets ops/dev/setup.sh later know what user
# this host claims to be). Env override TENCENT_DB_USER wins; in that
# case we skip the file write so the GH-secrets path stays disk-clean.
if [ ! -f "$USER_FILE" ] || [ "$(cat "$USER_FILE" 2>/dev/null)" != "$ROLE_NAME" ]; then
    if [ -n "${TENCENT_DB_USER:-}" ] && [ "${TENCENT_DB_USER}" = "$ROLE_NAME" ]; then
        info "TENCENT_DB_USER=$ROLE_NAME in env (GH Secrets path) - skip $USER_FILE write"
    else
        printf '%s\n' "$ROLE_NAME" > "$USER_FILE"
        chmod 600 "$USER_FILE"
        ok "wrote $USER_FILE (role=$ROLE_NAME)"
    fi
fi

# ---------------------------------------------------------------------------
# Step 2: password (reuse existing, else generate)
# ---------------------------------------------------------------------------
if [ -f "$PASSWORD_FILE" ] && [ -n "$(cat "$PASSWORD_FILE" 2>/dev/null)" ]; then
    PASSWORD="$(cat "$PASSWORD_FILE")"
    info "reusing existing password from $PASSWORD_FILE"
elif [ -n "${TENCENT_DB_PASSWORD:-}" ]; then
    PASSWORD="${TENCENT_DB_PASSWORD}"
    info "using TENCENT_DB_PASSWORD from env (GH Secrets path) - no file write"
else
    err "TENCENT_DB_PASSWORD unset and $PASSWORD_FILE missing"
    err "  GH path: eval \$(scripts/secrets/fetch_secrets.sh eval-db)"
    err "  Standalone: gen_secret then write to $PASSWORD_FILE"
    exit 1
fi

# ---------------------------------------------------------------------------
# Step 3: CREATE ROLE (idempotent)
# ---------------------------------------------------------------------------
ROLE_EXISTS="$(psql "$ADMIN_URL" -tAc "SELECT 1 FROM pg_roles WHERE rolname='$ROLE_NAME'" 2>/dev/null || echo "")"

if [ "$ROLE_EXISTS" = "1" ]; then
    info "role $ROLE_NAME already exists — skipping CREATE ROLE"
else
    # Quote the password for psql's -c argument. psql doesn't accept
    # password via env or -v for security; we have to inline it in SQL.
    # Use $$..$$ quoting so single quotes in the password (unlikely from
    # gen_secret, but defensive) don't break the SQL.
    ESCAPED_PW="$(python3 -c '
import sys
# Use chr(39) instead of a literal single quote here. Bash single-quote
# context treats two adjacent single quotes as an escape for one, which
# would prematurely close the python source from bashs point of view.
print(sys.argv[1].replace(chr(39), chr(39)+chr(39)))
' "$PASSWORD" 2>/dev/null || echo "$PASSWORD")"
    info "creating role $ROLE_NAME..."
    psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE ROLE \"$ROLE_NAME\" LOGIN PASSWORD '$ESCAPED_PW'"
    ok "role $ROLE_NAME created"
fi

# ---------------------------------------------------------------------------
# Step 4: db name (render based on git state)
# ---------------------------------------------------------------------------
DB_NAME="$(render_db_name)"
info "db name = $DB_NAME"

# ---------------------------------------------------------------------------
# Step 5: CREATE DATABASE (idempotent)
# ---------------------------------------------------------------------------
DB_EXISTS="$(psql "$ADMIN_URL" -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null || echo "")"

if [ "$DB_EXISTS" = "1" ]; then
    info "database $DB_NAME already exists — skipping CREATE DATABASE"
else
    info "creating database $DB_NAME..."
    # Note: CREATE DATABASE cannot run inside a transaction block, so
    # we don't wrap this in BEGIN/COMMIT. psql runs each -c as its own
    # implicit transaction by default, which is what we want here.
    psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$DB_NAME\""
    ok "database $DB_NAME created"
fi

# ---------------------------------------------------------------------------
# Step 6: GRANT (idempotent)
# ---------------------------------------------------------------------------
info "granting ALL on $DB_NAME to $ROLE_NAME..."
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "GRANT ALL PRIVILEGES ON DATABASE \"$DB_NAME\" TO \"$ROLE_NAME\""
ok "grants applied"

# Also grant schema-level rights — postgres 15+ requires explicit schema
# grants even to the db owner. Otherwise importer / migrations would
# fail with "permission denied for schema public".
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -d "$DB_NAME" -c "GRANT ALL ON SCHEMA public TO \"$ROLE_NAME\""
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -d "$DB_NAME" -c "ALTER SCHEMA public OWNER TO \"$ROLE_NAME\""
ok "schema public ownership granted"

# ---------------------------------------------------------------------------
# Step 7: render .secrets/database_url (consumed by docker-compose *_FILE)
# ---------------------------------------------------------------------------
DATABASE_URL="$(resolve_dev_db_url)"
DATABASE_URL_FILE="$PROJECT_DIR/.secrets/database_url"
printf '%s\n' "$DATABASE_URL" > "$DATABASE_URL_FILE"
chmod 600 "$DATABASE_URL_FILE"
ok "wrote $DATABASE_URL_FILE"
info "  $(echo "$DATABASE_URL" | sed -E 's|://[^:]+:[^@]+@|://***:***@|')"

# ---------------------------------------------------------------------------
# Step 8: persist db name for branch-switch reuse
# ---------------------------------------------------------------------------
persist_db_name "$DB_NAME"
ok "persisted $PROJECT_DIR/.dev/dev-db-name"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
ok "bootstrap complete"
info "next: ./db/scripts/migrate.sh       # apply schema migrations"
info "next: ./db/scripts/import_staging.sh all   # load CMS staging into $DB_NAME"