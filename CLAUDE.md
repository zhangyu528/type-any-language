# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

English learning web app — plays a sentence's audio and the user types the complete sentence. **All content (vocabulary, AI-generated sentences, TTS audio) is baked into the db image at build time on the CMS host.** Target hosts (dev / prod) are a pure read-layer: no AI calls, no TTS calls, no scheduler, no Python on the host.

## Two-host architecture

This project intentionally separates **content production** from **content serving**:

| Host | Role | What lives here | What runs here |
|---|---|---|---|
| **CMS host** | Content production + image bake | `.env.cms` + `scripts/ops/db/` + `db/pipeline/` | Python + Docker |
| **Target host** (dev or prod) | Content serving | `.env.dev` / `.env` + `scripts/ops/dev-host/` or `scripts/ops/prod-host/` | Docker only |

The CMS host produces a `db` image with all content pre-loaded and pushes it to a registry. Target hosts `docker pull` the image and serve it — they never need AI keys, TTS keys, or Python.

Secrets never live inside the db image. Host-side `POSTGRES_PASSWORD` is written to `.secrets/postgres_password` (chmod 600) and injected via compose's `secrets` block + `*_FILE` env indirection.

## Repository structure

```
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
│       ├── env.py           # .env.cms loader + Config dataclass
│       ├── import_vocab.py
│       ├── generate_sentences.py
│       ├── generate_audio.py
│       ├── export_bundle.py
│       └── README.md
│
├── scripts/
│   ├── lib.sh               # shared helpers (ok/warn/err, docker detection, gen_secret)
│   ├── ops/                 # host-operations scripts (configure env / build image / run containers)
│   │   ├── db/              # CMS host — operates on the db service
│   │   │   ├── env.sh         # .env.cms lifecycle (init/update/show/doctor)
│   │   │   ├── content.sh     # sync / sentences / audio / publish / export / doctor
│   │   │   ├── bake_image.sh  # DB → staging bundle → docker build
│   │   │   └── push_image.sh  # registry push
│   │   ├── dev-host/        # dev target host
│   │   │   ├── env.sh         # .env.dev lifecycle
│   │   │   └── run.sh         # compose lifecycle (start/stop/restart/logs/doctor)
│   │   └── prod-host/       # prod target host
│   │       ├── env.sh         # .env lifecycle
│   │       └── run.sh         # compose lifecycle
│   └── dev/                 # developer tools (lint/test/generate/...) — currently empty
│
├── nginx/               # Nginx reverse proxy config
└── docker-compose.yml   # Runtime orchestration for target hosts
```

The runtime `docker-compose.yml` references the `db` image as a service — the image's OCI labels (`type-any-language.db.user`, `type-any-language.db.name`, `type-any-language.content.version`, `type-any-language.content.baked-at`) are read at start time by `scripts/ops/dev-host/run.sh` / `scripts/ops/prod-host/run.sh` to discover the db identity. `POSTGRES_PASSWORD` is NOT in those labels.

## Commands

### CMS host — content production

```bash
./scripts/ops/db/env.sh                # First-time .env.cms creation (interactive)
./scripts/ops/db/content.sh doctor     # Pre-flight: .env.cms + Python deps + DB reachable
./scripts/ops/db/content.sh sync       # CSVs → vocabulary_libs + vocabulary_words
./scripts/ops/db/content.sh sentences  # OpenAI bulk-fills sentences to DEFAULT_BUCKET_TARGET_SIZE
./scripts/ops/db/content.sh audio      # Tencent TTS bulk-fills audio_url + MP3
./scripts/ops/db/bake_image.sh         # Dump + audio copy + docker build
./scripts/ops/db/push_image.sh [-y]    # Push the db image to DOCKER_REGISTRY
```

`scripts/ops/db/content.sh` is a thin wrapper over the `db/pipeline/*.py` modules (PYTHONPATH=db). Each subcommand has its own `--help`. See `db/pipeline/README.md` for module details.

### Dev target host

```bash
./scripts/ops/dev-host/env.sh               # First-time .env.dev creation (smart defaults)
./scripts/ops/dev-host/run.sh doctor         # Pre-flight
./scripts/ops/dev-host/run.sh start          # compose up (hot-reload, bind-mounted)
./scripts/ops/dev-host/run.sh stop
./scripts/ops/dev-host/run.sh restart        # Hard restart (recreate + re-read .env.dev)
./scripts/ops/dev-host/run.sh logs
```

### Prod target host

```bash
./scripts/ops/prod-host/env.sh              # First-time .env creation
./scripts/ops/prod-host/run.sh doctor
./scripts/ops/prod-host/run.sh start
./scripts/ops/prod-host/run.sh stop
./scripts/ops/prod-host/run.sh restart
./scripts/ops/prod-host/run.sh logs
```

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
1. `run.sh start` reads the db image's labels, assembles `POSTGRES_PASSWORD` (host secret) and `DATABASE_URL_FILE`, `compose up`.
2. On first start, the db image's `/docker-entrypoint-initdb.d/` runs `01-content.sql` (creates schema, loads content) and `99-audio.sh` (copies `/seed/audio/*` → `/audio/`).
3. Frontend fetches a sentence, browser plays its MP3 from `/audio/{hash}.mp3` (served by backend's `StaticFiles` mount, in dev proxied through nginx).
4. User submits answer → `validate_answer()` normalizes (lowercase, strip punctuation/spaces) and compares.

## Environment variables

### CMS host — `.env.cms` (created by `scripts/ops/db/env.sh`)

Required:
- `DATABASE_URL` — Postgres connection (used by `pipeline/*.py`)
- `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` — OpenAI-compatible LLM
- `TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY`, `TENCENT_APP_ID` — Tencent Cloud TTS
- `AUDIO_DIR` — where `generate_audio.py` writes MP3s and `bake_image.sh` reads them from
- `POSTGRES_USER`, `POSTGRES_DB` — db identity (baked into image labels)
- `DB_IMAGE`, `DB_IMAGE_TAG`, `DOCKER_REGISTRY` — image naming + registry

Optional:
- `DEFAULT_BUCKET_TARGET_SIZE` — sentences per (lib, difficulty) bucket (default 200)

### Target host — `.env.dev` / `.env` (created by `scripts/ops/dev-host/env.sh` / `scripts/ops/prod-host/env.sh`)

Required:
- `POSTGRES_PASSWORD` — written to `.secrets/postgres_password` (chmod 600), injected via compose `secrets` block

Optional:
- `DOCKER_REGISTRY`, `DB_IMAGE_TAG` — which baked db image to pull
- `ALLOWED_ORIGINS` — CORS allowlist (dev defaults to `http://localhost,http://localhost:3000`; prod defaults to `http://localhost`)
- `SECRET_KEY` — backend sessions/JWT (random by default)