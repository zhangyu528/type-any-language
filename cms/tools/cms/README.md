# cms/tools/cms —— 内容生产的 Python 模块

这些是 CMS 主机跑来生产内容的 **Python 工具**。通过 `cms/scripts/content.sh <subcommand>` 调用(它会配 `PYTHONPATH=cms/tools` 和一个 `python3` 解释器)。

## 模块

| 模块 | CLI 调用方式 | 用途 |
|---|---|---|
| `env.py` | (被其他模块 import) | 加载 `cms/.env`,暴露 `Config` dataclass。 |
| `import_vocab.py` | `python -m cms.import_vocab` | CSV → `vocabulary_libs` + `vocabulary_words`。 |
| `generate_sentences.py` | `python -m cms.generate_sentences` | OpenAI → `sentences` 表(bucket 填)。 |
| `generate_audio.py` | `python -m cms.generate_audio` | 腾讯云 TTS → MP3 + `sentences.audio_url`。 |
| `export_bundle.py` lives at `db/scripts/export_bundle.py` now. Called by `db/scripts/build.sh` during bake; also exposed via `content.sh export` (a pass-through to the new location). |

## 模块运行模式

每个 CLI 脚本两种方式都能跑:

```sh
# 作为模块(推荐 —— 用相对 import)
PYTHONPATH=cms/tools python3 -m cms.import_vocab

# 作为脚本(也可以 —— 每个文件里有 sys.path bootstrap)
python3 cms/tools/cms/import_vocab.py
```

`env.py` 是被 import 的(不是 CLI)—— 它暴露:
- `setup_env(env_file=None)` —— 把 `cms/.env` 拷到 `os.environ`(幂等)。
- `load_config()` —— 返回验证过的 `Config` dataclass。

## Python 依赖(CMS 主机)

```sh
pip install psycopg2-binary openai tencentcloud-sdk-python
```

`psycopg2-binary` 是连 DB 用的。`openai` 是 LLM。`tencentcloud-sdk-python` 只在跑 `audio` subcommand 时需要。

(同一个 psycopg2 也被 `backend/requirements.txt` 用了 —— 操作系统层面是同一个依赖。故意没有单独的 `cms/tools/requirements.txt`:让依赖集尽量精简,跟运行时重合。)

## 流水线

```
cms/source/vocabulary/*.csv                  ← 运维维护的源
        ↓  content.sh sync
PostgreSQL(vocabulary_libs + vocabulary_words)
        ↓  content.sh sentences(OpenAI)
PostgreSQL(sentences 表,audio_url="")
        ↓  content.sh audio(腾讯云 TTS)
AUDIO_DIR/*.mp3 + sentences.audio_url 更新
        ↓  bake_image.sh(内部调用 export_bundle.py)
        ↓    export_bundle dump 内容表 + 拷音频
        ↓  docker build db/
烤好的 db image
        ↓  push_image.sh
registry
```

## 为什么同时支持模块 + 脚本两种形式?

每个脚本顶部那个 `if __package__ in (None, ""):` 块让两种调用都能 work。模块形式是 `content.sh` 用的(更干净、可以做类型检查)。脚本形式是开发时或 notebook 里临时调用的。同一个文件,两种都行。

## 加一个新流水线模块

1. 在 `cms/tools/cms/<name>.py` 放一个新文件,顶部加一个 `if __package__ in (None, "")` 块(从 `import_vocab.py` 复制)。
2. 在 `cms/scripts/content.sh` 加一个 `cmd_<name>()` 包装。
3. 更新 `content.sh` 的 usage 文档和本 README。