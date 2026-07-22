#!/usr/bin/env bash
#
# scripts/secrets/fetch_secrets.sh — central GitHub Secrets fetcher.
#
# Purpose: replace local cms/.env + .secrets/ with a single source of
# truth (GitHub Actions Secrets). Operators call
#
#     eval "$(./scripts/secrets/fetch_secrets.sh eval-cms)"
#     eval "$(./scripts/secrets/fetch_secrets.sh eval-db)"
#     eval "$(./scripts/secrets/fetch_secrets.sh eval-all)"
#
# and the script dispatches .github/workflows/sync-secrets.yml,
# downloads the resulting artifact, sources it into a sub-shell env, and prints
# shell-safe `export K=V` lines on stdout. The caller `eval`s them, so the
# secrets live in the caller's process env. The artifact's secrets.env is
# transiently present in a git-ignored workdir during download and is removed
# by the EXIT trap.
#
# Mechanism (why this is the only viable path):
#   GitHub's REST `actions/secrets` endpoints are write-only and
#   metadata-only; there is no way to read a secret's cleartext
#   value back to the caller. The only legal channel is
#   `${{ secrets.* }}` inside an Actions runner, exported via
#   `actions/upload-artifact` to the artifact store. We then
#   `gh run download` from the workstation and source it.
#
# Subcommands:
#   eval-cms    emit export-lines for AI_*/TENCENT_*/CLOUD_*
#   eval-db     emit export-lines for TENCENT_DB_*/TENCENT_DB_ADMIN_URL
#   eval-all    emit export-lines for both segments
#   check       preflight: gh installed, authenticated, repo matches
#   help        this message
#
# Exit codes:
#   0   success (or `check` reports all-OK)
#   1   generic error (gh missing / unauth / run failed / artifact
#       missing / repo mismatch / wrong gh version)
#
# Requirements:
#   - gh CLI >= 2.0 (for `gh run download --name <artifact>`)
#   - gh authenticated (`gh auth login`) with `actions:read` scope
#   - the `type-any-language` repo (this directory's upstream) must
#     own the secrets — forks do NOT inherit upstream secrets
#
# Per-run shape:
#   1. `gh workflow run sync-secrets.yml -f which=<seg> -f request_id=<uuid>`
#   2. poll `gh run list --workflow=sync-secrets.yml --limit=1`
#      until status=completed (2s interval, 60s timeout)
#   3. `gh run view <id> --json conclusion` must be "success"
#   4. `gh run download <id> --name secrets-<seg>-<id> --dir <mktemp>`
#      <mktemp> = `mktemp -d`; `trap 'rm -rf <mktemp>' RETURN` cleans up
#   5. `( set -a; . <mktemp>/secrets.env; set +a; env -0 | tr '\0' '\n' |
#         grep -E '^(AI_|TENCENT_|CLOUD_|TENCENT_DB_|DATABASE_URL)' )`
#      — sub-shell inherits nothing from caller, so secrets only enter
#      the caller's env via `eval`. The mktemp is removed before the
#      sub-shell returns.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

cmd="${1:-help}"; shift || true

die()  { echo "[fetch_secrets][ERR] $*" >&2; exit 1; }
info() { echo "[fetch_secrets][INFO] $*" >&2; }

# Global EXIT trap: clean up any .fetch-<segment>-<id> workdirs left
# behind by fetch_segment. Function-local traps get removed when the
# function returns, so the trap must be at the top level. EXIT (not
# RETURN) — RETURN fires after every `source`/`.` file's implicit
# return, which would wipe secrets.env mid-source.
_FETCH_WORKDIR=""
cleanup_workdir() {
    # `|| true` so a missing workdir (or `rm -rf ""` on Git Bash, which
    # returns non-zero) doesn't propagate out of the trap. Under
    # `set -e` + `trap ... EXIT`, the trap's exit code overrides the
    # script's — and `[ -n "" ]` short-circuits to 1, which would turn
    # a successful `cmd_check` into an apparent failure.
    [ -n "$_FETCH_WORKDIR" ] && rm -rf "$_FETCH_WORKDIR" || true
    return 0
}
trap cleanup_workdir EXIT

need_gh() {
    command -v gh >/dev/null 2>&1 || die "gh CLI 未装; 安装: https://cli.github.com (需要 >= 2.0 支持 gh run download --name)"
    local v
    v="$(gh --version | head -1 | awk '{print $3}')"
    # gh version is "gh version 2.x.y (YYYY-MM-DD)" — extract major.
    local major="${v%%.*}"
    if ! [[ "$major" =~ ^[0-9]+$ ]] || [ "$major" -lt 2 ]; then
        die "gh CLI 版本 $v 太老 (< 2.0) — 升级到 >= 2.0"
    fi
}

need_auth() {
    need_gh
    if ! gh auth status >/dev/null 2>&1; then
        die "gh 未登录; 跑: gh auth login (需要 actions:read scope)"
    fi
}

cmd_check() {
    need_gh || return 1
    info "gh $(gh --version | head -1 | awk '{print $3}') OK"
    if gh auth status >/dev/null 2>&1; then
        info "gh auth OK"
    else
        info "gh auth 失败 — 跑 gh auth login"
        return 1
    fi
    local remote
    remote="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "")"
    if [ -n "$remote" ]; then
        info "repo = $remote"
    else
        info "当前 dir 未关联到任何 GH repo — 跑 gh auth login 后在 repo root 跑此脚本"
        return 1
    fi
    info "all checks passed"
    return 0
}

# fetch_segment <segment> <tier>
#   segment ∈ {cms, db, all}
#   tier    ∈ {dev, prod}   selects which GH secret suffix to read
# Emits `export K=V` lines on stdout for the requested segment keys.
# Sub-shell sourcing of the artifact means secrets only reach the
# sub-shell's env; we then re-emit them as export-lines for the caller
# to eval. Caller-process env is mutated only after `eval`.
fetch_segment() {
    local segment="$1"
    local tier="$2"
    case "$tier" in
        dev|test|prod) ;;
        *) die "fetch_segment: tier must be dev|test|prod (got: $tier)" ;;
    esac
    need_auth

    local request_id artifact_name run_id conclusion tmp env_file

    # uuidgen: Linux has /proc/sys/kernel/random/uuid, macOS has uuidgen,
    # fallback to nanosecond timestamp (still unique-enough per second).
    request_id="$(
        cat /proc/sys/kernel/random/uuid 2>/dev/null \
            || uuidgen 2>/dev/null \
            || date +%s%N
    )"
    artifact_name="secrets-${tier}-${segment}-${request_id}"

    info "dispatching sync-secrets.yml tier=${tier} which=${segment} request_id=${request_id}"
    # Capture stderr — gh returns helpful 404 messages that would
    # otherwise be swallowed by the >/dev/null on stdout.
    # Auto-detect the repo's default branch from origin/HEAD; fall back
    # to the local branch's upstream if origin/HEAD isn't set, then to
    # 'master'. Hard-coding 'main' here is wrong (this repo's default
    # is 'master') and 422's with a confusing "no ref found" message.
    local gh_ref
    if [ -n "${GH_SECRETS_REF:-}" ]; then
        gh_ref="$GH_SECRETS_REF"
    else
        gh_ref="$(
            git -C "$PROJECT_DIR" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null \
                | sed 's@^origin/@@' \
                || true
        )"
        if [ -z "$gh_ref" ]; then
            gh_ref="$(
                git -C "$PROJECT_DIR" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null \
                    | sed 's@^origin/@@' \
                    || true
            )"
        fi
        gh_ref="${gh_ref:-master}"
    fi
    info "ref = $gh_ref"
    if ! gh workflow run sync-secrets.yml \
            --ref "$gh_ref" \
            -f tier="$tier" \
            -f which="$segment" \
            -f request_id="$request_id" \
            >/dev/null; then
        die "gh workflow run 失败 — 确认 (a) sync-secrets.yml 在 ref='$gh_ref' 上 push 了,(b) gh token 有 actions:write,(c) 当前 dir 的 upstream repo 拥有 secret"
    fi

    info "waiting for run to complete..."
    run_id=""
    local i=0
    while [ $i -lt 30 ]; do
        sleep 2
        i=$((i + 1))
        run_id="$(
            gh run list --workflow=sync-secrets.yml --limit=30 \
                --json databaseId,status,displayTitle \
                -q ".[] | select(.displayTitle | contains(\"${request_id}\")) | .databaseId" \
                2>/dev/null | head -1 || echo ""
        )"
        if [ -n "$run_id" ]; then
            local run_status
            run_status="$(gh run view "$run_id" --json status -q .status 2>/dev/null || echo "")"
            [ "$run_status" = "completed" ] && break
            run_id=""
        fi
    done
    if [ -z "$run_id" ]; then
        die "workflow run 未在 60s 内完成; 用 gh run list --workflow=sync-secrets.yml 排查"
    fi

    conclusion="$(gh run view "$run_id" --json conclusion -q .conclusion 2>/dev/null || echo "")"
    if [ "$conclusion" != "success" ]; then
        die "sync-secrets.yml 退出结论=$conclusion (run_id=$run_id); 用 gh run view $run_id 看日志"
    fi

    # `gh run download` (2.86 on Windows at least) extracts the named
    # artifact's contents (the workflow's `secrets.env` file) to the
    # CURRENT working directory, regardless of `--dir`. The cwd must
    # be a git repo (gh 404s otherwise) and must not already contain a
    # file named `secrets.env` (zip extraction errors with "file
    # exists"). We cd into a per-call subdir of PROJECT_DIR so both
    # constraints are satisfied, and trap the cleanup.
    #
    # This subdir is .gitignore'd: `/.fetch-*` is added to .gitignore
    # so even if the script crashes before trap, nothing leaks into
    # the index.
    local workdir="${PROJECT_DIR}/.fetch-${tier}-${segment}-${request_id}"
    mkdir -p "$workdir"
    # Register the workdir for the top-level EXIT trap. Do NOT set a
    # function-local trap — it'd be removed when fetch_segment returns.
    _FETCH_WORKDIR="$workdir"
    # From here on, every action uses workdir as cwd. We need PROJECT_DIR
    # to be a parent so gh's git-rev-parse still walks up and finds .git.
    cd "$workdir"

    info "downloading artifact ${artifact_name}"
    if ! gh run download "$run_id" --name "$artifact_name" >/dev/null 2>&1; then
        die "artifact 拉取失败 — 确认 token 有 actions:read, 且 artifact 名匹配 (run_id=$run_id, name=$artifact_name)"
    fi

    local env_file="$workdir/secrets.env"
    if [ ! -f "$env_file" ]; then
        die "artifact 内缺 secrets.env (workdir content: $(ls -A "$workdir" 2>/dev/null | tr '\n' ' '))"
    fi

    # Source inside a sub-shell so secrets only enter the sub-shell env.
    # Then re-emit as `export K=V` lines for the caller to eval.
    local prefix
    case "$segment" in
        cms) prefix='^(AI_|TENCENT_|CLOUD_)' ;;
        db)  prefix='^(TENCENT_DB_|TENCENT_DB_ADMIN_URL|DATABASE_URL)' ;;
        all) prefix='^(AI_|TENCENT_|CLOUD_|TENCENT_DB_|TENCENT_DB_ADMIN_URL|DATABASE_URL)' ;;
        *)   die "unknown segment: $segment" ;;
    esac

    (
        set -a
        # shellcheck disable=SC1090
        . "$env_file"
        set +a
        # `env -0` prints all env vars NUL-separated; emit only the keys for
        # this segment as shell-quoted assignments for the caller's eval.
        # `printf %q` keeps spaces, quotes, dollars, and other shell
        # metacharacters inside the value instead of executing them.
        while IFS= read -r -d '' entry; do
            key="${entry%%=*}"
            value="${entry#*=}"
            if [[ "$key" =~ $prefix ]]; then
                printf 'export %s=%q\n' "$key" "$value"
            fi
        done < <(env -0)
    )
}

usage() {
    cat <<EOF
用法: $0 <command>:<tier>

Tier:
  dev   (default) read from GH Environment 'dev'
  test            read from GH Environment 'test'
  prod            read from GH Environment 'prod' (may pause for
                  required reviewers if configured in the GH UI)

Commands:
  eval-cms    Emit export-lines for AI_*/TENCENT_*/CLOUD_*  (eval in caller)
  eval-db     Emit export-lines for TENCENT_DB_*/TENCENT_DB_ADMIN_URL
  eval-all    Emit export-lines for cms + db segments
  check       Preflight: gh installed, authenticated, repo matches
  help        This message

Shorthand:
  eval-cms           ===  eval-cms:dev
  eval-db            ===  eval-db:dev
  eval-all           ===  eval-all:dev
  eval-cms:test      force test tier
  eval-db:prod       force prod tier (fetches TENCENT_DB_ADMIN_URL
                     from env 'prod' — required reviewers gate applies
                     if the GH Environment has them configured)

Typical workflow (CMS host, dev):
  cd ~/<repo>
  eval "\$(scripts/secrets/fetch_secrets.sh eval-cms)"
  ./cms/scripts/staging.sh sentences
  ./cms/scripts/staging.sh audio

Typical workflow (db / dev host, dev tier):
  cd ~/<repo>
  eval "\$(scripts/secrets/fetch_secrets.sh eval-db)"
  ./ops/dev/setup.sh bootstrap

Typical workflow (prod host):
  cd ~/<repo>
  eval "\$(scripts/secrets/fetch_secrets.sh eval-db:prod)"  # also pulls TENCENT_DB_ADMIN_URL
  ./ops/prod/setup.sh bootstrap

The caller-process env is mutated only after you eval the script's
stdout — secrets live only in that process memory, never on disk.
EOF
}

# Parse the subcommand: split on optional ':' for tier override.
# Examples: eval-cms         -> segment=cms       tier=dev
#           eval-db:prod     -> segment=db        tier=prod
#           eval-cms:test    -> segment=cms       tier=test
parse_cmd() {
    local raw="$1"
    # Strip the leading 'eval-' (or accept already-stripped bare segment).
    case "$raw" in
        eval-*) SEGMENT="${raw#eval-}" ;;
        *)      SEGMENT="$raw" ;;
    esac
    # Optional ':tier' suffix.
    case "$SEGMENT" in
        *:*)
            TIER="${SEGMENT##*:}"
            SEGMENT="${SEGMENT%%:*}"
            ;;
        *)
            TIER="dev"
            ;;
    esac
    case "$TIER" in
        dev|test|prod) ;;
        *) die "tier must be dev|test|prod (got: $TIER)" ;;
    esac
    case "$SEGMENT" in
        cms|db|all) ;;
        *) die "segment must be cms|db|all (got: $SEGMENT)" ;;
    esac
}

case "$cmd" in
    eval-cms|eval-cms:dev|eval-cms:test|eval-cms:prod) parse_cmd "$cmd"; fetch_segment "$SEGMENT" "$TIER" ;;
    eval-db|eval-db:dev|eval-db:test|eval-db:prod)    parse_cmd "$cmd"; fetch_segment "$SEGMENT" "$TIER" ;;
    eval-all|eval-all:dev|eval-all:test|eval-all:prod) parse_cmd "$cmd"; fetch_segment "$SEGMENT" "$TIER" ;;
    check)      cmd_check ;;
    help|-h|--help) usage ;;
    *) die "unknown command: $cmd (try: $0 help)" ;;
esac
