# scripts/

Host-operations entry points and shared helpers. Almost everything an
operator needs to manage the system lives under here.

## Layout

```
scripts/
├── README.md           this file
├── lib.sh              shared helpers — source from every script
├── release.sh          release orchestrator (bump + build + push)
├── ops/
│   ├── db/             CMS host: content production + db image bake
│   │   ├── env.sh        .env.db lifecycle (init/update/show/doctor)
│   │   ├── content.sh    sync / sentences / audio / publish / export / doctor
│   │   ├── bake_image.sh dump + audio copy + docker build
│   │   └── push_image.sh push to $DOCKER_REGISTRY
│   ├── dev-host/       dev target host (hot-reload)
│   │   ├── run.sh        compose lifecycle (start/stop/restart/logs/doctor)
│   │   ├── build_image.sh local backend+frontend image build
│   │   └── push_image.sh  push backend+frontend to $DOCKER_REGISTRY
│   └── prod-host/      prod target host (pre-compiled)
│       ├── run.sh        compose lifecycle (start/stop/restart/logs/doctor)
│       ├── build_image.sh local backend+frontend image build
│       └── push_image.sh  push backend+frontend to $DOCKER_REGISTRY
└── dev/                developer tools (lint/test/generate/...) — empty for now
```

The two-host architecture (CMS host produces content, dev/prod targets
serve it) is described in the project-root `CLAUDE.md`. This README
focuses on the scripts themselves.

## Common entry points

| You want to... | Run |
|---|---|
| Release a new version | `./scripts/release.sh dev\|prod [X.Y.Z] [-y]` |
| Show current versions | `./scripts/release.sh show` |
| Inspect host readiness | `./scripts/ops/<host>/run.sh doctor` |
| Start / stop / restart containers | `./scripts/ops/<host>/run.sh start\|stop\|restart` |
| Bake + push a db image (CMS) | `./scripts/ops/db/bake_image.sh && ./scripts/ops/db/push_image.sh -y` |
| Build + push app images (target) | `./scripts/ops/<host>/build_image.sh && ./scripts/ops/<host>/push_image.sh -y` |
| Manage .env.db (CMS) | `./scripts/ops/db/env.sh [init\|update\|show\|doctor]` |

`<host>` is `dev-host` or `prod-host`. The CMS scripts are under `db/`.

## `lib.sh` — shared helpers

Source it from every script:
```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$PROJECT_DIR"
source "$SCRIPT_DIR/../../lib.sh"
```

`lib.sh` provides:

| Helper | Purpose |
|---|---|
| `ok / warn / err / info`     | Colored printers (stdout / stderr-aware). Use these — never `echo` for status. |
| `gen_secret <len>`           | URL-safe random string (used by run.sh to seed POSTGRES_PASSWORD). |
| `detect_default_registry`    | `docker.io/$USER` if available, else empty. |
| `find_repo_root`             | Walk up to `.git` or any `VERSION*` file. |
| `read_version_file [path]`   | First non-empty/non-comment line of a VERSION file, or `v0.0.0`. |
| `resolve_image_tag VAR [path]` | Per-image env > `IMAGE_TAG` > version file > `v0.0.0`. |
| `warn_if_version_default <tag> [path]` | One-shot warn when VERSION is missing/empty. |
| `sed_inplace PAT FILE`       | Portable in-place edit (GNU vs BSD/macOS sed). |
| `check_docker_installed`     | Silent boolean. |
| `check_docker_daemon_running`| Silent boolean (5s timeout to bound Docker Desktop startup). |
| `require_docker`             | Exits 1 with friendly error if docker or compose missing. |
| `image_exists NAME`          | `docker image inspect` — silent boolean. |
| `require_image NAME [hint]`  | Exits 1 with friendly error + fix hint. |
| `port_in_use PORT`           | Silent boolean. |
| `warn_port_in_use PORT DESC` | Warn-only (never fails under `set -e`). |
| `detect_compose_cmd`         | Sets `DOCKER_COMPOSE_CMD` (docker-compose vs `docker compose`). |
| `file_exists / require_file` | File existence helpers. |

Two conventions to internalise:
- **Status messages go through `ok/warn/err/info`** — never bare `echo` for them. The printers handle color, TTY detection, and `[OK]/[WARN]/[ERR]/[INFO]` prefixes consistently.
- **When returning a value via stdout** (e.g. `tag="$(resolve_image_tag ...)"`), make sure the function's log messages go to **stderr** (`>&2`), so they don't get captured into the return value.

## Conventions for new scripts

Every shell script in this repo follows the same skeleton:

```bash
#!/bin/bash
#
# <path>/<name>.sh — <one-line summary>.
#
# <Multi-line description of what the script does, when to use it,
#  what it doesn't do, and what env it reads.>

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Project root is the repo root, NOT scripts/. Go up enough levels
# to land at the repo root regardless of nesting depth.
#   scripts/<name>.sh                  → 1 level  (../)
#   scripts/ops/<host>/<name>.sh       → 3 levels (../../..)
PROJECT_DIR="$(cd "$SCRIPT_DIR/<correct/relative/path>" && pwd)"
cd "$PROJECT_DIR"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/<lib.sh path relative to SCRIPT_DIR>"

require_docker    # if the script touches docker

# 1. Resolve config (env > VERSION file > default).
# 2. Implement cmd_doctor / cmd_<action>.
# 3. case "${1:-}" in ... esac — match subcommands.
```

Notes:
- **`PROJECT_DIR` must be the repo root.** All compose files, VERSION
  files, `.env`, `db/`, etc. live there. A common bug is going up one
  level too few (lands in `scripts/` instead of repo root) — every
  `scripts/ops/*/` script uses `$SCRIPT_DIR/../../..` for that reason.
- **`set -e` from the top.** Fail fast; let `lib.sh`'s `require_*`
  helpers handle the friendly error path.
- **Subcommand API**: `cmd_<subcommand>` functions, dispatched via
  `case "${1:-}" in`. `usage()` for help. Exit codes:
  - 0 = success or user-cancelled
  - 1 = prerequisite missing
  - 2 = docker / push failure
- **No Python in ops scripts.** The CMS pipeline uses Python
  (`db/pipeline/*.py`), but `scripts/ops/` is shell-only. Target hosts
  shouldn't even have Python.
- **`source "$SCRIPT_DIR/../../lib.sh"`** is the import. Don't `source
  ./lib.sh` — paths break if the operator cd's around.

## Versioning model

Two root files control image tags:

| File | Tags |
|---|---|
| `VERSION.dev`  | `english_backend_dev`, `english_frontend_dev` |
| `VERSION.prod` | `english_db_content`, `english_backend`, `english_frontend` |

`VERSION.prod` is read by the dev target's `run.sh` for `DB_IMAGE_TAG`
(because db is "prod-bound" content, shared by both targets). See the
project-root `CLAUDE.md` → "Image version tags" for the resolution
chain and override precedence.

`scripts/release.sh` is the single point of version management —
prefer it over editing VERSION files by hand.

## Adding a new script

1. Pick the right subdir:
   - Affects a single host's container lifecycle → `scripts/ops/<host>/`
   - Operates on the db image / .env.db → `scripts/ops/db/`
   - Cross-cutting orchestrator → `scripts/`
   - Developer tooling (lint, test, generate) → `scripts/dev/`
2. Copy an existing same-shape script as a template (the `run.sh` /
   `bake_image.sh` patterns are the canonical examples).
3. Use the `SCRIPT_DIR / PROJECT_DIR` skeleton above — verify
   `PROJECT_DIR` lands at the repo root.
4. Source `lib.sh` and use its printers + helpers.
5. Add a `usage()` function and route subcommands via `case`.
6. If the new script is user-facing, add it to the "Common entry points"
   table above and to the project-root `CLAUDE.md`.

## See also

- `../CLAUDE.md` — project overview, two-host architecture, full command reference
- `../db/pipeline/README.md` — Python content-production pipeline (CMS only)