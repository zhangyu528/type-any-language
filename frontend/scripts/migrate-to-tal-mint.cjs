/**
 * TAL Mint 迁移脚本:把旧 token 名(cm/heal/label/accent 等系列)
 * 按长度降序做字面替换,避免子串误伤(on-primary 先于 primary)。
 * 只处理业务文件;globals.css / ds / design-system 已手工重写,跳过。
 */
const fs = require('fs');
const path = require('path');

const ROOT = 'D:/work/project/type-any-language/frontend/src/app';
const SKIP = ['globals.css', `${'ds'}${path.sep}`, `design-system${path.sep}`];

// 旧 → 新(顺序无关,执行前按 key 长度降序排序)
const MAP = {
  // citrus mint
  '--cm-mint-deep': '--ds-action-deep',
  '--cm-mint': '--ds-action',
  '--cm-lemon-deep': '--ds-cta-deep',
  '--cm-lemon': '--ds-cta',
  '--cm-ink-soft': '--ds-ink-soft',
  '--cm-ink': '--ds-ink',
  '--cm-accent': '--ds-error',
  '--cm-bg-grain': '--ds-tint',
  '--cm-bg': '--ds-bg',
  '--cm-card': '--ds-surface',
  '--cm-line': '--ds-border',
  '--cm-rule': '--ds-border',
  '--cm-spring': '--ease-spring',
  // sage heal
  '--heal-card-solid': '--ds-surface',
  '--heal-card': '--ds-surface',
  '--heal-sage-soft': '--ds-border',
  '--heal-sage': '--ds-action',
  '--heal-bg': '--ds-bg',
  '--heal-line': '--ds-border',
  '--heal-glow': '--ds-tint',
  '--heal-grid': '--ds-tint',
  '--heal-ink': '--ds-ink',
  // apple HIG neutral
  '--label-quaternary': '--ds-ink-faint',
  '--label-tertiary': '--ds-ink-soft',
  '--label-secondary': '--ds-ink',
  '--label-primary': '--ds-ink',
  '--label-mist': '--ds-ink-faint',
  '--surface-secondary': '--ds-tint',
  '--surface-tertiary': '--ds-tint',
  '--surface-elevated': '--ds-surface',
  '--surface': '--ds-bg',
  '--separator-opaque': '--ds-border',
  '--separator': '--ds-border',
  '--on-secondary': '--ds-on-action',
  '--on-primary': '--ds-on-action',
  '--secondary': '--ds-action-deep',
  '--primary': '--ds-action',
  '--accent-tint': '--ds-tint',
  '--accent': '--ds-error',
  '--correct-tint': '--ds-correct-tint',
  '--correct': '--ds-correct',
  '--tint-cool': '--ds-tint',
  '--tint-mist': '--ds-tint',
  '--tint-warm': '--ds-tint',
  // type scale
  '--type-large-title-weight': '--weight-medium',
  '--type-large-title-lh': '--text-display-lh',
  '--type-large-title': '--text-display',
  '--type-title-1-weight': '--weight-medium',
  '--type-title-2-weight': '--weight-medium',
  '--type-title-3-weight': '--weight-medium',
  '--type-body-emphasis-weight': '--weight-medium',
  '--type-body-emphasis': '--text-body',
  '--type-caption-weight': '--weight-regular',
  '--type-body-weight': '--weight-regular',
  '--type-title-1-lh': '--text-display-lh',
  '--type-title-2-lh': '--text-h1-lh',
  '--type-title-3-lh': '--text-h1-lh',
  '--type-caption-lh': '--text-caption-lh',
  '--type-body-lh': '--text-body-lh',
  '--type-title-1': '--text-display',
  '--type-title-2': '--text-h1',
  '--type-title-3': '--text-h1',
  '--type-caption': '--text-caption',
  '--type-body': '--text-body',
  // spacing(长名先行)
  '--space-12': '--space-7', '--space-11': '--space-7', '--space-10': '--space-7',
  '--space-9': '--space-7', '--space-8': '--space-6', '--space-7': '--space-6',
  // radius / motion / layout / fonts
  '--radius-circle': '--radius-pill',
  '--ease-standard': '--ease-out',
  '--ease-emphasized': '--ease-out',
  '--ease-decelerate': '--ease-out',
  '--ease-accelerate': '--ease-out',
  '--duration-fast': '--dur-fast',
  '--duration-base': '--dur-base',
  '--duration-slow': '--dur-slow',
  '--content-narrow': '--content-max',
  '--content-medium': '--content-max',
  '--content-wide': '--content-max',
  '--font-body': '--font-sans',
};

const keys = Object.keys(MAP).sort((a, b) => b.length - a.length);

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) walk(p, out);
    else if (/\.(css|tsx|ts)$/.test(name)) out.push(p);
  }
  return out;
}

let touched = [];
for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file);
  if (SKIP.some((s) => rel === s || rel.startsWith(s))) continue;
  let src = fs.readFileSync(file, 'utf8');
  let next = src;
  for (const k of keys) {
    if (next.includes(k)) next = next.split(k).join(MAP[k]);
  }
  if (next !== src) {
    fs.writeFileSync(file, next);
    touched.push(rel);
  }
}
console.log('touched files:');
for (const f of touched) console.log(' -', f);
console.log(`total: ${touched.length}`);
