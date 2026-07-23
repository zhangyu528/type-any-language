# cms —— 内容生产

这个目录是 **CMS 内容生产** 的根 —— CMS 主机上跑 Python 工具链、调用 OpenAI / 腾讯 TTS、把内容写到 **staging 文件** (`cms/content/`)。**db 写入** 在仓库根的 [`../db/`](../db/) —— 拆分后,这是两个并列的子项目,职责清楚分开:

- `cms/` 写文件 (E + T,只产出 staging 文件)
- `db/` 把 staging 文件灌进云 db (L: `db/scripts/import_staging.sh` 直接 UPSERT 进 docker postgres)

CMS 这边的 Python 模块不再直接连 db。db 侧 `importer` 把 staging 文件 UPSERT 进 Postgres(云 db 或自管 db)。目标主机(prod / dev)通过 compose 跑 backend + frontend,运行时**不**感知 `cms/` 目录,也不感知 `db/` 目录 —— 它们读的是 `DATABASE_URL` 指向的 docker postgres。

## 设计

`cms/` 按"角色"分两段:

```
cms/
├── source/             # 运维手写源,git 跟踪,人工 review
│   ├── manifest.yaml   # 内容清单(libs / difficulties / prompt tuning knobs)
│   ├── vocabulary/     # 每个 lib 的 CSV
│   └── prompts/        # LLM prompt 模板(sentences.yaml 等)
│
├── pipeline/        # Python 包(manifest / import_vocab / generate_sentences / generate_audio / storage / env)
│
├── pyproject.toml       # 第三方依赖清单 (openai / PyYAML base, tencent / cos optional)
├── run.sh                # CMS driver 主入口(operator 第一个敲的; E+T 不含 L)
└── scripts/              # CMS 工具(operator 选跑的)
    ├── bootstrap.sh      # 一次性:pip install -e "./cms[audio,cos]"
    └── staging.sh        # file producer wrapper (vocab / sentences / audio)
```

仓库根的 `db/` 目录是 schema + importer + migration runner + docker postgres bootstrap:

```
db/
├── scripts/            # db 的 own entry points(独立于 CMS)
│   ├── lib.sh                # docker postgres helpers (resolve_dev/prod_db_url, render_db_name, ...)
│   ├── bootstrap_tencent.sh  # one-time ROLE/DB/GRANT + write DATABASE_URL
│   ├── init_schema.sh        # CREATE TABLE IF NOT EXISTS(基础 DDL,幂等)
│   ├── migrate.sh            # migrations.runner(apply pending migrations)
│   └── import_staging.sh     # importer —— staging 文件 UPSERT 进 db
├── db_url.py           # POSTGRES_* / DATABASE_URL env assembler(防御性 fallback)
├── importer.py         # CMS staging → docker postgres UPSERT
```

## 段对照

| 段 | 装什么 | 谁维护 | git 跟踪 | 进了 image 吗 |
|---|---|---|---|---|
| `cms/source/` | 业务内容描述 | 运维(人工) | ✓ | 否(只是输入) |
| `cms/pipeline/` | CMS 端 Python 工具集 | 开发者 | ✓ | 否(只在 CMS 主机跑) |
| `cms/scripts/` | 操作员对 cms 跑的 shell 工具 | 开发者 | ✓ | 否 |
| `db/`       | schema + importer + docker postgres bootstrap | 半自动(operator 跑 `bootstrap_tencent.sh`) | ✓ scripts + db_url/importer | 否(没有 db image 了 —— runtime db 是 docker postgres) |

## ETL 流向

```
                CMS 主机 (Python, 不连 DB)
cms/source/vocabulary/*.csv                                                  (源)
        ↓  cms/scripts/staging.sh vocab (import_vocab.py)                     (E: Extract)
cms/content/vocabulary/<lib>.json
        ↓  cms/scripts/staging.sh sentences (generate_sentences.py, OpenAI)  (T: Transform)
cms/content/sentences/<lib>.jsonl
        ↓  cms/scripts/staging.sh audio     (generate_audio.py, TTS → Storage)
        ↓      (audio_url 字段被填入; mp3 落到 COS 或 cms/.local/audio/)
cms/content/sentences/<lib>.jsonl
                                                                            
                db 主机(任意能 reach 云 db 的机器,通常是 CMS 主机)
==========================================================================  边界
        ↓  db/scripts/import_staging.sh (importer all)              (L: Load)
docker postgres(vocabulary_libs + vocabulary_words + sentences)
                                                                            
        ↓  目标主机的 ops/{dev,prod}/lifecycle.sh start
docker compose up -d
        ↓
frontend 请求 /api/sentences/random
        ↓
后端从 docker postgres 读 sentence + audio_url(完整 COS URL)
        ↓
浏览器直接拉 COS,后端不参与音频服务
```

## 责任划分:何时跑哪个脚本

| 你想... | 跑 |
|---|---|
| 编辑了 CSV / 改了 manifest / 改了 prompt | `cms/scripts/staging.sh vocab\|sentences\|audio` (单步;仅写文件) |
| 把所有 staging 文件一次性灌到云 db | `db/scripts/import_staging.sh` (importer;幂等,re-run 无害) |
| 把整条 ETL 跑完 | `cms/run.sh` (E+T) **→** `db/scripts/import_staging.sh all` (L) 两段独立跑 |
| 在云 db 上建表 / 跑迁移 | `db/scripts/init_schema.sh` + `db/scripts/migrate.sh` |
| 一次性给某 target host 创建 ROLE / DATABASE | `ops/{dev,prod}/setup.sh bootstrap` (调 `db/scripts/migrate.sh`) |

> **CMS 写的 vs db 管的 (ETL 拆分版)**:
> - CMS **E + T**:import_vocab / generate_sentences / generate_audio,只产文件
> - db **L**:importer 把 staging 文件 UPSERT 进云 db
> - **唯一的桥** 是 `cms/content/` 这个目录。CMS 完全不知道 schema 长啥样;db 完全不知道 TTS / OpenAI 是啥

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

## Audio 流向

- **生成**:`staging.sh audio` 调 Tencent TTS,MP3 写到 `Storage`(默认 `local_fs` 写到 `cms/.local/audio/`,或 `tencent_cos` 上传到 COS bucket)
- **持久化**:Storage 持有,`sentence.audio_url` 写为 `storage.public_url(key)`(local 是 `/audio/{hash}.mp3`,COS 是 `https://{bucket}.cos.{region}.myqcloud.com/audio/{hash}.mp3`)
- **runtime**:target host 启动后,backend 从云 db 读 `sentence.audio_url`(完整 COS URL),前端让浏览器直接拉

> 这个设计的好处:audio 不进 db image(也没 db image),改 audio 不用 re-bake(只重传 COS / 重跑 `staging.sh audio`)。代价:生产环境需要 COS 账号 + 流量费用。