"""GlowCard → BorderGlow (4 处用法 + import 修正)"""
import re

replacements = [
    (
        'frontend/src/app/(auth)/_components/ImmersiveAuth.tsx',
        re.compile(
            r'<GlowCard\s+className=\{styles\.glow\}\s+glowSize=\{360\}>',
            re.DOTALL,
        ),
        '<BorderGlow className={styles.glow} glowRadius={40} glowColor="143, 203, 240" glowIntensity={1.0}>',
    ),
    (
        'frontend/src/app/dashboard/page.tsx',
        re.compile(
            r'<GlowCard\s+glowSize=\{280\}\s+glowColor="143, 203, 240"\s+className=\{styles\.cardsGridGlow\}\s*>',
            re.DOTALL,
        ),
        '<BorderGlow glowRadius={40} glowColor="143, 203, 240" glowIntensity={1.0} className={styles.cardsGridGlow}>',
    ),
    (
        'frontend/src/app/landing/HowItWorks.tsx',
        re.compile(
            r'<GlowCard\s+glowSize=\{260\}\s+glowColor="143, 203, 240"\s+className=\{styles\.cardGlowWrap\}\s*>',
            re.DOTALL,
        ),
        '<BorderGlow glowRadius={36} glowColor="143, 203, 240" glowIntensity={1.0} className={styles.cardGlowWrap}>',
    ),
    (
        'frontend/src/app/TranslationStage.tsx',
        re.compile(
            r'<GlowCard\s+className=\{styles\.wordCardShell\}\s+glowSize=\{200\}\s+glowColor="143, 203, 240">',
            re.DOTALL,
        ),
        '<BorderGlow className={styles.wordCardShell} glowRadius={32} glowColor="143, 203, 240" glowIntensity={1.0}>',
    ),
]

for path, pattern, new_str in replacements:
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    new_content, n = pattern.subn(new_str, content, count=1)
    print(f'{path}: replaced {n}')
    if n == 0:
        print('  WARNING: pattern not matched')
        continue
    content = new_content
    # 同时改 import + 闭合标签
    content = content.replace('GlowCard,', 'BorderGlow,')
    content = content.replace('GlowCard }', 'BorderGlow }')
    content = content.replace('GlowCard}', 'BorderGlow}')  # 紧贴
    content = content.replace('import { BorderGlow }', 'import { BorderGlow }')  # noop
    content = content.replace('</GlowCard>', '</BorderGlow>')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)