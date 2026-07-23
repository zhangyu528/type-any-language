FROM python:3.11-slim

# Project version (per-segment VERSION file: backend/VERSION for this
# image — the same file gates english_backend_dev; resolved by
# ops/lib.sh → resolve_image_tag) + git SHA (best-effort, "unknown" if
# not in a git checkout). Surfaces in `docker inspect` as
# type-any-language.app.{version,git-sha}.
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
# so the model + migration + bootstrap trio stays co-located). The
# migrations/ subdirectory is a Python package, so it must be in the
# build context — COPY . . above already includes it.
COPY . .

EXPOSE 8000

# ENTRYPOINT applies pending schema migrations before serving traffic.
# Idempotent — re-runs are no-ops (runner skips already-applied versions
# in schema_migrations). On every container start, the migrations from
# the baked-in working tree are applied to the connected cloud db.
# This eliminates the "code ≠ db" drift window: any new migration
# in the image is applied before the first request.
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
