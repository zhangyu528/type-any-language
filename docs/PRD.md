# type-any-language — 产品需求文档 (PRD)

**版本**：v1.5（v1.4 基础上：明确"动效是产品核心，反馈形式由 Design Brief 规定"）
**状态**：as-built + as-planned
**最后更新**：2026-08-04
**关联文档**：
- 设计任务：[`docs/design-brief.md`](./design-brief.md)（视觉与交互规范）
- Guest 体验规约：[`frontend/docs/guest-practice-experience.md`](../frontend/docs/guest-practice-experience.md)
- 架构与实现：[`CLAUDE.md`](../CLAUDE.md)
- 历史产品 PRD：[`docs/前端UI功能PRD.md`](./前端UI功能PRD.md)

---

## 0. 文档定位

本文档是 **产品需求文档**，回答三件事：

1. 这个应用**是什么**
2. 用户在每个场景**做什么**
3. **不做**什么

| 本文是 ✅ | 本文不是 ❌ |
|---|---|
| 产品功能、用户旅程、信息架构 | 视觉规范、具体颜色 / 字体 / 间距值 |
| 行为规则（功能层面） | 行为规则（设计层面，例：动效用什么曲线） |
| 业务边界与本期"不做"清单 | 具体 API 路径、代码行号 |

**所有视觉与交互规范在 [`docs/design-brief.md`](./design-brief.md)。**

| 读者 | 看什么 |
|---|---|
| **产品经理** | 全文 |
| **UX/UI 设计师** | Design Brief 为主 + 本文档了解产品语境 |
| **前端工程师** | Design Brief（视觉）+ CLAUDE.md（实现） |
| **新成员** | §1 一句话定位 + §2 用户旅程 |

---

## 1. 产品定位与功能背景

### 1.1 一句话定位

**听一句，写一句，把英语练出肌肉记忆。**
语料取自日常场景，不是课本例句。

### 1.2 核心循环（唯一的练习模式）

```
选词库 → 听句子音频 → 逐字输入完整句子 → 即时反馈 → 继续下一题
```

围绕这一种核心循环，应用提供三个递进层次：

1. **游客**：零阻力进入练习，本地保存进度，进步时刻轻引导注册
2. **学习者**：账号登录后获得日目标 / 连续打卡 / 进度可视化
3. **内容运营（不在 UI 内）**：在 CMS 主机维护词库 + 句子 + 音频

整个应用**只服务"听音写句"一种练习模式**：无积分商城、无社交、无关卡。

### 1.3 用户的核心需求

- **快速开始**：从落地页到第一题应在 2 次点击以内
- **清晰反馈**：每敲一个字符立刻知道对错
- **持续动力**：日目标、连续天数、命中率提升是 3 个最重要的"动力锚"
- **不被数据淹没**：dashboard 5 个 tile 足够，不堆图表

---

## 2. 用户旅程

### 2.1 首次访问（游客路径）

```
浏览器打开 /
  → 落地页渲染
  → 用户点 CTA
  → 直接进入练习会话
  → 听 → 写 → 对 → 下一题
  → 命中进步时刻（规则见 Guest 体验规约）
  → 弹出引导卡（轻引导注册，可关闭）
  → 用户可关闭卡片继续练习
```

### 2.2 首次访问（学习者路径）

```
浏览器打开 /
  → 鉴权完成，user 已登录
  → 跳转到 dashboard
  → 加载 dashboard 数据（一次性 payload）
  → 渲染：5 个 tile
  → 首次登录：dashboard 显示空态 + "选词库开始" CTA
  → 点击 ContinueCard 或 LibPicker 模态 → 跳练习页
```

### 2.3 单题循环

```
听音（用户主动触发播放）
  → 用户逐字输入
  → 字符级即时反馈（对 / 错必须有视觉区分，反馈形式由 Design Brief §3 规定）
  → 空格键提交当前格
  → 整句空格键提交
  → 校对（本地归一化）
    - 正确 → 短暂延迟 → 下一题
    - 错误 → 视觉提示 → 当前题重置或允许继续
```

### 2.4 一次完整会话结束

```
最后一题提交
  → 显示本场得分（正确数 / 总数）
  → 登录用户：
      写入练习会话（服务端 start / step / end 三段式）
      触发日活 + streak 回填
      跳 dashboard 显示更新后的 tile
  → 游客：
      本地保存进度
      引导卡按规约触发
```

---

## 3. 功能需求

> 本章描述每个功能"做什么"。**视觉与交互形式由 Design Brief 规定**。

### 3.1 词库选择

- 词库来自 `GET /api/content/catalog`，每个 lib 有名称、词数、默认难度
- 难度档：`beginner` / `intermediate` / `advanced`（本期全 lib 共用）
- 选择持久化：游客 localStorage；登录用户 dashboard LibPicker + 服务端会话记录

### 3.2 音频播放

- 播放源：`sentences.audio_url`（Tencent COS 公网直连，**后端不代理**）
- 控件：播放/暂停、倍速（0.5x / 1x / 2x）、循环、重新播放
- 浏览器自动播放策略必须尊重（首次播放需用户主动触发）
- 切到新题时播放状态重置
- 倍速偏好持久化（`prefs.audioRate`）

### 3.3 句子输入（核心交互）

- 整句按空格切成单词格子（**等宽字体保证逐字对齐**）
- 屏幕上有且仅有一个聚焦输入机制
- **字符级即时反馈**：每字符对/错有视觉区分
- 空格键作为"跳下一格 / 提交"的统一触发
- 答错时空格不切下一格，给视觉提示
- 答对最后一格 + 短暂延迟（≈300ms）→ 自动切下一题

### 3.4 答案归一化（本地规则）

- 大小写不敏感
- 标点忽略（`.` `,` `!` `?` `;` `:` `'` `"`）
- 连续空白折叠
- 头尾空白忽略

### 3.5 Hint 与显示完整句子

- 字符级 hint：每格字符与标准对比的视觉提示
- 显示完整句子：用户主动触发，不默认显示
- 救命功能要克制使用

### 3.6 进度与计分

**题内进度**：当前题号 / 总题数 + 字符级对错即时反馈

**终局得分**：正确数 / 总数 + 命中率 + 本场用时（可选）

**累计进度（登录用户）**：
- **日历**（4 周）：单元格含 sentences_count + accuracy + 火焰节点；点击单格 → DayDetailDrawer
- **连续打卡**：current_streak + longest_streak + 链上的日期列表
- **当日目标环**：today_count / daily_goal + 环形进度 + 命中后展示"今日达标"
- **月度目标条**：current / monthly_goal + on_track 预测
- **KPI**（3 个）：命中率 / 句数 / 词数，各自带"对比上一窗口"delta

**累计进度（游客）**：仅本地保存。每 lib 的已练句数、命中率。不跨设备。

### 3.7 快捷键面板

- 常驻底部 `SunkenShortcutBar`：空格 / 回车 / Esc / Tab 等
- 不抢主区视觉

### 3.8 偏好记忆

| Key | 默认 | 范围 |
|---|---|---|
| `prefs.libId` | （首项） | UUID 字符串 |
| `prefs.defaultDifficulty` | `beginner` | beginner / intermediate / advanced |
| `prefs.audioRate` | `1` | 0.5 / 1 / 2 |
| `prefs.showPhonetic` | `false` | bool |

游客全 localStorage；登录用户本地优先 + 关键偏好（`daily_goal` / `monthly_goal` / `display_name`）服务端持久化。

### 3.9 导航与工具菜单

- **AppHeader**：固定顶部；登录态不同
- **游客右上角**：登录 / 注册按钮 → AuthModal（任意页面弹出）
- **已登录右上角**：头像 → 下拉菜单（个人中心 / 退出）
- **footer**：仅 LandingPage 露出。GitHub / 联系邮箱 / 版权；链接命中区 ≥ 24×24

### 3.10 登录 / 注册 / 退出

- **表单**：`AuthForm` 组件在 `/login` `/signup` 路由与 AuthModal 共用
- **注册**：邮箱 + 密码（最低长度校验）+ 显示名（可选）
- **登录**：邮箱 + 密码；成功后 Set-Cookie + 跳转 `from=` 参数
- **退出**：清 cookie + 跳 `/`
- **错误处理**：字段下方浮字，不顶部错误条；网络断 = 字段边框提示 + 顶部细条

### 3.11 工作台 `/dashboard`（登录必需）

5 个 tile 排布：

| 位置 | Tile | 内容 |
|---|---|---|
| 顶部 | GreetingBar | 头像 + 显示名 + 连续天数 + streak chain |
| 左上 | ContinueCard | "Resume / Practice again" CTA |
| 左下 | DailyGoal | today_count / daily_goal + 环形进度 |
| 右侧 | WeeklyCalendar | 4 周方格 + 火焰节点 |
| 底部 | ProgressSnapshot | 3 KPI + delta |

**空态**：用户从未练习 → ContinueCard 显示 "暂无练习，去选库"；DailyGoal 显示 0/N；日历全灰；KPI 显示破折号"——"。

**模态选库**：`/dashboard?picker=1` 触发 `LibPicker`；选择后 `router.push('/practice?lib=X')`。

### 3.12 个人中心 `/me`（登录必需）

3 个 Tab，URL 化（`?tab=stats|wrong|settings`）：

| Tab | 内容 |
|---|---|
| **统计**（StatsTab） | 各 lib 进度柱图 + 命中率趋势 |
| **收藏夹**（CollectionTab） | 难句列表 + 重新播放 + 删除收藏 + "练这句" |
| **设置**（SettingsTab） | 显示名 / 每日目标 / 每月目标 / 音频速率 / 显示音标 / 危险区：清空所有本地数据 |

- 收藏夹本期仅 localStorage；云端同步留位未实装
- 危险区：清空按钮二次确认 + 不可撤销提示

---

## 4. 信息架构

### 4.1 路由 → 用途

| 路由 | 用途 | 鉴权 |
|---|---|---|
| `/` | 落地页；登录跳 /dashboard | 公开 |
| `/?lib=X` | 练习会话 | 公开 |
| `/dashboard` | 登录用户工作台 | 必需 |
| `/practice` | 独立全屏练习页 | 公开 |
| `/me` | 个人中心 | 必需 |
| `/login` | 登录表单 | 公开（已登录会被重定向） |
| `/signup` | 注册表单 | 公开 |
| `/design-system` | 设计语言活文档（开发期） | 开发期公开 |

### 4.2 常驻 UI 元素

- **AppHeader**：固定顶部
- **SunkenShortcutBar**：固定底部，仅练习页
- **ThemeToggle**：右上角（是否全页露出由设计师定）
- **footer**：仅 LandingPage 露出

### 4.3 模态视图

| 模态 | 触发 |
|---|---|
| **AuthModal** | 游客任意页面点登录 |
| **LibPicker** | `/dashboard?picker=1` |
| **DayDetailDrawer** | WeeklyCalendar 单格 |
| **PracticeHintCard** | 进步时刻（游客） |

### 4.4 不应出现的元素

- 弹出广告 / 横幅 / 推荐位
- 客服 / 反馈入口（仅 footer 邮箱）
- 移动 App 下载横幅
- 任何评分弹窗

---

## 5. 文案调性

- 中文为主；句子为英文
- **错误提示：说明 + 行动**，不羞辱
  - ✅ "网络断开，请重试"
  - ❌ "请求失败"
- **进步时刻：具体 + 不夸张**
  - ✅ "比上一句更好"
  - ❌ "你太厉害了！"
- **CTA：动词开头 + 价值**
  - ✅ "立即开始练习"
  - ❌ "Click here"
- 数字显示：四位数以上用千分位；百分比保留 1 位小数

---

## 6. 范围边界（本期"不做"清单）

| 不做 | 原因 |
|---|---|
| 游客进度合并到登录账号 | 需服务端接口 + 异步调用，本期未实装 |
| 邮件验证 | User 模型留字段位，phase 5 |
| 题量阈值 / 时间类触发器 | Guest 体验规约明确排除 |
| SRS 错题本 | 单一练习模式 + 单纯重复足够 |
| 收藏夹云同步 | 仍 localStorage |
| Per-user 时区 | 服务端只用 server-local date |
| 实时跨端同步 | 无 push / SSE |
| 移动 App / PWA 离线 | 仅 Web |
| 多语种内容 | 仅英文 |
| 任何形式的弹窗蒙黑 | 与"持续专注"产品定位冲突 |

---

## 7. 关联文档

| 文档 | 看什么 |
|---|---|
| [`docs/design-brief.md`](./design-brief.md) | 设计任务源头 |
| [`frontend/docs/guest-practice-experience.md`](../frontend/docs/guest-practice-experience.md) | Guest 体验规约 |
| [`CLAUDE.md`](../CLAUDE.md) | 架构 / API / 部署 |
| [`docs/前端UI功能PRD.md`](./前端UI功能PRD.md) | 历史 PRD v0.3.0 |

---

## 附录 A：变更历史

| 版本 | 日期 | 变更 |
|---|---|---|
| v0.3.0 | 2026-06-30 | `前端UI功能PRD.md` 现状（仅核心 dictation） |
| v1.0 | 2026-08-03 | 引入登录 / dashboard / me / streak / KPI |
| v1.1 | 2026-08-03 | 收敛到 UX/UI 焦点 |
| v1.2 | 2026-08-03 | 新增登录 / 注册页沉浸式设计 |
| v1.3 | 2026-08-04 | 标记 TAL Mint 为归档；改为语义占位 |
| v1.4 | 2026-08-04 | 删除所有 UX 主张 / 动效预设 / 视觉预设；只保留产品功能、用户旅程、信息架构、文案、边界；视觉与交互全部交由 Design Brief |
| v1.5 | 2026-08-04 | **本版本**。明确"字符级即时反馈"是必需的，反馈形式由 Design Brief §3 规定；避免被误读为"反馈可有可无" |
