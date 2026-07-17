# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

English learning web app — plays a sentence's audio and the user types the complete sentence. **All content (vocabulary, AI-generated sentences, TTS audio) is baked into the db image at build time on the CMS host.** Target hosts (dev / prod) are a pure read-layer: no AI calls, no TTS calls, no scheduler, no Python on the host.

## Two-host architecture

This project intentionally separates **content production** from **content serving**:

| Host | Role | What lives here | What runs here |
|---|---|---|---|
| **CMS host** | Content production (writes staging files) | `cms/` (env, scripts, source, tools) | Python + Docker |
| **Target host** (dev or prod) | Content serving | `ops/dev/` or `ops/prod/` | Docker only |
| **DB image build** (CMS host or CI) | Schema + db container + bake + importer | `db/` (Dockerfile, builder, scripts, tools/dbtools/) | Docker only |

The CMS host produces **staging files** (vocabulary JSON + sentences JSONL) via the
CMS pipeline. The CMS pipeline does **not** touch the database — the db side has its
own importer (`db/tools/dbtools/importer.py`) that reads the staging files and
UPSERTs them into the database. Then the db image is baked from that database and
pushed to a registry. Target hosts `docker pull` the image and serve it — they
never need AI keys, TTS keys, or Python. **Target hosts need no .env file at all**
— runtime configuration (only `ALLOWED_ORIGINS`) is passed via shell env, and the
host-side secret (`POSTGRES_PASSWORD`) is generated on first start by `lifecycle.sh`.

### ETL architecture (CMS produces files, db imports them)

The CMS/db split follows an ETL pattern: **E**xtract (CSVs) and **T**ransform
(AI / TTS) live entirely on the CMS side as files in `cms/staging/`; the
**L**oad (UPSERT into Postgres) is the db side's job, via `dbtools.importer`.

```
        CMS host (Python)                              CMS/db boundary
                                                                       
   cms/seed/vocabulary/*.csv  ─┐                                    
   cms/seed/prompts/*.yaml    │                                    
   cms/seed/manifest.yaml     │   a) import_vocab.py                
                                ├──────────────►  cms/staging/ 
   cms/.env (AI_*, TENCENT_*)   │                     vocabulary/    
                                │                     *.json         
                                │                                       
                                │   b) generate_sentences.py           
                                │     reads vocab JSON, calls          
                                │     OpenAI, appends to               
                                ▼                                       
                          cms/staging/                           
                              sentences/*.jsonl                          
                                │                                        
                                │   c) generate_audio.py               
                                │     reads sentences JSONL,           
                                │     calls TTS, uploads to            
                                │     Storage (LocalFs / Tencent COS), 
                                │     updates audio_url in JSONL       
                                ▼                                        
                          cms/staging/                           
                              sentences/*.jsonl   ──►   FILES (公共区)  
                                                                       
        db side (Python + Postgres)                                     
                          ┌──────────────────────────────────┐            
                          │ d) dbtools.importer (all)         │            
                          │    reads staging files            │            
                          │    UPSERTs into:                  │            
                          │      vocabulary_libs              │            
                          │      vocabulary_words             │            
                          │      sentences (+ audio_url)      │            
                          └──────────────────────────────────┘            
                                                                           
                          e) db/scripts/build.sh                            
                             pg_dump → 01-content.sql → docker build       
                                                                           
                          f) db/scripts/push.sh                             
                             → DOCKER_REGISTRY                               
```

**Why ETL, not direct db writes?** The CMS side stays ignorant of the schema —
only the importer knows about `vocabulary_libs` / `vocabulary_words` / `sentences`.
Operators can re-run any single CMS step (CSVs → JSON, AI → JSONL, TTS → audio)
without touching the database, and a failed `import_staging.sh` doesn't cost an
extra OpenAI call (the JSONL is already on disk).

Secrets never live inside the db image. Host-side `POSTGRES_PASSWORD` is generated on first start by `lifecycle.sh` (or reused if `.secrets/postgres_password` already exists) and written to `.secrets/postgres_password` (chmod 600). It is injected via compose's `secrets` block + `*_FILE` env indirection.

## Repository structure

```
├── REGISTRY              # DOCKER_REGISTRY namespace for push/pull (committed shared config)
├── backend/              # FastAPI + SQLAlchemy — pure read-layer
│   ├── VERSION           # tag for english_backend_dev + english_backend (one file per segment)
│   ├── app/
│   │   ├── main.py      # FastAPI entry, CORS, no static mounts
│   │   ├── config.py    # pydantic-settings with _FILE indirection
│   │   ├── database.py  # SQLAlchemy engine/session
│   │   ├── models/      # SQLAlchemy models (VocabularyLib, VocabularyWord, Sentence)
│   │   ├── routers/     # API routes (vocabulary, sentences)
│   │   ├── schemas/     # Pydantic request/response models
│   └── requirements.txt
│
├── frontend/             # Next.js 14 (App Router) + React 18 + TypeScript
│   ├── VERSION           # tag for english_frontend_dev + english_frontend
│   └── src/app/         # API client + main page
│
├── cms/              # The content service — produces + ships the content image
│   ├── VERSION            # placeholder for a future CMS pipeline version stamp (no reader wired today)
│   ├── run.sh            # CMS driver (entry point; E+T)
│   ├── source/           # operator-maintained source (git-tracked, hand-edited)
│   │   ├── manifest.yaml
│   │   ├── vocabulary/   # CSVs per lib
│   │   └── prompts/      # LLM prompts (sentences.yaml)
│   ├── scripts/          # CMS shell tools (env.sh + staging.sh; not entry)
│   │   ├── env.sh        # cms/.env lifecycle
│   │   └── staging.sh    # E+T file producer wrapper
│   ├── cms_pipeline/     # Python package (manifest / import_vocab / generate_sentences / generate_audio / storage / env)
│   │   └── README.md
├── db/                # Postgres image build context (postgres:15-alpine wrapper)
│   ├── VERSION         # tag for english_db_content (db is prod-bound; shared by dev + prod targets)
│   ├── Dockerfile    # copies init/01-content.sql (NO audio — db image has no MP3s)
│   ├── builder.py    # assemble(bundle) + build_image(target, tag, ...)
│   ├── run.sh        # end-to-end db driver (import + build + push, with dev|prod subcommands)
│   │   ├── source_db.sh    # cms-source-db container lifecycle (ensure/start/stop/status)
│   │   ├── init_schema.sh  # python -m dbtools.init_schema (base DDL)
│   │   ├── migrate.sh      # python -m dbtools.migrations.runner (apply pending migrations)
│   │   ├── import_staging.sh  # python -m dbtools.importer (staging files → db UPSERT)
│   │   ├── build.sh        # export staging db → assemble → docker build
│   │   ├── push.sh         # push english_db_content to DOCKER_REGISTRY
│   │   └── export_bundle.py   # pg_dump the staging db → SQL (independent of CMS)
│   ├── tools/                # Python package dbtools/ — schema + importer
│   │   └── dbtools/          # init_schema / migrations / importer / db_url
│   └── init/
│       └── 01-content.sql   # pg_dump snapshot (bake-time output; .gitignore'd)
│
├── ops/                    # target-host operations + image build/release orchestrator
│   ├── README.md            # ops/ layout, lib.sh helpers, conventions for new scripts
│   ├── lib.sh               # shared helpers (ok/warn/err, docker detection, gen_secret)
│   ├── build.sh             # local multi-image build (db + dev + prod) — no push
│   ├── release.sh           # release orchestrator: bump + build + push (dev / prod / show)
│   ├── build_ielts_csv.py   # one-off data-prep tool (IELTS word list → cms CSV format)
│   ├── dev/                 # dev target host — lifecycle + per-subcommand helpers
│   │   ├── _common.sh       # shared setup (image refs, db labels, secrets, watch)
│   │   ├── lifecycle.sh     # start / stop / restart | reload
│   │   ├── doctor.sh
│   │   ├── setup.sh
│   │   ├── logs.sh
│   │   ├── migrate.sh       # schema migration (dev-only)
│   │   ├── watch.sh         # foreground compose watch (dev-only)
│   │   └── build_image.sh   # build english_backend_dev + english_frontend_dev
│   └── prod/                # prod target host — same shape, no migrate/watch
│       ├── _common.sh
│       ├── lifecycle.sh
│       ├── doctor.sh
│       ├── setup.sh
│       ├── logs.sh
│       ├── build_image.sh   # build english_backend + english_frontend
│       ├── push_image.sh    # push prod backend+frontend to DOCKER_REGISTRY
│       └── nginx.conf       # prod-only reverse proxy config
│
├── compose-shared.yml       # shared `db` service block — `include:`d by both compose files
├── docker-compose.yml        # prod stack orchestration (compose v2.20+ `include:`)
└── docker-compose.dev.yml    # dev stack orchestration (hot-reload, compose-watch)
```

The runtime `docker-compose.yml` references the `db` image as a service — the image's OCI labels (`type-any-language.db.user`, `type-any-language.db.name`, `type-any-language.content.version`, `type-any-language.content.baked-at`) are read at start time by `ops/dev/lifecycle.sh` / `ops/prod/lifecycle.sh` to discover the db identity. `POSTGRES_PASSWORD` is NOT in those labels.

## Commands

### CMS host — content production

> **Rename notes** (recent releases):
>
> - `.env.db` → `cms/.env` (one-time `mv`, then `staging.sh` / `db/scripts/build.sh` keeps working; the file is gitignored).
> - `cms/scripts/etl.sh` → `cms/scripts/staging.sh`. The script no longer does L (Load is now exclusively the db-side `./db/scripts/import_staging.sh all`); the CMS ETL split is now visible at the script-name level: `staging.sh` produces files in `cms/staging/`, `cms/run.sh` orchestrates the CMS driver through E+T, `db/scripts/import_staging.sh` is the separate Load step.
> - `run.sh` moved up one level: was inside `cms/scripts/`, now at `cms/run.sh` (entry point vs tools split is visible at the dir level — tools stay under `cms/scripts/`, the main driver is the bare `cms/run.sh` you type first).
>
> To pin a different env path, export `CONTENT_ENV_FILE=/some/path/.env.staging` in the shell (same precedence pattern as `DOCKER_REGISTRY`).

```bash
# 1. 引导 cms/.env(首次)
./cms/scripts/env.sh                # First-time cms/.env creation (interactive)
./cms/scripts/env.sh doctor        # 验证 cms/.env 完整性

# 2. 跑内容管线 (writes staging files; db import is a separate step)
./cms/scripts/staging.sh doctor     # Pre-flight: cms/.env + Python deps
./cms/scripts/staging.sh sync       # CSVs → cms/staging/vocabulary/<lib>.json
./cms/scripts/staging.sh sentences  # OpenAI → cms/staging/sentences/<lib>.jsonl
./cms/scripts/staging.sh audio      # Tencent TTS → updates audio_url in sentences JSONL

# 3. db side: import staging files → Postgres (separate step, db's job)
./db/scripts/source_db.sh ensure    # 起 staging db (cms-source-db 容器或本地 postgres)
./db/scripts/init_schema.sh         # (首次) 建 vocabulary_* / sentences / schema_migrations
./db/scripts/migrate.sh             # 跑 pending schema migrations
./db/scripts/import_staging.sh      # reads staging files, UPSERTs to db (独立步骤)

# 4. 烤 db image (从 staging db 读, 独立步骤, db 的职责)
./db/scripts/build.sh         # export staging db → db/init/01-content.sql + docker build
./db/scripts/push.sh [-y]    # Push the db image to DOCKER_REGISTRY

# 5. 一步到位 (CMS driver + 3 个独立 db 步)
./cms/run.sh                                       # CMS driver (E+T)
./db/scripts/import_staging.sh all              # db: L (UPSERT staging 文件 → db)
./db/scripts/build.sh                            # db: bake db image
```

`cms/scripts/staging.sh` is a thin wrapper over the `cms/cms_pipeline/*.py` modules. Each subcommand has its own `--help`. For module-by-module usage details, run `python -m cms_pipeline.<module> --help` (e.g. `python -m cms_pipeline.import_vocab --help`).

### 责任划分 (responsibility split)

| Step | Tool | What it writes |
|---|---|---|
| sync (CSV → JSON) | `cms/cms_pipeline/import_vocab.py` | `cms/staging/vocabulary/<lib>.json` |
| sentences (AI → JSONL) | `cms/cms_pipeline/generate_sentences.py` | appends to `cms/staging/sentences/<lib>.jsonl` |
| audio (TTS → URL) | `cms/cms_pipeline/generate_audio.py` | updates `audio_url` field in sentences JSONL |
| import (files → db) | **`db/tools/dbtools/importer.py`** | UPSERT into `vocabulary_libs` / `vocabulary_words` / `sentences` |
| bake (db → image) | `db/scripts/build.sh` | builds the `db` image from `db/init/01-content.sql` |

The CMS pipeline (steps sync/sentences/audio) **never** opens a db connection.
Only `dbtools.importer` and `db/scripts/build.sh` touch Postgres. To re-run a single
CMS step (e.g. you edited a CSV and only need to re-sync the vocab JSON), there's no
need to spin up Postgres; the files in `cms/staging/` are the stable
artifact until you decide to import.

### Dev target host

```bash
./ops/dev/setup.sh          # First-time: 拉/检查 db image + build dev apps
./ops/dev/doctor.sh         # Pre-flight
./ops/dev/lifecycle.sh start          # compose up + 后台 spawn compose watch(自动 sync src/package.json)
./ops/dev/lifecycle.sh stop
./ops/dev/lifecycle.sh restart        # Hard restart (recreate + re-read secrets)
./ops/dev/migrate.sh        # Apply pending schema migrations to runtime db
./ops/dev/logs.sh [svc]
# Optional image publishing (offline / first-time local setup → registry):
./ops/dev/build_image.sh        # build english_backend_dev + english_frontend_dev
                                          # dev host does NOT push (stay local)
./ops/prod/build_image.sh       # build english_backend + english_frontend
./ops/prod/push_image.sh -y     # push prod backend+frontend to DOCKER_REGISTRY
./db/scripts/build.sh                    # bake content-baked db image (CMS host)
./db/scripts/push.sh -y                  # push db image to DOCKER_REGISTRY
```

No `.env.dev` is needed. The dev compose file defaults `ALLOWED_ORIGINS` to `http://localhost,http://localhost:3000`; override via shell env. `POSTGRES_PASSWORD` is generated on first start.

`setup` is the recommended entry point for a fresh checkout. It runs preflight (docker + compose), ensures the `db` image is present locally (auto-pulls from `DOCKER_REGISTRY` if set, otherwise — on a single-host CMS+dev machine — scaffolds `cms/.env` via `env.sh init` + validates with `env.sh doctor`, then runs the full local content pipeline: CSVs → staging JSON → AI sentences JSONL → TTS audio URLs → `import_staging.sh` UPSERTs to db → `db/scripts/build.sh` bakes the db image), and builds the dev `backend + frontend` images. It does NOT start containers or create `.secrets/` — that's `start`'s job. Re-running `setup` is safe (idempotent — every step short-circuits on existing state).

### Prod target host

```bash
./ops/prod/setup.sh         # First-time: 拉 db image + build prod apps
./ops/prod/doctor.sh
ALLOWED_ORIGINS=https://my.domain ./ops/prod/lifecycle.sh start
./ops/prod/lifecycle.sh start
./ops/prod/lifecycle.sh stop
./ops/prod/lifecycle.sh restart
./ops/prod/logs.sh [svc]
# Optional image publishing:
./ops/prod/build_image.sh        # build english_backend + english_frontend
./ops/prod/push_image.sh -y      # push them to DOCKER_REGISTRY
```

`setup` is the recommended entry point for a fresh prod host. Same flow as dev: preflight + ensure `db` image present (auto-pull from `DOCKER_REGISTRY`) + build prod `backend + frontend`. The prod host never bakes db content itself — it pulls from a registry. If `DOCKER_REGISTRY` is empty, `setup` exits with the CMS-side steps.

No `.env` is needed. `ALLOWED_ORIGINS` defaults to `http://localhost` in the prod compose — override via shell env (shown above) or edit the compose file directly. `POSTGRES_PASSWORD` is generated on first start.

**Image registry model**: CMS host pushes the content-baked `db` image; each target host pushes its own `backend + frontend` images.
- **Prod target host**: `docker pull` all 3 from `$DOCKER_REGISTRY` on every `lifecycle.sh start` / `restart` (auto-pulled — registry is the source of truth for prod).
- **Dev target host**: `setup.sh` does the **one-time bootstrap pull** from `$DOCKER_REGISTRY` when local images are missing. `start` / `restart` **never auto-pull** — dev iteration is local-first; image lifecycle is owned by `build_image.sh` / `db/scripts/build.sh` on the host. This avoids overwriting fresh local builds with stale registry versions. To pull explicitly: `docker pull <full-image>`.

The registry namespace (e.g. `docker.io/zhangyu528`) is **shared project config** that the whole team uses. It is **not** a personal secret, so it lives in the committed `REGISTRY` file at the repo root (symmetric with the per-segment VERSION files), not in `cms/.env` (gitignored). See [Image registry namespace](#image-registry-namespace) below.

## Image registry namespace

The `DOCKER_REGISTRY` shell variable is the namespace prefix prepended to `image:tag` for `docker push` / `docker pull`. The chain (`ops/lib.sh` → `resolve_docker_registry`) is, in order of decreasing precedence:

1. **Shell env** — `export DOCKER_REGISTRY=docker.io/youruser` (highest priority; CI / one-off override)
2. **`./REGISTRY` file at repo root** — committed, shared project config (typical default)
3. **`detect_default_registry()`** — `docker.io/$USER` (best-effort guess; useful for solo dev work)
4. **Empty** — local-only mode; push scripts fail with a clear error, run scripts just skip the auto-pull

The `REGISTRY` file's format: first non-empty, non-comment line starting with `DOCKER_REGISTRY=`. It ships with the `DOCKER_REGISTRY=` line **commented out** — fill it in and uncomment to publish the team's shared namespace.

```bash
# REGISTRY
DOCKER_REGISTRY=docker.io/zhangyu528   # ← uncomment + edit
```

> Why committed and not `.env`? Like the per-segment VERSION files, this is shared project config that the whole team should agree on — putting it in a gitignored `.env` means every operator has to set it themselves, and the same value gets typed in N places. Personal secrets (postgres password, AI keys, TTS keys) stay in `cms/.env` (gitignored); shared config lives at the repo root.

## Image version tags

All 5 images (`db`, `english_backend{,_dev}`, `english_frontend{,_dev}`) carry an explicit tag. VERSION files are **per-segment** (one file per segment, co-located with the segment's Dockerfile(s) and build scripts) — no dev/prod split:

| Image | Default tag source |
|---|---|
| `english_db_content`         | `db/VERSION`             |
| `english_backend_dev`        | `backend/VERSION`        |
| `english_frontend_dev`       | `frontend/VERSION`       |
| `english_backend`            | `backend/VERSION`        |
| `english_frontend`           | `frontend/VERSION`       |

(The db image is "prod-bound" content — it's shared by both targets, so a dev host always pulls db's tag from `db/VERSION`. The backend / frontend VERSION files each gate BOTH the dev and prod image tags for that segment — there's no separate dev stream file. Bumping `backend/VERSION` releases a new `english_backend_dev` and a new `english_backend` at the same tag. `cms/VERSION` exists as a placeholder for a future CMS pipeline version stamp but has no image tied to it today.)

Each file: first non-empty, non-comment line, trimmed.

Resolution chain (`ops/lib.sh` → `resolve_image_tag`):
1. Per-image env var, e.g. `BACKEND_IMAGE_TAG=v1.2.3`
2. Generic `IMAGE_TAG` (CI convenience — bumps all images at once)
3. The VERSION file path passed to the helper (e.g. `backend/VERSION`)
4. Literal `v0.0.0` (won't break a build, but warns once)

Examples:
```bash
# Use whatever each segment's VERSION file says (default):
./ops/dev/build_image.sh         # → backend/VERSION, frontend/VERSION, db/VERSION
./ops/prod/build_image.sh        # → backend/VERSION, frontend/VERSION, db/VERSION
./db/scripts/build.sh                # → db/VERSION

# Bump all images to v1.2.3 for a one-off (CI use):
IMAGE_TAG=v1.2.3 ./ops/dev/build_image.sh
IMAGE_TAG=v1.2.3 ./ops/prod/build_image.sh
IMAGE_TAG=v1.2.3 ./db/scripts/build.sh

# Pin just the db image, leave dev app at backend/VERSION:
DB_IMAGE_TAG=v0.5.0 ./db/scripts/build.sh
```

For a full release (bump + build + push), use `ops/release.sh dev|prod X.Y.Z` instead of running these individually — see "Release flow" below.

The dev/prod `lifecycle.sh` reads the same tags at start time, so what gets pulled from the registry matches what was built. `db/scripts/push.sh` uses the same convention.

### Drift detection

Every image carries the `type-any-language.app.version` LABEL (sourced from `APP_VERSION` build-arg, which the build scripts set to the resolved `*_IMAGE_TAG`). `doctor.sh` (both dev and prod) iterates the running containers and compares each LABEL against the locally-resolved expected tag — mismatches print a `drift` warning, suggesting `lifecycle.sh restart` to pick up the new image. This catches the case where a VERSION file was bumped on the workstation but the target host hasn't pulled/restarted yet.

### Release flow

`ops/release.sh` is the single point of release orchestration. It updates the right VERSION file, commits, then **builds and pushes** the relevant images — local-only when `DOCKER_REGISTRY` is unset, registry-push when it's set.

| Subcommand | Bumps | Builds + pushes |
|---|---|---|
| `show`              | — | — (print all 4 per-segment VERSION files) |
| `dev  [X.Y.Z]`      | `backend/VERSION` + `frontend/VERSION` (same tag; single file gates both backend images) | `english_{backend,frontend}_dev` |
| `prod [X.Y.Z]`      | `db/VERSION` + `backend/VERSION` + `frontend/VERSION` | db (content-baked) + `english_{backend,frontend}` |

`X.Y.Z` is optional: omit it to publish the current VERSION without bumping. Add `-y` to skip the bump-confirmation prompt.

Local vs remote is controlled by `DOCKER_REGISTRY` (chain: shell env → `./REGISTRY` file → auto-detect → empty):

```bash
# Local mode — build images, no push
./ops/release.sh dev v0.3.0

# Remote mode — uses REGISTRY file (committed, shared team namespace)
# (or override via shell env if pushing to a one-off namespace)
./ops/release.sh prod v0.3.0 -y

# Re-publish current VERSION (no bump)
./ops/release.sh dev
```

The full release flow with the new `release.sh` (one command per host):

```bash
# On the workstation — after merging changes to master:
./ops/release.sh dev v0.3.0       # bump backend/VERSION + frontend/VERSION + build dev b/f
./ops/release.sh prod v0.3.0 -y    # bump db/VERSION + backend/VERSION + frontend/VERSION
                                  # + bake db + push db + build + push prod b/f
git push

# On each target host — just verify, the images are already in the registry:
./ops/<host>/doctor.sh    # should show "drift OK (version=v0.3.0)" for all 3 services
./ops/<host>/lifecycle.sh restart   # pull new image and recreate
```

Architecture notes:
- `release.sh dev` only touches the app segments' VERSION files
  (`backend/VERSION` + `frontend/VERSION`). The content-baked db
  image is prod-bound and reads `db/VERSION`; if you want dev to see new
  content, run `release.sh prod` first (or just push a new db with
  `db/VERSION`).
- `release.sh prod` includes the db bake. That step needs `cms/.env`, so `prod` must run on the CMS host (or a single-machine CMS+prod setup). On a dedicated prod target host without `cms/.env`, run `db/scripts/build.sh` on the CMS host first, then run `ops/prod/build_image.sh` + `db/scripts/push.sh` on the prod host.
- For multi-machine deployments, run each subcommand on its respective host. The script is self-contained per host.

## Migration from pre-VERSION release

If you upgraded from a release that used `:latest` (or hardcoded) tags, expect two behavior changes on first run:

1. **`lifecycle.sh start` may fail with "image 未构建"** — the compose file now references a tagged tag (`:v0.1.0` or whatever the stream's VERSION file says), not `:latest`. Fix once:
   ```bash
   ./ops/dev/build_image.sh    # or ops/prod/build_image.sh
   ```
   Old `:latest` images on the host will still exist as stale tags. They're harmless; clean up later with `docker rmi english_backend_dev:latest english_frontend_dev:latest`.

2. **`compose pull` now pulls by versioned tag, not `:latest`.** If your local cache has a stale `:latest` and the registry has a different `:v0.1.0`, the pull overwrites the local tag. This is intentional — it's the whole point of having a version pin.

There is no automatic `:latest` → tagged retag helper, because it would silently lie about what's in the image. Rebuilding once is the only correct migration.

### Migration to per-segment VERSION files (this release)

Earlier releases carried `VERSION.dev` and `VERSION.prod` at the repo
root, then moved to per-segment files where `backend/` and `frontend/`
each had a `VERSION.dev` and a `VERSION.prod`. This release simplifies
to **one file per segment** — there is no dev/prod split anymore:

| Before (this release's predecessor) | After |
|---|---|
| `VERSION.dev` at repo root                              | (deleted) |
| `VERSION.prod` at repo root                             | (deleted) |
| `db/VERSION`                                           | `db/VERSION` (unchanged) |
| `cms/VERSION` (placeholder)                             | `cms/VERSION` (unchanged) |
| `backend/VERSION.dev` + `backend/VERSION.prod`         | `backend/VERSION` (gates both english_backend_dev + english_backend) |
| `frontend/VERSION.dev` + `frontend/VERSION.prod`        | `frontend/VERSION` (gates both english_frontend_dev + english_frontend) |

The db segment has always had a single VERSION file (db has no
dev/prod split — its image is prod-bound content shared by both
targets). The CMS segment's `cms/VERSION` is a placeholder for a
future CMS pipeline version stamp; no reader is wired to it today.

`ops/release.sh` now bumps a single file per stream (dev bumps just
`backend/VERSION` + `frontend/VERSION`; prod bumps `db/VERSION` +
`backend/VERSION` + `frontend/VERSION`), and `show` prints all 4
per-segment files. The resolution chain is unchanged — every read site
passes an explicit path to `ops/lib.sh::resolve_image_tag`, and
`read_version_file` requires that path (no implicit root-level fallback).

### Testing

```bash
# Frontend
cd frontend && npm test

# Backend (single test, requires pytest)
cd backend && python -m pytest tests/test_file.py::test_name -v
```

## Key API Endpoints

All read-only. Sentences and audio are pre-baked into the db image by the CMS host (commit `f26265d refactor(backend): strip to read-layer`); the runtime never generates, never validates against a server-side cache.

| Endpoint | Method | Description |
|---|---|---|
| `/api/vocabulary/libs` | GET | List all vocabulary libraries |
| `/api/vocabulary/libs/{id}` | GET | Single library by id |
| `/api/vocabulary/libs/{id}/words` | GET | All words in a library |
| `/api/vocabulary/libs/{id}/random` | GET | N random words from a library (params: `count`) |
| `/api/vocabulary/phonetics` | GET | Bulk IPA lookup (params: `words=a,b,c`) — DB → CMUdict fallback |
| `/api/sentences` | GET | List baked sentences (filters: `lib_id`, `difficulty`, `limit`) |
| `/api/sentences/{id}` | GET | Single sentence by id |
| `/api/sentences/random` | GET | N random baked sentences for practice (params: `lib_id`, `difficulty`, `count`) |
| (audio) | n/a | Served directly from `sentences.audio_url` (full Tencent Cloud COS URL). The backend exposes no `/audio` endpoint — the frontend reads `sentence.audio_url` and the browser streams from COS. |

Answer validation is **client-side**: the frontend normalizes (lowercase, strip punctuation, collapse whitespace) and compares against `sentence.text` directly. No `/api/sentences/check` endpoint.

## Data flow

**Bake time (CMS host, ETL file-based):**
1. Operator commits new CSVs to `cms/seed/vocabulary/`.
2. `staging.sh sync` writes them to `cms/staging/vocabulary/<lib>.json` (no db write).
3. `staging.sh sentences` calls OpenAI and appends to `cms/staging/sentences/<lib>.jsonl` up to `DEFAULT_BUCKET_TARGET_SIZE` per (lib, difficulty).
4. `staging.sh audio` calls Tencent TTS; MP3s land in the configured `Storage` (local `cms/.local/audio/` by default, or Tencent Cloud COS when `CLOUD_PROVIDER=tencent_cos`), and each sentence's `audio_url` field in the JSONL is set to the storage's `public_url(key)`.
5. `db/scripts/import_staging.sh` reads the staging files and UPSERTs them into `vocabulary_libs` / `vocabulary_words` / `sentences` on the staging db (`cmstools.importer`).
6. `db/scripts/build.sh` runs `pg_dump` on the 3 content tables, stages the SQL into `db/init/01-content.sql`, builds the db image.
7. `db/scripts/push.sh` pushes to `DOCKER_REGISTRY`.

**Runtime (target host):**
1. `lifecycle.sh start` reads the db image's labels, generates (or reuses) `POSTGRES_PASSWORD` and writes both `.secrets/postgres_password` + `.secrets/database_url`, then `compose up`.
2. On first start, the db image's `/docker-entrypoint-initdb.d/` runs `01-content.sql` (creates schema, loads content). **No audio init step** — the db image carries no audio.
3. Frontend fetches a sentence, browser plays its MP3 directly from `sentences.audio_url` (a full Tencent Cloud COS URL). The backend exposes no `/audio` endpoint.
4. User submits answer → `validate_answer()` normalizes (lowercase, strip punctuation/spaces) and compares.

**Audio architecture (cloud, not image):**
- MP3s live in Tencent Cloud COS, not in the db image.
- `sentences.audio_url` is the full COS URL, baked into the image at `db/scripts/build.sh` time.
- The frontend reads `sentences[i].audio_url` and the browser streams audio from COS directly — no proxy through backend, no nginx `/audio` location, no `shared-audio` docker volume.
- This keeps the db image small (schema + sentences table only, no binary blobs) and lets audio be updated without re-baking the db image.
- Provider is selected via `CLOUD_PROVIDER` in `cms/.env`. Default `local_fs` writes to `cms/.local/audio/` (single-host CMS, no cloud account needed). `tencent_cos` uploads to a COS bucket (multi-host CMS or production). See `cms/cms_pipeline/storage.py` for the abstraction.

## Schema migrations

Schema lives in two places that must stay in sync:
- **`backend/app/models/*.py`** — SQLAlchemy declarative schema (the runtime truth)
- **`db/init/01-content.sql`** — pg_dump snapshot baked into the db image (the *initial* truth for fresh volumes)
- **`cms/cms_pipeline/migrations/versions/*.py`** — ordered DDL applied to existing volumes when schema evolves

Migrations use a tiny hand-written runner (`cms/cms_pipeline/migrations/runner.py`, ~60 lines, no Alembic). Each version is a Python module exposing `upgrade(conn)` / `downgrade(conn)`. Idempotent via `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` etc.

### Dev iteration (light-touch)

When you add or change a migration in `cms/cms_pipeline/migrations/versions/`:

```bash
# Source db (CMS pipeline, if running): the migrations apply so a future
# bake has the new schema in 01-content.sql
./db/scripts/init_schema.sh    # base schema (idempotent CREATE TABLE IF NOT EXISTS)
./db/scripts/migrate.sh        # pending schema migrations (runner.py)

# Runtime db (the one your backend is actually querying): in-place upgrade,
# no image bake, no registry push, no volume drop
./ops/dev/migrate.sh
```

`migrate.sh` spins up a one-shot `python:3.11-slim` sidecar on the compose network and runs `pipeline.migrations.runner` against `db:5432`. Idempotent — re-runs are no-ops. The backend picks up the new schema on the next request (no restart needed; uvicorn hot-reload handles Python changes).

**Offline fallback** (when `python:3.11-slim` can't be pulled, e.g. broken registry mirrors): `cms/cms_pipeline/migrations/apply_to_runtime.sql` is a pre-rolled SQL file that brings a stale runtime db up to the current head in one shot. `migrate.sh` prints the exact `docker exec ... psql < apply_to_runtime.sql` command on pull failure. This file applies all known migrations and stamps them as done — it only works for upgrading an old db to head, not for dev-iteration of a brand-new migration (which needs the runner).

### Production rollout

When the operator merges new schema changes:
1. CMS host: `staging.sh init-schema` (already in `release.sh prod`'s flow once the bake-pipeline gap is closed)
2. CMS host: `db/scripts/build.sh` + `db/scripts/push.sh` — new db image has the latest schema baked into `01-content.sql`
3. Target hosts: `lifecycle.sh restart` (or `setup` on a fresh host) auto-pulls the new image
4. Fresh-volume target hosts: initdb picks up the new `01-content.sql` automatically
5. Existing-volume target hosts: postgres skips initdb. Operator must either `docker compose down -v` (data = baked content, drop is safe) OR run `cms/cms_pipeline/migrations/apply_to_runtime.sql` first to migrate in place

## Environment variables

### CMS host — `cms/.env` (created by `cms/scripts/env.sh`)

`cms/.env` holds **only provider secrets and operator decisions**. Everything else — the db image name, the audio output directory, and the sentences-bucket size — has code-level defaults and is therefore NOT in the file. See [CMS host config knobs](#cms-host-config-knobs) for the override pattern.

Required (in `cms/.env`):
- `AI_API_KEY` — OpenAI-compatible LLM key
- `AI_BASE_URL` — OpenAI-compatible endpoint (default in template: `https://api.openai.com/v1`; switch to Azure / local / Anthropic-compatible endpoints as needed)
- `AI_MODEL` — model name (default in template: `gpt-3.5-turbo`; switch to `gpt-4o` / etc. as needed)
- `TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY`, `TENCENT_APP_ID` — Tencent Cloud TTS; required when running `staging.sh audio`, optional otherwise

**`POSTGRES_PASSWORD` / `DATABASE_URL` are NOT in `cms/.env` and not read by CMS code.** CMS modules (sync / sentences / audio) do not connect to the database — they only write files to `cms/staging/`. The db side (`db/scripts/source_db.sh` / `build.sh` / `migrate.sh`) resolves `POSTGRES_PASSWORD` itself from shell env or `.secrets/postgres_password` and assembles `DATABASE_URL` before invoking db-side Python. See [Where the db password comes from](#where-the-db-password-comes-from) below.

`AUDIO_DIR` is also **not** in `cms/.env` by default. It now means "root of the local Storage" (only used when `CLOUD_PROVIDER=local_fs`); the code default is `cms/.local/audio` (so Windows / sandboxed Linux hosts can run without sudo). Override via shell env if you need a different location:
```bash
AUDIO_DIR=/your/audio/dir ./cms/scripts/staging.sh audio
```

For multi-host CMS or production, set `CLOUD_PROVIDER=tencent_cos` in `cms/.env` (plus `CLOUD_BUCKET` / `CLOUD_REGION` / `CLOUD_ACCESS_KEY` / `CLOUD_SECRET_KEY`). MP3s upload to the COS bucket instead of the local directory; `sentences.audio_url` becomes the full COS URL. See `cms/cms_pipeline/storage.py` for the abstraction.

`DB_IMAGE_TAG` is not in `cms/.env` either — its default is `db/VERSION` (resolved by `ops/lib.sh` → `resolve_image_tag`); shell env can override it for one-off builds.

`DOCKER_REGISTRY` is not in `cms/.env` — it is shared project config that lives in the committed `REGISTRY` file at the repo root (see [Image registry namespace](#image-registry-namespace) above). Override at push time via shell env if you need a one-off namespace:
```bash
export DOCKER_REGISTRY=docker.io/youruser   # overrides REGISTRY file
./db/scripts/push.sh
```

#### Where the db password comes from

`POSTGRES_PASSWORD` is resolved **exclusively on the db side** (`db/scripts/source_db.sh` / `build.sh` / `migrate.sh`) in this order:
1. **Shell env** — `export POSTGRES_PASSWORD=...` (temporary, e.g. CI)
2. **`.secrets/postgres_password`** (chmod 600) — the same file `ops/{dev,prod}/lifecycle.sh` writes on first start. For a **multi-host** setup, the operator copies this file from the dev/prod host to the CMS host:
   ```bash
   scp user@dev:.secrets/postgres_password .secrets/
   ```
   For a **single-host** setup (CMS + dev on the same machine), the file already exists locally — no extra setup.
3. **Error** — fails loudly with a hint pointing at both options above.

The CMS side (`cms/.env`, `cms_pipeline/env.py`, `cms/scripts/*.sh`) **does not need or read this password** — it has no db connection to make.

### CMS host config knobs (NOT in `cms/.env`)

These have code-level defaults in `db/scripts/build.sh` (db-side knobs: `POSTGRES_*` / `DB_IMAGE_*`) and `cms/cms_pipeline/env.py` (CMS-side knobs: `AUDIO_DIR` / `CLOUD_*` / `DEFAULT_BUCKET_TARGET_SIZE`). Override via shell env when you need a different value:

| Knob | Code default | Override example |
|---|---|---|
| `POSTGRES_USER` | `english_user` | `POSTGRES_USER=foo ./db/scripts/build.sh` |
| `POSTGRES_HOST` | `localhost` | `POSTGRES_HOST=db.internal ./db/scripts/build.sh` |
| `POSTGRES_PORT` | `5432` | (same pattern) |
| `POSTGRES_DB`   | `english_learning` | (same pattern) |
| `POSTGRES_PASSWORD` | (none — db side resolves via shell env or `.secrets/postgres_password`) | `POSTGRES_PASSWORD=... ./db/scripts/build.sh` |
| `DB_IMAGE`      | `english_db_content` | (same pattern) |
| `AUDIO_DIR`     | `cms/.local/audio` | `AUDIO_DIR=/my/audio/dir ./cms/scripts/staging.sh audio` |
| `CLOUD_PROVIDER` | `local_fs` | `CLOUD_PROVIDER=tencent_cos ./cms/scripts/staging.sh audio` |
| `CLOUD_BUCKET` / `CLOUD_REGION` / `CLOUD_ACCESS_KEY` / `CLOUD_SECRET_KEY` | (none) | Required when `CLOUD_PROVIDER=tencent_cos` |
| `DEFAULT_BUCKET_TARGET_SIZE` | `200` | `DEFAULT_BUCKET_TARGET_SIZE=500 ./cms/scripts/staging.sh sentences` |
| `DB_IMAGE_TAG`  | `db/VERSION` | `DB_IMAGE_TAG=v0.5.0 ./db/scripts/build.sh` |

### Target host — no `.env` file required

Runtime configuration is via shell env (passed to `lifecycle.sh` via `KEY=value lifecycle.sh start` or via a systemd unit `Environment=`), with compose-level defaults as a fallback:

- `ALLOWED_ORIGINS` — CORS allowlist. Dev defaults to `http://localhost,http://localhost:3000`; prod defaults to `http://localhost`. Override at start time:
  ```bash
  ALLOWED_ORIGINS=https://my.domain ./ops/prod/lifecycle.sh start
  ```
- `DOCKER_REGISTRY` — registry namespace to push to / pull from. Comes from the committed `REGISTRY` file at the repo root; shell env wins. Pull behavior is **asymmetric**:
  - **Prod**: `lifecycle.sh start` auto-pulls the db + backend + frontend images on every start/restart — registry is the source of truth.
  - **Dev**: `setup.sh` does the **one-time bootstrap pull** when local images are missing. `start` / `restart` **never auto-pull** — image lifecycle is local (build_image.sh / db/scripts/build.sh). Pull manually with `docker pull <full-image>` if needed.

  Empty = local-only mode (no push to / pull from any registry).
- `DB_IMAGE_TAG` — which baked db image to pull. Default: `db/VERSION`.
- `BACKEND_IMAGE_TAG`, `FRONTEND_IMAGE_TAG` — image tag for backend/frontend. Default: `backend/VERSION` on both dev and prod hosts (the single per-segment file gates both the dev and prod image tags at the same value), same for `frontend/VERSION` (resolved by `ops/lib.sh`). Override per image, or set `IMAGE_TAG` to bump all images at once (CI use):
  ```bash
  IMAGE_TAG=v1.2.3 ./ops/prod/lifecycle.sh start
  ```
- `POSTGRES_PASSWORD` — **never set manually**. `lifecycle.sh` generates a fresh 24-char URL-safe value on first start and writes it to `.secrets/postgres_password` (chmod 600). Subsequent restarts reuse the file. Compose mounts it into the db container via `POSTGRES_PASSWORD_FILE` and the assembled `DATABASE_URL_FILE` into the backend container.