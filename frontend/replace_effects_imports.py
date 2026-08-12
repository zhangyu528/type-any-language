"""把 24 文件 `from '@/components/effects'` 改为 explicit 路径。
逻辑:
- effects/index.ts 提供 18 个 shadcn re-export (名字不变)
- 调用方写法: `import { A, B } from '@/components/effects'`
- 现在改成: `import A from '@/components/A'; import B from '@/components/B';`
  (因为不同 export 来自不同 shadcn 文件,不能用一个 import 表达)
"""
import re
import pathlib

# shadcn 路径映射(name → file basename)
NAME_TO_FILE = {
    'BlurText': 'BlurText',
    'DecryptedText': 'DecryptedText',
    'SpecularButton': 'SpecularButton',
    'SpotlightCard': 'SpotlightCard',
    'Threads': 'Threads',
    'ShinyText': 'ShinyText',
    'MagicBento': 'MagicBento',
    'TiltedCard': 'TiltedCard',
    'CurvedInput': 'CurvedInput',
    'GlassSurface': 'GlassSurface',
    'Particles': 'Particles',
    'BounceCards': 'BounceCards',
    'VariableProximity': 'VariableProximity',
    'ChromaGrid': 'ChromaGrid',  # named export
    'AnimatedCounter': 'Counter',
    'AuroraBackground': 'Aurora',
    'GlowCard': 'BorderGlow',
    'ScrollReveal': 'AnimatedContent',
}

files = [
    'frontend/src/app/(auth)/layout.tsx',
    'frontend/src/app/(auth)/_components/ImmersiveAuth.tsx',
    'frontend/src/app/components/AppHeader.tsx',
    'frontend/src/app/dashboard/ContinueCard.tsx',
    'frontend/src/app/dashboard/DailyGoal.tsx',
    'frontend/src/app/dashboard/DayDetailDrawer.tsx',
    'frontend/src/app/dashboard/GreetingBar.tsx',
    'frontend/src/app/dashboard/LearnedLibProgress.tsx',
    'frontend/src/app/dashboard/page.tsx',
    'frontend/src/app/dashboard/ProgressSnapshot.tsx',
    'frontend/src/app/landing/DataBento.tsx',
    'frontend/src/app/landing/FinalCTA.tsx',
    'frontend/src/app/landing/Hero.tsx',
    'frontend/src/app/landing/HowItWorks.tsx',
    'frontend/src/app/landing/index.tsx',
    'frontend/src/app/landing/LibStrip.tsx',
    'frontend/src/app/landing/ScenariosSection.tsx',
    'frontend/src/app/me/CollectionTab.tsx',
    'frontend/src/app/me/page.tsx',
    'frontend/src/app/me/SettingsTab.tsx',
    'frontend/src/app/me/StatsTab.tsx',
    'frontend/src/app/practice/page.tsx',
    'frontend/src/app/TranslationSession.tsx',
    'frontend/src/app/TranslationStage.tsx',
]

# 多行 import 形如:
# import {
#   A,
#   B,
# } from '@/components/effects';
# OR:
# import { A, B } from '@/components/effects';

def replace_effects_import(content: str) -> str:
    pattern = re.compile(
        r"import\s*\{([^}]+)\}\s*from\s*['\"]@/components/effects['\"];?",
        re.DOTALL,
    )

    def repl(m):
        names_block = m.group(1)
        # 拆 name + alias(忽略 type imports)
        names = []
        for raw in names_block.split(','):
            raw = raw.strip()
            if not raw or raw.startswith('type '):
                continue
            # default import 'AnimatedCounter' 这种不行,我们都是 named
            names.append(raw)
        if not names:
            return m.group(0)

        new_imports = []
        for n in names:
            # 处理 `A as B` 这种 — 保留 as
            base_name = n.split(' as ')[0].strip()
            target_file = NAME_TO_FILE.get(base_name)
            if not target_file:
                # 跳过未知
                new_imports.append(f'// TODO: {n} (no shadcn mapping)')
                continue
            # ChromaGrid 是 named export (其他都是 default export)
            if base_name == 'ChromaGrid':
                new_imports.append(f"import {{ {n} }} from '@/components/{target_file}';")
            else:
                # default export — import 别名 = 原 export name
                alias = f' as {n}' if ' as ' in n else ''
                new_imports.append(f"import {base_name}{alias} from '@/components/{target_file}';")
        return '\n'.join(new_imports)

    return pattern.sub(repl, content)


for path in files:
    p = pathlib.Path(path)
    if not p.exists():
        print(f'{path}: SKIP (not exists)')
        continue
    content = p.read_text(encoding='utf-8')
    new_content = replace_effects_import(content)
    if new_content != content:
        p.write_text(new_content, encoding='utf-8')
        print(f'{path}: OK')