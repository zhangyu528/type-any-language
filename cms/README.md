# cms —— 内容生产

这个目录是 **CMS 内容生产** 的根 —— CMS 主机上跑 Python 工具链、调用 OpenAI / 腾讯 TTS、把内容写到 **staging db**。**db image 本身** 在仓库根的 [`../db/`](../db/) —— 拆分后,这是两个并列的子项目,各自有 Dockerfile,职责清楚分开:

- `cms/` 写数据(write)
- `db/` 烤 image(read + bake)

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
├── tools/              # CMS 工具链 — 只活 CMS 主机,从不进 image
│   ├── Dockerfile      # cms-sidecar(LOCAL-ONLY sidecar,run scripts 在里头跑 python)
│   └── cms/            # Python 包(env / manifest / import_vocab / generate_sentences / generate_audio / init_schema / migrations / storage)
│
└── scripts/            # CMS 主机操作员脚本(直跑,不走 image)
    ├── env.sh          # cms/.env 生命周期
    ├── content.sh      # content pipeline(sync / sentences / audio / export)
    ├── pipeline.sh     # 单机 CMS+dev 自动跑整条内容管线(5 步)
    └── full_bake.sh    # wrapper:pipeline.sh + db/scripts/build.sh
```

仓库根的 `db/` 目录是 db image 的构建上下文:

```
db/
├── Dockerfile          # postgres:15-alpine 包装,带 OCI labels;COPY init/01-content.sql
├── builder.py          # assemble(bundle) + build_image(target, tag, ...)
├── scripts/            # db 的 own entry points(独立于 CMS)
│   ├── build.sh        # export staging db → init/01-content.sql + docker build
│   ├── push.sh         # push english_db_content 到 DOCKER_REGISTRY
│   └── export_bundle.py # pg_dump staging db → SQL(不依赖 cms)
└── init/01-content.sql # 由 db/scripts/build.sh 填(`.gitignore`d,运行时由 image 跑)
```

## 段对照

| 段 | 装什么 | 谁维护 | git 跟踪 | 进了 image 吗 |
|---|---|---|---|---|
| `cms/source/` | 业务内容描述 | 运维(人工) | ✓ | 否(只是输入) |
| `cms/tools/`  | 处理这些内容的 Python/Docker | 开发者 | ✓ | 否(只在 CMS 主机跑) |
| `cms/scripts/` | 操作员对 cms 跑的 shell 工具 | 开发者 | ✓ | 否 |
| `db/`       | **被**烤进 db image 的构建上下文 | 半自动(bake 写 `init/01-content.sql`) | ✓ Dockerfile + builder.py + scripts/ | ✓ / 部分 |

`db/init/01-content.sql` 是 `db/scripts/build.sh` 的 **build 输入** —— 由它每次从在线 staging db 的 pg_dump 重新生成。`.gitignore` 了,仓库里只有 `Dockerfile`、`builder.py` 和 `db/scripts/` 是 commit 的。

## 烘焙流程

```
cms/source/vocabulary/*.csv                       (源)
        ↓  cms/scripts/content.sh sync
        ↓  cms/scripts/content.sh sentences       (OpenAI)
        ↓  cms/scripts/content.sh audio           (Tencent TTS → Storage.put)
        ↓
staging db = cms-source-db(vocabulary_libs + vocabulary_words + sentences)
  + Tencent Cloud COS bucket(audio/{hash}.mp3)
  OR  cms/.local/audio/{hash}.mp3                    (CLOUD_PROVIDER=local_fs)
        ↓  db/scripts/export_bundle.py  (psql -tAc ... + pg_dump)
        ↓    → .bake-staging/data-bundle-v.../dump.sql
        ↓    cp dump.sql  → db/init/01-content.sql
        ↓  db/scripts/build.sh  +  docker build db/
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
| 编辑了 CSV / 改了 manifest / 改了 prompt | `cms/scripts/pipeline.sh` (or `content.sh` 单个 subcommand) |
| 编辑了 CSV + 想马上出 image | `cms/scripts/full_bake.sh` (= pipeline + db bake) |
| 改 db-image 的 Dockerfile / schema 形状 | `db/scripts/build.sh` 单独 |
| 发布新 image 到 registry | `db/scripts/push.sh` |

## Audio 流向(注意:db image 不带 audio)

- **生成**:`content.sh audio` 调 Tencent TTS,MP3 写到 `Storage`(默认 `local_fs` 写到 `cms/.local/audio/`,或 `tencent_cos` 上传到 COS bucket)
- **持久化**:Storage 持有,`sentence.audio_url` 写为 `storage.public_url(key)`(local 是 `/audio/{hash}.mp3`,COS 是 `https://{bucket}.cos.{region}.myqcloud.com/audio/{hash}.mp3`)
- **bake**:`db/scripts/build.sh` 不会把 audio 烤进 db image —— db image 只含 `dump.sql`(`vocabulary_*` + `sentences` 表的数据,包括 `audio_url` 字段)
- **runtime**:target host 启动时 `01-content.sql` 加载,没有 audio init 步骤。前端读 `sentence.audio_url` 让浏览器直接拉

> 这个设计的好处:db image 保持小(schema + sentences,几 MB),改 audio 不用 re-bake db image(只重传 COS / 重跑 `content.sh audio`)。代价:生产环境需要 COS 账号 + 流量费用。

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