#!/bin/bash
#
# cms/init.sh — first-time env setup + ongoing config management for the
# CMS content-production host.
#
# Subcommands:
#   (no args)  init      Create .env.cms from template + inject smart defaults.
#                        Idempotent: skips if .env.cms exists.
#   update     update    Update one or more KEY=VALUE pairs in .env.cms.
#                        Other keys are untouched ("remember last" semantics).
#                        Without args: interactive prompt. With args: non-interactive.
#   show       show      Print .env.cms contents with sensitive values masked.
#   doctor     doctor    Validate .env.cms completeness + format checks.
#                        Non-zero exit if any REQUIRED key is missing/invalid.
#   -h | help             Show usage.
#
# "Remember last" semantics:
#   - `init` only runs on first creation; existing .env.cms is left alone.
#   - `update` changes only the keys you specify; everything else is preserved.
#   - `show` and `doctor` are read-only.
#
# Smart defaults injected on first init:
#   - POSTGRES_USER, POSTGRES_DB    = english_user / english_learning
#     (these MUST match the db image label baked by bake_image.sh)
#   - DB_IMAGE_TAG                   = v0.0.1
#   - DOCKER_REGISTRY                = docker.io/$USER  (or "" if USER=root)
#   - AI_BASE_URL, AI_MODEL, AUDIO_DIR, DEFAULT_BUCKET_TARGET_SIZE
#                                   = kept from template
#
# Smart defaults NOT injected (require user-supplied secrets):
#   - DATABASE_URL                   (host-side, needs the password)
#   - AI_API_KEY                     (provider-issued)
#   - TENCENT_SECRET_ID/KEY/APP_ID   (provider-issued)
#
# Requires: shell + filesystem. NO python, NO docker.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"

TEMPLATE=".env.example.cms"
TARGET=".env.cms"

# Keys whose values contain a secret and must be masked in `show`.
# (Used by cmd_show; kept here for documentation and to make it easy
# to extend if more secrets land in .env.cms later.)
SECRET_KEYS=(
    AI_API_KEY
    TENCENT_SECRET_ID
    TENCENT_SECRET_KEY
    DATABASE_URL
)

# Required keys for a "ready" CMS host. Used by cmd_doctor.
REQUIRED_KEYS=(
    DATABASE_URL
    POSTGRES_USER
    POSTGRES_DB
    DB_IMAGE
    DB_IMAGE_TAG
    AI_API_KEY
    AI_BASE_URL
    AI_MODEL
    AUDIO_DIR
)

# Portable sed -i (GNU vs BSD).
sed_inplace() {
    # $1 = pattern, $2 = file
    if sed --version >/dev/null 2>&1; then
        sed -i "$1" "$2"
    else
        sed -i '' "$1" "$2"
    fi
}

# Echo a value with sensitive keys masked.
mask_value() {
    local key="$1"
    local value="$2"
    for s in "${SECRET_KEYS[@]}"; do
        if [ "$key" = "$s" ]; then
            # DATABASE_URL contains user/pass@host — mask the password segment.
            if [ "$key" = "DATABASE_URL" ]; then
                echo "$value" | sed -E 's|(:[^:/@]+@)|:****@|g'
            else
                # Show first 4 + last 4 chars of the value, with **** between.
                local n=${#value}
                if [ "$n" -le 8 ]; then
                    echo "****"
                else
                    echo "${value:0:4}****${value: -4}"
                fi
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
        info "  → 想改某一项请用: ./scripts/cms/init.sh update KEY=VALUE"
        return 0
    fi

    if ! file_exists "$TEMPLATE"; then
        err "$TEMPLATE 缺失 — 无法引导 $TARGET"
        exit 1
    fi

    # Step 1: copy template
    cp "$TEMPLATE" "$TARGET"
    ok "已从 $TEMPLATE 复制为 $TARGET"

    # Step 2: inject smart defaults
    #   POSTGRES_USER, POSTGRES_DB, DB_IMAGE_TAG → hard-coded "sane" defaults
    #   DOCKER_REGISTRY                             → detect_default_registry()
    #   AI_BASE_URL, AI_MODEL, AUDIO_DIR,
    #   DEFAULT_BUCKET_TARGET_SIZE                  → keep template value
    #   DATABASE_URL, AI_API_KEY, TENCENT_*         → leave as template placeholders,
    #                                                 user must fill
    cp "$TARGET" "$TARGET.bak"

    SMART_REGISTRY="${DOCKER_REGISTRY:-$(detect_default_registry)}"

    # Uncomment + fill DOCKER_REGISTRY
    if [ -n "$SMART_REGISTRY" ]; then
        sed_inplace "s|^# DOCKER_REGISTRY=$|DOCKER_REGISTRY=${SMART_REGISTRY}|" "$TARGET"
    else
        sed_inplace "s|^# DOCKER_REGISTRY=.*|# DOCKER_REGISTRY=|" "$TARGET"
    fi

    # POSTGRES_USER / POSTGRES_DB / DB_IMAGE / DB_IMAGE_TAG are already in
    # the template with sensible defaults; the user can update via `update`
    # if they want to change them.

    rm -f "$TARGET.bak"

    echo ""
    ok "已注入 smart defaults（请检查/按需修改）:"
    echo ""
    # Show all the "bake-time" + "config" keys (NOT the secrets).
    grep -E "^(POSTGRES_USER|POSTGRES_DB|DB_IMAGE|DB_IMAGE_TAG|DOCKER_REGISTRY|AI_BASE_URL|AI_MODEL|AUDIO_DIR|DEFAULT_BUCKET_TARGET_SIZE)=" \
        "$TARGET" | sed 's/^/  /'
    echo ""
    warn "以下 secret 必须你手动填 (init.sh 不会自动 inject):"
    echo "  - DATABASE_URL       (你的 host-side db password)"
    echo "  - AI_API_KEY         (OpenAI / 提供方密钥)"
    echo "  - TENCENT_SECRET_ID  (腾讯云 TTS — 三件套 all-or-nothing)"
    echo "  - TENCENT_SECRET_KEY"
    echo "  - TENCENT_APP_ID"
    echo ""
    info "填好后跑: ./scripts/cms/init.sh doctor 验证"
    info "或者用: ./scripts/cms/init.sh update KEY=VALUE 改某一项"
    echo ""
    echo "下一步:"
    echo -e "  ${_LIB_BLUE}nano $TARGET${_LIB_NC}   # 填上面那 5 个 secret"
    echo -e "  ${_LIB_BLUE}./scripts/cms/init.sh doctor${_LIB_NC}"
}

# ---------------------------------------------------------------------------
# cmd_update — change one or more keys; leave others untouched
# ---------------------------------------------------------------------------
cmd_update() {
    if ! file_exists "$TARGET"; then
        err "$TARGET 不存在 — 先跑 ./scripts/cms/init.sh 引导"
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
            # Only update if the key is actually present in .env.cms.
            if grep -qE "^${key}=" "$TARGET"; then
                sed_inplace "s|^${key}=.*|${key}=${value}|" "$TARGET"
                ok "  $key = $value"
                changed=$((changed + 1))
            else
                warn "  $key 不在 $TARGET 里 — 跳过"
                skipped=$((skipped + 1))
            fi
        done
    else
        # Interactive: list all current key=value pairs and let user pick
        echo ".env.cms 当前内容:"
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
        info "  跑 ./scripts/cms/init.sh doctor 验证"
    fi
    if [ "$skipped" -gt 0 ]; then
        warn "跳过 $skipped 项 (key 不存在)"
    fi
}

# ---------------------------------------------------------------------------
# cmd_show — print .env.cms with secrets masked
# ---------------------------------------------------------------------------
cmd_show() {
    if ! file_exists "$TARGET"; then
        err "$TARGET 不存在 — 先跑 ./scripts/cms/init.sh 引导"
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
# cmd_doctor — validate .env.cms is ready for content.sh
# ---------------------------------------------------------------------------
cmd_doctor() {
    local failed=0
    if ! file_exists "$TARGET"; then
        err "$TARGET 不存在 — 先跑 ./scripts/cms/init.sh 引导"
        return 1
    fi

    echo "=== CMS .env.cms health check ==="
    echo ""

    # Source .env.cms in a subshell to read values without polluting our env.
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
        info "  填法: ./scripts/cms/init.sh update KEY=VALUE"
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

    # --- Bake-time consistency (POSTGRES_USER/DB must align with the
    #     image-label convention) ---
    local pu pd
    pu="$(grep -E "^POSTGRES_USER=" "$TARGET" | head -1 | cut -d= -f2-)"
    pd="$(grep -E "^POSTGRES_DB=" "$TARGET" | head -1 | cut -d= -f2-)"
    if [ -n "$pu" ] && [ -n "$pd" ]; then
        ok "POSTGRES_USER=$pu / POSTGRES_DB=$pd  (将烤入 image label)"
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
用法: ./scripts/cms/init.sh <command> [args]

命令:
  (无参数)     init      首次创建 .env.cms + 注入 smart defaults (idempotent: 已存在则跳过)
  update       update    改一项或多项 (保持其他不变)。无参数走交互, 带 KEY=VALUE 走 CI 模式
  show         show      显示 .env.cms 当前内容, secret 已脱敏
  doctor       doctor    验证 .env.cms 完整性 + 格式
  -h | help              显示本帮助

"记住上次" 语义:
  - init  不会覆盖已存在的 .env.cms (一首次创建, 后续保持)
  - update 只改你指定的 key, 其他保持不变
  - show / doctor 纯只读

典型工作流:
  ./scripts/cms/init.sh            # 首次: 引导 + smart defaults
  nano .env.cms                    # 填 5 个 secret (DATABASE_URL / AI_API_KEY / TENCENT_*)
  ./scripts/cms/init.sh doctor     # 验证
  ./scripts/cms/init.sh update DOCKER_REGISTRY=ghcr.io/myorg  # 改某一项
  ./scripts/cms/init.sh show       # 看一眼当前配置 (secret 脱敏)
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
