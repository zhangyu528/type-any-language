# 数据页面（「数据」分区）重设计方案 + 功能需求规格

> 适用范围：`/dashboard?section=data` 分区。
> 设计方向：**分析驾驶舱（Analytics Cockpit）**。
> 配套视觉原型：`docs/data-page-redesign.html`（可直接用浏览器打开，暗色主题，含交互）。
> 现状基线：当前数据分区是单栏纵向堆叠 5 块（ProgressSnapshot → TrendChart → LearnedLibProgress → WeekRhythm → WeakPointsSection），无层级关系、无区间/指标切换、无洞察叙事、薄弱点不可筛选。

---

## 一、设计目标

1. **从「数据罗列」到「看得懂的趋势与洞察」**：给指标加对比基准（本期 vs 上期）、给页面加自动生成的洞察文案。
2. **分层信息架构**：KPI 条 → 主趋势 → 节奏/目标侧栏 → 洞察 → 薄弱点诊断 → 分布，单一纵向流改为响应式网格。
3. **新增核心交互**：区间切换（7/30/90/全部）+ 趋势指标切换（句数/准确率/场次），让同一份数据能被用户「切着看」。
4. **薄弱点可操作化**：支持按 CEFR/话题筛选、按错误率/次数排序、单句「去练习」与「加入复习」。
5. **零新图表依赖**：沿用现有手写 SVG 路线（不引入 recharts/echarts），保持 bundle 精简，主题色全部走 `--ds-*` 语义 token。

---

## 二、信息架构（目标布局）

```
┌───────────────────────────────────────────────────────────┐
│ 命令栏：标题 + 区间(7/30/90/全部) + 指标(句数/准确率/场次)   │
├───────────────────────────────────────────────────────────┤
│ KPI 条 ×4：准确率 · 本周句数 · 连续打卡 · 活跃天数          │
│   （每卡：大字 mono + ▲▼ 涨跌 + 迷你 sparkline）            │
├──────────────────────────────┬────────────────────────────┤
│ 趋势分析（占 8 列）            │ 练习节奏热力图（占 4 列）   │
│  - 本期实线 + 上期虚线对比     │  - 近 18 周 GitHub 式热力  │
│  - hover tooltip              │ 目标进度双环（日/月）        │
│  - 点击某天 → 复用 DayDrawer   │                            │
├───────────────────────────────────────────────────────────┤
│ 智能洞察 ×3（规则引擎自动生成文案）                          │
├──────────────────────────────┬────────────────────────────┤
│ 薄弱点诊断（占 8 列）          │ 分布视图（占 4 列）         │
│  - CEFR/话题筛选 + 排序        │  - CEFR 等级错误分布        │
│  - 常错句卡：错误率/译文/词    │  - 高频常错话题             │
│    去练习 / 加入复习           │  - 词库完成度               │
└──────────────────────────────┴────────────────────────────┘
```
移动端（≤880px）：所有区块塌缩为单栏，KPI 2×2。

---

## 三、功能模块与验收标准

### M1 · 命令栏（CommandBar）
- **区间切换**：7天 / 30天 / 90天 / 全部。默认 30 天。
- **指标切换**：句数 / 准确率 / 场次。默认句数。
- 切换区间/指标时，趋势图与 KPI 旁注同步刷新（区间切换重拉一次 `GET /api/dashboard/calendar?days=N`；指标切换仅前端改渲染，不重拉）。
- 验收：切换 7↔90 时图表点数与坐标随之变化；URL 不强制同步（分区已用 `?section=` 作为唯一真相源，避免冲突）。

### M2 · KPI 条（KpiStrip）
- 4 张卡：**准确率**（来自 `snapshot.progress.accuracy.value`，delta 来自 `.delta`）、**本周句数**（`progress.sentences`）、**连续打卡**（`snapshot.streak.current`）、**活跃天数**（由 `snapshot.calendar` 统计 `sentences_count>0` 的天数，区间跟随命令栏）。
- 每张卡含：标签、mono 大字、▲▼— 涨跌 chip（绿/珊瑚/灰）、sparkline（由区间序列前端计算）。
- 验收：连续打卡卡 delta 为 0 时显示「—」；无数据时数字显示「—」而非 0/100。

### M3 · 趋势分析（TrendChart v2）
- 数据源：区间序列来自 `GET /api/dashboard/calendar?days=2N`（一次拉 2N 天，前 N 为「上期」、后 N 为「本期」），作本期实线 + 上期虚线对比。
- 指标切换：句数（左轴绝对数）/ 准确率（0–100%，右轴）/ 场次（sessions_count）。
- 交互：hover 显示 日期+数值 tooltip；点击某天点 → 复用现有 `DayDetailDrawer`（`GET /api/dashboard/day/{date}`）。
- 主题：线条/面积颜色走 `--ds-action` / `--ds-correct-fill`，无内联 hex。
- 验收：准确率序列空值天不绘制断点；tooltip 不遮挡图表。

### M4 · 练习节奏热力图（HeatmapPanel）
- 渲染近 18 周（126 天）×7 网格，颜色深浅映射当日 `sentences_count` 分桶（0/低/中/高/极高）。
- 未来日期显示为虚线占位格。hover 显示「日期 + 句数 + 准确率」。
- 底部标注「X / Y 天有练习」。
- 验收：未来格不可点击；数据缺失天显示为最低档而非断裂。

### M5 · 目标进度双环（GoalRings）
- 复用 DS `ProgressRing`：每日目标环（`snapshot.daily_goal.pct`）、每月目标环（`snapshot.monthly_goal` 的 current/target 比例）。
- 环下标注目标文案（如「每日 20 句」）。
- 验收：0% 时环显示 12 点锚点（ProgressRing 已有该兜底）。

### M6 · 智能洞察（InsightsRow）
- 规则引擎（前端基于 snapshot 计算，无需新接口）：
  - 连续打卡 ≥1 → 「已连续 N 天打卡，再坚持 M 天解锁徽章」。
  - 准确率本周 vs 上周 delta → 「本周准确率较上周 提升/下降 X%」。
  - `preferred_hour` 非空 → 「你通常在 HH:00 练习，这是正确率最高效的时段」。
  - 活跃天数/区间 → 「本期 X/Y 天有练习」。
- 每卡一条，图标 + 文案；无数据时不渲染该卡（不显示空卡）。
- 验收：空用户（无活动）时洞察行整体隐藏，不报错。

### M7 · 薄弱点诊断（WeakPointsSection v2）
- 数据源不变：`GET /api/weakness?limit=50`（提高 limit 以支撑前端筛选/排序）。
- **筛选**：CEFR 等级 chips（A2/B1/B2/C1…）、话题 chips（语法/旅行/职场…），可组合；「全部」复位。
- **排序**：按错误率 / 按错误次数。
- 每句卡：错误率徽标（高≥65% 珊瑚 / 中≥50% 琥珀 / 低 薄荷）、中文译文、目标词 chips、底部「错 N · 共 M 次 · 等级/话题」。
- 操作：「去练习」→ `onStartLib(lib_id)`（现有逻辑）；「加入复习」→ 复用云端收藏 `addToCollection`（使该句进入复习候选，理由 `favorite`）。
- 验收：筛选无结果时显示友好空态；拉取失败降级为内联提示，不阻塞其它区块；空用户显示「还没有常错句」。

### M8 · 分布视图（DistributionPanel）
- CEFR 等级错误分布（横向条形，来自 `weakness.weak_cefr`）。
- 高频常错话题（来自 `weakness.weak_topics`）。
- 词库完成度（来自现有 `LearnedLibProgress` 的 localStorage + catalog 逻辑，抽成可复用函数）。
- 验收：条形最大值为 100% 宽；空数据不渲染该子块。

### M9 · 词库进度（保留）
- 现有 `LearnedLibProgress` 逻辑保留，移入分布视图或独立卡，数据源不变（localStorage 进度 + `GET /api/content/catalog`）。

---

## 四、后端接口改造清单

> 原则：尽量在现有契约上**增量扩展**，避免破坏式变更；新增只读聚合，保持单用户聚合的 O(days) 成本。

| # | 改动 | 位置 | 说明 | 风险 |
|---|------|------|------|------|
| B1 | `GET /api/dashboard/calendar` 增加 `days` 查询参数 | `routers/dashboard.py` | 当前忽略 query；加 `days: int = Query(default=35, le=180)`，透传给 `compute_calendar(days=...)`。支撑 M1/M3/M4 的区间拉取（前端一次拉 2N 做对比）。 | 低（透传已有参数） |
| B2 | （可选）`GET /api/analytics/trend?range=&metric=` | 新增 `routers/analytics.py` | 服务端按区间聚合，避免前端拉 2N 全量。范围 90/全部时更省流量。 | 中（需新表/聚合，待 DB 验证） |
| B3 | `GET /api/weakness` 增加 `sort` / `cefr` / `topic` 参数 | `routers/weakness.py` | 服务端筛选+排序，前端无需本地过滤。若暂不实现，M7 可纯前端筛选（本方案默认前端筛选，B3 为性能增强）。 | 低（现有 SQL 加 WHERE/ORDER） |
| B4 | （前瞻）`practice_sessions` 时长聚合 | `activity_service.py` | 新增「学习时长」指标需 `ended_at - started_at` 聚合；当前 `DailyActivity` 无分钟列，需新增迁移或在聚合时 JOIN `practice_sessions`。**本方案 M 系列不依赖时长，列为 Phase 2。** | 高（需迁移） |

**本方案默认落地范围**：B1（必做，前端区间/对比依赖）+ B3 前端筛选版（不强制后端）。B2/B4 作为 Phase 2 候选，已在需求中标注但不在首批实现。

---

## 五、指标定义（口径统一）

| 指标 | 定义 | 数据源 |
|------|------|--------|
| 准确率 | 正确句数 / 总句数（区间聚合） | `daily_activity.correct_count / sentences_count` |
| 活跃天数 | 区间内 `sentences_count>0` 的天数 | `daily_activity` |
| 连续打卡 | 当前连续天数 | `user_streaks.current_streak` |
| 场次 | 区间 `sessions_count` 之和（或天数计数） | `daily_activity.sessions_count` |
| 错误率（句） | 错次数 / 总尝试次数 | `practice_attempts`（weakness 聚合） |

对比基准统一为「前等长窗口」（本期 N 天 vs 前 N 天），与现有 `compute_kpis` 的周对比口径一致。

---

## 六、非功能需求

- **性能**：区间≤30 天沿用快照内 `calendar`（35 天）；切换更大区间才额外调 `calendar?days=`。懒加载保持（`DataSection` 仍 `dynamic(ssr:false)`）。
- **可访问性**：图表 `role="img"` + `aria-label`；涨跌用颜色+箭头双编码；筛选/切换均为原生 `<button>`。
- **响应式**：12 列网格在 ≤880px 塌缩为单栏，KPI 2×2。
- **主题**：所有颜色走 `--ds-*`，不出现裸 hex；暗/亮主题自动适配（沿用 `[data-theme]` 映射）。
- **降级**：任一子区块拉取失败仅该块内联报错；薄弱点为非阻塞。

---

## 七、实施路线（分阶段）

- **Phase 1（本次落地）**：M1–M9 全部前端实现 + 后端 B1。复用现有 `GET /api/dashboard` / `calendar` / `weakness`，薄弱点筛选排序走前端。新增组件：`DataCommandBar`、`KpiStrip`、`HeatmapPanel`、`GoalRings`、`InsightsRow`、`DistributionPanel`，并重写 `TrendChart` 与 `WeakPointsSection`，`DataSection` 改为网格编排。
- **Phase 2（增强）**：后端 B2 服务端趋势聚合、B3 服务端薄弱点筛选、B4 学习时长指标、洞察规则扩到 8–10 条、导出（PNG/CSV）。
- **Phase 3（个性化）**：默认区间/指标持久化到 localStorage；可钉选 KPI；热力图点击跳转日详情（复用 Drawer）。

---

## 八、风险与取舍

1. **90 天/全部区间流量**：前端一次拉 2N 天（全部=240 天）calendar 略重；Phase 2 用 B2 服务端聚合解决。首批可接受。
2. **薄弱点筛选前端 vs 后端**：前端筛选依赖 `limit=50` 已覆盖大部分用户；超大量常错句用户（>50）Phase 2 用 B3 兜底。
3. **学习时长缺字段**：不在首批，避免引入 DB 迁移风险。
4. **Heatmap 上限 18 周**：视觉定宽，超出区间不横向滚动；若选「全部」且 >18 周，取最近 18 周渲染（标注「近 18 周」）。
