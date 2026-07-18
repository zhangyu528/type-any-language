# 英语学习 Web 应用

听音写句 — 播放句子音频，用户根据音频输入完整句子。

## 项目分两个角色

这套代码同时维护 **CMS 主机**（生产内容、烤 db image）和 **目标主机**（dev / prod，只跑容器）。一台机器可以同时扮演两种角色，但脚本路径分开管理：

| 角色 | 根目录入口 | 详细脚本 | 配置文件 |
|---|---|---|---|
| CMS 主机（生产内容） | — | `cms/scripts/*.sh` | `cms/.env` |
| 开发目标机 | `./dev.sh` | `ops/dev/*.sh` | **不需要** — shell env + `.secrets/` |
| 生产目标机 | — | `ops/prod/*.sh` | **不需要** — shell env + `.secrets/` |

CMS 主机把内容（词库 + AI 句子 + TTS 音频）烤进 db image，推到 registry。dev / prod 目标机只 `docker pull` 这个 image，不跑 AI、不跑 TTS、不需要 Python，也**不需要写 .env 文件** —— `POSTGRES_PASSWORD` 由 `run.sh` 首次启动时现场生成（写到 `.secrets/postgres_password`，chmod 600），CORS 等运行时配置通过 shell 环境变量覆盖。

## 仓库结构（按角色）

| 目录 | 内容 | 文档 |
|---|---|---|
| `backend/` | FastAPI 纯读层（无 AI / TTS） | [`backend/README.md`](backend/README.md) |
| `frontend/` | Next.js 14 app（单页练习 UI） | [`frontend/README.md`](frontend/README.md) |
| `cms/` | 内容服务（源 + CMS 工具链 + Postgres image 构建上下文） | [`cms/README.md`](cms/README.md) |
| `ops/{dev,prod}/` | 目标机运维脚本(lifecycle / doctor / setup / build_image 等)+ 顶层 build/release 编排器 | [`ops/README.md`](ops/README.md) |
| `nginx/` | nginx 反向代理（prod 入口） | — |

详细架构、数据流、环境变量说明见 [`CLAUDE.md`](CLAUDE.md)。

---

## 统一入口：Makefile

整个仓库的运维入口在 `Makefile`。每个 target 内部都用 `bash <script> <subcommand>` 调用 —— **不依赖 `.sh` 文件的 unix executable 位**，所以在 macOS、Linux、Windows (Git Bash / WSL) 上行为完全一致。

```bash
make help          # 列出所有 target + 一句话用途(默认 goal)
make dev-setup     # 首次 bootstrap(等价 ./ops/dev/setup.sh)
make dev-start     # 启 dev 容器 + 后台 compose watch
make dev-stop
make dev-restart
make dev-doctor    # 只读诊断
make dev-logs      # 跟踪日志
make dev-migrate   # 应用 schema migrations
make dev-setup-content   # git pull 拿到新 cms/staging 后:重烤 db + restart
make release-show
make release-dev [X.Y.Z]
make release-prod [X.Y.Z]
# ... cms-env-init / cms-sync / cms-sentences / cms-audio /
#     db-bake / db-push / db-import / prod-* / build-*
```

`make help` 会列出全部 ~47 个 target，按 host 角色分组（dev / prod / cms / db / release / meta）。

老的 `./ops/.../*.sh` 直接调用仍然 work（文件保持 executable），Makefile 只是统一入口。Windows 用户只要 Git Bash / WSL 自带 `make` 就能用，无需 chmod 任何东西。

---

## 快速开始（开发环境）

> 以下示例统一用 Makefile（推荐）。`./ops/.../*.sh` 直接调用也完全等价，但 Makefile 在 macOS / Linux / Windows (Git Bash / WSL) 行为完全一致，不需要 chmod。

```bash
make dev-setup         # 首次:准备 image(自动 bake db + build dev apps,见下)
make dev-doctor        # 前置检查
make dev-start         # 起来(首次会现场生成 .secrets/postgres_password)
make dev-logs          # 看日志
make dev-stop          # 停
make dev-restart       # 硬重启(≈5s,重新加载 secrets)
make dev-migrate       # 改了 db/dbtools/migrations/versions/*.py 后:把新 schema 应用到正在跑的 runtime db
make dev-setup-content # git pull 了新的 cms/staging 内容后:按需烤 db image + 重启 dev 容器
```

> 没装 docker / daemon 没起,`make dev-doctor` 会直接报错,先装 docker。

访问:
- 前端: <http://localhost:3000>
- API: <http://localhost:8000/docs>(Swagger UI)

### `dev-setup` 做什么

`make dev-setup` 把 dev 跑起来所需的所有 image 摆到位,**不启动容器、不动 secrets、不 push**:

1. **db image** —— 按以下顺序找一个可用的:
   - 本地已有 → 用本地的
   - `DOCKER_REGISTRY` 显式配置(shell env 或 `REGISTRY` 文件) → `docker pull`
   - 本机有 `cms/.env`(或没有但 `make cms-env-init` 能 scaffold) → `make cms-env-doctor` 当 gate → **自动跑整条内容链**:起 `cms-source-db` 容器 → `make db-init-schema` → `make cms-sync` → `make cms-sentences`(AI) → `make cms-audio`(TTS) → `make db-bake`。每步都是 idempotent,重新跑不会重复烧钱

2. **dev app images** (`english_backend_dev` + `english_frontend_dev`) —— 缺失就 build

3. **Final summary** —— 提示下一步 `make dev-start`

> auto-detect 出来的 `docker.io/$USER` 当 DOCKER_REGISTRY 是 solo dev 兜底,只用于 push,不会自动 pull(避免 429)。

如果还没有 baked db image,要么:
- 让 `make dev-setup` 自动烤(本机有 `cms/.env` 或能 scaffold 时自动走完整链);要么
- 等 CMS 主机推一份到 registry(显式设了 `DOCKER_REGISTRY` 时 setup 会自动 pull)。
- 手动(不走 setup):`make cms-env-init` 引导 `cms/.env`,再 `make db-bake`。

需要换 CORS 白名单:`ALLOWED_ORIGINS=https://my.domain make dev-start`

### schema 改了之后

dev 改了 `db/dbtools/migrations/versions/*.py` 的话:

```bash
# 升 source db(给将来 bake 用):起 cms-source-db 后跑
make db-init-schema

# 升正在跑的 runtime db —— 轻量,不动 image、不 push、不 drop volume
make dev-migrate
```

`make dev-migrate` 用一次性 `python:3.11-slim` sidecar 跑 `pipeline.migrations.runner`,幂等。backend 下次请求自动捡新 schema(uvicorn hot reload)。

> 网络拉不到 `python:3.11-slim`(典型情况:docker registry mirrors 坏了)时,`make dev-migrate` 会失败并打印离线 fallback:用 `db/dbtools/migrations/apply_to_runtime.sql` 走 `docker exec ... psql`。但这个 SQL 只覆盖"老 db 升到当前 head",**不能**处理新加的 migration —— 那种情况得修 docker 网络。

## 镜像发布(可选,无 registry 时跳过)

dev 主机 **不 push**(dev 是开发机,image 留在本地,跑 build 后直接 start)。
prod 主机推自己的 backend+frontend 镜像;db 镜像由 CMS 主机推。

```bash
# dev host: 只 build,不 push,直接 start
make dev-build
make dev-start

# prod host: build + push
export DOCKER_REGISTRY=docker.io/youruser
make prod-build
make prod-push
```

> 看当前所有 per-segment VERSION 文件:`make release-show`
> 一站式 release(自动 bump + build + push):`make release-dev [X.Y.Z]` / `make release-prod [X.Y.Z]`

## 生产环境

```bash
ALLOWED_ORIGINS=https://my.domain make prod-start
make prod-doctor
make prod-restart

# 镜像发布(可选)
export DOCKER_REGISTRY=docker.io/youruser
make prod-build
make prod-push
```

生产前端通过 nginx 在 `:80` 暴露。

## CMS 主机(生产内容)

```bash
make cms-env-init              # 第一次:引导 cms/.env
make cms-staging-doctor        # 前置检查
make cms-sync                  # csv → 词库表
make cms-sentences             # OpenAI 批量填句子
make cms-audio                 # 腾讯云 TTS 批量烤 MP3
make db-bake                   # 烤 db image
export DOCKER_REGISTRY=...     # 推前设一下
make db-push                   # 推 registry
```

> 一键跑完整 CMS 流水线(同步 → AI 句子 → TTS → 写 staging db):`make cms-run`

CMS 流程的细节(每个 Python 工具的参数、词库 CSV 格式、db image label 含义)
见 [`cms/README.md`](cms/README.md)。
