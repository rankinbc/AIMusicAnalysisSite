# PRP: v2 Slice 1 — Auth + Library + First Upload

**Status:** Draft
**Effort:** L (1–2 weeks, evenings)
**Phase:** v2 / Phase 1 / Slice 1
**Confidence (one-pass implementation):** 7/10

---

> **Why this slice first?** The v2 BFF, EF entities, frontend route shells, and Python pipeline already exist as scaffolds — every BFF endpoint returns `501 NotImplemented`. Nothing is connected. This slice picks the shortest end-to-end path that proves the entire architecture works against itself: a real human can register, log in, create a Song, upload an audio file as its first version, see a dramatiq job get dispatched, watch the Python worker write `analyses.final_json`, and read the result back through the BFF. Everything else (verdicts, Listen DSP, references, Compare, comments, profile editing, waveform peaks, SSE streaming, real component library, CSS Modules) is deferred to later slices. Get the spine working; decorate later.

---

## Goal

After this PRP lands, a developer can run `docker compose up -d postgres redis && dotnet run --project components/bff/src/Spectr.Bff && python -m dramatiq spectr.worker && npm run dev`, register a new account in the browser, log in, land on `/library`, create an empty song, upload a `.wav`, watch the polling progress, and view the analysis `final_json` rendered as JSON on `/songs/$songId/results/$jobId`. A Playwright spec asserts the full path.

## Why

- The scaffold already encodes every architectural decision (EF Core schema, dramatiq queue, IFileStorage, JWT + httpOnly refresh, TanStack Router `_app/_public` split). Filling in the spine validates those decisions cheaply.
- The verdict pipeline, Listen page, references, and Compare are all greenfield workstreams that can run in parallel — but only after Slice 1 proves that BFF → Redis → Python → Postgres → BFF → Frontend round-trip works.
- Auth + library + upload is also the only set of endpoints that every later slice depends on.

## What

### User-visible behavior

1. Anonymous user lands at `/`, gets redirected to `/login`.
2. From `/login` they can switch to `/register`, enter email + password, submit, and be immediately logged in (no email verification in v1).
3. Logged-in users land on `/library` (empty state on first visit).
4. From `/library` they can open a "New song" form (modal or page), enter a name, submit, and see the new song card appear.
5. They can click "Upload version" on a song card, pick a `.wav` / `.flac` / `.mp3` file, and see an upload-progress bar. On success the browser navigates to `/songs/$songId/results/$jobId`.
6. The results page polls `/api/jobs/$jobId` every 2 s; while status is `pending`/`processing` it shows a phase progress strip; when `complete` it fetches `/api/jobs/$jobId/results` and renders `final_json` as pretty-printed JSON.
7. Refreshing the page mid-job continues polling from the current status. Logging out clears the access token and the refresh cookie and bounces back to `/login`.

### Success Criteria

- [ ] `POST /auth/register` creates a `users` row with bcrypt-hashed password, auto-seeded `handle` (`<email-prefix>` + numeric suffix on collision), and returns `{ access_token, user: { id, email, handle } }` plus a `spectr_refresh` httpOnly cookie.
- [ ] `POST /auth/login` validates password against bcrypt hash and issues the same response shape.
- [ ] `POST /auth/refresh` rotates the refresh cookie (writes new `refresh_tokens` row, marks old one `revoked_at`) and returns a fresh access token.
- [ ] `POST /auth/logout` revokes the current refresh-token row and clears the cookie.
- [ ] `GET /auth/me` returns `{ id, email, handle, display_name }` for the bearer-authed user.
- [ ] `GET /api/songs?include=versions,latest_result` returns the caller's non-archived songs with their versions + the latest `analyses` row joined.
- [ ] `POST /api/songs` with `{ name }` creates a `songs` row scoped to the caller.
- [ ] `GET /api/songs/{songId}` enforces `user_id == current_user.id` (404 on any other row).
- [ ] `PATCH /api/songs/{songId}` updates `name` only.
- [ ] `DELETE /api/songs/{songId}` sets `archived_at = now()`.
- [ ] `POST /api/songs/{songId}/restore` clears `archived_at`.
- [ ] `POST /api/versions` (multipart, fields: `file` required, `song_id` optional, `genre_hint` optional):
  - Saves the file via `IFileStorage` under `audio/upload/{jobId}/source.{ext}`.
  - Auto-creates a `Song` if `song_id` is null (name = filename stem).
  - Creates a `SongVersion` row with `version_number = max+1` for that song, `is_current = true`, demoting prior current version.
  - Creates an `AnalysisJob` row with `status = "pending"`, `version_id` set.
  - Enqueues `analyze_audio_job(jobId)` on the `default` dramatiq queue.
  - Returns `{ song_id, version_id, job_id }`.
- [ ] `GET /api/versions/{versionId}` returns version metadata (404 on cross-user).
- [ ] `DELETE /api/versions/{versionId}` deletes the version row and the file in storage (best-effort).
- [ ] `GET /api/jobs/{jobId}` returns `{ id, status, current_phase, phase_pct, version_id, song_id, error_message }`.
- [ ] `GET /api/jobs/{jobId}/results` returns `{ job_id, version_id, song_id, song_name, final_json, share_token }`.
- [ ] The Python worker dramatiq actor `analyze_audio_job` reads the queued envelope, looks up `analysis_jobs` by id, calls `audio_analysis.run_pipeline()`, writes an `analyses` row with `final_json`, flips `analysis_jobs.status` to `complete`, and is resilient to transient failures (mark `failed` + record `error_message` on exception).
- [ ] `npm run gen-types` runs cleanly against `openapi.json` and the generated TanStack-Query client is used by every fetch in slice-1 pages.
- [ ] The Playwright smoke spec passes against `docker compose up` + `dotnet run` + `python -m dramatiq spectr.worker` + `npm run dev`.
- [ ] Validation gates in §Validation Loop all pass.

## All Needed Context

### Documentation & References

```yaml
- file: components/frontend-spectr-v2/requirements/REQUIREMENTS_ARCHITECTURE.md
  why: Locked stack decisions. §Auth model, §Identity, §Queue mechanism — dramatiq, §Schema ownership are all load-bearing for this slice.

- file: components/frontend-spectr-v2/requirements/REQUIREMENTS_AUDIT.md
  why: Phased plan + Phase 1 scope. §Cross-cutting changes #6 is the `/jobs/{id}/results` envelope expansion this slice ships.

- file: components/bff/README.md
  why: Run + migration commands. `dotnet ef migrations add Initial` is the exact command to run.

- file: components/bff/src/Spectr.Data/AppDbContext.cs
  why: DbContext + indexes/checks already declared. Use as-is — do not add entities.

- file: components/bff/src/Spectr.Data/Entities/User.cs
  why: handle + display_name + ui_prefs columns exist; just populate them.

- file: components/bff/src/Spectr.Data/Entities/RefreshToken.cs
  why: token_hash is SHA-256 of the cookie value. Never store raw cookie.

- file: components/bff/src/Spectr.Data/Entities/Song.cs
  why: archived_at column for soft-delete; user_id is the IDOR boundary.

- file: components/bff/src/Spectr.Data/Entities/SongVersion.cs
  why: is_current bool — only one true per song (partial unique index needs raw SQL in Initial migration; see §Known Gotchas).

- file: components/bff/src/Spectr.Data/Entities/AnalysisJob.cs
  why: status string + current_phase + phase_pct — drive the polling UI from these.

- file: components/bff/src/Spectr.Data/Entities/Analysis.cs
  why: final_json JSONB is the canonical result blob. song_name denormalized for fast list queries.

- file: components/bff/src/Spectr.Bff/Program.cs
  why: JwtBearer + AppDbContext + IFileStorage + IJobQueue already wired. Don't touch unless adding services.

- file: components/bff/src/Spectr.Bff/Services/IFileStorage.cs
  why: LocalDiskFileStorage already implemented. Use it. Storage:LocalRoot in appsettings.

- file: components/bff/src/Spectr.Bff/Services/IJobQueue.cs
  why: DramatiqJobQueue envelope shape — must match dramatiq's wire format on the Python side.

- file: components/bff/src/Spectr.Bff/Endpoints/*.cs
  why: All stubs returning 501. Each file's group/route table is authoritative; replace `Results.NotImplemented()` with real handlers, do NOT change paths or HTTP verbs.

- file: components/worker/app/tasks.py
  why: Existing Celery task body shows how run_pipeline is called. Port this logic to the dramatiq actor; keep the try/finally around finalize_job.

- file: components/shared/aimusic_shared/models.py
  why: SQLAlchemy mirrors of EF entities. Already current for v2 (analysis_jobs, analyses, songs, song_versions, users, refresh_tokens). Use these — don't redefine.

- file: components/frontend-spectr-v2/src/main.tsx
  why: QueryClient + RouterProvider wiring. Slice 1 adds an AuthProvider context above QueryClientProvider.

- file: components/frontend-spectr-v2/src/routes/__root.tsx
  why: RouterContext interface — extend to include `auth` so beforeLoad guards can read it.

- file: components/frontend-spectr-v2/vite.config.ts
  why: /api proxy → http://localhost:5000. BFF dev port is 5000, frontend is 5174.

- file: components/frontend-spectr-v2/orval.config.ts
  why: Input is ./openapi.json at the frontend root. The BFF emits this via `dotnet run -- --emit-openapi` (per components/bff/README.md).

- file: components/frontend-spectr-v2/src/api/fetcher.ts
  why: Already wired as the orval mutator — make sure it injects the bearer token from AuthContext and handles 401 → silent-refresh-and-retry.

- file: PRPs/templates/prp_base.md
  why: Structural template — section ordering followed here.

- file: CLAUDE.md
  why: Project rules. §Stack-specific rules — Python and TS sections both apply to this slice.

- url: https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/parameter-binding?view=aspnetcore-10.0
  why: How to bind IFormFile + IFormFile collections in minimal APIs (multipart upload route).

- url: https://learn.microsoft.com/en-us/aspnet/core/security/authentication/jwt-authn?view=aspnetcore-10.0
  why: Building JwtSecurityToken + signing — pattern for AuthEndpoints.

- url: https://dramatiq.io/guide.html#broker
  why: Broker = Redis. Confirms queue name `default` and message envelope shape used by DramatiqJobQueue.

- url: https://tanstack.com/router/latest/docs/framework/react/guide/authenticated-routes
  why: beforeLoad redirect pattern for `_app` layout (the auth guard).

- url: https://tanstack.com/query/latest/docs/framework/react/guides/query-functions
  why: Standard usage; the orval-generated hooks consume QueryClient from main.tsx context.
```

### Current backend tree (relevant slice)

```
components/bff/
├── src/
│   ├── Spectr.Bff/
│   │   ├── Program.cs                          ← services wired, no migrations applied
│   │   ├── Endpoints/
│   │   │   ├── AuthEndpoints.cs                ← all 501
│   │   │   ├── SongEndpoints.cs                ← all 501
│   │   │   ├── VersionEndpoints.cs             ← all 501
│   │   │   ├── JobEndpoints.cs                 ← all 501
│   │   │   └── … (others — out of scope for slice 1)
│   │   ├── Services/
│   │   │   ├── IFileStorage.cs                 ← Local impl ready
│   │   │   └── IJobQueue.cs                    ← DramatiqJobQueue ready
│   │   ├── Infrastructure/
│   │   │   └── Endpoints.cs                    ← marker only; add Auth helpers here
│   │   ├── appsettings.json                    ← Postgres + Jwt + Storage + Redis
│   │   └── Spectr.Bff.csproj                   ← BCrypt.Net-Next + JwtBearer + Redis pinned
│   ├── Spectr.Data/
│   │   ├── AppDbContext.cs                     ← every entity registered, indexes + checks declared
│   │   └── Entities/*.cs                       ← entire v2 schema
│   └── Spectr.Domain/                          ← strongly-typed IDs (existing)
└── tests/Spectr.Bff.Tests/                     ← scaffolded, empty

components/worker/
├── app/
│   ├── celery_app.py                           ← Celery wiring (will be retired in slice 1)
│   ├── tasks.py                                ← Celery task; logic ports to dramatiq actor
│   ├── db.py                                   ← session + helpers
│   ├── progress.py                             ← progress_cb factory
│   ├── signals.py                              ← worker_ready model-preload
│   └── tasks_cleanup.py                        ← AWAITING_STEM_MAPPING janitor (out of scope)
└── requirements.txt                            ← lists celery — REPLACE with dramatiq[redis]

components/shared/aimusic_shared/
└── models.py                                   ← v2-current mirror of EF entities (re-verify)
```

### Desired backend tree

```
components/bff/
├── src/
│   ├── Spectr.Bff/
│   │   ├── Program.cs                          ← (+ FluentValidation, + Serilog console, + emit-openapi flag)
│   │   ├── Endpoints/
│   │   │   ├── AuthEndpoints.cs                ← register/login/refresh/logout/me FULL
│   │   │   ├── SongEndpoints.cs                ← list/create/get/patch/delete/restore FULL
│   │   │   ├── VersionEndpoints.cs             ← POST upload + GET + DELETE FULL; the rest stay 501
│   │   │   └── JobEndpoints.cs                 ← GET job + GET results FULL; list + stream stay 501
│   │   ├── Auth/
│   │   │   ├── JwtTokenService.cs              ← NEW: builds + validates access tokens
│   │   │   ├── RefreshTokenService.cs          ← NEW: SHA-256 hash + rotate + revoke
│   │   │   ├── PasswordHasher.cs               ← NEW: thin BCrypt wrapper (cost 12)
│   │   │   ├── HandleSeeder.cs                 ← NEW: email-prefix + suffix-on-collision
│   │   │   └── ClaimsPrincipalExtensions.cs    ← NEW: UserId() helper
│   │   ├── DTOs/
│   │   │   ├── AuthDtos.cs                     ← NEW: RegisterRequest/LoginRequest/AuthResponse
│   │   │   ├── SongDtos.cs                     ← NEW: SongDto/CreateSongRequest/PatchSongRequest
│   │   │   ├── VersionDtos.cs                  ← NEW: VersionDto/UploadResponse
│   │   │   └── JobDtos.cs                      ← NEW: JobStatusDto/JobResultsDto
│   │   ├── Services/
│   │   │   ├── IFileStorage.cs                 ← unchanged
│   │   │   ├── IJobQueue.cs                    ← unchanged
│   │   │   └── DramatiqTasks.cs                ← NEW: string constants (analyze_audio_job, etc.)
│   │   └── Infrastructure/
│   │       └── ProblemDetailsExtensions.cs     ← NEW: tiny helper for consistent 4xx shapes
│   └── Spectr.Data/
│       ├── AppDbContext.cs                     ← unchanged (entities are already complete)
│       └── Migrations/                         ← NEW (auto-generated by dotnet ef migrations add Initial)
└── tests/Spectr.Bff.Tests/
    ├── AuthEndpointsTests.cs                   ← NEW: WebApplicationFactory + Testcontainers Postgres
    ├── SongEndpointsTests.cs                   ← NEW
    ├── VersionEndpointsTests.cs                ← NEW (mock IJobQueue)
    └── JobEndpointsTests.cs                    ← NEW

components/worker/
├── app/
│   ├── dramatiq_app.py                         ← NEW: Broker = RedisBroker(REDIS_URL); declares actors
│   ├── tasks_dramatiq.py                       ← NEW: @dramatiq.actor analyze_audio_job; ports tasks.py logic
│   ├── db_sync.py                              ← NEW: sync SQLAlchemy session factory (dramatiq actors are sync)
│   └── (legacy celery files remain but are not imported by the dramatiq entry point)
├── requirements.txt                            ← add `dramatiq[redis]>=1.16`
└── Procfile                                    ← worker: python -m dramatiq spectr.worker

# Note: keep celery files in place — slice 1 ships the dramatiq entry point alongside.
# A later slice can delete tasks.py + celery_app.py once nothing references them.
```

### Current frontend tree (relevant slice)

```
components/frontend-spectr-v2/
├── src/
│   ├── main.tsx                                ← QueryClient + Router only
│   ├── routes/
│   │   ├── __root.tsx                          ← RouterContext { queryClient }
│   │   ├── index.tsx                           ← redirect to /library (will redirect to /login when no auth)
│   │   ├── _public.tsx                         ← shell
│   │   ├── _public/login.tsx                   ← placeholder
│   │   ├── _app.tsx                            ← shell (no beforeLoad)
│   │   ├── _app/library.tsx                    ← placeholder
│   │   └── _app/songs.$songId.results.$jobId.tsx  ← placeholder
│   ├── api/fetcher.ts                          ← orval mutator (needs token injection)
│   ├── components/                             ← (mostly empty in slice 1)
│   └── styles/
├── orval.config.ts                             ← reads ./openapi.json
└── playwright/                                 ← scaffold present
```

### Desired frontend tree

```
src/
├── main.tsx                                    ← wraps RouterProvider in AuthProvider
├── auth/
│   ├── AuthContext.tsx                         ← NEW: { user, accessToken, login, logout, isLoading, refresh }
│   ├── useAuth.ts                              ← NEW: hook
│   └── silentRefresh.ts                        ← NEW: POST /auth/refresh on mount; once
├── api/
│   ├── fetcher.ts                              ← inject bearer; on 401 → refresh-then-retry once
│   └── generated/                              ← orval output (regenerated)
├── routes/
│   ├── __root.tsx                              ← extend RouterContext with `auth`
│   ├── _public.tsx                             ← unchanged
│   ├── _public/login.tsx                       ← FULL form
│   ├── _public/register.tsx                    ← NEW
│   ├── _app.tsx                                ← beforeLoad: if !auth.user → redirect /login
│   ├── _app/library.tsx                        ← FULL — list + new-song modal + upload-version modal
│   ├── _app/songs.$songId.tsx                  ← NEW: song detail + versions list + upload button
│   └── _app/songs.$songId.results.$jobId.tsx   ← FULL — polling + JSON render
├── pages/
│   └── components/
│       ├── NewSongDialog.tsx                   ← NEW: Radix Dialog + form
│       └── UploadVersionDialog.tsx             ← NEW: file picker + XHR with progress
├── hooks/
│   └── useFileUpload.ts                        ← NEW: XMLHttpRequest with progress callback (Fetch lacks upload progress)
└── playwright/
    └── slice-1-happy-path.spec.ts              ← NEW: full E2E
```

### Known Gotchas

```text
# === C# / .NET / EF Core ===

# CRITICAL: EF Core migration command is project-aware. The startup project must include
# Microsoft.EntityFrameworkCore.Design as a PackageReference (already in Spectr.Bff.csproj).
# Run from the bff/ root, NOT from inside src/Spectr.Bff:
#   dotnet ef migrations add Initial \
#       --project src/Spectr.Data \
#       --startup-project src/Spectr.Bff
# If you forget --startup-project, EF can't load the DbContext and you get a vague
# "No DbContext was found" — read the error and re-run with both args.

# CRITICAL: SongVersion.IsCurrent partial unique index isn't expressible via fluent EF
# Core for Postgres. AppDbContext only declares the CHECK constraint. After the Initial
# migration is scaffolded, MANUALLY add to its Up():
#   migrationBuilder.Sql(@"
#       CREATE UNIQUE INDEX uq_song_versions_one_current_per_song
#       ON song_versions (song_id) WHERE is_current;
#   ");
# and the matching DropIndex in Down(). Without this, two rows with is_current=true can
# coexist for the same song and the library UI breaks subtly.

# CRITICAL: pgcrypto + citext extensions are declared in OnModelCreating
# (HasPostgresExtension). The Initial migration's Up() will issue CREATE EXTENSION IF NOT
# EXISTS — this requires the connecting Postgres role to have CREATE on the database.
# The docker-compose postgres role is the database owner so this works; on a managed
# instance you'd need to pre-create the extensions as a superuser.

# CRITICAL: BCrypt.Net-Next's WorkFactor (cost) defaults to 11. We want 12 for v1.
# Use BCrypt.HashPassword(password, workFactor: 12). Cost 12 is ~250ms per hash on a
# modern CPU — acceptable for register/login, NOT for batch verification.

# CRITICAL: Refresh-token cookie config — set SameSite=Lax (NOT Strict, breaks the
# /login redirect from external links), HttpOnly=true, Secure=true (Lax + Secure work
# together on localhost in modern browsers; Chrome warns but allows). Path="/auth"
# scopes the cookie so it isn't sent on every API call:
#     Response.Cookies.Append("spectr_refresh", rawToken, new CookieOptions {
#         HttpOnly = true, Secure = true, SameSite = SameSiteMode.Lax,
#         Path = "/auth", Expires = DateTimeOffset.UtcNow.AddDays(30) });
# Then store SHA-256(rawToken) in refresh_tokens.token_hash.

# CRITICAL: Multipart upload + IFormFile binding requires
# `[FromForm]` binding source in minimal APIs and a max body size limit. Default
# request body limit is 30 MB; we need 250 MB for a long FLAC. Configure once:
#     builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 250 * 1024 * 1024);
# AND on the endpoint:
#     .WithMetadata(new RequestSizeLimitAttribute(250 * 1024 * 1024))
#     .DisableAntiforgery();   // multipart from React would otherwise need a token

# CRITICAL: Stream the upload to disk — DO NOT call IFormFile.OpenReadStream() into a
# MemoryStream. Use IFileStorage.WriteAsync with the IFormFile.OpenReadStream() directly:
#     await using var src = file.OpenReadStream();
#     var key = $"audio/upload/{jobId}/source{Path.GetExtension(file.FileName)}";
#     await fileStorage.WriteAsync(key, src, file.ContentType, ct);
# LocalDiskFileStorage already does CopyToAsync which is chunk-streamed by Kestrel.

# CRITICAL: ClaimsPrincipal in minimal APIs — inject via parameter, then extract user_id
# from the "sub" claim (RFC 7519). Wrap in an extension so callers stay clean:
#     public static Guid UserId(this ClaimsPrincipal p) =>
#         Guid.Parse(p.FindFirstValue(JwtRegisteredClaimNames.Sub)!);
# Never read User from HttpContext directly in handler bodies.

# CRITICAL: AppDbContext is scoped by AddDbContext. Don't capture it in a singleton
# (e.g. don't pass it into IJobQueue construction). All endpoint handlers take it via
# parameter injection.

# CRITICAL: appsettings.json's Storage:LocalRoot is "../../../data" RELATIVE to bff
# csproj working dir. That resolves to the repo root's `data/` only when dotnet run is
# launched from components/bff. When running from VSCode/Rider, set Working Directory
# explicitly. Worth noting in BFF README too.

# CRITICAL: OpenAPI emission for orval — built-in .NET 10 AddOpenApi() serves the doc
# at /openapi/v1.json at runtime. For codegen, fetch via curl or add a small main-arg
# hook:
#     if (args.Contains("--emit-openapi")) { /* write doc to stdout and exit */ }
# Slice 1 keeps it simple: curl localhost:5000/openapi/v1.json > ../frontend-spectr-v2/openapi.json
# after running the BFF. Document this in BFF README.

# === Dramatiq + Python worker ===

# CRITICAL: DramatiqJobQueue in C# pushes JSON to Redis list "dramatiq:default" via
# LPUSH. Dramatiq's RedisBroker reads from the SAME list via BRPOPLPUSH. The envelope
# field names must match EXACTLY (queue_name, actor_name, args, kwargs, options,
# message_id, message_timestamp). If you change one field in C#, dramatiq raises
# DecodeError on the worker and the message is dead-lettered.

# CRITICAL: Dramatiq actors are SYNC. The pipeline call is sync (run_pipeline is sync).
# Use a sync SQLAlchemy session in the actor — see components/shared/aimusic_shared/models.py;
# do NOT mix in the async session from db.py. New file db_sync.py wraps create_engine +
# sessionmaker without asyncio.

# CRITICAL: Worker entry point. The dramatiq CLI loads the broker via the module path:
#     python -m dramatiq spectr.worker        # NO — spectr.worker isn't a package
#     python -m dramatiq app.dramatiq_app     # YES — point at components/worker/app/dramatiq_app.py
# Set PYTHONPATH so `app` resolves. Procfile already does `python -m dramatiq app.dramatiq_app`.

# CRITICAL: When the actor catches an exception, you MUST update analysis_jobs.status
# to "failed" + error_message inside a NEW transaction (session.rollback() first). The
# canonical pattern is in components/worker/app/tasks.py — port it. Without rollback,
# the FAILED update fails silently and the job sticks in PROCESSING.

# CRITICAL: SQLAlchemy 2.0 + Postgres uuid columns — server-side defaults won't fire
# when you instantiate Python-side. ALWAYS pass id=uuid.uuid4() explicitly when
# constructing a row (matches the existing pattern in components/worker/app/db.py).

# === Frontend / TanStack / React 19 ===

# CRITICAL: TanStack Router's beforeLoad runs in the data loader, NOT in the component.
# It runs once on navigation. To re-evaluate auth after a silent-refresh on mount,
# router.invalidate() once the AuthContext resolves. Otherwise the `_app` guard fires
# with stale state on first paint.

# CRITICAL: Access token lives in React state only. NEVER localStorage / sessionStorage
# (XSS exfiltration risk). The orval fetcher reads from a useAuth() hook via a thin
# wrapper. On 401, the fetcher must call /auth/refresh ONCE; if that also 401s, clear
# auth state and navigate to /login. Use an isRefreshing flag + a per-request queue to
# avoid N concurrent refresh calls.

# CRITICAL: TanStack Query auto-retries failed queries. For /auth/me, set retry: false
# so a 401 doesn't thrash the refresh flow.

# CRITICAL: File upload progress. Fetch API has no upload progress events. Use XHR:
#     const xhr = new XMLHttpRequest();
#     xhr.upload.addEventListener('progress', e => setPct(e.loaded / e.total));
#     xhr.open('POST', '/api/versions');
#     xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
#     xhr.send(formData);
# Wrap in a promise; this is what useFileUpload does.

# CRITICAL: Vite proxy doesn't forward cookies by default in CORS-prefligh-y conditions,
# but since same-origin (vite serves both pages and /api on the same origin via proxy),
# cookies WORK. Verify with the spec — if the refresh cookie isn't set on a `Set-Cookie`
# coming from localhost:5000 → localhost:5174, add `changeOrigin: false` and `cookieDomainRewrite`
# overrides to the proxy.

# CRITICAL: Orval generates React Query hooks AND Zod schemas. Slice 1 uses the hooks
# (useLogin, useGetSongs, etc) but DOES NOT need the Zod schemas at runtime beyond
# what orval inlines. Don't hand-write any DTO types — regenerate after every BFF change.

# CRITICAL: The .NET 10 OpenAPI doc emits `string($uuid)` for Guid params. Orval handles
# this fine; the generated TS type is `string` (not `Guid` — there's no JS analog).

# === Postgres / docker-compose ===

# CRITICAL: docker-compose mounts ../data into /data; appsettings.json's
# Storage:LocalRoot is "../../../data" (relative to csproj). These resolve to the SAME
# path only when bff runs via compose (LocalRoot inside the container = /data) OR
# locally from components/bff/ (LocalRoot resolves to the repo's data/). The Playwright
# spec runs the BFF locally — make sure data/ exists at the repo root before the spec
# starts.

# CRITICAL: citext for handles — the entity column is `handle text MaxLength(32)` but
# OnModelCreating doesn't currently coerce the column type. Add a fluent
# `entity.Property(u => u.Handle).HasColumnType("citext")` in OnModelCreating so the
# Initial migration emits the right column type. Without citext, "BobR" and "bobr" are
# distinct handles — collision detection in HandleSeeder breaks.

# === Out of scope but worth a forward-link ===

# Vercel AI SDK Data Stream response format (for chat in Phase 3): not in this slice.
# enableRangeProcessing for audio streaming: NOT in this slice — defer to the Listen
# slice. The version POST writes the audio file but no streaming route exists yet.
```

## Implementation Blueprint

### Data models

The EF entities under `components/bff/src/Spectr.Data/Entities/` are already complete for the v2 schema. **Do not edit them in slice 1.** The first migration captures them as-is. If anything is wrong, fix it in C# first, regenerate the migration, and update `components/shared/aimusic_shared/models.py` to match — never edit the SQLAlchemy mirror first.

DTOs are new for slice 1. Keep them as `record class`es in `components/bff/src/Spectr.Bff/DTOs/`:

```csharp
public sealed record RegisterRequest(string Email, string Password);
public sealed record LoginRequest(string Email, string Password);
public sealed record AuthResponse(string AccessToken, AuthedUser User);
public sealed record AuthedUser(Guid Id, string Email, string? Handle, string? DisplayName);

public sealed record SongDto(Guid Id, string Name, DateTimeOffset CreatedAt, DateTimeOffset? ArchivedAt,
    IReadOnlyList<VersionDto> Versions, AnalysisSummaryDto? LatestResult);
public sealed record CreateSongRequest(string Name);
public sealed record PatchSongRequest(string? Name);

public sealed record VersionDto(Guid Id, Guid SongId, int VersionNumber, bool IsCurrent,
    string? FilePath, DateTimeOffset CreatedAt);
public sealed record UploadResponse(Guid SongId, Guid VersionId, Guid JobId);

public sealed record JobStatusDto(Guid Id, string Status, string CurrentPhase, double PhasePct,
    Guid? VersionId, Guid? SongId, string? ErrorMessage);
public sealed record JobResultsDto(Guid JobId, Guid? VersionId, Guid? SongId, string? SongName,
    JsonElement FinalJson, string? ShareToken);

public sealed record AnalysisSummaryDto(Guid Id, DateTimeOffset CreatedAt, string? Grade, double? Score);
```

`AnalysisSummaryDto.Grade`/`Score` are derived in C# from `final_json` for the list endpoint — a defensive `JsonDocument.RootElement.TryGetProperty("mix_score", out _)` walk. Slice 1 returns nulls if the fields aren't present.

### Task list (in execution order)

```yaml
Task 1: Verify entity-side correctness for slice 1.
  READ components/bff/src/Spectr.Data/Entities/User.cs
       components/bff/src/Spectr.Data/Entities/RefreshToken.cs
       components/bff/src/Spectr.Data/Entities/Song.cs
       components/bff/src/Spectr.Data/Entities/SongVersion.cs
       components/bff/src/Spectr.Data/Entities/AnalysisJob.cs
       components/bff/src/Spectr.Data/Entities/Analysis.cs
  MODIFY components/bff/src/Spectr.Data/AppDbContext.cs:
    - Add `builder.Entity<User>().Property(u => u.Handle).HasColumnType("citext");`
    - Add `builder.Entity<User>().Property(u => u.Email).HasColumnType("citext");`
    - Keep everything else as-is.

Task 2: Generate + edit the Initial migration.
  RUN from components/bff:
    dotnet ef migrations add Initial --project src/Spectr.Data --startup-project src/Spectr.Bff
  EDIT the generated *_Initial.cs Up()/Down():
    - In Up(): append migrationBuilder.Sql(@"CREATE UNIQUE INDEX uq_song_versions_one_current_per_song ON song_versions (song_id) WHERE is_current;");
    - In Down(): prepend migrationBuilder.Sql("DROP INDEX IF EXISTS uq_song_versions_one_current_per_song;");
  RUN:
    dotnet ef database update --project src/Spectr.Data --startup-project src/Spectr.Bff

Task 3: Add auth services.
  CREATE components/bff/src/Spectr.Bff/Auth/PasswordHasher.cs:
    - Wraps BCrypt.HashPassword(password, workFactor: 12) and Verify(password, hash).
  CREATE components/bff/src/Spectr.Bff/Auth/JwtTokenService.cs:
    - Builds a JwtSecurityToken with claims: sub=user.Id, email, handle.
    - Expiry from config Jwt:AccessTokenMinutes.
    - Signs with HS256 from Jwt:Key (same string Program.cs reads).
  CREATE components/bff/src/Spectr.Bff/Auth/RefreshTokenService.cs:
    - IssueAsync(userId) → returns raw token (32-byte url-safe random), writes refresh_tokens row with token_hash = SHA-256(raw), expires_at = now + RefreshTokenDays.
    - VerifyAsync(rawCookieValue) → SHA-256 lookup; rejects revoked or expired.
    - RotateAsync(currentTokenId) → revokes old, issues new, returns new raw value.
  CREATE components/bff/src/Spectr.Bff/Auth/HandleSeeder.cs:
    - SeedAsync(email, AppDbContext) → returns unique handle. Sanitize: lowercase, [a-z0-9_], trim 3..32. On collision, append numeric suffix from 1 upward.
  CREATE components/bff/src/Spectr.Bff/Auth/ClaimsPrincipalExtensions.cs:
    - UserId() helper.
  MODIFY components/bff/src/Spectr.Bff/Program.cs:
    - builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 250 * 1024 * 1024);
    - builder.Services.AddSingleton<PasswordHasher>();
    - builder.Services.AddScoped<JwtTokenService>();
    - builder.Services.AddScoped<RefreshTokenService>();
    - builder.Services.AddScoped<HandleSeeder>();

Task 4: Implement AuthEndpoints.cs.
  REPLACE all Results.NotImplemented() calls with full implementations (see pseudocode).
  Routes: POST /auth/register, /auth/login, /auth/refresh, /auth/logout, GET /auth/me.

Task 5: Add DramatiqTasks string constants.
  CREATE components/bff/src/Spectr.Bff/Services/DramatiqTasks.cs:
    public static class DramatiqTasks {
        public const string AnalyzeAudioJob = "analyze_audio_job";
        // Future: precompute_waveform_peaks, run_specialist, etc.
    }

Task 6: Implement SongEndpoints.cs (list/create/get/patch/delete/restore).
  Replace 501 stubs.
  GET /songs: build via projection — db.Songs.Where(s => s.UserId == userId && s.ArchivedAt == null).Include(...).
    Compose VersionDto list from db.SongVersions.Where(v => v.SongId == s.Id).ToList().
    Compose LatestResult from db.Analyses.Where(a => a.SongId == s.Id).OrderByDescending(a => a.CreatedAt).FirstOrDefault().
  POST /songs: Map CreateSongRequest → Song entity; enforce unique (user_id, name) at the DbContext index level (catch DbUpdateException to return 409).
  GET /songs/{id}: enforce user_id, include versions + latest result.
  PATCH /songs/{id}: update Name only.
  DELETE: soft-archive via ArchivedAt = now.
  POST /restore: clear ArchivedAt.

Task 7: Implement VersionEndpoints.cs POST, GET, DELETE.
  POST /versions — multipart:
    [DisableAntiforgery]
    [RequestSizeLimit(250 * 1024 * 1024)]
    Accepts: IFormFile file, string? songId, string? genreHint, string? referencePath (slice 1: ignore reference).
    Allocate jobId = Guid.NewGuid().
    If songId is null: create a Song { name = Path.GetFileNameWithoutExtension(file.FileName) }.
    Else: find by id+userId, 404 if missing.
    Demote prior current SongVersion: update SET is_current=false where song_id=... AND is_current=true.
    Compute version_number = (max existing for song_id) + 1, or 1 if none.
    Save file: key = $"audio/upload/{jobId}/source{ext}"; await fileStorage.WriteAsync(...).
    Insert SongVersion { Id, SongId, VersionNumber, FilePath = key, IsCurrent = true }.
    Insert AnalysisJob { Id = jobId, UserId, VersionId = newVersion.Id, Status = "pending" }.
    await db.SaveChangesAsync();
    await jobQueue.EnqueueAsync(DramatiqTasks.AnalyzeAudioJob, new object[] { jobId.ToString() });
    Return Ok(new UploadResponse(songId, versionId, jobId));

  GET /versions/{id}:
    Look up by id; join Song; enforce song.UserId == userId; return VersionDto.

  DELETE /versions/{id}:
    Look up; enforce; if file exists, fileStorage.DeleteAsync (best-effort, swallow errors); db.Remove; SaveChanges.

  All other routes in VersionEndpoints.cs stay 501 — slice 1 doesn't ship audio streaming, notes, set-current, or analyze-rerun.

Task 8: Implement JobEndpoints.cs GET and GET /results.
  GET /jobs/{id}:
    Look up AnalysisJob; enforce UserId; if VersionId present, join to SongVersion → Song to get SongId.
    Return JobStatusDto.
  GET /jobs/{id}/results:
    Look up Analysis by JobId; enforce Analysis.UserId; pull final_json as JsonDocument; if VersionId present, surface SongId + SongName from the row.
    Return JobResultsDto.

Task 9: Switch worker to dramatiq.
  ADD to components/worker/requirements.txt:
    dramatiq[redis]>=1.16
  CREATE components/worker/app/dramatiq_app.py:
    import dramatiq
    from dramatiq.brokers.redis import RedisBroker
    import os, logging, uuid
    from . import tasks_dramatiq  # noqa: ensure actors are registered

    broker = RedisBroker(url=os.environ["REDIS_URL"])
    dramatiq.set_broker(broker)
  CREATE components/worker/app/db_sync.py:
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    engine = create_engine(os.environ["DATABASE_URL"].replace("+asyncpg", "+psycopg2"))
    SessionFactory = sessionmaker(engine, expire_on_commit=False)
  CREATE components/worker/app/tasks_dramatiq.py:
    @dramatiq.actor(queue_name="default", max_retries=2)
    def analyze_audio_job(job_id: str):
        with SessionFactory() as s:
            job = s.get(AnalysisJob, uuid.UUID(job_id))
            if job is None: raise ValueError(f"job {job_id} not found")
            version = s.get(SongVersion, job.version_id)
            file_path = resolve_storage_path(version.file_path)  # joins LOCAL_ROOT
            job.status = "processing"; job.started_at = now()
            s.commit()
        try:
            result = audio_analysis.run_pipeline(file_path=file_path)
        except Exception as e:
            with SessionFactory() as s:
                s.rollback()
                job = s.get(AnalysisJob, uuid.UUID(job_id))
                job.status = "failed"; job.error_message = str(e); job.failed_at = now()
                s.commit()
            raise
        with SessionFactory() as s:
            job = s.get(AnalysisJob, uuid.UUID(job_id))
            a = Analysis(id=uuid.uuid4(), job_id=job.id, user_id=job.user_id,
                         version_id=job.version_id, song_id=version.song_id,
                         song_name=version.song.name,
                         final_json=json.dumps(result), phase_durations="{}")
            s.add(a)
            job.status = "complete"; job.completed_at = now(); job.phase_pct = 1.0
            s.commit()
  UPDATE Procfile:
    worker: python -m dramatiq app.dramatiq_app
  KEEP celery files in place (do not delete) — out of scope.

Task 10: Emit + commit openapi.json for orval.
  RUN locally:
    cd components/bff && dotnet run --project src/Spectr.Bff &
    curl http://localhost:5000/openapi/v1.json > ../frontend-spectr-v2/openapi.json
    cd ../frontend-spectr-v2 && npm run gen-types
  COMMIT the generated src/api/generated/** directory.

Task 11: Frontend AuthContext.
  CREATE src/auth/AuthContext.tsx:
    Exposes { user, accessToken, isLoading, login(email,password), register(email,password), logout(), refresh() }.
    On mount, calls /auth/refresh; sets isLoading=true until done.
  CREATE src/auth/useAuth.ts (thin hook).
  MODIFY src/main.tsx:
    Wrap RouterProvider in <AuthProvider>.
    Pass `auth: useAuth()` into router context — requires using a tiny RouterBridge component.

Task 12: Wire fetcher to use auth + handle 401.
  MODIFY src/api/fetcher.ts:
    Read accessToken from a module-level mutable (set via setAuthToken function that AuthContext calls on each refresh).
    On 401: enqueue request, call /auth/refresh once via a shared promise, then retry once with new token; if refresh fails, call setAuthToken(null) and rethrow.

Task 13: Auth pages.
  REPLACE src/routes/_public/login.tsx: real form using useLogin (orval-generated) → on success, AuthContext.login captures token + user; router.navigate({ to: '/library' }).
  CREATE src/routes/_public/register.tsx: same shape; calls useRegister.

Task 14: Library route + components.
  MODIFY src/routes/_app.tsx:
    beforeLoad: ({ context }) => {
      // wait for auth load; context.auth.isLoading is true until silentRefresh resolves
      if (!context.auth.user && !context.auth.isLoading) throw redirect({ to: '/_public/login' });
    }
  REPLACE src/routes/_app/library.tsx:
    Use useGetSongs() (orval).
    Render minimal cards: song name, version count, latest grade (or "—").
    "New song" button opens NewSongDialog.
    Each card has "Upload version" button → opens UploadVersionDialog scoped to that song.
    Empty state: button "Upload your first track" (same dialog, no song_id).
  CREATE src/pages/components/NewSongDialog.tsx (Radix Dialog + simple input + useCreateSong).
  CREATE src/pages/components/UploadVersionDialog.tsx (file picker + useFileUpload hook + on success → router.navigate({ to: '/_app/songs/$songId/results/$jobId' })).

Task 15: Song detail route (minimal).
  CREATE src/routes/_app/songs.$songId.tsx:
    useGetSongById(songId);
    Show name + version table (id, version_number, created_at, link to results).
    "Upload new version" button.

Task 16: Results page polling + JSON render.
  REPLACE src/routes/_app/songs.$songId.results.$jobId.tsx:
    useGetJob(jobId) with refetchInterval: data => data?.status === 'complete' || data?.status === 'failed' ? false : 2000.
    While running: show phase progress (current_phase + phase_pct bar).
    When complete: useGetJobResults(jobId), render <pre>{JSON.stringify(data.final_json, null, 2)}</pre>.
    Back-link to /_app/songs/$songId.

Task 17: useFileUpload hook.
  CREATE src/hooks/useFileUpload.ts:
    Wraps XMLHttpRequest. Exposes { upload(file, fields, opts) → Promise<UploadResponse>, progress, isUploading, error }.
    Adds Authorization: Bearer header from useAuth().

Task 18: BFF integration tests.
  CREATE components/bff/tests/Spectr.Bff.Tests/*.cs.
  Use WebApplicationFactory + a Testcontainers Postgres (or, simpler, a separate test connection string pointing at the docker-compose Postgres — slice 1 ships either).
  Cover: register + login round trip, 401 on missing bearer, song create + list + IDOR (user B can't read user A's song), version upload mocks IJobQueue.

Task 19: Playwright happy-path spec.
  CREATE components/frontend-spectr-v2/playwright/slice-1-happy-path.spec.ts:
    1. goto / → redirected to /_public/login.
    2. Click "Register" link → /_public/register.
    3. Fill random email + password → submit.
    4. Land on /_app/library (empty).
    5. Click "Upload your first track", pick fixture .wav from playwright/fixtures/, submit.
    6. Land on /_app/songs/$songId/results/$jobId — see phase progress.
    7. Poll until "complete" appears (timeout 5 min — local pipeline can be slow).
    8. Assert <pre> contains "mix_score" or other known final_json key.

Task 20: Documentation breadcrumbs.
  MODIFY components/bff/README.md:
    Add a note about the manually-edited partial unique index in Initial migration.
    Add the openapi-emit-and-gen-types step.
  MODIFY components/worker/README.md:
    Note: dramatiq is now the entrypoint; celery files remain for reference but are not loaded.
```

### Per-task pseudocode

```csharp
// Task 4 — AuthEndpoints.cs: /auth/register
g.MapPost("/register", async (
    RegisterRequest req, AppDbContext db, PasswordHasher hasher,
    JwtTokenService jwt, RefreshTokenService refresh, HandleSeeder seeder,
    HttpResponse resp, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(req.Email) || req.Password.Length < 8)
        return Results.ValidationProblem(new Dictionary<string, string[]>
            { ["password"] = ["At least 8 characters required."] });

    var existing = await db.Users.AnyAsync(u => u.Email == req.Email, ct);
    if (existing) return Results.Conflict(new { error = "Email already registered." });

    var handle = await seeder.SeedAsync(req.Email, db, ct);
    var user = new User {
        Email = req.Email, HashedPassword = hasher.Hash(req.Password),
        Handle = handle, DisplayName = handle
    };
    db.Users.Add(user);
    await db.SaveChangesAsync(ct);

    var (rawRefresh, _) = await refresh.IssueAsync(user.Id, ct);
    resp.Cookies.Append("spectr_refresh", rawRefresh, refresh.CookieOptions());

    var access = jwt.Issue(user);
    return Results.Ok(new AuthResponse(access,
        new AuthedUser(user.Id, user.Email, user.Handle, user.DisplayName)));
}).AllowAnonymous();

// Task 7 — VersionEndpoints.cs: POST /versions
g.MapPost("/", async (
    [FromForm] IFormFile file,
    [FromForm] string? song_id,
    [FromForm] string? genre_hint,
    ClaimsPrincipal currentUser, AppDbContext db,
    IFileStorage storage, IJobQueue queue,
    CancellationToken ct) =>
{
    var userId = currentUser.UserId();
    if (file.Length == 0) return Results.BadRequest(new { error = "Empty file." });

    Guid songGuid;
    if (song_id is not null)
    {
        if (!Guid.TryParse(song_id, out songGuid)) return Results.BadRequest();
        var owned = await db.Songs.AnyAsync(s => s.Id == songGuid && s.UserId == userId, ct);
        if (!owned) return Results.NotFound();
    }
    else
    {
        songGuid = Guid.NewGuid();
        db.Songs.Add(new Song {
            Id = songGuid, UserId = userId,
            Name = Path.GetFileNameWithoutExtension(file.FileName),
        });
    }

    var jobId = Guid.NewGuid();
    var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
    var key = $"audio/upload/{jobId}/source{ext}";
    await using (var src = file.OpenReadStream())
        await storage.WriteAsync(key, src, file.ContentType ?? "application/octet-stream", ct);

    var nextV = await db.SongVersions
        .Where(v => v.SongId == songGuid)
        .Select(v => v.VersionNumber)
        .DefaultIfEmpty(0).MaxAsync(ct) + 1;

    await db.SongVersions.Where(v => v.SongId == songGuid && v.IsCurrent)
        .ExecuteUpdateAsync(s => s.SetProperty(x => x.IsCurrent, false), ct);

    var versionId = Guid.NewGuid();
    db.SongVersions.Add(new SongVersion {
        Id = versionId, SongId = songGuid, VersionNumber = nextV,
        FilePath = key, IsCurrent = true,
    });
    db.AnalysisJobs.Add(new AnalysisJob {
        Id = jobId, UserId = userId, VersionId = versionId, Status = "pending"
    });
    await db.SaveChangesAsync(ct);

    await queue.EnqueueAsync(DramatiqTasks.AnalyzeAudioJob,
        new object[] { jobId.ToString() }, ct);

    return Results.Ok(new UploadResponse(songGuid, versionId, jobId));
})
.DisableAntiforgery()
.WithMetadata(new RequestSizeLimitAttribute(250L * 1024 * 1024));
```

```python
# Task 9 — components/worker/app/tasks_dramatiq.py: actor body sketch
import json, logging, os, uuid
from datetime import datetime, timezone

import dramatiq
from sqlalchemy.orm import joinedload

from aimusic_shared.models import AnalysisJob, Analysis, SongVersion, Song
from .db_sync import SessionFactory

try:
    from audio_analysis import run_pipeline
except ImportError:
    run_pipeline = None

LOCAL_ROOT = os.environ.get("STORAGE_LOCAL_ROOT", "/data")
logger = logging.getLogger(__name__)


@dramatiq.actor(queue_name="default", max_retries=2, time_limit=3_600_000)
def analyze_audio_job(job_id: str):
    jid = uuid.UUID(job_id)

    # Phase A — mark processing
    with SessionFactory.begin() as s:
        job = s.get(AnalysisJob, jid)
        if job is None:
            raise ValueError(f"job {job_id} not found")
        version = (s.query(SongVersion)
                   .options(joinedload(SongVersion.song))
                   .get(job.version_id))
        if version is None:
            raise ValueError(f"version {job.version_id} not found")
        job.status = "processing"
        job.started_at = datetime.now(timezone.utc)
        file_abs = os.path.join(LOCAL_ROOT, version.file_path)
        song_id = version.song_id
        song_name = version.song.name

    # Phase B — run pipeline (long; outside DB transaction)
    try:
        result = run_pipeline(file_path=file_abs)
        result_json = json.dumps(result, default=str)
    except Exception as exc:
        logger.exception("pipeline failed for job %s", job_id)
        with SessionFactory.begin() as s:
            job = s.get(AnalysisJob, jid)
            job.status = "failed"
            job.error_message = str(exc)[:2000]
            job.failed_at = datetime.now(timezone.utc)
        raise

    # Phase C — write analysis + mark complete
    with SessionFactory.begin() as s:
        job = s.get(AnalysisJob, jid)
        s.add(Analysis(
            id=uuid.uuid4(),
            job_id=jid,
            user_id=job.user_id,
            version_id=job.version_id,
            song_id=song_id,
            song_name=song_name,
            final_json=result_json,
            phase_durations="{}",
        ))
        job.status = "complete"
        job.phase_pct = 1.0
        job.completed_at = datetime.now(timezone.utc)
```

```ts
// Task 11 — AuthContext skeleton
type AuthState = { user: AuthedUser | null; accessToken: string | null; isLoading: boolean };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, accessToken: null, isLoading: true });

  useEffect(() => {
    // silent refresh on mount
    fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => setState({ user: d?.user ?? null, accessToken: d?.access_token ?? null, isLoading: false }))
      .catch(() => setState({ user: null, accessToken: null, isLoading: false }));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await fetch('/api/auth/login', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include' });
    if (!r.ok) throw new Error('Login failed');
    const d = await r.json();
    setState({ user: d.user, accessToken: d.access_token, isLoading: false });
    setAuthTokenForFetcher(d.access_token);
  }, []);

  // register + logout similar
  return <AuthContext.Provider value={{ ...state, login, /* ... */ }}>{children}</AuthContext.Provider>;
}
```

```ts
// Task 14 — _app.tsx beforeLoad
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    if (context.auth.isLoading) return; // RouterBridge re-invalidates once auth resolves
    if (!context.auth.user) {
      throw redirect({ to: '/_public/login', search: { next: location.pathname } });
    }
  },
  component: AppLayout,
});
```

### Integration points

```yaml
CORS:
  - Already configured in Program.cs for http://localhost:5174 with AllowCredentials.
  - In Vite dev: same-origin via proxy, so AllowCredentials still needed but Origin
    header from the proxy reflects localhost:5174 — correct.

COOKIES:
  - spectr_refresh: HttpOnly, Secure, SameSite=Lax, Path=/auth, 30-day expiry.
  - SET on /auth/register, /auth/login, /auth/refresh (rotate).
  - CLEAR on /auth/logout via Response.Cookies.Delete("spectr_refresh", new CookieOptions { Path = "/auth" }).

HEADERS:
  - Frontend XHR uploads MUST set Authorization: Bearer <access>.
  - Multipart Content-Type is set by the browser when FormData is the body — don't override.

DRAMATIQ:
  - Queue name: "default".
  - Actor name: "analyze_audio_job".
  - Message envelope: exactly the shape in DramatiqJobQueue (already correct).
  - Worker startup: python -m dramatiq app.dramatiq_app (from components/worker).

FILE STORAGE:
  - Storage:LocalRoot in appsettings.json: "../../../data" → must resolve to repo-root data/.
  - Key conventions per REQUIREMENTS_ARCHITECTURE.md §Storage: audio/upload/{job_id}/source.{ext}.

CONFIG:
  - Jwt:Key — set via user-secrets locally (`dotnet user-secrets set "Jwt:Key" "..."`).
  - In docker-compose: Jwt__Key from env var; the compose file already enforces it.
  - DATABASE_URL for worker: postgresql+psycopg2://... (NOT +asyncpg — dramatiq actors are sync).
```

## Validation Loop

### Level 1 — Build + lint

```bash
# BFF builds + migrations apply against the docker compose Postgres.
docker compose -f docker/docker-compose.yml up -d postgres redis
cd components/bff
dotnet build
dotnet ef migrations add Initial --project src/Spectr.Data --startup-project src/Spectr.Bff
dotnet ef database update      --project src/Spectr.Data --startup-project src/Spectr.Bff

# Frontend types + lint.
cd ../frontend-spectr-v2
npm install
npm run type-check
npm run lint
npm run build    # smoke

# Python worker package imports cleanly.
cd ../worker
pip install -r requirements.txt
python -c "from app import dramatiq_app, tasks_dramatiq; print('ok')"
```

### Level 2 — Unit + integration tests

```bash
# BFF integration tests.
cd components/bff
dotnet test

# Frontend unit tests (a handful — AuthContext + fetcher 401 retry).
cd ../frontend-spectr-v2
npm test
```

### Level 3 — E2E smoke

```bash
# Bring up infra.
docker compose -f docker/docker-compose.yml up -d postgres redis

# Generate openapi + types (only when BFF endpoints changed).
cd components/bff && dotnet run --project src/Spectr.Bff &
BFF_PID=$!
sleep 5
curl -s http://localhost:5000/openapi/v1.json > ../frontend-spectr-v2/openapi.json
cd ../frontend-spectr-v2 && npm run gen-types
kill $BFF_PID

# Run the full stack.
cd ../bff && dotnet run --project src/Spectr.Bff &
cd ../worker && python -m dramatiq app.dramatiq_app &
cd ../frontend-spectr-v2 && npm run dev &

# Wait for ports.
until curl -fs http://localhost:5000/ >/dev/null; do sleep 1; done
until curl -fs http://localhost:5174/ >/dev/null; do sleep 1; done

# Run Playwright spec.
cd ../frontend-spectr-v2 && npm run test:e2e -- slice-1-happy-path.spec.ts
```

## Final Validation Checklist

- [ ] `dotnet build` clean (no warnings treated as errors? — match Directory.Build.props setting; do not relax it).
- [ ] `dotnet ef database update` produces a `public` schema with all tables from `AppDbContext`.
- [ ] `psql -c "\d song_versions"` shows `uq_song_versions_one_current_per_song` partial index.
- [ ] `psql -c "\d users"` shows `email` and `handle` as `citext`.
- [ ] `dotnet test` green.
- [ ] `npm run type-check && npm run lint && npm run build` clean.
- [ ] `npm test` green.
- [ ] `curl -s localhost:5000/openapi/v1.json | jq '.paths | keys'` lists `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`, `/api/songs`, `/api/songs/{songId}`, `/api/songs/{songId}/restore`, `/api/versions`, `/api/versions/{versionId}`, `/api/jobs/{jobId}`, `/api/jobs/{jobId}/results`.
- [ ] Playwright `slice-1-happy-path.spec.ts` passes.
- [ ] Manual: register → upload a 5 s test sine wave → results page renders `final_json` with at least `phase1` present.
- [ ] Manual: a second user cannot GET another user's song by id (returns 404).
- [ ] Manual: refresh cookie is rotated on each `/auth/refresh` (check `refresh_tokens.revoked_at` populates).

## Anti-Patterns to Avoid

- **Don't** put the JWT access token in `localStorage`/`sessionStorage`. Memory + AuthContext only. The httpOnly refresh cookie is what survives reload.
- **Don't** bypass `/auth/refresh` from the fetcher 401 handler. If silent refresh isn't reentrant-safe, fix the queue, don't skip it.
- **Don't** write entities directly from endpoint bodies via raw SQL or `db.Database.ExecuteSqlAsync`. Use the EF Core DbSet APIs — slice 1 is small enough that thin handlers are fine without a service layer, but anything more than 30 lines moves into `Services/`.
- **Don't** return `200 OK` from `/auth/register` before `db.SaveChangesAsync` succeeds. The order in the pseudocode (Save → IssueRefresh → Set cookie → Return) is load-bearing.
- **Don't** forget `--retries 2` (the actor `max_retries=2` covers this) on the dramatiq actor. Don't set `max_retries=0`; transient Postgres hiccups on a long-running pipeline run shouldn't permanently fail the job.
- **Don't** auto-seed a handle from email without uniqueness checks. Two `bob@gmail.com` / `bob@yahoo.com` users would collide on `bob`. `HandleSeeder` must loop with numeric suffix until unique.
- **Don't** introduce Celery shims. Dramatiq is the queue — even if Python's existing tasks.py is more battle-tested, port the logic. Slice 1 isn't the place to revisit the queue decision.
- **Don't** add columns to entities or the SQLAlchemy mirror. Schema is EF-Core-owned; if slice 1 surfaces a missing column, edit the entity, regenerate the migration, mirror in SQLAlchemy. Don't hand-write SQL ALTER TABLE.
- **Don't** ship a streaming `/api/versions/{id}/audio` route. That's a later slice (Listen) — opening that can of worms here drags in `enableRangeProcessing`, share-token auth, peaks pre-compute, and CORS cookie debugging.
- **Don't** ship SSE for jobs in this slice. Polling is fine; SSE is a Listen-slice concern.
- **Don't** put inline `<style>` strings in commit-touched components beyond what's already in the scaffold. Slice 2 introduces CSS Modules; slice 1 ships ugly-but-functional.
- **Don't** mock the dramatiq → Python integration with HTTP. The whole point of dramatiq was to avoid that hop.
- **Don't** add new top-level folders. `components/bff/src/Spectr.Bff/Auth/` and `.../DTOs/` are sub-folders; `components/bff/Auth/` would not be.

## Self-review

- [ ] Auth: register, login, refresh, logout, me — all five routes implemented and tested.
- [ ] Songs CRUD: all six routes implemented and tested.
- [ ] Versions: POST + GET + DELETE only; other routes intentionally remain 501 (call out in `VersionEndpoints.cs` comment).
- [ ] Jobs: GET + GET /results only; stream + list remain 501.
- [ ] Worker: dramatiq actor `analyze_audio_job` consumes BFF-enqueued messages and writes `analyses` rows.
- [ ] Frontend: register, login, library, song-detail, results pages all functional with TanStack Query.
- [ ] CORS / cookie / proxy round-trip verified — refresh cookie survives reload.
- [ ] Migration includes the partial unique index (manual `Sql()` addition).
- [ ] OpenAPI doc is committed alongside generated orval output.
- [ ] Playwright happy path runs locally inside 5 min on a typical dev box.
- [ ] No new top-level folders; no Python dependencies beyond `dramatiq[redis]`; no CSS Modules / component library yet.
- [ ] CLAUDE.md project-structure rules respected; everything under `components/<name>/` and `output/<component>/` (no new outputs in slice 1).
