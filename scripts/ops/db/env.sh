#!/bin/bash
#
# cms/env.sh — manage .env.db on the CMS content-production host.
#
# This is the unified entry point for .env.db lifecycle: first-time
# creation, ongoing updates, masked inspection, and config validation.
# Default behaviour is `init` (backward-compatible — old users who just
# run `./scripts/ops/db/env.sh` get the bootstrap flow they expect).
#
# Subcommands:
#   (no args)  init      Create .env.db from template + inject smart defaults.
#                        Idempotent: skips if .env.db exists.
#   update     update    Update one or more KEY=VALUE pairs in .env.db.
#                        Other keys are untouched ("remember last" semantics).
#                        Without args: interactive prompt. With args: non-interactive.
#   show       show      Print .env.db contents with sensitive values masked.
#   doctor     doctor    Validate .env.db completeness + format checks.
#                        Non-zero exit if any REQUIRED key is missing/invalid.
#   -h | help             Show usage.
#
# "Remember last" semantics:
#   - `init` only runs on first creation; existing .env.db is left alone.
#   - `update` changes only the keys you specify; everything else is preserved.
#   - `show` and `doctor` are read-only.
#
# Why "env.sh" (not "init.sh"):
#   The script's real job is to manage .env.db (init / update / show /
#   doctor), not just initialize it. "env.sh" describes the scope.
#
#   Note: target hosts (dev/prod) no longer have an env.sh at all — they
#   need no .env file. POSTGRES_PASSWORD is generated on first start by
#   run.sh, and ALLOWED_ORIGINS is passed via the shell env (compose
#   has a built-in default). So this is the only env.sh in the project.
#
# Smart defaults NOT injected (require user-supplied secrets + operator decisions):
#   - POSTGRES_PASSWORD              (host-side db password; see "Where does
#                                     the db password come from" below)
#   - AI_API_KEY                     (provider-issued)
#   - AI_BASE_URL                    (operator decision: OpenAI / Azure / local)
#   - AI_MODEL                       (operator decision: gpt-3.5-turbo / gpt-4o / ...)
#   - TENCENT_SECRET_ID/KEY/APP_ID   (provider-issued)
#
# All other knobs (POSTGRES_USER, POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB,
# DB_IMAGE, AUDIO_DIR, DEFAULT_BUCKET_TARGET_SIZE) have code-level defaults
# and are therefore NOT in .env.db. To pin a different value, set it in
# the shell:
#   POSTGRES_USER=other ./scripts/ops/db/bake_image.sh
#   AUDIO_DIR=/my/audio/dir ./scripts/ops/db/content.sh audio
#   DEFAULT_BUCKET_TARGET_SIZE=500 ./scripts/ops/db/content.sh sentences
# DB_IMAGE_TAG is also not here — its default is the root ./VERSION file
# (resolved by scripts/lib.sh), with .env.db / shell env able to pin a
# specific version when needed.
#
# DOCKER_REGISTRY is not in .env.db either — it lives in the committed
# ./REGISTRY file at the repo root (shared project config, not a secret).
# Override at push time via shell env:
#   export DOCKER_REGISTRY=docker.io/youruser
#   ./scripts/ops/db/push_image.sh
#
# Where does the db password come from?
#   DATABASE_URL is assembled at runtime by db/pipeline/env.py +
#   scripts/ops/db/bake_image.sh from POSTGRES_PASSWORD (which has no code
#   default) + code defaults for user/host/port/db. POSTGRES_PASSWORD is
#   resolved in this order:
#     1. shell env:  export POSTGRES_PASSWORD=...
#     2. .secrets/postgres_password (chmod 600) — same file the dev/prod
#        run.sh writes; operator copies it from the dev/prod host to the
#        CMS host for content production
#     3. error with hint
#   For a single-host setup (CMS + dev on the same machine), .secrets/
#   postgres_password already exists, so no extra setup is needed.
#
# Requires: shell + filesystem. NO python, NO docker.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$PROJECT_DIR"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../../lib.sh"

TEMPLATE=".env.example.db"
TARGET=".env.db"

# Keys whose values contain a secret and must be masked in `show`.
# (Used by cmd_show; kept here for documentation and to make it easy
# to extend if more secrets land in .env.db later.)
SECRET_KEYS=(
    AI_API_KEY
    TENCENT_SECRET_ID
    TENCENT_SECRET_KEY
)

# Required keys for a "ready" CMS host. Used by cmd_doctor.
# DATABASE_URL is NOT here — it's assembled at runtime from POSTGRES_PASSWORD
# + code defaults (see header comment). AUDIO_DIR is NOT here — it has a code
# default (/var/lib/type-any-language/audio) and can be overridden via shell
# env. AI_BASE_URL and AI_MODEL ARE here — they're operator decisions
# (OpenAI vs Azure vs local; gpt-3.5-turbo vs gpt-4o), not infrastructure
# defaults, so they go in .env.db. POSTGRES_USER/POSTGRES_HOST/
# POSTGRES_PORT/POSTGRES_DB/DB_IMAGE/DEFAULT_BUCKET_TARGET_SIZE are
# intentionally NOT here — they have code-level defaults (see env.py +
# bake_image.sh) and can be overridden via shell env when needed.
# DB_IMAGE_TAG is also not here — its default is the root ./VERSION file
# (lib.sh's resolve_image_tag). TENCENT_* is checked separately below
# (all-or-nothing, but only the audio subcommand actually needs them).
REQUIRED_KEYS=(
    AI_API_KEY
    AI_BASE_URL
    AI_MODEL
)

# Portable sed -i (GNU vs BSD) lives in lib.sh; sourced above.

# Echo a value with sensitive keys masked.
mask_value() {
    local key="$1"
    local value="$2"
    for s in "${SECRET_KEYS[@]}"; do
        if [ "$key" = "$s" ]; then
            # Show first 4 + last 4 chars of the value, with **** between.
            local n=${#value}
            if [ "$n" -le 8 ]; then
                echo "****"
            else
                echo "${value:0:4}****${value: -4}"
            fi
            return
        fi
    done
    echo "$value"
}

# ---------------------------------------------------------------------------
# cmd_init — first-time creation with smart defaults
# ---------------------------------------------------------------------------
cmd_init() {
    echo -e "${_LIB_BLUE}=========================================${_LIB_NC}"
    echo -e "${_LIB_BLUE} type-any-language · cms init${_LIB_NC}"
    echo -e "${_LIB_BLUE}=========================================${_LIB_NC}"
    echo ""

    if file_exists "$TARGET"; then
        ok "$TARGET 已存在（跳过）"
        info "  → 想重新生成请先 rm $TARGET"
        info "  → 想改某一项请用: ./scripts/ops/db/env.sh update KEY=VALUE"
        return 0
    fi

    if ! file_exists "$TEMPLATE"; then
        err "$TEMPLATE 缺失 — 无法引导 $TARGET"
        exit 1
    fi

    # Copy template — secrets + AI provider/model need to be filled.
    # DATABASE_URL is NOT in .env.db (assembled at runtime from POSTGRES_PASSWORD
    # + code defaults). AUDIO_DIR is also NOT in .env.db (code default
    # /var/lib/type-any-language/audio). All other knobs (POSTGRES_USER,
    # POSTGRES_DB, DB_IMAGE, DEFAULT_BUCKET_TARGET_SIZE) also have code-level
    # defaults.
    cp "$TEMPLATE" "$TARGET"
    ok "已从 $TEMPLATE 复制为 $TARGET"

    echo ""
    warn "以下项必须你手动填 (env.sh 不会自动 inject):"
    echo "  - AI_API_KEY         (OpenAI / 提供方密钥)"
    echo "  - AI_BASE_URL        (默认 https://api.openai.com/v1; 改 Azure/本地时换)"
    echo "  - AI_MODEL           (默认 gpt-3.5-turbo; 按需换 gpt-4o / claude-... 等)"
    echo "  - TENCENT_SECRET_ID  (腾讯云 TTS — 三件套 all-or-nothing, 不跑 audio 可不填)"
    echo "  - TENCENT_SECRET_KEY"
    echo "  - TENCENT_APP_ID"
    echo ""
    info "DB password 来源 (DATABASE_URL 是运行时拼出来的):"
    echo "  1. export POSTGRES_PASSWORD=...               # 临时"
    echo "  2. cp dev-host:.secrets/postgres_password \\"
    echo "       .secrets/postgres_password              # 多机部署"
    echo "  3. 单机部署: .secrets/postgres_password 已经在 dev host 存在"
    echo ""
    info "AUDIO_DIR 默认是 /var/lib/type-any-language/audio"
    info "  → Windows / 无 sudo 的系统: export AUDIO_DIR=/your/path"
    echo ""
    info "填好后跑: ./scripts/ops/db/env.sh doctor 验证"
    info "或者用: ./scripts/ops/db/env.sh update KEY=VALUE 改某一项"
    echo ""
    echo "下一步:"
    echo -e "  ${_LIB_BLUE}nano $TARGET${_LIB_NC}   # 填上面那几项"
    echo -e "  ${_LIB_BLUE}./scripts/ops/db/env.sh doctor${_LIB_NC}"
}

# ---------------------------------------------------------------------------
# cmd_update — change one or more keys; leave others untouched
# ---------------------------------------------------------------------------
cmd_update() {
    if ! file_exists "$TARGET"; then
        err "$TARGET 不存在 — 先跑 ./scripts/ops/db/env.sh 引导"
        exit 1
    fi

    cp "$TARGET" "$TARGET.bak"

    local changed=0
    local skipped=0

    if [ $# -gt 0 ]; then
        # Non-interactive: update KEY=VALUE pairs
        for kv in "$@"; do
            if [[ "$kv" != *=* ]]; then
                err "update 参数格式错误: $kv  (期望 KEY=VALUE)"
                rm -f "$TARGET.bak"
                exit 1
            fi
            local key="${kv%%=*}"
            local value="${kv#*=}"
            # Three cases, in order of preference:
            #   1. Active line `^KEY=`  → replace in place
            #   2. Commented line `^# KEY=` → uncomment + set (common for
            #      DOCKER_REGISTRY which starts commented in the template)
            #   3. Not present at all → warn and skip
            if grep -qE "^${key}=" "$TARGET"; then
                sed_inplace "s|^${key}=.*|${key}=${value}|" "$TARGET"
                ok "  $key = $value"
                changed=$((changed + 1))
            elif grep -qE "^#[[:space:]]*${key}=" "$TARGET"; then
                sed_inplace "s|^#[[:space:]]*${key}=.*|${key}=${value}|" "$TARGET"
                ok "  $key = $value  (从注释行启用)"
                changed=$((changed + 1))
            else
                warn "  $key 不在 $TARGET 里 — 跳过"
                skipped=$((skipped + 1))
            fi
        done
    else
        # Interactive: list all current key=value pairs and let user pick
        echo ".env.db 当前内容:"
        echo ""
        local n=1
        local keys=()
        while IFS='=' read -r k v; do
            # Skip blank lines and comments
            [ -z "$k" ] && continue
            [[ "$k" =~ ^# ]] && continue
            keys+=("$k")
            local masked
            masked="$(mask_value "$k" "$v")"
            printf "  [%2d] %-30s = %s\n" "$n" "$k" "$masked"
            n=$((n + 1))
        done < "$TARGET"
        echo ""
        read -p "要改第几个 (q 退出): " idx
        if [ "$idx" = "q" ] || [ -z "$idx" ]; then
            rm -f "$TARGET.bak"
            return 0
        fi
        if ! [[ "$idx" =~ ^[0-9]+$ ]] || [ "$idx" -lt 1 ] || [ "$idx" -gt ${#keys[@]} ]; then
            err "无效的编号"
            rm -f "$TARGET.bak"
            exit 1
        fi
        local key="${keys[$((idx - 1))]}"
        read -p "新值: " value
        if [ -z "$value" ]; then
            err "值不能为空"
            rm -f "$TARGET.bak"
            exit 1
        fi
        sed_inplace "s|^${key}=.*|${key}=${value}|" "$TARGET"
        ok "  $key = $value"
        changed=1
    fi

    rm -f "$TARGET.bak"
    echo ""
    if [ "$changed" -gt 0 ]; then
        ok "已更新 $changed 项"
        info "  跑 ./scripts/ops/db/env.sh doctor 验证"
    fi
    if [ "$skipped" -gt 0 ]; then
        warn "跳过 $skipped 项 (key 不存在)"
    fi
}

# ---------------------------------------------------------------------------
# cmd_show — print .env.db with secrets masked
# ---------------------------------------------------------------------------
cmd_show() {
    if ! file_exists "$TARGET"; then
        err "$TARGET 不存在 — 先跑 ./scripts/ops/db/env.sh 引导"
        exit 1
    fi
    echo "=== $TARGET ==="
    # Iterate line-by-line, preserving formatting. Skip the masking path
    # for comment / blank lines so they print verbatim (no stray "=").
    while IFS= read -r line; do
        # Blank line: print as-is
        if [ -z "$line" ]; then
            echo ""
            continue
        fi
        # Comment line: print as-is
        if [[ "$line" =~ ^[[:space:]]*# ]]; then
            echo "$line"
            continue
        fi
        # KEY=VALUE line: split on the FIRST '=' only.
        local key="${line%%=*}"
        local value="${line#*=}"
        local masked
        masked="$(mask_value "$key" "$value")"
        printf "%-32s = %s\n" "$key" "$masked"
    done < "$TARGET"
}

# ---------------------------------------------------------------------------
# cmd_doctor — validate .env.db is ready for content.sh
# ---------------------------------------------------------------------------
cmd_doctor() {
    local failed=0
    if ! file_exists "$TARGET"; then
        err "$TARGET 不存在 — 先跑 ./scripts/ops/db/env.sh 引导"
        return 1
    fi

    echo "=== CMS .env.db health check ==="
    echo ""

    # Source .env.db in a subshell to read values without polluting our env.
    local missing=()
    local empty=()
    for k in "${REQUIRED_KEYS[@]}"; do
        local v
        v="$(grep -E "^${k}=" "$TARGET" | head -1 | cut -d= -f2-)"
        if [ -z "$v" ]; then
            empty+=("$k")
        fi
    done
    if [ ${#empty[@]} -gt 0 ]; then
        err "以下 key 未设或为空:"
        for k in "${empty[@]}"; do
            echo "  - $k"
        done
        echo ""
        info "  填法: ./scripts/ops/db/env.sh update KEY=VALUE"
        info "  或:   nano $TARGET"
        failed=1
    else
        ok "所有 REQUIRED key 都有值"
    fi

    # --- Format checks ---
    local ai_key
    ai_key="$(grep -E "^AI_API_KEY=" "$TARGET" | head -1 | cut -d= -f2-)"
    if [ -n "$ai_key" ] && [[ "$ai_key" == sk-* ]]; then
        ok "AI_API_KEY 格式看起来对 (sk- 开头)"
    elif [ -n "$ai_key" ]; then
        warn "AI_API_KEY 不以 'sk-' 开头 — 你确定这是真的 OpenAI key？"
    fi

    local tid sid
    tid="$(grep -E "^TENCENT_SECRET_ID=" "$TARGET" | head -1 | cut -d= -f2-)"
    sid="$(grep -E "^TENCENT_SECRET_KEY=" "$TARGET" | head -1 | cut -d= -f2-)"
    local tapp
    tapp="$(grep -E "^TENCENT_APP_ID=" "$TARGET" | head -1 | cut -d= -f2-)"
    local tcount=0
    [ -n "$tid" ] && [ "$tid" != "0" ] && tcount=$((tcount + 1))
    [ -n "$sid" ] && tcount=$((tcount + 1))
    [ -n "$tapp" ] && [ "$tapp" != "0" ] && tcount=$((tcount + 1))
    if [ "$tcount" -eq 0 ]; then
        warn "TENCENT_* 都没填 — audio 子命令会失败，但 sentences 仍可工作"
    elif [ "$tcount" -eq 3 ]; then
        ok "TENCENT_* 三件套齐全"
    else
        err "TENCENT_* 部分设置 (${tcount}/3) — 必须 all-or-nothing"
        failed=1
    fi

    # --- Bake-time identity hint ---
    # POSTGRES_USER/POSTGRES_DB are no longer in .env.db — they have code
    # defaults (bake_image.sh: ${POSTGRES_USER:-english_user} etc). If the
    # operator DID set them in .env.db for one-off use, surface them so they
    # can sanity-check what's going to be baked into the image label.
    local pu pd
    pu="$(grep -E "^POSTGRES_USER=" "$TARGET" | head -1 | cut -d= -f2-)"
    pd="$(grep -E "^POSTGRES_DB=" "$TARGET" | head -1 | cut -d= -f2-)"
    if [ -n "$pu" ] && [ -n "$pd" ]; then
        info "POSTGRES_USER=$pu / POSTGRES_DB=$pd  (来自 .env.db, 将烤入 image label)"
        info "  (默认在 bake_image.sh 里: english_user / english_learning — 留空走默认)"
    else
        ok "POSTGRES_USER / POSTGRES_DB 走 bake_image.sh 默认 (english_user / english_learning)"
    fi

    # --- DB password source ---
    # DATABASE_URL is assembled at runtime; the only thing the operator
    # needs to provide is POSTGRES_PASSWORD. Check that at least one of
    # the supported sources will work.
    if [ -n "${POSTGRES_PASSWORD:-}" ]; then
        ok "POSTGRES_PASSWORD 来自 shell env"
    elif [ -f .secrets/postgres_password ]; then
        ok "POSTGRES_PASSWORD 来自 .secrets/postgres_password"
    else
        err "POSTGRES_PASSWORD 找不到 — 设一下:"
        info "  export POSTGRES_PASSWORD=...                       # 临时"
        info "  mkdir -p .secrets && cp <dev-host>:.secrets/postgres_password .secrets/"
        failed=1
    fi

    # --- AUDIO_DIR ---
    # Not in .env.db anymore — code default is /var/lib/type-any-language/audio.
    # Show the resolved value so the operator can sanity-check.
    local _audio_dir="${AUDIO_DIR:-/var/lib/type-any-language/audio}"
    if [ -d "$_audio_dir" ]; then
        ok "AUDIO_DIR=$_audio_dir  (目录存在)"
    else
        info "AUDIO_DIR=$_audio_dir  (目录不存在, 但 content.sh audio 会 mkdir -p)"
    fi

    echo ""
    if [ "$failed" -eq 0 ]; then
        ok "所有必需检查通过"
        return 0
    else
        err "部分必需检查未通过"
        return 1
    fi
}

usage() {
    cat <<EOF
用法: ./scripts/ops/db/env.sh <command> [args]

命令:
  (无参数)     init      首次创建 .env.db + 注入 smart defaults (idempotent: 已存在则跳过)
  update       update    改一项或多项 (保持其他不变)。无参数走交互, 带 KEY=VALUE 走 CI 模式
  show         show      显示 .env.db 当前内容, secret 已脱敏
  doctor       doctor    验证 .env.db 完整性 + 格式
  -h | help              显示本帮助

"记住上次" 语义:
  - init  不会覆盖已存在的 .env.db (一首次创建, 后续保持)
  - update 只改你指定的 key, 其他保持不变
  - show / doctor 纯只读

典型工作流:
  ./scripts/ops/db/env.sh            # 首次: 引导 + smart defaults
  nano .env.db                    # 填 secrets + AI 配置 (AI_API_KEY / AI_BASE_URL / AI_MODEL / TENCENT_*)
  # 准备 db password (单选):
  export POSTGRES_PASSWORD=...                   # 临时
  # OR:
  scp user@dev-host:.secrets/postgres_password .secrets/   # 持久
  ./scripts/ops/db/env.sh doctor     # 验证
  ./scripts/ops/db/env.sh update AI_API_KEY=...  # 改某一项
  ./scripts/ops/db/env.sh show       # 看一眼当前配置 (secret 脱敏)

其他配置 (POSTGRES_USER, POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, DB_IMAGE,
AUDIO_DIR, DEFAULT_BUCKET_TARGET_SIZE) 不在 .env.db — 代码里有默认, 需要时 shell 覆盖:
  POSTGRES_USER=foo ./scripts/ops/db/bake_image.sh
  AUDIO_DIR=/my/audio/dir ./scripts/ops/db/content.sh audio
  DEFAULT_BUCKET_TARGET_SIZE=500 ./scripts/ops/db/content.sh sentences
EOF
}

case "${1:-}" in
    ""|init)    cmd_init ;;
    update)     shift; cmd_update "$@" ;;
    show)       cmd_show ;;
    doctor)     cmd_doctor ;;
    -h|--help|help) usage ;;
    *) err "未知命令: $1"; usage; exit 1 ;;
esac
