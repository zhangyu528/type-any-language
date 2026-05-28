#!/usr/bin/env python3
"""
Convert tab-separated vocab TXT files to CSV for seed_vocabulary.py
Input:  word\tpos. meaning pos. meaning
Output: word,phonetic,translation,part_of_speech
"""

import csv
import re
import os

def parse_line(line):
    """Parse a line like 'boat\tn. 小船；轮船 v. 划船' into word, phonetic, translation, pos"""
    parts = line.strip().split('\t')
    if len(parts) < 2:
        return None

    word = parts[0].strip().lower()
    rest = parts[1].strip()

    # Extract POS and translation from patterns like "n. 小船；轮船"
    # POS patterns: n., v., adj., adv., num., pron., prep., conj., interj., etc.
    pos_pattern = re.compile(r'^([a-z]+)\.\s*(.*)')

    translation_parts = []
    pos_parts = []

    # Split by common separators like "；" or "，" to handle multiple meanings
    segments = re.split(r'[；,，]', rest)

    for seg in segments:
        seg = seg.strip()
        if not seg:
            continue
        match = pos_pattern.match(seg)
        if match:
            pos = match.group(1)
            meaning = match.group(2).strip()
            if meaning:
                translation_parts.append(meaning)
                if pos not in pos_parts:
                    pos_parts.append(pos)
        else:
            # No POS prefix, just translation
            translation_parts.append(seg)

    phonetic = ''
    translation = '；'.join(translation_parts) if translation_parts else ''
    part_of_speech = ','.join(pos_parts) if pos_parts else ''

    return (word, phonetic, translation, part_of_speech)


def convert_file(input_path, output_path):
    """Convert a txt file to csv"""
    count = 0
    with open(input_path, 'r', encoding='utf-8') as fin, \
         open(output_path, 'w', newline='', encoding='utf-8') as fout:

        writer = csv.writer(fout)
        writer.writerow(['word', 'phonetic', 'translation', 'part_of_speech'])

        for line in fin:
            line = line.strip()
            if not line:
                continue

            result = parse_line(line)
            if result:
                writer.writerow(result)
                count += 1

    return count


def main():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    vocab_dir = os.path.join(base_dir, 'seed', 'vocabulary')

    # Map txt files to csv files
    files = {
        'beginner.txt': 'beginner.csv',
        'cet4.txt': 'cet4.csv',
        'cet6.txt': 'cet6.csv',
        'ielts.txt': 'ielts.csv',
    }

    print("=" * 50)
    print("词库 TXT → CSV 转换工具")
    print("=" * 50)
    print()

    for txt_name, csv_name in files.items():
        txt_path = os.path.join(vocab_dir, txt_name)
        csv_path = os.path.join(vocab_dir, csv_name)

        if not os.path.exists(txt_path):
            print(f"[SKIP] {txt_name} 不存在，跳过")
            continue

        # Check if it's actually a 404 error file
        with open(txt_path, 'r', encoding='utf-8') as f:
            first_bytes = f.read(20)
        if '404' in first_bytes or len(open(txt_path, 'r', encoding='utf-8').read()) < 100:
            print(f"[SKIP] {txt_name} 下载失败，跳过")
            continue

        try:
            count = convert_file(txt_path, csv_path)
            print(f"[OK] {txt_name} → {csv_name} ({count} 词汇)")
        except Exception as e:
            print(f"[FAIL] {txt_name}: {e}")

    print()
    print("=" * 50)
    print("转换完成")


if __name__ == '__main__':
    main()