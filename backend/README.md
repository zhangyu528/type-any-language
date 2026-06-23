# backend/

FastAPI read-layer for type-any-language. The runtime is intentionally thin:
serve cached vocabulary + pre-baked sentences + static MP3s. No AI, no TTS,
no scheduler — those run at bake time on the CMS host.

The full two-host architecture (CMS produces content, target hosts consume it)
is described in [`../CLAUDE.md`](../CLAUDE.md).

## Stack

- Python 3 / FastAPI / SQLAlchemy / pydantic-settings
- Pure read-layer — every query lands on tables pre-populated by
  `db/init/01-content.sql`, which the CMS host's `bake_image.sh` ships inside
  the db image. `Base.metadata.create_all()` in `main.py` is a safety net
  for tests, not the source of truth.

## Layout

```
backend/
├── Dockerfile         # prod image
├── Dockerfile.dev     # dev image (uvicorn --reload, hash-aware entrypoint)
├── requirements.txt
├── app/
│   ├── main.py        # FastAPI app, CORS, /audio StaticFiles mount
│   ├── config.py      # pydantic-settings (DATABASE_URL[_FILE], ALLOWED_ORIGINS)
│   ├── database.py    # SQLAlchemy engine + Base
│   ├── models/        # SQLAlchemy ORM (vocabulary, sentence)
│   ├── routers/       # APIRouter definitions
│   └── schemas/       # pydantic request/response models
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/vocabulary/libs` | list all vocabulary libraries |
| `GET` | `/api/vocabulary/libs/{id}` | one library |
| `GET` | `/api/vocabulary/libs/{id}/words` | words in a library |
| `GET` | `/api/vocabulary/libs/{id}/random?n=10` | N random words |
| `GET` | `/api/sentences` | pre-baked sentences (filterable) |
| `GET` | `/api/sentences/random` | one random sentence |
| `GET` | `/api/sentences/{id}` | one sentence |
| `GET` | `/audio/{filename}` | static MP3 from `/audio` volume (baked into db image) |
| `GET` | `/` | version banner |
| `GET` | `/health` | liveness probe |
| `GET` | `/docs` | Swagger UI (FastAPI auto-generated) |

## Config

All config comes from env vars, resolved by `app.config.get_settings()`.

| Var | Source | Notes |
|---|---|---|
| `DATABASE_URL` | compose secret (`DATABASE_URL_FILE`) | `postgresql://...` connection URL |
| `ALLOWED_ORIGINS` | shell env | comma-separated CORS allowlist, e.g. `https://my.domain`. Dev default: `http://localhost,http://localhost:3000` |

`DATABASE_URL` prefers the `*_FILE` indirection (compose's `secrets:` block)
so the password never appears in `docker inspect` output. Resolution order is
in `config.py:resolved_database_url()`. Target hosts need no `.env` file —
`run.sh` writes `.secrets/database_url` (chmod 600) and compose mounts it.

## Local dev (without docker)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

export DATABASE_URL=postgresql://english_user:<password>@localhost:5432/english_learning
export ALLOWED_ORIGINS=http://localhost,http://localhost:3000

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

You need a Postgres reachable at `$DATABASE_URL` with the schema already
loaded. Easiest path: run the full dev stack once via `./dev.sh start`, then
just point uvicorn at the same DB.

## Hot reload (in dev)

In `docker-compose.dev.yml`, the backend service bind-mounts `./backend` and
runs `uvicorn --reload`. Edit a `.py` file → FastAPI auto-restarts. No
container restart needed.

For dependency changes (`requirements.txt`), `entrypoint.sh` is hash-aware:
it re-runs `pip install` only when the SHA256 changes. So you do need
`./dev.sh restart` to recreate the container — but not a full image rebuild.

## Tests

No automated tests yet. Manual smoke test:

```bash
# After the dev stack is up:
curl http://localhost:8000/health
curl http://localhost:8000/api/vocabulary/libs
curl http://localhost:8000/api/sentences/random
```
