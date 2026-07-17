# cms —— 内容生产

这个目录是 **CMS 内容生产** 的根 —— CMS 主机上跑 Python 工具链、调用 OpenAI / 腾讯 TTS、把内容写到 **staging 文件** (`cms/staging/`)。**db image 本身** 在仓库根的 [`../db/`](../db/) —— 拆分后,这是两个并列的子项目,各自有 Dockerfile,职责清楚分开:

- `cms/` 写文件(E + T,只产出 staging 文件)
- `db/` 把 staging 文件灌进 db、烤 image(L + bake)

db 这边通过 `dbtools.importer` 把 staging 文件 UPSERT 进 Postgres,然后再 pg_dump 出 db image。CMS 这边的 Python 模块不再直接连 db。

目标主机(prod / dev)通过 `run.sh` 拉 db image,运行时**不**感知 `cms/` 目录,也不感知 `db/` 目录。

## 设计

`cms/` 按"角色"分两段:

```
cms/
├── source/             # 运维手写源,git 跟踪,人工 review
│   ├── manifest.yaml   # 内容清单(libs / difficulties / prompt tuning knobs)
│   ├── vocabulary/     # 每个 lib 的 CSV
│   └── prompts/        # LLM prompt 模板(sentences.yaml 等)
│
├── cms_pipeline/        # Python 包(manifest / import_vocab / generate_sentences / generate_audio / storage / env)
│
├── run.sh                # CMS driver 主入口(operator 第一个敲的; E+T 不含 L)
└── scripts/            # CMS 工具(operator 选跑的)
    ├── env.sh          # cms/.env 生命周期
    └── staging.sh      # file producer wrapper (sync / sentences / audio / export / doctor)
```

仓库根的 `db/` 目录是 db image 的构建上下文:

```
db/
├── Dockerfile          # postgres:15-alpine 包装,带 OCI labels;COPY init/01-content.sql
├── builder.py          # assemble(bundle) + build_image(target, tag, ...)
├── scripts/            # db 的 own entry points(独立于 CMS;orchestration 层)
│   ├── source_db.sh    # cms-source-db 容器 lifecycle(ensure / start / stop / status)
│   ├── init_schema.sh  # 调 python -m dbtools.init_schema(基础 DDL,幂等)
│   ├── migrate.sh      # 调 dbtools.migrations.runner(apply pending migrations)
│   ├── import_staging.sh  # 调 dbtools.importer —— 把 staging 文件 UPSERT 进 db
│   ├── build.sh        # export staging db → init/01-content.sql + docker build
│   ├── push.sh         # push english_db_content 到 DOCKER_REGISTRY
│   └── export_bundle.py # pg_dump staging db → SQL(不依赖 cms)
├── dbtools/             # Python 包 dbtools/(init_schema / migrations / importer / db_url)
└── init/01-content.sql # 由 db/scripts/build.sh 填(`.gitignore`d,运行时由 image 跑)
```

## 段对照

| 段 | 装什么 | 谁维护 | git 跟踪 | 进了 image 吗 |
|---|---|---|---|---|
| `cms/seed/` | 业务内容描述 | 运维(人工) | ✓ | 否(只是输入) |
| `cms/cms_pipeline/` | CMS 端 Python 工具集 | 开发者 | ✓ | 否(只在 CMS 主机跑) |
| `cms/scripts/` | 操作员对 cms 跑的 shell 工具 | 开发者 | ✓ | 否 |
| `db/`       | **被**烤进 db image 的构建上下文 | 半自动(bake 写 `init/01-content.sql`) | ✓ Dockerfile + builder.py + scripts/ | ✓ / 部分 |

`db/init/01-content.sql` 是 `db/scripts/build.sh` 的 **build 输入** —— 由它每次从在线 staging db 的 pg_dump 重新生成。`.gitignore` 了,仓库里只有 `Dockerfile`、`builder.py` 和 `db/scripts/` 是 commit 的。

## ETL 烘焙流程

```
                CMS 主机 (Python, 不连 DB)
cms/seed/vocabulary/*.csv                                                  (源)
        ↓  cms/scripts/staging.sh sync (import_vocab.py)                     (E: Extract)
cms/staging/vocabulary/<lib>.json
        ↓  cms/scripts/staging.sh sentences (generate_sentences.py, OpenAI)  (T: Transform)
cms/staging/sentences/<lib>.jsonl
        ↓  cms/scripts/staging.sh audio     (generate_audio.py, TTS → Storage)
        ↓      (audio_url 字段被填入; mp3 落到 COS 或 cms/.local/audio/)
cms/staging/sentences/<lib>.jsonl

                db 主机 (dbtools.importer, 连 staging db)
======================================================================  边界  ==
        ↓  db/scripts/import_staging.sh (dbtools.importer all)              (L: Load)
PostgreSQL staging db(vocabulary_libs + vocabulary_words + sentences)
        ↓  db/scripts/build.sh
        ↓    export_bundle.py → pg_dump → .bake-staging/data-bundle-v.../dump.sql
        ↓    cp dump.sql  → db/init/01-content.sql
        ↓    docker build db/
docker image english_db_content:vX.Y.Z          (带 OCI labels;只含 schema + sentences,无 audio)
        ↓  db/scripts/push.sh
registry/english_db_content:vX.Y.Z
        ↓  目标主机的 scripts/{prod,dev}-host/lifecycle.sh
docker compose up -d
        ↓
frontend 请求 /api/sentences/random
        ↓
后端返回 sentence + audio_url(完整 COS URL)
        ↓
浏览器直接拉 COS,后端不参与音频服务
```

## 责任划分:何时跑哪个脚本

| 你想... | 跑 |
|---|---|
| 编辑了 CSV / 改了 manifest / 改了 prompt | `cms/scripts/staging.sh sync\|sentences\|audio` (单步;仅写文件) |
| 把所有 staging 文件一次性灌到 staging db | `db/scripts/import_staging.sh` (dbtools.importer;幂等,re-run 无害) |
| 把整条 ETL + 灌 db 跑完 | `cms/run.sh` (E+T) **→** `db/scripts/import_staging.sh` (L) 两段独立跑 |
| 编辑了 CSV + 想马上出 image | `cms/run.sh` (CMS E+T) + `db/scripts/import_staging.sh` (L) + `db/scripts/build.sh` (bake) 三段独立 |
| 起 / 停 staging db 容器(无需跑 pipeline) | `db/scripts/source_db.sh` (ensure / start / stop / status) |
| 在 staging db 上建表 / 跑迁移 | `db/scripts/init_schema.sh` + `db/scripts/migrate.sh` |
| 改 db-image 的 Dockerfile / schema 形状 | `db/scripts/build.sh` 单独(只读 staging db,不跑 schema) |
| 发布新 image 到 registry | `db/scripts/push.sh` |

> **CMS 写的 vs db 管的 (ETL 拆分版)**:
> - CMS **E + T**:import_vocab / generate_sentences / generate_audio,只产文件
> - db **L**:dbtools.importer 把 staging 文件 UPSERT 进 staging db
> - db **bake**:source_db 容器、init_schema / migrate / build / push
> - **唯一的桥** 是 `cms/staging/` 这个目录。CMS 完全不知道 schema 长啥样;db 完全不知道 TTS / OpenAI 是啥

## Audio 流向(注意:db image 不带 audio)

- **生成**:`staging.sh audio` 调 Tencent TTS,MP3 写到 `Storage`(默认 `local_fs` 写到 `cms/.local/audio/`,或 `tencent_cos` 上传到 COS bucket)
- **持久化**:Storage 持有,`sentence.audio_url` 写为 `storage.public_url(key)`(local 是 `/audio/{hash}.mp3`,COS 是 `https://{bucket}.cos.{region}.myqcloud.com/audio/{hash}.mp3`)
- **bake**:`db/scripts/build.sh` 不会把 audio 烤进 db image —— db image 只含 `dump.sql`(`vocabulary_*` + `sentences` 表的数据,包括 `audio_url` 字段)
- **runtime**:target host 启动时 `01-content.sql` 加载,没有 audio init 步骤。前端读 `sentence.audio_url` 让浏览器直接拉

> 这个设计的好处:db image 保持小(schema + sentences,几 MB),改 audio 不用 re-bake db image(只重传 COS / 重跑 `staging.sh audio`)。代价:生产环境需要 COS 账号 + 流量费用。

## OCI labels

`db/scripts/build.sh` 写入下面这些(Dockerfile 里把它们声明成默认值,这样单独跑 `docker build db/` 也能 work):

| Label | 来源 | 消费者 |
|---|---|---|
| `type-any-language.role` | 写死 | 健全性检查 |
| `type-any-language.db.user` | `cms/.env` 里的 `$POSTGRES_USER` | `scripts/{dev,prod}-host/lifecycle.sh` → `DB_USER` |
| `type-any-language.db.name` | `cms/.env` 里的 `$POSTGRES_DB` | `scripts/{dev,prod}-host/lifecycle.sh` → `DB_NAME` |
| `type-any-language.content.version` | `cms/.env` 里的 `$DB_IMAGE_TAG` | `scripts/{dev,prod}-host/doctor.sh` 的日志行 |
| `type-any-language.content.baked-at` | 烘焙时的 `date -u` | `scripts/{dev,prod}-host/doctor.sh` 的日志行 |

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