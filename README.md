# 英语学习 Web 应用

听音写句 — 播放句子音频，用户根据音频输入完整句子。

## 项目角色

这套代码维护三个角色 — **CMS 主机**（生产内容）、**dev / prod 目标机**（只跑容器）、**TencentDB**（外部共享 Postgres，云上独立服务）。一台机器可以同时扮演多个角色（单机 CMS+dev+prod 是常见部署），但脚本路径按角色分开管理：

| 角色 | 根目录入口 | 详细脚本 | 数据库 |
|---|---|---|---|
| CMS 主机（生产内容） | — | `cms/scripts/*.sh` | 把 staging 内容 UPSERT 到 **TencentDB**（外部云 db） |
| 开发目标机 | `./dev.sh` | `ops/dev/*.sh` | 读 **TencentDB**（`.secrets/database_url`） |
| 生产目标机 | — | `ops/prod/*.sh` | 读 **TencentDB**（`.secrets/database_url`） |

dev / prod 目标机只跑 backend + frontend（dev 还有 compose watch 做热重载），**没有 db 容器、没有 .env 文件**。运行时数据库（TencentDB）是外部依赖 —— backend 容器通过 compose `secrets:` block 把 host 侧的 `.secrets/database_url` 挂进来，DSN 进 `DATABASE_URL_FILE=/run/secrets/database_url`。Backend 不需要知道 db 在哪；网络可达、DSN 对即可。`POSTGRES_PASSWORD` 不再需要 —— 密码写进 `.secrets/database_url`，由 `db/scripts/bootstrap_tencent.sh` 在每个 host 一次性 setup 时写入。

## 仓库结构（按角色）

| 目录 | 内容 | 文档 |
|---|---|---|
| `backend/` | FastAPI 纯读层（无 AI / TTS / 无 db 连接配置） | [`backend/README.md`](backend/README.md) |
| `frontend/` | Next.js 14 app（单页练习 UI） | [`frontend/README.md`](frontend/README.md) |
| `cms/` | 内容服务（源 + CMS 工具链；把文件写到 `cms/content/`，由 db 侧 import 到云 db） | [`cms/README.md`](cms/README.md) |
| `db/` | db 工具链（importer / migrations / init_schema / cloud-db bootstrap） | [`db/README.md`](db/README.md) |
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
make dev-doctor    # 只读诊断(docker / images / drift / cloud-db 可达性)
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

```bash
# (一次性,首次) 在共享 TencentDB 上为本机创建 ROLE/DB + 写 .secrets/database_url
make db-bootstrap-dev            # 等价 ./ops/dev/setup.sh bootstrap

# 之后每次都跑(idempotent)
make dev-setup                   # 验 cloud-db 契约 + build dev 应用镜像
make dev-doctor                  # 前置检查(docker + compose + images + cloud-db 可达性)
make dev-start                   # 起来 — 自动用 .secrets/database_url
make dev-logs                    # 看日志
make dev-stop                    # 停
make dev-restart                 # 硬重启(≈5s,重新加载 secrets)
make dev-migrate                 # 改了 backend/migrations/versions/*.py 后:把新 schema 应用到云 db
```

> 没装 docker / daemon 没起,`make dev-doctor` 会直接报错,先装 docker。
> 没 `.secrets/database_url` 也没 `DATABASE_URL` 环境变量,`make dev-doctor` 会提示跑 `make db-bootstrap-dev`(cloud-db 主机)或 `export DATABASE_URL=postgres://...`(自管 / CI)。

访问:
- 前端: <http://localhost:3000>
- API: <http://localhost:8000/docs>(Swagger UI)

### `dev-setup` 做什么

`make dev-setup` 把 dev 跑起来所需的镜像 + 凭据摆到位,**不启动容器、不动 secrets、不 push**:

1. **Preflight** —— docker / compose 必须在
2. **cloud-db 契约** —— 验证 `.secrets/database_url` 存在(cloud-db 主机)或 `DATABASE_URL` 在 shell env(自管 / CI)。任一就绪即可
3. **dev app images** (`english_backend_dev` + `english_frontend_dev`) —— 缺失就 build
4. **Final summary** —— 提示下一步 `make dev-start`

需要换 CORS 白名单:`ALLOWED_ORIGINS=https://my.domain make dev-start`

### schema 改了之后

dev 改了 `backend/migrations/versions/*.py` 的话:

```bash
make dev-migrate                 # 把新 schema 应用到云 db(host-side runner)
```

`make dev-migrate` 在 host 跑 `pipeline.migrations.runner`(需要 python3 + psycopg2-binary + sqlalchemy 已装,这些 `db/scripts/init_schema.sh` / `import_staging.sh` 也要用,所以一次性装好就行)。Idempotent。backend 下次请求自动捡新 schema(uvicorn hot reload)。

> dev 自带 `cms/content/` 是 git tracked —— 改了 CSV / sentence / audio 后 commit + git pull,然后在 CMS 主机(或有 `DATABASE_URL` 的任何机器)上跑 `make db-import` 把 staging 内容 UPSERT 到云 db。dev 主机不用跑这步。

## 镜像发布(可选,无 registry 时跳过)

dev 主机 **不 push**(dev 是开发机,image 留在本地,跑 build 后直接 start)。
prod 主机推自己的 backend+frontend 镜像。

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

### 推荐:Tencent Cloud 部署走 TCR(腾讯云容器镜像服务)

如果你的 prod 是腾讯云 CVM,**强烈建议用 TCR 替代 dockerhub**:

1. 腾讯云控制台 → 容器镜像服务 TCR → 创建**个人版**实例
2. 在实例里建命名空间(例如 `type-any-language`)
3. 创建访问凭证(临时 token,或给 CVM 绑 RAM role 实现免密)
4. 在仓库根 `REGISTRY` 文件填一行:
   ```
   DOCKER_REGISTRY=ccr.ccs.tencentyun.com/your-tcr-id/type-any-language
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
- 跟 TencentDB 同控制台,运维心智统一
- RAM role 可让 CVM 免 `docker login`

如果只有 1 台 CVM 且不想用 registry,也可以走 scp 路径
(`docker save` → scp → `docker load`),但失去了版本回滚能力,
多机部署也麻烦。

## 生产环境

```bash
# (一次性,首次) 在共享 TencentDB 上为 prod 创建 ROLE/DB + 写 .secrets/database_url
make db-bootstrap-prod           # 等价 ./ops/prod/setup.sh bootstrap

# 之后每次都跑
make prod-setup                  # 验 cloud-db + build prod 应用镜像
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

If you're upgrading from a pre-cloud-db release that used a baked `db` image + `.secrets/postgres_password` + `db-data` named volume, clean up the orphan artifacts after pulling this release:

```bash
# Drop the orphan db container + volume (data = baked content, drop is safe)
docker compose -f docker-compose.dev.yml down -v   # or docker-compose.yml on prod

# Drop the orphan secrets file (no longer read)
rm -f .secrets/postgres_password

# Bootstrap the cloud db (writes .secrets/database_url)
make db-bootstrap-dev    # or make db-bootstrap-prod
```

After that, `make dev-start` (or `make prod-start`) works as in a fresh install.