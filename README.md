# 英语学习 Web 应用

听音写句 — 播放句子音频，用户根据音频输入完整句子。

## 项目分两个角色

这套代码同时维护 **CMS 主机**（生产内容、烤 db image）和 **目标主机**（dev / prod，只跑容器）。一台机器可以同时扮演两种角色，但脚本路径分开管理：

| 角色 | 入口脚本 | 配置文件 |
|---|---|---|
| CMS 主机（生产内容） | `scripts/ops/db/*.sh` | `.env.db` |
| 开发目标机 | `scripts/ops/dev-host/*.sh` | **不需要** — 运行时配置走 shell env |
| 生产目标机 | `scripts/ops/prod-host/*.sh` | **不需要** — 运行时配置走 shell env |

CMS 主机把内容（词库 + AI 句子 + TTS 音频）烤进 db image，推到 registry。dev / prod 目标机只 `docker pull` 这个 image，不跑 AI、不跑 TTS、不需要 Python，也**不需要写 .env 文件** —— `POSTGRES_PASSWORD` 由 `run.sh` 首次启动时现场生成，CORS 等运行时配置通过 shell 环境变量覆盖。

---

## 快速开始（开发环境）

```bash
# 启动（如果 DOCKER_REGISTRY 已配置且 db image 已就绪，run.sh 会自动 pull）
./scripts/ops/dev-host/run.sh doctor     # 前置检查
./scripts/ops/dev-host/run.sh start      # 起来（首次会现场生成 .secrets/postgres_password）

# 访问
# 前端: http://localhost:3000
# API  : http://localhost:8000/docs
```

如果还没有 baked db image，要么：
- 等 CMS 主机推一份到 registry；要么
- 在本机就地烤：`./scripts/ops/db/env.sh` 引导 `.env.db`，再 `./scripts/ops/db/bake_image.sh`。

需要换 CORS 白名单：`ALLOWED_ORIGINS=https://my.domain ./scripts/ops/dev-host/run.sh start`

## 服务控制

```bash
./scripts/ops/dev-host/run.sh start      # 启动
./scripts/ops/dev-host/run.sh stop       # 停止
./scripts/ops/dev-host/run.sh restart    # 硬重启（≈5s，重新加载 secrets）
./scripts/ops/dev-host/run.sh logs       # 查看日志
./scripts/ops/dev-host/run.sh status     # 查看状态
./scripts/ops/dev-host/run.sh doctor     # 前置检查
```

## 镜像发布（可选，无 registry 时跳过）

```bash
export DOCKER_REGISTRY=docker.io/youruser
./scripts/ops/dev-host/build_image.sh   # 本地构建 backend + frontend image
./scripts/ops/dev-host/push_image.sh -y # 推到 registry（db image 由 CMS 主机推）
```

## 生产环境

```bash
ALLOWED_ORIGINS=https://my.domain ./scripts/ops/prod-host/run.sh start
./scripts/ops/prod-host/run.sh doctor
./scripts/ops/prod-host/run.sh restart

# 镜像发布（可选）
export DOCKER_REGISTRY=docker.io/youruser
./scripts/ops/prod-host/build_image.sh
./scripts/ops/prod-host/push_image.sh -y
```

生产前端通过 nginx 在 `:80` 暴露。

## CMS 主机（生产内容）

```bash
./scripts/ops/db/env.sh                    # 第一次：引导 .env.db
./scripts/ops/db/content.sh doctor         # 前置检查
./scripts/ops/db/content.sh sync           # csv → 词库表
./scripts/ops/db/content.sh sentences      # OpenAI 批量填句子
./scripts/ops/db/content.sh audio          # 腾讯云 TTS 批量烤 MP3
./scripts/ops/db/bake_image.sh             # 烤 db image
./scripts/ops/db/push_image.sh [-y]        # 推 registry
```

更多架构 / 数据流 / 环境变量说明见 `CLAUDE.md` 与 `db/pipeline/README.md`。