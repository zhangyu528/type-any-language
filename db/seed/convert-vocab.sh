#!/usr/bin/env bash
#
# 词库 TXT → CSV 转换脚本
# 将下载的词库 txt 文件转换为 seed_vocabulary.py 可用的 CSV 格式
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VOCAB_DIR="$PROJECT_DIR/seed/vocabulary"

echo "=========================================="
echo "词库 TXT → CSV 转换"
echo "=========================================="
echo ""

convert_file() {
    local txt=$1
    local csv=$2
    local tmp=$VOCAB_DIR/.convert_tmp

    if [ ! -f "$txt" ]; then
        echo "[SKIP] $txt 不存在"
        return 1
    fi

    # Check if it's a 404 error file
    if grep -q "404" "$txt" 2>/dev/null || [ $(wc -c < "$txt") -lt 100 ]; then
        echo "[SKIP] $txt 下载失败，跳过"
        return 1
    fi

    local count=0
    > "$csv"

    # Write CSV header
    echo "word,phonetic,translation,part_of_speech" > "$csv"

    while IFS= read -r line || [ -n "$line" ]; do
        line=$(echo "$line" | tr -d '\r')

        # Split by tab
        word=$(echo "$line" | cut -f1 | tr '[:upper:]' '[:lower:]')
        rest=$(echo "$line" | cut -f2-)

        if [ -z "$word" ] || [ "$word" = "$line" ]; then
            continue
        fi

        # Extract POS (e.g., n., v., adj., adv., num., pron., prep., conj., interj.)
        pos=$(echo "$rest" | grep -oE '[a-z]+\.' | head -1 | sed 's/\.//')
        [ -z "$pos" ] && pos=""

        # Clean translation - remove POS from beginning
        trans=$(echo "$rest" | sed 's/^[a-z]*\.[[:space:]]*//' | sed 's/，/；/g' | sed 's/,/；/g' | sed 's/"/""/g')

        echo "\"$word\",\"\",\"$trans\",\"$pos\"" >> "$csv"
        count=$((count + 1))
    done < "$txt"

    echo "[OK] $txt → $csv ($count 词汇)"
}

echo "--- 转换词库文件 ---"
convert_file "$VOCAB_DIR/beginner.txt" "$VOCAB_DIR/beginner.csv"
convert_file "$VOCAB_DIR/cet4.txt" "$VOCAB_DIR/cet4.csv"
convert_file "$VOCAB_DIR/cet6.txt" "$VOCAB_DIR/cet6.csv"
convert_file "$VOCAB_DIR/ielts.txt" "$VOCAB_DIR/ielts.csv"

echo ""
echo "=========================================="
echo "转换完成"
echo "=========================================="