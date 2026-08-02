# Guest 练习体验

> 分支：`feat/guest-practice-experience`
> 范围：**仅 guest（未登录）用户的体验**，不涉及登录后的功能增强。

---

## 1. 目标

让未登录用户：

1. **零阻力进入练习** —— 点 Hero 按钮直接进练习页，没有中间页、没有选词库、没有登录拦截。
2. **保持现有练习体验不变** —— `TranslationSession` / `TranslationStage` 的答题逻辑、键盘快捷键、UI 全部沿用，不为「guest」再造一套。
3. **在「进步时刻」自然引导登录** —— 在用户感受到「比上一句更好」或「正确率达到 80%」时出现轻量提示卡片，不打断练习。

---

## 2. 不在本期范围

| 不做 | 原因 |
|---|---|
| 登录后保留当前题目 / 正确率 | 本期不做，登录后回到练习页接受「回到第 1 题」 |
| 触发卡片的会话间冷却 | 本期只做「会话内互斥」 |
| 题量阈值类触发器（5 词 / 30 题） | 之前已确认不采用 |
| 时间类触发器 | 之前已确认不采用 |
| 主动探索拦截（Header 历史入口） | 不是 guest 本期范围 |
| 匿名进度合并到账户 | 需要服务端 API，不在本期 |
| 任何登录后的功能增强 | guest 本期不做 |

---

## 3. 文件改动清单

| 文件 | 改动类型 | 内容 |
|---|---|---|
| `frontend/src/app/landing/Hero.tsx` | 改 | 按钮逻辑 + 文案 |
| `frontend/src/app/TranslationSession.tsx` | 改 | 新增触发判断逻辑 + 渲染卡片 |
| `frontend/src/app/components/PracticeHintCard.tsx`（新增） | 新增 | 触发卡片 UI |

共 **1 个新增文件 + 2 个改动文件**。

不动的文件：`TranslationStage.tsx` / `SunkenShortcutBar.tsx` / `api.ts` / `page.tsx`（URL 状态机复用）/ `AppHeader.tsx`。

---

## 4. 需求详情

### 4.1 Hero 按钮：未登录直进练习

**当前问题**：`Hero.tsx` 中 `handleStart` 在未登录时跳 `/login`，与本期目标冲突。

**目标行为**：

```text
按钮文案：
  - 已登录 + libs[0]   → "开始今日练习 · {libs[0].name}"
  - 未登录 + libs[0]   → "立即开始练习"

按钮点击：
  - libs.length > 0    → onPickLib(libs[0].id) → /?lib=<id>
  - libs 为空          → 按钮 disabled，不响应
```

**关键点**：

- 不再有「跳 `/login`」分支
- URL 复用现有 `?lib=` 路由，不新增 `/practice` 等独立路径
- `page.tsx` 的 URL 状态机完全不动

---

### 4.2 触发卡片 A：比上一句更好

**触发条件**：

```text
本会话存在「上一题」（previousResult != null）
且
上一题结果不是 correct（wrong / skipped）
且
本题结果 = correct
且
本会话尚未触发过任何卡片
```

**注意**：会话的**第一题**不算「改进」——没有「上一题」可对比，单纯答对不触发本卡。

**文案**：

```text
比上一句更好 · 登录后保留这份进度
```

**触发后**：

- `improvedCardShown = true`
- 本会话剩余题目不再触发任何卡片

**触发频率**：每个会话最多 1 次。

---

### 4.3 触发卡片 B：正确率达到 80%

**触发条件**：

```text
本会话累计答题数 >= 5
且
正确率 = correct / total >= 0.8
且
本会话尚未触发过任何卡片
```

**文案**：

```text
正确率达到 80% · 登录后保留这份进度
```

**触发后**：

- `rateCardShown = true`
- 本会话剩余题目不再触发任何卡片

**触发频率**：每个会话最多 1 次。

---

### 4.4 卡片互斥规则

```text
if (improvedCardShown || rateCardShown || dismissedThisSession) {
  // 不再触发
}
```

- 两个卡片互斥：触发过任意一个，另一个不再触发
- 关闭后（dismissed）也不再触发

---

### 4.5 卡片 UI 规范

**位置**：`TranslationSession` 内、`TranslationStage` 之下、页面底部。

**结构**：

```text
┌─────────────────────────────────────────────────────┐
│ {文案}                              [登录]   [×]    │
└─────────────────────────────────────────────────────┘
```

**交互**：

- 「登录」是 `<a>` 链接，跳 `/login?from=<encoded 当前练习页 URL>`
- 「×」是 `<button>`，点击后本次会话内不再出现
- 卡片出现时焦点不抢：不自动 focus 登录链接或关闭按钮
- 键盘快捷键（Space / Tab / `/`）仍然只作用于练习本身

**A11y**：

- `role="status"` 或 `aria-live="polite"`
- 不打断用户当前的输入焦点

**Props（暂定）**：

```ts
interface PracticeHintCardProps {
  kind: 'improved' | 'rate';
  onLogin: () => void;
  onDismiss: () => void;
}
```

---

### 4.6 `TranslationSession` 新增 state

不持久化（仅内存，会话内有效）：

```ts
sessionStats = { total: number; correct: number }
lastResult: 'correct' | 'wrong' | 'skipped' | null
cardState = {
  improvedCardShown: boolean
  rateCardShown: boolean
  dismissedThisSession: boolean
}
```

**触发判断位置**：`handleStepComplete` 调用之后。

---

### 4.7 Header 入口回归（不做改动，仅验证）

- Header 上的「登录」入口未登录用户点 → 走 `/login?from=<from>`
- 登录成功 → 回到原页面
- 登录后 header 正确显示头像

本期不修改 Header 代码，但需要回归测试确认不破坏现有行为。

---

## 5. 数据流

```text
TranslationStage.onComplete(result)
  ↓
TranslationSession.handleStepComplete(result)
  ├─ 写 progress 到 localStorage（已有逻辑）
  ├─ 更新 sessionStats（total++, correct++ if correct）
  ├─ 更新 lastResult
  ├─ 触发判断
  │   ├─ improvedCardShown || rateCardShown || dismissedThisSession? → return
  │   ├─ lastResult !== 'correct' && result === 'correct'
  │   │     → improvedCardShown = true; 渲染改进卡
  │   ├─ total >= 5 && correct / total >= 0.8
  │   │     → rateCardShown = true; 渲染正确率卡
  │   └─ 否则不渲染
  └─ 抽下一题（已有逻辑）
```

---

## 6. 验收标准

### 场景 1：未登录首屏

```text
1. 打开 /（未登录）
2. 看到「立即开始练习」按钮
3. 点击
4. URL 变为 /?lib=<libs[0].id>
5. 直接进入练习页，第 1 题
```

### 场景 2：触发「改进」卡片

```text
1. 第 1 题答错 / 跳过
2. 第 2 题答对
3. 练习页底部出现「比上一句更好 · 登录后保留这份进度」卡片
4. 第 3 题无论对错，卡片不再变化（已触发过）
```

### 场景 3：触发「正确率」卡片

```text
1. 任意方式答题
2. 答到第 5 题，累计正确率达到 80%
3. 练习页底部出现「正确率达到 80% · 登录后保留这份进度」卡片
```

### 场景 4：互斥

```text
1. 第 1 题错，第 2 题对（触发改进卡）
2. 第 3～N 题答对，正确率也达到 80%
3. 不再触发「正确率」卡片（改进卡已触发过）
```

### 场景 5：关闭卡片

```text
1. 任一卡片出现
2. 点「×」
3. 本会话剩余题目不出现任何卡片
```

### 场景 6：登录入口

```text
1. 卡片出现后点「登录」
2. 跳 /login?from=<encoded 当前 URL>
3. 登录成功回到 /?lib=<id>
   注：本版本不要求保留当前题目，接受回到第 1 题
```

### 场景 7：键盘不冲突

```text
1. 卡片出现时
2. 键盘 Space / Tab / / 仍然只作用于练习本身
3. 不被卡片按钮误触
```

### 场景 8：已登录用户不受影响

```text
1. 已登录用户进入 /
2. 看到「开始今日练习 · {libs[0].name}」
3. 答题过程中不出现触发卡片（卡片仅针对 guest）
```

---

## 7. 文案 A/B 备选（后续）

| 触发器 | A 版（本期用） | B 版（备选） |
|---|---|---|
| 改进 | 「比上一句更好 · 登录后保留这份进度」 | 「这一句比上一句更好」 |
| 正确率 | 「正确率达到 80% · 登录后保留这份进度」 | 「你已经稳定在 80% 正确率」 |

---

## 8. 下一轮（不在本期）

- 登录后保留当前题目（ephemeral state）
- 触发卡片的会话间冷却（24 小时）
- 触发卡片的统计与 A/B 测试
- 匿名进度合并到账户