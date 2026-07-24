# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

English learning web app — plays a sentence's audio and the user types the complete sentence. **The runtime database lives in Tencent Cloud (docker postgres) Postgres, not in a baked Docker image.** Target hosts (dev / prod) are a pure read-layer: no AI calls, no TTS calls, no scheduler, no db container — just `backend` + `frontend` (and `nginx` on prod). The CMS host produces staging files (`cms/content/`); `db/scripts/import_staging.sh` UPSERTs them straight into the live docker postgres.

## Three-segment architecture

This project intentionally separates **content production** from **content serving** from **content storage**:

| Host / Service | Role | What lives here | What runs here |
|---|---|---|---|
| **CMS host** | Content production (writes staging files) | `cms/` (env, scripts, source, tools) | Python + Docker |
| **Target host** (dev or prod) | Content serving (3 services in one compose file) | `ops/dev/` or `ops/prod/` + `docker-compose{,.dev}.yml` | Docker (backend + frontend + db) |
| **DB layer** (each target host's compose) | Runtime database | `docker-compose{,.dev}.yml` `db` service → `postgres:15-alpine` | Docker container, data on host volume |

The CMS host produces **staging files** (vocabulary JSON + sentences JSONL) via the
CMS pipeline. `db/scripts/import_staging.sh` (on the CMS host, or any machine
with `DATABASE_URL`) reads them and UPSERTs straight into the local Postgres.
Target hosts `docker compose up -d` three services — `db` (postgres:15-alpine,
data bind-mounted to the host), `backend` (FastAPI / uvicorn), `frontend`
(Next.js dev server in dev / nginx-proxied static in prod). The same compose
file is the source of truth for the runtime — no external cloud db, no ROLE/DB/GRANT dance, no admin DSN.

**Target hosts need no .env file at all** — runtime configuration
(`ALLOWED_ORIGINS`, `DATABASE_URL`) is passed via shell env or compose's
`environment:` block. DATABASE_URL flows directly through compose
(`db` service's `POSTGRES_USER` / `POSTGRES_PASSWORD` → backend
service's `DATABASE_URL`). Backend reads it via pydantic-settings.

### Dev db lifecycle (single instance, host-local)

The dev db is a `postgres:15-alpine` container managed by docker-compose
(defined in `docker-compose.dev.yml`'s `db` service). Data is
bind-mounted to `./.dev/data/postgres/` (gitignored). One db per
dev host — there is no per-branch, per-user isolation at the db
level. The dev db's lifetime matches the compose project; deleting
the working tree or switching branches does NOT delete the db.

### Why not per-branch

The earlier "mode 2 per-branch" design (post-commit `0b8b3a9`,
pre-revert `d7caf25`) created one logical db per git branch on a
shared PostgreSQL server. That was specific to a **shared cloud
db** where per-branch isolation made sense. With **local docker
postgres**, the cost/benefit flips:

- per-branch dbs would require either per-branch docker volumes
  (operational overhead) or running N postgres containers in
  parallel (resource overhead).
- the dev host is single-tenant, single-user — isolation isn't
  needed between teammates the way it was across hosts in the
  cloud-db era.
- migrations are idempotent (IF NOT EXISTS) — running the same
  migration on the same db twice is a no-op, so feature work and
  master don't conflict the way they would in a single shared db.

If you genuinely need a clean db for a feature branch:
```bash
docker compose -f docker-compose.dev.yml down   # stop services
rm -rf ./.dev/data/postgres                    # nuke the bind-mount target
docker compose -f docker-compose.dev.yml up -d # restart with empty db
./ops/dev/migrate.sh                          # apply all migrations from scratch
make dev-import-content                        # re-import cms/content/
```

### Why local (vs cloud)

- no external service to provision / pay for / get rate-limited
- no admin-DSN dance on first setup
- container starts in <2s on a warm docker cache
- data lives in `./.dev/data/postgres/` — visible, backupable, portable

### Why still a docker container (vs sqlite)

- same Postgres semantics as prod (no "works on sqlite, breaks on PG" surprises)
- migration runner already speaks psycopg2 + `CREATE TABLE IF NOT EXISTS`
- devops-friendly: `docker compose down -v` resets cleanly

### Dev host can also import + migrate on demand

The "target hosts are a pure read-layer" rule above has two dev-only opt-ins:

- **`ops/dev/migrate.sh`** — apply pending schema migrations to the live cloud
  db (host-side runner, no sidecar container). Use after editing
  `backend/migrations/versions/*.py`.
- **`db/scripts/import_staging.sh`** — UPSERT `cms/content/` into the docker postgres.
  Operators typically run this on the CMS host, but a dev host with
  `DATABASE_URL` in env can run it too.

### ETL architecture (CMS produces files, db imports them)

The CMS/db split follows an ETL pattern: **E**xtract (CSVs) and
**T**ransform (AI / TTS) live entirely on the CMS side as files in
`cms/content/`; the **L**oad (UPSERT into docker postgres) is a separate
step (`db/scripts/import_staging.sh`) run on any host with
`DATABASE_URL` exported — typically the CMS host, but a dev host
with `DATABASE_URL` can do it too. There is no db image — the cloud
db is the canonical state.

**Why ETL, not direct db writes?** The CMS side stays ignorant of the schema —
only the importer knows about `vocabulary_libs` / `vocabulary_words` / `sentences`.
Operators can re-run any single CMS step (CSVs → JSON, AI → JSONL, TTS → audio)
without touching the database, and a failed `import_staging.sh` does not cost an
extra OpenAI call (the JSONL is already on disk).

The DSN never lives in a docker image. Host-side `DATABASE_URL` is provisioned
once per target host by `ops/{dev,prod}/setup.sh bootstrap` (writes
`DATABASE_URL`, chmod 600). Backend reads it via compose's `secrets:`
block + `DATABASE_URL_FILE`.

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
│   ├── scripts/          # CMS shell tools (staging.sh; not entry)
│   │   └── staging.sh    # E+T file producer wrapper
│   ├── pipeline/     # Python package (manifest / import_vocab / generate_sentences / generate_audio / storage / env)
│   │   └── README.md
├── db/                # Schema + importer + migrations + docker postgres bootstrap
│   ├── scripts/        # shell entry points
│   │   ├── lib.sh              # docker postgres helpers (resolve_dev/prod_db_url, render_db_name)
│   │   ├── bootstrap_tencent.sh  # one-time ROLE/DB/GRANT + write DATABASE_URL
│   │   ├── init_schema.sh      # python -m init_schema (base DDL)
│   │   ├── migrate.sh          # python -m migrations.runner (apply pending migrations)
│   │   └── import_staging.sh   # python -m importer (staging files -> db UPSERT)
│   ├── db_url.py              # minimal env-loader (POSTGRES_* → DATABASE_URL)
│   └── importer.py            # CMS staging → docker postgres UPSERT (the L step)
│
├── ops/                    # target-host operations + image build/release orchestrator
│   ├── README.md            # ops/ layout, lib.sh helpers, conventions for new scripts
│   ├── lib.sh               # shared helpers (ok/warn/err, docker detection, gen_secret)
├── build.sh             # local multi-image build (dev + prod) - no push
│   ├── release.sh           # release orchestrator: bump + build + push (dev / prod / show)
│   ├── build_ielts_csv.py   # one-off data-prep tool (IELTS word list → cms CSV format)
│   ├── dev/                 # dev target host — lifecycle + per-subcommand helpers
│   │   ├── _common.sh       # shared setup (image refs, docker postgres contract, watch)
│   │   ├── lifecycle.sh     # start / stop / restart | reload
│   │   ├── doctor.sh
│   │   ├── setup.sh
│   │   ├── logs.sh
│   │   ├── migrate.sh       # apply schema migrations to live docker postgres (host-side runner)
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
├── docker-compose.yml        # prod stack orchestration (backend + frontend + nginx)
└── docker-compose.dev.yml    # dev stack orchestration (hot-reload, compose-watch)
```

The runtime `docker-compose.yml` mounts the host-side `DATABASE_URL`
into the backend container via compose's `secrets:` block + `DATABASE_URL_FILE`.
The backend reads it opaquely; nothing in the image depends on the DSN host.

## Commands

### CMS host — content production

> **History note** (secrets storage migration): prior to the GitHub
> Environments migration, this project stored AI/TENCENT/CLOUD credentials
> in a local `cms/.env` (gitignored), managed by `cms/scripts/env.sh`
> (init/update/show/doctor). Both the file and the bootstrap script have
> since been retired. All CMS secrets now live in GitHub Environments
> (`dev` / `test` / `prod`) and are fetched into the process environment
> on demand by `scripts/secrets/fetch_secrets.sh eval-cms` (cms segment)
> or `scripts/secrets/fetch_secrets.sh eval-db` (db segment). Operators
> only need a `gh auth login`-authenticated workstation and access to the
> upstream repo's secrets — there is no longer a local cms/.env file to
> bootstrap. The CMS pipeline modules (`cms/pipeline/*.py`) read
> everything from `os.environ` with `setdefault` semantics, so process
> env values injected by `fetch_secrets.sh` always win.

```bash
# 0. 一次性 bootstrap (新工作站 / 改完 cms/pyproject.toml 后):
#    装 Python deps + 验 gh/auth/repo + 打印 eval 行让操作员粘贴
./cms/scripts/bootstrap.sh                # 默认装 [audio,cos]; --no-extras 只装 base

# 1. 注入 CMS 密钥到当前 shell 的 process env (每次新 shell,或写到 ~/.bashrc)
#    这一行 bootstrap.sh 会原样打印出来 — 复制粘贴即可
eval "$(scripts/secrets/fetch_secrets.sh eval-cms)"

# 2. 跑内容管线 (writes staging files; db import is a separate step)
#    run.sh 默认入口会跑 vocab + sentences + audio 三步;缺 AI_*/TENCENT_*
#    会硬卡退出 1(不再 warn 跳过,避免误以为跑完)。只跑 vocab 用 cmd_vocab.sh。
./cms/run.sh                              # vocab + sentences + audio (硬依赖,缺密钥=exit 1)
# ./cms/scripts/cmd_vocab.sh              # 只跑 vocab (不需要任何密钥)

# 3. db side: import staging files -> docker postgres (separate step, db's job)
#    Requires DATABASE_URL in env (docker postgres path: bootstrap_tencent.sh writes
#    DATABASE_URL, then db/scripts/lib.sh::resolve_*_db_url exports it).
#    Self-hosted postgres users set DATABASE_URL via shell env or
#    `eval "$(scripts/secrets/fetch_secrets.sh eval-db)"`.
./db/scripts/init_schema.sh         # (first time) build vocabulary_* / sentences / schema_migrations
./db/scripts/migrate.sh             # run pending schema migrations
./db/scripts/import_staging.sh      # reads staging files, UPSERTs to docker postgres (separate step)

# 4. One-shot (CMS driver + 1 db step)
./cms/run.sh                                       # CMS driver (E+T)
./db/scripts/import_staging.sh all                 # db: L (UPSERT staging files -> docker postgres)
```

`cms/scripts/staging.sh` is a thin wrapper over the `cms/pipeline/*.py` modules. Each subcommand has its own `--help`. For module-by-module usage details, run `python -m pipeline.<module> --help` (e.g. `python -m pipeline.import_vocab --help`).

### 责任划分 (responsibility split)

| Step | Tool | What it writes |
|---|---|---|
| vocab (CSV → JSON) | `cms/pipeline/import_vocab.py` | `cms/content/vocabulary/<lib>.json` |
| sentences (AI → JSONL) | `cms/pipeline/generate_sentences.py` | appends to `cms/content/sentences/<lib>.jsonl` |
| audio (TTS → URL) | `cms/pipeline/generate_audio.py` | updates `audio_url` field in sentences JSONL |
| import (files → db) | **`db/importer.py`** | UPSERT into `vocabulary_libs` / `vocabulary_words` / `sentences` |
| bake (db -> image) | *(retired)* | runtime db is docker postgres - no image bake |

The CMS pipeline (steps vocab/sentences/audio) **never** opens a db connection.
Only `importer` touches Postgres. To re-run a single CMS step
(e.g. you edited a CSV and only need to re-run the vocab step), there is no
need to touch the database at all; the files in `cms/content/` are the stable
artifact until you decide to import.

### Dev target host

```bash
```bash
./ops/dev/setup.sh          # First-time: verify docker postgres + build dev apps
./ops/dev/setup.sh bootstrap   # (one-time) docker postgres setup - writes DATABASE_URL
./ops/dev/doctor.sh         # Pre-flight (includes docker postgres reachability probe)
./ops/dev/lifecycle.sh start          # compose up + background compose watch (auto-sync src/package.json)
./ops/dev/lifecycle.sh stop
./ops/dev/lifecycle.sh restart        # Hard restart (recreate + re-read secrets)
./ops/dev/migrate.sh        # Apply pending schema migrations to live docker postgres (host-side runner)
./ops/dev/logs.sh [svc]
# Optional image publishing (offline / first-time local setup -> registry):
./ops/dev/build_image.sh        # build english_backend_dev + english_frontend_dev
                                          # dev host does NOT push (stay local)
./ops/prod/build_image.sh       # build english_backend + english_frontend
./ops/prod/push_image.sh -y     # push prod backend+frontend to DOCKER_REGISTRY
./db/scripts/import_staging.sh all   # UPSERT latest cms/content/ content into docker postgres
```

No `.env.dev` is needed. The dev compose file defaults `ALLOWED_ORIGINS` to `http://localhost,http://localhost:3000`; override via shell env. The docker postgres DSN comes from `DATABASE_URL` (written by `setup.sh bootstrap`) or `DATABASE_URL` in env.

`setup` is the recommended entry point for a fresh checkout. It runs preflight
(docker + compose), verifies the docker postgres contract (`DATABASE_URL` or
`DATABASE_URL` in env), and builds the dev `backend + frontend` images.
It does NOT start containers or create `.secrets/` - that is `start`'s job.
Re-running `setup` is safe (idempotent - every step short-circuits on existing state).
Cloud-db bootstrap is a separate step (`./ops/dev/setup.sh bootstrap`).

### Prod target host

```bash
```bash
./ops/prod/setup.sh         # First-time: verify docker postgres + build prod apps
./ops/prod/setup.sh bootstrap   # (one-time) docker postgres setup - writes DATABASE_URL
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

`setup` is the recommended entry point for a fresh prod host. Same flow as dev:
preflight + docker postgres contract verify + build prod `backend + frontend`.
No db image to pull - runtime db is docker postgres. If `DOCKER_REGISTRY` is empty,
`setup` exits in local-only mode (no push, no pull).

No `.env` is needed. `ALLOWED_ORIGINS` defaults to `http://localhost` in the prod compose - override via shell env (shown above) or edit the compose file directly. The docker postgres DSN comes from `DATABASE_URL` (written by `setup.sh bootstrap`) or `DATABASE_URL` in env.

**Image registry model**: each target host pushes its own `backend + frontend`
images. There is no db image in the pipeline.
- **Prod target host**: `docker pull` backend + frontend from `$DOCKER_REGISTRY` on every `lifecycle.sh start` / `restart` (auto-pulled - registry is the source of truth for prod).
- **Dev target host**: `setup.sh` does the **one-time bootstrap pull** from `$DOCKER_REGISTRY` when local images are missing. `start` / `restart` **never auto-pull** - dev iteration is local-first; image lifecycle is owned by `build_image.sh` on the host. This avoids overwriting fresh local builds with stale registry versions. To pull explicitly: `docker pull <full-image>`.

The registry namespace (e.g. `ccr.ccs.tencentyun.com/your-ns` for **TCR**, or `docker.io/youruser` for Docker Hub) is **shared project config** that the whole team uses. It is **not** a personal secret, so it lives in the committed `REGISTRY` file at the repo root (symmetric with the per-segment VERSION files), not in `cms/.env` (gitignored). See [Image registry namespace](#image-registry-namespace) below — for Tencent Cloud prod, **TCR is the recommended path**.

## Image registry namespace

The `DOCKER_REGISTRY` shell variable is the namespace prefix prepended to `image:tag` for `docker push` / `docker pull`. The chain (`ops/lib.sh` → `resolve_docker_registry`) is, in order of decreasing precedence:

1. **Shell env** — `export DOCKER_REGISTRY=ccr.ccs.tencentyun.com/your-ns` (highest priority; CI / one-off override)
2. **`./REGISTRY` file at repo root** — committed, shared project config (typical default)
3. **`detect_default_registry()`** — `docker.io/$USER` (best-effort guess; useful for solo dev work)
4. **Empty** — local-only mode; push scripts fail with a clear error, run scripts just skip the auto-pull

The `REGISTRY` file's format: first non-empty, non-comment line starting with `DOCKER_REGISTRY=`. It ships with the `DOCKER_REGISTRY=` line **commented out** — fill it in and uncomment to publish the team's shared namespace.

```bash
# REGISTRY (recommended for Tencent Cloud prod)
DOCKER_REGISTRY=ccr.ccs.tencentyun.com/your-tcr-id/type-any-language
# Other valid forms: docker.io/zhangyu528, ghcr.io/myorg, registry.gitlab.com/mygroup
```

> Why committed and not `.env`? Like the per-segment VERSION files, this is shared project config that the whole team should agree on — putting it in a gitignored `.env` means every operator has to set it themselves, and the same value gets typed in N places. Personal secrets (postgres password, AI keys, TTS keys) live in GitHub Environments and are fetched per-session via `scripts/secrets/fetch_secrets.sh`; shared config lives at the repo root.

### Recommended: Tencent Cloud TCR for cloud-deployed prod

If the prod host is a Tencent Cloud CVM, the recommended `DOCKER_REGISTRY` is **Tencent Container Registry (TCR)**:

```
DOCKER_REGISTRY=ccr.ccs.tencentyun.com/your-tcr-id/type-any-language
```

Why TCR over dockerhub for Tencent Cloud prod:
- CVM and TCR in the same VPC: `docker pull` goes over the private network — no public-egress bandwidth cost
- TCR Personal tier is free for small projects
- CVM RAM role can pull from TCR without `docker login`
- Same console as docker postgres — unified ops surface

Setup steps: create a TCR Personal instance in the console, create a namespace, get a temporary access token (or attach a CVM RAM role for passwordless pull), fill in `REGISTRY`, `docker login` once on the build host. Subsequent `make release-prod vX.Y.Z -y` builds + pushes to TCR; CVM `make prod-restart` auto-pulls the new tag.

The `REGISTRY` file's inline comment block has more detail on this path. The same code path supports any registry (dockerhub, ghcr.io, gitlab registry, self-hosted) — TCR is just the recommended one for Tencent Cloud users.

## Image version tags

The 4 app images (`english_backend{,_dev}`, `english_frontend{,_dev}`) carry an explicit tag. **Dev and prod use DIFFERENT tag sources by design** — see the table.

| Image | Default tag source | Who bumps it |
|---|---|---|
| `english_backend_dev`        | **image content hash** (`c<hash7>[-dirty]`)  | every change to a backend content input (auto) |
| `english_frontend_dev`       | **image content hash** (`c<hash7>[-dirty]`)  | every change to a frontend content input (auto) |
| `english_backend`            | `backend/VERSION` (semver, e.g. `v0.4.0`)    | `release.sh prod X.Y.Z` (manual) |
| `english_frontend`           | `frontend/VERSION` (semver, e.g. `v1.2.3`)   | `release.sh prod X.Y.Z` (manual) |

### Why dev tags are content-hash, prod tags are semver

Dev iteration is fluid: the dev tag should change **when image content changes**, not when git state changes. A docs-only commit produces no image churn, so the tag stays put — no phantom tags accumulating in `docker image ls`. `release.sh dev [X.Y.Z]` builds without bumping any VERSION file (the `[X.Y.Z]` arg, if given, is an override applied to both images).

The dev tag is **`ops/lib.sh::compute_dev_image_tag [backend|frontend]`**, format `c<content-hash7>[-dirty]`:
- **backend** hash inputs: `backend/Dockerfile.dev`, `backend/entrypoint.sh`, `backend/requirements.txt`
- **frontend** hash inputs: `frontend/Dockerfile.dev`, `frontend/entrypoint.sh`, `frontend/package.json`, `frontend/package-lock.json`
- `-dirty` suffix added when **any input file for that segment** differs from HEAD in the working tree (unstaged or staged). Editing CLAUDE.md or any other non-input file does NOT add `-dirty`.
- Same content on different branches (master / feat_x / detached HEAD) → same hash. Branch is intentionally NOT part of the tag — it's a git workflow concept, not an image-content concept.

Prod releases are deliberate, dated points in the project's life: each prod image carries an explicit semver (`v0.4.0`, not auto-bumped from git). VERSION-file edits are reserved for prod release markers; they happen via `release.sh prod X.Y.Z -y` which writes the new value, commits it, then builds + tags + pushes the prod image.

### Prod tag resolution chain (`ops/lib.sh` → `resolve_image_tag`)

1. Per-image env var, e.g. `BACKEND_IMAGE_TAG=v1.2.3`
2. Generic `IMAGE_TAG` (CI convenience — bumps all images at once)
3. The VERSION file path passed to the helper (e.g. `backend/VERSION`) — first non-empty, non-comment line
4. Literal `v0.0.0` (won't break a build, but warns once via `warn_if_version_default`)

### Dev tag override (per-image and shared)

Dev tags normally auto-derive from image content. For CI / test fixtures, three knobs in decreasing precedence:

| Env var | Effect |
|---|---|
| `BACKEND_DEV_TAG=...`  | Override backend image tag only |
| `FRONTEND_DEV_TAG=...` | Override frontend image tag only |
| `IMAGE_DEV_TAG=...`    | Override both backend + frontend (applied via the build script) |

Otherwise leave them unset and let `compute_dev_image_tag` derive each image's tag from its own content inputs.

### Examples

```bash
# Dev — tags auto-derived from each image's content:
./ops/dev/build_image.sh
# → english_backend_dev:cafefb1e
# → english_frontend_dev:cd8c1af0          (independent hash; may differ)

# Dev with explicit override (both images):
IMAGE_DEV_TAG=ci-test-123 ./ops/dev/build_image.sh

# Dev with per-image override:
BACKEND_DEV_TAG=be-only FRONTEND_DEV_TAG=fe-only ./ops/dev/build_image.sh

# Prod — bump version, build, push:
./ops/release.sh prod v0.4.0 -y
# → english_backend:v0.4.0  (and pushed to ${DOCKER_REGISTRY} if set)
```

For a full release (bump + build + push), use `ops/release.sh prod X.Y.Z` instead of running the build scripts individually — see "Release flow" below.

The dev/prod `lifecycle.sh` reads the same tags at start time, so what gets pulled from the registry matches what was built.

### Drift detection

Every prod image carries the `type-any-language.app.version` LABEL (sourced from `APP_VERSION` build-arg, which the build scripts set to the resolved `*_IMAGE_TAG`). `doctor.sh` (both dev and prod) iterates the running containers and compares each LABEL against the locally-resolved expected tag — mismatches print a `drift` warning, suggesting `lifecycle.sh restart` to pick up the new image.

Dev images also carry a `type-any-language.app.version` LABEL (now content-hash-based, not git-sha) and a `type-any-language.app.git-sha` LABEL for informational purposes; their canonical tag is the resolved `BACKEND_IMAGE_TAG` / `FRONTEND_IMAGE_TAG` from content hash.

### Release flow

`ops/release.sh` is the single point of release orchestration. `cmd_dev` builds dev images from each image's content hash without touching VERSION files. `cmd_prod` bumps VERSION, commits, then builds + tags + pushes prod images.

| Subcommand | Touches VERSION files | Builds + pushes |
|---|---|---|
| `show`              | — | — (print all 3 per-segment VERSION files + each dev tag from content hash) |
| `dev  [TAG]`        | — (dev tags are content-hash-based, computed independently per image) | `english_{backend,frontend}_dev` (no push) |
| `prod [X.Y.Z]`      | bumps `backend/VERSION` + `frontend/VERSION` to the new value | `english_{backend,frontend}` (no push if `DOCKER_REGISTRY` unset) |

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

The full release flow with `release.sh` (one command per host):

```bash
# On the workstation — after merging changes to master:
./ops/release.sh dev v0.3.0       # bump backend/VERSION + frontend/VERSION + build dev b/f
./ops/release.sh prod v0.3.0 -y    # bump backend/VERSION + frontend/VERSION + build + push prod b/f
git push

# On each target host — just verify, the images are already in the registry:
./ops/<host>/doctor.sh    # should show "drift OK (version=v0.3.0)" for backend + frontend
./ops/<host>/lifecycle.sh restart   # pull new image and recreate
```

Content (staging files → docker postgres UPSERT) is a separate workflow:

```bash
# On the CMS host (or any host with DATABASE_URL):
./cms/run.sh                                # produce cms/content/* (vocab + sentences + audio)
./db/scripts/import_staging.sh all          # UPSERT into docker postgres
```

Architecture notes:
- `release.sh dev` and `release.sh prod` both touch only the app segments'
  VERSION files (`backend/VERSION` + `frontend/VERSION`). There is no
  db image to release — runtime data lives in docker postgres.
- Content (vocab / sentences / audio) is a separate workflow, independent
  of `release.sh`. The CMS host runs `./cms/run.sh` (E + T) then
  `./db/scripts/import_staging.sh all` (L). No docker images are involved.
- For multi-machine deployments, run each subcommand on its respective
  host. The script is self-contained per host.

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
| `db/VERSION`                                           | (deleted — runtime db is docker postgres, no image) |
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

All read-only. Sentences and audio are pre-baked into the cloud database by the CMS host (commit `f26265d refactor(backend): strip to read-layer`); the runtime never generates, never validates against a server-side cache.

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

**Content production (CMS host, ETL file-based):**
1. Operator commits new CSVs to `cms/source/vocabulary/`.
2. `staging.sh vocab` writes them to `cms/content/vocabulary/<lib>.json` (no db write).
3. `staging.sh sentences` calls OpenAI and appends to `cms/content/sentences/<lib>.jsonl` up to `DEFAULT_BUCKET_TARGET_SIZE` per (lib, difficulty).
4. `staging.sh audio` calls Tencent TTS; MP3s land in the configured `Storage` (local `cms/.local/audio/` by default, or Tencent Cloud COS when `CLOUD_PROVIDER=tencent_cos`), and each sentence's `audio_url` field in the JSONL is set to the storage's `public_url(key)`.
5. `db/scripts/import_staging.sh` reads the staging files and UPSERTs them into `vocabulary_libs` / `vocabulary_words` / `sentences` on the docker postgres (`importer`). Cloud DSN comes from `DATABASE_URL` (written by `db/scripts/migrate.sh` via `ops/{dev,prod}/setup.sh bootstrap`).

**Runtime (target host):**
1. `lifecycle.sh start` verifies `DATABASE_URL` exists (written by one-time `setup.sh bootstrap`), then `compose up`.
2. Backend container reads `DATABASE_URL_FILE=/run/secrets/database_url` and connects to docker postgres.
3. Frontend fetches a sentence, browser plays its MP3 directly from `sentences.audio_url` (a full Tencent Cloud COS URL). The backend exposes no `/audio` endpoint.
4. User submits answer → `validate_answer()` normalizes (lowercase, strip punctuation/spaces) and compares.

**Audio architecture (cloud, not image):**
- MP3s live in Tencent Cloud COS, not in any docker image.
- `sentences.audio_url` is the full COS URL, written by the CMS audio step into the staging JSONL and then UPSERTed into the docker postgres via `importer`.
- The frontend reads `sentences[i].audio_url` and the browser streams audio from COS directly — no proxy through backend, no nginx `/audio` location, no `shared-audio` docker volume.
- This keeps the runtime db small (schema + sentences table only, no binary blobs) and lets audio be updated without a db migration.
- Provider is selected via `CLOUD_PROVIDER` in the process env (typically supplied by `eval "$(scripts/secrets/fetch_secrets.sh eval-cms)"`). Default `local_fs` writes to `cms/.local/audio/` (single-host CMS, no cloud account needed). `tencent_cos` uploads to a COS bucket (multi-host CMS or production). See `cms/pipeline/storage.py` for the abstraction.

## Schema migrations

Schema lives in three places that must stay in sync:
- **`backend/app/models/*.py`** — SQLAlchemy declarative schema (the runtime truth the read-layer queries against)
- **`backend/init_schema.py`** — base `CREATE TABLE IF NOT EXISTS` (the *initial* truth for fresh dbs)
- **`backend/migrations/versions/*.py`** — ordered DDL applied to existing dbs when schema evolves

Migrations use a tiny hand-written runner (`cms/pipeline/migrations/runner.py`, ~60 lines, no Alembic). Each version is a Python module exposing `upgrade(conn)` / `downgrade(conn)`. Idempotent via `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` etc.

### Dev iteration (light-touch)

When you add or change a migration in `backend/migrations/versions/`:

```bash
# Live docker postgres (the one your backend is actually querying): in-place
# upgrade via the host-side runner. No sidecar container, no image
# bake, no registry push.
./ops/dev/migrate.sh        # source db/scripts/lib.sh; db_assemble_url; exec db/scripts/migrate.sh
```

`ops/dev/migrate.sh` requires `python3` + `psycopg2-binary` + `sqlalchemy`
on the host (the same deps `db/scripts/init_schema.sh` and
`import_staging.sh` need). Idempotent — re-runs are no-ops. The backend
picks up the new schema on the next request (no restart needed; uvicorn
hot-reload handles Python changes).

### Production rollout

When the operator merges new schema changes:
1. CMS host (or any host with `DATABASE_URL`): `./db/scripts/migrate.sh` — runs `migrations.runner` against the docker postgres
2. Operator also runs `./db/scripts/import_staging.sh all` if content needs to be refreshed (CMS pipeline ran first)
3. Target hosts: `./ops/<host>/lifecycle.sh restart` — pulls the latest `english_backend{,_dev}` + `english_frontend{,_dev}` from the registry (backend picks up the schema change on next request)
4. Fresh docker postgress (created by `bootstrap_tencent.sh`): the base schema in `backend/init_schema.py` runs via `./db/scripts/init_schema.sh`. Existing docker postgress keep their data; migrations are additive.

### Migration naming + merge rules

To avoid the "two branches both add `0011_*.py` and merge produces N files with the same prefix" problem, this project uses a **two-tier naming convention**:

| Tier | Filename form | Lives where | Purpose |
|---|---|---|---|
| **Shared** (canonical) | `<NNNN>_<short>.py` where `NNNN` is a strictly-increasing 4-digit integer | master, all branches | Production migration — every dev's `english_dev_<user>` db eventually needs it. Merged into master and stays there forever |
| **Branch-local** (experimental) | `<9NNN>_<branch-slug>-<short>.py` where `9NNN` is `9000`+ and `<branch-slug>` is the sanitized branch name | the branch only | Lives only on the branch that needs it. Delete before merging to master, or never merge it. Avoids polluting master with experimental migrations |

**Why two tiers?**:
- Shared migrations (0001-8999) follow the natural-int numbering — one per "everyone needs this" schema change. Runner applies them in `version` lexical order.
- Branch-local migrations (9000-9999) live on a single feature branch. Multiple branches can each have their own `9xxx_*.py` without colliding on the prefix, because the prefix is `9xxx_<branch-slug>` and the slug is unique per branch.
- Lexical sort means shared (`0011`) is always applied before branch-local (`9001`), even if both are present on the same branch.

**Workflow when adding a migration**:

```bash
# 1. Find the current max shared prefix on origin/master
git fetch origin
MAX=$(git ls-tree -r origin/master --name-only \
    -- backend/migrations/versions/ \
    | grep -oE '^[0-9]{4}_' | sort -u | tail -1 | tr -d '_')
echo "max shared prefix on origin/master = $MAX"
# Pick $((MAX + 1)) for your shared migration.

# 2a. Shared migration — everyone needs it
git checkout -b feature/xyz
$EDITOR backend/migrations/versions/0011_add_target_words.py
git add backend/migrations/versions/0011_add_target_words.py
git commit -m "schema: add target_words column on sentences"

# 2b. Branch-local — experimental, only on this branch
git checkout -b experiment/phonetic-lookup
$EDITOR backend/migrations/versions/9001_experiment-phonetic-lookup-btree.sql
git add ...
git commit -m "experiment: phonetic-lookup btree (branch-local, will not merge)"
```

**Merge rules**:
- Shared migrations (`0001`-`8999`) merge into master and stay. They are applied to every dev's db on next `./ops/dev/migrate.sh` (or equivalent).
- Branch-local migrations (`9000`-`9999`):
  - If the experiment succeeds, **promote it to shared**: rename to the next shared prefix, drop the `<branch-slug>` slug, merge.
  - If the experiment is abandoned, do **not** merge the branch at all, or `git rm` the migration file in the merge commit.
  - Never merge two branches that both added the same shared prefix (e.g. both adding `0011_*.py`) without first resolving one of them to a different number — git won't conflict on the filename, but the runner will silently apply both, and the resulting master will have two files with the same `version = "..."` string (cosmetic noise, no functional bug, but confusing).

**Helper**: to list migrations sorted by version (useful for "what's the next number?"), run:

```bash
ls backend/migrations/versions/*.py \
    | grep -v __init__.py \
    | xargs -n1 basename \
    | sort
# Or, automated:
./db/scripts/next_migration_prefix.sh           # next shared prefix on origin/master
./db/scripts/next_migration_prefix.sh --local   # next prefix in working tree
# Make wrapper:
make db-next-migration-prefix
```

The runner (`backend/migrations/runner.py::_discover_versions`) sorts by the `version` string attribute of each module (not the filename), so renames are safe as long as `version = "..."` stays consistent.

## Environment variables

### CMS host — secrets come from GitHub Environments

CMS secrets (`AI_*`, `TENCENT_*`, `CLOUD_*`) live in GitHub Environments
(`dev` / `test` / `prod`), not in any local file. The standard way to
inject them into a workstation shell is:

```bash
eval "$(scripts/secrets/fetch_secrets.sh eval-cms)"
```

(`eval-db` for the db segment; `eval-all` for both.) The fetched values
land only in the calling process's environment — they are never written
to disk by fetch_secrets.sh. Every CMS pipeline module reads them
straight from `os.environ`; nothing the operator types persists beyond
the session.

Required keys when running `./cms/scripts/staging.sh sentences`:

- `AI_API_KEY` — OpenAI-compatible LLM key
- `AI_BASE_URL` — OpenAI-compatible endpoint (typical default: `https://api.openai.com/v1`; switch to Azure / local / Anthropic-compatible endpoints as needed)
- `AI_MODEL` — model name (typical default: `gpt-3.5-turbo`; switch to `gpt-4o` / etc. as needed)

Required keys when running `./cms/scripts/staging.sh audio`
(all-or-nothing, but optional otherwise):

- `TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY`, `TENCENT_APP_ID` — Tencent Cloud TTS

**`DATABASE_URL` is NOT a CMS secret and not read by CMS code.** CMS modules (vocab / sentences / audio) do not connect to the database — they only write files to `cms/content/`. The db side (`db/scripts/migrate.sh` / `init_schema.sh` / `migrate.sh` / `import_staging.sh`) resolves `DATABASE_URL` from `DATABASE_URL` (written by `bootstrap_tencent.sh` once per host) or from `DATABASE_URL` shell env before invoking db-side Python. See [Where the database URL comes from](#where-the-database-url-comes-from) below.

For multi-host CMS or production, set `CLOUD_PROVIDER=tencent_cos` (plus `CLOUD_BUCKET` / `CLOUD_REGION` / `CLOUD_ACCESS_KEY` / `CLOUD_SECRET_KEY`) in the GH Environment. MP3s upload to the COS bucket instead of the local directory; `sentences.audio_url` becomes the full COS URL. See `cms/pipeline/storage.py` for the abstraction.

`DOCKER_REGISTRY` is shared project config that lives in the committed `REGISTRY` file at the repo root (see [Image registry namespace](#image-registry-namespace) above). Override at push time via shell env if you need a one-off namespace:
```bash
export DOCKER_REGISTRY=ccr.ccs.tencentyun.com/your-tcr-id/type-any-language   # overrides REGISTRY file (only affects prod app images — no db image to push)
./ops/prod/push_image.sh -y
```

#### Where the database URL comes from

`DATABASE_URL` is resolved on the db side (`db/scripts/migrate.sh` / `lib.sh::db_assemble_url` / `db_assemble_url`) in this order:

1. **Shell env** — `export DATABASE_URL=postgres://...` (temporary, e.g. CI / self-hosted postgres)
2. **`DATABASE_URL`** (chmod 600) — written by `db/scripts/migrate.sh` when the operator runs `ops/{dev,prod}/setup.sh bootstrap`. For a **multi-host** setup, the operator copies this file from one target host to another:
   ```bash
   scp user@dev:DATABASE_URL .secrets/
   ```
   For a **single-host** setup (CMS + dev on the same machine), the file already exists locally — no extra setup.
3. **Computed** — `db/scripts/lib.sh::resolve_*_db_url` reads `TENCENT_DB_HOST` / `TENCENT_DB_{DEV,PROD}_USER` / `TENCENT_DB_{DEV,PROD}_PASSWORD` from env or `.secrets/tencent_db_*` files, and `render_db_name` for the per-user / per-branch db name. Assembles the full DSN.
4. **Error** — fails loudly with a hint pointing at the bootstrap entry point.

The CMS side (`cms/pipeline/*.py`, `cms/scripts/*.sh`, `cms/run.sh`) **does not need or read this DSN** — it has no db connection to make. `db/scripts/import_staging.sh` needs it (it's the L step), and the CMS host runs that script directly via `PYTHONPATH=db python3 -m importer ...` with `DATABASE_URL` exported by `db/scripts/lib.sh::db_assemble_url` (or shell env).

### CMS host config knobs (read from env or shell, not from a file)

These have code-level defaults in `db/db_url.py` (db-side `POSTGRES_*` knobs) and `cms/pipeline/env.py` (CMS-side knobs: `AUDIO_DIR` / `CLOUD_*` / `DEFAULT_BUCKET_TARGET_SIZE`). Override via shell env when you need a different value:

| Knob | Code default | Override example |
|---|---|---|
| `POSTGRES_USER` | `english_user` | `POSTGRES_USER=foo ./db/scripts/init_schema.sh` |
| `POSTGRES_HOST` | `localhost` | `POSTGRES_HOST=db.internal ./db/scripts/init_schema.sh` |
| `POSTGRES_PORT` | `5432` | (same pattern) |
| `POSTGRES_DB`   | `english_learning` | (same pattern) |
| `POSTGRES_PASSWORD` | (none — db side resolves via shell env, `DATABASE_URL`, or `.secrets/tencent_db_*` files) | `POSTGRES_PASSWORD=... ./db/scripts/init_schema.sh` |
| `TENCENT_DB_HOST` | (none) | `TENCENT_DB_HOST=postgres.tencentcloud.com:5432 ./db/scripts/lib.sh` |
| `TENCENT_DB_USER` / `TENCENT_DB_PASSWORD` | (none) | Required when running `db/scripts/lib.sh::resolve_*_db_url` without a pre-written `DATABASE_URL` |
| `AUDIO_DIR`     | `cms/.local/audio` | `AUDIO_DIR=/my/audio/dir ./cms/scripts/staging.sh audio` |
| `CLOUD_PROVIDER` | `local_fs` | `CLOUD_PROVIDER=tencent_cos ./cms/scripts/staging.sh audio` |
| `CLOUD_BUCKET` / `CLOUD_REGION` / `CLOUD_ACCESS_KEY` / `CLOUD_SECRET_KEY` | (none) | Required when `CLOUD_PROVIDER=tencent_cos` |
| `DEFAULT_BUCKET_TARGET_SIZE` | `200` | `DEFAULT_BUCKET_TARGET_SIZE=500 ./cms/scripts/staging.sh sentences` |

### Target host — no `.env` file required

Runtime configuration is via shell env (passed to `lifecycle.sh` via `KEY=value lifecycle.sh start` or via a systemd unit `Environment=`), with compose-level defaults as a fallback:

- `ALLOWED_ORIGINS` — CORS allowlist. Dev defaults to `http://localhost,http://localhost:3000`; prod defaults to `http://localhost`. Override at start time:
  ```bash
  ALLOWED_ORIGINS=https://my.domain ./ops/prod/lifecycle.sh start
  ```
- `DOCKER_REGISTRY` — registry namespace to push to / pull from. Comes from the committed `REGISTRY` file at the repo root; shell env wins. Pull behavior is **asymmetric**:
  - **Prod**: `lifecycle.sh start` auto-pulls the backend + frontend images on every start/restart — registry is the source of truth.
  - **Dev**: `setup.sh` does the **one-time bootstrap pull** when local images are missing. `start` / `restart` **never auto-pull** — image lifecycle is local (build_image.sh). Pull manually with `docker pull <full-image>` if needed.

  Empty = local-only mode (no push to / pull from any registry).
- `BACKEND_IMAGE_TAG`, `FRONTEND_IMAGE_TAG` — image tag for backend/frontend. Default: `backend/VERSION` on both dev and prod hosts (the single per-segment file gates both the dev and prod image tags at the same value), same for `frontend/VERSION` (resolved by `ops/lib.sh`). Override per image, or set `IMAGE_TAG` to bump all images at once (CI use):
  ```bash
  IMAGE_TAG=v1.2.3 ./ops/prod/lifecycle.sh start
  ```
- `DATABASE_URL` — set by docker-compose's `environment:` block on
  the `backend` service (compose `db` service feeds `POSTGRES_USER` /
  `POSTGRES_PASSWORD` / `POSTGRES_DB` into a runtime `DATABASE_URL`).
  Backend reads it via `app/config.py::resolved_database_url()`. For
  self-host / CI, `export DATABASE_URL=postgresql://...` before
  `compose up`. `DATABASE_URL_FILE` (legacy indirection) still works
  as a fallback for older self-hosted deployments but is no longer
  the canonical path. The compose file declares a `db` service
  (`postgres:15-alpine` + bind-mount) — runtime data lives on the
  host volume (`./.dev/data/postgres/` for dev, `/var/lib/type-any-language/postgres/`
  for prod, chown 999:999).