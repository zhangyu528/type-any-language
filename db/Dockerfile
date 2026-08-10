# ---------------------------------------------------------------------------
# db/Dockerfile — Custom db image for prod.
#
# This is a customized postgres:15-alpine that bakes in:
#   - backend/migrations/  (schema migrations)
#   - db/importer.py       (UPSERT logic for vocab + sentences)
#   - db/db_url.py         (DSN resolution helper)
#   - cms/content/         (vocab + sentences data)
#
# Custom entrypoint (db/image-entrypoint.sh) runs on every container
# start. Sequence:
#   1. Start postgres in background
#   2. Wait for pg_isready
#   3. Import content (idempotent UPSERT — re-runs are safe)
#   4. Bring postgres to foreground (PID 1)
#
# NOTE: schema migrations are NOT applied here. The BACKEND container's
# entrypoint (backend/image-entrypoint.sh) applies pending migrations on
# boot via `python3 -m migrations.runner`. This image only ships the
# migrations + importer so they are available; it does not run them.
#
# Bind-mount of /var/lib/type-any-language/postgres remains for data
# persistence across container recreates. The data directory survives;
# the entrypoint re-imports content only when pending.
#
# Build context: repo root (.) so we can COPY backend/, db/, cms/.
# Build is invoked by `docker compose build` (via publish.sh / build.sh).
# Image tag: english_db:${DB_IMAGE_TAG} (mirrors backend/frontend).
# ---------------------------------------------------------------------------

FROM postgres:15-alpine

# Version label — set from build args (mirrors backend/frontend Dockerfiles).
# Surfaces in `docker inspect` as type-any-language.app.version, which
# ops/cvm/_common.sh::drift_check compares against db/VERSION.
ARG APP_VERSION=latest
ARG GIT_SHA=unknown
LABEL type-any-language.app.version="${APP_VERSION}"
LABEL type-any-language.app.git-sha="${GIT_SHA}"

# Install Python 3 + psycopg2 (for migrations + importer)
# Note: alpine ships python3 + pip via apk, but the base postgres:15-alpine
# image has none. We add them here.
RUN apk add --no-cache python3 py3-pip \
    && pip3 install --no-cache-dir --break-system-packages \
        psycopg2-binary \
        sqlalchemy
# Loose pin: this image is going to be retired in favor of one
# without Python at all (migration moves to backend image, importer
# moves out), so we don't care about picking a specific version.
# Until then keep parity with the original 50ae774-era Dockerfile.

WORKDIR /app

# ── Bake the ingredients the entrypoint + migrations need ─────────────
# Build context is the repo root, so these relative paths work.
# Note: we DON'T copy backend/app/ — migrations don't import it anymore.
COPY backend/migrations/ /app/migrations/
COPY db/importer.py       /app/importer.py
COPY db/db_url.py         /app/db_url.py
COPY cms/content/         /app/cms_content/

# ── Custom entrypoint wrapper ───────────────────────────────────────────
COPY db/image-entrypoint.sh /usr/local/bin/db-image-entrypoint.sh
RUN chmod +x /usr/local/bin/db-image-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/db-image-entrypoint.sh"]
CMD ["postgres"]