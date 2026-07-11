# cms/tools/cms/tests

Developer-time verification scripts. **Not part of CI** — these need a live
Postgres to exercise schema migrations against, which is overkill for a
pipeline module that itself only runs on the CMS host.

## test_phase2_e2e.py

End-to-end check for Phase 2 (schema migrations + content metadata +
sentence_word_links FK). Four scenarios:

1. Fresh DB → all 6 migrations apply, schema has new columns + tables.
2. Pre-Phase-2 DB (raw DDL simulating old schema) → migrations still
   apply, legacy rows preserved.
3. `import_vocab` handles both old 4-column and new 9-column CSV.
4. `insert_sentences` populates `sentence_word_links` via FK join, and
   is idempotent on rerun.

### Run

```bash
# Spin up a throwaway postgres:15 (any reachable postgres works)
docker run -d --name tal-test-pg \
  -e POSTGRES_PASSWORD=testpw \
  -e POSTGRES_USER=english_user \
  -e POSTGRES_DB=english_learning \
  -p 55432:5432 postgres:15-alpine

# Run the test
DATABASE_URL=postgresql://english_user:testpw@localhost:55432/english_learning \
  PYTHONPATH=cms/tools python cms/tools/cms/tests/test_phase2_e2e.py
```

Each test drops + recreates `english_learning`, so it's safe to run
repeatedly against a shared container.
