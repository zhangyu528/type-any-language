# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

English learning web app — plays a sentence's audio and the user types the complete sentence. **All content (vocabulary, AI-generated sentences, TTS audio) is baked into the db image at build time on the CMS host.** Target hosts (dev / prod) are a pure read-layer: no AI calls, no TTS calls, no scheduler, no Python on the host.

## Two-host architecture

This project intentionally separates **content production** from **content serving**:

| Host | Role | What lives here | What runs here |
|---|---|---|---|
| **CMS host** | Content production + image bake | `.env.db` + `scripts/ops/content/` + `content/tools/cms/` | Python + Docker |
| **Target host** (dev or prod) | Content serving | `scripts/ops/dev-host/` or `scripts/ops/prod-host/` | Docker only |

The CMS host produces a `db` image with all content pre-loaded and pushes it to a registry. Target hosts `docker pull` the image and serve it — they never need AI keys, TTS keys, or Python. **Target hosts need no .env file at all** — runtime configuration (only `ALLOWED_ORIGINS`) is passed via shell env, and the host-side secret (`POSTGRES_PASSWORD`) is generated on first start by `run.sh`.

Secrets never live inside the db image. Host-side `POSTGRES_PASSWORD` is generated on first start by `run.sh` (or reused if `.secrets/postgres_password` already exists) and written to `.secrets/postgres_password` (chmod 600). It is injected via compose's `secrets` block + `*_FILE` env indirection.

## Repository structure

```
├── VERSION.dev           # tag for english_backend_dev / english_frontend_dev (dev stream)
├── VERSION.prod          # tag for english_db_content / english_backend / english_frontend (prod stream + CMS db)
├── REGISTRY              # DOCKER_REGISTRY namespace for push/pull (committed shared config)
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
├── frontend/             # Next.js 14 (App Router) + React 18 + TypeScript
│   └── src/app/         # API client + main page
│
├── content/              # The content service — produces + ships the content image
│   ├── source/           # operator-maintained source (git-tracked, hand-edited)
│   │   ├── manifest.yaml
│   │   ├── vocabulary/   # CSVs per lib
│   │   └── prompts/      # LLM prompts (sentences.yaml)
│   ├── tools/            # CMS toolchain (lives only on the CMS host)
│   │   ├── Dockerfile    # cms-sidecar (LOCAL-ONLY image, no registry)
│   │   └── cms/          # Python package (env / manifest / import_vocab / generate_* / export_bundle / init_schema / migrations)
│   │       └── README.md
│   └── runtime/          # Postgres image build context (postgres:15-alpine wrapper)
│       ├── Dockerfile    # copies init/01-content.sql + seed/audio
│       ├── entrypoint.sh # /audio permission fix → standard postgres entrypoint
│       ├── init/
│       │   ├── 01-content.sql   # pg_dump snapshot (bake-time output; .gitignore'd)
│       │   └── 99-audio.sh      # copies /seed/audio → /audio on first init
│       └── seed/audio/          # baked MP3s (bake-time output; .gitignore'd)
│
├── scripts/
│   ├── README.md            # scripts/ layout, lib.sh helpers, conventions for new scripts
│   ├── lib.sh               # shared helpers (ok/warn/err, docker detection, gen_secret)
│   ├── release.sh           # release orchestrator: bump + build + push (dev / prod / show)
│   ├── ops/                 # host-operations scripts (configure env / build image / run containers)
│   │   ├── content/         # CMS host — operates on the content service
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
./scripts/ops/content/env.sh                # First-time .env.db creation (interactive)
./scripts/ops/content/content.sh doctor     # Pre-flight: .env.db + Python deps + DB reachable
./scripts/ops/content/content.sh sync       # CSVs → vocabulary_libs + vocabulary_words
./scripts/ops/content/content.sh sentences  # OpenAI bulk-fills sentences to DEFAULT_BUCKET_TARGET_SIZE
./scripts/ops/content/content.sh audio      # Tencent TTS bulk-fills audio_url + MP3
./scripts/ops/content/bake_image.sh         # Dump + audio copy + docker build
./scripts/ops/content/push_image.sh [-y]    # Push the db image to DOCKER_REGISTRY
```

`scripts/ops/content/content.sh` is a thin wrapper over the `content/tools/cms/*.py` modules (PYTHONPATH=db). Each subcommand has its own `--help`. See `content/tools/cms/README.md` for module details.

### Dev target host

```bash
./scripts/ops/dev-host/run.sh setup          # First-time: 拉/检查 db image + build dev apps
./scripts/ops/dev-host/run.sh doctor         # Pre-flight
./scripts/ops/dev-host/run.sh start          # compose up + 后台 spawn compose watch(自动 sync src/package.json)
./scripts/ops/dev-host/run.sh stop
./scripts/ops/dev-host/run.sh restart        # Hard restart (recreate + re-read secrets)
./scripts/ops/dev-host/run.sh migrate        # Apply pending schema migrations to runtime db
./scripts/ops/dev-host/run.sh logs
# Optional image publishing (offline / first-time local setup → registry):
./scripts/ops/dev-host/build_image.sh        # build english_backend_dev + english_frontend_dev
./scripts/ops/dev-host/push_image.sh -y      # push them to DOCKER_REGISTRY
```

No `.env.dev` is needed. The dev compose file defaults `ALLOWED_ORIGINS` to `http://localhost,http://localhost:3000`; override via shell env. `POSTGRES_PASSWORD` is generated on first start.

`setup` is the recommended entry point for a fresh checkout. It runs preflight (docker + compose), ensures the `db` image is present locally (auto-pulls from `DOCKER_REGISTRY` if set, otherwise — on a single-host CMS+dev machine — scaffolds `.env.db` via `env.sh init` + validates with `env.sh doctor`, then runs the full local content pipeline: source db → schema → vocab CSVs → AI sentences → TTS audio → `bake_image.sh`), and builds the dev `backend + frontend` images. It does NOT start containers or create `.secrets/` — that's `start`'s job. Re-running `setup` is safe (idempotent — every step short-circuits on existing state).

### Prod target host

```bash
./scripts/ops/prod-host/run.sh setup         # First-time: 拉 db image + build prod apps
./scripts/ops/prod-host/run.sh doctor
ALLOWED_ORIGINS=https://my.domain ./scripts/ops/prod-host/run.sh start
./scripts/ops/prod-host/run.sh start
./scripts/ops/prod-host/run.sh stop
./scripts/ops/prod-host/run.sh restart
./scripts/ops/prod-host/run.sh logs
# Optional image publishing:
./scripts/ops/prod-host/build_image.sh        # build english_backend + english_frontend
./scripts/ops/prod-host/push_image.sh -y      # push them to DOCKER_REGISTRY
```

`setup` is the recommended entry point for a fresh prod host. Same flow as dev: preflight + ensure `db` image present (auto-pull from `DOCKER_REGISTRY`) + build prod `backend + frontend`. The prod host never bakes db content itself — it pulls from a registry. If `DOCKER_REGISTRY` is empty, `setup` exits with the CMS-side steps.

No `.env` is needed. `ALLOWED_ORIGINS` defaults to `http://localhost` in the prod compose — override via shell env (shown above) or edit the compose file directly. `POSTGRES_PASSWORD` is generated on first start.

**Image registry model**: CMS host pushes the content-baked `db` image; each target host pushes its own `backend + frontend` images.
- **Prod target host**: `docker pull` all 3 from `$DOCKER_REGISTRY` on every `run.sh start` / `restart` (auto-pulled — registry is the source of truth for prod).
- **Dev target host**: `run.sh setup` does the **one-time bootstrap pull** from `$DOCKER_REGISTRY` when local images are missing. `start` / `restart` **never auto-pull** — dev iteration is local-first; image lifecycle is owned by `build_image.sh` / `bake_image.sh` on the host. This avoids overwriting fresh local builds with stale registry versions. To pull explicitly: `docker pull <full-image>`.

The registry namespace (e.g. `docker.io/zhangyu528`) is **shared project config** that the whole team uses. It is **not** a personal secret, so it lives in the committed `REGISTRY` file at the repo root (symmetric with `VERSION.dev` / `VERSION.prod`), not in `.env.db` (gitignored). See [Image registry namespace](#image-registry-namespace) below.

## Image registry namespace

The `DOCKER_REGISTRY` shell variable is the namespace prefix prepended to `image:tag` for `docker push` / `docker pull`. The chain (`scripts/lib.sh` → `resolve_docker_registry`) is, in order of decreasing precedence:

1. **Shell env** — `export DOCKER_REGISTRY=docker.io/youruser` (highest priority; CI / one-off override)
2. **`./REGISTRY` file at repo root** — committed, shared project config (typical default)
3. **`detect_default_registry()`** — `docker.io/$USER` (best-effort guess; useful for solo dev work)
4. **Empty** — local-only mode; push scripts fail with a clear error, run scripts just skip the auto-pull

The `REGISTRY` file's format: first non-empty, non-comment line starting with `DOCKER_REGISTRY=`. It ships with the `DOCKER_REGISTRY=` line **commented out** — fill it in and uncomment to publish the team's shared namespace.

```bash
# REGISTRY
DOCKER_REGISTRY=docker.io/zhangyu528   # ← uncomment + edit
```

> Why committed and not `.env`? Like `VERSION.dev` / `VERSION.prod`, this is shared project config that the whole team should agree on — putting it in a gitignored `.env` means every operator has to set it themselves, and the same value gets typed in N places. Personal secrets (postgres password, AI keys, TTS keys) stay in `.env.db` (gitignored); shared config lives at the repo root.

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
./scripts/ops/content/bake_image.sh                # → VERSION.prod

# Bump all images to v1.2.3 for a one-off (CI use):
IMAGE_TAG=v1.2.3 ./scripts/ops/dev-host/build_image.sh
IMAGE_TAG=v1.2.3 ./scripts/ops/prod-host/build_image.sh
IMAGE_TAG=v1.2.3 ./scripts/ops/content/bake_image.sh

# Pin just the db image, leave dev app at VERSION.dev:
DB_IMAGE_TAG=v0.5.0 ./scripts/ops/content/bake_image.sh
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

Local vs remote is controlled by `DOCKER_REGISTRY` (chain: shell env → `./REGISTRY` file → auto-detect → empty):

```bash
# Local mode — build images, no push
./scripts/release.sh dev v0.3.0

# Remote mode — uses REGISTRY file (committed, shared team namespace)
# (or override via shell env if pushing to a one-off namespace)
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
- `release.sh prod` includes the db bake. That step needs `.env.db`, so `prod` must run on the CMS host (or a single-machine CMS+prod setup). On a dedicated prod target host without `.env.db`, run `scripts/ops/content/bake_image.sh` on the CMS host first, then run `scripts/ops/prod-host/build_image.sh` + `push_image.sh` on the prod host.
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
| `/audio/{filename}` | GET | Static MP3 from the shared-audio volume (baked into db image) |

Answer validation is **client-side**: the frontend normalizes (lowercase, strip punctuation, collapse whitespace) and compares against `sentence.text` directly. No `/api/sentences/check` endpoint.

## Data flow

**Bake time (CMS host):**
1. Operator commits new CSVs to `content/source/vocabulary/`.
2. `content.sh sync` imports them into `vocabulary_libs` / `vocabulary_words`.
3. `content.sh sentences` calls OpenAI to fill the `sentences` table up to `DEFAULT_BUCKET_TARGET_SIZE` per (lib, difficulty).
4. `content.sh audio` calls Tencent TTS; MP3s land in `AUDIO_DIR` (sha1[:16] filenames), `sentences.audio_url` is updated.
5. `bake_image.sh` runs `pg_dump` on the 3 content tables, copies `AUDIO_DIR` into `content/runtime/seed/audio/`, builds the db image with those + `content/runtime/init/01-content.sql`.
6. `push_image.sh` pushes to `DOCKER_REGISTRY`.

**Runtime (target host):**
1. `run.sh start` reads the db image's labels, generates (or reuses) `POSTGRES_PASSWORD` and writes both `.secrets/postgres_password` + `.secrets/database_url`, then `compose up`.
2. On first start, the db image's `/docker-entrypoint-initdb.d/` runs `01-content.sql` (creates schema, loads content) and `99-audio.sh` (copies `/seed/audio/*` → `/audio/`).
3. Frontend fetches a sentence, browser plays its MP3 from `/audio/{hash}.mp3` (served by backend's `StaticFiles` mount, in dev proxied through nginx).
4. User submits answer → `validate_answer()` normalizes (lowercase, strip punctuation/spaces) and compares.

## Schema migrations

Schema lives in two places that must stay in sync:
- **`backend/app/models/*.py`** — SQLAlchemy declarative schema (the runtime truth)
- **`content/runtime/init/01-content.sql`** — pg_dump snapshot baked into the db image (the *initial* truth for fresh volumes)
- **`content/tools/cms/migrations/versions/*.py`** — ordered DDL applied to existing volumes when schema evolves

Migrations use a tiny hand-written runner (`content/tools/cms/migrations/runner.py`, ~60 lines, no Alembic). Each version is a Python module exposing `upgrade(conn)` / `downgrade(conn)`. Idempotent via `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` etc.

### Dev iteration (light-touch)

When you add or change a migration in `content/tools/cms/migrations/versions/`:

```bash
# Source db (CMS pipeline, if running): the migrations apply so a future
# bake has the new schema in 01-content.sql
./scripts/ops/content/content.sh init-schema

# Runtime db (the one your backend is actually querying): in-place upgrade,
# no image bake, no registry push, no volume drop
./scripts/ops/dev-host/run.sh migrate
```

`run.sh migrate` spins up a one-shot `python:3.11-slim` sidecar on the compose network and runs `pipeline.migrations.runner` against `db:5432`. Idempotent — re-runs are no-ops. The backend picks up the new schema on the next request (no restart needed; uvicorn hot-reload handles Python changes).

**Offline fallback** (when `python:3.11-slim` can't be pulled, e.g. broken registry mirrors): `content/tools/cms/migrations/apply_to_runtime.sql` is a pre-rolled SQL file that brings a stale runtime db up to the current head in one shot. `run.sh migrate` prints the exact `docker exec ... psql < apply_to_runtime.sql` command on pull failure. This file applies all known migrations and stamps them as done — it only works for upgrading an old db to head, not for dev-iteration of a brand-new migration (which needs the runner).

### Production rollout

When the operator merges new schema changes:
1. CMS host: `content.sh init-schema` (already in `release.sh prod`'s flow once the bake-pipeline gap is closed)
2. CMS host: `bake_image.sh` + `push_image.sh` — new db image has the latest schema baked into `01-content.sql`
3. Target hosts: `run.sh restart` (or `setup` on a fresh host) auto-pulls the new image
4. Fresh-volume target hosts: initdb picks up the new `01-content.sql` automatically
5. Existing-volume target hosts: postgres skips initdb. Operator must either `docker compose down -v` (data = baked content, drop is safe) OR run `content/tools/cms/migrations/apply_to_runtime.sql` first to migrate in place

## Environment variables

### CMS host — `.env.db` (created by `scripts/ops/content/env.sh`)

`.env.db` holds **only provider secrets and operator decisions**. Everything else — the Postgres connection (DATABASE_URL), the db identity (POSTGRES_USER/HOST/PORT/DB), the image name, the audio output directory, and the sentences-bucket size — has code-level defaults and is therefore NOT in the file. See [CMS host config knobs](#cms-host-config-knobs) for the override pattern.

Required (in `.env.db`):
- `AI_API_KEY` — OpenAI-compatible LLM key
- `AI_BASE_URL` — OpenAI-compatible endpoint (default in template: `https://api.openai.com/v1`; switch to Azure / local / Anthropic-compatible endpoints as needed)
- `AI_MODEL` — model name (default in template: `gpt-3.5-turbo`; switch to `gpt-4o` / etc. as needed)
- `TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY`, `TENCENT_APP_ID` — Tencent Cloud TTS; required when running `content.sh audio`, optional otherwise

`DATABASE_URL` is **not** in `.env.db`. It's assembled at runtime by `content/tools/cms/env.py` + `scripts/ops/content/bake_image.sh` from:
- `POSTGRES_PASSWORD` (the only piece without a code default — see [Where the db password comes from](#where-the-db-password-comes-from))
- `POSTGRES_USER` (default `english_user`), `POSTGRES_HOST` (default `localhost`), `POSTGRES_PORT` (default `5432`), `POSTGRES_DB` (default `english_learning`)

`AUDIO_DIR` is also **not** in `.env.db`. Code default is `/var/lib/type-any-language/audio` (XDG-style); `generate_audio.py` and `bake_image.sh` will `mkdir -p` it. Override via shell env on systems where `/var/lib` isn't writable (Windows, no sudo):
```bash
AUDIO_DIR=/your/audio/dir ./scripts/ops/content/content.sh audio
```

`DB_IMAGE_TAG` is not in `.env.db` either — its default is the root `VERSION.prod` file (resolved by `scripts/lib.sh` → `resolve_image_tag`); shell env can override it for one-off builds.

`DOCKER_REGISTRY` is not in `.env.db` — it is shared project config that lives in the committed `REGISTRY` file at the repo root (see [Image registry namespace](#image-registry-namespace) above). Override at push time via shell env if you need a one-off namespace:
```bash
export DOCKER_REGISTRY=docker.io/youruser   # overrides REGISTRY file
./scripts/ops/content/push_image.sh
```

#### Where the db password comes from

`POSTGRES_PASSWORD` is resolved by `content/tools/cms/env.py` / `scripts/ops/content/bake_image.sh` in this order:
1. **Shell env** — `export POSTGRES_PASSWORD=...` (temporary, e.g. CI)
2. **`.secrets/postgres_password`** (chmod 600) — the same file `scripts/ops/{dev,prod}-host/run.sh` writes on first start. For a **multi-host** setup, the operator copies this file from the dev/prod host to the CMS host:
   ```bash
   scp user@dev-host:.secrets/postgres_password .secrets/
   ```
   For a **single-host** setup (CMS + dev on the same machine), the file already exists locally — no extra setup.
3. **Error** — fails loudly with a hint pointing at both options above.

`env.sh doctor` checks both options and fails if neither is available.

### CMS host config knobs (NOT in `.env.db`)

These have code-level defaults in `content/tools/cms/env.py` / `scripts/ops/content/bake_image.sh` / `lib.sh`. Override via shell env when you need a different value:

| Knob | Code default | Override example |
|---|---|---|
| `POSTGRES_USER` | `english_user` | `POSTGRES_USER=foo ./scripts/ops/content/bake_image.sh` |
| `POSTGRES_HOST` | `localhost` | `POSTGRES_HOST=db.internal ./scripts/ops/content/content.sh sentences` |
| `POSTGRES_PORT` | `5432` | (same pattern) |
| `POSTGRES_DB`   | `english_learning` | (same pattern) |
| `POSTGRES_PASSWORD` | (none — see above) | `POSTGRES_PASSWORD=... ./scripts/ops/content/bake_image.sh` |
| `DB_IMAGE`      | `english_db_content` | (same pattern) |
| `AUDIO_DIR`     | `/var/lib/type-any-language/audio` | `AUDIO_DIR=/your/audio/dir ./scripts/ops/content/content.sh audio` |
| `DEFAULT_BUCKET_TARGET_SIZE` | `200` | `DEFAULT_BUCKET_TARGET_SIZE=500 ./scripts/ops/content/content.sh sentences` |
| `DB_IMAGE_TAG`  | `VERSION.prod` | `DB_IMAGE_TAG=v0.5.0 ./scripts/ops/content/bake_image.sh` |

### Target host — no `.env` file required

Runtime configuration is via shell env (passed to `run.sh` via `KEY=value run.sh start` or via a systemd unit `Environment=`), with compose-level defaults as a fallback:

- `ALLOWED_ORIGINS` — CORS allowlist. Dev defaults to `http://localhost,http://localhost:3000`; prod defaults to `http://localhost`. Override at start time:
  ```bash
  ALLOWED_ORIGINS=https://my.domain ./scripts/ops/prod-host/run.sh start
  ```
- `DOCKER_REGISTRY` — registry namespace to push to / pull from. Comes from the committed `REGISTRY` file at the repo root; shell env wins. Pull behavior is **asymmetric**:
  - **Prod**: `run.sh start` auto-pulls the db + backend + frontend images on every start/restart — registry is the source of truth.
  - **Dev**: `run.sh setup` does the **one-time bootstrap pull** when local images are missing. `start` / `restart` **never auto-pull** — image lifecycle is local (build_image.sh / bake_image.sh). Pull manually with `docker pull <full-image>` if needed.

  Empty = local-only mode (no push to / pull from any registry).
- `DB_IMAGE_TAG` — which baked db image to pull. Default: `VERSION.prod`.
- `BACKEND_IMAGE_TAG`, `FRONTEND_IMAGE_TAG` — image tag for backend/frontend. Default: `VERSION.dev` on dev hosts, `VERSION.prod` on prod hosts (resolved by `scripts/lib.sh`). Override per image, or set `IMAGE_TAG` to bump all images at once (CI use):
  ```bash
  IMAGE_TAG=v1.2.3 ./scripts/ops/prod-host/run.sh start
  ```
- `POSTGRES_PASSWORD` — **never set manually**. `run.sh` generates a fresh 24-char URL-safe value on first start and writes it to `.secrets/postgres_password` (chmod 600). Subsequent restarts reuse the file. Compose mounts it into the db container via `POSTGRES_PASSWORD_FILE` and the assembled `DATABASE_URL_FILE` into the backend container.