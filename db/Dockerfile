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
#   3. Apply pending schema migrations (idempotent — schema_migrations
#      table tracks applied versions)
#   4. Import content (idempotent UPSERT — re-runs are safe)
#   5. Bring postgres to foreground (PID 1)
#
# Bind-mount of /var/lib/type-any-language/postgres remains for data
# persistence across container recreates. The data directory survives;
# the entrypoint only runs migrations / import if pending.
#
# Build context: repo root (.) so we can COPY backend/, db/, cms/.
# Build is invoked by `docker compose build` (via publish.sh / build.sh).
# Image tag: english_db:${DB_IMAGE_TAG} (mirrors backend/frontend).
# ---------------------------------------------------------------------------

FROM postgres:15-alpine

# Version label — set from build args (mirrors backend/frontend Dockerfiles).
# Surfaces in `docker inspect` as type-any-language.app.version, which
# ops/prod/_common.sh::drift_check compares against db/VERSION.
ARG APP_VERSION=latest
ARG GIT_SHA=unknown
LABEL type-any-language.app.version="${APP_VERSION}"
LABEL type-any-language.app.git-sha="${GIT_SHA}"

# Install Python 3 + psycopg2 (for migrations + importer)
# Note: alpine ships python3 + pip via apk, but the base postgres:15-alpine
# image has none. We add them here.
RUN apk add --no-cache python3 py3-pip \
        # build-essential + postgresql-dev for compiling psycopg2-binary
        # and pydantic-core wheels on cp314 (musllinux, no manylinux
        # wheel available for our specific python + arch combo). These
        # add ~80MB to the image but let `pip install` succeed where
        # otherwise it tries to build from source and fails without cc.
        gcc \
        musl-dev \
        postgresql-dev \
        libffi-dev \
    && pip3 install --no-cache-dir --break-system-packages \
        'sqlalchemy==2.0.25' \
        'psycopg2-binary==2.9.9' \
        'pydantic==2.5.3' \
        'pydantic-settings==2.1.0' \
    # Drop the build toolchain so it doesn't ship in the final image.
    # We don't need gcc on the runtime path; only pip install needed it.
    && apk del gcc musl-dev postgresql-dev libffi-dev

WORKDIR /app

# ── Bake the ingredients the entrypoint + migrations need ─────────────
# Migrations import `from app.database import Base` and
# `from app.models import vocabulary, sentence` — so we have to ship
# backend/app/ alongside backend/migrations/ into the image. Without
# this, 0001_baseline raises "No module named 'app'" the first time
# the db container starts on a fresh volume.
#
# Build context is the repo root, so these relative paths work.
COPY backend/migrations/ /app/migrations/
COPY backend/app/        /app/app/
COPY db/importer.py       /app/importer.py
COPY db/db_url.py         /app/db_url.py
COPY cms/content/         /app/cms_content/

# ── Custom entrypoint wrapper ───────────────────────────────────────────
COPY db/image-entrypoint.sh /usr/local/bin/db-image-entrypoint.sh
RUN chmod +x /usr/local/bin/db-image-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/db-image-entrypoint.sh"]
CMD ["postgres"]