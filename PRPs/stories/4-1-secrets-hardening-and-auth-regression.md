# Story 4.1: Secrets Hardening & Auth Regression

Status: review

## Story

As the operator,
I want all secrets sourced from the environment with no fallback defaults,
So that the known hardcoded-JWT launch blocker is closed.

## Acceptance Criteria

1. **Given** production mode, **When** the BFF boots without `JWT_SECRET` set, **Then** it refuses to start — the hardcoded default is removed (NFR6).
2. **Given** `.env.example`, **When** reviewed, **Then** every required secret and config knob from AR40 is documented with placeholder values only.
3. **Given** existing auth (FR25), **When** register/login/refresh-token flows run after the change, **Then** all pass regression.
4. **Given** the repo and built images, **When** scanned in CI, **Then** no real secrets are present.

## Decisions of record (recon 2026-07-03)

1. **The "hardcoded default" is `appsettings.json` `Jwt:Key = "REPLACE_ME_IN_USER_SECRETS_OR_ENV"`** — it makes the existing `?? throw` guards unreachable in every environment. Same class: `Anon:SigningKey = "dev-anon-signing-key-change-in-prod"`. Fix: REMOVE both from `appsettings.json`; carry clearly-labeled dev-only values in `appsettings.Development.json` (which WebApplicationFactory and local dev use); any non-Development boot without env-supplied values fails fast with an actionable message naming `Jwt__Key` / `Anon__SigningKey`.
2. **Repo trap (why Stripe used `SPECTR_REQUIRE_STRIPE` instead of `IsProduction()`)**: bare `dotnet run` defaults `ASPNETCORE_ENVIRONMENT` to Production — there is NO `launchSettings.json` and `start-spectr.ps1` sets no env. Rather than another bespoke flag, fix the root cause: add `Properties/launchSettings.json` (Development) and set `ASPNETCORE_ENVIRONMENT=Development` in `start-spectr.ps1`'s BFF launch. Compose dev already sets Development. Side benefit: `/api/auth/dev-login` (gated on `IsDevelopment()`) actually works under the launcher now.
3. **Key-length validation in ALL environments**: `HmacSha256` needs ≥32 bytes; today a short env key explodes at first sign, not at boot. Boot validation: non-blank AND ≥32 UTF-8 bytes, both `Jwt:Key` and `Anon:SigningKey`.
4. **AC2 = root `.env.example`** — single canonical inventory (AR40 is a documentation pattern, not a fixed list): compose-level (`JWT_KEY`, `ANTHROPIC_API_KEY`, `LLM_FAKE`), BFF `__`-style keys (Jwt, Anon, ConnectionStrings, Redis, Storage:S3, Stripe + `SPECTR_REQUIRE_STRIPE`, Worker, CoachCaps, Retention, App), worker flat vars (`DATABASE_URL`, `REDIS_URL`, `S3_*`, `RETENTION_*`, `LLM_*`, `COACH_*`, `TORCH_HOME`). Placeholders only. Also patch `components/worker/.env.example` gaps (`S3_*`, `RETENTION_*`, `DATABASE_URL`, `REDIS_URL`).
5. **AC3**: existing auth tests keep passing (they run Development env → Development.json keys) PLUS the missing coverage recon found: a `/refresh` rotation test (old refresh cookie invalidated, new one works) and `/logout` revocation test.
6. **AC4 = gitleaks in CI** (free CLI, not the license-gated action): new `secrets` job running `gitleaks detect` over the working tree + git history with a `.gitleaks.toml` allowlisting the known test fakes (`sk_test_fake`, `whsec_unit`, dev compose creds). **Built-image scanning deferred to 10.1** — CI builds no images today (compose builds are local); recorded as an honest scope note, the image-scan step lands with the registry/build pipeline.
7. Legacy v1 `api/app/config.py` `JWT_SECRET="change-me-in-production"` is frozen code excluded from CI/deploy (AR3) — out of scope, noted for the v1 retirement story.

## Tasks / Subtasks

- [x] Task 1 — remove hardcoded defaults + fail-fast (AC: 1, 3) — appsettings.json carries NO keys (comment lines document the policy); Development.json holds labeled dev-only values; `RequireSigningKey` local function in Program.cs validates non-blank + ≥32 UTF-8 bytes for `Jwt:Key` AND `Anon:SigningKey` with env-var-form messages; `Properties/launchSettings.json` (new, Development) + start-spectr sets `ASPNETCORE_ENVIRONMENT=Development` explicitly; 3 boot tests (Production-no-key refuses naming Jwt:Key; short key refuses naming 32 bytes; valid Jwt + missing Anon refuses naming Anon:SigningKey)
- [x] Task 2 — .env.example (AC: 2) — root `.env.example` (compose + BFF `__`-form + worker flat, placeholders only, openssl generation hint); worker `.env.example` gained S3_*/RETENTION_*/notes
- [x] Task 3 — auth regression depth (AC: 3) — `Refresh_Rotates_And_Old_Cookie_Is_Rejected` (rotation + replay-rejection + rotated-cookie-works) and `Logout_Revokes_The_Refresh_Token` (204 + revoked cookie 401s); existing register/login suite green under new key policy
- [x] Task 4 — CI secret scan (AC: 4) — `secrets` job (gitleaks 8.24.3 CLI, full history fetch-depth 0) + `.gitleaks.toml` (default rules + allowlist of known test fakes/dev creds/PRPs prose); ran locally: 493 commits, **no leaks** (2 false positives triaged: SpinePrimitives test constant, story-doc prose — both allowlisted)
- [x] Task 5 — Gates: BFF 284/284 (5 new; one known parallel flake re-ran green); gitleaks clean; frontend/worker untouched (env-example only)

## Dev Notes

- JWT reads: `Program.cs:25-26` (`?? throw`, validation side) + `Auth/JwtTokenService.cs:11-16` (issuer side). Refresh tokens are NOT JWTs (random 32 bytes, SHA-256 at rest) — unaffected by key policy.
- `AnonOptions` already has non-blank `.ValidateOnStart()`; extend to length or centralize both checks in Program.cs.
- Compose already refuses without `JWT_KEY` (`${JWT_KEY:?...}`) — that guards compose only, not bare `dotnet run`.
- Auth test surface today: `AuthEndpointsTests` (register/login roundtrip, me-401, songs-401); `TestAuth.RegisterAsync` used across ~all endpoint suites (broad implicit regression). Refresh cookie: httpOnly, path-scoped; `WebApplicationFactory` client needs `HttpClientHandler`-style cookie capture — read Set-Cookie manually (`AllowAutoRedirect` irrelevant; cookies not auto-managed by default factory client — attach via header).
- CI: `.github/workflows/ci.yml` 3 jobs (bff/frontend/python), v1 excluded. Add 4th job `secrets` (ubuntu, checkout fetch-depth 0, download gitleaks release binary, `gitleaks detect --redact -v`).
- No real secrets in repo today (recon scan clean) — the CI job pins that state.

### References

- [Source: PRPs/epics.md#Story 4.1 (L754-765); NFR6; AR40 (epics L224, architecture L177)]
- [Source: components/bff/src/Spectr.Bff/{Program.cs,appsettings.json,Auth/JwtTokenService.cs,Options/AnonOptions.cs}]
- [Source: .github/workflows/ci.yml; docker/docker-compose.yml L94; components/worker/.env.example]

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code)

### Debug Log References

- Logout returns 204 NoContent (test initially expected 200) — fixed expectation.
- Local gitleaks first pass flagged 2 items, both false positives (test signing-key constant; story-md prose "key shapes per kind" in a historical commit). Allowlisted with rationale.

### Completion Notes List

- **AC1** — the "hardcoded default" was `appsettings.json` `Jwt:Key` making the `?? throw` unreachable in every env. Now: no keys in appsettings.json; dev keys ONLY in appsettings.Development.json; `RequireSigningKey` boot validation (non-blank + ≥32 bytes, both Jwt and Anon keys, all environments for length). Repo trap fixed at the root: `dotnet run` defaulted to Production env (no launchSettings) — added launchSettings.json + explicit env in start-spectr, so dev works and Production genuinely refuses. Side effect: `/api/auth/dev-login` (IsDevelopment-gated) now actually works under the launcher.
- **AC2** — root `.env.example` is the canonical AR40 inventory; worker example gap-filled. Placeholders only (gitleaks-verified).
- **AC3** — register/login regression green + NEW refresh-rotation and logout-revocation coverage (recon found `/refresh`/`/logout` had zero direct tests).
- **AC4** — gitleaks in CI over full history; local run proves clean. **Built-image scanning deferred to 10.1** (CI builds no images; recorded honestly).
- Legacy v1 `api/app/config.py` JWT default is frozen/excluded (AR3) — noted for v1 retirement.

### File List

- `components/bff/src/Spectr.Bff/Program.cs` (RequireSigningKey validation)
- `components/bff/src/Spectr.Bff/appsettings.json` (keys removed) + `appsettings.Development.json` (dev keys)
- `components/bff/src/Spectr.Bff/Properties/launchSettings.json` (new)
- `components/bff/tests/Spectr.Bff.Tests/SecretsHardeningTests.cs` (new — 5 tests)
- `scripts/start-spectr.ps1` (explicit Development env)
- `.env.example` (new, root) + `components/worker/.env.example` (gap fill)
- `.gitleaks.toml` (new) + `.github/workflows/ci.yml` (secrets job)

### Senior Developer Review (AI)

2026-07-03 — bmad-code-review (Blind Hunter security-mindset + Edge Case Hunter/Acceptance Auditor combined; auditor ran the new tests against live Postgres, 5/5). Outcome: **Approve after patches** — fail-fast core sound, but both new security gates were bypassable as written. 13 patches applied:

- [x] [High] **env=Development-on-prod bypass**: publicly-committed dev keys + `dotnet publish` shipping Development.json meant one env var flipped prod to forgeable JWTs → (a) `RequireSigningKey` rejects the committed dev-key literals outside Development, (b) `appsettings.Development.json` excluded from publish (`CopyToPublishDirectory=Never`), (c) compose bff gets `Anon__SigningKey` env (publish exclusion removed its config source), (d) prod overlay `docker-compose.prod.yml` now overrides bff with `ASPNETCORE_ENVIRONMENT=Production` + required `${JWT_KEY:?}`/`${ANON_SIGNING_KEY:?}`; boot test proves dev-key rejection
- [x] [High] **Allowlist over-breadth**: unanchored substrings (`minioadmin`, `sk_test_x`) could mask real credentials containing them → every regex anchored `^...$` with `regexTarget="secret"`; blanket `PRPs/.*` exclusion (permanent blind spot exactly where secrets get pasted) → narrowed to the ONE story file whose prose trips generic-api-key
- [x] [High] **Unpinned gitleaks binary in the secret-scan job itself** → SHA256 checksum verified before extraction (hash computed from the official release asset); timeout-minutes + checkout@v5 consistency
- [x] [Med] Placeholder keys (32 chars) passed the length check — copying .env.example unmodified booted "Production" → `REPLACE_*` prefixes rejected in ALL environments
- [x] [Med] `Jwt:Key == Anon:SigningKey` accepted despite .env.example demanding different → boot-rejected; test added
- [x] [Med] Cookie tests could pass via the handler's cookie container rather than server-side rotation → `HandleCookies=false` client; cookie extraction matches `RefreshTokenService.CookieName` exactly (not a substring guess)
- [x] [Med] `ThrowsAny<Exception>` + message substring too broad → asserts `InvalidOperationException` in the chain; `Flatten` AggregateException double-count fixed
- [x] [Low] Short-key test now a Theory over Production AND Development (config-precedence coverage); boot tests isolate from ambient host `Jwt__Key` env vars via in-memory nulls
- [x] [Low] dev-login (passwordless minting, IsDevelopment-gated) now also requires a LOOPBACK remote — compose publishes :5000 on 0.0.0.0, so env-gating alone leaked token minting to the LAN
- [x] [Low] `.env.example`: `ASPNETCORE_ENVIRONMENT` documented as load-bearing; `JWT_KEY`/`Jwt__Key` same-secret note; `ANON_SIGNING_KEY` compose var added
- Deferred (10.1 line items): Postgres service in the CI bff job (silent-skip pattern is project-wide), `Password=spectr` connection-string fallback hardening, Development.json-in-image already mitigated but full prod topology owns the final shape.
- Rejected: entropy scoring beyond blacklists (heuristic theater; the placeholder/dev-literal rejections catch the realistic failure modes).

### Change Log

- 2026-07-03: implemented on `account/4-1-secrets-hardening`. Gates: BFF 284/284; gitleaks clean over 493 commits. Status → review.
- 2026-07-03 (review): 13 patches applied. Gates: BFF 287/287 (8 secrets tests; one parallel flake re-ran green); gitleaks re-verified post-commit.
