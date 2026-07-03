# Story 10.5: Admin Endpoints & Audit Log

Status: done

## Story

As the operator,
I want a user's billing trail inspectable and every privileged action logged,
So that a double-charge claim resolves in minutes with evidence.

## Acceptance Criteria

1. **Given** elevated admin auth (separate from user auth — NFR7), **When** the operator calls Admin endpoints, **Then** a user's billing/webhook trail is inspectable for refund decisions (FR46).
2. **Given** a refund, **When** issued, **Then** the action records in the audit log (actor, target, reason, timestamp).
3. **Given** privileged actions (bans, feature-flag changes, prompt rollbacks), **When** executed, **Then** audit rows append.

## Decisions of record (recon 2026-07-03)

1. **Elevated auth = a dedicated `X-Admin-Key` header** (env `ADMIN_API_KEY`), constant-time-compared by an endpoint filter — a genuinely SEPARATE channel from the user JWT pipeline (NFR7's letter). Unconfigured ⇒ every admin route 404s (surface invisible); configured outside Development ⇒ boot-gated ≥32 chars (RequireSigningKey precedent). No role claims — a solo-operator static secret beats a role system nobody administers.
2. **Audit actor for operator actions = `Guid.Empty`** (documented sentinel — there is no operator user row; actor_user_id deliberately has no FK since 4.6). Every admin mutation REQUIRES a non-empty `reason` (400 otherwise) — the audit row is the point.
3. **Endpoints** (`AdminEndpoints.cs`, `/api/admin/*`): `GET users/{idOrEmail}/billing` (subscription + ledger w/ balance + usage + llm spend summary + webhook events correlated via the user's stripe ids + prior audit rows targeting them); `POST refunds` (two shapes: `credits` → `credit_ledger` `adjustment` entry — the reason value reserved for exactly this since 2.x — and/or `paymentIntentId` → NEW `IStripeRefundClient.CreateRefundAsync` w/ deterministic idempotency key); `POST users/{id}/ban` + `unban`; `PUT flags/{name}`; `PUT prompts/{slug}`; `GET audit?target=`.
4. **Ban primitive** (10.6's AC2 depends on it): migration adds `users.banned_at` + `users.ban_reason`; ban bumps `token_version` (+ tver cache evict — sessions die instantly local, ≤60 s cross-replica) and the `OnTokenValidated` lookup now fetches `(TokenVersion, BannedAt)` in the SAME cached query — banned ⇒ token rejected; login/refresh return 403 `account_banned`. Python mirror gains the columns.
5. **Flag writes evict the BFF `feature_flags_global` cache** (instant local effect); the worker's independent 60 s TTL is the documented cross-service bound. Prompt pins validate against the BFF `SpecialistCatalog` slugs + the same `^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$` version regex the worker defends with (prompt_loader anticipated exactly this writer).
6. **Append-only becomes DB-ENFORCED**: `BEFORE UPDATE OR DELETE` trigger on `audit_log` raising an exception (REVOKE is useless — the app role owns the table). `credit_ledger` gets the same trigger (same migration — it is the money evidence). 4.6's audit contract note said 10.5 owns this.
7. **Out of scope**: admin UI (curl/httpie is the v1 console — runbook examples), refund webhook mirroring (`charge.refunded` handler = 10.6-adjacent follow-up, noted), disposable-email throttling (10.6).

## Tasks / Subtasks

- [x] Task 1 — `AddAdminPrimitives`: users.banned_at/ban_reason (nullable — no default-mismatch class) + `spectr_forbid_mutation()` trigger on audit_log AND credit_ledger with a session-GUC escape hatch (`SET spectr.allow_purge='1'` — a conscious, greppable act; REVOKE is useless against the owning role); python mirror columns; 7 test-cleanup sites armed via `TestAuth.AllowPurgeAsync` (opens the context connection so SET + deletes share one session)
- [x] Task 2 — `AdminAuth.Filter` (`X-Admin-Key`, `FixedTimeEquals`, 404-when-unconfigured — invisible, not merely locked) + boot gate (configured key <32 chars outside Development refuses boot) + `IStripeRefundClient` (idempotency key per payment intent — a double-click refunds once)
- [x] Task 3 — `AdminEndpoints.cs` (7 routes): billing trail (ledger+balance, subscription, usage, llm spend by purpose, stripe-id correlation + recent webhook_events — the table has no user_id by PCI design, documented), refunds (Stripe FIRST then tx: ledger `adjustment` + audit — a Stripe failure records NOTHING), ban/unban, flags (evicts `feature_flags_global`), prompt pins (SpecialistCatalog slug whitelist + the worker's exact `_SAFE_VERSION_RE` — path-injection defense), audit list w/ target filter; reason REQUIRED on every mutation; operator actor = Guid.Empty sentinel
- [x] Task 4 — OnTokenValidated cache value → `(Version, Banned)` tuple (same key, same eviction); ban bumps tver + evicts; login AND refresh return 403 `account_banned` (explicit code — a silent 401 is support noise)
- [x] Task 5 — 6 tests: invisibility/lock, trail-by-email, refund (fake Stripe recorded + ledger + audit row w/ sentinel actor), full ban lifecycle (token dies, login 403, double-ban 409, unban restores, 2 audit rows), flag+pin (traversal rejected, unpin path), append-only triggers (UPDATE and DELETE both raise)
- [x] Task 6 — runbook curl console + escape-hatch doc; .env.example + compose `Admin__ApiKey`. Gates: BFF 334/334 (6 new), worker 583+3xf, shared 27, ruff clean

## Dev Notes

- Constant-time compare: `CryptographicOperations.FixedTimeEquals` on UTF8 bytes.
- OnTokenValidated cache value becomes a small record (Version, Banned) — key stays `tver:{uid:N}`; ban/unban/reset all evict it.
- webhook_events has NO user_id — correlate via `users.stripe_customer_id` prefix match on event ids is impossible; instead return recent webhook_events rows where `id` appears in subscription-related audit… simplest honest v1: return the user's stripe ids + the latest 50 webhook_events for OPERATOR correlation (documented — payload_hash only, no PII).
- CreditLedgerService: check existing method shapes before adding an adjustment writer; keep idempotency_key on admin adjustments (`admin-adj:{userId}:{reason-hash}:{date}`? No — operator may legitimately repeat; omit key, rely on reason+audit).
- Stripe refund: `RefundService.CreateAsync(new RefundCreateOptions { PaymentIntent = ... }, new RequestOptions { IdempotencyKey = $"admin-refund:{paymentIntentId}" })` — idempotent per intent (a double-click refunds once).
- 4.4 migration lesson: nullable columns, no default mismatch risk.

### References

- [Source: PRPs/epics.md L1224-1234, FR46 L101, NFR7 L119; architecture.md L222 (Admin folder), L92 (ledger refund semantics)]
- [Source: recon — AuditLog.cs (10.5 contract note), prompt_loader._SAFE_VERSION_RE + pin TTL, EntitlementService caches, JwtTokenService/OnTokenValidated, CreditLedgerEntry CHECK reasons, dev-login env-gate precedent]

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code)

### Debug Log References

- TestSupport needed `Microsoft.EntityFrameworkCore` using for DatabaseFacade extensions.

### Completion Notes List

- AC1: trail endpoint = the refund-decision evidence in one call; elevated auth genuinely separate from the JWT pipeline (NFR7).
- AC2/AC3: every mutation audits in-tx; append-only now DB-enforced (4.6's contract note paid).
- Ban primitive ready for 10.6's layered-abuse story.
- Follow-ups noted: `charge.refunded` webhook mirroring; admin UI (curl is v1).

### File List

- Data: `Entities/User.cs` (banned_at/ban_reason), migration `AddAdminPrimitives` (+triggers)
- BFF: `Auth/AdminAuth.cs` (new), `Services/IStripeRefundClient.cs` (new), `Endpoints/AdminEndpoints.cs` (new), `Endpoints/AuthEndpoints.cs` (login/refresh ban checks), `Program.cs` (boot gate, DI, mapping, OnTokenValidated tuple)
- Shared: `models.py` (mirror columns)
- Tests: `AdminEndpointsTests.cs` (new, 6), `TestSupport.cs` (AllowPurgeAsync), 7 cleanup sites armed
- Docs: `docs/runbook.md` (Admin surface), `.env.example`, `infra/compose.prod.yml` (Admin__ApiKey)

### Senior Developer Review (AI)

2026-07-03 — bmad-code-review (Blind Hunter security pass + Edge Case Hunter/Acceptance Auditor; the auditor EMPIRICALLY disproved the GUC-pool-leak hypothesis with a live probe — Npgsql resets session state on pool reuse, pid-verified across 10 reuses — and re-ran 43 tests across all touched suites). Outcome: **Approve after patches** — 12 applied:

- [x] [High] **TRUNCATE bypassed the "DB-enforced" append-only claim** (row triggers don't fire on TRUNCATE — the whole evidence trail was one statement from gone) → statement-level BEFORE TRUNCATE triggers on both tables (+ TG_OP=TRUNCATE branch in the escape hatch); migration rollback-edited-reapplied
- [x] [High] **Composed audit reasons could overflow varchar(500) AFTER a Stripe refund succeeded** (SaveChanges throws → money moved, zero evidence — deterministic, not a rare crash) → reason input bounded ≤300 in ALL handlers before any side effect; composed strings Fit() to 500
- [x] [High] **Refund validation ran after the Stripe call in spirit** → ALL validation now precedes Stripe: credits capped at 1000 (the ledger is append-only — a fat-fingered 2000000 would be forever), reason bounds, and **payment-intent OWNERSHIP verified** (`GetIntentCustomerIdAsync` vs the user's stripe_customer_id — a pasted-wrong pi_ must not refund another customer with the audit pointing at this user); 502 body documents the retry semantics (Stripe leg idempotent, credits leg NOT — check the trail first)
- [x] [Med] Flag typing: non-numeric `llm_budget_*` values would detonate the 10.4 budget alert (::float cast → rule Error state) while the worker silently fell to env — numeric-flag families now validated
- [x] [Med] Concurrent PUT create races (flag/pin PK collisions) → 409 instead of unhandled 500
- [x] [Low] FixedEquals → hash-then-compare (no length branch at all); runbook curl console was broken shell AND leaked the key to argv (`-K keyfile` pattern now); ban-timing honesty (≤15 min worst case for pre-4.6 tokens); one-human-per-key-era constraint; `No Reset On Close` prohibition documented (the pool reset is what confines the purge hatch); IP-allowlist Caddy snippet documented but deliberately not shipped (a moving operator IP mid-incident = lockout); test-helper mirror deleted (references `AdminEndpoints.OperatorActor`)
- Verified-clean: no prod writer UPDATEs/DELETEs either audited table (deletion actor retains both; reversals INSERT; sweeps read); ban check ordered AFTER password verify (no unauthenticated ban oracle); group filter covers every route; EF parameterization on the audit filter; unban-resurrects-refresh-sessions noted as intended (appeal UX); GUC pooling empirically safe.
- Accepted: admin surface public-with-key (mitigations: 404-invisible, 32-char boot gate, constant-time, documented allowlist option); refund crash window narrowed to genuine process-death (validation-first) with a documented retry.

### Change Log

- 2026-07-03: implemented on `ops/10-5-admin`. Gates: BFF 334/334, worker 583+3xf, shared 27, ruff clean. Status → review.
- 2026-07-03 (review): 12 patches incl. TRUNCATE closure + refund hardening. BFF 334/334 re-verified.
