# content —— 内容生产 / 内容装入 / 内容分发

这个目录是 **内容服务**(content service)的根 —— 唯一产生并装入 `english_db_content` 镜像的位置。目标主机(prod / dev)通过 `run.sh` 拉这个镜像,运行时**不**感知此目录的存在。

## 设计

`content/` 下面按"东西是什么 + 谁维护它"分三段:

```
content/
├── source/             # 运维手写源,git 跟踪,人工 review
│   ├── manifest.yaml   # 内容清单(libs / difficulties / prompt tuning knobs)
│   ├── vocabulary/     # 每个 lib 的 CSV
│   └── prompts/        # LLM prompt 模板(sentences.yaml 等)
│
├── tools/              # CMS 工具链 — 只活 CMS 主机,从不进 image
│   ├── Dockerfile      # cms-sidecar(LOCAL-ONLY sidecar,run scripts 在里头跑 python)
│   └── cms/            # Python 包(env / manifest / import_vocab / generate_* / export_bundle / init_schema / migrations)
│
└── runtime/            # 烤进 db image 的构建上下文 + bake 输出物(.gitignore'd)
    ├── Dockerfile      # postgres:15-alpine 包装,带 OCI labels
    ├── init/
    │   ├── 01-content.sql   # ← 不在仓库里;由 bake_image.sh 填
    │   └── 99-audio.sh      # ← 在仓库里;首启把 /seed/audio 拷到 /audio
    └── seed/
        └── audio/           # ← 不在仓库里;由 bake_image.sh 填(MP3s)
```

三段对照:

| 段 | 装什么 | 谁维护 | git 跟踪 | 进了 image 吗 |
|---|---|---|---|---|
| `source/` | 业务内容描述 | 运维(人工) | ✓ | 否(只是输入) |
| `tools/`  | 烘焙这些内容的 Python/Docker | 开发者 | ✓ | 否(只在 CMS 主机跑) |
| `runtime/` | **被**烤进 image 的产物 + image 构建上下文 | 半自动(bake 写) | 只 Dockerfile + 99-audio.sh | ✓ / 部分 |

`runtime/init/01-content.sql` 和 `runtime/seed/audio/` 是 `scripts/ops/content/bake_image.sh` 的 **build 输入** — 由它每次从在线 CMS 数据库和烤好的 MP3 集合重新生成。两个都 `.gitignore` 了,仓库里只有 `Dockerfile`、`init/99-audio.sh` 和本 `README.md` 是 commit 的。

## 烘焙流程

```
content/source/vocabulary/*.csv                       (源)
        ↓  scripts/ops/content/content.sh sync
        ↓  scripts/ops/content/content.sh sentences       (OpenAI)
        ↓  scripts/ops/content/content.sh audio           (Tencent TTS)
PostgreSQL(vocabulary_libs + vocabulary_words + sentences)
        ↓  scripts/ops/content/bake_image.sh
        ↓    export_bundle.py → .bake-staging/data-bundle-v.../
        ↓    cp dump.sql  → content/runtime/init/01-content.sql
        ↓    cp audio/    → content/runtime/seed/audio/
        ↓  docker build content/runtime/
docker image english_db_content:vX.Y.Z          (带 OCI labels)
        ↓  scripts/ops/content/push_image.sh
registry/english_db_content:vX.Y.Z
        ↓  目标主机的 scripts/{prod,dev}-host/run.sh
docker compose up -d
```

## 运行时行为(仅首次 `docker compose up`)

`/docker-entrypoint-initdb.d/` 按字母序跑脚本:

1. **`01-content.sql`** —— pg_dump 的输出。创建 `vocabulary_libs`、`vocabulary_words`、`sentences` 三张表(OWNER 是 image label 里烤进去的 `db.user`),然后插入所有行。
2. **`99-audio.sh`** —— 把 `/seed/audio/*.mp3` 拷到 `/audio/`(nginx 通过 `/audio/` 暴露的 `shared-audio` 具名卷)。

Postgres 只在 **首次 init**(数据目录为空)时跑这些。后续启动数据目录保留,这些脚本跳过 —— 但 `shared-audio` 卷也保留,所以音频照样能访问。

要一起清掉 DB 和音频(重新触发首次 init):

```sh
docker compose down -v          # -v 会把具名卷也删了
docker compose up -d            # 从烤好的 image 重新 init
```

## OCI labels

`bake_image.sh` 写入下面这些(Dockerfile 里把它们声明成默认值,这样单独跑 `docker build .` 也能 work):

| Label | 来源 | 消费者 |
|---|---|---|
| `type-any-language.role` | 写死 | 健全性检查 |
| `type-any-language.db.user` | `.env.db` 里的 `$POSTGRES_USER` | `run.sh` → `DB_USER` |
| `type-any-language.db.name` | `.env.db` 里的 `$POSTGRES_DB` | `run.sh` → `DB_NAME` |
| `type-any-language.content.version` | `.env.db` 里的 `$DB_IMAGE_TAG` | `run.sh` 的日志行 |
| `type-any-language.content.baked-at` | 烘焙时的 `date -u` | `run.sh` 的日志行 |

`db.user` 和 `db.name` 是 **唯一** 权威来源 —— 目标机的 `.env` 里没有这俩。不重新烤 image 就改这俩,启动时会报 `FATAL: role "..." does not exist`。

## 本地验 image

```sh
docker run --rm english_db_content:vX.Y.Z \
    pg_isready -U english_user -d english_learning
# 期望: /var/run/postgresql:5432 - accepting connections

docker inspect english_db_content:vX.Y.Z \
    --format '{{ index .Config.Labels "type-any-language.db.user" }}'
# 期望: english_user
```
