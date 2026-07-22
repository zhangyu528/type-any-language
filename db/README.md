# db/ — content-baked db image + everything that touches Postgres

The `db/` segment owns the **staging db** (the CMS pipeline's write target) and the
**content-baked db image** (the runtime db that all target hosts pull). It is
the **bridge** between the file-producing CMS pipeline and the image-pulling
target hosts: CMS files go in, an image comes out.

This directory has nothing to do with the application backend (FastAPI /
SQLAlchemy in `backend/`), which is a pure read-layer over the image that this
directory produces. Audio is NOT baked into the image — it lives in Tencent
Cloud COS and is referenced by URL in the `sentences.audio_url` column.

## Responsibilities

1. **CMS staging import (L 步)** — read `cms/staging/` and UPSERT into the
   staging db. Idempotent; safe to re-run.
2. **Base schema + migrations** — `CREATE TABLE IF NOT EXISTS` for fresh
   dbs, ordered versioned `upgrade()` modules for in-place upgrades.
3. **DB image build** — `pg_dump` the staging db into a SQL bundle, bake
   it into a `postgres:15-alpine` wrapper with OCI labels.
4. **DB image publish** — `docker push` the baked image to `$DOCKER_REGISTRY`.
5. **Staging-db container lifecycle** — `cms-source-db` is the neutral host
   the CMS pipeline writes to and the db bake reads from. Both `cms/run.sh`
   and `db/scripts/build.sh` call `source_db.sh ensure` to bring it up.

## Directory layout

```
db/
├── Dockerfile                # postgres:15-alpine + COPY init/01-content.sql + CMD ["postgres"]
├── builder.py                # assemble(bundle) → docker build (Python; lives next to Dockerfile)
├── .dockerignore
├── .gitignore                # init/01-content.sql is build-output, not source
├── run.sh                    # end-to-end driver: import + build + push (symmetric with cms/run.sh)
│
├── init/
│   └── 01-content.sql        # ← produced by build.sh; gitignored
│
├── scripts/                  # shell entry points (the user-facing surface)
│   ├── source_db.sh          # ensure / start / stop / status  (cms-source-db container)
│   ├── init_schema.sh        # apply base schema (CREATE TABLE IF NOT EXISTS)
│   ├── migrate.sh            # apply pending schema migrations (runner.py)
│   ├── import_staging.sh     # staging files → db UPSERT  (L 步)
│   ├── build.sh              # export + assemble + docker build → content-baked image
│   ├── push.sh               # docker push the baked image to $DOCKER_REGISTRY
│   └── export_bundle.py      # pg_dump the staging db into .bake-staging/.../dump.sql
│
└── dbtools/                  # Python implementation
    ├── db_url.py             # minimal env-loader (POSTGRES_* → DATABASE_URL)
    ├── init_schema.py        # base schema (idempotent)
    ├── importer.py           # staging files → db (UPSERT)
    └── migrations/
        ├── runner.py         # 60-line hand-written migration runner
        ├── apply_to_runtime.sql  # offline single-shot SQL for broken-network upgrades
        └── versions/0001..0009_*.py   # ordered DDL
```

The `dbtools` Python package is **distinct** from `cms_pipeline` so both can
coexist on `PYTHONPATH` without import shadowing. Only `db/scripts/*.sh`
references it (via `PYTHONPATH=db`).

## End-to-end flow

The full pipeline on the CMS host (single-machine CMS+dev or dedicated CMS host):

```bash
# (1) Make sure a populated source db is reachable.
./db/scripts/source_db.sh ensure

# (2) First-time only: apply base schema. Safe to re-run.
./db/scripts/init_schema.sh
./db/scripts/migrate.sh

# (3) CMS: produce staging files (CSV → JSON → OpenAI JSONL → TTS audio URLs).
#     None of this touches the db.
./cms/scripts/staging.sh vocab
./cms/scripts/staging.sh sentences
./cms/scripts/staging.sh audio

# (4) L 步: import staging files into the staging db.
./db/scripts/import_staging.sh all

# (5) Bake the db image from the staging db.
./db/scripts/build.sh

# (6) Push the image to the registry (target hosts `docker pull` it).
./db/scripts/push.sh -y
```

Single-shot equivalents (used by `cms/run.sh` and `ops/release.sh prod`):

```bash
./cms/run.sh                          # E + T (steps 3a-c)
./db/scripts/import_staging.sh all    # L (step 4)
./db/scripts/build.sh                 # bake (step 5)
./db/scripts/push.sh -y               # push (step 6)
```

Or, the one-shot db-side driver (symmetric with `cms/run.sh`):

```bash
./db/run.sh dev               # import + build only (skips push — local iteration, never touches registry)
./db/run.sh prod              # import + build + push (full release; auto-skips push if DOCKER_REGISTRY empty)
./db/run.sh prod --no-push    # prod flow with one-off skip of push
./db/run.sh                   # same as ./db/run.sh prod (default mode)
```

**`dev` vs `prod`**: there's only **one** db image (`english_db_content`),
shared by both dev and prod target hosts — db is prod-bound content, and
its tag is read from `db/VERSION` regardless of target. The
`dev`/`prod` distinction in `db/run.sh` is **about the registry side-effect,
not the content**: `dev` forces push off (so iterating locally doesn't
pollute the team's registry), `prod` does the full pipeline. The mode
names mirror `ops/release.sh dev|prod` for muscle memory, but they don't
imply different image content.

`db/run.sh` does **not** bump `db/VERSION` — that's `ops/release.sh prod`'s
job (it bumps `db/VERSION` + `backend/VERSION` + `frontend/VERSION`
together, since a single file per segment gates both the dev and prod
image tags). Use `db/run.sh` when the tag is already decided (e.g. after
`ops/release.sh prod` has bumped and committed, or when you've pinned
`DB_IMAGE_TAG=vX.Y.Z` for a one-off build).

## How target hosts use the image

Target hosts (`ops/dev/`, `ops/prod/`) do NOT run any script in this directory.
They just `docker pull` the image and let Postgres' built-in
`/docker-entrypoint-initdb.d/` run `01-content.sql` on first start against
a fresh volume. On subsequent starts Postgres skips the init scripts; the
data volume persists.

OCI labels on the image (read by `ops/{dev,prod}/lifecycle.sh` via
`docker inspect`):

| Label | Source | What it tells you |
|---|---|---|
| `type-any-language.db.user`         | `POSTGRES_USER` build-arg | the `OWNER` of the dumped objects (default `english_user`) |
| `type-any-language.db.name`         | `POSTGRES_DB` build-arg   | the database name (default `english_learning`) |
| `type-any-language.content.version` | `DB_IMAGE_TAG`            | matches the `db/VERSION` file at build time |
| `type-any-language.content.baked-at`| UTC timestamp             | when the bake ran |
| `type-any-language.app.version`     | same as content.version   | project semver, surfaces in drift detection |
| `type-any-language.app.git-sha`     | `git rev-parse --short`   | source commit |

## Conventions worth knowing

- **DATABASE_URL assembly** is centralised in `ops/lib.sh::db_assemble_url`
  (priority: explicit env > POSTGRES_PASSWORD env > `.secrets/postgres_password` > fail).
  All three db-side shell scripts (`build.sh`, `migrate.sh`, `source_db.sh`)
  call into it — don't add a fourth copy.
- **`cms-source-db` is the staging db**, not the runtime db. The runtime db
  for the dev/prod app is `english_db` / `english_db_dev` (different
  container, different volume, on different hosts in a multi-machine setup).
  Don't conflate them.
- **`01-content.sql` is build output, not source.** The `db/init/` directory
  exists so the Dockerfile's `COPY init/` finds its target; the file is
  written there by `build.sh` and `.gitignore`d.
- **Migrations are hand-written.** No Alembic. Each `versions/NNNN_*.py`
  exposes `upgrade(conn)` / `downgrade(conn)` and is applied in numeric
  order. See `tools/dbtools/migrations/README.md` (if present) or the
  runner.py docstring for the API.
- **Schema is owned in two places** (intentional, documented in CLAUDE.md):
  the SQLAlchemy models in `backend/app/models/` and the SQL in
  `db/init/01-content.sql` must stay in sync. New columns = new migration
  + model change + a future bake will pick up the new SQL dump.

## Adding a new migration

```bash
# 1. Write db/dbtools/migrations/versions/0010_<name>.py
#    - version = "0010_<name>"
#    - def upgrade(conn): conn.execute("ALTER TABLE ...")
#    - def downgrade(conn): conn.execute("ALTER TABLE ...")
#
# 2. Apply to staging db:
./db/scripts/migrate.sh
#
# 3. Mirror the change in backend/app/models/*.py (so the read-layer
#    knows about the new column). Backend picks it up on next request.
#
# 4. Bump the same column in db/init/01-content.sql so the next
#    `db/scripts/build.sh` bakes the new schema into the image.
#    Or just re-run build.sh after migrate.sh — pg_dump will pick
#    up the new schema.
```

## Versioning `db/VERSION`

The db segment has **one** image (`english_db_content`) and **one** VERSION
file (`db/VERSION` — read by `db/scripts/build.sh`, `db/run.sh`,
`ops/release.sh prod`, and the dev/prod run scripts' `setup_*_host_env`).
Dev and prod target hosts **share the same db tag** — there's no separate
dev db version.

Bumping is done via `ops/release.sh prod <X.Y.Z> [-y]`, which writes the new
value (along with `backend/VERSION` and `frontend/VERSION`), commits, and
runs the full db + prod-app pipeline. `db/run.sh` does NOT bump (it's a
"the tag is already decided, run it" tool — see its header).

The tag carries **two independent axes** of change, and they map to semver
differently:

### Content changes (data only, no schema change)

These never require a migration; `db/scripts/build.sh` re-runs
`pg_dump` against the (already-migrated) staging db and bakes a new
`01-content.sql`.

| Change | Bump | Example |
|---|---|---|
| Add a new vocabulary lib (CSV → JSON → sentences → TTS) | **patch** | add `toefl.json` + sentences + audio |
| Add words to an existing lib | **patch** | 50 new CET4 words |
| Edit a sentence's text (triggers TTS regen for that one) | **patch** | typo fix |
| Repartition difficulty / topics / tags across the corpus | **patch** | relabel all 200 sentences |
| Regenerate all audio (e.g. switch TTS voice) | **patch** | 若汐 → another voice |

### Schema changes (modify table structure)

These require a new migration under `db/dbtools/migrations/versions/`.
Apply with `./db/scripts/migrate.sh` before baking, so `pg_dump` picks up
the new shape.

| Change | Bump | Example / precedent |
|---|---|---|
| Add nullable column | **minor** | `0009_vocab_lib_description.py` (+ `description TEXT`) |
| Add index (btree / GIN / trigram) | **minor** | — (not yet used) |
| Add new table | **minor** | `0004_sentence_word_links.py` (+ `sentence_word_links` junction table) |
| Add NOT NULL column with backfill | **minor** | requires a multi-step migration; doc the backfill |
| Drop a nullable column | **major** | `0005_drop_dead_columns.py` (destructive; baked images with the old data lose the column) |
| Rename column / change column type / drop table | **major** | breaking change — all target hosts must `docker compose down -v` (destructive) OR `ops/dev/migrate.sh` + `apply_to_runtime.sql` for in-place |

### Cross-image coordination

- **Content-only bump** (patch): `./ops/release.sh prod v0.2.1` rebuilds + pushes
  the db image. The prod app images (`english_backend`, `english_frontend`) are
  also rebuilt and pushed (release.sh does the whole prod flow), but in
  practice their code hasn't changed and the new image is bit-identical or
  trivially-different. Target hosts on the new `db/VERSION` pull all three
  on their next `lifecycle.sh restart`.
- **Schema bump** (minor or major): **always** coordinate the bump with any
  backend change. The SQLAlchemy models in `backend/app/models/` need to
  declare the new column or the read-layer will fail to read it; new routes
  may use the new column. Bump `db/VERSION` AND let `ops/release.sh prod`
  rebuild backend+frontend too — the version triple moves together.

### Drift detection

`ops/{dev,prod}/doctor.sh` reads each running container's
`type-any-language.app.version` label and compares it to the locally-resolved
`db/VERSION` (for the db container) / `backend/VERSION` /
`frontend/VERSION`. One file per segment gates both the dev and prod
image tags for that segment. If a per-segment VERSION file was bumped on
the workstation but the target host hasn't restarted yet, doctor prints a
`drift` warning. This is how you catch "I bumped db/VERSION but the prod
host is still on the old db image".
