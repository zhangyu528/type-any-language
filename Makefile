# Makefile - discoverable entry points for the type-any-language repo.
#
# Why a Makefile: cross-platform executable-bit pain. macOS needs +x on
# *.sh, Windows NTFS ignores it. By routing every script invocation
# through `bash <script> <args>` we sidestep the +x requirement
# entirely - every script runs identically on macOS, Linux, and Windows
# (Git Bash / WSL).
#
# What's in here: dev-* (workstation daily driver) + cms-* (content
# production on the CMS host). prod-* + db-* are NOT here — prod ops
# go through .github/workflows/{release,publish-prod,infra/bootstrap-prod}.yml
# and operators call the underlying bash scripts directly
# (e.g. `bash ops/cvm/lifecycle.sh restart`). No workflow in this repo
# depends on a Makefile target, so dropping a target is a one-line edit.
#
# Conventions:
#   - Each target is a 1-line `@bash <script>` wrapper for cross-platform.
#   - `make help` (default goal) lists all targets + 1-line purpose.

SHELL := /usr/bin/env bash

.PHONY: help
.DEFAULT_GOAL := help

# ---------------------------------------------------------------------------
# dev target host - daily driver.
#
# HOST-NATIVE dev loop only (no compose, no docker images). backend (uvicorn) and frontend (next dev)
# run on the host against the docker postgres (the `db` service in
# docker-compose.dev.yml). No dev docker images, no compose watch.
# ---------------------------------------------------------------------------

## dev-setup: install host-native deps (python venv + node_modules) + bring up docker db
dev-setup:
	@bash dev-tools/setup.sh

## dev-start: HOST-NATIVE start (uvicorn + next dev on host; db in docker)
dev-start:
	@bash dev-tools/native.sh start

## dev-stop: stop host-native backend + frontend
dev-stop:
	@bash dev-tools/native.sh stop

## dev-restart: stop + start host-native
dev-restart:
	@bash dev-tools/native.sh restart

## dev-restart-frontend: kill frontend (pid file + port fallback for orphans) + start (does NOT touch backend)
dev-restart-frontend:
	@cd frontend && npm run dev:restart

## dev-status: pid + uptime + port for native backend/frontend + docker db health
dev-status:
	@bash dev-tools/native.sh status

## dev-logs [backend|frontend|both]: tail native logs (default both)
dev-logs:
	@bash dev-tools/native.sh logs

## dev-native-preflight: read-only check (python/node/.venv/node_modules/db)
dev-native-preflight:
	@bash dev-tools/native.sh preflight

## dev-doctor: preflight check (docker / compose / host python+node / db mount / ports)
dev-doctor:
	@bash dev-tools/doctor.sh

## dev-migrate: apply pending schema migrations to docker postgres (host-side runner)
dev-migrate:
	@bash dev-tools/migrate.sh

## dev-import-content: start db if needed, UPSERT cms/content/, then run rerunnable backfills
dev-import-content:
	@bash dev-tools/import_content.sh

## cms-fetch [auto|rsync|git|from PATH]: pull cms/content/ from CMS host (rsync if $CMS_HOST set) or git pull. Default = auto.
cms-fetch:
	@bash scripts/fetch_cms_content.sh $(filter-out $@,$(MAKECMDGOALS))

# ---------------------------------------------------------------------------
# cms - content production (OpenAI + Tencent TTS)
# Lives on the CMS host, NOT on target hosts. See cms/README.md.
# ---------------------------------------------------------------------------

## cms-env-init: first-time create cms/.env + smart defaults
# retired - secrets come from GitHub Environments via
#   eval "$(scripts/secrets/fetch_secrets.sh eval-cms)"
# (see scripts/secrets/fetch_secrets.sh and CLAUDE.md "CMS host -
# secrets come from GitHub Environments"). Use cms-doctor as the
# pre-flight to confirm fetch_secrets.sh was eval d.

## cms-env-show: print current cms/.env (secrets redacted)
# retired - see cms-env-init above.

## cms-env-doctor: validate cms/.env completeness
# retired - see cms-env-init above.

## cms-env-update KEY=VALUE: update one key, keep others unchanged
# retired - see cms-env-init above.

## cms-vocab: CSVs -> cms/content/vocabulary/<lib>.json (Extract)
cms-vocab:
	@bash cms/scripts/staging.sh vocab

## cms-sentences: OpenAI -> cms/content/sentences/<lib>.jsonl
cms-sentences:
	@bash cms/scripts/staging.sh sentences

## cms-audio: Tencent TTS -> fill audio_url in cms/content/sentences/*
cms-audio:
	@bash cms/scripts/staging.sh audio

## cms-staging-doctor: cms env + Python deps preflight
cms-staging-doctor:
	@bash cms/scripts/staging.sh doctor

## cms-run: full CMS pipeline (vocab + sentences + audio, no db import)
cms-run:
	@bash cms/run.sh

# ---------------------------------------------------------------------------
# meta
# ---------------------------------------------------------------------------

## help: list all targets with one-line purpose
help:
	@echo "type-any-language - Makefile targets"
	@echo ""
	@echo "Usage: make <target> [extra args passed through to bash script]"
	@echo ""
	@grep -E "^## " Makefile | sed -e "s/^## /  /"
