# Listen V3 — Ratified Conventions (PRP-0)

Single source of truth for the cross-cutting decisions that 3–6 of the Listen V3
PRPs each touch. Decided once here (PRP-0 — spine primitives) so they don't drift
when re-decided per slice. PRP-1/2/3/6 reference this from their "Known Gaps".

---

## 1. Anonymous identity: `anon_id`, never `ip_hash`

New anon-capable tables key **dedup + attribution on the signed-cookie `anonId`**
(`AnonIdentity` / `AnonActor.Capture`), NOT on an `ip_hash`.

- **Why:** `ip_hash` uses a process-scoped salt that resets on restart and collides
  behind NAT — it is neither durable nor per-client (PRP-2 G2, PRP-6 G1). `anonId`
  is a durable, HMAC-signed, per-browser id.
- **`ip` is still used — but only as the rate-limit ceiling**, never as the
  identity/dedup key. Because clearing cookies mints a fresh `anonId`, anon abuse
  control MUST also limit on `ip` (see `IRateLimiter`, which checks both arms).
- The legacy `/share` comment path keeps its `ip_hash` for back-compat; do not add
  new `ip_hash` columns.

## 2. `RackPreset.user_id` is nullable + system-actor semantics

`rack_presets.user_id` is **nullable**:

- **User-created** preset → `user_id = <owner>`, `source = 'user'`.
- **System-generated** preset (coach / analysis, future PRP-8) → `user_id = NULL`,
  `source = 'coach' | 'analysis'`. NULL `user_id` means "the system actor".
- `source` CHECK = `('user','coach','analysis')`. `coach`/`analysis` are reserved
  for the future generator and only ever appear with a NULL `user_id`.
- `viz_presets` ARE user-scoped (keep a non-null `user_id`) — the sole exception.

## 3. "My presets" library filter

The user's personal preset library lists **`source = 'user' AND user_id = @me`**.
System-generated presets (`source IN ('coach','analysis')`, `user_id IS NULL`) are
surfaced in their own context (coach/analysis), never in the personal library list.

## 4. Cross-slice sinks kill backward dependencies

Any side-effect a LATER PRP owns is declared HERE as a **no-op sink interface**,
and called IN the same `SaveChanges` by the EARLIER PRP — so the earlier slice
builds + tests green standalone.

- `INotificationSink` (PRP-7 owns the real impl) — emitted by PRP-3 (comment/
  suggestion created, suggestion accepted) and PRP-6 (bookmark).
- `IGamePlanSink` (PRP-5 owns the real impl) — emitted by PRP-3 (suggestion
  accepted) and PRP-4 (room recap published).
- Called in-tx → a rolled-back transaction emits nothing.

## 5. Opaque resource tokens are NOT JWTs

Share/session tokens flow ONLY through `ResourceTokenAuth` (path/body) via a
pluggable `ITokenResolver`. They are **never** routed through the JwtBearer `?t=`
hook, which stays whitelisted to `/api/versions/{id}/audio` and only ever accepts
a valid JWT (PRP-2 G1). PRP-2 adds a `ShareTokenResolver`; PRP-4 a
`SessionTokenResolver`.

---

**Config:** `Anon:SigningKey` (env `Anon__SigningKey` in prod) HMAC-signs the anon
cookie and is SEPARATE from `Jwt:Key`; it must be stable across restarts or every
anon cookie invalidates on redeploy.
