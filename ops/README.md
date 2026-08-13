# ops/
#
# Target-host operations + image build/release orchestrator (CVM + CI only;
# dev-tools/ lives at the repo root as a sibling — see README.md for the top-level
# layout).
#
# Layout rule: each subfolder that USES a compose file keeps that file in
# the SAME subfolder (consumer and artifact live side-by-side). There are
# no compose files at the repo root.
#
#   cvm/      prod CVM runtime scripts (RUN env)
#               cvm/nginx/                host nginx module (site.conf +
#                                         install.sh, installed on the CVM by
#                                         cvm/bootstrap.sh::step_nginx_site_link)
#               (the prod compose file lives at the repo root:
#                docker-compose.yml — consumed by cvm/lifecycle.sh via
#                cvm/_common.sh's compose() wrapper, and packaged into the
#                CVM tarball by ops/publish/deploy-prod.sh.)
#               cvm/_common.sh            shared setup + the compose() wrapper
#               cvm/bootstrap.sh          one-time idempotent host prep
#               cvm/lifecycle.sh          start / stop / restart
#               cvm/logs.sh               docker compose logs -f
#
#   staging/  CI: ephemeral staging env (called by staging.yml)
#               staging/docker-compose.staging.yml   the staging stack
#               staging/nginx.staging.conf           nginx config inside the
#                                                    staging compose
#               bring-up-staging.sh / teardown-staging.sh
#               install-cloudflared.sh / expose-tunnel.sh
#               write-deploy-record.sh               GH Deployments record
#
#   publish/  CI: ship-to-prod scripts (called by release/publish.yml)
#               deploy-prod.sh            tar+scp + remote SSH (ships ops/cvm
#                                         + ops/lib.sh to the CVM)
#               promote.sh                rc -> vX.Y.Z tag + GH release
#               assert-staging-verified.sh  gate before prod
#
#   release/  CI: image release orchestration (called by release/build.yml)
#               _common.sh                shared helpers (image list + name
#                                         assembly + size budget)
#               resolve-tag.sh            smart vX.Y.Z-rc.N arithmetic
#                                         (also used by staging.yml /
#                                          release/publish.yml)
#               build.sh                  docker build + push 3 images
#                                         (db/backend/frontend)
#               push-latest.sh            retag + push :latest for all 3
#               check-size.sh             fail if any image exceeds budget
#                                         (default 500 MB, MAX_IMAGE_BYTES)
#               push-git-tag.sh           git tag -a + push origin <NEW_TAG>
#               create-gh-release.sh      gh release create --prerelease
#
#   test/     smoke + e2e test scripts (called by release/staging.yml / verify/smoke.yml /
#               verify/e2e.yml)
#
# lib.sh     shared helpers (sourced by cvm/ scripts; dev-tools/ sources it too
#            via the repo-root relative path ops/lib.sh)
#
# IMPORTANT - the prod compose file lives at the repo root
# (docker-compose.yml). Its internal relative paths (./secrets/db_password,
# ./backend, ./frontend, ./db/Dockerfile) are repo-root-relative and resolve
# naturally against the compose file own directory. The CVM runtime
# compose() wrapper still pins --project-directory + --project-name so
# container / network names stay stable across PWDs; always call docker
# compose through the wrapper, never directly with -f docker-compose.yml.

# No build target lives at the repo root - the image release orchestration scripts live in release/ (this folder), called by release-build.yml.
#
# Architecture: GitHub Actions workflows (yml) are thin orchestrators.
# The heavy bash lives in ops/ subfolders by role:
#   release/build.yml -> ops/release/  (resolve-tag, build, push-latest,
#                                       check-size, push-git-tag,
#                                       create-gh-release)
#   staging.yml       -> ops/staging/  (bring-up / teardown / tunnel /
#                                       write-deploy-record)
#   release/publish.yml -> ops/publish/  (assert-staging-verified / deploy-prod
#                                       / promote)
# Scripts are also runnable from a workstation for debugging or manual ops.

# When adding a new script:
#   - targets a prod CVM (lifecycle / doctor / bootstrap) -> ops/cvm/
#     AND put its compose file (if any) in ops/cvm/ too
#   - runs from CI / build host (staging) -> ops/staging/
#     AND put its compose file (if any) in ops/staging/ too
#   - runs from CI / build host (image release: tag, build, push,
#     size-check, git tag, GH release) -> ops/release/
#   - runs from CI / build host (deploy / promote to prod) -> ops/publish/
#   - runs on a dev workstation (host-native dev loop) -> ../dev-tools/  (sibling of
#     ops/, NOT under it; put dev's compose file in ../dev-tools/ too)
#
# Workflow layout (.github/workflows/, same 4 role-folder pattern):
#   ci/       automatic checks (PR + push):  pr-checks, integration
#   infra/    manual one-time provisioning:  bootstrap-prod
#   release/  manual image release pipeline: build -> staging -> publish
#   verify/   manual post-deploy checks:     smoke, e2e
# Each role maps 1:1 to an ops/ subfolder, so adding a workflow is
# "drop it in the right role folder"; the matching ops/ scripts (if any)
# already live next to their consumers by convention.

# Conventions (all scripts):
#   - SCRIPT_DIR = $(cd $(dirname $0) && pwd)
#   - PROJECT_DIR = $(cd $SCRIPT_DIR/.. && pwd) (or /../.. for subfolder scripts)
#   - source ops/lib.sh for shared helpers
#   - top-level "set -e" (fail fast)
#   - subcommand API: cmd_<name> functions, case "${1:-}" in ... esac dispatcher
#   - exit codes: 0=ok, 1=precondition, 2=docker/push failed

# Release pipeline (no `dev`/Makefile entry for these - done by .github/workflows/):
#
#   release/build.yml     produces rc tag + 3 images (db+backend+frontend)
#   staging.yml           ephemeral staging on GH runner; mode=validate
#                         (smoke+e2e+soak+write record) | mode=review
#                         (public Cloudflare Tunnel URL for human review)
#   release/publish.yml   asserts staging verified, deploys to prod
#                         (ops/publish/*.sh + ops/cvm/ via the deploy tarball),
#                         creates vX.Y.Z

# To trigger: GH Actions UI -> Run workflow on the relevant yml.
# To inspect / test locally: bash <script> [args] from a workstation.
