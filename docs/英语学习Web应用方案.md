# 英语学习 Web 应用方案





**版本：v3.0.0**





---





## 1. 产品概述





开发一个英语学习 Web 应用，核心功能：**听音写句** —— 播放句子音频，用户根据音频输入完整句子。





**v3 重大变更**：引入 **CMS 主机 + 目标主机** 的双角色架构。所有 AI 句子生成、TTS 音频合成都在 CMS 主机离线完成，最终成果（词库 + 句子 + 音频）烤进 db image。dev / prod 目标主机只跑容器，零 AI、零 TTS、零 Python。





---





## 2. 系统架构





### 2.1 总体拓扑





```


┌─────────────────────────────── CMS 主机 ───────────────────────────────┐


│                                                                        │


│  cms/source/vocabulary/*.csv                                           │


│        │                                                               │


│        ▼  staging.sh sync (import_vocab.py)                           │


│  PostgreSQL ◀── staging.sh sentences (OpenAI)                          │


│        │                                                               │


│        ├── staging.sh audio (Tencent TTS)                             │


│        ▼                                                               │


│  AUDIO_DIR/*.mp3 + sentences.audio_url                                │


│        │                                                               │


│        ▼  bake_image.sh (pg_dump + audio copy)                         │


|  docker build db/                              |                                                     │


│        │                                                               │


│        ▼  push_image.sh                                                │


│  DOCKER_REGISTRY/<DB_IMAGE>:<TAG>                                     │


│                                                                        │


└────────────────────────────────────────────────────────────────────────┘


                                    │


                                    │  docker pull


                                    ▼


┌──────────────────────────── dev / prod 目标机 ─────────────────────────┐


│                                                                        │


│  scripts/ops/{dev-host,prod-host}/run.sh start                         │


│        │                                                               │


│        ▼                                                               │


│  ┌────────┐    ┌────────┐    ┌────────┐    ┌─────────┐                 │


│  │ frontend│───▶│ nginx  │───▶│backend │───▶│  db     │                 │


│  │ (React) │    │ (:80)  │    │(FastAPI)│    │(content │                 │


│  └────────┘    └────────┘    │read-   │    │ baked)  │                 │


│                              │layer)  │    └─────────┘                 │


│                              └────┬───┘                                │


│                                   │                                    │


│                                   ▼                                    │


│                            /audio/*.mp3  ←  baked into db image         │


│                                                                        │


└────────────────────────────────────────────────────────────────────────┘


```





### 2.2 角色对比





| 维度 | CMS 主机 | dev / prod 目标机 |


|---|---|---|


| 主要任务 | 烤内容到 db image | 跑容器服务用户 |


| 配置文件 | `cms/.env` | 无（shell env + `.secrets/`） |


| 入口脚本 | `cms/scripts/*.sh` | `scripts/ops/{dev-host,prod-host}/*.sh` |


| 需要 Python | 是 | 否 |


| 需要 AI key | 是 | 否 |


| 需要 TTS key | 是 | 否 |


| 写入 DB | 是 | 否（只读） |


| 写入文件系统 | 是（AUDIO_DIR） | 否 |





---





## 3. 技术栈





| 层级 | 选型 |


|---|---|


| 前端 | React + TypeScript + TailwindCSS |


| 后端 | Python/FastAPI + SQLAlchemy（v3 改为纯读层） |


| 数据库 | PostgreSQL 15（v3 改为内容烤入模式） |


| CMS 工具链 | psycopg2-binary + openai + tencentcloud-sdk-python |


| AI 服务 | OpenAI API / Claude API（可配置） |


| TTS | 腾讯云 TTS |


| 部署 | Docker Compose |





---





## 4. 核心流程





### 4.1 烤内容流程（CMS 主机，离线）





```


1. 操作员提交新词库 CSV 到 cms/source/vocabulary/


       │


       ▼


2. staging.sh sync → cms/.local/staging/vocabulary/<lib>.json（不连 DB）


       │


       ▼


3. staging.sh sentences → OpenAI 批量生成句子
       → 追加到 cms/.local/staging/sentences/<lib>.jsonl


       │  （按 (词库, 难度) 桶填到 DEFAULT_BUCKET_TARGET_SIZE）


       ▼


4. staging.sh audio → 腾讯云 TTS 烤 MP3


       │  （更新同 JSONL 的 audio_url；sha1[:16] 文件名，跳过已设的句子）


       ▼


5. db/scripts/import_staging.sh (dbtools.importer) → UPSERT staging 文件 → staging db


       │


       ▼


6. bake_image.sh → pg_dump → docker build


       │


       ▼


7. push_image.sh → DOCKER_REGISTRY


```





### 4.2 运行时流程（目标机）





```


1. 用户打开前端 → 选择词库 → 拉随机 N 个词


       │


       ▼


2. 前端请求 /api/sentences/generate


       │


       ▼


3. 后端查 sentences 表（已烤入）→ 返回一条


       │  （缓存命中；未命中才走 AI 生成 + 持久化，但生产环境几乎都命中）


       ▼


4. 前端拿到 audio_url（如 /audio/abc123.mp3）


       │  → 通过 nginx → backend StaticFiles → /audio 共享卷


       ▼


5. 浏览器播放音频，用户输入整句


       │


       ▼


6. /api/sentences/check → 校验（小写、去标点空格）


       │


       ▼


7. 即时反馈（✅ 正确 / ❌ 错误）


```





---





## 5. 数据库设计





### 5.1 词库表 (vocabulary_libs)





| 字段 | 类型 | 说明 |


|---|---|---|


| id | UUID | 主键 |


| name | VARCHAR(100) | 词库名称 |


| level | VARCHAR(20) | beginner/cet4/cet6/ielts |


| word_count | INT | 词汇数量 |


| created_at | TIMESTAMP | 创建时间 |





### 5.2 词汇表 (vocabulary_words)





| 字段 | 类型 | 说明 |


|---|---|---|


| id | UUID | 主键 |


| lib_id | UUID | 外键，关联词库 |


| word | VARCHAR(100) | 英文单词 |


| phonetic | VARCHAR(100) | 国际音标 |


| translation | TEXT | 中文释义 |


| part_of_speech | VARCHAR(20) | 词性 |


| created_at | TIMESTAMP | 创建时间 |





### 5.3 句子表 (sentences)





| 字段 | 类型 | 说明 |


|---|---|---|


| id | UUID | 主键 |


| lib_id | UUID | 外键，关联词库 |


| text | TEXT | 完整句子 |


| target_words | TEXT[] | 包含的目标词汇 |


| difficulty | VARCHAR(20) | 难度级别 |


| audio_url | VARCHAR(500) | 音频文件路径（如 `/audio/abc123.mp3`） |


| is_cached | BOOLEAN | 是否已缓存（v3：保留兼容字段，新写入默认 true） |


| use_count | INT | 被使用次数 |


| created_at | TIMESTAMP | 创建时间 |





### 5.4 schema 初始化





`db/init/01-content.sql` 是 bake 时生成的，由 postgres 镜像的 `/docker-entrypoint-initdb.d/` 在首次启动时执行。schema 内容由 `db/scripts/export_bundle.py` 的 `pg_dump --clean --if-exists` 输出保证幂等。





---





## 6. 词库生成策略





### 按考试等级筛选（基于 Zipf 词频）





| 等级 | Zipf 范围 | 词汇量 |


|---|---|---|


| 初中基础 | 6.5 - 8.5 | ~1500 |


| CET-4 | 5.0 - 7.0 | ~2500 |


| CET-6 | 4.0 - 5.5 | ~2500 |


| IELTS | 3.0 - 4.5 | ~3000 |





### 生成 / 导入





CSV 文件位于 `cms/source/vocabulary/*.csv`（已提交到仓库，运维同学维护）。通过 `cms/scripts/staging.sh sync`（底层 `cms/tools/cms/import_vocab.py`）写入 `cms/.local/staging/vocabulary/<lib>.json`（**ETL 的 E 步骤，CMS 端只产文件,不连 DB**）。db 端通过 `db/scripts/import_staging.sh`（`dbtools.importer`）把 JSONL 文件 UPSERT 进 staging db。





> v2 的 `scripts/generate_vocab.py` / `scripts/seed_vocabulary.py` 已在 v3 重构中移除。





---





## 7. API 端点





### 7.1 词库相关





| 端点 | 方法 | 说明 |


|---|---|---|


| `/api/vocabulary/libs` | GET | 获取所有词库 |


| `/api/vocabulary/libs/{id}/random` | GET | 随机获取 N 个词汇 |





### 7.2 句子相关





| 端点 | 方法 | 说明 |


|---|---|---|


| `/api/sentences/generate` | POST | 生成练习句子（缓存优先） |


| `/api/sentences/check` | POST | 校验答案 |


| `/audio/{filename}` | GET | 静态音频文件（v3 新增，由 backend `StaticFiles` mount 暴露） |





---





## 8. 前端练习流程





```


┌─────────────────────────────────────┐


│  1. 选择词库                         │


│     [ CET-4 ▼ ]  [ 开始练习 ]        │


├─────────────────────────────────────┤


│  2. 显示单词提示（可选）              │


│     [ apple ] [ red ]               │


├─────────────────────────────────────┤


│  3. 播放音频                         │


│     🔊 [ ▶ 播放 ]  [ 🔄 重播 ]       │


├─────────────────────────────────────┤


│  4. 输入句子                         │


│     [____________________]           │


├─────────────────────────────────────┤


│  5. 提交答案                         │


│     [ 提交 ]                         │


├─────────────────────────────────────┤


│  6. 即时反馈                         │


│     ✅ 正确！ / ❌ 再试一次           │


└─────────────────────────────────────┘


```





---





## 9. 部署





### 9.1 CMS 主机





```bash


./cms/scripts/env.sh                    # 第一次：引导 cms/.env


./cms/scripts/staging.sh doctor         # 前置检查


./cms/scripts/staging.sh sync           # csv → 词库表


./cms/scripts/staging.sh sentences      # OpenAI 填句子


./cms/scripts/staging.sh audio          # 腾讯云 TTS 烤 MP3


./db/scripts/build.sh             # 烤 db image


./db/scripts/push.sh             # 推 registry


```





### 9.2 开发目标机





```bash


./scripts/dev-host/lifecycle.sh doctor


./scripts/dev-host/lifecycle.sh start        # 首次会自动生成 .secrets/postgres_password


```





可选：`ALLOWED_ORIGINS=https://my.domain ./scripts/dev-host/lifecycle.sh start`





### 9.3 生产目标机





```bash


ALLOWED_ORIGINS=https://my.domain ./scripts/prod-host/lifecycle.sh start


./scripts/prod-host/lifecycle.sh doctor


./scripts/prod-host/lifecycle.sh restart


```





### 9.4 密钥安全约定





- `cms/.env` 全部 gitignore，仅 `.env.example.cms` 入库。


- 目标机**不需要 .env 文件**：`POSTGRES_PASSWORD` 由 `run.sh` 首次启动时现场生成（24 字符 URL-safe），写到 `.secrets/postgres_password`（chmod 600），由 compose 的 `secrets:` block + `*_FILE` 环境变量注入容器。**不会出现在 image 层或环境变量列表里**。


- `ALLOWED_ORIGINS` 通过 shell 环境变量传入；不传时走 compose 内置的兜底值。


- `.secrets/` 加入 `.gitignore`,永远不 commit。


- db image 通过 OCI label 携带 `db.user` / `db.name` / `content.version` / `content.baked-at`，目标机启动时由 `run.sh` 用 `docker inspect` 读出。





---





## 10. 目录结构





```


project/


├── docker-compose.yml               # 目标机容器编排


├── docker-compose.dev.yml           # 开发编排（hot-reload）


├── .env.example.cms                 # v3 CMS 模板（目标机不需要 .env）


│


├── backend/                         # FastAPI 纯读层


│   ├── app/


│   │   ├── main.py                  # FastAPI 主入口 + /audio 静态挂载


│   │   ├── config.py                # 配置（支持 _FILE indirection）


│   │   ├── database.py              # SQLAlchemy


│   │   ├── models/                  # 模型


│   │   ├── routers/                 # 路由


│   │   └── schemas/                 # Pydantic


│   ├── requirements.txt


│   └── Dockerfile


│


├── frontend/


│   ├── src/


│   ├── package.json


│   └── Dockerfile


│


├── cms/                          # 内容服务 — 源 + CMS 工具链 + Postgres image 构建上下文


│   ├── source/                       # 手写源（git 跟踪，运维人工 review）


│   │   ├── manifest.yaml             # 词库清单


│   │   ├── vocabulary/               # 词库 CSV


│   │   └── prompts/                  # LLM prompt 模板


│   ├── tools/                        # CMS 工具链（不入 image，只活 CMS 主机）


│   │   ├── Dockerfile                # cms-sidecar


│   │   └── cms/                      # Python 包


│   │       ├── env.py


│   │       ├── manifest.py


│   │       ├── import_vocab.py


│   │       ├── generate_sentences.py


│   │       ├── generate_audio.py


│   │       └── export_bundle.py


│   └── runtime/                      # Postgres image 构建上下文 + bake 输出物


│       ├── Dockerfile                # postgres:15-alpine wrapper


│       ├── init/


│       │   ├── 01-content.sql        # bake 时生成，gitignored


│       │   └── 99-audio.sh           # /seed/audio → /audio 一次性拷贝


│       └── seed/


│           └── audio/                # MP3s，bake 时生成，gitignored


│


├── scripts/


│   ├── lib.sh                       # 共享工具（ok/warn/err、docker 检测）


│   ├── ops/                         # 主机运维脚本（配环境 / 烤 image / 跑容器）


│   │   ├── cms/                  # CMS 主机 — 操作 content 服务


│   │   │   ├── env.sh                # cms/.env 生命周期


│   │   │   ├── staging.sh            # 烤内容子命令编排


│   │   │   ├── bake_image.sh         # 烤 content image


│   │   │   └── push_image.sh         # 推 registry


│   │   ├── dev-host/                 # dev 目标机


│   │   │   ├── run.sh


│   │   │   ├── build_image.sh


│   │   │   └── push_image.sh


│   │   └── prod-host/                # prod 目标机


│   │       ├── run.sh


│   │       ├── build_image.sh


│   │       └── push_image.sh


│   └── dev/                         # 开发者工具（lint/test/generate/...）— 当前为空


│


├── nginx/                           # Nginx 反向代理


└── docs/


    └── 英语学习Web应用方案.md        # 本文件


```