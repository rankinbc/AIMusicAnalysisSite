# migrations

**The canonical schema is owned by EF Core**, not this folder.

- Live migrations: `components/bff/src/Spectr.Data/Migrations/` (EF Core 10).
  Apply with:
  `cd components/bff && dotnet ef database update --project src/Spectr.Data --startup-project src/Spectr.Bff`
- Legacy Alembic migrations (frozen v1 FastAPI api): `components/api/alembic/versions/`.
  Frozen — do not add new revisions.

This top-level folder is a historical placeholder; it contains no alembic.ini
or version scripts. New DB columns go through EF Core in Spectr.Data (and are
mirrored into `components/shared/aimusic_shared/models.py` for the worker).
