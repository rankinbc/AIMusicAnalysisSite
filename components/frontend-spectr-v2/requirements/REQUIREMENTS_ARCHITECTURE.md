# Requirements: Architecture

> Locked architectural decisions for the SPECTR rewrite. Source of truth — challenge items here only if a per-page audit surfaces a hard blocker.

---

## High-level shape

```
┌─────────────────────────┐
│  React 19 + Vite + TS   │  ← single SPA, talks only to BFF
│  frontend-spectr-v2     │
└────────────┬────────────┘
             │ HTTPS (REST + SSE)
             ▼
┌─────────────────────────┐
│  C# .NET 10 BFF         │  ← auth, users, library, references,
│  ASP.NET Core minimal   │     verdict cache reads/writes, chatbot,
│  APIs + EF Core         │     share links, feedback, file IO
└──┬──────────────────┬───┘
   │                  │
   │  dramatiq job    │  EF Core
   │  (Redis JSON)    │
   ▼                  ▼
┌──────────────────┐ ┌──────────────────┐
│ Python analysis  │ │   PostgreSQL     │  ← single shared schema
│   worker         │ │   source of      │     owned jointly by BFF
│ (kept as-is)     │ │   truth          │     and Python worker
│  • librosa       │ └──────────────────┘
│  • pyloudnorm    │
│  • allin1        │
│  • torchopenl3   │
│  • demucs (off)  │
└──────────────────┘
   │
   ▼
Local disk (dev)
Cloudflare R2 (prod-later)
abstracted by IFileStorage
```

---

## Service responsibilities

### React frontend (`frontend-spectr-v2/`)

- Talks ONLY to the C# BFF. Never directly to the Python service.
- All audio playback through WaveSurfer.js (HTTP Range requests to BFF audio route).
- Streaming chat via Vercel AI SDK `useChat` hook (consumes BFF chat SSE).
- Server state via TanStack Query; runtime validation via Zod schemas generated from BFF OpenAPI.

### C# .NET 10 BFF (`components/bff/` — new)

**Owns:**

- Auth (JWT issue/refresh, bcrypt password hashing)
- Users (profile, settings, public handle, display name, bio, avatar)
- Library (songs, song_versions, save-to-library, version rename/delete)
- Reference library (references table + reference_sets + URL ingest dispatch)
- Per-job state reads (upload_jobs, analysis_results)
- Verdict pipeline orchestration (dispatch per-specialist runs to the Python worker via dramatiq; the actual Claude CLI call stays in Python because the prompt files + validator + scoring formulas already live there)
- Chat endpoint (multi-turn coach conversation; streams via SSE in Vercel AI SDK Data Stream protocol)
- File IO via `IFileStorage` interface (local disk now, R2 later)
- Audio streaming via ASP.NET Core static-file middleware (native HTTP Range support — replaces the FastAPI scrubbing gotcha)
- Share links + feedback collection (post-Phase 1, share-link primitive)
- Notifications (write events; in-app surface + optional email)

**Does NOT own:**

- Running audio analysis (delegates to Python worker)
- Claude CLI invocation (delegates to Python worker — keeps prompt files + validator in one place)
- Audio DSP (no librosa equivalent in .NET that's worth the cost)

### Python analysis worker (`components/analysis/` + `components/worker/` — kept)

- Consumes dramatiq jobs from Redis (JSON payload, language-agnostic)
- Runs `audio_analysis.run_pipeline()` (the 7-phase pipeline + phase 8 ALS)
- Writes results to PostgreSQL (`analysis_results.final_json` + `phase_results`)
- Runs the AI specialist pipeline (Claude CLI calls via `verdict_pipeline/specialists.py`)
- Writes verdicts to `analysis_results.verdicts_payload`
- Pre-computes waveform peaks at upload time via BBC `audiowaveform` (NEW step)

The worker does NOT serve HTTP. It's a pure consumer. All user-facing routes go through the BFF.

---

## Queue mechanism — dramatiq

Replaces Celery. Reasons:

1. **Language-agnostic** — C# can post jobs as plain Redis JSON. Celery's task protocol is tightly coupled to Python's pickle/kombu world.
2. **Simpler dev model** — `@dramatiq.actor` is a thin function decorator; no per-task class inheritance.
3. **Better Postgres + middleware story** — built-in result backend support, retries, rate limiting.

### Job shape (BFF → worker)

```json
{
  "task_name": "analyze_audio_job",
  "args": ["<upload_job_uuid>"],
  "kwargs": {}
}
```

The worker fetches the full job state from Postgres on receipt — the queue is just a notification, not a payload carrier.

### Tasks defined in Python

- `analyze_audio_job(job_id)` — full 7-phase pipeline run; writes `phase_results` + `final_json`
- `precompute_waveform_peaks(job_id)` — BBC `audiowaveform` step; writes peaks JSON path
- `run_specialist(job_id, slug)` — single AI specialist; merges into `verdicts_payload`
- `analyze_reference_track(reference_id)` — full pipeline on a reference (for reference library)
- `compare_jobs(job_a_id, job_b_id)` — pre-compute compare deltas (cached)

The BFF dispatches by name + arg list. Never reaches into the Python worker's internals.

---

## Storage — IFileStorage abstraction

C# interface that hides where the bytes live.

```csharp
public interface IFileStorage
{
    Task<Stream> OpenReadAsync(string key, CancellationToken ct = default);
    Task<string> WriteAsync(string key, Stream content, string contentType, CancellationToken ct = default);
    Task<bool> DeleteAsync(string key, CancellationToken ct = default);
    Task<Uri> GetPresignedReadUrlAsync(string key, TimeSpan expiry);  // No-op for local disk; signs for R2
    Task<bool> ExistsAsync(string key);
}
```

Two implementations:

- **`LocalDiskFileStorage`** — dev/early. `key` is a relative path under `data/`. `GetPresignedReadUrlAsync` returns an internal authenticated route (`/api/files/{key}`) since local disk doesn't sign.
- **`R2FileStorage`** — prod-later. `key` becomes the R2 object key. `GetPresignedReadUrlAsync` returns a real signed URL with 10–60 min expiry.

Wire one or the other in `Program.cs` via env var (`STORAGE__PROVIDER=local|r2`). Code paths are identical.

### Key conventions

```
audio/upload/{job_id}/source.{ext}            ← original upload
audio/upload/{job_id}/reference.{ext}         ← optional reference
audio/upload/{job_id}/stems/{stem_name}.{ext}
audio/upload/{job_id}/project.als
peaks/{job_id}.json                           ← BBC audiowaveform output
reference/{reference_id}/audio.{ext}          ← references library
avatars/{user_id}/{hash}.{ext}                ← profile avatars (post-Phase 1)
```

---

## Audio streaming — ASP.NET Core static middleware

Critical: ASP.NET Core's `StaticFileMiddleware` (and `FileStreamResult`) handle HTTP Range requests natively, so scrub-able audio works without any custom code. This was the core argument for S3 + presigned URLs in the FastAPI world; .NET makes it moot for now.

Wire as an authenticated route:

```csharp
app.MapGet("/api/versions/{versionId:guid}/audio", async (
    Guid versionId, IFileStorage storage, ClaimsPrincipal user, /*...*/) =>
{
    var version = await db.SongVersions.FindAsync(versionId);
    if (version is null || version.Song.UserId != user.UserId()) return Results.NotFound();
    var key = $"audio/upload/{version.JobId}/source.wav";
    var stream = await storage.OpenReadAsync(key);
    return Results.File(stream, "audio/wav", enableRangeProcessing: true);
});
```

`enableRangeProcessing: true` is the magic flag. Without it, `<audio>` plays but cannot scrub.

For public share-link audio (anonymous listener via `/r/{token}`), the same pattern but auth replaced by token validation against `share_links` table.

---

## Auth model

- **Access token**: JWT in React memory only (NEVER localStorage — XSS risk). 15 min expiry.
- **Refresh token**: httpOnly + Secure + SameSite=Lax cookie, set server-side. 30 day expiry.
- **Silent refresh** on app mount; React waits in a loading state, doesn't redirect to login.
- **Login**: email + bcrypt-hashed password.
- **Registration**: same; no email verification in v1.
- **OAuth/social login**: deferred; design pages have no Google/Apple/SoundCloud auth.

C# implementation: `Microsoft.AspNetCore.Authentication.JwtBearer` + `BCrypt.Net-Next`. Refresh token rotation on each refresh.

---

## Schema ownership (revised — greenfield)

Single Postgres database. **EF Core owns all migrations.** Schema lives in `components/bff/src/Spectr.Data/Migrations/`. There is no split-ownership and no Alembic on the worker side.

The Python analysis worker keeps SQLAlchemy models in `aimusic_shared.models` that mirror the EF Core entities. The models are reading/writing only — they don't manage schema. Cross-language drift is caught by round-trip tests on fixture data.

### Table inventory (13 tables total, all EF Core)

| Family | Tables | Owner of writes |
|---|---|---|
| Identity | `users`, `refresh_tokens` | BFF |
| Library | `songs`, `song_versions` | BFF |
| Analysis | `analysis_jobs` (transient state), `analyses` (permanent results), `verdicts` (promoted from JSONB) | Python worker writes during pipeline; BFF reads + dispatches |
| User overlay | `verdict_user_state`, `session_notes` | BFF |
| References | `reference_tracks`, `reference_sets`, `reference_set_members` | BFF; worker writes analyzed metrics into `reference_tracks` |
| Compare | `compare_cache` | BFF |
| Feedback (Phase 1.5) | `track_comments`, `track_bookmarks` (polymorphic) | BFF; share-link writes are anonymous |

### What changed from R1's design

- **`upload_jobs` → `analysis_jobs`** — clearer name now that scope expands.
- **`analysis_results` → `analyses`** — same idea, leaner. Denormalized `user_id`, `song_id`, `song_name` for fast list queries.
- **Verdicts promoted from JSONB array to first-class table** — sortable, queryable, indexed, joinable cleanly to `verdict_user_state` via FK.
- **`waveform_peaks_path` on `analyses`** — explicit pointer; pre-computed by the worker via BBC `audiowaveform`.
- **`phase_durations` JSONB on `analyses`** — small map for the pipeline timeline. Replaces the fat `phase_results` array.
- **`share_token` is nullable** — only generated when the producer enables sharing, not eagerly on every job.
- **`share_show_verdicts`** — controls whether the public share page surfaces verdicts.
- **No `verdicts_prompt_version_set`** — the batch cache-validity key is meaningless in the on-demand specialist model.
- **`references` → `reference_tracks`** — avoids SQL reserved-word friction.
- **Polymorphic `track_comments` / `track_bookmarks`** — nullable `target_share_token` + nullable `target_published_track` + CHECK exactly one. v1.5 uses share-token arm; Phase 4 flips on the published-track arm.
- **`compare_cache`** — per-pair cache for the Compare page; unique on `(track_version_id, reference_id)`.

### Migration workflow

```pwsh
# After any entity change in components/bff/src/Spectr.Data/Entities/**
dotnet ef migrations add <Name> `
    --project components/bff/src/Spectr.Data `
    --startup-project components/bff/src/Spectr.Bff

# Apply
dotnet ef database update `
    --project components/bff/src/Spectr.Data `
    --startup-project components/bff/src/Spectr.Bff
```

Worker-side SQLAlchemy models in `aimusic_shared.models` mirror the C# entities. Regenerate after every migration via a Python script that introspects the DB or by manual port (the model set is small).

The partial unique index for `song_versions.is_current` (only one current version per song) needs raw SQL in the initial migration — EF Core doesn't expose partial-index DSL fluently for Postgres yet. Add via `migrationBuilder.Sql("CREATE UNIQUE INDEX ... WHERE is_current")`.

Existing data is disposable — first migration blank-slates everything.

---

## ID strategy

- **All primary keys are UUIDs (v4)** — matches existing `aimusic_shared.models`.
- C# uses `Guid`; PostgreSQL stores as `uuid`; React reads as string.
- Avoid the `BIGSERIAL` pattern from the Claude Desktop schema sketch — would break consistency with the Python side.

---

## Identity / username

Authoritative source: `components/bff/src/Spectr.Data/Entities/User.cs`.

Identity columns on `users`:

```
users.handle            citext unique (3-32 chars, [a-z0-9_]); auto-seeded at register
users.display_name      text (≤80)
users.bio               text (≤500)
users.avatar_hue        smallint (0-359)
users.banner_hue        smallint (0-359)
users.accent            text   (cyan | violet | orange | yellow | green | red)
users.public_link       text (≤200)
users.ui_prefs          jsonb  ({ density: "regular" | "compact", ... })
```

`handle` is the only ID-like field; everything else is editable display state. Auto-seeded at register from `email.split('@')[0]` + numeric suffix on collision. Editable in Settings.

---

## Frontend stack

| Concern | Pick |
|---|---|
| Build | Vite 6 |
| Language | TypeScript (strict) |
| UI primitives | Radix UI (à la carte) |
| Styling | CSS Modules + `tokens.css` (CSS variables) — **no Tailwind, no styled-components** |
| Charts | Recharts (default); Visx only for charts Recharts can't handle |
| Audio | WaveSurfer.js v7 (consumes pre-computed peaks JSON) |
| Server state | TanStack Query |
| Validation | Zod (schemas generated from BFF OpenAPI via `orval` or `openapi-typescript-codegen`) |
| Routing | TanStack Router (typed routes) |
| Chat | Vercel AI SDK `useChat` |
| Drag/drop | dnd-kit |
| Toasts | Sonner |
| Tables | TanStack Table (only when needed; library grid doesn't need it) |
| Testing (unit) | Vitest |
| Testing (E2E) | Playwright |

### Source layout

```
components/frontend-spectr-v2/
├── src/
│   ├── app/                ← TanStack Router routes
│   ├── api/                ← generated OpenAPI client + Zod schemas
│   ├── components/
│   │   ├── ui/             ← primitives: Card, Pill, Meter, GradePill, …
│   │   └── feature/        ← VerdictCard, SpecialistTile, SongCard, …
│   ├── pages/              ← Results, Listen, Library, Discover, Profile, Compare
│   ├── hooks/              ← useAudioPlayer, useWaveform, …
│   ├── lib/                ← formatters, audio helpers
│   ├── styles/
│   │   └── tokens.css      ← CSS variables (--cyan, --surface, severity colors, …)
│   └── main.tsx
├── tests/
└── playwright/
```

---

## Backend stack (C# BFF)

| Concern | Pick |
|---|---|
| Framework | ASP.NET Core 10 minimal APIs |
| ORM | EF Core 10 (Postgres provider: Npgsql.EntityFrameworkCore.PostgreSQL) |
| Auth | `Microsoft.AspNetCore.Authentication.JwtBearer` + custom refresh cookie |
| Password hash | `BCrypt.Net-Next` |
| Queue client | `dramatiq` over Redis — call via lightweight Redis client (`StackExchange.Redis`) using dramatiq's JSON wire format |
| OpenAPI | Built-in (`AddOpenApi()` in .NET 10) — drives codegen for frontend |
| Logging | Serilog (structured to stdout for prod; PrettyConsoleSink in dev) |
| Validation | FluentValidation (DTO validation at API boundary) |
| Testing | xUnit + WebApplicationFactory for integration tests |

### Source layout

```
components/bff/
├── src/
│   ├── Spectr.Bff/                   ← ASP.NET Core entry
│   │   ├── Program.cs
│   │   ├── Endpoints/                ← one file per resource family
│   │   │   ├── AuthEndpoints.cs
│   │   │   ├── SongEndpoints.cs
│   │   │   ├── VersionEndpoints.cs
│   │   │   ├── VerdictEndpoints.cs
│   │   │   ├── ReferenceEndpoints.cs
│   │   │   ├── CoachEndpoints.cs
│   │   │   └── FileEndpoints.cs
│   │   ├── Services/                 ← IFileStorage, JobQueue, etc.
│   │   ├── DTOs/                     ← public API contracts
│   │   └── Infrastructure/           ← auth, middleware
│   ├── Spectr.Data/                  ← EF Core context + entities + migrations
│   └── Spectr.Domain/                ← domain types shared between Bff and Data
└── tests/
    └── Spectr.Bff.Tests/
```

---

## Cross-language contract

The BFF and Python worker share Postgres, which is the integration contract. **EF Core entities in `components/bff/src/Spectr.Data/Entities/**` are the normative source of truth for the schema.** The Python worker's SQLAlchemy models in `aimusic_shared/models.py` mirror them.

They MUST agree on:

1. **Table schemas** — column names, types, constraints. EF Core migrations are authoritative; Python models are regenerated/maintained to match.
2. **`final_json` shape inside `analyses.final_json`** — Python pipeline writes this JSONB blob; BFF deserializes it for the Results page. Shape stays in CLAUDE.md.
3. **`Verdict` row shape** — now a relational table with explicit columns. Python worker's verdict-pipeline writes rows directly; C# reads them.
4. **`status` string values on `analysis_jobs`** — `pending | processing | complete | failed | awaiting_stem_mapping`. Defined in `Spectr.Domain/Enums.cs` (C#) and as a Python enum.
5. **Dramatiq task names** — string constants. Defined in `components/shared/queue-tasks.md` (single source of truth).
6. **`fix.steps[]` JSON shape inside `verdicts.fix`** — wire format between Coach (specialist prompt output) and Listen ToolsRail (Apply Preset consumer). Shape: `[{kind, where, what, from, to}]` with `kind` enum from `Spectr.Domain.FixStepKind`.

To enforce drift catches: C# round-trip tests load fixture JSON via the EF Core entity, then deserialize via a Python script and compare. Pydantic2ts could automate but is currently broken on Windows — hand-mirror is fine for now given the small surface.

---

## Notifications / real-time

- **Job progress** — SSE from BFF (`GET /api/jobs/{id}/stream`); BFF polls `analysis_jobs.phase_pct` and pushes updates.
- **Verdict run progress** — SSE same pattern.
- **Chat streaming** — SSE from BFF (`POST /api/coach/chat`); BFF streams Claude API responses in Vercel AI SDK Data Stream format.
- **Notifications bell** — TanStack Query polling at 60 s intervals; future migration to WebSocket if/when needed.

No WebSocket in v1.

---

## Local development

Single `docker-compose.yml`:

```
services:
  postgres:      official postgres:16
  redis:         official redis:7
  bff:           dotnet run (.NET 10 sdk)
  worker:        python -m dramatiq spectr.worker
  frontend:      vite dev server on 5174
```

No allin1/Demucs containers in v1 (still pinned off by `USE_DEMUCS=False`; allin1 stays in worker image for Windows-via-Docker users).

---

## Items explicitly NOT in this architecture

- WebSockets (poll/SSE is enough)
- Service mesh / inter-service auth (BFF ↔ worker is single-tenant, single-network)
- Multi-tenancy (single-user-per-account; no orgs)
- Background mailers (notifications-via-email is post-Phase-1)
- Search infrastructure (Postgres FTS only; no Elastic/Meilisearch)
- File scanning / virus check (post-public launch)
- Rate limiting (post-public launch)
- Feature flags (use simple env vars; LaunchDarkly is overkill)

---

## What changes if these assumptions break

| Assumption | What flips |
|---|---|
| dramatiq turns out to have a bad C# wire-format match | Fall back to a thin BFF→Python HTTP endpoint inside the worker (`POST /internal/jobs`). Adds one hop. |
| Local-disk + ASP.NET Core range requests fail at scale | Move to R2 sooner (Cloudflare R2 free tier; same `IFileStorage` swap). |
| EF Core migrations conflict with Alembic | Carve schema ownership tighter (BFF tables and worker tables in separate schemas: `bff.*` and `worker.*`). |
| WaveSurfer-decoded peaks too slow on mobile | Pre-compute peaks via `audiowaveform` at upload (already on the worker task list). |
| C# JWT auth too painful to port from FastAPI | Stay with FastAPI as the auth issuer for v1; BFF validates upstream-issued JWTs. Probably overkill — `JwtBearer` is fine. |
