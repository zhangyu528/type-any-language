# cms/tools/cms —— 内容生产的 Python 模块

这些是 CMS 主机跑来生产内容的 **Python 工具**。通过 `cms/scripts/content.sh <subcommand>` 调用(它会配 `PYTHONPATH=cms/tools` 和一个 `python3` 解释器)。

## 模块

| 模块 | CLI 调用方式 | 用途 |
|---|---|---|
| `manifest.py` | `python -m cms.manifest` | 加载 `cms/source/manifest.yaml`,校验 lib/difficulty/默认值。 |
| `import_vocab.py` | `python -m cms.import_vocab` | CSV → `cms/.local/staging/vocabulary/<lib>.json`(**纯文件,** 不连 DB)。 |
| `generate_sentences.py` | `python -m cms.generate_sentences` | OpenAI → 追加到 `cms/.local/staging/sentences/<lib>.jsonl`(**纯文件,** 不连 DB)。 |
| `generate_audio.py` | `python -m cms.generate_audio` | 腾讯云 TTS → MP3 → Storage(LocalFs / Tencent COS),更新同一份 JSONL 的 `audio_url`(**纯文件,** 不连 DB)。 |
| `storage.py` | (被 generate_audio import) | Storage 抽象(`LocalFsStorage` / `TencentCosStorage`)。 |
| `export_bundle.py` | lives at `db/scripts/export_bundle.py` now(db 的职责)。`content.sh export` 是个透传 wrapper。 |

## 数据库写入

CMS 这边的三个模块 **全部不连 DB**。schema 在哪里改:

| 关心 | 在哪里 |
|---|---|
| schema DDL | `db/tools/dbtools/init_schema.py` (基础 DDL, 幂等) |
| migrations | `db/tools/dbtools/migrations/versions/*.py` |
| 把 staging 文件灌进 db | `db/tools/dbtools/importer.py` |
| 灌进 db 的 shell wrapper | `db/scripts/import_staging.sh` |
| 完整 ETL 编排 (含 import) | `./cms/scripts/pipeline.sh` (会调 import_staging.sh 作为最后一步) |

历史上 `import_vocab` / `generate_sentences` / `generate_audio` 都曾经直接写 DB。
现在它们只产文件,db 通过 importer 接。这是 ETL 模式(E=CSV, T=AI/TTS, L=importer),
目的是让 CMS 端不知道 schema 长啥样;哪个阶段失败重跑哪个阶段,不会浪费 AI/TTS 配额。

## 模块运行模式

每个 CLI 脚本两种方式都能跑:

```sh
# 作为模块(推荐 —— 用相对 import)
PYTHONPATH=cms/tools python3 -m cms.import_vocab

# 作为脚本(也可以 —— 每个文件里有 sys.path bootstrap)
python3 cms/tools/cms/import_vocab.py
```

## Python 依赖(CMS 主机)

```sh
pip install openai tencentcloud-sdk-python pyyaml
```

`openai` 是 LLM。`tencentcloud-sdk-python` 只在跑 `audio` subcommand 时需要。
`pyyaml` 是 manifest 解析用的。

注意:**不再需要 `psycopg2-binary`** —— CMS pipeline 已经不连 DB。如果你的
环境里装了,那是历史遗留的(可能 backend 依赖顺带装的),可以留着不动。

## 流水线 (ETL 文件流)

```
cms/source/vocabulary/*.csv                  ← 运维维护的源 (E: Extract)
        ↓  content.sh sync (import_vocab.py)
cms/.local/staging/vocabulary/<lib>.json     ← 中间产物
        ↓  content.sh sentences (generate_sentences.py, OpenAI)
cms/.local/staging/sentences/<lib>.jsonl     ← (T: Transform, 一行一句)
        ↓  content.sh audio (generate_audio.py, 腾讯云 TTS)
sentences/<lib>.jsonl 同上, audio_url 字段被填进
        ↓  db/scripts/import_staging.sh (dbtools.importer)
PostgreSQL(vocabulary_libs + vocabulary_words + sentences)
        ↓  db/scripts/build.sh (export_bundle + docker build)
烤好的 db image
        ↓  db/scripts/push.sh
DOCKER_REGISTRY
```

`cms/scripts/pipeline.sh` 把上面从 sync 到 import_staging 一次性串起来。
`cms/scripts/full_bake.sh` 把 pipeline + build 也串起来。

## 为什么同时支持模块 + 脚本两种形式?

每个脚本顶部那个 `if __package__ in (None, ""):` 块让两种调用都能 work。模块形式是 `content.sh` 用的(更干净、可以做类型检查)。脚本形式是开发时或 notebook 里临时调用的。同一个文件,两种都行。

## 加一个新流水线模块

1. 在 `cms/tools/cms/<name>.py` 放一个新文件,顶部加一个 `if __package__ in (None, "")` 块(从 `import_vocab.py` 复制)。**只写文件,不开 db 连接**;db 的事交给 `dbtools.importer`。
2. 在 `cms/scripts/content.sh` 加一个 `cmd_<name>()` 包装。
3. 如果你产出的文件类型 importer 不认,同步更新 `db/tools/dbtools/importer.py` 的解析逻辑 + 该模块的 README。
4. 更新 `content.sh` 的 usage 文档和本 README。