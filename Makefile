# Makefile — single entry point for the type-any-language repo.
#
# Why a Makefile: cross-platform executable-bit pain. macOS needs +x on
# *.sh, Windows NTFS ignores it. By routing every script invocation
# through `bash <script> <args>` we sidestep the +x requirement
# entirely — every script runs identically on macOS, Linux, and Windows
# (Git Bash / WSL).
#
# Conventions:
#   - Group targets by host role: dev / prod / cms / db / release / meta.
#   - The bash invocation is the truth; the .sh files are still
#     executable (for users who prefer `./ops/...` directly), but no
#     Makefile target depends on it.
#   - `make help` (default goal) lists all targets + 1-line purpose.

SHELL := /usr/bin/env bash

.PHONY: help
.DEFAULT_GOAL := help

# ---------------------------------------------------------------------------
# dev target host — daily driver.
#
# HOST-NATIVE dev loop only. backend (uvicorn) and frontend (next dev)
# run on the host against the docker postgres (the `db` service in
# docker-compose.dev.yml). No dev docker images, no compose watch.
# ---------------------------------------------------------------------------

## dev-setup: install host-native deps (python venv + node_modules) + bring up docker db
dev-setup:
	@bash ops/dev/setup.sh

## dev-start: HOST-NATIVE start (uvicorn + next dev on host; db in docker)
dev-start:
	@bash ops/dev/native.sh start

## dev-stop: stop host-native backend + frontend
dev-stop:
	@bash ops/dev/native.sh stop

## dev-restart: stop + start host-native
dev-restart:
	@bash ops/dev/native.sh restart

## dev-restart-frontend: kill frontend (pid file + port fallback for orphans) + start (does NOT touch backend)
dev-restart-frontend:
	@cd frontend && npm run dev:restart

## dev-status: pid + uptime + port for native backend/frontend + docker db health
dev-status:
	@bash ops/dev/native.sh status

## dev-logs [backend|frontend|both]: tail native logs (default both)
dev-logs:
	@bash ops/dev/native.sh logs

## dev-native-preflight: read-only check (python/node/.venv/node_modules/db)
dev-native-preflight:
	@bash ops/dev/native.sh preflight

## dev-doctor: preflight check (docker / compose / host python+node / db mount / ports)
dev-doctor:
	@bash ops/dev/doctor.sh

## dev-migrate: apply pending schema migrations to docker postgres (host-side runner)
dev-migrate:
	@bash ops/dev/migrate.sh

## dev-import-content: start db if needed, UPSERT cms/content/, then run rerunnable backfills
dev-import-content:
	@bash ops/dev/import_content.sh

# ---------------------------------------------------------------------------
# prod target host — pre-built, no watch, registry-pulled
# ---------------------------------------------------------------------------

## prod-prepare: host-level preparation on the RUN env (idempotent): preflight + generate .secrets/db_password + create /var/lib/type-any-language/postgres. Does NOT start containers, does NOT build images (build happens on the BUILD env via `make prod-build` / `make release-prod`).
prod-prepare:
	@bash ops/prod/prepare.sh

## prod-deploy: THE go-live step. Works for both first-time and subsequent deploys. Pulls all 3 images, recreates db+backend+nginx, db image's entrypoint auto-applies migrations + imports content. Pre: `make prod-prepare` has been run on this host (one-time, for new CVMs).
prod-deploy:
	@bash ops/prod/deploy.sh

## prod-start: start prod containers (auto-pulls from registry)
prod-start:
	@bash ops/prod/lifecycle.sh start

## prod-stop: stop prod containers
prod-stop:
	@bash ops/prod/lifecycle.sh stop

## prod-restart: recreate prod containers + re-read .secrets
prod-restart:
	@bash ops/prod/lifecycle.sh restart

## prod-doctor: preflight check for prod host (includes cloud-db probe)
prod-doctor:
	@bash ops/prod/doctor.sh

## prod-logs [svc]: tail prod container logs
prod-logs:
	@bash ops/prod/logs.sh

## prod-build: build 3 prod images (db + backend + frontend) (BUILD env)
prod-build:
	@bash ops/prod/build/image.sh

## prod-push: push 3 prod images to $DOCKER_REGISTRY (BUILD env)
prod-push:
	@bash ops/prod/build/push.sh

## cms-fetch [auto|rsync|git|from PATH]: pull cms/content/ from CMS host (rsync if $CMS_HOST set) or git pull. Default = auto.
cms-fetch:
	@bash scripts/fetch_cms_content.sh $(filter-out $@,$(MAKECMDGOALS))

# ---------------------------------------------------------------------------
# cms — content production (OpenAI + Tencent TTS)
# Lives on the CMS host, NOT on target hosts. See cms/README.md.
# ---------------------------------------------------------------------------

## cms-env-init: first-time create cms/.env + smart defaults
# retired — secrets come from GitHub Environments via
#   eval "$(scripts/secrets/fetch_secrets.sh eval-cms)"
# (see scripts/secrets/fetch_secrets.sh and CLAUDE.md "CMS host —
# secrets come from GitHub Environments"). Use cms-doctor as the
# pre-flight to confirm fetch_secrets.sh was eval'd.

## cms-env-show: print current cms/.env (secrets redacted)
# retired — see cms-env-init above.

## cms-env-doctor: validate cms/.env completeness
# retired — see cms-env-init above.

## cms-env-update KEY=VALUE: update one key, keep others unchanged
# retired — see cms-env-init above.

## cms-vocab: CSVs → cms/content/vocabulary/<lib>.json (Extract)
cms-vocab:
	@bash cms/scripts/staging.sh vocab

## cms-sentences: OpenAI → cms/content/sentences/<lib>.jsonl
cms-sentences:
	@bash cms/scripts/staging.sh sentences

## cms-audio: Tencent TTS → fill audio_url in cms/content/sentences/*
cms-audio:
	@bash cms/scripts/staging.sh audio

## cms-staging-doctor: cms env + Python deps preflight
cms-staging-doctor:
	@bash cms/scripts/staging.sh doctor

## cms-run: full CMS pipeline (vocab + sentences + audio, no db import)
cms-run:
	@bash cms/run.sh

# ---------------------------------------------------------------------------
# db — cloud-db (TencentDB) side: bootstrap + import + migrate
# ---------------------------------------------------------------------------

## db-import: import cms/content/* into cloud db (UPSERT)
db-import:
	@bash db/scripts/import_staging.sh all

## db-init-schema: apply base schema (idempotent CREATE TABLE IF NOT EXISTS)
db-init-schema:
	@bash db/scripts/init_schema.sh

## db-migrate: apply pending schema migrations to cloud db
db-migrate:
	@bash db/scripts/migrate.sh

## db-next-migration-prefix: print next available 4-digit prefix for a shared migration on origin/master
db-next-migration-prefix:
	@bash db/scripts/next_migration_prefix.sh

# ---------------------------------------------------------------------------
# release orchestration + multi-image local builds
# ---------------------------------------------------------------------------

## release-show: print all per-segment VERSION files
release-show:
	@bash ops/prod/release.sh show

## release-prod [X.Y.Z]: bump backend/VERSION + frontend/VERSION + db/VERSION + build + push to registry. **Does NOT deploy** — for that run `make prod-deploy`. Pairs with .github/workflows/release-prod.yml.
release-prod:
	@bash ops/prod/release.sh prod

## prod-deploy: pull latest image + recreate containers. THE "go live" step. Run after `make release-prod`. Pairs with .github/workflows/deploy-prod.yml.
prod-deploy:
	@bash ops/prod/deploy.sh

## publish-prod: legacy alias for release-prod (kept for backward compat)
publish-prod: release-prod

## publish-show: legacy alias for release-show
publish-show: release-show

## build-prod-only: only build prod app images
build-prod-only:
	@bash ops/prod/build.sh prod

# ---------------------------------------------------------------------------
# meta
# ---------------------------------------------------------------------------

## help: list all targets with one-line purpose
help:
	@echo "type-any-language — Makefile targets"
	@echo ""
	@echo "Usage: make <target> [extra args passed through to bash script]"
	@echo ""
	@grep -E '^## ' Makefile | sed -e 's/^## /  /'