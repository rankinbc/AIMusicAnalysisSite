name: "Listen V3 · PRP-0 — Spine Primitives: Durable Anon Identity, Opaque-Token Auth, Cross-Slice Sinks & Rate Limiting"
description: |
  Pre-flight slice that resolves the cross-cutting ⛔ blockers from the adversarial review BEFORE they get re-decided
  (inconsistently) in every downstream PRP. Four dependency-light primitives + two ratified conventions that PRP-1…7
  consume: (1) a durable, signed anonymous identity replacing the non-durable ip_hash; (2) an opaque-resource-token auth
  abstraction so share/session tokens are NOT routed through the JWT `?t=` path; (3) the no-op cross-slice sink convention
  (`INotificationSink`/`IGamePlanSink`) that removes backward build dependencies; (4) a Redis rate-limiter for anon abuse.
  NO database migration — all middleware/services/interfaces. Build FIRST, before PRP-1.

## Core Principles
1. Context is King · 2. Validation Loops · 3. Information Dense · 4. Progressive Success · 5. Follow CLAUDE.md · 6. Decide shared foundations ONCE.

---

## Goal
- **`AnonIdentity`** — a signed, durable anonymous-actor token (HMAC, httpOnly cookie, stateless — no table) issued on
  first anonymous request. Establishes the canonical anon `ActorRef = { type:'anon', anonId, displayName? }`. Downstream
  anon-capable tables key dedup/attribution on **`anon_id`**, NOT `ip_hash` (resolves PRP-2 G2, PRP-6 G1).
- **`ResourceTokenAuth`** — an `AllowAnonymous` auth abstraction: opaque resource token → (pluggable resolver) → resource +
  resolved actor (authed JWT *or* AnonIdentity). PRP-2's `/v/{token}` resolver and PRP-4's `/sessions/{id}/stream` extend
  it. Opaque tokens are explicitly kept OUT of the JwtBearer `?t=` pipeline (resolves PRP-2 G1).
- **Cross-slice sink convention** — `INotificationSink` + `IGamePlanSink` interfaces with **no-op default** DI
  registrations. Emitters (PRP-3/4/6) call them in the same `SaveChanges`; owning PRPs (PRP-5/7) swap real impls. Removes
  the PRP-3→PRP-5 / PRP-3→PRP-7 backward dependencies (resolves PRP-3 G1, and formalizes the seam PRP-7 already assumed).
- **`IRateLimiter`** — a Redis sliding-window limiter keyed by `(actorKey, ip, action)` over the existing
  `IConnectionMultiplexer`; applied to anon comment/suggestion create (PRP-3) and mentions (PRP-7). 429 via `ErrorEnvelope`.
- **Ratified conventions** (implemented downstream, recorded here so they're consistent): nullable `RackPreset.user_id` +
  system-actor semantics + the `source='user' AND user_id=me` library filter (PRP-1 G1/G2).

## Why
- The review's blockers cluster into a handful of **shared decisions** that 3–6 PRPs each touch (anon identity, opaque-token
  auth, the sink seam, rate limiting). Deciding them per-slice guarantees drift and rework. One small pre-flight settles them.
- **Cheap + low-risk:** no schema, no user-facing surface — just the primitives the spine stands on. It de-risks PRP-1…7
  without blocking them (they already declare these seams as TODO/no-op).

## What
Backend-only infrastructure: an anon-identity cookie middleware + helper, an anonymous auth handler base, two no-op sink
interfaces wired into DI, and a rate limiter. Plus a short conventions doc the other PRPs reference. No endpoints, no tables.

### Success Criteria
- [ ] `AnonIdentity`: first anonymous request issues a signed httpOnly cookie; subsequent requests resolve a stable
      `anonId`; the value is tamper-evident (HMAC) so one client can't spoof another's `anonId`. Exposed as an `ActorRef` on the request.
- [ ] `AnonActor.Capture(...)` (the helper PRP-3/6 reference) lives HERE and returns `{ anonId, displayName? }`, not an ip_hash.
- [ ] `ResourceTokenAuth` base resolves an opaque token via a pluggable resolver + attaches the actor (authed or anon);
      a unit test proves an opaque token is NOT accepted by the JwtBearer `?t=` pipeline and vice-versa.
- [ ] `INotificationSink` + `IGamePlanSink` registered as no-ops; a test proves an emitter call is a no-op until a real impl
      is registered, and that calling within a transaction that rolls back leaves nothing.
- [ ] `IRateLimiter.Check(actorKey, ip, action, limit, window)` returns allow/deny over Redis; deny → 429 `ErrorEnvelope`.
- [ ] Conventions doc written (nullable preset user_id, system-actor, library filter, anon_id-not-ip_hash) and linked from PRP-1/2/3/6.
- [ ] No DB migration. BFF build + tests green.

## All Needed Context
```yaml
# THE REVIEW (what this PRP resolves)
- file: _bmad-output/brainstorming/listen-v3-schema-reconciliation-2026-06-25.md
  why: "Adversarial review" section + per-PRP "Known Gaps" — this PRP owns the cross-cutting ⛔ blockers (PRP-2 G1/G2, PRP-3 G1) + the conventions for PRP-1 G1/G2, PRP-6 G1, PRP-7 G1.

# EXISTING PATTERNS TO BUILD ON
- file: components/bff/src/Spectr.Bff/Program.cs
  why: JwtBearer config + the ?t= OnMessageReceived hook (~50-72) — ResourceTokenAuth lives ALONGSIDE this, not inside it (opaque tokens ≠ JWT). IConnectionMultiplexer singleton (~88-96) for the rate limiter + anon-cookie nonce. DI registration site for the new services + no-op sinks.
- file: components/bff/src/Spectr.Bff/Endpoints/ShareEndpoints.cs
  why: the current anon capture (display-name trim + SHA256(ip)+process salt, ~273) — the thing AnonIdentity REPLACES for new tables. GenerateToken recipe (~273) for reference.
- file: components/bff/src/Spectr.Bff/Services/EntitlementService.cs
  why: the scoped-service + DI registration pattern to mirror for AnonIdentity/IRateLimiter; its 60s Redis/memory cache style.
- file: components/bff/src/Spectr.Bff/Endpoints/ErrorEnvelope.cs
  why: ErrorEnvelope.Build(status, code, message, details) — the 429 (rate limit) + 401/403 (auth) envelopes.
- file: components/bff/src/Spectr.Bff/Endpoints/CoachConversationEndpoints.cs
  why: precedent for a gate that resolves → ErrorEnvelope before side-effects (~116) — the rate-limit check mirrors this shape.
```

### Desired tree (files added)
```bash
components/bff/src/Spectr.Bff/
  Services/AnonIdentity.cs        # signed-cookie issue/resolve + AnonActor.Capture -> ActorRef{type:anon,anonId}
  Services/ResourceTokenAuth.cs   # AllowAnonymous base: opaque token -> resolver -> resource + actor (authed|anon)
  Services/INotificationSink.cs   # interface + NoOpNotificationSink
  Services/IGamePlanSink.cs       # interface + NoOpGamePlanSink
  Services/IRateLimiter.cs        # interface + RedisRateLimiter (sliding window over IConnectionMultiplexer)
  Services/ActorRef.cs            # the shared ActorRef value type (user|anon) used everywhere (if not already extracted)
  Program.cs                      # CHANGE: register the above in DI + add the anon-cookie middleware
PRPs/design_handoffs/design_handoff_listen_rack/LISTEN_V3_CONVENTIONS.md   # the ratified conventions (linked from PRP-1/2/3/6)
```

### Primitives — design detail
```text
# 1. AnonIdentity (stateless, signed cookie — no table)
- Cookie 'spectr_anon' = base64( anonId(uuid) | HMAC_SHA256(anonId, ANON_SIGNING_KEY) ), httpOnly, SameSite=Lax, long-lived.
- Middleware: on a request with no auth + no valid anon cookie, mint one (Set-Cookie). On present cookie, verify HMAC; reject-forged -> mint fresh.
- AnonActor.Capture(displayName?) -> ActorRef{ type:'anon', anonId, displayName: trim(displayName,120) }.
- Dedup/attribution downstream keys on anonId (stable per browser until cookies cleared). Best-effort identity — documented as such.
  Because clearing cookies mints a fresh anonId, anon ABUSE control must ALSO rate-limit on ip (see #4 IRateLimiter), not anonId alone.
- WHY not ip_hash: ip_hash uses a process-scoped salt that resets on restart + collides behind NAT (PRP-6 G1). anonId is durable + per-client.
- WHY signed: prevents a client from forging another client's anonId to spoof attribution/inflate a bookmark count.

# 2. ResourceTokenAuth (opaque tokens ≠ JWT)
- Abstract handler for AllowAnonymous routes carrying an opaque resource token (share token / session token) in the PATH or body — NOT '?t='.
- Pipeline: extract token -> ITokenResolver.Resolve(token) -> { resourceId, kind } | null(404) ; resolve actor = authed JWT (if header) ELSE AnonIdentity.
- PRP-2 supplies a ShareTokenResolver (token -> share_settings -> versionId); PRP-4 a SessionTokenResolver. This PRP ships the base + a test resolver.
- Hard rule (tested): the JwtBearer '?t=' hook stays whitelisted to /api/versions/.../audio and NEVER accepts an opaque resource token; opaque tokens flow only through ResourceTokenAuth.

# 3. Cross-slice sinks (kill backward deps)
- interface INotificationSink { Notify(...); NotifyDigest(...); }  default NoOpNotificationSink (DI). PRP-7 registers the real one.
- interface IGamePlanSink   { InsertDrainItem(...); }              default NoOpGamePlanSink (DI).   PRP-5 registers the real one.
- Convention: any side-effect a LATER PRP owns is declared here as a no-op sink, called in-tx by the EARLIER PRP (so it builds + tests green standalone). Same pattern already used implicitly by PRP-7's INotificationSink.

# 4. IRateLimiter (Redis sliding window)
- Check(actorKey, ip, action, limit, window) -> Allowed | Denied. Key = ratelimit:{action}:{actorKey|ip}. Reuses IConnectionMultiplexer.
- actorKey = userId for authed, anonId for anon. Applied by PRP-3 (comment/suggestion create) + PRP-7 (mention fan-out). Deny -> 429 ErrorEnvelope.
- ⭐ FOR ANON, THE ip ARM IS THE REAL CEILING: anonId is cheap to rotate (clear cookies -> fresh signed cookie), so anon
  actions MUST check BOTH arms (anonId AND ip) — otherwise a clear-cookies loop defeats per-anonId dedup/limits. anonId
  alone is best-effort attribution; ip is the abuse backstop (PRP-6 G1 anon bookmark count, PRP-7 G1 anon @mention spam).
```

### Tasks
```yaml
Task 1 — ActorRef.cs: extract/define the shared { type, userId?, anonId?, handle?, displayName?, hue? } value type.
Task 2 — AnonIdentity.cs + middleware in Program.cs (signed cookie issue/verify) + AnonActor.Capture.
Task 3 — ResourceTokenAuth.cs: the AllowAnonymous base + ITokenResolver seam + a unit-test resolver. Prove opaque ≠ JWT path.
Task 4 — Sinks: INotificationSink/IGamePlanSink + NoOp defaults; register in DI.
Task 5 — IRateLimiter.cs + RedisRateLimiter; register in DI.
Task 6 — CONVENTIONS doc (LISTEN_V3_CONVENTIONS.md): nullable RackPreset.user_id + system-actor + library filter + anon_id-not-ip_hash; link from PRP-1/2/3/6 "Known Gaps".
Task 7 — TESTS + GATES.
```

### Integration Points
```yaml
DATABASE: NONE (cookie-only anon, Redis rate-limit, interfaces).
CONFIG: ANON_SIGNING_KEY (env, via BaseSettings/IConfiguration) — separate from the JWT key.
DI (Program.cs): AddScoped<AnonIdentity>, AddSingleton<IRateLimiter,RedisRateLimiter>,
                 AddScoped<INotificationSink,NoOpNotificationSink>, AddScoped<IGamePlanSink,NoOpGamePlanSink>;
                 app.UseAnonIdentity() middleware before endpoint routing.
CONSUMED BY: PRP-2 (ResourceTokenAuth resolver + AnonIdentity on /v/{token}), PRP-3 (AnonActor + IRateLimiter + IGamePlanSink),
             PRP-4 (ResourceTokenAuth on /sessions/{id}/stream + AnonActor), PRP-5 (implements IGamePlanSink),
             PRP-6 (AnonActor/anon_id), PRP-7 (implements INotificationSink + IRateLimiter).
```

## Validation Loop
### Level 1
```bash
cd components/bff && dotnet format && dotnet build
```
### Level 2
```bash
cd components/bff && dotnet test
```
Author (expected / edge / failure):
- AnonIdentity: no-cookie request mints a signed cookie + stable anonId on the next request (expected); a tampered cookie is rejected and re-minted (failure); two requests one client → same anonId (edge).
- ResourceTokenAuth: a valid opaque token resolves the resource + anon actor (expected); the same token via `?t=` is NOT honored by JwtBearer (failure — the hard rule); a JWT is NOT honored as an opaque resource token (failure).
- Sinks: emitter call with NoOp default is a no-op (expected); a rolled-back tx leaves nothing (edge); swapping a real impl receives the call (expected).
- IRateLimiter: N calls allowed, N+1 denied within the window (edge); deny returns 429 ErrorEnvelope (failure path).
### Level 3
```bash
# No standalone runtime surface — validated by the consuming PRPs. Smoke: BFF boots with the new DI + middleware.
cd components/bff/src/Spectr.Bff && dotnet run   # confirm startup (middleware + DI wired), then stop.
```

## Final Validation Checklist
- [ ] AnonIdentity signed-cookie issue/verify; AnonActor.Capture returns anon ActorRef (anonId, not ip_hash).
- [ ] ResourceTokenAuth base + ITokenResolver seam; the opaque-token-≠-JWT rule is unit-tested both directions.
- [ ] INotificationSink/IGamePlanSink no-op defaults registered; in-tx + rollback semantics tested.
- [ ] IRateLimiter over Redis; 429 envelope.
- [ ] CONVENTIONS doc written + linked from the dependent PRPs; ANON_SIGNING_KEY via config.
- [ ] No migration; BFF builds + boots + tests green.

---

## Anti-Patterns to Avoid
- Don't route opaque resource tokens through the JwtBearer `?t=` hook — that's the bug this PRP exists to prevent.
- Don't keep using ip_hash for new anon dedup/attribution — anonId is the durable key (ip_hash stays only for the legacy /share comments).
  (ip is still used as the RATE-LIMIT ceiling for anon — see IRateLimiter #4 — just not as the identity/dedup key.)
- Don't let a later PRP's side-effect become a hard dependency of an earlier PRP — declare a no-op sink here, call it in-tx.
- Don't store the anon signing key with the JWT key conflated — separate ANON_SIGNING_KEY.
- Don't add a table for anon identity yet — stateless signed cookie; revisit only if server-side revocation is needed.
- Don't build endpoints here — PRP-0 is primitives the other slices consume.
