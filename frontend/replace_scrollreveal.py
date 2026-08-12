"""ScrollReveal → AnimatedContent.
- y → distance (默认方向 vertical)
- delay (ms) → delay (秒)
- className 透传
- 闭合标签 </ScrollReveal> → </AnimatedContent>
- import 改 AnimatedContent
"""
import re

files = [
    'frontend/src/app/dashboard/page.tsx',
    'frontend/src/app/landing/DataBento.tsx',
    'frontend/src/app/landing/FinalCTA.tsx',
    'frontend/src/app/landing/Hero.tsx',
    'frontend/src/app/landing/HowItWorks.tsx',
    'frontend/src/app/landing/index.tsx',
    'frontend/src/app/landing/LibStrip.tsx',
    'frontend/src/app/landing/ScenariosSection.tsx',
]

for path in files:
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    orig = content

    # <ScrollReveal y={20} delay={0} className={styles.x}>
    # → <AnimatedContent distance={20} delay={0} direction="vertical" className={styles.x}>
    content = re.sub(
        r'<ScrollReveal\s+y=\{(\d+)\}\s+delay=\{(\d+)\}\s+className=\{([^}]+)\}>',
        r'<AnimatedContent distance={\1} delay={\2 / 1000} direction="vertical" className={\3}>',
        content,
    )
    # <ScrollReveal y={20} className={styles.x}>
    content = re.sub(
        r'<ScrollReveal\s+y=\{(\d+)\}\s+className=\{([^}]+)\}>',
        r'<AnimatedContent distance={\1} direction="vertical" className={\2}>',
        content,
    )
    # </ScrollReveal> → </AnimatedContent>
    content = content.replace('</ScrollReveal>', '</AnimatedContent>')
    # import
    content = re.sub(
        r'\bScrollReveal\b',
        'AnimatedContent',
        content,
    )
    # animation from {gsap} import — not relevant, only motion is used here

    if content != orig:
        diff_count = sum(1 for _ in re.finditer(r'<AnimatedContent', content)) - sum(1 for _ in re.finditer(r'<AnimatedContent', orig))
        # 净变化计数不靠谱,直接算 ScrollReveal 减少了几个
        sr_before = orig.count('ScrollReveal')
        sr_after = content.count('ScrollReveal')
        print(f'{path}: ScrollReveal {sr_before} -> {sr_after}')
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)