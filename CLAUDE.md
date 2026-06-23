# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

English learning web app — plays a sentence's audio and the user types the complete sentence. **All content (vocabulary, AI-generated sentences, TTS audio) is baked into the db image at build time on the CMS host.** Target hosts (dev / prod) are a pure read-layer: no AI calls, no TTS calls, no scheduler, no Python on the host.

## Two-host architecture

This project intentionally separates **content production** from **content serving**:

| Host | Role | What lives here | What runs here |
|---|---|---|---|
| **CMS host** | Content production + image bake | `.env.db` + `scripts/ops/db/` + `db/pipeline/` | Python + Docker |
| **Target host** (dev or prod) | Content serving | `scripts/ops/dev-host/` or `scripts/ops/prod-host/` | Docker only |

The CMS host produces a `db` image with all content pre-loaded and pushes it to a registry. Target hosts `docker pull` the image and serve it — they never need AI keys, TTS keys, or Python. **Target hosts need no .env file at all** — runtime configuration (only `ALLOWED_ORIGINS`) is passed via shell env, and the host-side secret (`POSTGRES_PASSWORD`) is generated on first start by `run.sh`.

Secrets never live inside the db image. Host-side `POSTGRES_PASSWORD` is generated on first start by `run.sh` (or reused if `.secrets/postgres_password` already exists) and written to `.secrets/postgres_password` (chmod 600). It is injected via compose's `secrets` block + `*_FILE` env indirection.

## Repository structure

```
├── VERSION.dev           # tag for english_backend_dev / english_frontend_dev (dev stream)
├── VERSION.prod          # tag for english_db_content / english_backend / english_frontend (prod stream + CMS db)
├── backend/              # FastAPI + SQLAlchemy — pure read-layer
│   ├── app/
│   │   ├── main.py      # FastAPI entry, CORS, /audio static mount
│   │   ├── config.py    # pydantic-settings with _FILE indirection
│   │   ├── database.py  # SQLAlchemy engine/session
│   │   ├── models/      # SQLAlchemy models (VocabularyLib, VocabularyWord, Sentence)
│   │   ├── routers/     # API routes (vocabulary, sentences)
│   │   ├── schemas/     # Pydantic request/response models
│   └── requirements.txt
│
├── frontend/             # React + TypeScript (react-scripts 5.0.1)
│   └── src/app/         # API client + main page
│
├── db/                   # The DB service — image is content-baked
│   ├── Dockerfile       # postgres:15-alpine wrapper. Bakes init/01-content.sql + audio.
│   ├── init/
│   │   ├── 01-content.sql   # schema (committed; populated by bake_image.sh)
│   │   └── 99-audio.sh      # copies /seed/audio → /audio on first init
│   ├── content/
│   │   └── vocabulary/      # operator-maintained CSVs (committed)
│   └── pipeline/            # Python modules (CMS-only, NOT in the image)
│       ├── env.py           # .env.db loader + Config dataclass
│       ├── import_vocab.py
│       ├── generate_sentences.py
│       ├── generate_audio.py
│       ├── export_bundle.py
│       └── README.md
│
├── scripts/
│   ├── README.md            # scripts/ layout, lib.sh helpers, conventions for new scripts
│   ├── lib.sh               # shared helpers (ok/warn/err, docker detection, gen_secret)
│   ├── release.sh           # release orchestrator: bump + build + push (dev / prod / show)
│   ├── ops/                 # host-operations scripts (configure env / build image / run containers)
│   │   ├── db/              # CMS host — operates on the db service
│   │   │   ├── env.sh         # .env.db lifecycle (init/update/show/doctor)
│   │   │   ├── content.sh     # sync / sentences / audio / publish / export / doctor
│   │   │   ├── bake_image.sh  # DB → staging bundle → docker build
│   │   │   └── push_image.sh  # registry push
│   │   ├── dev-host/        # dev target host
│   │   │   ├── run.sh         # compose lifecycle (start/stop/restart/logs/doctor)
│   │   │   ├── build_image.sh # local backend+frontend image build
│   │   │   └── push_image.sh  # push backend+frontend to DOCKER_REGISTRY
│   │   └── prod-host/       # prod target host
│   │       ├── run.sh         # compose lifecycle
│   │       ├── build_image.sh # local backend+frontend image build
│   │       └── push_image.sh  # push backend+frontend to DOCKER_REGISTRY
│   └── dev/                 # developer tools (lint/test/generate/...) — currently empty
│
├── nginx/               # Nginx reverse proxy config
└── docker-compose.yml   # Runtime orchestration for target hosts
```

The runtime `docker-compose.yml` references the `db` image as a service — the image's OCI labels (`type-any-language.db.user`, `type-any-language.db.name`, `type-any-language.content.version`, `type-any-language.content.baked-at`) are read at start time by `scripts/ops/dev-host/run.sh` / `scripts/ops/prod-host/run.sh` to discover the db identity. `POSTGRES_PASSWORD` is NOT in those labels.

## Commands

### CMS host — content production

```bash
./scripts/ops/db/env.sh                # First-time .env.db creation (interactive)
./scripts/ops/db/content.sh doctor     # Pre-flight: .env.db + Python deps + DB reachable
./scripts/ops/db/content.sh sync       # CSVs → vocabulary_libs + vocabulary_words
./scripts/ops/db/content.sh sentences  # OpenAI bulk-fills sentences to DEFAULT_BUCKET_TARGET_SIZE
./scripts/ops/db/content.sh audio      # Tencent TTS bulk-fills audio_url + MP3
./scripts/ops/db/bake_image.sh         # Dump + audio copy + docker build
./scripts/ops/db/push_image.sh [-y]    # Push the db image to DOCKER_REGISTRY
```

`scripts/ops/db/content.sh` is a thin wrapper over the `db/pipeline/*.py` modules (PYTHONPATH=db). Each subcommand has its own `--help`. See `db/pipeline/README.md` for module details.

### Dev target host

```bash
./scripts/ops/dev-host/run.sh doctor         # Pre-flight
./scripts/ops/dev-host/run.sh start          # compose up (hot-reload, bind-mounted)
./scripts/ops/dev-host/run.sh stop
./scripts/ops/dev-host/run.sh restart        # Hard restart (recreate + re-read secrets)
./scripts/ops/dev-host/run.sh logs
# Optional image publishing (offline / first-time local setup → registry):
./scripts/ops/dev-host/build_image.sh        # build english_backend_dev + english_frontend_dev
./scripts/ops/dev-host/push_image.sh -y      # push them to DOCKER_REGISTRY
```

No `.env.dev` is needed. The dev compose file defaults `ALLOWED_ORIGINS` to `http://localhost,http://localhost:3000`; override via shell env. `POSTGRES_PASSWORD` is generated on first start.

### Prod target host

```bash
ALLOWED_ORIGINS=https://my.domain ./scripts/ops/prod-host/run.sh start
./scripts/ops/prod-host/run.sh doctor
./scripts/ops/prod-host/run.sh start
./scripts/ops/prod-host/run.sh stop
./scripts/ops/prod-host/run.sh restart
./scripts/ops/prod-host/run.sh logs
# Optional image publishing:
./scripts/ops/prod-host/build_image.sh        # build english_backend + english_frontend
./scripts/ops/prod-host/push_image.sh -y      # push them to DOCKER_REGISTRY
```

No `.env` is needed. `ALLOWED_ORIGINS` defaults to `http://localhost` in the prod compose — override via shell env (shown above) or edit the compose file directly. `POSTGRES_PASSWORD` is generated on first start.

**Image registry model**: CMS host pushes the content-baked `db` image; each target host pushes its own `backend + frontend` images. Target hosts `docker pull` all 3 from `$DOCKER_REGISTRY` when `DOCKER_REGISTRY` is set (auto-pulled by `run.sh start`).

## Image version tags

All 5 images (`db`, `english_backend{,_dev}`, `english_frontend{,_dev}`) carry an explicit tag. Defaults come from two root files — dev and prod can drift independently:

| Image | Default tag source |
|---|---|
| `english_db_content`         | `VERSION.prod` |
| `english_backend_dev`        | `VERSION.dev`  |
| `english_frontend_dev`       | `VERSION.dev`  |
| `english_backend`            | `VERSION.prod` |
| `english_frontend`           | `VERSION.prod` |

(The db image is "prod-bound" content — it's shared by both targets, so a dev host always pulls db's tag from `VERSION.prod`. Only dev's app images follow `VERSION.dev`.)

Each file: first non-empty, non-comment line, trimmed. Both files start at the same version; bump them together with `release.sh bump all X.Y.Z`, or independently with `bump dev` / `bump prod`.

Resolution chain (`scripts/lib.sh` → `resolve_image_tag`):
1. Per-image env var, e.g. `BACKEND_IMAGE_TAG=v1.2.3`
2. Generic `IMAGE_TAG` (CI convenience — bumps all images at once)
3. The VERSION file passed to the helper (`.dev` / `.prod`)
4. Literal `v0.0.0` (won't break a build, but warns once)

Examples:
```bash
# Use whatever the stream's VERSION file says (default):
./scripts/ops/dev-host/build_image.sh         # → VERSION.dev
./scripts/ops/prod-host/build_image.sh        # → VERSION.prod
./scripts/ops/db/bake_image.sh                # → VERSION.prod

# Bump all images to v1.2.3 for a one-off (CI use):
IMAGE_TAG=v1.2.3 ./scripts/ops/dev-host/build_image.sh
IMAGE_TAG=v1.2.3 ./scripts/ops/prod-host/build_image.sh
IMAGE_TAG=v1.2.3 ./scripts/ops/db/bake_image.sh

# Pin just the db image, leave dev app at VERSION.dev:
DB_IMAGE_TAG=v0.5.0 ./scripts/ops/db/bake_image.sh
```

For a full release (bump + build + push), use `scripts/release.sh dev|prod X.Y.Z` instead of running these individually — see "Release flow" below.

The dev/prod `run.sh` reads the same tags at start time, so what gets pulled from the registry matches what was built. `push_image.sh` uses the same convention.

### Drift detection

Every image carries the `type-any-language.app.version` LABEL (sourced from `APP_VERSION` build-arg, which the build scripts set to the resolved `*_IMAGE_TAG`). `run.sh doctor` (both dev and prod) iterates the running containers and compares each LABEL against the locally-resolved expected tag — mismatches print a `drift` warning, suggesting `run.sh restart` to pick up the new image. This catches the case where a VERSION file was bumped on the workstation but the target host hasn't pulled/restarted yet.

### Release flow

`scripts/release.sh` is the single point of release orchestration. It updates the right VERSION file, commits, then **builds and pushes** the relevant images — local-only when `DOCKER_REGISTRY` is unset, registry-push when it's set.

| Subcommand | Bumps | Builds + pushes |
|---|---|---|
| `show`              | — | — (print current VERSION.dev / VERSION.prod) |
| `dev  [X.Y.Z]`      | `VERSION.dev`  | `english_{backend,frontend}_dev` |
| `prod [X.Y.Z]`      | `VERSION.prod` | db (content-baked) + `english_{backend,frontend}` |

`X.Y.Z` is optional: omit it to publish the current VERSION without bumping. Add `-y` to skip the bump-confirmation prompt.

Local vs remote is controlled by the shell env:

```bash
# Local mode — build images, no push
./scripts/release.sh dev v0.3.0

# Remote mode — build + tag + push to your registry
export DOCKER_REGISTRY=docker.io/youruser
./scripts/release.sh prod v0.3.0 -y

# Re-publish current VERSION (no bump)
./scripts/release.sh dev
```

The full release flow with the new `release.sh` (one command per host):

```bash
# On the workstation — after merging changes to master:
./scripts/release.sh dev v0.3.0       # bump VERSION.dev + build + push dev b/f
./scripts/release.sh prod v0.3.0 -y    # bump VERSION.prod + bake db + push db + build + push prod b/f
git push

# On each target host — just verify, the images are already in the registry:
./scripts/ops/<host>/run.sh doctor    # should show "drift OK (version=v0.3.0)" for all 3 services
./scripts/ops/<host>/run.sh restart   # pull new image and recreate
```

Architecture notes:
- `release.sh dev` only touches the dev app images. The db image is prod-bound and reads `VERSION.prod`; if you want dev to see new content, run `release.sh prod` first (or just push a new db with `VERSION.prod`).
- `release.sh prod` includes the db bake. That step needs `.env.db`, so `prod` must run on the CMS host (or a single-machine CMS+prod setup). On a dedicated prod target host without `.env.db`, run `scripts/ops/db/bake_image.sh` on the CMS host first, then run `scripts/ops/prod-host/build_image.sh` + `push_image.sh` on the prod host.
- For multi-machine deployments, run each subcommand on its respective host. The script is self-contained per host.

## Migration from pre-VERSION release

If you upgraded from a release that used `:latest` (or hardcoded) tags, expect two behavior changes on first run:

1. **`run.sh start` may fail with "image 未构建"** — the compose file now references a tagged tag (`:v0.1.0` or whatever the stream's VERSION file says), not `:latest`. Fix once:
   ```bash
   ./scripts/ops/dev-host/build_image.sh    # or prod-host/build_image.sh
   ```
   Old `:latest` images on the host will still exist as stale tags. They're harmless; clean up later with `docker rmi english_backend_dev:latest english_frontend_dev:latest`.

2. **`compose pull` now pulls by versioned tag, not `:latest`.** If your local cache has a stale `:latest` and the registry has a different `:v0.1.0`, the pull overwrites the local tag. This is intentional — it's the whole point of having a version pin.

There is no automatic `:latest` → tagged retag helper, because it would silently lie about what's in the image. Rebuilding once is the only correct migration.

### Migration to the two-file model (this release)

The previous release had a single `VERSION` file. This release splits it into `VERSION.dev` and `VERSION.prod` so the two streams can drift. If your local checkout still has the old single `VERSION`:

1. Pull this release. The old `VERSION` is removed; you'll have the two new files instead.
2. `./scripts/release.sh show` should print both files (they start at the same value as the old single VERSION).
3. Continue as normal — `build_image.sh` / `bake_image.sh` now read from the right stream's file automatically.

### Testing

```bash
# Frontend
cd frontend && npm test

# Backend (single test, requires pytest)
cd backend && python -m pytest tests/test_file.py::test_name -v
```

## Key API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/vocabulary/libs` | GET | List all vocabulary libraries |
| `/api/vocabulary/libs/{id}/random` | GET | Get N random words from a library |
| `/api/sentences/generate` | POST | Get a practice sentence (cache-first: serves baked sentence or generates + persists) |
| `/api/sentences/check` | POST | Validate user input against correct answer |
| `/audio/{filename}` | GET | Static MP3 from the shared-audio volume (baked into db image) |

## Data flow

**Bake time (CMS host):**
1. Operator commits new CSVs to `db/content/vocabulary/`.
2. `content.sh sync` imports them into `vocabulary_libs` / `vocabulary_words`.
3. `content.sh sentences` calls OpenAI to fill the `sentences` table up to `DEFAULT_BUCKET_TARGET_SIZE` per (lib, difficulty).
4. `content.sh audio` calls Tencent TTS; MP3s land in `AUDIO_DIR` (sha1[:16] filenames), `sentences.audio_url` is updated.
5. `bake_image.sh` runs `pg_dump` on the 3 content tables, copies `AUDIO_DIR` into `db/seed/audio/`, builds the db image with those + `db/init/01-content.sql`.
6. `push_image.sh` pushes to `DOCKER_REGISTRY`.

**Runtime (target host):**
1. `run.sh start` reads the db image's labels, generates (or reuses) `POSTGRES_PASSWORD` and writes both `.secrets/postgres_password` + `.secrets/database_url`, then `compose up`.
2. On first start, the db image's `/docker-entrypoint-initdb.d/` runs `01-content.sql` (creates schema, loads content) and `99-audio.sh` (copies `/seed/audio/*` → `/audio/`).
3. Frontend fetches a sentence, browser plays its MP3 from `/audio/{hash}.mp3` (served by backend's `StaticFiles` mount, in dev proxied through nginx).
4. User submits answer → `validate_answer()` normalizes (lowercase, strip punctuation/spaces) and compares.

## Environment variables

### CMS host — `.env.db` (created by `scripts/ops/db/env.sh`)

Required:
- `DATABASE_URL` — Postgres connection (used by `pipeline/*.py`)
- `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` — OpenAI-compatible LLM
- `TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY`, `TENCENT_APP_ID` — Tencent Cloud TTS
- `AUDIO_DIR` — where `generate_audio.py` writes MP3s and `bake_image.sh` reads them from
- `POSTGRES_USER`, `POSTGRES_DB` — db identity (baked into image labels)
- `DB_IMAGE` — image name (default: `english_db_content`)
- `DB_IMAGE_TAG` — image tag (default: root `VERSION.prod`; `.env.db` / shell env override)

> `DOCKER_REGISTRY` is **not** in `.env.db` — push is a separate concern. Set it in the shell before running `push_image.sh`:
> ```bash
> export DOCKER_REGISTRY=docker.io/youruser
> ./scripts/ops/db/push_image.sh
> ```
> (Symmetric with dev/prod `push_image.sh`.)

Optional:
- `DEFAULT_BUCKET_TARGET_SIZE` — sentences per (lib, difficulty) bucket (default 200)

### Target host — no `.env` file required

Runtime configuration is via shell env (passed to `run.sh` via `KEY=value run.sh start` or via a systemd unit `Environment=`), with compose-level defaults as a fallback:

- `ALLOWED_ORIGINS` — CORS allowlist. Dev defaults to `http://localhost,http://localhost:3000`; prod defaults to `http://localhost`. Override at start time:
  ```bash
  ALLOWED_ORIGINS=https://my.domain ./scripts/ops/prod-host/run.sh start
  ```
- `DOCKER_REGISTRY`, `DB_IMAGE_TAG` — which baked db image to pull (default: `VERSION.prod`; when `DOCKER_REGISTRY` is set, `run.sh start` auto-pulls on every start/restart)
- `BACKEND_IMAGE_TAG`, `FRONTEND_IMAGE_TAG` — image tag for backend/frontend. Default: `VERSION.dev` on dev hosts, `VERSION.prod` on prod hosts (resolved by `scripts/lib.sh`). Override per image, or set `IMAGE_TAG` to bump all images at once (CI use):
  ```bash
  IMAGE_TAG=v1.2.3 ./scripts/ops/prod-host/run.sh start
  ```
- `POSTGRES_PASSWORD` — **never set manually**. `run.sh` generates a fresh 24-char URL-safe value on first start and writes it to `.secrets/postgres_password` (chmod 600). Subsequent restarts reuse the file. Compose mounts it into the db container via `POSTGRES_PASSWORD_FILE` and the assembled `DATABASE_URL_FILE` into the backend container.