#!/usr/bin/env bash
#
# cms/scripts/bootstrap.sh — one-time CMS host setup. Idempotent.
# Re-running is a no-op once everything is in place.
#
# Why this exists instead of an auto-install in run.sh:
#   1. CMS hosts are heterogeneous (Linux with system Python / macOS
#      with brewed Python / Windows with pyenv-win / CI runners with
#      externally-managed PEP 668 environments). "Just pip install"
#      is unsafe across all of them — sometimes you need --user,
#      sometimes --break-system-packages, sometimes a venv first.
#      Putting that judgement into run.sh makes the run.sh entry
#      fragile and slow.
#   2. Bootstrap is genuinely a "do once" operation, not a per-run
#      operation. The right granularity is a separate command that
#      operators run after a fresh checkout, then never again until
#      they edit cms/pyproject.toml or want to re-fetch secrets.
#   3. Secrets injection (fetch_secrets.sh eval-cms) is also a
#      "do once per shell" thing — operators do it once after
#      bootstrap, then run.sh / cmd_*.sh just reads the env. We
#      surface the eval line at the end of bootstrap so operators
#      know exactly what to run in their next shell.
#
# What this does (in order):
#   1. fetch_secrets.sh check  — gh installed / auth'd / repo matches
#      (cheap, no network on this side — the actual secret fetch
#      happens later via `eval-cms` the operator runs themselves).
#   2. pip install -e "./cms[extras]"  — base + optional Python deps
#   3. import verify           — make sure openai / PyYAML / etc. load
#   4. print the eval line      — operator pastes it into their shell
#      to inject AI_*/TENCENT_* into the current process env.
#
# Why we don't auto-eval: bootstrap.sh runs in a subshell. Any
# env vars it sets die when it exits. The right shape is: bootstrap
# prints `eval "$(...)"`, operator runs it in their interactive shell,
# secrets land in the caller's process env. run.sh / cmd_*.sh then
# see those vars naturally.
#
# What this installs (declared in cms/pyproject.toml):
#   - openai / PyYAML              (required)   — manifest + LLM
#   - tencentcloud-sdk-python      ([audio])    — TTS
#   - cos-python-sdk-v5            ([cos])      — Tencent COS storage
#
# Usage:
#   ./cms/scripts/bootstrap.sh             # full install + secrets check
#   ./cms/scripts/bootstrap.sh --no-extras # base only (vocab + sentences)
#   ./cms/scripts/bootstrap.sh --check     # verify only, don't install
#   ./cms/scripts/bootstrap.sh --skip-fetch # skip gh/auth check (offline / CI)
#   ./cms/scripts/bootstrap.sh --help
#
# Exit codes:
#   0   all required deps importable (and optional if requested) +
#       fetch_secrets.sh check passed
#   1   python missing / pip install failed / required import still
#       broken / fetch_secrets.sh check failed

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Use git rev-parse to find the project root — the naive
# `cd "$SCRIPT_DIR/../.."` breaks under Git Bash on Windows (the `..`
# resolution eats a hyphenated path segment). See cms/run.sh for the
# same fix.
PROJECT_DIR="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
CMS_DIR="$PROJECT_DIR/cms"

source "$SCRIPT_DIR/_lib_common.sh"

EXTRAS="audio,cos"
MODE="install"
SKIP_FETCH=0

usage() {
    cat <<EOF
用法: $0 [options]

选项:
  --no-extras       只装 base (openai + pyyaml)。适合只跑 vocab / sentences
                    的工作站,或本地 LocalFsStorage 不用 COS 的场景。
  --extras LIST     逗号分隔的 extras 列表 (默认: audio,cos)。例如
                    --extras audio 只装 TTS,跳过 COS 存储。
  --check           只检查 Python 环境 + fetch_secrets.sh check,
                    不安装任何东西。返回 0 = 全 OK,1 = 有问题。
  --skip-fetch      跳过 fetch_secrets.sh check 这一步。CI / 离线环境用
                    (没有 gh 或 token 不可用)。
  -h|--help         显示本帮助。

默认行为(无 flags):
  Step 1: fetch_secrets.sh check (gh / auth / repo)
  Step 2: pip install -e "./cms[audio,cos]"
  Step 3: 验证 import
  Step 4: 打印 eval 行,操作员粘贴进 shell 注 secrets

成功完成后,跑:
    eval "\$(./scripts/secrets/fetch_secrets.sh eval-cms)"
    ./cms/run.sh

(run.sh 不再自己 check secrets — 假设 bootstrap 已经做完了。)
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --no-extras)   EXTRAS=""; shift ;;
        --extras)      EXTRAS="$2"; shift 2 ;;
        --check)       MODE="check"; shift ;;
        --skip-fetch)  SKIP_FETCH=1; shift ;;
        -h|--help)     usage; exit 0 ;;
        *) err "未知选项: $1"; usage; exit 1 ;;
    esac
done

# ---------------------------------------------------------------------------
# require_python — fails fast on no python at all
# ---------------------------------------------------------------------------
require_python

# ---------------------------------------------------------------------------
# pick extra spec
# ---------------------------------------------------------------------------
PIP_TARGET="./cms"
if [ -n "$EXTRAS" ]; then
    PIP_TARGET="./cms[$EXTRAS]"
fi

info "bootstrap 目标: pip install -e \"$PIP_TARGET\""
echo ""

# ---------------------------------------------------------------------------
# Step 1: fetch_secrets.sh check (gh / auth / repo)
# Skippable via --skip-fetch for CI / offline envs.
# ---------------------------------------------------------------------------
if [ "$SKIP_FETCH" = "0" ]; then
    info "Step 1/4: fetch_secrets.sh check (gh / auth / repo)"
    if ! ./scripts/secrets/fetch_secrets.sh check; then
        err "fetch_secrets.sh check 失败 — 上面已经打了原因"
        err "  → gh 没装:https://cli.github.com"
        err "  → 没登录:gh auth login (需要 actions:read scope)"
        err "  → 错的 repo:在仓库根跑此脚本"
        err ""
        err "  CI / 离线环境:加 --skip-fetch 跳过此步"
        exit 1
    fi
    ok "  fetch_secrets.sh check 通过"
    echo ""
else
    info "Step 1/4: fetch_secrets.sh check (skipped via --skip-fetch)"
    echo ""
fi

# ---------------------------------------------------------------------------
# Step 2: pip install
# ---------------------------------------------------------------------------
if [ "$MODE" = "install" ]; then
    STEP_NUM=2
    info "Step $STEP_NUM/4: pip install -e \"$PIP_TARGET\""
    (
        cd "$PROJECT_DIR"
        if ! python3 -m pip install -e "$PIP_TARGET"; then
            err "pip install 失败"
            err "  常见原因 + 解法:"
            err "  - 系统 Python (PEP 668 externally-managed): 建 venv 后再跑"
            err "      python3 -m venv .venv && source .venv/bin/activate"
            err "      ./cms/scripts/bootstrap.sh"
            err "  - 权限不足: 加 --user,或 sudo,或建 venv"
            err "  - 离线 / 内网: 用 pip download 预拉 wheel 再 pip install --no-index"
            exit 1
        fi
    )
    ok "  pip install 完成"
    echo ""
else
    STEP_NUM=2
    info "Step $STEP_NUM/4: pip install (skipped via --check)"
    echo ""
fi

# ---------------------------------------------------------------------------
# Step 3: import verify
# ---------------------------------------------------------------------------
info "Step 3/4: 验证 import"

FAILED=()
python3 -c "import openai" 2>/dev/null || FAILED+=("openai (base)")
python3 -c "import yaml"   2>/dev/null || FAILED+=("PyYAML (base)")

if [[ "$EXTRAS" == *audio* ]]; then
    python3 -c "import tencentcloud" 2>/dev/null || FAILED+=("tencentcloud-sdk-python [audio]")
fi
if [[ "$EXTRAS" == *cos* ]]; then
    python3 -c "import qcloud_cos" 2>/dev/null || FAILED+=("cos-python-sdk-v5 [cos]")
fi

if [ ${#FAILED[@]} -ne 0 ]; then
    err "  import 失败:"
    for pkg in "${FAILED[@]}"; do
        err "    - $pkg"
    done
    err ""
    err "  排查:"
    err "  - 用的是 venv?确认已 source activate"
    err "  - pip install 输出了什么?往上翻日志"
    err "  - 离线环境:pip download 在能上网的机器预拉 wheel,scp 过来"
    exit 1
fi
ok "  所有依赖 import 通过"
echo ""

# ---------------------------------------------------------------------------
# Step 4: print eval line + final report
# ---------------------------------------------------------------------------
info "Step 4/4: bootstrap 完成 — 接下来:"
echo ""

if [ "$SKIP_FETCH" = "0" ]; then
    ok "所有检查通过 — 现在可以:"
    info "  1. 在当前 shell 注入 AI_*/TENCENT_*/CLOUD_* 到 process env:"
    info "       eval \"\$(./scripts/secrets/fetch_secrets.sh eval-cms)\""
    info "  2. 跑 CMS driver:"
    info "       ./cms/run.sh"
    info ""
    info "(run.sh 不再自己 check secrets —— 它假设你已经跑过上面 eval 那一行。"
    info " 缺 AI_*/TENCENT_* 时 run.sh 会硬卡,提示你跑这个 eval。)"
else
    ok "Python deps 已就绪 (fetch_secrets.sh check 已跳过)"
    info "  CI / 离线模式:自己 export AI_*/TENCENT_*/CLOUD_*,然后跑 ./cms/run.sh"
fi
exit 0
