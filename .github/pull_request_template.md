## What does this PR do?

<!-- Brief summary -->

## Schema migrations

<!-- Skip this section if no schema changes. -->

- [ ] No new migration
- [ ] New migration added: `00XX_short_name.py`
  - [ ] Every DDL in `upgrade()` is wrapped with `IF NOT EXISTS` / `IF EXISTS` (or `pg_constraint` check for `ADD CONSTRAINT`)
  - [ ] Verified locally by running `python -m migrations.runner` twice on a fresh db (second run is a no-op)

## Importer changes

<!-- Skip this section if no db/importer.py changes. -->

- [ ] Re-importing the same staging file twice produces the same db content (verified manually or with a test)
- [ ] No SELECT-then-INSERT pattern (use `INSERT ... ON CONFLICT DO UPDATE` instead)

## Testing

- [ ] Backend tests pass (`cd backend && python -m pytest tests/`)
- [ ] Frontend tests pass (`cd frontend && npm test`)
- [ ] Manual smoke: started the affected stack locally and verified the change end-to-end

## Docs

- [ ] `CLAUDE.md` updated (if operator-facing behavior changed)
- [ ] No doc change needed