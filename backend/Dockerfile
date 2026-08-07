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

# Schema migrations run inside the backend container itself, before
# uvicorn binds the port. See backend/image-entrypoint.sh. The
# runner + sqlalchemy + psycopg2-binary all come from the image's
# own requirements.txt, so the runtime path doesn't depend on
# anything outside the container. (Older revision applied
# migrations host-side from deploy.sh; we switched to this style so
# dev and prod go through identical code — the same
# python3 -m migrations.runner — and the deploy host no longer needs
# Python + SQLAlchemy installed.)
COPY image-entrypoint.sh /usr/local/bin/backend-image-entrypoint.sh
RUN chmod +x /usr/local/bin/backend-image-entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/usr/local/bin/backend-image-entrypoint.sh"]
# CMD removed: the entrypoint owns the entire startup (migrations
# + uvicorn). Anything we left here would be ignored.
