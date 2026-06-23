# db —— 内容烤入的 Postgres image

这个目录是 **内容烤入的 db image** 的 Docker build 上下文,所有目标主机(prod / dev)都通过 `run.sh` 拉这个 image。

## 目录结构

```
db/
├── Dockerfile                    postgres:15-alpine 包装,带 OCI labels
├── README.md                     本文件
├── init/
│   ├── 01-content.sql            ← 不在仓库里;由 bake_image.sh 填
│   └── 99-audio.sh               ← 在仓库里;把 /seed/audio 拷到 /audio
└── seed/
    └── audio/                    ← 不在仓库里;由 bake_image.sh 填
```

`init/01-content.sql` 和 `seed/audio/` 是 `scripts/ops/db/bake_image.sh` 从在线 CMS 数据库和烤好的 MP3 集合生成的 **build 输入**。这俩 gitignore 了 —— 仓库里只有 `Dockerfile`、`init/99-audio.sh` 和本 `README.md` 是 commit 的。

## 烘焙流程

```
db/content/vocabulary/*.csv                     (源)
        ↓  scripts/ops/db/content.sh sync
        ↓  scripts/ops/db/content.sh sentences       (OpenAI)
        ↓  scripts/ops/db/content.sh audio           (Tencent TTS)
PostgreSQL(content_items + audio/*.mp3)
        ↓  scripts/ops/db/bake_image.sh
        ↓    export_bundle.py → .bake-staging/data-bundle-v.../
        ↓    cp dump.sql   → db/init/01-content.sql
        ↓    cp audio/     → db/seed/audio/
        ↓  docker build db/
docker image english_db_content:vX.Y.Z          (带 OCI labels)
        ↓  scripts/ops/db/push_image.sh
registry/english_db_content:vX.Y.Z
        ↓  目标主机的 scripts/{prod,dev}/run.sh
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