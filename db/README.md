# db/ — schema, importer, migrations, cloud-db bootstrap

The `db/` segment owns the **schema**, the **importer** (CMS staging files → db UPSERT), the **migration runner** (in-place schema upgrades), and the **cloud-db bootstrap** (one-time TencentDB ROLE / DATABASE / GRANT + DSN file write for each target host).

It does NOT produce a docker image. The runtime database is **TencentDB** — an external Postgres service shared by all target hosts. Schema is owned in `db/dbtools/` (Python) and is mirrored in `backend/app/models/` (SQLAlchemy); the importer and migrations both run on the host against `DATABASE_URL` and target the cloud db directly.

This directory has nothing to do with the application backend (FastAPI / SQLAlchemy in `backend/`), which is a pure read-layer that opens `DATABASE_URL` at startup and never generates content. Audio is NOT in the db — it lives in Tencent Cloud COS and is referenced by URL in the `sentences.audio_url` column.

## Responsibilities

1. **Schema bootstrap** — `CREATE TABLE IF NOT EXISTS` for fresh dbs, plus ordered versioned `upgrade()` modules for in-place upgrades.
2. **CMS staging import (L 步)** — read `cms/staging/` and UPSERT into the connected db (typically TencentDB on the CMS host). Idempotent; safe to re-run.
3. **Schema migrations** — apply pending versioned DDL to the connected db. Idempotent (runner.py stamps `schema_migrations`).
4. **Cloud-db bootstrap** — one-time per host. `db/scripts/bootstrap_tencent.sh` (called from `ops/{dev,prod}/setup.sh bootstrap`) creates the host's ROLE + DATABASE on the shared TencentDB instance and writes `.secrets/database_url` for compose's `secrets:` block.

## Directory layout

```
db/
├── scripts/                  shell entry points (the user-facing surface)
│   ├── lib.sh                cloud-db helpers (resolve_dev/prod_db_url, render_db_name, ...)
│   ├── bootstrap_tencent.sh  one-time ROLE/DB/GRANT + write .secrets/database_url
│   ├── init_schema.sh        apply base schema (CREATE TABLE IF NOT EXISTS)
│   ├── migrate.sh            apply pending schema migrations (runner.py)
│   └── import_staging.sh     staging files → db UPSERT  (L 步)
│
└── dbtools/                  Python implementation
    ├── db_url.py             minimal env-loader (POSTGRES_* → DATABASE_URL)
    ├── init_schema.py        base schema (idempotent)
    ├── importer.py           staging files → db (UPSERT)
    └── migrations/
        ├── runner.py         60-line hand-written migration runner
        └── versions/0001..0010_*.py   # ordered DDL
```

The `dbtools` Python package is **distinct** from `cms_pipeline` so both can
coexist on `PYTHONPATH` without import shadowing. Only `db/scripts/*.sh`
references it (via `PYTHONPATH=db`).

## End-to-end flow

The full content pipeline, with the cloud-db write path:

```bash
# (CMS host) — secretless bootstrap
eval "$(scripts/secrets/fetch_secrets.sh eval-cms)"   # AI_*/TENCENT_*/CLOUD_*

# CMS pipeline: produce staging files (CSV → JSON → OpenAI JSONL → TTS audio URLs).
# None of this touches the db.
./cms/scripts/staging.sh vocab
./cms/scripts/staging.sh sentences
./cms/scripts/staging.sh audio

# L 步: import staging files into the cloud db (UPSERT).
./db/scripts/import_staging.sh all
```

Each target host (dev / prod) does its own one-time cloud-db bootstrap (typically once per host lifetime):

```bash
./ops/dev/setup.sh bootstrap           # or ./ops/prod/setup.sh bootstrap
# → prompts for admin DSN, writes .secrets/tencent_db_admin_url (chmod 600)
# → invokes ./db/scripts/bootstrap_tencent.sh with OPS_TIER=dev|prod
# → CREATE ROLE / DATABASE / GRANT on the shared TencentDB
# → writes .secrets/database_url (consumed by compose's `secrets:` block)
```

After bootstrap, lifecycle.sh start picks up the DSN automatically.

## Schema ownership

Schema is owned in two places that must stay in sync:

- **`backend/app/models/*.py`** — SQLAlchemy declarative schema (the runtime truth the read-layer queries against)
- **`db/dbtools/init_schema.py`** — base `CREATE TABLE IF NOT EXISTS` (the *initial* truth for fresh dbs)
- **`db/dbtools/migrations/versions/0001..0010_*.py`** — ordered DDL applied to existing dbs when schema evolves

Migrations use a tiny hand-written runner (`db/dbtools/migrations/runner.py`, ~60 lines, no Alembic). Each version is a Python module exposing `upgrade(conn)` / `downgrade(conn)`. Idempotent via `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` etc.

### Adding a new migration

```bash
# 1. Write db/dbtools/migrations/versions/0011_<name>.py
#    - version = "0011_<name>"
#    - def upgrade(conn): conn.execute("ALTER TABLE ...")
#    - def downgrade(conn): conn.execute("ALTER TABLE ...")

# 2. Apply to the live cloud db (or staging db if you maintain one):
./db/scripts/migrate.sh

# 3. Mirror the change in backend/app/models/*.py (so the read-layer
#    knows about the new column). Backend picks it up on next request.

# 4. For dev iteration: no image bake needed — schema is now in the
#    cloud db directly. Just `make dev-restart` if backend needs a reload.
```

For dev hosts, `ops/dev/migrate.sh` is a thin wrapper that sources `db/scripts/lib.sh`, calls `resolve_dev_db_url` (writes `DATABASE_URL` to env), and delegates to `db/scripts/migrate.sh`. Requires `python3` + `psycopg2-binary` + `sqlalchemy` on the host.

## Conventions worth knowing

- **DATABASE_URL assembly** has two paths:
  - **Cloud-db path (canonical)**: `db/scripts/lib.sh::resolve_dev_db_url` / `resolve_prod_db_url`. Reads `.secrets/database_url` (written by bootstrap), falls back to computing from `.secrets/tencent_db_*` files. Used by `bootstrap_tencent.sh` and `ops/dev/migrate.sh`.
  - **Self-host fallback**: `ops/lib.sh::db_assemble_url` (priority: explicit env > `POSTGRES_PASSWORD` env > `.secrets/postgres_password` > fail). Kept for ad-hoc CLI use where the operator composes `POSTGRES_*` env vars by hand.
- **Migrations are hand-written.** No Alembic. Each `versions/NNNN_*.py` exposes `upgrade(conn)` / `downgrade(conn)` and is applied in numeric order.
- **No db image**, no db container. The runtime db is a managed Postgres service. `db/data/` lives on the cloud provider, not in a Docker volume. There is no `docker-compose` `db` service.
- **Audio is NOT in the db.** Audio URLs live in the `sentences.audio_url` column and point at Tencent Cloud COS. The browser streams MP3s directly from COS — no `/audio` endpoint, no nginx location, no shared-audio volume.

## Versioning

The db segment has no image and therefore no VERSION file. Schema version is the `schema_migrations` row count; content version is the timestamp of the most recent successful `db/scripts/import_staging.sh` run.

Bumping `backend/VERSION` / `frontend/VERSION` is still the canonical release signal (those drive the only two images in the pipeline: `english_backend{,_dev}` + `english_frontend{,_dev}`). Use `ops/release.sh dev|prod [X.Y.Z]` to do that — it has nothing to do with the db anymore.