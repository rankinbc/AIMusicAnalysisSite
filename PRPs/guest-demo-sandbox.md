# Guest demo sandbox — design spec

_Status: binding design authority for `PRPs/guest-demo-sandbox-plan.md`._
_Written 2026-09-20 against `solo` @ `915732d`. Every claim about existing code
below was re-verified in the working tree (paths are relative to the repo root;
`BFF` = `components/bff/src/Spectr.Bff`, `FE` = `components/frontend-spectr-v2/src`,
`WK` = `components/worker/app`). Where the design agent's report disagrees with
the code, the code wins and the difference is listed in §12._

---

## 1. The ask

spectrmix.com is about to go public. A likely first visitor is a software
hiring manager: no audio file, no audio vocabulary, about 90 seconds. Today
everything impressive (the Listen page, live fixes, the streaming coach) sits
behind an upload, a multi-minute wait and a registration.

**One click — "Explore the demo", or the deep link `/demo` — puts the visitor
inside the REAL app, on an already-analyzed song, fully interactive, with a live
AI coach.** No account, no file.

Owner decisions (2026-09-20), all binding:

| # | Decision |
|---|---|
| O1 | **Per-visitor sandbox.** Each visitor gets an isolated copy, purged later. No shared account. |
| O2 | **Fully live coach**, under safety nets that can never hurt real users. |
| O3 | **Track decided later.** Seeding must be track-agnostic; no real audio enters git (the repo is PUBLIC, rights undecided). |
| O4 | **Guests may upload ONE track** (mix only) and analyze it. |
| O5 | The route file `demo.tsx` may be added to the FRONTEND guard allowlist — that single line, nothing else in either guard suite. |

Also wanted: "No track handy? Use ours" on the anonymous `/analyze` funnel.

---

## 2. What exists today (verified)

- **A per-user demo already exists.** `BFF/Services/DemoSeeder.cs:31-101` seeds
  Song + SongVersion (`FilePath = "audio/demo/source.wav"`, `:24,:59`) +
  completed AnalysisJob + Analysis on every registration
  (`BFF/Endpoints/AuthEndpoints.cs:286`). The audio is a generated 5 s 440 Hz
  sine (`DemoSeeder.cs:128-153`); the report is a bundled
  `DemoAssets/demo-final-json.json` (`:159-180`). The solo-fork spec explicitly
  keeps "the demo-song seeder" and states "the anon funnel and per-user demo
  song reveal nothing" (`PRPs/solo-fork-strip-social.md:30,57`).
- **The seed writes no `RoutingPlan`** (`DemoSeeder.cs:72-83`), and a plain
  `GET /api/reports/{jobId}/verdicts` lazily enqueues paid LLM triage when
  `RoutingPlan is null && DegradationNotice is null`
  (`BFF/Endpoints/VerdictEndpoints.cs:54-87`). Every registered user's demo
  report therefore already costs an LLM call when opened.
- **Auth.** `/api/auth/*` routes (`AuthEndpoints.cs:16-32`). JWT claims are
  `sub,email,jti,tver`; the `tver` check caches `(Version, Banned)` per user for
  60 s and **fails open** on a DB error (`BFF/Program.cs:158-204`). Refresh
  tokens live `Jwt:RefreshTokenDays` (30) days, cookie `spectr_refresh`,
  `Path=/api/auth` (`BFF/Auth/RefreshTokenService.cs:11-13,106-113`).
  `dev-login` is Development + loopback only (`AuthEndpoints.cs:368-374`) — not
  reusable. `AuthedUser(Id, Email, DisplayName, Tier)`
  (`BFF/DTOs/AuthDtos.cs:11-15`) is built at six sites
  (`AuthEndpoints.cs:306,351,403,448,495,777`).
- **No guard seam.** One endpoint filter exists (`AdminEndpoints.cs:44`),
  `AddAuthorization()` has no policies (`Program.cs:207`), every API route hangs
  off `app.MapGroup("/api")` (`Program.cs:535-557`).
- **Uploads.** Proxy `POST /api/versions` (`VersionEndpoints.cs:22,287-351`),
  presigned `POST /api/uploads/{init,complete,abort}` (`UploadEndpoints.cs:29-31`),
  then `POST /api/versions/{id}/analyze` (`VersionEndpoints.cs:29,107-127`).
  All dispatch funnels through `DispatchAnalysisAsync`
  (`VersionEndpoints.cs:1111-1385`), which has `HttpContext` in hand.
- **With credits off everyone is tier `"pro"`** (`BFF/Services/EntitlementService.cs:107-121`),
  so (a) the cross-account abuse arms are skipped (`VersionEndpoints.cs:1161`),
  (b) analyses route to `analysis-paid` (`:1351-1356`), and (c) the coach COUNT
  cap is unlimited (`BFF/Services/CoachCapService.cs:46-54`).
- **LLM spend.** `effective_tier = tier or settings.llm_default_tier` is computed
  in exactly two places — `WK/llm/gateway.py:289` and `WK/llm/streaming.py:150`.
  `coach_reply`, `run_specialist` and `run_triage` pass no tier
  (`WK/coach_actor.py:546-557`, `WK/verdict_actor.py:229-239`,
  `WK/triage_actor.py:132`), so they are metered as `"free"`
  (`WK/llm/settings.py:48`). `check_budget` applies a per-tier ceiling then a
  global ceiling summed across ALL tiers (`WK/llm/budget.py:213-239`).
- **Shared-audio protection is one exact key**:
  `SHARED_STORAGE_KEYS = frozenset({"audio/demo/source.wav"})`
  (`WK/retention_actor.py:94`), consulted at `:121` and
  `WK/account_deletion_actor.py:44,80`. Analysis image keys are collected for
  deletion too (`account_deletion_actor.py:62-70`).
- **Account teardown** is inline in the delete endpoint
  (`BFF/Endpoints/AccountEndpoints.cs:302-346`): audit row + token/device scrub +
  user delete in one transaction, `tver:` cache eviction, then enqueue
  `delete_account_data`. The nightly sweep is
  `BFF/Services/RetentionSweepScheduler.cs:78-101` (test seam `RunOnceAsync`).
- **Anon funnel.** `POST /api/anon/analyses` takes `[FromForm] IFormFile file`,
  mints the `spectr_device` cookie, 409s a second active analysis, rate limits
  fail-OPEN, key `audio/anon/{device}/{job}/source{ext}`
  (`BFF/Endpoints/AnonAnalysisEndpoints.cs:43-135`). The 72 h purge deletes anon
  keys (`WK/retention_actor.py`, `RETENTION_ANON_HOURS`).
- **Frontend.** `AuthContext` has a module-level `sessionEpoch` bumped only by
  logout (`FE/auth/AuthContext.tsx:50,159`); the boot `refresh()` applies its
  result unless the epoch moved (`:74-87`). The query cache is never cleared on a
  user change. `NO_REFRESH_RETRY` lists the credential endpoints
  (`FE/api/fetcher.ts:176`). Login invalidates the router before navigating
  (`FE/routes/_public/login.tsx:36-39`). Listen is desktop-gated below 1024 px.
- **Guards.** BFF `NoSocialSurfaceTests.cs` allows anonymous routes under
  `/api/auth/`, `/api/anon/` and `/api/admin/`; the frontend guard compares
  `ALLOWED_ROUTE_FILES` by exact equality
  (`FE/routes/__tests__/no-social-surface.test.ts:18-50`) and bans identifiers
  such as `isPublic`, `shareToken`, `queueDepth|jobs? waiting|jobs? queued`.
- **Size limits already broken:** `AuthEndpoints.cs` 781 lines,
  `VersionEndpoints.cs` 1455, `Program.cs` 645, `UnifiedUploadDialog.tsx` 1249,
  `ListenRackPage.tsx` 512. New code goes in new files; edits to these stay
  surgical.

---

## 3. Decisions

### D1 — A guest is a real `User` row

**Decision.** `users` gains `is_guest bool NOT NULL DEFAULT false`,
`guest_expires_at timestamptz NULL`, `guest_device_id varchar(26) NULL`. A guest's
email is `guest-{id:N}@guest.spectr.invalid`; its password hash is ONE
process-wide bcrypt hash of a random secret nobody knows. `EmailVerifiedAt = now`,
`NotifyAnalysisComplete = false`, `DisplayName = "Guest"`.

**Rationale.** Every ownership join, the `?t=` audio stream
(`VersionEndpoints.cs:256-278`), the coach, the rack draft and the Listen page
work unchanged because they key on `users.id`. `.invalid` is reserved
(RFC 2606) — no mail can ever be delivered, no real person can own the address.
A real hash is required because `BCrypt.Verify` throws on a malformed hash; one
shared hash avoids ~250 ms of bcrypt per demo start.

**Cost if wrong.** Three nullable/defaulted columns to drop.

### D2 — `POST /api/auth/demo`, resume-by-device, fail CLOSED

**Decision.** Anonymous endpoint under the already-allowlisted `/api/auth/`
prefix. Order (first failure wins):

1. `Demo:Enabled` config key → else the `demo_enabled` flag → off ⇒
   **503 `demo_unavailable`**.
2. **Resume:** a valid `spectr_device` cookie whose id matches an unexpired
   guest's `guest_device_id` ⇒ return that guest (`Resumed = true`). Resume never
   consumes a limit.
3. **Rate limit** `demo_create`, actor `device:{id}` (or `ip:{ip}` when there is
   no cookie — never one shared "none" bucket), IP normalised with
   `VersionEndpoints.NormalizeIpForLimiting`, `demo_guests_per_ip_hourly` per
   hour. Deny ⇒ 429 `rate_limited`. A limiter EXCEPTION ⇒
   **503 `demo_unavailable`** (fail closed — the opposite of the anon funnel).
   Skipped when `RateLimits:Enabled=false` (dev/test), like every other limiter
   in the codebase. (Prod already honours `X-Forwarded-For` behind Caddy when
   `ForwardedHeaders:Enabled=true`, `Program.cs:447-451`.)
4. **Daily DB backstop:** guests created in the last 24 h ≥
   `demo_guests_daily_cap` ⇒ **503 `demo_capacity`**. Always on (no Redis). The
   config key `Demo:DailyCap` overrides the flag (ops knob; lets a test trip the
   cap without mutating the shared flag row).
5. Mint the device cookie (`DeviceService.GetOrCreateAsync`), create the guest,
   seed the demo (D6), issue tokens that expire at `guest_expires_at`.

**Rationale.** This endpoint mints accounts for free; an outage of its limiter
must stop minting, not open the floodgates. Resume keeps one visitor = one
sandbox across reloads and return visits.

**Copy rule (solo principle).** 503 messages never say "busy", "too many
visitors" or anything that reveals load: _"The demo is taking a break — analyze
your own track instead."_

**Cost if wrong.** A false 503 sends a visitor to `/analyze`, which still works.

### D3 — How the server knows a request is a guest

**Decision.** The cached `tver:` lookup (`Program.cs:166-184`) is widened to an
`AuthSnapshot(Version, Banned, IsGuest, GuestExpiresAt)`. `OnTokenValidated` adds
the in-process claim `spectr_guest=1` when EITHER the snapshot says guest OR the
signed JWT `email` claim ends with `@guest.spectr.invalid` (covers the existing
fail-open path, where no snapshot is available). An expired guest's token is
failed. The JWT itself is unchanged. `ClaimsPrincipalExtensions.IsGuest()` reads
the claim.

**Rationale.** One query, one cache key, no new claim on the wire (the BFF guard
greps JWT payloads). Registration rejects the reserved domain, so the email
suffix can never belong to a real user.

**Cost if wrong.** The suffix check alone is sufficient; the snapshot half can be
deleted without changing behaviour except instant expiry.

### D4 — Default-deny guest guard

**Decision.** One endpoint filter on the `/api` group. For a guest principal:
endpoints carrying `IAllowAnonymous` pass (logout/refresh/anon funnel must keep
working when the fetcher attaches a bearer); `GET/HEAD/OPTIONS` pass unless
marked `.DenyGuest()`; every other method passes ONLY when marked
`.AllowGuest()` / `.AllowGuestUpload()`. Everything else ⇒
**403 `guest_restricted`**. Non-guests skip the filter in one branch.

Allowed (`.AllowGuest()`): coach messages; specialist run; verdict
dismiss/applied/feedback; fix-rack generate; rack presets + draft + viz presets;
version notes CRUD; rating set/clear; `PATCH /versions/{id}`; `set-current`;
`PATCH /songs/{id}`; song tags add/remove; compare notes; `POST /uploads/abort`;
`POST /versions/{id}/analyze`.
Allowed with quota (`.AllowGuestUpload()`): `POST /versions/`, `POST /uploads/init`,
`POST /uploads/complete`.
Denied GET (`.DenyGuest()`): `GET /me/export`.
Denied by default (no marker): stems/.als/reference uploads and
`/uploads/attachments/init`, song/version delete + `/permanent` + restore,
billing, `POST /me/delete`, `PATCH /auth/me`, `PATCH /me/profile`,
resend-verification, phase rerun, job retry, song create.

**Rationale.** Default-deny means an endpoint added next month is closed to
guests without anyone remembering this spec. Deletes stay denied so the upload
quota (D5) cannot be reset by delete-and-reupload.

**Cost if wrong.** A missing `.AllowGuest()` shows the upgrade dialog on a
harmless action — one line to fix.

### D5 — One upload, one analysis, and a global arm

**Decision.** `GuestLimits` (scoped service):

- **Upload quota** — checked by the filter for `.AllowGuestUpload()` routes:
  versions owned by the guest whose `FilePath` does not start with `audio/demo/`
  ≥ `guest_uploads_max` (1) ⇒ 403 `guest_restricted`, `details.reason =
  "upload_limit"`.
- **Analysis quota + global arm** — checked at the top of
  `DispatchAnalysisAsync` when `httpCtx.User.IsGuest()`: the guest's `analysis`
  usage events ≥ `guest_uploads_max` ⇒ 403 `guest_restricted`
  (`reason = "analysis_limit"`); then the global limiter arm
  `guest_analysis` (`guest_analyses_per_hour`, 10/h, one bucket for all guests),
  deny OR limiter exception ⇒ **503 `demo_capacity`** (fail closed; skipped when
  `RateLimits:Enabled=false`).
- Guest analyses always route to `analysis-free`, whatever `ent.Tier` says.
- `GET /api/me/guest` → `GuestStateDto` so the UI can switch "+ Upload" to
  "Create free account" (404 for non-guests).

**Rationale.** The seeded job writes no usage event, and the usage-event table is
append-only, so the analysis count cannot be gamed. With credits off a guest is
tier `"pro"` and would otherwise bypass every existing abuse arm. A bot farm is
bounded at 10 CPU-heavy jobs/hour on the single VM.

**Cost if wrong.** All numbers are live feature flags.

### D6 — Track-agnostic snapshot seeding

**Decision.** `DemoSnapshotStore` loads a snapshot from storage key
`Demo:SnapshotKey` (default `audio/demo/snapshot/snapshot.json`; empty string
disables) and caches the parsed template 60 s. `DemoSeeder.SeedAsync` seeds from
the snapshot when present, else falls back to today's sine-tone seed — which now
stamps an empty routing plan `{"specialists":[]}`, closing the existing
paid-triage-on-GET leak for every user. The snapshot is produced by
`POST /api/admin/demo/snapshot` (`X-Admin-Key`), which exports ONE analyzed
version in place: analyze the chosen track in prod, run one curl.
`SeedAsync` now returns `DemoSeedResult?`; registrations get the better demo too.

**Rationale.** No real audio or report ever enters the public repo; the owner
picks the track at deploy time; tests use a synthetic fixture.

**Cost if wrong.** Delete the snapshot object → instant fallback.

### D7 — Fully live coach, with its own cap and its own money

**Decision.** `CoachCapService.ResolveAsync` checks `users.is_guest` FIRST (ahead
of the credits-off short-circuit): guests get `Limit = coach_guest_messages`
(20), `Used` = the guest's `coach_message` usage events (the seeded conversation
has none), scope `"analysis"` so the existing chip/gate render unchanged. In the
worker, `llm/lane.py::resolve_lane(user_id, default)` returns `"guest"` for guest
users and is applied at the two `effective_tier` sites. `check_budget` gives the
guest lane its own ceiling (`llm_budget_guest_usd`, default 5) and **excludes
guest spend from the global sum real users are checked against**; guests are not
checked against the global cap.

**Rationale.** Additive lane: worst-case monthly spend = global cap + guest cap,
and guest traffic can never take the coach offline for a paying or registered
user. Two insertion points cover coach, specialists, triage and fix-rack.

**Cost if wrong.** Two flags; the lane resolver fails open to the old behaviour.

### D8 — Purge

**Decision.** `Services/AccountTeardown.cs` is extracted verbatim from
`AccountEndpoints.cs:302-335`. `RetentionSweepScheduler.RunOnceAsync` gains a
guest pass: every guest with `guest_expires_at < now` is torn down (audit action
`guest_purge`) and `delete_account_data` is enqueued. The worker's
`is_shared_key()` treats everything under `audio/demo/` as shared.

**Rationale.** Without the prefix rule the FIRST guest purge deletes the snapshot
audio and images for every account. Rows may outlive their TTL by up to a day
(nightly sweep); access does not — refresh tokens and the token check both honour
`guest_expires_at`.

### D9 — Frontend flow

**Decision.** `AuthContext.startDemo()` posts `/auth/demo`, bumps `sessionEpoch`
(so an in-flight boot refresh can never overwrite or wipe the new session) and
applies the auth. `AuthProvider` clears the TanStack query cache whenever the
user id changes from one non-null value to anything else. `/demo`
(`routes/demo.tsx`) renders `DemoLauncher`: wait for `!isLoading` → real user ⇒
`/library`; otherwise `startDemo()` → `router.invalidate()` → viewport ≥ 1024 px
⇒ `/listen-rack/$versionId`, narrower ⇒ `/songs/$songId/results/$jobId`.
Failure ⇒ a calm fallback card linking `/analyze` and `/`. `AuthedUser.isGuest`
lives in AuthContext state (never a `staleTime: Infinity` query). The landing CTA
itself belongs to the public-surfaces workstream (P3); this workstream only
ships `/demo`.

### D10 — Guest shell

**Decision.** A slim `GuestBanner` under the top nav ("You're exploring a demo
sandbox · Create a free account to keep your work"). When the upload is used,
"+ Upload" becomes "Create free account". `UnifiedUploadDialog` for a guest:
mix drop only (Ableton/reference/stems blocks hidden); when no upload is left it
renders `GuestUpgradeDialog` instead. Any `guest_restricted` mutation error
opens the same dialog via a tiny event bus (the mutation cache is built outside
React). v1 "create account" is a plain `/register?from=demo` link; the new
account gets the same snapshot demo. In-place conversion is deferred (§11).

### D11 — "Use ours" on `/analyze`

**Decision.** `POST /api/anon/analyses` accepts `sample=true` with no file; the
server COPIES the snapshot audio to the normal anon key (never points at the
shared key — the 72 h purge deletes anon keys). 409 and existing limits stay; a
global arm `anon_sample_per_hour_global` is added. `GET /api/anon/sample` →
`{available, title}`; the button is hidden when no snapshot is installed. The
client writes the current-job cache exactly as a real upload does.

---

## 4. Data model + flags

Migration `AddGuestUsers`: the three columns of D1 plus
`CREATE INDEX ix_users_guest_expires ON users (guest_expires_at) WHERE is_guest;`
and `CREATE INDEX ix_users_guest_device ON users (guest_device_id) WHERE is_guest;`
(raw SQL appended after scaffolding — EF cannot express partial indexes).
Mirror the columns in `components/shared/aimusic_shared/models.py` (`User`, `:52`).

Migration `SeedDemoFlags` (idempotent `INSERT … ON CONFLICT (name) DO NOTHING`):

| Flag | Seed | Meaning |
|---|---|---|
| `demo_enabled` | `false` | Kill switch. Prod stays off until a snapshot is installed. `Demo:Enabled` config wins (dev sets `true`). |
| `guest_ttl_hours` | `72` | Matches the anon purge. |
| `demo_guests_per_ip_hourly` | `5` | D2 step 3. |
| `demo_guests_daily_cap` | `300` | D2 step 4. |
| `guest_uploads_max` | `1` | D5. |
| `guest_analyses_per_hour` | `10` | D5 global arm. |
| `coach_guest_messages` | `20` | D7. |
| `llm_budget_guest_usd` | `5` | D7 (worker reads it via `feature_flags.get_flag_decimal`). |
| `anon_sample_per_hour_global` | `20` | D11. |

---

## 5. API contracts

```
POST /api/auth/demo            (anonymous)     → 200 DemoStartResponse
  429 rate_limited (this requester started too many) | 503 demo_unavailable | 503 demo_capacity
GET  /api/me/guest             (guest only)    → 200 GuestStateDto | 404
POST /api/admin/demo/snapshot  (X-Admin-Key)   → 200 DemoSnapshotExportResponse
  400 invalid_request | 404 version_not_found | 409 snapshot_not_ready | 409 snapshot_leak
GET  /api/anon/sample          (anonymous)     → 200 AnonSampleDto
POST /api/anon/analyses        + form field `sample=true` (file optional)
```

```csharp
public sealed record AuthedUser(Guid Id, string Email, string? DisplayName, string Tier, bool IsGuest = false);
public sealed record DemoTarget(Guid SongId, Guid VersionId, Guid JobId);
public sealed record DemoStartResponse(string AccessToken, AuthedUser User, DemoTarget Demo, bool Resumed);
public sealed record GuestStateDto(DateTimeOffset ExpiresAt, int UploadsUsed, int UploadsMax, int AnalysesUsed, int AnalysesMax);
public sealed record DemoSnapshotExportRequest(Guid VersionId, string? Reason);
public sealed record DemoSnapshotExportResponse(string SnapshotKey, int Verdicts, int Messages, int RackPresets, long AudioBytes);
public sealed record AnonSampleDto(bool Available, string? Title);
```

Error envelope (`BFF/Endpoints/ErrorEnvelope.cs:14-20`):
`guest_restricted` (403, `details: { reason: "not_allowed" | "upload_limit" | "analysis_limit" }`),
`demo_unavailable` (503), `demo_capacity` (503).

---

## 6. Snapshot format `spectr-demo-snapshot/v1`

Stored under `audio/demo/snapshot/`: `snapshot.json`, `source.<ext>`, and (when
present) `spectrogram.webp`, `waveform.webp`, `peaks.json`.

```jsonc
{
  "format": "spectr-demo-snapshot/v1",
  "exportedAt": "2026-09-20T00:00:00Z",
  "source": { "songId": "…", "versionId": "…", "jobId": "…", "analysisId": "…" },
  "song": { "title": "Night Drive", "genreHint": "house" },
  "version": { "audioKey": "audio/demo/snapshot/source.flac" },
  "analysis": { "finalJson": {…}, "routingPlan": {…}, "pipelineVersion": "…",
                "ruleEngineVersion": "…", "validatorVersion": "…", "promptSetVersion": "…",
                "phaseDurations": {…}, "stemMetrics": null,
                "spectrogramImageKey": "…", "waveformImageKey": "…", "waveformPeaksKey": "…" },
  "verdicts": [ { "id": "vrd_…", /* every Verdict column; evidence/fix/sources/where as JSON values */ } ],
  "conversation": { "messages": [ { "role", "status", "mode", "content", "evidence", "refusalReason" } ] },
  "rackPresets": [ { "name", "source", "chain", "coachMeta" } ]
}
```

**Id remapping.** At load the store replaces, in the raw JSON text, the four
source Guids (both `D` and `N` formats) and every verdict id with tokens
(`§song§`, `§version§`, `§job§`, `§analysis§`, `§v0§…`). At seed time one
pass substitutes fresh values (`Guid.NewGuid()`, `"vrd_" + UlidGen.NewUlid()`)
and the result is deserialized — so ids embedded in `finalJson`, `routingPlan`,
coach evidence or `coachMeta` stay consistent. `llmCallId`, user ids, device
ids, emails and absolute paths are never exported; the exporter aborts
(`snapshot_leak`) if the owner's id or email appears anywhere in its output.
All rows go in one `SaveChanges`; no file is copied per guest. The seeded song is
named `"Demo: " + title`; idempotency keys on the `"Demo: "` prefix.

The exporter refuses a version whose analysis has `RoutingPlan == null` or a
`DegradationNotice` (`snapshot_not_ready`) — a snapshot that would fire triage
on open defeats the point.

### 6.1 Seed-time safety (added 2026-09-21 after the D3 review — binding)

The SEEDER is the last line of defence; it does not trust the snapshot:

- **Never seed a null routing plan.** A missing/null/non-object
  `analysis.routingPlan` is replaced with the empty plan
  (`DemoSeedMapping.EmptyRoutingPlanJson`), because `VerdictEndpoints` fires paid
  `run_triage` on `RoutingPlan is null`.
- **`specialists_to_run` is rewritten at seed time** to keep only entries whose
  `name` already has a seeded verdict (`DemoSeedMapping.RewriteRoutingPlanForSeed`).
  This DEVIATES from "export verbatim" on purpose: `CoachTab.tsx` auto-POSTs
  `/verdicts/run/{slug}` on first view for every routed specialist without a
  verdict — N paid LLM calls per guest, on page load. `skip`, `rationale` and
  `estimated_total_tokens` stay as exported. Cost: the demo roster omits
  specialists that never ran; a guest can still start one by hand under the D7 cap.
- **Asset keys are never id-remapped.** The four keys (`version.audioKey` + the
  three image keys) are captured BEFORE token substitution, validated against
  `DemoSnapshotStore.SharedPrefix` (`audio/demo/`, mirrors the worker's
  `SHARED_STORAGE_PREFIXES`) and stamped back verbatim. The exporter must still
  write **id-free asset keys** under `audio/demo/snapshot/`.
- **`Demo:SnapshotKey` and every asset key must live under `audio/demo/`** (no
  leading slash, no backslash, no `..`) — anything else = "no snapshot" →
  fallback seed. Outside that prefix the first guest purge would delete the demo
  for everyone.
- The snapshot read runs inside the sign-up / demo request: 5 s timeout, 4 MB cap,
  positive AND negative results cached 60 s. Any failure → fallback seed; nothing
  escapes `SeedAsync`.
- `FindAsync` returns the user's FIRST `"Demo: "` song (`CreatedAt ASC`), so a
  later user song renamed "Demo: …" cannot become the guest landing.

---

## 7. Security & abuse

- **Solo principle** (`PRPs/solo-fork-strip-social.md:10-16`): "Nothing in the
  product may show, imply, or let a visitor infer that other users exist." Every
  guest owns private COPIES; nothing a guest does is visible to anyone else;
  there is no shared account, no public report, no share link (D2 of that spec
  stays intact). UI copy avoids "public", "shared", "people", "community", and
  never describes load.
- **A guest can never:** log in with a password, reset a password (forgot-password
  silently no-ops for guests), change email/profile, reach billing, export or
  delete the account, upload stems/.als/reference, delete songs or versions,
  rerun phases, retry jobs, exceed one upload / one analysis / 20 coach
  messages, or spend money from the budget real users depend on.
- **Registration rejects** any email in `guest.spectr.invalid` (400 `invalid_email`).
- **Token lifetime:** guest refresh tokens and cookies expire at
  `guest_expires_at`; rotation is capped to the same instant; refresh and the
  token check both reject expired guests.
- **Isolation:** unchanged ownership joins ⇒ cross-guest reads 404.
- **Exporter:** admin key only; writes an audit row; leak check; git-ignored output.

---

## 8. Frontend flow details

- **Boot-refresh race.** `/demo` cold-loads while the boot `refresh()` is in
  flight. `DemoLauncher` waits for `!isLoading`, and `startDemo()` also bumps
  `sessionEpoch` before applying, so a late refresh result is discarded
  (`AuthContext.tsx:80`) instead of wiping the fresh guest session.
- **`/auth/demo` joins `NO_REFRESH_RETRY`** — a 401 there must not trigger a
  silent refresh loop.
- **staleTime rule** (bug class fixed twice, `bdc9596`/`915732d`): a never-stale
  query whose value the client changes must be written by the mutation.
  `isGuest` is AuthContext state; `['me','guest']` uses the default staleTime and
  is invalidated after an upload; the sample path writes `CURRENT_JOB_KEY`.
- **Analytics** (`FE/lib/analytics.ts:28-42`): `demo_cta_clicked`,
  `demo_started {resumed, surface}`, `demo_start_failed {code}`,
  `demo_signup_clicked {source}`, `demo_guest_restricted {reason}`,
  `analyze_sample_started`.

---

## 9. Test strategy

BFF integration (real Postgres, `RecordingJobQueue`): create / same-device
resume / expired re-mint; limiter exception ⇒ 503; daily cap; guest cannot log
in; cross-guest 404 on jobs, audio, verdicts; guard theory (403 envelope on every
denied route, 2xx on allowed); second upload refused; analysis quota + global
arm; coach cap trips under both `Credits:Enabled` values; seeded analysis
enqueues NO `run_triage` (snapshot AND fallback); purge removes expired guests,
keeps live ones. Worker: `is_shared_key`, deletion key collection, lane resolver,
budget lane. Frontend: destination helper, launcher states incl. the boot race,
banner, upgrade dialog, sample button. Playwright `smoke-demo.spec.ts`
(`LLM_FAKE=1`). Tests use a SYNTHETIC snapshot fixture written to a throwaway
storage key; `Demo__SnapshotKey=""` is pinned process-wide so an installed dev
snapshot cannot change existing tests.

---

## 10. Deploy step

After the first prod deploy: upload + analyze the chosen track with the owner's
account, open its report once (so triage + verdicts exist), then
`curl -X POST https://spectrmix.com/api/admin/demo/snapshot -H "X-Admin-Key: …" -d '{"versionId":"…","reason":"launch demo"}'`,
verify `/demo` in a private window, then
`UPDATE feature_flags SET value='true' WHERE name='demo_enabled';` (≤60 s).
Added to `docs/azure-deploy-remaining-work.md` Task 8 ("Upload demo track").

---

## 11. Open follow-ups (not in this plan)

- In-place guest → account conversion (keep the sandbox on register).
- A failed guest analysis cannot be retried (job retry is denied) — revisit if it
  happens in practice.
- Real users' demo versions get `raw_audio_purged_at` stamped after 30 days with
  zero keys deleted (`WK/retention_actor.py`, lapsed-audio pass) — skip stamping
  when every key on the version is shared.
- Upload/analysis quota checks are read-then-insert (two parallel requests can
  both pass); acceptable for an abuse dampener.

---

## 12. Differences from the design agent's report

| Report | Spec | Why |
|---|---|---|
| Tier passed at four actor call sites | `resolve_lane` applied at the two `effective_tier` sites | Two one-line edits cover every purpose, incl. future ones. |
| `_aggregate_tier_spend(..., exclude_tier=)` | global sum minus a second `_aggregate_tier_spend("guest")` call | ~10 existing tests stub that function with a fixed signature. |
| `CoachCapService.ResolveAsync(..., bool isGuest)` | service reads `users.is_guest` itself | Three call sites stay untouched. |
| Guests may not upload | one upload + one analysis, global arm (owner O4) | Owner decision. |
| TTL 24 h, 8 messages, $2 | 72 h, 20 messages, $5 | Owner decision. |
| `demo_enabled` seeded `true` | seeded `false`, `Demo:Enabled` config override | Prod must not serve a sine-tone demo by accident. |
| Guard claim from the `tver` tuple with suffix fallback | both, suffix evaluated unconditionally | The lookup fails open today. |
| Landing CTA in the flow task | owned by the public-surfaces workstream | Avoids two tasks editing `LandingPage.tsx`. |
