# Spectr.Bff — C# .NET 10 Backend-For-Frontend

Single ASP.NET Core minimal-API process. Talks to React frontend over HTTPS;
dispatches analysis jobs to the Python worker via dramatiq/Redis; owns all
Postgres schema migrations via EF Core.

## Structure

```
src/
  Spectr.Domain/       strongly-typed IDs + cross-cutting enums
  Spectr.Data/         EF Core DbContext + entities + migrations
  Spectr.Bff/          ASP.NET Core minimal APIs + services + endpoints
tests/
  Spectr.Bff.Tests/    xUnit + WebApplicationFactory
```

## Local dev (without docker)

```pwsh
# One-time
dotnet restore
dotnet user-secrets set "Jwt:Key" "<generate-a-32+-byte-random-string>" --project src/Spectr.Bff

# Run (postgres + redis must already be up)
dotnet run --project src/Spectr.Bff
```

API serves at `http://localhost:5000`. OpenAPI doc at `/openapi/v1.json` in
Development.

## EF Core migrations

```pwsh
dotnet ef migrations add Initial --project src/Spectr.Data --startup-project src/Spectr.Bff
dotnet ef database update      --project src/Spectr.Data --startup-project src/Spectr.Bff
```

The `Initial` migration declares the entire schema (greenfield). Existing
data in any older `spectr` database is disposable.

### Manual edit required after `add Initial`

EF Core can't fluently express the *partial* unique index that enforces
"only one current version per song." After the migration is scaffolded,
open the generated `*_Initial.cs` and append to `Up()`:

```csharp
migrationBuilder.Sql(@"
    CREATE UNIQUE INDEX uq_song_versions_one_current_per_song
    ON song_versions (song_id) WHERE is_current;
");
```

and prepend to `Down()`:

```csharp
migrationBuilder.Sql("DROP INDEX IF EXISTS uq_song_versions_one_current_per_song;");
```

Without this, two rows with `is_current = true` can coexist for the same
song and library reads return ambiguous "current" versions.

## OpenAPI doc → frontend codegen

The slice-1 BFF doesn't ship an in-process `--emit-openapi` flag (.NET 10's
OpenAPI document is wired into the HTTP pipeline, not the host). Run the
BFF, curl the doc, generate types:

```pwsh
dotnet run --project src/Spectr.Bff  # in one terminal
# in another:
curl http://localhost:5000/openapi/v1.json -o ../frontend-spectr-v2/openapi.json
cd ../frontend-spectr-v2
npm run gen-types
```

## Schema ownership

All migrations live in this project. The Python worker has SQLAlchemy models
in `aimusic_shared.models` that mirror these entities — drift is caught by
fixture round-trip tests, not by separate migration tooling.
