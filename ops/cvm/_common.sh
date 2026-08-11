#!/bin/bash
#
# ops/cvm/_common.sh — shared setup for CVM-side scripts.
#
# Sourced by every script in ops/cvm/ — does the bootstrap that
# otherwise would have to be copy-pasted into each command. Single
# source of truth for: image tag resolution, compose invocation,
# port warnings, drift check.
#
# Conventions:
#   - $COMMON_DIR is set by the caller (every calling script sets it via
#     `COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`)
#   - setup_prod_host_env is in ops/lib.sh (generic, not CVM-specific).
#     Call it once at the top of each script before any docker command.
#   - ALWAYS invoke compose through the compose() wrapper below, never
#     through a bare $DOCKER_COMPOSE_CMD. See the wrapper's comment for
#     why --project-directory is non-negotiable.
#
# Runtime model:
#   Three containerised services, all on a single CVM:
#     db         — english_db (custom image), data bind-mounted to
#                  /var/lib/type-any-language/postgres. Password comes
#                  from .dbcreds/db_password (compose secrets: block).
#                  Its entrypoint applies migrations + imports content
#                  on every container start.
#     backend    — FastAPI / uvicorn, no reload. Assembles DATABASE_URL
#                  at boot from /run/secrets/db_password.
#     frontend   — Next.js standalone server on :3000.
#
#   nginx is NOT a compose service — it is the host's apt-installed
#   system nginx, configured from ops/cvm/nginx/site.conf and installed
#   by ops/cvm/nginx/install.sh (called from bootstrap.sh).

set -e

: "${PROJECT_DIR:=$(cd "$COMMON_DIR/../.." && pwd)}"
cd "$PROJECT_DIR"
# shellcheck disable=SC1091
source "$PROJECT_DIR/ops/lib.sh"

# setup_prod_host_env (in ops/lib.sh) populates these globals before any
# docker command runs. Defined here as :empty defaults to make the variable
# set visible to editor tooling — real values are set by setup_prod_host_env.
BACKEND_FULL_IMAGE=""
FRONTEND_FULL_IMAGE=""
DB_FULL_IMAGE=""

# ─── compose ───────────────────────────────────────────────────────────────
# The ONLY sanctioned way to call docker compose from ops/cvm/.
#
# The compose file (docker-compose.yml) lives at the repo root, so its
# relative paths (./secrets/db_password, ./backend, ./frontend, ./db/...)
# resolve naturally against the compose file own directory. --project-directory
# is still pinned (and useful) only for the project-name stability: compose
# derives the project name from the working directory basename unless told
# otherwise; without --project-name + --project-directory, the same script
# invoked from different PWDs would spin up different compose projects (and
# thus different container / network names).
compose() {
    $DOCKER_COMPOSE_CMD \
        --project-directory "$PROJECT_DIR" \
        --project-name "${COMPOSE_PROJECT_NAME:-type-any-language}" \
        -f "$COMPOSE_FILE" \
        "$@"
}


# --- sudo_run_or_manual ----------------------------------------------
# sudo_run_or_manual <cmd> [args...]
# Run 'sudo -n <cmd> [args...]' non-interactively. On failure (sudo missing,
# or the command rejected by NOPASSWD sudoers), print a self-run hint with
# the same command and return 1. Used by bootstrap.sh for root-bound prep
# steps (mkdir / chown); the operator re-runs the same command interactively
# if non-interactive sudo is not yet wired up.
sudo_run_or_manual() {
    if command -v sudo >/dev/null 2>&1 && sudo -n "$@"; then
        return 0
    fi
    if command -v sudo >/dev/null 2>&1; then
        err "  sudo 失败 (非交互)"
        err "  自己跑: sudo $*"
    else
        err "  sudo 不存在"
        err "  自己跑(以 root 身份): $*"
    fi
    return 1
}

