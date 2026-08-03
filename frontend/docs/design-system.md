# TAL Mint 设计系统

> 全站唯一的设计语言权威文档。新页面 / 新组件开工前读这里。
> 活文档(可交互验收):[http://localhost:3000/design-system](http://localhost:3000/design-system)
> 定稿:2026-08-02(取代 Apple HIG / Sage Heal / Citrus Mint 三套历史体系)

---

## 1. 设计原则

1. **呼吸感优先** —— 大量留白、大圆角(bubble 圆角体系)、浅薄荷底 + 白卡片浮动。
2. **色彩有语义** —— 薄荷绿 = 主色 / 正确 / 前进;珊瑚橘 = 批改 / CTA 强调(接原朱砂红的红笔语义);除此之外不乱用色。
3. **动效 Q 弹** —— spring 软回弹(overshoot),气泡上浮、卡片弹入。快而轻,不拖沓。

## 2. 架构:三层 token

```
ds/tokens.css    第 1 层 raw:全站唯一允许写 hex / 裸数值的文件
ds/themes.css    第 2 层语义:--ds-* 映射;[data-theme="dark"] 换表,组件零改动
组件 *.module.css 第 3 层:只允许 var(--ds-*) 语义 token
```

**铁律两条:**
1. 除 `ds/tokens.css`(和 themes.css 的 dark 映射)外,任何文件出现 hex / rgba 即视为 bug。守护命令:
   ```bash
   grep -rn -E "rgba?\(|#[0-9a-fA-F]{3,8}\b" --include="*.tsx" --include="*.css" src/app | grep -v "src/app/ds/"
   # 期望输出为空
   ```
2. 新页面只允许"组 primitives + 贴语义 token",不允许造新颜色、新圆角、新字重。

## 3. 十模块规格

### 3.1 color/*
| 语义 token | 用途 | 对比度规则 |
|---|---|---|
| `--ds-bg` / `--ds-surface` / `--ds-tint` / `--ds-border` | 页面底 / 白卡 / chip 底 / 描边 | — |
| `--ds-ink` / `--ds-ink-soft` / `--ds-ink-faint` | 正文 / 次要 / 占位 | — |
| `--ds-action` | 薄荷填充(按钮、图标、大字) | ~3:1,**禁小字** |
| `--ds-action-deep` | 文字级薄荷(链接、小字、hover 加深) | ≈5.9:1 ✓ |
| `--ds-action-ink` | 标题级深色 | — |
| `--ds-correct` / `--ds-correct-fill` / `--ds-correct-tint` | 正确态文字 / 填充 / 浅底 | — |
| `--ds-error` | 大字错误 / 图标 / CTA | ≈3.6:1,禁小字 |
| `--ds-error-ink` | **小字**错误文本 | ≈7:1 ✓ |
| `--ds-error-line` | 错误下划线、淡珊瑚过渡 | — |
| `--ds-cta` / `--ds-cta-deep` | 珊瑚 CTA,**一页至多一处** | — |
| `--ds-focus` | focus 环(2px + 2px offset) | — |

### 3.2 type/*
| 阶 | 规格 | 用途 |
|---|---|---|
| display | 28px / 1.2 / 500 / -0.5px | 幕标题 |
| h1 | 20px / 1.3 / 500 | 卡片标题 |
| h2 | 16px / 1.4 / 500 | 小节、按钮大字 |
| body | 14px / 1.6 / 400 | 正文 |
| caption | 12px / 1.5 / 400 | 辅助说明 |
| typing | 16px / 1.8 / mono | 练习英文(等宽=逐字对齐刚需) |

- 字重只有 400 / 500 两档(`--weight-regular` / `--weight-medium`)
- 字体栈:`--font-sans`(中文系统黑)、`--font-display`(拉丁衬线,仅装饰)、`--font-mono`(练习/键帽/数字)

### 3.3 space/* · 4px 基网
`--space-1..7` = 4 / 8 / 12 / 16 / 24 / 40 / 64。卡片内边距 16,卡片组 24,幕间距 64。
内容最大宽 `--content-max: 1080px`;断点 640 / 1024(见 ds/motion.ts `breakpoints`)。

### 3.4 radius/* · 气泡圆角
sm 8(键帽)/ md 12(输入框)/ lg 16(卡片)/ xl 24(大幕卡)/ pill 999(按钮、chip)。

### 3.5 elevate/*
- `--elev-0`:描边卡(默认)
- `--elev-1`:浮起(hover / 玻璃卡替代)
- `--elev-focus`:focus 环 = 2px 薄荷 + 2px 偏移
- 不用黑色投影;dark 主题自动切黑软影(themes.css)。

### 3.6 size/*
按钮 sm 32 / md 40 / lg 48(CTA);输入框 44;触控目标 ≥44;icon 16/20/24;头像 32/44。

### 3.7 motion/*(ds/motion.ts)
- `spring.overshoot`(260/20):卡片入场、按钮回弹 —— Q 弹性格
- `spring.soft`(120/24):幕间滚动 reveal,不越界
- `spring.counter`(300/30):数字翻滚
- `prefers-reduced-motion`:全局降级(globals.css 末尾 + spring.reduced)

### 3.8 字符五态(TypedText)
untyped `--ds-char-untyped` / correct `--ds-char-correct` / error `--ds-char-error` + `--ds-char-error-line` 下划线 / caret `--ds-caret` 圆头 2px。
**全站只有 `ds/components/TypedText.tsx` 一处实现**,landing 演示与练习页共用。

### 3.9 组件状态五态(每个交互组件必备)
hover 浮 1px + elev-1 / active 回位(Q 弹)/ focus-visible 环 / disabled 40% 禁动效 / loading 按钮内 spinner。

### 3.10 图标与文案
- 图标:Lucide(圆头线性,stroke 1.75px,16/20/24),禁 emoji 当功能图标
- 文案:不写假数据、不承诺未上线功能;按钮写动作不写客套(沿用 design-auth.md 原则)

## 4. Primitives 清单(ds/components/)

| 组件 | 用途 |
|---|---|
| `TypedText` | 打字字符五态渲染(核心) |
| `Button` | primary / cta / ghost × sm / md / lg,含 loading |
| `BubbleCard` | 白卡容器,interactive 时 hover 浮起 |
| `KeyCap` | 键帽(2.5px 薄荷底边模拟键程) |
| `ProgressRing` | 进度环,入视口画圈(spring.soft) |
| `Badge` | 幕编号 / 状态 chip(mint / coral) |
| `Stat` | mono 统计数字 + caption 标签 |
| `Waveform` | 声波条(支持 CSS 动画或 levels 受控) |

## 5. 已退役(2026-08-02)

- `--cm-*`(Citrus Mint)、`--heal-*`(Sage Heal)、`--label-*` / `--accent` / `--correct`(Apple HIG)token 体系,全部删除
- `.practice--cm` 容器级 token 重映射机制,删除
- `PaperGrain` 组件(纸纹背景),删除
- auth 页 aurora 渐变 + 玻璃拟态,改为 TAL Mint 气泡卡(单词流背景保留)
- 一次性迁移脚本 `frontend/scripts/migrate-to-tal-mint.cjs` 已删除(2026-08-03;token 替换完成后归档,不再需要 npm script 入口)
