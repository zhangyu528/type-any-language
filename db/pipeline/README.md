# db/pipeline — content production Python modules

These are the **Python tools** that the CMS host runs to produce content.
They're invoked via `scripts/cms/content.sh <subcommand>` (which sets up
`PYTHONPATH=db` and a `python3` interpreter).

## Modules

| Module | CLI invocation | Purpose |
|---|---|---|
| `env.py` | (imported by others) | Loads `.env.cms`, exposes `Config` dataclass. |
| `import_vocab.py` | `python -m pipeline.import_vocab` | CSVs → `vocabulary_libs` + `vocabulary_words`. |
| `generate_sentences.py` | `python -m pipeline.generate_sentences` | OpenAI → `sentences` table (bucket fill). |
| `generate_audio.py` | `python -m pipeline.generate_audio` | Tencent TTS → MP3 + `sentences.audio_url`. |
| `export_bundle.py` | `python -m pipeline.export_bundle` | `pg_dump` + audio copy → staging bundle. Called by `bake_image.sh`; also exposed via `content.sh export` for inspection. |

## Module pattern

Every CLI script is runnable both ways:

```sh
# As a module (preferred — uses relative imports)
PYTHONPATH=db python3 -m pipeline.import_vocab

# As a script (also works — sys.path bootstrap in each file)
python3 db/pipeline/import_vocab.py
```

`env.py` is imported (not a CLI) — it exposes:
- `setup_env(env_file=None)` — copies `.env.cms` into `os.environ` (idempotent).
- `load_config()` — returns a validated `Config` dataclass.

## Python deps (CMS host)

```sh
pip install psycopg2-binary openai tencentcloud-sdk-python
```

`psycopg2-binary` is for the DB connection. `openai` is for the LLM.
`tencentcloud-sdk-python` is only needed if you run the `audio` subcommand.

(The same psycopg2 is used by `backend/requirements.txt` — they're a
single dep at the OS level. There is no separate `db/requirements.txt`
on purpose: keep the dep set minimal and overlap with the runtime.)

## Workflow

```
db/content/vocabulary/*.csv                    ← operator-maintained source
        ↓  content.sh sync
PostgreSQL (vocabulary_libs + vocabulary_words)
        ↓  content.sh sentences (OpenAI)
PostgreSQL (sentences table, audio_url="")
        ↓  content.sh audio (Tencent TTS)
AUDIO_DIR/*.mp3 + sentences.audio_url updated
        ↓  bake_image.sh (calls export_bundle.py internally)
        ↓    export_bundle dumps content tables + copies audio
        ↓  docker build db/
baked db image
        ↓  push_image.sh
registry
```

## Why module + script dual-form?

The `if __package__ in (None, ""):` block at the top of each script
enables both invocations. The module form is what `content.sh` uses
(cleaner, type-checkable). The script form is for ad-hoc invocation
during development or in notebooks. Same file, both work.

## Adding a new pipeline module

1. Drop a `<name>.py` next to the existing ones.
2. Add an `if __package__ in (None, "")` block at the top (copy from
   `import_vocab.py`).
3. Add a `cmd_<name>()` wrapper in `scripts/db/content.sh`.
4. Update `content.sh` usage doc + this README.