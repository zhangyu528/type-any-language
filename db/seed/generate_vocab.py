#!/usr/bin/env python3
"""
词库 CSV 生成脚本
基于 Zipf 词频指数生成不同难度的词库

使用方法:
    pip install wordfreq
    python scripts/generate_vocab.py
"""

import os
import csv
from wordfreq import wordlist, zipf_frequency

# 词库等级配置
LEVELS = {
    'beginner': {
        'name': '初中基础词汇',
        'min_zipf': 6.5,
        'max_zipf': 8.5,
        'max_words': 1500
    },
    'cet4': {
        'name': '大学英语四级',
        'min_zipf': 5.0,
        'max_zipf': 7.0,
        'max_words': 2500
    },
    'cet6': {
        'name': '大学英语六级',
        'min_zipf': 4.0,
        'max_zipf': 5.5,
        'max_words': 2500
    },
    'ielts': {
        'name': '雅思进阶词汇',
        'min_zipf': 3.0,
        'max_zipf': 4.5,
        'max_words': 3000
    }
}


def generate_vocab_csv(level: str, config: dict):
    """生成单个词库 CSV"""
    min_zipf = config['min_zipf']
    max_zipf = config['max_zipf']
    max_words = config['max_words']

    words = []

    # 遍历高频词汇表
    for word in wordlist('en', wordlist='best20000'):
        freq = zipf_frequency(word, 'en')

        if min_zipf <= freq <= max_zipf:
            # 只保留纯字母单词
            if word.isalpha() and len(word) >= 2:
                words.append((word, '', '', ''))

        if len(words) >= max_words:
            break

    # 保存 CSV
    output_dir = 'seed/vocabulary'
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, f'{level}.csv')

    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['word', 'phonetic', 'translation', 'part_of_speech'])
        writer.writerows(words)

    print(f"生成 {config['name']}: {len(words)} 词汇 -> {output_path}")
    return len(words)


def main():
    print("=" * 50)
    print("词库 CSV 生成工具")
    print("=" * 50)
    print()

    total = 0
    for level, config in LEVELS.items():
        count = generate_vocab_csv(level, config)
        total += count

    print()
    print("=" * 50)
    print(f"完成! 共生成 {total} 个词汇")
    print("=" * 50)


if __name__ == '__main__':
    main()
