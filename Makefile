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

## dev-setup: first-time bootstrap (verify cloud-db + build dev apps)
dev-setup:
	@bash ops/dev/setup.sh

## dev-start: start dev containers + background compose watch
dev-start:
	@bash ops/dev/lifecycle.sh start

## dev-stop: stop compose watch + dev containers
dev-stop:
	@bash ops/dev/lifecycle.sh stop

## dev-restart: recreate containers + re-read .secrets
dev-restart:
	@bash ops/dev/lifecycle.sh restart

## dev-doctor: preflight check (images / drift / ports / cloud-db)
dev-doctor:
	@bash ops/dev/doctor.sh

## dev-logs [svc]: tail container logs (optional service name)
dev-logs:
	@bash ops/dev/logs.sh

## dev-watch: foreground compose watch (Ctrl+C to stop)
dev-watch:
	@bash ops/dev/watch.sh

## dev-migrate: apply pending schema migrations to live cloud db (host-side runner)
dev-migrate:
	@bash ops/dev/migrate.sh

## dev-import-content: import cms/content/ into dev db (host-side runner)
dev-import-content:
	@bash ops/dev/import_content.sh

## dev-build: build english_backend_dev + english_frontend_dev images
dev-build:
	@bash ops/dev/build_image.sh

# ---------------------------------------------------------------------------
# prod target host — pre-built, no watch, registry-pulled
# ---------------------------------------------------------------------------

## prod-setup: first-time bootstrap (verify cloud-db + build prod apps)
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

## prod-doctor: preflight check for prod host (includes cloud-db probe)
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
	@bash ops/release.sh show

## release-dev [X.Y.Z]: bump backend/VERSION + frontend/VERSION + build dev apps
release-dev:
	@bash ops/release.sh dev

## release-prod [X.Y.Z]: bump backend/VERSION + frontend/VERSION + build + push prod apps
release-prod:
	@bash ops/release.sh prod

## build-all: local multi-image build (dev + prod), no push
build-all:
	@bash ops/build.sh

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