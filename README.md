# 英语学习 Web 应用

听音写句 — 播放句子音频，用户根据音频输入完整句子。

## 项目分两个角色

这套代码同时维护 **CMS 主机**（生产内容、烤 db image）和 **目标主机**（dev / prod，只跑容器）。一台机器可以同时扮演两种角色，但脚本路径分开管理：

| 角色 | 根目录入口 | 详细脚本 | 配置文件 |
|---|---|---|---|
| CMS 主机（生产内容） | — | `scripts/ops/db/*.sh` | `.env.db` |
| 开发目标机 | `./dev.sh` | `scripts/ops/dev-host/*.sh` | **不需要** — shell env + `.secrets/` |
| 生产目标机 | — | `scripts/ops/prod-host/*.sh` | **不需要** — shell env + `.secrets/` |

CMS 主机把内容（词库 + AI 句子 + TTS 音频）烤进 db image，推到 registry。dev / prod 目标机只 `docker pull` 这个 image，不跑 AI、不跑 TTS、不需要 Python，也**不需要写 .env 文件** —— `POSTGRES_PASSWORD` 由 `run.sh` 首次启动时现场生成（写到 `.secrets/postgres_password`，chmod 600），CORS 等运行时配置通过 shell 环境变量覆盖。

## 仓库结构（按角色）

| 目录 | 内容 | 文档 |
|---|---|---|
| `backend/` | FastAPI 纯读层（无 AI / TTS） | [`backend/README.md`](backend/README.md) |
| `frontend/` | Next.js 14 app（单页练习 UI） | [`frontend/README.md`](frontend/README.md) |
| `db/` | postgres 镜像 + 内容烤入（CMS-only 工具链） | [`db/README.md`](db/README.md), [`db/pipeline/README.md`](db/pipeline/README.md) |
| `scripts/ops/{db,dev-host,prod-host}/` | 主机运维脚本 | 各脚本头部注释 |
| `nginx/` | nginx 反向代理（prod 入口） | — |

详细架构、数据流、环境变量说明见 [`CLAUDE.md`](CLAUDE.md)。

---

## 快速开始（开发环境）

```bash
# ./dev.sh 是根目录入口,等价于 scripts/ops/dev-host/run.sh
./dev.sh doctor     # 前置检查
./dev.sh start      # 起来(首次会现场生成 .secrets/postgres_password)
./dev.sh logs       # 看日志
./dev.sh stop       # 停
./dev.sh restart    # 硬重启(≈5s,重新加载 secrets)
```

> 没装 docker / daemon 没起,`./dev.sh doctor` 会直接报错,先装 docker。

访问:
- 前端: <http://localhost:3000>
- API: <http://localhost:8000/docs>(Swagger UI)

如果还没有 baked db image,要么:
- 等 CMS 主机推一份到 registry(设了 `DOCKER_REGISTRY` run.sh 会自动 pull);要么
- 在本机就地烤:`./scripts/ops/db/env.sh` 引导 `.env.db`,再 `./scripts/ops/db/bake_image.sh`。

需要换 CORS 白名单:`ALLOWED_ORIGINS=https://my.domain ./dev.sh start`

## 镜像发布(可选,无 registry 时跳过)

dev / prod 各推自己的 backend+frontend 镜像;db 镜像由 CMS 主机推。

```bash
# dev host: 推 backend_dev + frontend_dev
export DOCKER_REGISTRY=docker.io/youruser
./scripts/ops/dev-host/build_image.sh   # 本地构建
./scripts/ops/dev-host/push_image.sh -y # 推到 registry
```

## 生产环境

```bash
ALLOWED_ORIGINS=https://my.domain ./scripts/ops/prod-host/run.sh start
./scripts/ops/prod-host/run.sh doctor
./scripts/ops/prod-host/run.sh restart

# 镜像发布(可选)
export DOCKER_REGISTRY=docker.io/youruser
./scripts/ops/prod-host/build_image.sh
./scripts/ops/prod-host/push_image.sh -y
```

生产前端通过 nginx 在 `:80` 暴露。

## CMS 主机(生产内容)

```bash
./scripts/ops/db/env.sh                    # 第一次:引导 .env.db
./scripts/ops/db/content.sh doctor         # 前置检查
./scripts/ops/db/content.sh sync           # csv → 词库表
./scripts/ops/db/content.sh sentences      # OpenAI 批量填句子
./scripts/ops/db/content.sh audio          # 腾讯云 TTS 批量烤 MP3
./scripts/ops/db/bake_image.sh             # 烤 db image
export DOCKER_REGISTRY=...                 # 推前设一下
./scripts/ops/db/push_image.sh [-y]        # 推 registry
```

CMS 流程的细节(每个 Python 工具的参数、词库 CSV 格式、db image label 含义)
见 [`db/pipeline/README.md`](db/pipeline/README.md) 和 [`db/README.md`](db/README.md)。
