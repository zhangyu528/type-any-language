FROM python:3.11-slim

# Project version (per-segment VERSION file: backend/VERSION for this
# image — resolved by ops/lib.sh → resolve_image_tag) + git SHA
# (best-effort, "unknown" if not in a git checkout). Surfaces in
# `docker inspect` as type-any-language.app.{version,git-sha}.
ARG APP_VERSION=latest
ARG GIT_SHA=unknown
LABEL type-any-language.app.version="${APP_VERSION}"
LABEL type-any-language.app.git-sha="${GIT_SHA}"

WORKDIR /app

# 复制依赖文件
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码 + migrations
# Migrations live at backend/migrations/ (moved from db/dbtools/migrations/
# in the migrations-relocation refactor; db/dbtools/ was itself flattened
# later — modules are now directly under db/ root).
# so the model + migration + bootstrap trio stays co-located). The
# migrations/ subdirectory is a Python package, so it must be in the
# build context — COPY . . above already includes it.
COPY . .

EXPOSE 8000

# Schema verification happens in-process at backend/app/main.py startup
# (see _check_schema_at_startup). The check is read-only — it compares
# schema_migrations.version against the latest known migration under
# backend/migrations/versions/ and fail-fasts with a clear "Run:
# ./db/scripts/migrate.sh" hint when the db is behind. Migrations are
# applied host-side by the operator / CI, never at container boot
# (avoids multi-replica races on schema_migrations INSERT and long-
# running migrations blocking uvicorn startup).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
