# db — content-baked Postgres image

This directory is the **Docker build context** for the content-baked db image
that every target host (`prod` / `dev`) pulls via `run.sh`.

## Layout

```
db/
├── Dockerfile                    postgres:15-alpine wrapper, OCI labels
├── README.md                     (this file)
├── init/
│   ├── 01-content.sql            ← NOT in repo; populated by bake_image.sh
│   └── 99-audio.sh               ← in repo; copies /seed/audio → /audio
└── seed/
    └── audio/                    ← NOT in repo; populated by bake_image.sh
```

`init/01-content.sql` and `seed/audio/` are **build inputs** that
`scripts/ops/db/bake_image.sh` produces from the live CMS database and the
baked MP3 collection. They are gitignored — only `Dockerfile`,
`init/99-audio.sh`, and this `README.md` are committed.

## Build flow

```
db/content/vocabulary/*.csv                     (source)
        ↓  scripts/ops/db/content.sh sync
        ↓  scripts/ops/db/content.sh sentences       (OpenAI)
        ↓  scripts/ops/db/content.sh audio           (Tencent TTS)
PostgreSQL (content_items + audio/*.mp3)
        ↓  scripts/ops/db/bake_image.sh
        ↓    export_bundle.py → .bake-staging/data-bundle-v.../
        ↓    cp dump.sql   → db/init/01-content.sql
        ↓    cp audio/     → db/seed/audio/
        ↓  docker build db/
docker image english_db_content:vX.Y.Z          (with OCI labels)
        ↓  scripts/ops/db/push_image.sh
registry/english_db_content:vX.Y.Z
        ↓  target host's scripts/{prod,dev}/run.sh
docker compose up -d
```

## Runtime behaviour (first `docker compose up` only)

`/docker-entrypoint-initdb.d/` runs scripts alphabetically:

1. **`01-content.sql`** — pg_dump output. Creates the `vocabulary_libs`,
   `vocabulary_words`, and `sentences` tables (owned by the `db.user`
   baked into the image label) and inserts every row.
2. **`99-audio.sh`** — copies `/seed/audio/*.mp3` into `/audio/`
   (the `shared-audio` named volume that nginx serves at `/audio/`).

Postgres runs these only on **first init** (empty data dir). On subsequent
starts the data dir persists and the scripts are skipped — but the
`shared-audio` volume also persists, so the audio stays available.

To wipe both the DB and audio together (re-trigger first init):

```sh
docker compose down -v          # -v wipes named volumes
docker compose up -d            # re-init from baked image
```

## OCI labels

`bake_image.sh` writes these (Dockerfile declares them as defaults so
`docker build .` standalone calls also work):

| Label | Source | Consumer |
|---|---|---|
| `type-any-language.role` | hard-coded | sanity check |
| `type-any-language.db.user` | `$POSTGRES_USER` from `.env.cms` | `run.sh` → `DB_USER` |
| `type-any-language.db.name` | `$POSTGRES_DB` from `.env.cms` | `run.sh` → `DB_NAME` |
| `type-any-language.content.version` | `$DB_IMAGE_TAG` from `.env.cms` | `run.sh` log line |
| `type-any-language.content.baked-at` | `date -u` at bake time | `run.sh` log line |

`db.user` and `db.name` are the **only** authoritative source — `.env` on
target hosts does NOT carry them. Renaming either without re-baking the
image will fail at startup with `FATAL: role "..." does not exist`.

## Sanity-check the image locally

```sh
docker run --rm english_db_content:vX.Y.Z \
    pg_isready -U english_user -d english_learning
# expect: /var/run/postgresql:5432 - accepting connections

docker inspect english_db_content:vX.Y.Z \
    --format '{{ index .Config.Labels "type-any-language.db.user" }}'
# expect: english_user
```