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
