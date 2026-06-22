# 英语学习 Web 应用

听音写句 — 播放句子音频，用户根据音频输入完整句子。

## 项目分两个角色

这套代码同时维护 **CMS 主机**（生产内容、烤 db image）和 **目标主机**（dev / prod，只跑容器）。一台机器可以同时扮演两种角色，但脚本路径分开管理：

| 角色 | 入口脚本 | 配置文件 |
|---|---|---|
| CMS 主机（生产内容） | `scripts/ops/db/*.sh` | `.env.cms` |
| 开发目标机 | `scripts/ops/dev-host/*.sh` | `.env.dev` |
| 生产目标机 | `scripts/ops/prod-host/*.sh` | `.env` |

CMS 主机把内容（词库 + AI 句子 + TTS 音频）烤进 db image，推到 registry。dev / prod 目标机只 `docker pull` 这个 image，不跑 AI、不跑 TTS、不需要 Python。

---

## 快速开始（开发环境）

```bash
# 第一次：初始化 .env.dev
./scripts/ops/dev-host/env.sh

# 启动（如果 DOCKER_REGISTRY 已配置且 db image 已就绪，run.sh 会自动 pull）
./scripts/ops/dev-host/run.sh doctor     # 前置检查
./scripts/ops/dev-host/run.sh start      # 起来

# 访问
# 前端: http://localhost:3000
# API  : http://localhost:8000/docs
```

如果还没有 baked db image，要么：
- 等 CMS 主机推一份到 registry；要么
- 在本机就地烤：`./scripts/ops/db/env.sh` 引导 `.env.cms`，再 `./scripts/ops/db/bake_image.sh`。

## 服务控制

```bash
./scripts/ops/dev-host/run.sh start      # 启动
./scripts/ops/dev-host/run.sh stop       # 停止
./scripts/ops/dev-host/run.sh restart    # 硬重启（≈5s，重新加载 .env.dev）
./scripts/ops/dev-host/run.sh logs       # 查看日志
./scripts/ops/dev-host/run.sh status     # 查看状态
./scripts/ops/dev-host/run.sh doctor     # 前置检查
```

## 生产环境

```bash
./scripts/ops/prod-host/env.sh          # 初始化 .env
./scripts/ops/prod-host/run.sh doctor
./scripts/ops/prod-host/run.sh start
```

生产前端通过 nginx 在 `:80` 暴露。

## CMS 主机（生产内容）

```bash
./scripts/ops/db/env.sh                    # 第一次：引导 .env.cms
./scripts/ops/db/content.sh doctor         # 前置检查
./scripts/ops/db/content.sh sync           # csv → 词库表
./scripts/ops/db/content.sh sentences      # OpenAI 批量填句子
./scripts/ops/db/content.sh audio          # 腾讯云 TTS 批量烤 MP3
./scripts/ops/db/bake_image.sh             # 烤 db image
./scripts/ops/db/push_image.sh [-y]        # 推 registry
```

更多架构 / 数据流 / 环境变量说明见 `CLAUDE.md` 与 `db/pipeline/README.md`。