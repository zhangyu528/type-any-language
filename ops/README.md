# ops/
#
# Target-host operations + image build/release orchestrator.
#
# Three envs, each with its own subfolder:
#
#   dev/   - dev host scripts (host-native uvicorn + next dev)
#   cvm/   - any CVM scripts (prod CVM today, staging CVM tomorrow)
#           lifecycle.sh / doctor.sh / bootstrap.sh / nginx.conf etc.
#   ci/    - CI/CD pipeline scripts (called by .github/workflows/*.yml)
#           resolve-tag.sh / deploy-prod.sh / bring-up-staging.sh / etc.
#
# lib.sh   - shared helpers (sourced by cvm/ and dev/ scripts)

# No build target lives at the repo root - it is in ci/ (this folder).
#
# Architecture: GitHub Actions workflow (yml) calls a small bash script in ci/.
# That bash script does the actual work: scp + ssh, docker compose up, etc.
# Scripts are also runnable from a workstation (for debugging or manual ops).

# When adding a new script:
#   - targets a CVM (lifecycle / doctor / bootstrap) -> ops/cvm/
#   - runs from CI / build host (deploy / build / tag) -> ops/ci/
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
#   deploy-staging.yml    brings up ephemeral staging on GH runner, smoke+e2e+soak
#   deploy-staging-review  same, with Cloudflare Tunnel public URL for human review
#   publish-prod.yml      asserts staging verified, deploys to prod, creates vX.Y.Z

# To trigger: GH Actions UI -> Run workflow on the relevant yml.
# To inspect / test locally: bash <script> [args] from a workstation.
