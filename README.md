# 英语学习 Web 应用

听音写句 — 播放句子音频，用户根据音频输入完整句子。

## 项目分两个角色

这套代码同时维护 **CMS 主机**（生产内容、烤 db image）和 **目标主机**（dev / prod，只跑容器）。一台机器可以同时扮演两种角色，但脚本路径分开管理：

| 角色 | 根目录入口 | 详细脚本 | 配置文件 |
|---|---|---|---|
| CMS 主机（生产内容） | — | `scripts/ops/cms/*.sh` | `cms/.env` |
| 开发目标机 | `./dev.sh` | `scripts/ops/dev-host/*.sh` | **不需要** — shell env + `.secrets/` |
| 生产目标机 | — | `scripts/ops/prod-host/*.sh` | **不需要** — shell env + `.secrets/` |

CMS 主机把内容（词库 + AI 句子 + TTS 音频）烤进 db image，推到 registry。dev / prod 目标机只 `docker pull` 这个 image，不跑 AI、不跑 TTS、不需要 Python，也**不需要写 .env 文件** —— `POSTGRES_PASSWORD` 由 `run.sh` 首次启动时现场生成（写到 `.secrets/postgres_password`，chmod 600），CORS 等运行时配置通过 shell 环境变量覆盖。

## 仓库结构（按角色）

| 目录 | 内容 | 文档 |
|---|---|---|
| `backend/` | FastAPI 纯读层（无 AI / TTS） | [`backend/README.md`](backend/README.md) |
| `frontend/` | Next.js 14 app（单页练习 UI） | [`frontend/README.md`](frontend/README.md) |
| `cms/` | 内容服务（源 + CMS 工具链 + Postgres image 构建上下文） | [`cms/README.md`](cms/README.md), [`cms/tools/cms/README.md`](cms/tools/cms/README.md) |
| `scripts/ops/{content,dev-host,prod-host}/` | 主机运维脚本 | 各脚本头部注释 |
| `nginx/` | nginx 反向代理（prod 入口） | — |

详细架构、数据流、环境变量说明见 [`CLAUDE.md`](CLAUDE.md)。

---

## 快速开始（开发环境）

```bash
# ./dev.sh 是根目录入口,等价于 scripts/ops/dev-host/run.sh
./dev.sh setup      # 首次:准备 image(自动 bake db + build dev apps,见下)
./dev.sh doctor     # 前置检查
./dev.sh start      # 起来(首次会现场生成 .secrets/postgres_password)
./dev.sh logs       # 看日志
./dev.sh stop       # 停
./dev.sh restart    # 硬重启(≈5s,重新加载 secrets)
./dev.sh migrate    # 改了 cms/tools/cms/migrations/versions/*.py 后:把新 schema 应用到正在跑的 runtime db
```

> 没装 docker / daemon 没起,`./dev.sh doctor` 会直接报错,先装 docker。

访问:
- 前端: <http://localhost:3000>
- API: <http://localhost:8000/docs>(Swagger UI)

### `setup` 做什么

`./dev.sh setup` 把 dev 跑起来所需的所有 image 摆到位,**不启动容器、不动 secrets、不 push**:

1. **db image** —— 按以下顺序找一个可用的:
   - 本地已有 → 用本地的
   - `DOCKER_REGISTRY` 显式配置(shell env 或 `REGISTRY` 文件) → `docker pull`
   - 本机有 `cms/.env`(或没有但 `env.sh init` 能 scaffold) → `env.sh doctor` 当 gate → **自动跑整条内容链**:起 `english_db` 容器 → `init-schema` → `sync` → `sentences`(AI) → `audio`(TTS) → `bake_image.sh`。每步都是 idempotent,重新跑不会重复烧钱

2. **dev app images** (`english_backend_dev` + `english_frontend_dev`) —— 缺失就 build

3. **Final summary** —— 提示下一步 `./dev.sh start`

> auto-detect 出来的 `docker.io/$USER` 当 DOCKER_REGISTRY 是 solo dev 兜底,只用于 push,不会自动 pull(避免 429)。

如果还没有 baked db image,要么:
- 让 `./dev.sh setup` 自动烤(本机有 `cms/.env` 或能 scaffold 时自动走完整链);要么
- 等 CMS 主机推一份到 registry(显式设了 `DOCKER_REGISTRY` run.sh 会自动 pull)。
- 手动(不走 setup):`./scripts/ops/cms/env.sh` 引导 `cms/.env`,再 `./scripts/ops/cms/bake_image.sh`。

需要换 CORS 白名单:`ALLOWED_ORIGINS=https://my.domain ./dev.sh start`

### schema 改了之后

dev 改了 `cms/tools/cms/migrations/versions/*.py` 的话:

```bash
# 升 source db(给将来 bake 用):起 english_db 后跑
./scripts/ops/cms/content.sh init-schema

# 升正在跑的 runtime db —— 轻量,不动 image、不 push、不 drop volume
./dev.sh migrate
```

`migrate` 用一次性 `python:3.11-slim` sidecar 跑 `pipeline.migrations.runner`,幂等。backend 下次请求自动捡新 schema(uvicorn hot reload)。

> 网络拉不到 `python:3.11-slim`(典型情况:docker registry mirrors 坏了)时,`migrate` 会失败并打印离线 fallback:用 `cms/tools/cms/migrations/apply_to_runtime.sql` 走 `docker exec ... psql`。但这个 SQL 只覆盖"老 db 升到当前 head",**不能**处理新加的 migration —— 那种情况得修 docker 网络。

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
./scripts/ops/cms/env.sh                    # 第一次:引导 cms/.env
./scripts/ops/cms/content.sh doctor         # 前置检查
./scripts/ops/cms/content.sh sync           # csv → 词库表
./scripts/ops/cms/content.sh sentences      # OpenAI 批量填句子
./scripts/ops/cms/content.sh audio          # 腾讯云 TTS 批量烤 MP3
./scripts/ops/cms/bake_image.sh             # 烤 db image
export DOCKER_REGISTRY=...                 # 推前设一下
./scripts/ops/cms/push_image.sh [-y]        # 推 registry
```

CMS 流程的细节(每个 Python 工具的参数、词库 CSV 格式、db image label 含义)
见 [`cms/tools/cms/README.md`](cms/tools/cms/README.md) 和 [`cms/README.md`](cms/README.md)。
