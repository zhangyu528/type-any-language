#!/usr/bin/env bash
#
# py-run.sh — 单点设置 PYTHONPATH/PYTHONIOENCODING,exec python3 "$@"。
#
# 让所有 cmd_*.sh 不必各自 export 这一对环境变量。
# 用法:
#   "$SCRIPT_DIR/py-run.sh" cms_pipeline.import_vocab --lib ielts
#   "$SCRIPT_DIR/py-run.sh" cms_pipeline.generate_sentences ...
#
# PYTHONPATH 必须包含 cms/ 和 db/ — 数据管线在 cms/cms_pipeline/,
# schema / migrations 在 db/dbtools/,两份 package 共存。
#
# PYTHONIOENCODING=utf-8 防止 Windows 控制台 GBK 解码 Unicode 符号
# (✓ / ✗ / box-drawing) 崩溃。Linux / macOS 上是 no-op。

set -e

# 找到仓库根 (此文件在 cms/scripts/py-run.sh → 上两级)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Use git rev-parse, NOT `cd "$SCRIPT_DIR/../.."` — the latter breaks
# under Git Bash on Windows because the `..` resolution eats a
# hyphenated path segment (e.g. `type-any-language` resolves as one
# level up instead of two). Same fix as cms/run.sh + staging.sh.
PROJECT_DIR="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"

# cms + db package 都要能 import
export PYTHONPATH="${PROJECT_DIR}/cms:${PROJECT_DIR}/db${PYTHONPATH:+:$PYTHONPATH}"
export PYTHONIOENCODING="${PYTHONIOENCODING:-utf-8}"

exec python3 "$@"
