# Dashboard 控制台化设计文档

> 分支：`feat/dashboard-polish`
> 状态：设计稿 v1（待评审）
> 目标：把 `/dashboard` 从「动机型首页」演进为「学习控制台」，并把 `/me` 的收藏/设置合并进来，消除两处功能重叠。

---

## 1. 背景与现状

### 1.1 当前 `/dashboard` 能做什么（已接通）
- 登录门禁（未登录跳 `/login`）
- `GET /api/dashboard` 单次拉取整页快照（auth、continue、daily_goal、streak、calendar、monthly_goal、progress）
- 概览区：问候 + 连续天数 + 本月目标条（GreetingBar）
- 继续/开始练习卡（ContinueCard）+ 今日目标环（DailyGoal）
- 本周 7 天节奏 + 当日详情抽屉（WeekRhythm → `GET /api/dashboard/day/{date}`）
- 3 个 KPI 磁贴（准确率/句数/新词，ProgressSnapshot）
- 选词库 modal（LibPicker）、欢迎横幅

### 1.2 已知缺陷（打磨 backlog，独立于本次重构）
- **P0** `LearnedLibProgress` 把真实进度数据丢弃，渲染成 pravatar 随机头像 → "学过的词库"模块功能缺失
- **P1** 中英文案混排（GreetingBar / ContinueCard / DailyGoal / ProgressSnapshot / DayDetailDrawer）
- **P2** ContinueCard 右侧 "Today's sentence" 是 `preview.split(' / ')` 硬切 + 写死 fallback 的假句子

### 1.3 死代码 / 未接通
- `updateMonthlyGoal`（前后端都在）前端零调用 → 月目标只能看不能改
- 后端已存在但前端没接的增量端点：`GET /api/dashboard/calendar`、`GET /api/dashboard/streak`

### 1.4 与 `/me` 的重叠
`/me` 已有 `StatsTab / CollectionTab / SettingsTab`，与 dashboard 的进度展示、潜在控制台功能重合。本方案将收藏/设置并入控制台，`/me` 退化为纯账号页或直接重定向。

---

## 2. 信息架构（IA）

顶部一条粘性分区导航（参考 `/me` 的 tab 实现），5 个分区，**URL `?section=` 为唯一真相源**（可深链、可前进/后退）：

| 分区 | key | 内容 | 来源 |
|---|---|---|---|
| 概览 | `overview` | 问候·连续天数·继续/开始卡·今日目标环·本周节奏·欢迎横幅 | 现有 hero 原样保留 |
| 练习 | `practice` | 词库网格 + 难度筛选 + 继续上次 + **每日/月目标编辑** | 提升 LibPicker 为常驻分区 + 接通目标编辑 |
| 数据 | `data` | KPI 磁贴 · 趋势曲线 · 各词库完成度 · 连续日历 + 当日详情 | 修 LearnedLibProgress + 接 calendar 趋势 |
| 收藏 | `collection` | 收藏句子列表 · 生词本 | 从 `/me/CollectionTab` 迁入 |
| 设置 | `settings` | 昵称 · 音频倍速 · 音标开关 · 重置数据 | 从 `/me/SettingsTab` 迁入 + 目标编辑 |

默认分区：`overview`。`/me` 重定向到 `/dashboard/settings`（或保留为薄账号页，见 §6）。

---

## 3. 路由与导航

### 3.1 URL 方案
- 控制台根：`/dashboard`
- 分区切换：`/dashboard?section=data`（同 `/me` 的 `?tab=` 模式，保持一致性）
- 深链 + 浏览器前进/后退：`popstate` 监听 → 读 `?section=` → 切换（复用 `/me` 与现有 dashboard 的 `popstate` 模式）
- `libId`/`picker` 这类瞬时 UI 状态仍走 `history.pushState` 不进路由（保持现有 dashboard 的 `readPracticeUrl` 模式，避免整页 remount 丢弃快照）

### 3.2 导航组件
新增 `DashboardNav.tsx`：粘性分区条，与 `/me` 的 `me-tabs` 同款（含 `data-stuck` 毛玻璃态、active 用 ShinyText）。分区 key 用 `Record` 映射中文 label，与 `/me` 的 `TAB_LABEL` 写法一致。

---

## 4. 组件拆分

### 4.1 目录结构（目标态）
```
frontend/src/app/dashboard/
  layout.tsx                 # 保留 data-babyblue 作用域
  page.tsx                  # 编排：auth gate + 快照加载 + 分区路由
  DashboardNav.tsx          # 新增：分区导航
  sections/
    OverviewSection.tsx      # 现有 hero 拼装（GreetingBar+ContinueCard+DailyGoal+WeekRhythm+Welcome）
    PracticeSection.tsx      # 新增：词库网格 + 难度 + 目标编辑
    DataSection.tsx          # 新增：KPI + 趋势 + 各词库完成度 + 日历/抽屉
    CollectionSection.tsx    # 迁入 /me/CollectionTab
    SettingsSection.tsx      # 迁入 /me/SettingsTab
  GoalEditor.tsx             # 新增：每日/月目标编辑（接通 updateMonthlyGoal + 新增日目标）
  TrendChart.tsx            # 新增：轻量 SVG 折线（无图表库依赖）
  components/                # 现有组件保留：ContinueCard/DailyGoal/WeekRhythm/ProgressSnapshot/LearnedLibProgress/LibPicker/DayDetailDrawer
```

### 4.2 各分区组件职责
- **OverviewSection**：纯拼装现有组件，不做逻辑改动（顺带修 P1 文案）。
- **PracticeSection**：把 `LibPicker` 的列表逻辑抽成 `LibGrid`（常驻网格，非 modal）；难度筛选接 `catalog.difficulties_by_lib`；"继续上次"接 `prefs.libId`；底部嵌 `GoalEditor`。
- **DataSection**：
  - 顶部 `ProgressSnapshot`（3 KPI）
  - `TrendChart` 用 `calendar`（35 天）画"每日句数"和"每日准确率"两条曲线
  - `LearnedLibProgress` **修复**（见 §5）
  - `WeekRhythm` + `DayDetailDrawer` 保留（连续日历 + 当日详情）
- **CollectionSection / SettingsSection**：直接迁移 `/me` 的 `CollectionTab.tsx` / `SettingsTab.tsx`，仅改 import 路径与外层 wrapper。

### 4.3 复用与新增
- 复用：`GreetingBar`、`ContinueCard`、`DailyGoal`、`WeekRhythm`、`ProgressSnapshot`、`DayDetailDrawer`、`LibPicker`/`LibCard`、`BounceCards`（入场动画）、`GlassSurface`、`Counter`、`SpecularButton`。
- 新增：`DashboardNav`、`PracticeSection`、`DataSection`、`CollectionSection`、`SettingsSection`、`GoalEditor`、`TrendChart`。
- 修复：`LearnedLibProgress`（渲染真实进度行，不再用 pravatar）。

---

## 5. 数据流与 API

### 5.1 各分区所需端点（现状 vs 缺口）
| 分区 | 端点 | 现状 |
|---|---|---|
| overview | `GET /api/dashboard` | ✅ 已用 |
| practice | `GET /content/catalog` | ✅ 已用 |
| practice | `POST /api/dashboard/monthly-goal` | ⚠️ 后端有、前端未接 → **接通即可** |
| practice | 日目标编辑 | ❌ 无端点 → **需新增** |
| data | `GET /api/dashboard`（calendar 35 天） | ✅ 趋势可直接用 |
| data | `GET /api/dashboard/day/{date}` | ✅ 已用 |
| data | 各词库完成度 | ⚠️ 当前前端用 localStorage 进度 + catalog 算（见 §5.3） |
| collection | localStorage `me.collection` | ✅ 客户端 |
| settings | localStorage 偏好 + `PATCH /api/auth/me` | ✅ 已用 |

### 5.2 **后端是否需要新增趋势/历史接口？——结论**
- **短程趋势（≤35 天）：不需要新端点。** `GET /api/dashboard` 返回的 `calendar` 数组已含每天 `sentences_count` 与 `accuracy`（见 `activity_service.compute_calendar`）。前端直接把它画成折线即可，零后端改动。
- **长程趋势（≥90 天 / 按月聚合）：建议 v2 新增** `GET /api/dashboard/trends?range=90d`，后端按 `daily_activity` 聚合。v1 不做。
- **日目标编辑：需新增端点**（见 §5.4）。这是唯一的"功能必需"新增。
- **各词库完成度（per-lib completion）：当前是客户端数据**（见 §5.3），v1 保持；若要服务端化需新增聚合端点（v2）。

### 5.3 各词库完成度的数据真相（重要）
`LearnedLibProgress.buildRows()` 目前用 **localStorage** 的 `TranslationProgress`（drill 进度 blob）和 `catalog` 计算完成度。即：
- **进度是设备本地数据，非服务端同步**。控制台"数据/各词库"在 v1 仍基于 localStorage——多设备不同步是已知限制。
- 修复 `LearnedLibProgress` 只是把这部分真实本地数据**渲染出来**（替换 pravatar），不涉及后端。
- 若要真正的"跨设备进度"，需要把 drill 进度从 localStorage 迁到 `practice_session`/新表并由后端聚合——属于更大的架构变更，不在本控制台 v1 范围内。

### 5.4 需新增的后端端点（v1 唯一必需）
```
POST /api/dashboard/daily-goal
  body: { target: int }
  逻辑: users.daily_goal = target（参考现有 monthly-goal 路由）
  返回: DailyGoalState（复用 compute_daily_goal）
```
`daily_goal` 字段已存在于 `User` 模型（`_get_daily_goal` 读取，默认 20），只是没有 mutation 端点。前端 `DailyGoalState.target` 已就绪，只差写入通路。

### 5.5 已存在但前端未接的端点（顺手接上）
- `GET /api/dashboard/calendar`：分区切换/会话结束后增量刷新周节奏，替代重拉全量快照。
- `GET /api/dashboard/streak`：GreetingBar 跨标签刷新连续天数。
- `POST /api/dashboard/monthly-goal`：在 `GoalEditor` 里接通 `updateMonthlyGoal`。

---

## 6. 迁移与兼容

- **`/me` 处置**：把 `CollectionTab`/`SettingsTab` 迁到控制台后，`/me` 仅保留账号卡（昵称/邮箱/注册时间）+ 重定向到 `/dashboard/settings`。或直接在 `me/page.tsx` 第一行 `router.replace('/dashboard/settings')`。推荐后者，减少维护面。
- **localStorage key 不变**：`translationProgress:{userId}`、`me.collection:{userId}`、`prefs.*` 全部保留，迁移无数据迁移成本。
- **链接更新**：落地页/练习页里指向 `/me` 的入口改为指向对应控制台分区（`?section=settings` / `?section=collection`）。

---

## 7. 视觉与一致性

- 主题：分区页继承 `layout.tsx` 的 `data-babyblue` 作用域，沿用 `var(--ds-*)` token；暗色覆盖已普遍覆盖（参考 `Dashboard.module.css`）。新增分区需补齐各自的 `*.module.css` 暗色块。
- 动效：`AnimatedContent` 负责分区入场淡入；`BounceCards`/`SpotlightCard` 等保持现有手感。注意 Aurora 全屏 + 多 motion 组件的低端机性能——可对 `DataSection`（图表最重）做 `dynamic import` 懒加载。
- **i18n（P1）**：分区文案统一 zh-CN，列出待替换英文串：
  - GreetingBar：`Good morning/afternoon/evening`、`Start a new streak today`、`🔥 N-day streak · keep it going`
  - ContinueCard：`Continue`、`Free practice`、`No active session yet`、`Start your first lesson / Resume Practice / Practice again`
  - DailyGoal：`🎉 Daily goal hit`、`N more today`、`Practice now`
  - ProgressSnapshot：`SPEC · WEEK OF`（装饰条）
  - DayDetailDrawer：`Sessions` 标题

---

## 8. 实施阶段

- **Phase 0（独立于重构，可先发）**：修 P0（LearnedLibProgress 真实进度）+ P1（i18n 文案统一）。当前页即可交付，不阻塞后续。
- **Phase 1**：引入 `DashboardNav` + `?section=` 路由；抽取 `OverviewSection`（现有 hero）。
- **Phase 2**：`PracticeSection`（常驻词库网格 + 接通 `updateMonthlyGoal`；后端加 `POST /api/dashboard/daily-goal` 并接通）。
- **Phase 3**：`DataSection`（`TrendChart` 用 calendar；`LearnedLibProgress` 提升进本分区）。
- **Phase 4**：`CollectionSection`/`SettingsSection` 从 `/me` 迁入；`/me` 重定向。
- **Phase 5**：a11y / 响应式 / 暗色走查；`DataSection` 懒加载；`prefers-reduced-motion` 复核。

---

## 9. 风险与开放问题

1. **进度多设备不同步**：v1 的"各词库完成度"依赖 localStorage，非服务端。是否接受 v1 限制，还是要把 drill 进度服务端化？（建议 v1 接受，v2 再议。）
2. **日目标端点需后端改动**：`POST /api/dashboard/daily-goal` 要后端加路由 + 测试。
3. **`/me` 重定向影响**：现有书签/外链指向 `/me` 的会跳转到控制台设置区，需确认可接受。
4. **性能**：Aurora + 多 motion + 图表同屏，低端机需懒加载最重的 `DataSection`。
5. **P0/P1 是否先单独发一版**：建议 Phase 0 先 merge，降低重构分支体积。
