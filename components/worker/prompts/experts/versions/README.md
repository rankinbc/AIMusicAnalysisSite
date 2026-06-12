# Archived prompt versions

Rollback targets for the `prompt_versions` pin mechanism (FR48).

## Convention

Before bumping a prompt's frontmatter `version:`, copy the outgoing file
here, named `{PascalName}@{old_version}.md` (e.g. `LowEnd@1.2.0.md`), with
its frontmatter intact.

## How rollback works

1. The live prompt is always `../{PascalName}.md` — its frontmatter version
   is what runs by default.
2. To roll back without redeploy, the operator pins a version:

   ```sql
   INSERT INTO prompt_versions (slug, pinned_version, updated_at)
   VALUES ('low_end', '1.2.0', now())
   ON CONFLICT (slug) DO UPDATE
     SET pinned_version = EXCLUDED.pinned_version, updated_at = now();
   ```

3. The worker's prompt loader (TTL-cached, 60 s) picks up the pin and serves
   `versions/LowEnd@1.2.0.md`. Clearing the pin (`pinned_version = NULL` or
   deleting the row) returns to the live file.
4. Fail-open: if the pinned archive file is missing or the DB is
   unreachable, the live file is served and a warning is logged — the
   pipeline never fails a job because of the pin mechanism.

Admin endpoints for flipping pins arrive in Epic 10 (story 10.5); until
then, raw SQL as above.
