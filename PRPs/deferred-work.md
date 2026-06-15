# Deferred Work

Real findings that are out of scope for the current story but worth revisiting.

## Deferred from: code review of story-1.5 (2026-06-15)

- **In-flight idempotency window allows double LLM spend on dramatiq redelivery** [components/worker/app/coach_actor.py] — Phase A's `status == "pending"` check protects against post-write retries but not against two workers passing the check before either writes. Single-worker invariant (`concurrency=1`) keeps the race rare today. Proper fix: add `processing` status to the CHECK constraint via a new migration, atomically `UPDATE … WHERE status='pending'` with rowcount check, plus a janitor actor to recover stuck `processing` rows after a timeout. Larger than a review patch — wants a dedicated story.

- **Verdict projection runs outside Phase A transaction in a fresh session** [components/worker/app/coach_actor.py:284 → 350-383] — can see a different snapshot than Phase A and swallows all exceptions silently. Revisit when introducing repeatable-read isolation or when coach grounding gets stricter.
- **Tail query has no SQL LIMIT — pulls full conversation history** [components/worker/app/coach_actor.py:247-255] — `.order_by(created_at.asc())` loads every non-pending row then slices last 10 in Python. Add `.order_by(...desc()).limit(11)` when caps story 1.9 lands.
- **`CreatedAt = now.AddMilliseconds(1)` ordering hack is fragile** [components/bff/src/Spectr.Bff/Endpoints/CoachConversationEndpoints.cs:139] — millisecond resolution + EF default sentinel-detection could theoretically collide. Add a deterministic tiebreaker if it surfaces.
- **Procfile updated but no Dockerfile to mirror the `--queues default coach` change** [components/worker/Procfile + docker/docker-compose.yml] — no worker Dockerfile in repo today. Wire when the worker image build lands.
- **Assistant content stored as raw text — frontend XSS risk on rendering** [components/bff/src/Spectr.Bff/DTOs/CoachConversationDtos.cs] — coach can emit anything; story 1.8's frontend rendering must sanitize before display.
- **`_resolve_path` prefix-rewrite list is partial** [components/worker/app/coach_lib/context.py:114-118] — only certain path roots auto-prefixed with `analysis.`. Extend when the coach prompt evolves.
- **`conversationId = Guid.Empty` sentinel for "no conversation yet"** [components/bff/src/Spectr.Bff/Endpoints/CoachConversationEndpoints.cs:184-189] — ugly but documented. Story 1.8 may want `conversationId: null` instead.
- **Stale conversation rows if `Analysis.UserId` is later reassigned** — no reassignment feature today; rows would become unreachable but persist. Address when admin reassignment ships.
- **`als_summary` truthy check skips empty dicts/falsy values** [components/worker/app/coach_lib/context.py:57-61] — real `.als` shape is non-empty when present.
- **`json.dumps(default=str)` silently coerces non-JSON-safe types** [components/worker/app/coach_actor.py:182] — future Decimal/datetime additions would stringify silently.
- **`evidence` JSONB write depends on `model_dump()` field names** [components/worker/app/coach_actor.py:127] — works today because both ends use lowercase one-word fields; multi-word fields would mistranslate.

## Deferred from: code review of story-1.6 (2026-06-15)

- **`components/worker/app/coach_actor.py` at 560 lines exceeds the ~500-line CLAUDE.md ceiling (guardrail 15)** [components/worker/app/coach_actor.py] — Story projected ~330 lines; landed at 560 after the streaming rewire. Suggested follow-up: extract `_mark_complete`/`_mark_refused`/`_mark_error`/`_mark_complete_partial` helpers and the Phase E parse/validate block into `coach_lib/phase_handlers.py`.
- **AC4 idle-fallback + 15s heartbeat have no unit tests** [components/bff/tests/Spectr.Bff.Tests/CoachStreamEndpointTests.cs] — Story explicitly deferred these; deterministic tests need test-only timer overrides (InternalsVisibleTo + IOptions-backed timer). Manual smoke (Task 9.2) covers timing today.
- **Cancel-key TTL of 180s could collide with a dramatiq retry reusing the same `assistant_message_id`** [components/bff/src/Spectr.Bff/Endpoints/CoachConversationEndpoints.cs:391-400 + components/worker/app/coach_lib/cancel.py] — Narrow window with `concurrency=1` + `max_retries=1`. Document or shorten TTL when retry semantics tighten.
- **Idle-fallback fires somewhere in [30, 45]s due to heartbeat-tick coupling** [components/bff/src/Spectr.Bff/Endpoints/CoachConversationEndpoints.cs:441-462] — Spec says ">30s"; actual variance is acceptable. Tighten with an absolute timer if needed.
- **No streaming-gateway-level test asserts `LlmInvocationError` carries `llm_call_id`** [components/worker/tests/test_coach_stream_gateway.py] — Partially covered at actor layer. Add when the streaming-error-path patches land — same fixture work serves both.
