"""把 <AnimatedCounter> 用法替换成 shadcn Counter 用法。"""
import re

replacements = [
    (
        'frontend/src/app/dashboard/DayDetailDrawer.tsx',
        re.compile(
            r'<AnimatedCounter\s+value=\{detail\.sentences_count\}\s+duration=\{900\}\s+className=\{styles\.kpiCounter\}\s*/>',
            re.DOTALL,
        ),
        '<Counter value={detail.sentences_count} fontSize={40} className={styles.kpiCounter} />',
    ),
    (
        'frontend/src/app/dashboard/DayDetailDrawer.tsx',
        re.compile(
            r'<AnimatedCounter\s+value=\{accuracyPct\}\s+duration=\{1100\}\s+className=\{styles\.kpiCounter\}\s*/>',
            re.DOTALL,
        ),
        '<Counter value={accuracyPct} fontSize={40} className={styles.kpiCounter} />',
    ),
    (
        'frontend/src/app/dashboard/GreetingBar.tsx',
        re.compile(
            r'<AnimatedCounter\s+value=\{monthlyGoal\.current\}\s+duration=\{900\}\s+className=\{styles\.monthlyNum\}\s*/>',
            re.DOTALL,
        ),
        '<Counter value={monthlyGoal.current} fontSize={28} className={styles.monthlyNum} />',
    ),
    (
        'frontend/src/app/dashboard/ProgressSnapshot.tsx',
        re.compile(
            r'<AnimatedCounter\s+value=\{animateTo\}\s+startOnView\s+duration=\{1200\}\s+className=\{styles\.counter\}\s*/>',
            re.DOTALL,
        ),
        '<Counter value={animateTo} fontSize={48} className={styles.counter} />',
    ),
    (
        'frontend/src/app/dashboard/ProgressSnapshot.tsx',
        re.compile(
            r'<AnimatedCounter\s+value=\{Math\.round\(stat\.value\)\}\s+startOnView\s+duration=\{1100\}\s+className=\{styles\.counter\}\s*/>',
            re.DOTALL,
        ),
        '<Counter value={Math.round(stat.value)} fontSize={36} className={styles.counter} />',
    ),
    (
        'frontend/src/app/landing/DataBento.tsx',
        re.compile(
            r'<AnimatedCounter\s+value=\{d\.value\}\s+suffix=\{d\.countSuffix \?\? ""\}\s+startOnView\s*/>',
            re.DOTALL,
        ),
        '<Counter value={d.value} fontSize={56} className={styles.bigNumber} />',
    ),
    (
        'frontend/src/app/landing/Hero.tsx',
        re.compile(
            r'<AnimatedCounter\s+value=\{libCount\}\s+startOnView\s+duration=\{900\}\s*/>',
            re.DOTALL,
        ),
        '<Counter value={libCount} fontSize={18} className={styles.statNum} />',
    ),
    (
        'frontend/src/app/landing/Hero.tsx',
        re.compile(
            r'<AnimatedCounter\s+value=\{totalSentences\}\s+startOnView\s+duration=\{1400\}\s*/>',
            re.DOTALL,
        ),
        '<Counter value={totalSentences} fontSize={18} className={styles.statNum} />',
    ),
    (
        'frontend/src/app/me/StatsTab.tsx',
        re.compile(
            r'<AnimatedCounter\s+value=\{accuracyValue\}\s+startOnView\s+duration=\{1200\}\s+className=\{styles\[\'me-mb-counter\'\]\}\s*/>',
            re.DOTALL,
        ),
        "<Counter value={accuracyValue} fontSize={64} className={styles['me-mb-counter']} />",
    ),
    (
        'frontend/src/app/me/StatsTab.tsx',
        re.compile(
            r'<AnimatedCounter\s+value=\{value\}\s+startOnView\s+duration=\{1000\}\s+className=\{styles\[\'me-mb-stat__counter\'\]\}\s*/>',
            re.DOTALL,
        ),
        "<Counter value={value} fontSize={40} className={styles['me-mb-stat__counter']} />",
    ),
]

for path, pattern, new_str in replacements:
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    new_content, n = pattern.subn(new_str, content, count=1)
    print(f'{path}: replaced {n}')
    if n == 0:
        print(f'  WARNING: pattern not matched')
        continue
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_content)