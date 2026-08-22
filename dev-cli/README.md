# `dev-cli/` — Dev subsystem implementation

This directory holds the dev-loop implementation that the project-root
`dev` wrapper drives. The wrapper is a one-line bash dispatcher
(`bash dev-cli/run.sh`); everything else (node multiplexer, db compose,
gitignores for runtime data) lives here.

The dev subsystem brings up the local dev loop on a single workstation.
backend (uvicorn --reload) + frontend (next dev) run as host processes;
the runtime db lives in a docker container (`postgres:15-alpine`,
managed by `docker-compose.dev.yml`). `Ctrl+C` cleanly stops both
services; stack traces and reload events appear in the same terminal.

## Commands

One functional subcommand plus help. Reachable via `dev <subcmd>`.

| Command | Purpose | When |
|---|---|---|
| `run` | Start the dev loop in the foreground | Every dev session |
| `help` | Show usage | — |

The old `start` / `stop` / `restart` / `status` / `logs` / `preflight` /
`setup` surface is gone. Each subsystem now owns its own preflight
(db / backend / frontend); `run.js` is just a multiplexer. If you need
to leave the loop running in the background, use a terminal
multiplexer (`tmux` / Windows Terminal tabs); do not add a daemonized
mode back to this script.

## `run` — the main loop

`dev run` is a multiplexer: spawns two subsystem orchestrators
and merges their output. All preflight lives in the spawned scripts,
not in `run.js`.

```mermaid
flowchart TD
    R[dev run] --> S[dev-cli/run.js]
    S --> B[backend/scripts/dev.py]
    S --> F[frontend/scripts/dev.mjs]
    B --> B1[ensure docker db up<br/>db/scripts/dev_db.sh]
    B1 --> B2[install<br/>backend/scripts/install.py]
    B2 --> B3[migrate<br/>python -m migrations.runner]
    B3 --> B4[smart-import<br/>db/scripts/import_staging.sh]
    B4 --> B5[uvicorn --reload :8000]
    F --> F1[install<br/>frontend/scripts/install.mjs]
    F1 --> F2[next dev :3000]
    B5 --> H[both running, Ctrl+C to stop]
    F2 --> H
```

Each step (lives inside the spawned orchestrator, not in `run.js`):

1. **Ensure docker db is up.** `backend/scripts/dev.py` calls
   `db/scripts/dev_db.sh`, which checks docker install + daemon +
   compose, then `docker compose up -d db` if missing, then waits
   for the healthcheck to report healthy (≤ 30s).
2. **Auto-migrate.** `backend/scripts/dev.py` runs
   `python -m migrations.runner` (idempotent — pending migrations
   applied, noop otherwise).
3. **Smart-import.** `backend/scripts/dev.py` checks the mtime of
   every file under `cms/content/{vocabulary/*.json,sentences/*.jsonl}`
   against `dev-cli/.local/import_marker`. If anything is newer, runs
   `db/scripts/import_staging.sh all` (UPSERTs vocab + sentences +
   rerunnable backfills). Otherwise skips.
4. **Spawn backend + frontend.** `run.js` (Node multiplexer) starts
   both as child processes, prefixes each stdout/stderr line with
   `[BACKEND ]│` or `[FRONTEND]│` (cyan/magenta), forwards `Ctrl+C`
   to both, kills the sibling on first crash.

`run` exits only when:
- The user presses `Ctrl+C` (clean shutdown)
- One service crashes and `--kill-others=false` was passed (sibling
  is left running; the multiplexer exits with the child's exit code)

### Flags

| Flag | Effect |
|---|---|
| `run backend` | Only spawn backend; leave frontend alone |
| `run frontend` | Only spawn frontend; leave backend alone |
| `--no-color` | Disable ANSI prefix coloring |
| `--kill-others=false` | Don't kill the sibling when one service exits |
| `--skip-import` | Forwarded to backend dev.py — skip content import |
| `--skip-migrate` | Forwarded to backend dev.py — skip migrations |

## Preflight (subsystem-owned)

`dev run` is a **multiplexer**, not an orchestrator. It just
spawns two subsystem scripts and streams their output:

```mermaid
flowchart TD
    R[dev run] --> S[dev-cli/run.js]
    S --> B[backend/scripts/dev.py]
    S --> F[frontend/scripts/dev.mjs]
    B --> B1[ensure docker db up<br/>db/scripts/dev_db.sh]
    B1 --> B2[install<br/>backend/scripts/install.py]
    B2 --> B3[migrate<br/>python -m migrations.runner]
    B3 --> B4[smart-import<br/>db/scripts/import_staging.sh]
    B4 --> B5[uvicorn --reload]
    F --> F1[install<br/>frontend/scripts/install.mjs]
    F1 --> F2[next dev]
```

Each subsystem owns its own preflight — failures surface immediately
from the failing orchestrator with a clear message about what's
missing. `run.js` does no orchestration.

All preflight steps are idempotent (a healthy state is ~50ms total):
- `ensure_dev_db_up` — `docker compose up -d` is a no-op when the container is already healthy
- `install.py` — hash-aware skip when `requirements.txt` matches `.requirements.sha256` + venv healthy
- `install.mjs` — hash-aware skip when `package-lock.json` matches `.package-lock.sha256` + node_modules present
- `migrations.runner` — `CREATE TABLE IF NOT EXISTS`, no-op when no pending migration
- `import_staging.sh` — UPSERT; smart-imported by mtime check (see below)

The first run after a fresh clone is the only run that pays the full
cost. Subsequent runs are essentially instant.

## Smart-import semantics

Why not just always import? `import_staging.sh all` UPSERTs every row
in `vocabulary_libs` / `vocabulary_words` / `sentences`. On a sizable
content set that is 5–30 seconds. You'd feel it every time you save a
frontend file and `run` re-spawns next dev.

smart-import uses a marker file (at `dev-cli/.local/import_marker`):

```
dev-cli/.local/import_marker   ← unix timestamp of last successful import
```

On every `run`:
1. `stat -c %Y cms/content/{vocabulary,sentences}/**/*.{json,jsonl}`
   → max mtime across all content files
2. Read `dev-cli/.local/import_marker`
3. If `max_mtime > marker` → run import, then update marker
4. Else → skip, log `[run] content up-to-date, skipping import`

`git pull` updates file mtimes, so smart-import triggers after a
pull. Manual file edits also trigger it.

**Edge cases:**
- `dev-cli/.local/import_marker` missing → assume first run, import
- `cms/content/` empty → skip (nothing to import)
- Import fails → `run` exits non-zero; services are not started

## Auto-migrate semantics

Always run. The migration runner (`db/scripts/migrate.sh` →
`backend/migrations/runner.py`) is idempotent: it reads
`schema_migrations`, applies only versions not yet stamped. For a
clean db the first run applies everything (~10s for the full
backlog); for a warmed-up db it's a single `SELECT` + exit.

No marker needed — the database itself is the source of truth.

## Environment variables

All optional — defaults match `docker-compose.dev.yml`:

| Var | Default | Used by |
|---|---|---|
| `DATABASE_URL` | `postgresql://english_dev:devpw@localhost:5432/english_dev` | backend |
| `ALLOWED_ORIGINS` | `http://localhost,http://localhost:3000,http://localhost:54102,http://localhost:55407,http://localhost:55500` | backend |
| `BACKEND_PORT` | `8000` | backend port |
| `FRONTEND_PORT` | `3000` | frontend port |
| `PYTHONUNBUFFERED` | `1` | backend (force line-buffered stdout) |
| `FORCE_COLOR` | `1` | both (ANSI output) |

Override at start time as usual:
```bash
DATABASE_URL=postgresql://... ALLOWED_ORIGINS=https://my.host dev run
```

## Files

```
<project-root>/
├── dev                  bash wrapper — dev <subcmd> (one-line dispatcher)
└── dev-cli/             this directory
    ├── README.md            this file
    ├── .gitignore           dev subsystem ignores (postgres data + scratch)
    ├── .docker-postgres-data/   postgres data (bind-mounted by compose; gitignored)
    ├── .local/              dev scratch (import_marker lives here; gitignored)
    ├── run.sh               thin shim — exec node run.js
    ├── run.js               Node multiplexer: just spawns backend + frontend dev
    │                        orchestrators and pipes their output. Does no
    │                        preflight — each subsystem owns its own.
    └── docker-compose.dev.yml   db service only (postgres:15-alpine)
```

Preflight is owned by each subsystem's dev orchestrator:
- **db** — `db/scripts/dev_db.sh` (docker stack check + compose up + wait healthy), called from `backend/scripts/dev.py`
- **backend** — `backend/scripts/dev.py` runs `db/scripts/dev_db.sh` → `install.py` → `migrations.runner` → smart-import → uvicorn
- **frontend** — `frontend/scripts/dev.mjs` runs `install.mjs` → `next dev`

Plus read-only self-checks at `backend/scripts/preflight.py` and
`frontend/scripts/preflight.mjs` (invoked manually for diagnostics).

## Cross-platform

| Platform | Invocation |
|---|---|
| macOS / Linux | `dev run` |
| Windows (Git bash) | `dev run` |
| Windows (PowerShell / cmd) | open Git bash first; raw `bash` is the WSL launcher and may fail |

Node (which `run.js` depends on) is already a hard prereq of the
frontend toolchain, so `run` doesn't add a new dependency.
