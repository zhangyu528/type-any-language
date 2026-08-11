# db/ — schema, importer, migrations, docker postgres bootstrap

The `db/` segment owns the **schema**, the **importer** (CMS staging files → db UPSERT), the **migration runner** (in-place schema upgrades), and the **docker postgres bootstrap** (one-time docker postgres ROLE / DATABASE / GRANT + DSN file write for each target host).

It does NOT produce a docker image. The runtime database is **docker postgres** — an external Postgres service shared by all target hosts. Schema is owned in `backend/` (init_schema.py + migrations/) and mirrored in `backend/app/models/` (SQLAlchemy); the importer and migrations both run on the host against `DATABASE_URL` and target the docker postgres directly.

This directory has nothing to do with the application backend (FastAPI / SQLAlchemy in `backend/`), which is a pure read-layer that opens `DATABASE_URL` at startup and never generates content. Audio is NOT in the db — it lives in Tencent Cloud COS and is referenced by URL in the `sentences.audio_url` column.

## Responsibilities

1. **Schema bootstrap** — `CREATE TABLE IF NOT EXISTS` for fresh dbs, plus ordered versioned `upgrade()` modules for in-place upgrades.
2. **CMS staging import (L 步)** — read `cms/content/` and UPSERT into the connected db (the local postgres in compose, typically). Idempotent; safe to re-run.
3. **Schema migrations** — apply pending versioned DDL to the connected db. Idempotent (runner.py stamps `schema_migrations`). Applied by the backend container entrypoint (`backend/image-entrypoint.sh` runs `python3 -m migrations.runner` on boot), and from `make dev-migrate` on dev hosts after a code change.

## Directory layout

```
db/
├── scripts/                  shell entry points (the user-facing surface)
│   ├── lib.sh                docker postgres helpers (resolve_dev/prod_db_url, render_db_name, ...)
│   ├── bootstrap_tencent.sh  one-time ROLE/DB/GRANT + write DATABASE_URL
│   ├── init_schema.sh        apply base schema (wraps backend/init_schema.py)
│   ├── migrate.sh            apply pending migrations (wraps backend/migrations/runner.py)
│   ├── import_staging.sh     staging files → db UPSERT  (L 步)
│   └── next_migration_prefix.sh  print next available 4-digit shared prefix
│
├── db_url.py                  minimal env-loader (POSTGRES_* → DATABASE_URL)
└── importer.py                staging files → db (UPSERT)
```

Schema-related Python code (init_schema + migrations) lives under
`backend/` next to the SQLAlchemy models — see
[Schema ownership](#schema-ownership) below. db/ holds only the
**importer** (staging → db UPSERT) and the **defensive `db_url.py`**
for self-hosted / ad-hoc CLI use; both are db-side concerns that don't
depend on the backend's web framework or models.

## End-to-end flow

The full content pipeline, with the docker postgres write path:

```bash
# (CMS host) — secretless bootstrap
eval "$(cms/secrets/fetch_secrets.sh eval-cms)"   # AI_*/TENCENT_*/CLOUD_*

# CMS pipeline: produce staging files (CSV → JSON → OpenAI JSONL → TTS audio URLs).
# None of this touches the db.
./cms/scripts/staging.sh vocab
./cms/scripts/staging.sh sentences
./cms/scripts/staging.sh audio

# L 步: import staging files into the docker postgres (UPSERT).
./db/scripts/import_staging.sh all
```

Each target host (dev / prod) brings up its own local postgres container
via `docker compose up -d db`. The first-time bootstrap is:

```bash
# dev:
./ops/dev/setup.sh                     # 装 venv + node_modules + 起 db
# prod (RUN 端):
./ops/cvm/bootstrap.sh                  # 生成 .dbcreds/db_password + sudo chown /var/lib/.../postgres
./ops/cvm/lifecycle.sh start            # 起 db + import content + start full stack (migrations 由 backend entrypoint 在 boot 时完成)
```

The db password is sourced at runtime from `.dbcreds/db_password` (chmod 600),
mounted via compose's `secrets:` block into the db container. No external
cloud db, no ROLE/DB bootstrap dance.

After bootstrap, `lifecycle.sh start` picks up the DSN automatically.

## Schema ownership

Schema is owned in two places that must stay in sync:

- **`backend/app/models/*.py`** — SQLAlchemy declarative schema (the runtime truth the read-layer queries against)
- **`backend/init_schema.py`** — base `CREATE TABLE IF NOT EXISTS` (the *initial* truth for fresh dbs)
- **`backend/migrations/versions/0001..0010_*.py`** — ordered DDL applied to existing dbs when schema evolves

Migrations use a tiny hand-written runner (`backend/migrations/runner.py`, ~60 lines, no Alembic). Each version is a Python module exposing `upgrade(conn)` / `downgrade(conn)`. Idempotent via `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` etc.

### Adding a new migration

```bash
# 1. Write backend/migrations/versions/0011_<name>.py
#    - version = "0011_<name>"
#    - def upgrade(conn): conn.execute("ALTER TABLE ...")
#    - def downgrade(conn): conn.execute("ALTER TABLE ...")

# 2. Apply to the live docker postgres (or staging db if you maintain one):
./db/scripts/migrate.sh

# 3. Mirror the change in backend/app/models/*.py (so the read-layer
#    knows about the new column). Backend picks it up on next request.

# 4. For dev iteration: no image bake needed — schema is now in the
#    docker postgres directly. Just `make dev-restart` if backend needs a reload.
```

For dev hosts, `ops/dev/migrate.sh` is a thin wrapper that sources `db/scripts/lib.sh`, calls `db_assemble_url` (writes `DATABASE_URL` to env), and delegates to `db/scripts/migrate.sh`. Requires `python3` + `psycopg2-binary` + `sqlalchemy` on the host.

## Conventions worth knowing

- **DATABASE_URL assembly** has two paths:
  - **Cloud-db path (canonical)**: `db/scripts/lib.sh::db_assemble_url` / `db_assemble_url`. Reads `DATABASE_URL` (written by bootstrap), falls back to computing from `.dbcreds/tencent_db_*` files. Used by `bootstrap_tencent.sh` and `ops/dev/migrate.sh`.
  - **Self-host fallback**: `ops/lib.sh::db_assemble_url` (priority: explicit env > `POSTGRES_PASSWORD` env > `.dbcreds/postgres_password` > fail). Kept for ad-hoc CLI use where the operator composes `POSTGRES_*` env vars by hand.
- **Migrations are hand-written.** No Alembic. Each `versions/NNNN_*.py` exposes `upgrade(conn)` / `downgrade(conn)` and is applied in numeric order.
- **No db image**, no db container. The runtime db is a managed Postgres service. `db/data/` lives on the cloud provider, not in a Docker volume. There is no `docker-compose` `db` service.
- **Audio is NOT in the db.** Audio URLs live in the `sentences.audio_url` column and point at Tencent Cloud COS. The browser streams MP3s directly from COS — no `/audio` endpoint, no nginx location, no shared-audio volume.

## Versioning

The db segment has no image and therefore no VERSION file. Schema version is the `schema_migrations` row count; content version is the timestamp of the most recent successful `db/scripts/import_staging.sh` run.

Bumping `backend/VERSION` / `frontend/VERSION` is still the canonical release signal (those drive the only two images in the pipeline: `english_backend{,_dev}` + `english_frontend{,_dev}`). Bump them via the build CI (`.github/workflows/release-build.yml`) — it has nothing to do with the db anymore.