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
├── pyproject.toml       # 第三方依赖清单 (openai / PyYAML base, tencent / cos optional)
├── run.sh                # CMS driver 主入口(operator 第一个敲的; E+T 不含 L)
└── scripts/              # CMS 工具(operator 选跑的)
    ├── bootstrap.sh      # 一次性:pip install -e "./cms[audio,cos]"
    └── staging.sh        # file producer wrapper (vocab / sentences / audio / export)
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
        ↓  cms/scripts/staging.sh vocab (import_vocab.py)                     (E: Extract)
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
| 编辑了 CSV / 改了 manifest / 改了 prompt | `cms/scripts/staging.sh vocab\|sentences\|audio` (单步;仅写文件) |
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

## CMS host 一次性 bootstrap

第一次跑 `cms/run.sh` 之前先 bootstrap(之后不用再跑,除非改 `cms/pyproject.toml` 或想换 GH Environment tier):

```bash
# 0. 一次性 bootstrap:装 Python deps + 验 gh/auth/repo + 打印 eval 行
./cms/scripts/bootstrap.sh                # 默认装 [audio,cos]; --no-extras / --extras audio
# CI / 离线环境:加 --skip-fetch 跳过 fetch_secrets.sh check

# 1. bootstrap 成功后,把 eval 行复制粘贴到当前 shell(每次新 shell 都做)
eval "$(./scripts/secrets/fetch_secrets.sh eval-cms)"

# 2. 现在 AI_*/TENCENT_*/CLOUD_* 已在 process env,直接跑
./cms/run.sh                              # vocab + sentences + audio 三步
# ./cms/scripts/cmd_vocab.sh              # 只跑 vocab(不需要任何 env)
```

依赖清单写在 `cms/pyproject.toml`:

- **base** (必有):`openai` (sentences 调 LLM) + `PyYAML` (manifest.yaml)
- **[audio]** (TTS 子命令用,optional):`tencentcloud-sdk-python`
- **[cos]** (Tencent COS 存储,optional):`cos-python-sdk-v5`

### run.sh 入口的硬卡闸门

`cms/run.sh` 默认入口(`run` / 无参数)现在只做 1 个硬预检:

- **Python deps 可 import**(`openai` + `PyYAML`):缺就提示跑 `bootstrap.sh`

`fetch_secrets.sh check`(gh / auth / repo)由 `bootstrap.sh` **一次性**做,**`run.sh` 入口不再重复 check** —— 操作员已经跑过 bootstrap 之后,每次跑 run.sh 信任 env 已就位。

### run.sh 缺 env 的行为

| 缺什么 | run.sh 行为 | 修法 |
|---|---|---|
| AI_* (`AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` 任一) | 硬卡 exit 1,提示跑 `eval-cms` | `eval "$(./scripts/secrets/fetch_secrets.sh eval-cms)"` |
| TENCENT_* (`SECRET_ID` / `SECRET_KEY` / `APP_ID` 任一) | 硬卡 exit 1 | 同上 |
| 都不缺 | vocab → sentences → audio 三步依次跑 | (无需) |

**设计变更**:旧版本是 `warn 跳过`(操作员看到 "OK" 以为跑完了但其实没),新版本是 **硬卡**(操作员立刻知道 secrets 没注入)。**vocab 不需要 env 仍能跑**;只跑 vocab 用 `./cms/scripts/cmd_vocab.sh`(那个仍无 env 检查)。

**没有 doctor 子命令了** —— 旧 `staging.sh doctor` / `run.sh doctor` 已退役。Python 依赖是"do once"操作,由 `bootstrap.sh` 显式负责;env 注入是"do once per shell",由 `eval` 行负责。两者都不进 `run.sh` 启动预检。

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
| `type-any-language.db.user` | 进程环境 `$POSTGRES_USER` (默认 `english_user`) | `scripts/{dev,prod}-host/lifecycle.sh` → `DB_USER` |
| `type-any-language.db.name` | 进程环境 `$POSTGRES_DB` (默认 `english_learning`) | `scripts/{dev,prod}-host/lifecycle.sh` → `DB_NAME` |
| `type-any-language.content.version` | `db/VERSION`(由 `ops/lib.sh::read_version_file` 读) | `scripts/{dev,prod}-host/doctor.sh` 的日志行 |
| `type-any-language.content.baked-at` | 烘焙时的 `date -u` | `scripts/{dev,prod}-host/doctor.sh` 的日志行 |

`db.user` 和 `db.name` 是 **唯一** 权威来源 —— 目标机不需要这两项。不重新烤 image 就改这俩,启动时会报 `FATAL: role "..." does not exist`。

> **历史变更**: 这些 label 的值以前标注成 "来自 cms/.env"。CMS 在 GitHub
> Environments 迁移之后已经不再读取 cms/.env —— `POSTGRES_USER` /
> `POSTGRES_DB` 这两项通过 `eval "$(scripts/secrets/fetch_secrets.sh
> eval-db)"` 或直接 shell 导出传入,d 端默认值仍是 `english_user` /
> `english_learning`。

## 本地验 image

```sh
docker run --rm english_db_content:vX.Y.Z \
    pg_isready -U english_user -d english_learning
# 期望: /var/run/postgresql:5432 - accepting connections

docker inspect english_db_content:vX.Y.Z \
    --format '{{ index .Config.Labels "type-any-language.db.user" }}'
# 期望: english_user
```