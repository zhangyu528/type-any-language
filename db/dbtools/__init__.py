"""
dbtools — db-side Python package (importer + DSN helper).

Lives at db/dbtools/ (separate from the data-pipeline's
`cms_pipeline` package at cms/cms_pipeline/). The two packages coexist
on `PYTHONPATH` because both are imported by host-side entry points
(db/scripts/*.sh) that may also be used in a CMS-host context where
the data-pipeline is loaded.

Modules in this package:
    importer    — CMS staging files (cms/staging/*) → cloud db UPSERT.
                  Called by db/scripts/import_staging.sh; never
                  reaches into the web framework.
    db_url      — minimal env assembler for db-only modules. Reads
                  POSTGRES_* / DATABASE_URL from the process env
                  (typically injected by `scripts/secrets/fetch_secrets.sh
                  eval-db` on the CMS host, or supplied by
                  .secrets/database_url written once per host by
                  `ops/{dev,prod}/setup.sh bootstrap` →
                  `db/scripts/bootstrap_tencent.sh`). Defensive
                  fallback to .secrets/postgres_password retained
                  for ad-hoc self-hosted CLI use.

Why this package isn't named "cms":
   The data-pipeline also has a `cms_pipeline` package at
   cms/cms_pipeline/. Keeping the same name in both directories would
   cause import shadowing on the operator's PYTHONPATH — only one of
   them would be importable at a time. Distinct names ("cms_pipeline"
   vs "dbtools") make both packages importable simultaneously.

This package is loaded by:
   db/scripts/import_staging.sh
   db/dbtools/importer.py (when run via -m dbtools.importer)
   backend/init_schema.py (for the defensive DATABASE_URL fallback
                            when DATABASE_URL is not in process env)

Note: schema bootstrap (init_schema.py) and migrations now live at
backend/ — co-located with the SQLAlchemy ORM models. The remaining
db-side concerns here are: importer (CMS staging → db UPSERT) and
db_url (env assembler).
"""