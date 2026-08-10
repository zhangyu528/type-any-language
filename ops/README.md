# ops/
#
# Target-host operations + image build/release orchestrator.
#
# Three envs, each with its own subfolder:
#
#   dev/   - dev host scripts (host-native uvicorn + next dev)
#   cvm/   - any CVM scripts (prod CVM today, staging CVM tomorrow)
#   release/ - CI/CD staging + shared tag helper (called by .github/workflows/*.yml)
#           resolve-tag.sh / bring-up-staging.sh / write-deploy-record.sh / etc.
#   publish/ - CI/CD ship-to-prod scripts (called by publish-prod.yml)
#           deploy-prod.sh / promote.sh / assert-staging-verified.sh
#
# lib.sh   - shared helpers (sourced by cvm/ and dev/ scripts)
#
# compose/ - prod stack definition (docker-compose.yml). Consumed by the
#           CVM runtime scripts via _common.sh's compose() wrapper.
# nginx/   - host nginx module (site.conf fragment + install.sh).
#
# ops/cvm/ layout - CVM runtime scripts (entry points, all sourcing _common.sh):
#
#   _common.sh      shared setup + the compose() wrapper (see below)
#   bootstrap.sh    one-time idempotent host prep
#   lifecycle.sh    start / stop / restart
#   doctor.sh       read-only health + drift check
#   logs.sh         docker compose logs -f
#
# IMPORTANT - the compose file is NOT at the repo root, and its
# internal relative paths (secrets file, build contexts) are written
# relative to the repo root. Never call `docker compose -f
# ops/compose/docker-compose.yml` directly; go through
# _common.sh's compose() wrapper, which pins --project-directory to the
# repo root. Calling it directly makes compose look for
# ops/compose/.secrets/db_password and fail.

# No build target lives at the repo root - it is in release/ (this folder).
#
# Architecture: GitHub Actions workflow (yml) calls a small bash script in release/.
# That bash script does the actual work: scp + ssh, docker compose up, etc.
# Scripts are also runnable from a workstation (for debugging or manual ops).

# When adding a new script:
#   - targets a CVM (lifecycle / doctor / bootstrap) -> ops/cvm/
#   - runs from CI / build host (staging / build / tag) -> ops/release/
#   - runs from CI / build host (deploy / promote to prod) -> ops/publish/
#   - runs on a dev workstation (host-native dev loop) -> ops/dev/

# Conventions (all scripts):
#   - SCRIPT_DIR = $(cd $(dirname $0) && pwd)
#   - PROJECT_DIR = $(cd $SCRIPT_DIR/.. && pwd) (or /../.. for subfolder scripts)
#   - source ops/lib.sh for shared helpers
#   - top-level "set -e" (fail fast)
#   - subcommand API: cmd_<name> functions, case "${1:-}" in ... esac dispatcher
#   - exit codes: 0=ok, 1=precondition, 2=docker/push failed

# Release pipeline (no Makefile targets for these - done by .github/workflows/):
#
#   release-build.yml     produces rc tag + 3 images (db+backend+frontend)
#   staging.yml           ephemeral staging on GH runner; mode=validate
#                         (smoke+e2e+soak+write record) | mode=review
#                         (public Cloudflare Tunnel URL for human review)
#   publish-prod.yml      asserts staging verified, deploys to prod (ops/publish/), creates vX.Y.Z

# To trigger: GH Actions UI -> Run workflow on the relevant yml.
# To inspect / test locally: bash <script> [args] from a workstation.
