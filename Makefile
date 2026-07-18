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
# dev target host — daily driver (containers + compose watch)
# ---------------------------------------------------------------------------

## dev-setup: first-time bootstrap (ensure db image + build dev apps)
dev-setup:
	@bash ops/dev/setup.sh

## dev-setup-content: rebake dev db image from cms/staging + restart
dev-setup-content:
	@bash ops/dev/setup.sh content

## dev-start: start dev containers + background compose watch
dev-start:
	@bash ops/dev/lifecycle.sh start

## dev-stop: stop compose watch + dev containers
dev-stop:
	@bash ops/dev/lifecycle.sh stop

## dev-restart: recreate containers + re-read .secrets
dev-restart:
	@bash ops/dev/lifecycle.sh restart

## dev-doctor: preflight check (images / drift / ports)
dev-doctor:
	@bash ops/dev/doctor.sh

## dev-logs [svc]: tail container logs (optional service name)
dev-logs:
	@bash ops/dev/logs.sh

## dev-watch: foreground compose watch (Ctrl+C to stop)
dev-watch:
	@bash ops/dev/watch.sh

## dev-migrate: apply pending schema migrations to running dev db
dev-migrate:
	@bash ops/dev/migrate.sh

## dev-build: build english_backend_dev + english_frontend_dev images
dev-build:
	@bash ops/dev/build_image.sh

# ---------------------------------------------------------------------------
# prod target host — pre-built, no watch, registry-pulled
# ---------------------------------------------------------------------------

## prod-setup: first-time bootstrap (pull db image + build prod apps)
prod-setup:
	@bash ops/prod/setup.sh

## prod-start: start prod containers (auto-pulls from registry)
prod-start:
	@bash ops/prod/lifecycle.sh start

## prod-stop: stop prod containers
prod-stop:
	@bash ops/prod/lifecycle.sh stop

## prod-restart: recreate prod containers + re-read .secrets
prod-restart:
	@bash ops/prod/lifecycle.sh restart

## prod-doctor: preflight check for prod host
prod-doctor:
	@bash ops/prod/doctor.sh

## prod-logs [svc]: tail prod container logs
prod-logs:
	@bash ops/prod/logs.sh

## prod-build: build english_backend + english_frontend prod images
prod-build:
	@bash ops/prod/build_image.sh

## prod-push: push prod backend+frontend to $DOCKER_REGISTRY
prod-push:
	@bash ops/prod/push_image.sh

# ---------------------------------------------------------------------------
# cms — content production (OpenAI + Tencent TTS)
# Lives on the CMS host, NOT on target hosts. See cms/README.md.
# ---------------------------------------------------------------------------

## cms-env-init: first-time create cms/.env + smart defaults
cms-env-init:
	@bash cms/scripts/env.sh init

## cms-env-show: print current cms/.env (secrets redacted)
cms-env-show:
	@bash cms/scripts/env.sh show

## cms-env-doctor: validate cms/.env completeness
cms-env-doctor:
	@bash cms/scripts/env.sh doctor

## cms-env-update KEY=VALUE: update one key, keep others unchanged
cms-env-update:
	@bash cms/scripts/env.sh update

## cms-sync: CSVs → cms/staging/vocabulary/<lib>.json (Extract)
cms-sync:
	@bash cms/scripts/staging.sh sync

## cms-sentences: OpenAI → cms/staging/sentences/<lib>.jsonl
cms-sentences:
	@bash cms/scripts/staging.sh sentences

## cms-audio: Tencent TTS → fill audio_url in cms/staging/sentences/*
cms-audio:
	@bash cms/scripts/staging.sh audio

## cms-staging-doctor: cms/.env + Python deps preflight
cms-staging-doctor:
	@bash cms/scripts/staging.sh doctor

## cms-publish: export staging bundle for db side
cms-publish:
	@bash cms/scripts/staging.sh publish

## cms-export: alias of cms-publish
cms-export:
	@bash cms/scripts/staging.sh export

## cms-run: full CMS pipeline (sync + sentences + audio + db bake)
cms-run:
	@bash cms/run.sh

# ---------------------------------------------------------------------------
# db — content side: source db + import + bake + push
# ---------------------------------------------------------------------------

## db-source-ensure: idempotent start of cms-source-db (returns 0 if reachable)
db-source-ensure:
	@bash db/scripts/source_db.sh ensure

## db-source-status: print source db state
db-source-status:
	@bash db/scripts/source_db.sh status

## db-source-start: force-start cms-source-db
db-source-start:
	@bash db/scripts/source_db.sh start

## db-source-stop: stop cms-source-db
db-source-stop:
	@bash db/scripts/source_db.sh stop

## db-import: import cms/staging/* into staging db (UPSERT)
db-import:
	@bash db/scripts/import_staging.sh all

## db-init-schema: apply base schema (idempotent CREATE TABLE IF NOT EXISTS)
db-init-schema:
	@bash db/scripts/init_schema.sh

## db-migrate: apply pending schema migrations to staging db
db-migrate:
	@bash db/scripts/migrate.sh

## db-bake: dump + assemble + docker build (english_db_content*)
db-bake:
	@bash db/scripts/build.sh

## db-push: push baked db image to $DOCKER_REGISTRY
db-push:
	@bash db/scripts/push.sh

# ---------------------------------------------------------------------------
# release orchestration + multi-image local builds
# ---------------------------------------------------------------------------

## release-show: print all per-segment VERSION files
release-show:
	@bash ops/release.sh show

## release-dev [X.Y.Z]: bump backend/VERSION + frontend/VERSION + build dev apps
release-dev:
	@bash ops/release.sh dev

## release-prod [X.Y.Z]: bump db/VERSION + backend/VERSION + frontend/VERSION + bake db + build + push all
release-prod:
	@bash ops/release.sh prod

## build-all: local multi-image build (db + dev + prod), no push
build-all:
	@bash ops/build.sh

## build-db: only bake content-baked db image
build-db:
	@bash ops/build.sh db

## build-dev-only: only build dev app images
build-dev-only:
	@bash ops/build.sh dev

## build-prod-only: only build prod app images
build-prod-only:
	@bash ops/build.sh prod

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