# 英语学习 Web 应用

听音写句 — 播放句子音频，用户根据音频输入完整句子。

## 项目角色

这套代码维护三个角色 — **CMS 主机**（生产内容）、**dev / prod 目标机**（只跑容器）、**docker postgres**（外部共享 Postgres，云上独立服务）。一台机器可以同时扮演多个角色（单机 CMS+dev+prod 是常见部署），但脚本路径按角色分开管理：

| 角色 | 根目录入口 | 详细脚本 | 数据库 |
|---|---|---|---|
| CMS 主机（生产内容） | — | `cms/scripts/*.sh` | 把 staging 内容 UPSERT 到 **docker postgres**（外部云 db） |
| 开发目标机 | `make dev-*` | `ops/dev/*.sh` | 读 **docker postgres**（`DATABASE_URL`） |
| 生产目标机 | — | `ops/prod/*.sh` | 读 **docker postgres**（`DATABASE_URL`） |

dev / prod 目标机只跑 backend + frontend（dev 走 host-native：uvicorn + `next dev` 直接在宿主机上跑，db 走 docker 容器），**没有 db 容器、没有 .env 文件**。运行时数据库（docker postgres）是外部依赖 —— backend 容器通过 compose `secrets:` block 把 host 侧的 `DATABASE_URL` 挂进来，DSN 进 `DATABASE_URL_FILE=/run/secrets/database_url`。Backend 不需要知道 db 在哪；网络可达、DSN 对即可。`POSTGRES_PASSWORD` 不再需要 —— 密码写进 `DATABASE_URL`，由 `db/scripts/migrate.sh` 在每个 host 一次性 setup 时写入。

## 仓库结构（按角色）

| 目录 | 内容 | 文档 |
|---|---|---|
| `backend/` | FastAPI 纯读层（无 AI / TTS / 无 db 连接配置） | [`backend/README.md`](backend/README.md) |
| `frontend/` | Next.js 14 app（单页练习 UI） | [`frontend/README.md`](frontend/README.md) |
| `cms/` | 内容服务（源 + CMS 工具链；把文件写到 `cms/content/`，由 db 侧 import 到云 db） | [`cms/README.md`](cms/README.md) |
| `db/` | db 工具链（importer / migrations / init_schema / docker postgres bootstrap） | [`db/README.md`](db/README.md) |
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
make dev-doctor    # 只读诊断(docker / images / drift / docker postgres 可达性)
make dev-logs      # 跟踪日志
make dev-migrate   # 应用 schema migrations (host-side runner,写云 db)
make release-show
make release-dev [X.Y.Z]
make release-prod [X.Y.Z]
# ... cms-vocab / cms-sentences / cms-audio /
#     db-bootstrap-dev / db-bootstrap-prod / db-import /
#     prod-* / build-*
```

`make help` 会列出全部 targets，按 host 角色分组（dev / prod / cms / db / release / meta）。

老的 `./ops/.../*.sh` 直接调用仍然 work（文件保持 executable），Makefile 只是统一入口。Windows 用户只要 Git Bash / WSL 自带 `make` 就能用，无需 chmod 任何东西。

---

## 快速开始（开发环境）

> 以下示例统一用 Makefile（推荐）。`./ops/.../*.sh` 直接调用也完全等价，但 Makefile 在 macOS / Linux / Windows (Git Bash / WSL) 行为完全一致，不需要 chmod。

dev 主机自己跑 docker postgres（`postgres:15-alpine`，数据在 `./.dev/data/postgres/`，gitignored）—— 没有外部云 db，没有 `.secrets/` 间接层，`DATABASE_URL` 由 compose 的 `environment:` 直接注入 backend 容器。

```bash
# 一次性: 装 host-native deps + 起 docker db
make dev-setup                     # preflight + 装 backend/.venv + frontend/node_modules + 起 db
make dev-doctor                    # 前置检查 (docker + compose + host python/node + ports + db 可达性)

# 起 host-native 进程 (uvicorn :8000 + next dev :3000,都连 docker postgres :5432)
make dev-start
# 起完会立即看: 「db 是空的 (vocabulary_libs = 0 行)」→ 提示跑 import_content

# 灌入内容 (CMS 主机: ./cms/run.sh 产出 cms/content/,rsync 到本机)
make dev-import-content            # 自动起 db(如需) → UPSERT → migrations/backfills
# 无需 restart;下一次 API 请求立即读到新内容

# 改了代码后
make dev-restart                   # 重起 backend + frontend 进程 (uvicorn/next 自动重载一般不需要)

# 改了 backend/migrations/versions/*.py 后
make dev-migrate                   # host-side runner,直接打 docker postgres

# 日常
make dev-logs [backend|frontend]   # tail native 进程日志
make dev-stop                      # 停两个 native 进程(db 留着)
```

需要换 CORS 白名单: `ALLOWED_ORIGINS=https://my.domain make dev-start`

> 没装 docker / daemon 没起,`make dev-doctor` 会直接报错,先装 docker。
> dev db 是 docker postgres,不需要任何 bootstrap 命令 —— dev-setup 只装 host-native deps 和起 db,所有 db 操作都在 start 时按需发生。

访问:
- 前端: <http://localhost:3000>
- API: <http://localhost:8000/docs>(Swagger UI)

### `dev-setup` 做什么

`make dev-setup` 把 dev 跑起来所需的本地环境摆到位,**不启动应用进程、不动 secrets、不 push**:

1. **Preflight** —— docker / compose / python3 / node 必须在
2. **host-native deps** —— `backend/.venv` (pip install) + `frontend/node_modules` (npm install),两个都用 SHA256 哈希感知,manifest 不变就跳过
3. **docker db** —— 拉起 `postgres:15-alpine` 容器(`./.dev/data/postgres/` bind-mount,gitignored)
4. **Final summary** —— 提示下一步 `make dev-start`

### 改 schema / 改内容 / 改代码

**改代码**(`backend/app/...` 或 `frontend/src/...`):保存即热重载 —— backend 是 uvicorn --reload,frontend 是 Next.js Fast Refresh。**不需要任何命令**。

**改了 `requirements.txt` / `package.json`** —— 重新感知 hash + 重装 deps,然后重起进程:
```bash
make dev-setup                      # 感知 hash 变化,自动 pip/npm install
make dev-restart                    # 重起两个进程让新 deps 生效
```

**改了 `backend/migrations/versions/*.py`**:
```bash
make dev-migrate                    # host-side 立即 apply,直接打 docker postgres
```

`make dev-migrate` 在 host 跑 `migrations.runner`(需要 python3 + psycopg2-binary + sqlalchemy 已装,这些 `db/scripts/init_schema.sh` / `import_staging.sh` 也要用,所以一次性装好就行)。Idempotent —— re-runs are no-ops。

**CMS 内容更新**(同事改了 CMS,产出新 staging):
```bash
rsync cms-host:cms/content/ ./cms/content/
make dev-import-content            # 自动起 db(如需) → UPSERT → migrations/backfills；无需 restart
```

dev 自带 `cms/content/` 是 git tracked,但 commit + pull 之后还需要 `make dev-import-content` 才会落到 dev db。

## 镜像发布(可选,无 registry 时跳过)

dev 主机 **不 build 任何 image** —— dev 是 host-native loop(uvicorn + `next dev` 直接跑在 host 上),没有 `english_backend_dev` / `english_frontend_dev` 这种 dev 镜像。prod 主机推自己的 backend+frontend 镜像。

```bash
# prod host: build + push
export DOCKER_REGISTRY=docker.io/youruser
make prod-build
make prod-push
```

> 看当前所有 per-segment VERSION 文件:`make release-show`
> 一站式 release(自动 bump + build + push):`make release-prod [X.Y.Z]`

### 推荐:Tencent Cloud 部署走 TCR(腾讯云容器镜像服务)

如果你的 prod 是腾讯云 CVM,**强烈建议用 TCR 替代 dockerhub**:

1. 腾讯云控制台 → 容器镜像服务 TCR → 创建**个人版**实例
2. 在实例里建命名空间(例如 `type-any-language`)
3. 创建访问凭证(临时 token,或给 CVM 绑 RAM role 实现免密)
4. 在仓库根 `REGISTRY` 文件填一行:
   ```
   DOCKER_REGISTRY=ghcr.io/zhangyu528/type-any-language
   ```
5. 第一次手动 `docker login ccr.ccs.tencentyun.com`(或 CVM 用 RAM role 跳过)

之后发版:
```bash
# 在本地 build 机
make release-prod v0.4.0 -y   # bump + build + push 到 TCR

# 在 CVM 上
ALLOWED_ORIGINS=https://my.domain make prod-restart  # 自动从 TCR pull + 重建
```

为什么推荐 TCR 而不是 dockerhub:
- CVM 同 VPC 内网拉取,无公网流量费
- 个人版免费额度够个人项目
- 跟 docker postgres 同控制台,运维心智统一
- RAM role 可让 CVM 免 `docker login`

如果只有 1 台 CVM 且不想用 registry,也可以走 scp 路径
(`docker save` → scp → `docker load`),但失去了版本回滚能力,
多机部署也麻烦。

## 生产环境

```bash
# (一次性,首次) prod 目标机(RUN 端)
make prod-bootstrap                 # 主机层:preflight + .secrets/db_password + /var/lib/.../postgres
make prod-deploy                  # 首次 / 后续都跑这个 —— 拉 3 image + recreate,
                                  # db image 的 entrypoint 自动 apply migrations + import content

# 之后每次都跑(RUN 端)
ALLOWED_ORIGINS=https://my.domain make prod-start
make prod-doctor
make prod-restart

# 发版(BUILD 端,在 release 机 / CI 上)
make release-prod v0.3.0          # bump + build + push 到 registry

# 镜像发布(可选)
export DOCKER_REGISTRY=docker.io/youruser
make prod-build
make prod-push
```

生产前端通过 nginx 在 `:80` 暴露。

## CMS 主机(生产内容)

```bash
eval "$(scripts/secrets/fetch_secrets.sh eval-cms)"   # 灌 AI_*/TENCENT_*/CLOUD_* 进进程环境
make cms-doctor                # 前置检查 (process env + Python deps)
make cms-vocab                 # csv → 词库表
make cms-sentences             # OpenAI 批量填句子
make cms-audio                 # 腾讯云 TTS 批量烤 MP3

# 把 staging 内容 UPSERT 到云 db(独立步骤,在 CMS 主机或任何能 reach 云 db 的机器)
make db-import                 # 等价 ./db/scripts/import_staging.sh all
```

> 一键跑完整 CMS 流水线(词库 → AI 句子 → TTS):`make cms-run`

CMS 流程的细节(每个 Python 工具的参数、词库 CSV 格式)见 [`cms/README.md`](cms/README.md)。

## Migrating an existing host

If you're upgrading from a pre-revision release (e.g. one that used a baked `db` image + `.secrets/postgres_password` + `db-data` named volume, or the TencentDB cloud-db write path), clean up the orphan artifacts after pulling this release:

```bash
# Drop any orphan db container + volume (data baked at image build time
# is now derivable from cms/content/ via make dev-import-content — safe to drop)
docker compose -f docker-compose.dev.yml down -v   # or docker-compose.yml on prod

# Drop the orphan secrets file (no longer read)
rm -f .secrets/postgres_password
rm -f .secrets/database_url          # cloud-db-era artifact
rm -f .secrets/tencent_db_admin_url # cloud-db-era artifact

# Pull a fresh db image and bring the app stack up
make dev-start    # or make prod-start after editing .secrets/db_password
```

After that, `make dev-start` (or `make prod-start`) works as in a fresh install. The docker postgres bind-mounts to `./.dev/data/postgres/` (dev) or `/var/lib/type-any-language/postgres/` (prod — `chown 999:999` first); compose takes care of `docker pull postgres:15-alpine`, schema via `make dev-migrate`, and content via `make dev-import-content`.