# Auth UI 设计规范（feat/auth 沉淀）

> 本文档从 `feat/auth` 分支的 5 个 auth commit（commit `8de39e6` → `7086f30`）提炼出登录 / 注册页的 UI 设计语言、动画时序、a11y 约束、token 用法。**不包含任何代码复制**——这是设计层的"知识沉淀"，跟后端 auth endpoints / frontend auth context 解耦，未来在新前端结构（`TranslationSession` / `TranslationStage`）上从零实现 auth 时可作为 spec。
>
> 源分支：`origin/feat/auth`
> 源文件：
> - `frontend/src/app/(auth)/layout.tsx` (229 行)
> - `frontend/src/app/(auth)/login/page.tsx` (508 行)
> - `frontend/src/app/(auth)/signup/page.tsx` (692 行)

---

## 1. 设计意图

> Auth is a distinct mental state from "casual practice" — it deserves a visual context shift. Aurora gradient + frosted glass card signals "you're entering a private space" without being heavy or corporate. Sits in deliberate contrast to the neutral Apple-HIG rest of the app.

**核心取舍**：

- 练习页是 Apple HIG 单色 + 中性灰（专注 + 工具感）
- auth 页是 aurora 渐变 + 玻璃卡（私密 + 仪式感）
- 同一应用里两套并存的视觉风格，靠 (auth) route group 物理隔离

| | 练习页 (`/`) | auth 页 (`/login`, `/signup`) |
|---|---|---|
| 背景 | 纯色 / 极简 | aurora 渐变 + 浮动 blob |
| 容器 | 直接布局，1 column | frosted glass card（max 380px 居中）|
| 字体 | 中性字符 | 标题字符级 fade-in 动画 |
| 反馈 | 微妙（1-2px translate）| 强调（shake on error / dissolve on success）|

---

## 2. 路由结构

```
frontend/src/app/(auth)/
├── layout.tsx       # 共享：aurora 背景 + glass card 容器 + brand link
├── login/page.tsx   # 邮箱 + 密码 + 提交
└── signup/page.tsx  # 邮箱 + 密码 + 密码强度 + 提交
```

`(auth)` 是 Next.js route group —— URL 路径不变（仍是 `/login` / `/signup`），只是共享 layout。

**不进 (auth) 的页面**：

- `/`（练习页）用自己的 `PracticeChrome`（top bar），不继承 auth shell
- `/history`（已登录用户页）也是独立的 layout

---

## 3. 布局规范

### 3.1 Auth shell（`layout.tsx`）

```
┌──────────────────────────────────────────────┐
│  [aurora 渐变背景 + 3 个浮动 blob]              │
│                                              │
│         ┌──────────────────────┐             │
│         │  ◯ Type Any Language  │ ← 品牌回首页 │
│         │  ──────────────────  │             │
│         │                      │             │
│         │  {children}          │ ← login/signup│
│         │                      │             │
│         └──────────────────────┘             │
│         max-width: 380px                     │
│         backdrop-filter: blur(28px)          │
│                                              │
└──────────────────────────────────────────────┘
```

| 元素 | 规范 |
|---|---|
| shell min-height | 100vh，居中 |
| shell padding | `var(--space-6) var(--space-4)` |
| shell background | `linear-gradient(135deg, #F5E8FF 0%, #FFE5EC 45%, #FFF1E0 100%)` |
| card max-width | 380px |
| card padding | `var(--space-7) var(--space-6)` |
| card background | `rgba(255, 255, 255, 0.55)` |
| card backdrop-filter | `blur(28px) saturate(180%)` |
| card border | `1px solid rgba(255, 255, 255, 0.6)` |
| card border-radius | `var(--radius-lg)` |
| card box-shadow | `0 12px 48px rgba(80, 40, 120, 0.10), 0 2px 8px rgba(80, 40, 120, 0.05), inset 0 1px 0 rgba(255, 255, 255, 0.7)` |

### 3.2 Brand link（卡片顶部）

```
[◯]  Type Any Language
```

| 元素 | 规范 |
|---|---|
| 容器 | `display: inline-flex; align-items: center; gap: var(--space-2)` |
| 位置 | 居中（`margin: 0 auto var(--space-5)`）|
| enso ◯ | 26px，`var(--accent)`，`filter: drop-shadow(0 2px 6px rgba(215, 0, 21, 0.18))` |
| 名称 | `var(--type-body-emphasis)`，`var(--type-title-3-weight)` |
| 整块 | `<Link href="/">`，替代 chrome 中的 home 链接 |
| hover | enso 放大 1.08 + 阴影加深；容器背景 `rgba(255, 255, 255, 0.45)` |

### 3.3 Form container

```
.auth-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  transition: opacity 200ms var(--ease-standard), transform 200ms var(--ease-standard);
}
```

`gap: var(--space-4)` = 16px 字段间距。subtitle 标题区有特殊覆盖（见 §5.2）。

---

## 4. 标题设计

### 4.1 字符级 fade-in

标题 h1 内的每个字符独立 span，stagger 50ms 出现：

```jsx
<h1 className="auth-title">
  {Array.from('欢迎回来').map((char, i) => (
    <span
      key={i}
      className="auth-title__char"
      style={{ animationDelay: `${i * 50}ms` }}
    >
      {char}
    </span>
  ))}
</h1>
```

```css
.auth-title__char {
  display: inline-block;
  opacity: 0;
  transform: translateY(6px);
  animation: auth-char-rise 500ms var(--ease-emphasized) both;
}
@keyframes auth-char-rise {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

| 标题 | 字数 | 最后字符出现 |
|---|---|---|
| 欢迎回来（login） | 4 字 × 50ms | 200ms |
| 创建账号（signup） | 4 字 × 50ms | 200ms |

### 4.2 Subtitle（h1 下方一句）

紧跟标题 fade 完成后出现，**视觉间距 4px**（不破坏 form `gap` 的 16px 节奏）：

```css
.auth-form__subtitle {
  font-size: var(--type-body);
  color: var(--label-tertiary);
  margin: 0;
  margin-top: calc(var(--space-4) * -1 + var(--space-1));
  animation: auth-field-rise 400ms var(--ease-emphasized) both;
  animation-delay: 160ms;
}
```

| 页面 | 文案 | 出现时刻 |
|---|---|---|
| login | 继续你的练习 | 160ms |
| signup | 几秒钟创建账号 | 110ms（更早，因为更突出"快速"）|

**文案原则**（沿用之前的设计约束）：

- 不写假数据（"加入 10000+ 学习者"）
- 不预先承诺没建的功能（"跨设备同步"等云同步功能上线前不能写）
- 写"时间"或"动作"：几秒钟、继续你的练习

### 4.3 字段级 stagger

```css
.auth-field-1 { animation-delay: 200ms; }
.auth-field-2 { animation-delay: 280ms; }
.auth-field-3 { animation-delay: 340ms; }  /* signup only */
```

每个字段 `auth-field-rise` 400ms，最后字段在 ~740ms 落定。signup 比 login 多一字段（密码确认），多 60ms stagger。

---

## 5. 字段设计

### 5.1 字段容器

```jsx
<label className="auth-field auth-field-1">
  <span className="auth-field__label">邮箱</span>
  <span className="auth-field__input-wrap">
    <svg className="auth-field__icon" aria-hidden>{/* envelope / lock icon */}</svg>
    <input className="auth-field__input auth-field__input--with-icon" />
    {/* password-only: */}
    <button className="auth-field__toggle" tabIndex={-1} aria-label="显示密码">
      <svg aria-hidden>{/* eye / eye-off */}</svg>
    </button>
  </span>
  {error ? <span className="auth-field__error" role="alert">{error}</span> : null}
</label>
```

| 元素 | 规范 |
|---|---|
| label | 12px (`var(--type-caption)`), `var(--label-tertiary)`, letter-spacing 0.02em |
| input wrap | `position: relative; display: flex; align-items: center` |
| input | 44px 高，17px 字号，`rgba(255, 255, 255, 0.7)` 底，1px `rgba(0, 0, 0, 0.08)` 边 |
| icon | 16px，`position: absolute; left: var(--space-3)`，`var(--label-quaternary)` 静态色 |
| input-with-icon | `padding-left: 36px`（让位给 icon）|
| input-with-toggle | `padding-right: 40px`（让位给 toggle button）|
| toggle button | 28×28，`position: absolute; right: var(--space-2)`，透明背景 |
| error text | 12px `var(--accent)`，前置 ⚠ icon（CSS `::before`），`role="alert"` |

### 5.2 Focus state

```css
.auth-field__input-wrap:focus-within .auth-field__input {
  border-color: var(--label-secondary);
  box-shadow: 0 0 0 4px rgba(28, 28, 30, 0.08);  /* 4px soft ring */
}
.auth-field__input-wrap:focus-within .auth-field__icon {
  color: var(--label-secondary);  /* icon 静态色 → 加深 */
}
```

**两个层次反馈**：
- input 自身：4px 软环
- icon：颜色从 `quaternary` 变 `secondary`

### 5.3 Error state

```css
.auth-field__input--error,
.auth-field__input-wrap:focus-within .auth-field__input--error {
  border-color: var(--accent);
  box-shadow: 0 0 0 4px rgba(215, 0, 21, 0.10);
  animation: auth-field-error-attn 240ms var(--ease-standard) both;
}
@keyframes auth-field-error-attn {
  0%, 100% { transform: translateX(0); }
  30%      { transform: translateX(-2px); }
  70%      { transform: translateX(2px); }
}
```

**反馈叠层**：
1. 整个 form shake（wrapper 320ms ±6px）
2. 错误字段边框变 `var(--accent)`
3. 错误字段自身 240ms 2px 横向 attention 动效
4. 字段下方 ⚠ + 错误文字 fade-in

### 5.4 a11y

| 关注点 | 实现 |
|---|---|
| input invalid state | `aria-invalid={error ? true : undefined}` |
| 错误消息 | `role="alert"`（屏幕阅读器自动播报）|
| 装饰性 icon | `aria-hidden` |
| 密码 toggle 按钮 | `aria-label="显示密码"` / `aria-label="隐藏密码"`，`tabIndex={-1}`（不进入 tab 序列）|
| input 标签 | 用 `<label>` 包裹 + `aria-invalid` |

---

## 6. 实时校验

### 6.1 Login

| 触发点 | 校验 | 反馈 |
|---|---|---|
| email onBlur | regex 简单邮箱格式 | `⚠ 邮箱格式不正确` |
| email onChange（已有错时）| 重跑 regex，错了就实时更新 | 立即清错或显示 |
| password 提交时 | 长度 ≥ 8 | 提交拦截，shake + focus 第一个无效字段 |

`validateEmail` 实现：pragmatic regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`，不是 RFC 5322。

### 6.2 Signup

| 字段 | 规则 |
|---|---|
| email | 同 login |
| password | 8-72 字符 |
| password（强度）| 0-5 分，0=无 / 5=极强（见 §7） |
| confirm | 必须 === password |

### 6.3 提交失败 / 成功

- **失败**：error 状态设到 errors state → useEffect 检测 hasErrors → setShakeKey(k+1) → wrapper 重新挂载触发 shake → focus 第一个无效字段
- **成功**：setDissolving(true) → 等 200ms（让 form 缩放淡出可见）→ router.replace('/history')

---

## 7. 密码强度计（signup only）

**不在 login**——只在 signup 帮助用户选个强密码。login 端用户已经有密码。

### 7.1 计算

| Score | 标准 |
|---|---|
| 0 | 空 |
| 1 | 长度 ≥ 8 |
| 2 | + 有大写或小写 + 有数字 |
| 3 | + 有特殊字符 |
| 4 | + 长度 ≥ 12 |
| 5 | + 长度 ≥ 16 |

这是 UI hint，**不是真正的安全门**——后端只校验 8+ 字符长度。

### 7.2 视觉

```
[▓▓▓▓▓▓▓▓░░░░░░░░░░░] 80% (绿色)
```

```jsx
<div className="auth-field__strength" data-score={strength} role="meter" aria-valuenow={strength}>
  <div className="auth-field__strength-bar" />
</div>
<ul className="auth-field__requirements">
  {requirements.map(req => <li>✓ 至少 8 个字符</li>)}
</ul>
```

| score | width | color |
|---|---|---|
| 0 | 0% | — |
| 1 | 20% | `var(--accent)` 红 |
| 2 | 40% | `#F5A623` 黄 |
| 3 | 60% | `#F5A623` 黄 |
| 4 | 80% | `#34C759` 绿 |
| 5 | 100% | `#34C759` 绿 |

**实时跟随 onChange 更新**（不需要 onBlur）—— 用户输入时就能看到强度和缺哪条。

---

## 8. 提交按钮

```jsx
<button type="submit" disabled={submitting || dissolving} className="auth-form__submit">
  {submitting ? (
    <>
      <svg className="auth-form__spinner" aria-hidden>
        <circle r="6" strokeWidth="1.75" strokeDasharray="28 60" />
      </svg>
      <span>登录中…</span>
    </>
  ) : (
    <span>登录</span>
  )}
</button>
```

| 状态 | 视觉 |
|---|---|
| 静态 | 48px 高，渐变 `linear-gradient(180deg, #2C2C2E 0%, #1C1C1E 100%)` 白字，box-shadow `0 4px 12px rgba(0, 0, 0, 0.12)` |
| hover | translateY(-1px) + 阴影 `0 6px 16px rgba(0, 0, 0, 0.16)` |
| active | translateY(0) |
| disabled | opacity 0.7 + `cursor: progress` |
| 提交中 | 内嵌 spinner + 文字 "登录中…" / "注册中…" |

**spinner 动效**：

```css
.auth-form__spinner {
  animation: auth-form-spin 800ms linear infinite;
}
@keyframes auth-form-spin {
  to { transform: rotate(360deg); }
}
```

**成功 dissolve**（登录成功后）：

```css
.auth-form--dissolving {
  opacity: 0;
  transform: scale(0.96);
  pointer-events: none;
}
```

JS 端等 200ms 再 router.replace，让用户看到成功。

---

## 9. 切换链接（底部 alt text）

```jsx
<p className="auth-form__alt">
  还没有账号？<Link href="/signup">注册</Link>
</p>
```

```css
.auth-form__alt {
  text-align: center;
  font-size: var(--type-caption);
  color: var(--label-tertiary);
  margin-top: var(--space-3);
}
.auth-form__alt a {
  color: var(--accent);  /* 注意:复用 --accent，但只在这一处违反"enso 专用"约定 */
  text-decoration: none;
  font-weight: var(--type-body-emphasis-weight);
}
.auth-form__alt a:hover { text-decoration: underline; }
```

**注意**：`--accent` 在 globals.css 里被标为"enso + 正确状态反馈专用"。这里 alt link 也用了它——是约定的小破坏。链接视觉上需要颜色区分（"注册"是个关键 CTA），用 `var(--accent)` 是经过权衡的。

---

## 10. Aurora 背景动效

3 个浮动彩色 blob，循环 16-20s 漂移。装饰用，`aria-hidden`，不接收 pointer events。

```css
.auth-aurora {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}
.auth-aurora__blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(40px);
  opacity: 0.75;
  will-change: transform;
}
```

| Blob | 位置 | 颜色 | 周期 |
|---|---|---|---|
| --a | top -10%, left -15%, 42vw | `#FF6B9D` 粉 | 18s |
| --b | bottom -10%, right -15%, 40vw | `#8B6BF0` 紫 | 20s, -6s delay |
| --c | top 25%, left 30%, 44vw | `#FFB347` 橙 | 16s, -10s delay |

**关键设计点**：blob C 居中放在 card 后面，玻璃卡（白色 55% + blur 28px）透出 blob 颜色变化 —— motion 落在用户视觉焦点区。

```css
@keyframes auth-blob-drift-c {
  0%, 100% { transform: translate(0, 0) scale(1); }
  25%      { transform: translate(15vw, -8vh) scale(1.25); }
  50%      { transform: translate(-10vw, 10vh) scale(0.78); }
  75%      { transform: translate(8vw, -6vh) scale(1.18); }
}
```

**已知陷阱**（被 `f251e6e` 修复过）：早期用 56px blur + 浅色（#FFB7C5 / #C9B6F2 / #FFD49B）—— 颜色跟背景渐变太接近，motion 看不出来。最终方案 40px blur + 深色（#FF6B9D / #8B6BF0 / #FFB347）。

---

## 11. 入场时序总览

```
时间轴 (ms)  0 ───────── 200 ── 280 ── 400 ── 700 ── 740
            │  │  │  │   │      │      │      │      │
背景        ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ (持续漂移)
card rise   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ (0-600ms)
enso / 品牌  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ (随 card)
标题 char 1      ▓▓▓▓▓▓▓▓▓▓▓ (0+0ms)
标题 char 2         ▓▓▓▓▓▓▓▓▓▓▓ (0+50ms)
标题 char 3            ▓▓▓▓▓▓▓▓▓▓▓ (0+100ms)
标题 char 4               ▓▓▓▓▓▓▓▓▓▓▓ (0+150ms)
subtitle                ▓▓▓▓▓▓▓▓▓▓▓▓▓ (160ms)
field 1                    ▓▓▓▓▓▓▓▓▓▓▓▓▓ (200ms)
field 2                       ▓▓▓▓▓▓▓▓▓▓▓▓▓ (280ms)
field 3 (signup)                ▓▓▓▓▓▓▓▓▓▓▓▓▓ (340ms)
submit (随字段 stagger 结束)                    ▓▓▓▓▓▓▓▓▓▓▓▓▓
```

整体感觉：card 升起 → 字符逐个出现 → 字段按节奏上滑 → 用户可交互（~700ms 后）。

---

## 12. Token 用法总结

### 12.1 颜色

| 用途 | Token |
|---|---|
| 文字主色 | `var(--label-primary)` |
| 文字辅助 | `var(--label-tertiary)` |
| icon 静态 | `var(--label-quaternary)` |
| icon focus | `var(--label-secondary)` |
| 错误 / enso | `var(--accent)` |
| 背景渐变 | 硬编码 `#F5E8FF #FFE5EC #FFF1E0` |
| blob | 硬编码 `#FF6B9D #8B6BF0 #FFB347` |
| 玻璃卡底 | `rgba(255, 255, 255, 0.55)` |
| input 底 | `rgba(255, 255, 255, 0.7)` → hover 0.85 → focus 0.95 |
| focus ring | `rgba(28, 28, 30, 0.08)` |
| error ring | `rgba(215, 0, 21, 0.10)` |

### 12.2 尺寸

| 用途 | 值 |
|---|---|
| card max-width | 380px |
| card padding | `var(--space-7) var(--space-6)` |
| input 高 | 44px |
| submit 高 | 48px |
| icon | 16×16 |
| enso | 26px（"◯"）|
| 字体（input/submit）| 17px (`var(--type-body)`) |
| 字体（label/error/alt）| 12px (`var(--type-caption)`) |
| 字体（title）| 22px (`var(--type-title-2)`) |

### 12.3 动效

| 用途 | Token |
|---|---|
| 标准缓动 | `var(--ease-standard)` |
| 强调缓动 | `var(--ease-emphasized)` |
| shake 缓动 | `cubic-bezier(0.36, 0.07, 0.19, 0.97)` |
| 标准时长 | `var(--duration-fast)` |

### 12.4 spacing

| 用途 | Token |
|---|---|
| form gap | `var(--space-4)` = 16px |
| field 内 gap | `var(--space-2)` = 8px |
| input horizontal padding | `var(--space-4)` = 16px |
| icon 左边距 | `var(--space-3)` = 12px |
| card 内边距 | `var(--space-7) var(--space-6)` = 32px / 24px |
| submit 上间距 | `var(--space-2)` = 8px |
| alt 上间距 | `var(--space-3)` = 12px |

---

## 13. a11y & reduced-motion

```css
@media (prefers-reduced-motion: reduce) {
  .auth-form__subtitle { animation: none !important; }
  .auth-field__input--error { animation: none !important; }
}
```

**已显式覆盖**：
- subtitle fade
- per-field error attention motion

**依赖 globals.css 末尾全局 override**：
- card rise / field rise / char rise / form shake / blob drift / spinner

**待办（master globals.css 现状）**：要确认这些 keyframe 在全局 reduced-motion 下被禁用。如果没禁用，需要在 auth pages 的 style block 里逐个 override。

---

## 14. 已知约束（从 feat/auth 沉淀）

1. **styled-jsx × next/link 冲突**：`next/link` 渲染时 inner `<a>` 不会继承 styled-jsx 的 scoped class hash。`PracticeChrome` 的 brand / login button 必须用 globals.css 或 inline style，**不能用 styled-jsx**。这条约束跟 auth pages 暂时无关（auth pages 的 brand 在 layout 里也用 `<Link>`，但 layout 用的是 `<style dangerouslySetInnerHTML>` 不是 styled-jsx——也踩过坑，新版本需要直接 inline 样式或 globals.css）。

2. **`--accent` 约定 vs 实际**：`globals.css:9-11` 写"reserved for enso + correct-state feedback"，但 alt link 错误边框、错误 ring 都用了它。视觉上能区分（边 vs 填充 vs 文字色），但**理论约定是松的**。

3. **aurora 配色 ≠ 主题**：aurora 渐变和 blob 颜色是硬编码十六进制（不属于 token 系统），因为它们是装饰性元素，理论上不能跟随 light/dark theme 切换。dark mode 下这套配色会显得很突兀——dark mode 是未来工作。

4. **password strength 是 UI hint**：5 分制只是引导用户，后端只校验 8+ 字符。前端规则跟后端必须保持同步。

---

## 15. 文件清单

待新建（在 feat/auth-ui 分支上）：

```
frontend/src/app/(auth)/
├── layout.tsx        ← 共享 aurora + glass card
├── login/page.tsx    ← 邮箱 + 密码
└── signup/page.tsx   ← 邮箱 + 密码 + 密码强度 + 确认密码
```

**待补（不在本文档范围）**：

- `frontend/src/app/lib/auth.tsx` —— AuthProvider + useAuth() hook
- `frontend/src/app/api.ts` 里的 `apiLogin / apiSignup / apiLogout / apiMe / ApiError`
- `backend/app/routers/auth.py` —— `/api/auth/signup` `/api/auth/login` `/api/auth/me` `/api/auth/logout`
- `backend/app/services/auth_service.py` —— bcrypt + JWT
- `backend/app/schemas/auth.py` —— Pydantic schemas
- `backend/app/deps/auth.py` —— FastAPI dependencies
- CORS 允许 `credentials: 'include'`
- `tal_session` httpOnly cookie 处理

这些属于"auth 系统"而非"auth UI"，另开文档。
