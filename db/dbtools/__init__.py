"""
dbtools — db-side Python package (schema bootstrap + migrations).

Lives at db/dbtools/ (separate from the data-pipeline's
`cms_pipeline` package at cms/cms_pipeline/). The two packages coexist on
PYTHONPATH because the data-pipeline still needs to invoke
`dbtools.init_schema` as a one-shot pre-flight step before the
data pipeline starts writing to a freshly-bootstrapped db.

Modules in this package:
    init_schema   — bootstrap base DDL (CREATE TABLE IF NOT EXISTS)
                   + run all pending migrations. Resolves DATABASE_URL
                   via db_url.py (the package does NOT import the
                   data-pipeline's cms_pipeline.env to keep the db side
                   independent of TENCENT_*, AI_*, etc.).
    db_url        — minimal env assembler for db-only modules. Reads
                   POSTGRES_* / DATABASE_URL from the process env
                   (typically injected by `scripts/secrets/fetch_secrets.sh
                   eval-db` on the CMS host, or supplied by .secrets/
                   postgres_password written by ops/<host>/lifecycle.sh
                   first start). No deps on the data-pipeline.
    migrations    — schema migration runner + version files. Each
                   version is a Python module exposing upgrade(conn) /
                   optional downgrade(conn).

Why this package isn't named "cms":
   The data-pipeline also has a `cms` package at cms/cms_pipeline/.
   Keeping the same name in both directories would cause import
   shadowing on the operator's PYTHONPATH — only one of them would
   be importable at a time. Distinct names ("cms" vs "dbtools") make
   both packages importable simultaneously.

This package is only loaded by db-side scripts:
   db/scripts/init_schema.sh
   db/scripts/migrate.sh
   (and by db/dbtools/importer.py's import_staging.sh wrapper)

The data-pipeline (cms/run.sh → cmd_vocab / cmd_sentences / cmd_audio)
does NOT import from this package — it only invokes dbtools.init_schema
as a one-shot pre-flight step before the data pipeline starts writing
to a freshly-bootstrapped db.
"""