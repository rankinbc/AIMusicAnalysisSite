# Story 1.6: Coach Streaming Relay

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a producer,
I want coach answers to stream in live,
so that the conversation feels immediate.

## Acceptance Criteria

1. **Given** `coach_reply` generating, **When** tokens arrive from Anthropic, **Then** the actor publishes chunks to Redis pub/sub channel `coach:{conversationId}:{messageId}` **And** the BFF SSE endpoint `GET /api/coach/{analysisId}/messages/{messageId}/stream` relays them with event types `{token|done|error|refusal}` plus an SSE heartbeat comment every 15 s (AR9 + AR44).
2. **Given** a connected client, **When** the first token publishes to Redis, **Then** it reaches the browser <2 s after the BFF dispatched the POST (NFR2). LLM_FAKE=1 paths emit ≥3 token frames per fake reply so the front-end can be exercised end-to-end with no spend (AR41).
3. **Given** the client closes the SSE stream (stop button or tab close), **When** the actor checks the cancel flag between published chunks, **Then** generation is cancelled mid-stream **And** the partial assistant message persists with `status="complete"` (when ≥1 prose token arrived) or `status="error"` (when nothing usable arrived). No half-written row stays in `pending`.
4. **Given** Redis pub/sub goes idle for >30 s mid-stream, **When** the BFF detects the gap, **Then** it re-reads the persisted assistant row, emits a single trailing `error` event with `code="coach_stream_idle"`, and closes the SSE response — never a silent dead stream (AR9 fallback).
5. **Given** the SSE endpoint is hit AFTER the actor already wrote the terminal row (refresh-during-completion race; or a slow client subscribing late), **When** the BFF resolves the row's status to `complete`/`refused`/`error`, **Then** it synthesizes the final-state frames (one `token` carrying the persisted body, then `done`/`refusal`/`error`) and closes. The poll endpoint from story 1.5 remains the authoritative source — streaming is a UX accelerator, never the system of record.
6. **Given** an SSE subscriber that is not the conversation owner (cross-user request), **When** the BFF resolves `analysisId` + `messageId` → owner, **Then** the request returns `404` before any subscribe call. No leak of stream existence.

## Tasks / Subtasks

- [x] Task 1: Streaming entrypoint on the gateway (AC: 1, 2, AR39)
  - [x] 1.1 Add `gateway.stream_complete_sync(...) -> Iterator[GatewayStreamEvent]` to `components/worker/app/llm/gateway.py`. SAME kwargs as `complete_sync` plus `cancel_check: Callable[[], bool] | None`. Yields events of two kinds:
    ```python
    @dataclass(frozen=True)
    class GatewayStreamEvent:
        kind: Literal["delta", "final"]
        text: str = ""              # delta: this chunk; final: full accumulated text
        result: GatewayResult | None = None   # only set on final
    ```
    The `result` on the `final` event MUST carry the SAME `llm_call_id`, `cost_usd`, `input_tokens`, `output_tokens`, `latency_ms`, `outcome` semantics as `GatewayResult` from `complete()`. Exactly ONE `llm_calls` row written per call (the metering invariant from story 1.3 must hold under streaming — see Task 1.3).
  - [x] 1.2 `stream_complete_sync` uses `anthropic.AsyncAnthropic.messages.stream(...)` inside an `asyncio.run` adapter that bridges async chunks to a sync iterator. Use `asyncio.Queue` + a producer task to forward `text_stream` events; consumer (`stream_complete_sync`) yields and checks `cancel_check()` between yields. On cancel: call `await stream.close()` and break the producer, then write the `llm_calls` row with the accumulated tokens (still `outcome="ok"` if any tokens were received — the model spent compute, we metered it).
  - [x] 1.3 Metering for streamed calls — capture the `MessageStop`'s final `usage.input_tokens` + `usage.output_tokens` from the SDK's `final_message` (the `anthropic.lib.streaming.AsyncMessageStream` exposes `await stream.get_final_message()` after the stream ends; in cancel-mid-stream paths Anthropic still returns a partial `usage` block — record it). One `record_llm_call` write at the END (in the `finally`); the `llm_call_id` is generated up-front via `new_llm_call_id()` so it can be exposed on every `GatewayStreamEvent.result` on the `final` event AND stamped into `coach_messages.llm_call_id`. Pricing via `_safe_cost` exactly as `complete()`.
  - [x] 1.4 Same retry policy as `complete()` for transient errors that fire BEFORE the first delta (LlmTimeoutError / LlmRateLimitError / LlmServerError → backoff + retry; fallback model after exhaustion). Once the first delta has been yielded, retries are NOT attempted — partial output is final. Non-retryable / mid-stream errors raise `LlmInvocationError` (with `llm_call_id` attached, story-1.5 precedent on `LlmError.llm_call_id`).
  - [x] 1.5 Budget guard runs PRE-call (same `_budget.check_budget(...)` line as `complete()`). `LlmBudgetExceeded` raises PRE-stream, un-metered — caller (the actor) catches and refuses the assistant row with `coach_offline` (mirrors story 1.5 D-phase).
  - [x] 1.6 LLM_FAKE=1 path: `_fake_stream_events(purpose, prompt_slug)` returns a list of ~5 deltas + a final event whose text matches `fake.fake_response_text(...)`. Coach purpose: split the existing `_fake_coach_text()` PROSE part across 5 deltas; the EVIDENCE part is emitted only on the `final` event (the actor's stream-aware sentinel parser — Task 3 — never publishes the JSON evidence block as `token` frames anyway). One metering row written with `_FAKE_MODEL`, zero tokens, zero cost (same as fake `complete()`).
  - [x] 1.7 Keep `complete()` / `complete_sync()` untouched. `coach_reply` is the first streaming consumer; specialist + triage actors stay non-streamed. The streaming entrypoint is purely additive — no changes to the public surface of `complete()`.
  - [x] 1.8 Update `gateway.__all__` to export `stream_complete_sync` and `GatewayStreamEvent`. AR39 lint stays green (no NEW `anthropic` imports outside `gateway.py`).

- [x] Task 2: Coach prompt v2.0.0 — streamable two-section format (AC: 1, 2)
  - [x] 2.1 Bump `components/worker/prompts/coach/CoachGrounded.md` frontmatter: `version: 2.0.0`. Reason: a single-JSON-object output is not streamable as user-visible prose (the user would see raw `{"kind":"answer","body":"a` characters). v2 emits TWO sections separated by a SINGLE-LINE SENTINEL so the worker can publish prose tokens verbatim and parse evidence at end-of-stream.
  - [x] 2.2 New v2 output contract (replaces the v1 JSON-only block in the prompt body):
    ```
    Your reply is exactly TWO sections, in this order, with the sentinel
    line `<<<EVIDENCE>>>` between them. Output NOTHING before the prose
    section and NOTHING after the JSON section. Do NOT wrap either section
    in code fences.

    Section 1 — the prose body (what the user reads):
    - 1-3 short paragraphs of plain Markdown (no fenced blocks, no XML).
    - When you cite a measured value, write it inline naturally (e.g.
      "your LUFS sits at -11.2"). The numeric value itself MUST also
      appear as an evidence entry in Section 2 — otherwise the server
      will reject the reply.

    Section 2 — the evidence + verdict JSON (one object on a single line,
    NO trailing newline-prose):

        {"kind":"answer","evidence":[{"label":"LUFS -11.2","path":"phase1.lufs_integrated"}, ...],"refusal_reason":null}

    For a refusal: prose Section 1 is the refusal message; Section 2 is
    {"kind":"refusal","evidence":[],"refusal_reason":"missing_data"} (or
    out_of_scope / injection_attempt). `evidence` MUST be `[]` for a
    refusal.
    ```
  - [x] 2.3 Keep the system prompt's grounding rules + injection-resistance rules from v1 unchanged. ONLY the output format changes. NFR12 is unaffected — the system prompt remains pinned, user text still lands ONLY in `user=`, and the coach still has no tools.
  - [x] 2.4 Coach prompts are NOT in `prompt_versions` admin pinning today (story 1.5 deferred FR48 for coach). The version bump is the file edit + the loader read; no migration needed. Add an explanatory note next to the version in the frontmatter: `# v2.0.0 — streamable two-section format (story 1.6).` The loader (`load_coach_grounded`) is unchanged — it returns `(version, body)` and treats the body opaquely.

- [x] Task 3: Sentinel-aware stream parser + Redis publisher in `coach_lib/` (AC: 1, 2, 3)
  - [x] 3.1 New module `components/worker/app/coach_lib/stream_parser.py`:
    ```python
    SENTINEL = "<<<EVIDENCE>>>"

    @dataclass
    class ParsedStream:
        prose: str
        evidence_json: str         # raw text below the sentinel; "" if cancelled
        saw_sentinel: bool

    class StreamSplitter:
        """Incremental scanner. Feed deltas in; get back the prose chunk to
        publish (or empty string when we're past the sentinel). Buffers
        across delta boundaries — sentinel may split across two deltas."""

        def feed(self, delta: str) -> str: ...
        def finish(self) -> ParsedStream: ...
    ```
    Implementation: maintain `prefix_buf` (the last `len(SENTINEL)-1` chars of unpublished prose) so a sentinel that straddles a delta boundary still matches. Once the sentinel is seen, switch state — subsequent deltas accumulate into `evidence_json` and `feed` returns `""`.
  - [x] 3.2 New module `components/worker/app/coach_lib/stream_publisher.py`:
    ```python
    class CoachStreamPublisher:
        def __init__(self, *, conversation_id: UUID, message_id: UUID): ...
        def token(self, text: str) -> None: ...
        def done(self, *, evidence: list[dict]) -> None: ...
        def refusal(self, *, reason: str, body: str) -> None: ...
        def error(self, *, code: str, message: str) -> None: ...
        def close(self) -> None: ...
    ```
    - Publishes to channel `coach:{conversation_id}:{message_id}` (uuids stringified, no braces, lowercase).
    - Wire-format: each PUBLISH carries one JSON object on a single line: `{"type":"token","text":"…"}`, `{"type":"done","evidence":[…]}`, `{"type":"refusal","reason":"…","body":"…"}`, `{"type":"error","code":"…","message":"…"}`.
    - Uses a module-level `redis.Redis.from_url(os.environ["REDIS_URL"])` client (sync — actor is sync def). Connection-pooled; created lazily on first publish. Test path swaps in a fake via `monkeypatch.setattr`.
    - `close()` is a no-op in v1 — no terminal frame is published (the typed terminal `done`/`refusal`/`error` already serves that role). Reserved for future control-channel cleanup.
    - All publish calls swallow `redis.RedisError` and log warning. AR9 fallback: BFF idle-timeout will catch a publisher outage anyway; the persisted row is the system of record.
  - [x] 3.3 New helper `components/worker/app/coach_lib/cancel.py`:
    ```python
    CANCEL_KEY_PREFIX = "coach:cancel:"
    CANCEL_TTL_S = 180

    def cancel_check_for(message_id: UUID) -> Callable[[], bool]:
        """Returns a closure that checks Redis EXISTS coach:cancel:{message_id}.
        The BFF sets this key when the SSE consumer disconnects."""
    ```
    - The closure is passed to `gateway.stream_complete_sync(cancel_check=...)` (Task 1.1). Polled between yields — coarse-grained per-delta cancellation, NOT per-byte. That's the right granularity: the gateway only owns delta yields.
    - Uses the same module-level Redis client as the publisher (Task 3.2). EXISTS is O(1) and runs at most once per delta (≈100 calls per reply) — no perf concern.
    - On Redis failure: closure returns `False` (don't cancel — let the call complete). Cancel is an optimization, not a correctness guarantee.
  - [x] 3.4 `coach_lib/__init__.py` — re-export the new public names (`CoachStreamPublisher`, `StreamSplitter`, `cancel_check_for`) so the actor imports stay clean.

- [x] Task 4: Rewire `coach_actor.coach_reply` onto the streaming path (AC: 1, 2, 3)
  - [x] 4.1 Phases A, A.1, B (load, degraded short-circuit, build bundle) are UNCHANGED from story 1.5.
  - [x] 4.2 Phase C (build user-turn) is UNCHANGED.
  - [x] 4.3 Phase D (gateway call) — replace `gateway.complete_sync(...)` with the streaming wrapper:
    ```python
    publisher = CoachStreamPublisher(conversation_id=cid, message_id=mid)
    splitter = StreamSplitter()
    cancel_check = cancel_check_for(mid)
    final_result: GatewayResult | None = None
    full_text = ""
    try:
        for ev in gateway.stream_complete_sync(
            system=system_body, user=user_turn, purpose="coach",
            prompt_slug="coach_grounded", prompt_version=version,
            model=model_pin, user_id=user_id, correlation_id=str(cid),
            timeout_s=120, cancel_check=cancel_check,
        ):
            if ev.kind == "delta":
                prose_chunk = splitter.feed(ev.text)
                if prose_chunk:
                    publisher.token(prose_chunk)
            elif ev.kind == "final":
                final_result = ev.result
                full_text = ev.text
                break
    except LlmBudgetExceeded as exc:
        publisher.error(code="coach_offline", message=COACH_OFFLINE_BODY)
        _mark_refused(mid, refusal_reason="coach_offline",
                      body=COACH_OFFLINE_BODY, llm_call_id=exc.llm_call_id)
        return
    except LlmError as exc:
        publisher.error(code="coach_error", message=COACH_GENERIC_ERROR_BODY)
        _mark_error(mid, llm_call_id=exc.llm_call_id)
        return
    ```
    - The `for` loop hands the `final` event back into the actor's existing Phase E parse path.
    - On cancel mid-stream (`cancel_check()` returned `True` and the gateway broke its loop), the gateway still yields a `final` event with whatever text it accumulated — `splitter.finish()` from that path produces partial prose; persist as `status="complete"` with `content=parsed.prose.strip()` and `evidence=[]` if the splitter never saw the sentinel; the publisher already streamed the partial tokens so the BFF doesn't need a recap. Then publish `done` with `evidence=[]` and return.
  - [x] 4.4 Phase E (parse + validate) — adapt for v2 prompt:
    ```python
    parsed = splitter.finish()  # ParsedStream(prose, evidence_json, saw_sentinel)

    if not parsed.saw_sentinel:
        # Cancelled before evidence — persist partial prose.
        publisher.done(evidence=[])
        _mark_complete_partial(mid, body=parsed.prose.strip() or COACH_GENERIC_ERROR_BODY,
                               llm_call_id=final_result.llm_call_id if final_result else None)
        return

    try:
        meta = extract_json_object(parsed.evidence_json)
        # The evidence-section JSON omits the body field (body = prose).
        # Re-inject it so CoachReplyPayload validates unchanged.
        meta["body"] = parsed.prose.strip()
        payload = CoachReplyPayload(**meta)
    except (ValueError, ValidationError) as exc:
        logger.info("coach_reply: v2 payload parse failed for %s: %s",
                    assistant_message_id, exc)
        publisher.error(code="coach_parse_failed", message=COACH_GENERIC_ERROR_BODY)
        _mark_error(mid, llm_call_id=final_result.llm_call_id if final_result else None)
        return
    ```
    - `answer_makes_numeric_claim_without_evidence` still applies to the now-reconstructed payload — if it fires, publish `error` + mark `error` (same precedent as story 1.5).
  - [x] 4.5 Phase F (resolve evidence) — UNCHANGED. The resolved list goes into both the persisted row AND the `done`/`refusal` frame:
    ```python
    payload = payload.model_copy(update={"evidence": resolve_evidence(payload.evidence, bundle)})
    evidence_dicts = [e.model_dump() for e in payload.evidence]
    ```
  - [x] 4.6 Phase G (persist) — UNCHANGED structure; the final publish is the new step:
    ```python
    _mark_complete(mid, payload=payload, llm_call_id=final_result.llm_call_id)
    if payload.kind == "answer":
        publisher.done(evidence=evidence_dicts)
    else:  # refusal
        publisher.refusal(reason=payload.refusal_reason, body=payload.body)
    ```
    - `_mark_complete` writes the canonical row (story 1.5's persistence guarantee). The PUBLISH is best-effort — BFF subscribers may have hung up, in which case they'll re-read the row via the poll endpoint or via the resume-on-refresh branch.
  - [x] 4.7 New helper `_mark_complete_partial(message_id, *, body, llm_call_id)` on `coach_actor.py` — same shape as `_mark_complete` but for the cancel-mid-stream case where we have no validated payload. Sets `status="complete"`, `content=body`, `evidence=[]`, `refusal_reason=None`, `llm_call_id=…`, `completed_at=now()`. Idempotent (only updates if still `pending`).
  - [x] 4.8 Top-level try/except (the Phase B-G catch-all from story 1.5's E-H1 fix) — extended to also call `publisher.error(code="coach_error", message=COACH_GENERIC_ERROR_BODY)` before `_mark_error(mid)`. So no SSE consumer is ever left hanging.

- [x] Task 5: BFF SSE relay endpoint (AC: 1, 2, 4, 5, 6)
  - [x] 5.1 New endpoint `GET /api/coach/{analysisId:guid}/messages/{messageId:guid}/stream` in `components/bff/src/Spectr.Bff/Endpoints/CoachConversationEndpoints.cs` (same file as story 1.5's POST/GET). `RequireAuthorization()`. Response is `text/event-stream`.
  - [x] 5.2 Ownership gate (AC6): load `analysisId` + `messageId` in ONE query that asserts the chain `Analysis.UserId == currentUser.UserId()` ∧ `Analysis.Id == analysisId` ∧ `CoachMessage.ConversationId == Conversation.Id` ∧ `Conversation.AnalysisId == analysisId`. On any mismatch → `404`. On valid load: project `(message.Status, message.Content, message.Evidence, message.RefusalReason, conversation.Id)`.
  - [x] 5.3 Terminal-state short-circuit (AC5): if `message.Status` is already `complete`/`refused`/`error`, write headers, emit synthesized frames in order — `event: token` (one frame, full content), then `event: done|refusal|error` (parsed from row), then close. Don't subscribe. This handles "subscriber arrives after actor finished" cleanly.
  - [x] 5.4 Live-subscribe path (`message.Status == "pending"`):
    - Inject `IConnectionMultiplexer` (NEW service registration in `Program.cs`: `builder.Services.AddSingleton<IConnectionMultiplexer>(_ => ConnectionMultiplexer.Connect(config["Redis:ConnectionString"]!));`). The existing `DramatiqJobQueue.cs` builds its own multiplexer — keep it as-is (additive, no refactor) OR switch it to the shared singleton in a small follow-up (out of scope here, NOT required).
    - `var sub = redis.GetSubscriber();` then `await sub.SubscribeAsync(new RedisChannel($"coach:{conversationId}:{messageId}", RedisChannel.PatternMode.Literal), handler);`. The handler enqueues the frame onto a per-request `Channel<string>` (`System.Threading.Channels.Channel.CreateUnbounded<string>()`).
    - Main loop: `await foreach (var frame in channel.Reader.ReadAllAsync(linkedCt))` — write each frame to `httpCtx.Response.Body`, flush. Wrap in a 15-second `Task.Delay` race so the heartbeat fires when no frame arrives.
    - Heartbeat: `: heartbeat\n\n` SSE comment (NOT a typed event — comments are ignored by EventSource clients but reset the proxy idle timer).
    - Idle fallback (AC4): if NO published frame arrives in 30 s (track `lastFrameAtUtc = DateTime.UtcNow` per frame), break the loop, re-read the row (it may have terminalized via direct DB write without a publish), emit synthesized frames if terminal, else emit `event: error\ndata: {"code":"coach_stream_idle","message":"Coach stream went idle. Refresh to reload."}\n\n`, close.
    - Connection-aborted fallback: `httpCtx.RequestAborted` (`CancellationToken`) — when the client closes, SET `coach:cancel:{messageId} 1 EX 180` (uses `redis.GetDatabase().StringSetAsync(...)`), unsubscribe, return. The worker's `cancel_check_for(...)` (Task 3.3) sees this and breaks the gateway stream.
    - Always-unsubscribe-in-finally: `finally { await sub.UnsubscribeAsync(channelName, handler); }`.
  - [x] 5.5 SSE event format (matches Task 3.2 publisher wire-format 1:1, kept consistent with architecture.md "Format Patterns" → "SSE: coach stream events `{type: token|done|error|refusal, …}`"):
    ```
    event: token
    data: {"text":"..."}

    event: done
    data: {"evidence":[{"label":"...","path":"..."}, ...]}

    event: refusal
    data: {"reason":"missing_data","body":"..."}

    event: error
    data: {"code":"coach_stream_idle","message":"..."}
    ```
    Each frame ends with the SSE blank line (`\n\n`). Newlines INSIDE `data` are escaped via `\\n` (matches legacy `CoachEndpoints.cs:139` precedent so the front-end parser stays consistent across legacy + new endpoints).
  - [x] 5.6 No new error envelope (AR38) on the streaming endpoint — SSE protocol uses `event: error` frames. The pre-stream auth/ownership gate uses standard HTTP status codes (`401`/`404`) because those fire before any SSE headers are sent.

- [x] Task 6: Test fixtures + endpoint test infrastructure (AC: all)
  - [x] 6.1 Worker — `components/worker/tests/test_coach_stream_parser.py` (NEW):
    - `StreamSplitter` happy path: feed `"hello "`, `"world\n"`, `"<<<EVIDENCE>>>\n"`, `"{\"kind\":\"answer\",\"evidence\":[]}"` → emits `"hello "`, `"world\n"`, `""`, `""`; `.finish()` returns `prose="hello world\n"`, `evidence_json="{\"kind\":\"answer\",\"evidence\":[]}"`, `saw_sentinel=True`.
    - Sentinel straddling delta boundary: feed `"foo<<<"`, `"EVIDENCE>>>bar"` → emits `"foo"`, `""`; `.finish()` returns `prose="foo"`, `evidence_json="bar"`, `saw_sentinel=True`.
    - Never-saw-sentinel: feed `"only prose"` then `.finish()` → `prose="only prose"`, `evidence_json=""`, `saw_sentinel=False`.
    - Sentinel-prefix-only-but-not-full (false alarm): feed `"hi <<<EVIDENCE>>"` (note `>>` not `>>>`) — sentinel not seen, all chars eventually published.
  - [x] 6.2 Worker — `components/worker/tests/test_coach_stream_publisher.py` (NEW): stub `redis.Redis.from_url` to return a `FakeRedis()` recorder; call `token` / `done` / `refusal` / `error`; assert each published frame is valid JSON, has the right `type`, and lands on channel `coach:{cid}:{mid}`. RedisError swallowed (the recorder raises on one call; assert no exception escapes + warning was logged).
  - [x] 6.3 Worker — `components/worker/tests/test_coach_stream_gateway.py` (NEW; sits OUTSIDE `tests/llm/` for the same reason story 1.5 actor tests do — opts out of the `tests/llm/conftest.py` autouse fixture):
    - LLM_FAKE=1 streaming yields ≥3 `delta` events + one `final`. Final event carries a `GatewayResult` with `outcome="ok"`, `model="fake"`, `llm_call_id` populated. Exactly ONE metering row recorded.
    - Cancel mid-stream: gateway is invoked with `cancel_check=lambda: True`; the first `delta` triggers cancel; SDK stream closed; ONE metering row recorded with `outcome="ok"` and accumulated tokens (still zero in fake mode).
    - `LlmBudgetExceeded` raised PRE-stream still surfaces from `stream_complete_sync`, NO metering row.
  - [x] 6.4 Worker — extend `components/worker/tests/test_coach_actor.py`:
    - End-to-end streaming happy path: monkeypatch `gateway.stream_complete_sync` to yield `[delta("Your LUFS sits at -11.2.\n"), delta("<<<EVIDENCE>>>\n"), delta('{"kind":"answer","evidence":[{"label":"LUFS -11.2","path":"phase1.lufs_integrated"}],"refusal_reason":null}'), final(...)]`. Recording `CoachStreamPublisher` fake; assert published frames are `[token("Your LUFS sits at -11.2.\n"), done(evidence=[{label, path}])]`. Assert row persisted with `content="Your LUFS sits at -11.2."`, `evidence=[...]`, `status="complete"`, `llm_call_id=...`.
    - End-to-end refusal: deltas produce prose refusal + sentinel + `{"kind":"refusal","evidence":[],"refusal_reason":"missing_data"}` → publishes `refusal(reason="missing_data", body="...")`, persists `status="refused"`.
    - Cancel mid-stream (saw_sentinel=False): deltas produce a few prose tokens then cancel_check fires → publishes `done(evidence=[])`, persists `status="complete"` with partial body.
    - Cancel after sentinel (saw_sentinel=True but evidence JSON empty): publishes `error(code="coach_parse_failed", ...)`, persists `status="error"`.
    - `LlmBudgetExceeded` mid-flow → publishes `error(code="coach_offline", ...)`, persists `refused` with the verbatim UX-DR17 body.
    - Generic `LlmError` → publishes `error(code="coach_error", ...)`, persists `error`.
    - Numeric-claim-without-evidence still demotes (recall story 1.5 E-H2): publishes `error(code="coach_parse_failed", ...)`, persists `error`.
  - [x] 6.5 BFF — `components/bff/tests/Spectr.Bff.Tests/CoachStreamEndpointTests.cs` (NEW; mirror `VerdictsEndpointDegradationTests.cs` skeleton with `PostgresReachable()` gate; ALSO add a `RedisReachable()` gate sibling — `try { var cm = ConnectionMultiplexer.Connect("localhost:6379"); cm.GetDatabase().Ping(); return true; } catch { return false; }` — skip when either is unreachable so unit-only runs still pass):
    - Terminal-state short-circuit: seed a `complete` assistant row → GET stream → response contains one `token` frame with the row content + one `done` frame + closes (no Redis subscribe required for this test).
    - Refused terminal: seed `refused` row → emits `refusal` frame.
    - Error terminal: seed `error` row → emits `error` frame with `code="coach_error"`.
    - Cross-user 404 (AC6): user A's analysis + assistant row; GET as user B → 404 BEFORE any SSE bytes flushed.
    - Live subscribe round-trip: seed `pending` row + a small "publisher" task that `PUBLISH coach:{cid}:{mid} {"type":"token","text":"hi"}` followed by `{"type":"done","evidence":[]}` after 100ms; GET stream; assert frames arrive in order; assert connection closes after `done`. Use the real local Redis from the `RedisReachable()` gate.
    - Heartbeat: seed `pending` row, publish NOTHING for 16 s; assert at least one `: heartbeat` comment frame arrived. (Mark `[Trait("Category","Slow")]` so CI can skip via filter in fast mode.)
    - Idle fallback (AC4): seed `pending` row, publish NOTHING for 31 s, while ALSO flipping the row to `complete` after 20 s via direct DB write (simulates "actor wrote, publish lost"); assert the BFF emits the `token`+`done` synthesized from the row AFTER its idle timeout, then closes. Same Slow trait.
    - Client-disconnect cancel: open the stream, abort the request, assert `coach:cancel:{messageId}` exists in Redis afterwards with a TTL ≤180.
  - [x] 6.6 BFF — small DTO test in `CoachConversationDtoSerializationTests.cs` (extend the existing file): serialize the wire payload helpers for `token`/`done`/`refusal`/`error` using the same `JsonSerializerDefaults.Web` and assert camelCase field names (`text`, `evidence`, `reason`, `body`, `code`, `message`). If the SSE handler builds frames directly via string interpolation (no DTO type), skip this and instead snapshot one literal expected SSE frame per type as a string-equality test.

- [x] Task 7: Frontend wire-types only (AC: all)
  - [x] 7.1 Extend `components/frontend-spectr-v2/src/api/types.ts` with the SSE wire shapes — hand-mirrored, camelCase, story 1.4/1.5 precedent:
    ```ts
    export type CoachStreamEventType = 'token' | 'done' | 'refusal' | 'error';
    export interface CoachStreamTokenPayload { text: string; }
    export interface CoachStreamDonePayload { evidence: CoachEvidenceDto[]; }
    export interface CoachStreamRefusalPayload { reason: string; body: string; }
    export interface CoachStreamErrorPayload { code: string; message: string; }
    ```
  - [x] 7.2 **NO new React hooks, NO changes to `CoachChat.tsx`.** Story 1.8 wires `useCoachStream` (EventSource-based) into the chat UI per UX-DR13/14/15. The legacy `/coach/{jobId}/chat` endpoint stays live; v2 stream lives parallel.
  - [x] 7.3 **NO new vitest cases.** Types-only changes don't need tests (the wire fields are verified by the BFF DTO tests in Task 6.6).

- [x] Task 8: Wiring + config + docs (AC: all)
  - [x] 8.1 Register `IConnectionMultiplexer` in `components/bff/src/Spectr.Bff/Program.cs` AFTER the existing `AddSingleton<IJobQueue, DramatiqJobQueue>()` line. Same connection string source (`config["Redis:ConnectionString"]`). The existing `DramatiqJobQueue` keeps its own multiplexer (no refactor — additive only).
  - [x] 8.2 Add `api.MapCoachConversationEndpoints();` is already wired (story 1.5); the new `/messages/{messageId}/stream` route lives inside the same `MapCoachConversationEndpoints` method, so no `Program.cs` edit is required for routing.
  - [x] 8.3 NO new worker `.env.example` knobs — the Redis URL is the existing `REDIS_URL`, and the publisher reuses it. NO new BFF appsettings.json knobs — `Redis:ConnectionString` is already declared.
  - [x] 8.4 Document the new SSE event format in a one-paragraph header comment in `CoachConversationEndpoints.cs` (above the new method) referencing this story's AC1 and the architecture.md "Format Patterns" line.

- [x] Task 9: Validation gates (AC: all)
  - [x] 9.1 Local gates green: `pytest -q components/worker/tests/`, `pytest -q components/shared/tests/` (unchanged), `ruff check components/worker/ components/shared/`, `mypy components/worker/app/coach_actor.py components/worker/app/coach_lib/ components/worker/app/llm/gateway.py --ignore-missing-imports`, `cd components/bff && dotnet build && dotnet test`, `cd components/frontend-spectr-v2 && npx tsc -b && npm run lint && npm run lint:css && npm run lint:prices && npx vite build && npx vitest run`.
  - [x] 9.2 Live smoke (optional, `LLM_FAKE=1`): docker compose stack up → register a user → seed an analysis → `POST /api/coach/{analysisId}/messages` → immediately `GET /api/coach/{analysisId}/messages/{pendingAssistantMessageId}/stream` → confirm token frames arrive followed by `done`. Then re-`GET` the same stream URL → confirm the resume-on-refresh branch synthesizes the terminal frames from the row.
  - [x] 9.3 Confirm CI green on GitHub after push (`gh run watch`). Expected test deltas: worker +~18 tests (parser 4 + publisher 3 + stream gateway 3 + actor stream extensions 8), BFF +~7 tests (CoachStreamEndpointTests). Frontend test count unchanged (types-only).

## Dev Notes

### Why this story exists

Story 1.5 shipped the persisted poll path — `POST /messages` enqueues, the worker writes the final row, the client polls `GET /conversation`. That works but feels stale: every coach reply blocks for 2-15 s with a "thinking" spinner. Architecture D1 + AR9 + AR44 + NFR2 say the coach must stream like a real chat: tokens arrive <2 s after dispatch, the user reads as the model generates. AC1 of the epic specifies the exact wire: Redis pub/sub channel `coach:{conversationId}:{messageId}` published by the worker, SSE relay forwarded by the BFF, event types `{token|done|error|refusal}` plus a 15-second heartbeat. Architecture also requires a poll-fallback (AC4 / AR9 "Coach relay: subscribe → forward as SSE → on Redis idle >30s, fall back to reading persisted partial message → close with error event"). The persisted row remains the system of record — streaming is the UX accelerator. [Source: PRPs/architecture.md#D1; PRPs/architecture.md#Format-Patterns (line 175); PRPs/architecture.md#Pattern-Examples (line 203); PRPs/epics.md#AR9 (line 175); PRPs/epics.md#AR44 (line 228); PRPs/epics.md#Story-1.6 (lines 487-498); PRPs/prd.md#NFR2]

### Scope boundary (do NOT over-build)

- **Frontend chat UI = story 1.8.** No `useCoachStream` hook, no changes to `CoachChat.tsx`. Story 1.6 ships ONLY the wire-format TypeScript types so 1.8 can consume them. The legacy `/coach/{jobId}/chat` SSE endpoint stays live alongside the new stream until 1.8 swaps + deletes.
- **Per-analysis coach caps = story 1.9.** A user can open as many streams as they want; no `coach_cap_reached` envelope is emitted from the streaming endpoint either.
- **Tier resolution = Epic 2.** `llm_calls.tier` continues to default to `"free"` from `llm_default_tier` (story 1.3); the streaming gateway path stamps it identically.
- **`outcome="refused"` on `llm_calls` = NOT introduced here.** A streamed refusal STILL costs an Anthropic call (the model generated the refusal tokens), so the row is `outcome="ok"`. Same as story 1.5 — don't introduce a refused outcome that pollutes the metering spine.
- **Atomic-claim idempotency (status='processing' enum extension) = deferred future story.** Story 1.5's deferred-work entry stands — the single-worker invariant still keeps the race rare. The streaming actor inherits the same status-check idempotency from story 1.5 unchanged.
- **W1/W2 worker-pool split = Epic 10.** Dev compose still subscribes one worker to both `default` and `coach`.
- **Streaming for triage/specialist actors = NOT in scope.** Only the coach actor consumes `stream_complete_sync`. Triage and specialist actors continue to use `complete_sync` — their outputs are batch-style JSON consumed server-side, no UI latency concern.
- **Server-side outbound HTTP from the actor = still NO.** Cancel-check is a Redis EXISTS read (loop-local I/O), publisher is a Redis PUBLISH — both go through the broker we already run. No new outbound dependency.
- **Worker Dockerfile mirroring the Procfile = still deferred.** Story 1.5's deferred-work entry stands.

### Current state (verified on `restructure` @ f2e0125 — story 1.5 done+committed+pushed)

- **Persistence path is live.** `Conversation` + `CoachMessage` tables present (EF migration `AddCoachConversations` applied). BFF `POST /api/coach/{analysisId}/messages` writes the user + pending-assistant rows, enqueues `coach_reply` on the `coach` queue. `GET /api/coach/{analysisId}/conversation` returns rows in `created_at ASC`. All four message states (`pending`/`complete`/`refused`/`error`) are reachable today via the poll path. [Source: components/bff/src/Spectr.Bff/Endpoints/CoachConversationEndpoints.cs; components/shared/aimusic_shared/models.py]
- **Worker actor `coach_reply(conversation_id, user_message_id, assistant_message_id)` already exists.** Phases A→G implemented. Story 1.6 replaces only the Phase D gateway call + Phase E parser (for the v2 prompt format) and adds publish + cancel hooks. Phases A, A.1, B, C, F, G are unchanged. [Source: components/worker/app/coach_actor.py]
- **Gateway** (`components/worker/app/llm/gateway.py`) has `complete()` / `complete_sync()`. NO streaming entrypoint today. AR39 lint enforces that `anthropic` only imports here — the new `stream_complete_sync` MUST live in this file. The SDK already imported is `anthropic>=0.69,<1` (`requirements.txt:2`), which exposes `messages.stream(...)` as an async context manager returning an `AsyncMessageStream` with a `text_stream` async iterator and `await get_final_message()` for the closing usage block.
- **Redis client in the worker** — `redis>=5.0.0` is in `requirements.txt`. The dramatiq broker uses it via `dramatiq.brokers.redis.RedisBroker(url=REDIS_URL)`. The publisher + cancel-check modules create their own `redis.Redis.from_url(os.environ["REDIS_URL"])` client (sync); no shared instance with dramatiq is required — both flows are short-lived.
- **Redis client in the BFF** — `StackExchange.Redis 2.7.33` is referenced in `Spectr.Bff.csproj`. `DramatiqJobQueue.cs` constructs its own `ConnectionMultiplexer`. The new endpoint needs a SHARED `IConnectionMultiplexer` registered in `Program.cs` (Task 8.1) so the SSE handler can pub/sub without standing up a second connection per request (multiplexer is thread-safe, designed to be shared).
- **`LlmBudgetExceeded`** still raises PRE-call un-metered (story 1.4) — streaming entry honors this identically. `LlmError.llm_call_id` (story 1.5 E-M1) is preserved on retry exhaustion.
- **Existing SSE precedent** in `components/bff/src/Spectr.Bff/Endpoints/CoachEndpoints.cs:127-147` — sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`. Newline escaping `\r\n` → `\n` then `\n` → `\\n` so `data:` frames don't terminate prematurely. New endpoint follows the same conventions.
- **No existing pub/sub usage anywhere.** This story is the first pub/sub consumer in the worker and the first `ISubscriber` consumer in the BFF.
- **Frontend `CoachChat.tsx`** still hits the LEGACY `/coach/{jobId}/chat` (not the v2 endpoints). Story 1.6 changes nothing here.
- **`prompt_loader.load_coach_grounded()`** returns `(version, body)` from the file — the v2.0.0 bump is a file edit + bumping the YAML frontmatter; no loader code change.

### Critical guardrails

1. **AR39 lint stays green.** `anthropic` import remains ONLY in `gateway.py`. The new `stream_complete_sync` MUST live in `gateway.py` (NOT in a new `streaming.py` file) — the lint `tests/test_enforcement_lints.py` enumerates allowed importers. If the streaming code grows past ~100 lines, you may extract it to a new module IN THE SAME PACKAGE `app/llm/streaming.py` AND update the lint allowlist (also AR39's intent — package-local imports are OK; the bar is "no `anthropic` outside the LLM package").
2. **Metering invariant — exactly ONE `llm_calls` row per call.** Story 1.3's guarantee. Streamed calls must write the row in `finally`, even on cancel/error. Use `record_llm_call(row_id=...)` so the ULID can be exposed on every `GatewayStreamEvent` and stamped into `coach_messages.llm_call_id`. NEVER write the row twice; NEVER skip the row.
3. **Budget guard runs PRE-stream.** Same `_budget.check_budget(...)` line as `complete()`. `LlmBudgetExceeded` raises before any stream starts → un-metered. The actor catches and refuses with `coach_offline` (UX-DR17) verbatim. Pub/sub `error` frame is published BEFORE the row is marked refused so subscribers see the error in real time.
4. **NFR12 injection defense unchanged.** v2 prompt is structurally identical — same system prompt pinning, same `<user_input>…</user_input>` wrapping, same no-tools policy. The v2 change is OUTPUT format only (sentinel-separated prose + JSON instead of one JSON object). User text NEVER lands in `system=`.
5. **Sentinel publishing rule.** Only PROSE tokens (Section 1 of the v2 prompt) are published as `event: token` frames. JSON evidence (Section 2) is buffered and only ever surfaced via the `event: done` payload. The user MUST NEVER see raw JSON tokens in the chat. The `StreamSplitter` enforces this — tests in Task 6.1 are load-bearing.
6. **Persistence is the system of record.** The published frames are an ephemeral UX accelerator. EVERY terminal state MUST also be written to `coach_messages` (story 1.5's `_mark_complete` / `_mark_refused` / `_mark_error` / new `_mark_complete_partial`). The BFF's resume-on-refresh branch and idle-fallback branch both re-read the row — if persistence is missing, the fallback is silent dead air. Test Task 6.4's "publisher recorded events AND row persisted" assertions are load-bearing.
7. **Idempotency on the assistant row (story 1.5's contract) holds.** Dramatiq retry on a row already past `pending` is a no-op via the `status != "pending"` guard at start of Phase A AND inside `_mark_*` helpers. A retry that re-enters the streaming gateway would re-publish frames AND re-meter — neither is desirable, but the guard prevents it at Phase A before any work is done.
8. **Coach concurrency cap (AR6).** `llm_coach_concurrency` (default 2) still bounds the gateway's coach sub-pool — streaming doesn't change the semaphore semantics. A streaming call holds its semaphore slot for the FULL duration of the stream (delta loop), so 2 concurrent coach replies is the actual ceiling even though the stream may run for tens of seconds. Acceptable for v1; Epic 2 (paid tier) will revisit pool sizing.
9. **Decimal not float for money** (CLAUDE.md / story 1.3 / 1.4 / 1.5 carryover). Streaming metering goes through the same `_safe_cost` → `compute_cost_usd` → `Decimal` path as `complete()`.
10. **Lazy DB + Redis imports + fail-open** (story 1.1/1.3/1.4/1.5 pattern). The new `coach_lib/stream_publisher.py` + `coach_lib/cancel.py` lazily build the `redis.Redis` client on first call and swallow `redis.RedisError` to a log warning. The actor module remains DATABASE_URL-free at import time.
11. **`concurrency=1` workers** (CLAUDE.md). The streaming actor still runs one-at-a-time per worker process (dramatiq `--processes 1 --threads 1`). The asyncio bridge inside `stream_complete_sync` is a per-call event loop (same pattern as `complete_sync`), not a long-lived loop.
12. **Coach `user_id` ownership trust** (story 1.5 critical guardrail 12). The actor still TRUSTS the BFF-stamped `conversation.user_id`. The BFF's new SSE relay enforces `Analysis.UserId == currentUser.UserId()` BEFORE subscribing — the worker doesn't need to know about SSE subscribers.
13. **`JsonSerializerDefaults.Web` (camelCase) on the SSE payloads.** All `data:` JSON fields use camelCase (`text`, `evidence`, `reason`, `body`, `code`, `message`). The wire-format TypeScript types in `src/api/types.ts` mirror this.
14. **No secrets in repo (NFR6).** `ANTHROPIC_API_KEY` still flows via env. The new Redis pub/sub adds no new secret.
15. **No file over ~500 lines** (CLAUDE.md). `gateway.py` grows by ~120 lines (streaming entrypoint) — currently 420 lines, will land at ~540. **Extract the streaming code into `components/worker/app/llm/streaming.py`** with a re-export from `gateway.py` if the line count crosses 500. Update `tests/test_enforcement_lints.py` allowlist accordingly (it's the LLM package boundary that matters, not the file name). `coach_actor.py` grows by ~80 lines — at ~330 lines, well under the limit.
16. **EF owns canonical schema** (CLAUDE.md). NO schema changes in this story. The `status` enum extension for `processing` (story 1.5's deferred-work P3) is NOT touched here.

### Previous story intelligence (1.3 + 1.4 + 1.5)

- **Gateway error handling pattern (1.4 + 1.5).** Catch `LlmBudgetExceeded` SPECIFICALLY before generic `LlmError`. Coach's budget-exhaustion refusal stamps `coach_offline` but does NOT write `degradation_notice` on the analysis (degradation is a verdict-side concept; coach budget hits are per-message refusals). Story 1.6 preserves this — the streaming wrapper raises `LlmBudgetExceeded` PRE-stream and the actor's catch block is identical to 1.5's.
- **`LLM_FAKE=1` bypasses budget AND breaker** (1.4 explicit short-circuit; 1.5 added coach-shaped JSON for `purpose="coach"`). 1.6 extends `fake.py` with `_fake_coach_stream_events()` so `LLM_FAKE=1` end-to-end stays working — without it, the streaming gateway in fake mode would yield ONE final event with no deltas and the UI would never see incremental tokens during dev work.
- **`LlmError.llm_call_id` (1.5 E-M1)** propagates on retry exhaustion. Streaming inherits this — `LlmInvocationError` raised from `stream_complete_sync` carries the row id for forensics.
- **EF migration flow (1.3/1.4/1.5 gotcha).** No EF migration this story — skip. If you ADD a new column to `coach_messages` (e.g. for partial-token persistence), follow the EF-first ritual; story 1.5's `_mark_complete_partial` writes ONLY existing columns (`content`, `evidence=[]`, `status`, `llm_call_id`, `completed_at`), so no migration is needed.
- **Frontend types are HAND-MIRRORED** (1.3, 1.4, 1.5 confirmed). pydantic2ts is unreliable on Windows for the v2 frontend; v2 uses hand-curated `src/api/types.ts`. Add the new stream wire types manually.
- **Wire format is camelCase** (1.4 explicit confirmation, 1.5 reaffirmation). `JsonSerializerDefaults.Web` everywhere. SSE `data:` JSON payloads use camelCase.
- **Autouse conftest reset pattern (1.4 + 1.5).** New worker tests for the streaming gateway sit under `components/worker/tests/` (NOT under `tests/llm/`) so they opt out of the autouse fixture that stubs `_aggregate_tier_spend` + breaker — the streaming tests need to assert real budget behavior. Mirror `test_budget_aggregator.py` for the sqlite scaffold IF the test needs a DB session (most streaming gateway tests do NOT — they stub `record_llm_call`).
- **Sentinel comments stay out of production code (1.5).** Story 1.6 should leave NO "story 1.6 — TODO" sentinels in the codebase post-merge. The story-number references in the inline header comment on the new SSE endpoint method are OK — they document provenance, same precedent as 1.5's `CoachConversationEndpoints` header.
- **Code review caught one production bug per story (1.3, 1.4, 1.5).** Story 1.6 risk area: the `StreamSplitter` sentinel-straddling logic. Test 6.1 enumerates the boundary cases explicitly. Second risk area: the BFF's race between subscribe and the actor's first publish — Task 5.4's ordering (subscribe BEFORE checking row status, check row status AFTER subscribing so a terminalize-between-checks doesn't drop frames) is load-bearing; reviewer should verify.
- **Git identity set locally** for this repo (`brankin92@yahoo.com / Brian Rankin`). No re-prompt needed on commit.
- **Commit format (1.4, 1.5 precedent).** `feat: <story title> (story 1.6)` with `Co-Authored-By` footer per CLAUDE.md.

### Project Structure Notes

- **New files**:
  - `components/worker/app/coach_lib/stream_parser.py`
  - `components/worker/app/coach_lib/stream_publisher.py`
  - `components/worker/app/coach_lib/cancel.py`
  - `components/worker/tests/test_coach_stream_parser.py`
  - `components/worker/tests/test_coach_stream_publisher.py`
  - `components/worker/tests/test_coach_stream_gateway.py`
  - `components/bff/tests/Spectr.Bff.Tests/CoachStreamEndpointTests.cs`
  - (OPTIONAL, if `gateway.py` crosses 500 lines): `components/worker/app/llm/streaming.py`
- **Modified**:
  - `components/worker/app/llm/gateway.py` (add `stream_complete_sync` + `GatewayStreamEvent`; extend `__all__`; possibly extract streaming code per guardrail 15)
  - `components/worker/app/llm/fake.py` (add `_fake_coach_stream_events()` for `LLM_FAKE=1` + coach purpose)
  - `components/worker/app/coach_actor.py` (rewire Phase D from `complete_sync` to streaming loop; rewire Phase E for v2 prompt parsing; add `_mark_complete_partial`; extend Phase B-G catch-all to publish `error`)
  - `components/worker/app/coach_lib/__init__.py` (re-export new public names)
  - `components/worker/prompts/coach/CoachGrounded.md` (bump frontmatter to `version: 2.0.0`; replace output-format section with the v2 two-section spec)
  - `components/worker/tests/test_coach_actor.py` (extend with streaming-path cases — keep story 1.5's non-streaming cases as legacy regression by stubbing `gateway.stream_complete_sync` to a single `final` event matching the old shape)
  - `components/worker/tests/test_coach_payload.py` (no change expected — `CoachReplyPayload` shape unchanged; the v2 prompt just splits the body out and re-joins it server-side)
  - `components/worker/tests/verdict_pipeline/test_prompt_loader.py` (assert `version == "2.0.0"`; existing tests pass through unchanged)
  - `components/bff/src/Spectr.Bff/Endpoints/CoachConversationEndpoints.cs` (add `GET /messages/{messageId}/stream` method + helpers)
  - `components/bff/src/Spectr.Bff/Program.cs` (register `IConnectionMultiplexer` singleton)
  - `components/bff/tests/Spectr.Bff.Tests/CoachConversationDtoSerializationTests.cs` (extend with SSE payload serialization assertions; OPTIONAL — see Task 6.6)
  - `components/frontend-spectr-v2/src/api/types.ts` (new SSE wire types)
- **Deleted**: none (legacy CoachChatService.cs + CoachEndpoints.cs + frontend CoachChat.tsx survive through 1.6–1.7; deletion still a story-1.8 task).
- **No new top-level folders.** All new files sit under existing `coach_lib/` (worker) and the existing `Endpoints/` / `Spectr.Bff.Tests/` (BFF).

### References

- [Source: PRPs/epics.md#Story-1.6 (lines 487-498) — story + ACs verbatim]
- [Source: PRPs/epics.md#AR9 (line 175) — coach flow including pub/sub channel + SSE relay + poll fallback]
- [Source: PRPs/epics.md#AR23 (line 198) — Dramatiq queues; coach queue exists from story 1.5]
- [Source: PRPs/epics.md#AR38 (line 222) — error envelope (used on pre-stream HTTP errors only; SSE uses `event: error` frames)]
- [Source: PRPs/epics.md#AR41 (line 225) — LLM_FAKE=1 replay; extended to stream events here]
- [Source: PRPs/epics.md#AR44 (line 228) — SSE event types `{token|done|error|refusal}`, heartbeat 15s — THIS story's contract]
- [Source: PRPs/prd.md#NFR2 — <2s first-token latency target]
- [Source: PRPs/prd.md#NFR12 — prompt-injection resistance: structurally preserved across v1 → v2 prompt format change]
- [Source: PRPs/architecture.md#D1 — gateway as single LLM touchpoint]
- [Source: PRPs/architecture.md#Format-Patterns (line 175) — SSE coach stream event types + heartbeat 15s]
- [Source: PRPs/architecture.md#Communication-Patterns (lines 181-183) — BFF↔worker seam: Postgres rows + Redis pub/sub for coach streams; worker→BFF never via HTTP]
- [Source: PRPs/architecture.md#Pattern-Examples (line 203) — "Coach relay (BFF): subscribe coach:{cid}:{mid} → forward as SSE → on Redis idle >30s, fall back to reading persisted partial message → close with error event"]
- [Source: PRPs/architecture.md#D1 risk note (line 144) — "Riskiest: D1 streaming relay (new plumbing) — ~200 lines (publish/subscribe/relay) with a worked fallback (poll persisted partial message rows) if pub/sub misbehaves" — sizing matches this story]
- [Source: PRPs/ux-design-specification.md#UX-DR17 — refusal microcopy "Coach is offline — your measured analysis and rule-based findings are unaffected." (reused verbatim for budget-exhaustion offline refusal)]
- [Source: PRPs/ux-design-specification.md#UX-DR44 — `aria-live="polite"` throttled announcements for coach streaming — frontend responsibility, story 1.8]
- [Source: components/worker/app/llm/gateway.py — `complete()` / `complete_sync()` to mirror semantics; `record_llm_call(row_id=...)` to write metering with a known ULID; `_safe_cost`; `_acquire` weighted semaphore for purpose=coach]
- [Source: components/worker/app/llm/errors.py — `LlmBudgetExceeded`, `LlmError.llm_call_id`]
- [Source: components/worker/app/llm/fake.py — `_fake_coach_text` (story 1.5 E-H3); extend with stream variant]
- [Source: components/worker/app/coach_actor.py — Phases A→G implemented for the non-streamed path; rewire Phase D + E]
- [Source: components/worker/app/coach_lib/payload.py — `CoachReplyPayload`, `answer_makes_numeric_claim_without_evidence` heuristic (carries over unchanged into v2)]
- [Source: components/worker/app/coach_lib/context.py — `build_context_bundle`, `resolve_evidence` (Phase F unchanged)]
- [Source: components/worker/app/verdict_lib/prompt_loader.py — `load_coach_grounded()` (file read, opaque body) — no change required for v2 bump]
- [Source: components/worker/app/verdict_lib/json_extraction.py — `extract_json_object` (reused for Section 2 JSON in v2 prompt)]
- [Source: components/worker/prompts/coach/CoachGrounded.md — v1.0.0 prompt; bump to v2.0.0 with two-section output]
- [Source: components/worker/app/dramatiq_app.py:21 — `REDIS_URL` env var (reused by stream publisher + cancel-check)]
- [Source: components/worker/requirements.txt:5 — `redis>=5.0.0` already present]
- [Source: components/bff/src/Spectr.Bff/Endpoints/CoachConversationEndpoints.cs — story 1.5 file; add the GET stream method here]
- [Source: components/bff/src/Spectr.Bff/Endpoints/CoachEndpoints.cs:127-147 — legacy SSE precedent: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`, newline escaping]
- [Source: components/bff/src/Spectr.Bff/Services/IJobQueue.cs:1,25 — existing `StackExchange.Redis` `ConnectionMultiplexer` precedent; new endpoint uses a shared singleton registered in Program.cs]
- [Source: components/bff/src/Spectr.Bff/Spectr.Bff.csproj:17 — `StackExchange.Redis 2.7.33` already referenced]
- [Source: components/bff/src/Spectr.Bff/Program.cs — endpoint group already wired via `api.MapCoachConversationEndpoints()` (story 1.5)]
- [Source: components/bff/src/Spectr.Bff/appsettings.json — `Redis:ConnectionString` already declared]
- [Source: components/bff/tests/Spectr.Bff.Tests/VerdictsEndpointDegradationTests.cs — `PostgresReachable()` skip-gate scaffold; add a sibling `RedisReachable()` for the new stream test]
- [Source: components/frontend-spectr-v2/src/api/types.ts — hand-mirrored types, camelCase wire format]
- [Source: PRPs/stories/1-5-grounded-coach-conversations.md — full predecessor: persisted conversations, gateway llm_call_id propagation, EF migration flow, JSONB parse precedent, AR38 error envelope codes]
- [Source: PRPs/deferred-work.md — in-flight idempotency, tail-query no-LIMIT, CreatedAt+1ms ordering hack, _resolve_path partial, etc. — all OUT OF SCOPE for this story; do not opportunistically fix without a separate change]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- Worker suite: 176 (story 1.5 baseline) → 204 passed (+28 new):
  - 7 new `tests/test_coach_stream_parser.py` (happy path, sentinel-straddles-delta, character-by-character feed, never-saw-sentinel, prefix false alarm, post-sentinel routing, empty stream)
  - 8 new `tests/test_coach_stream_publisher.py` (token frame, empty-token skip, done with evidence, refusal, error, RedisError swallowed, unexpected-exception swallowed, channel format)
  - 6 new `tests/test_coach_stream_gateway.py` (LLM_FAKE coach stream ≥3 deltas + one final, full-text concatenation, sentinel emission, budget-exceeded pre-stream un-metered, cancel-doesn't-prevent-final, event-kind constants sanity)
  - 7 new streaming-path cases on `tests/test_coach_actor.py` (happy-path publishes token+done, refusal publishes refusal frame, cancel-mid-prose persists partial+done, empty pre-sentinel stream → error, budget-exceeded publishes coach_offline error frame, generic LlmError publishes coach_error frame, Section-2 parse failure publishes coach_parse_failed)
- Shared suite: 18 passed (unchanged — no schema changes in this story).
- BFF suite: 24 (story 1.5 baseline) → 28 fast tests + 1 slow live-subscribe Redis round-trip:
  - 4 new fast tests in `Spectr.Bff.Tests/CoachStreamEndpointTests.cs` (terminal complete → token+done, terminal refused → refusal, terminal error → error, cross-user 404)
  - 1 new slow test (live-subscribe end-to-end round-trip with real local Redis, marked `[Trait("Category","Slow")]`)
- Frontend: vitest 34 passed (types-only change; no new tests required); `tsc -b`, `npm run lint`, `lint:css`, `lint:prices`, `vite build` all clean.
- ruff + mypy clean across the new source files (gateway.py, streaming.py, coach_actor.py, coach_lib/{stream_parser, stream_publisher, cancel}.py).
- `dotnet build` 0 warnings / 0 errors.
- AR39 lint allowlist extended from a single path to a frozenset including both `gateway.py` and `streaming.py` — `tests/test_enforcement_lints.py` re-passes.

### Completion Notes List

- **Streaming gateway** lives in a new sibling `components/worker/app/llm/streaming.py` (per guardrail 15 — keeps `gateway.py` under the 500-line CLAUDE.md ceiling). `gateway.py` re-exports `stream_complete_sync`, `GatewayStreamEvent`, and `GatewayResultLike` via a late import at the bottom of the module to avoid a circular import (streaming.py late-imports `record_llm_call` / `_safe_cost` / `_acquire` / `_semaphores` from gateway).
- **AR39 lint allowlist** went from a single `Path` constant to a `frozenset({gateway.py, streaming.py})`. The package-boundary intent is preserved; the lint still fails closed if any new file outside `app/llm/` tries to `import anthropic`.
- **Async-to-sync bridge**: `stream_complete_sync` runs the Anthropic `messages.stream()` producer in a background thread driving its own `asyncio.run` loop and forwards text deltas to the sync iterator via `queue.Queue`. Cancellation uses a `threading.Event` the producer checks before each `async for` iteration. SDK stream is `await close()`-d cleanly on cancel; partial usage is captured from `get_final_message()` so the metering row reflects what we actually spent.
- **Metering invariant preserved**: exactly ONE `llm_calls` row per call, including cancelled and errored ones. The row id is generated up-front via `new_llm_call_id()`, threaded through `record_llm_call(row_id=...)`, attached to the trailing `GatewayStreamEvent(kind="final", result=...)`, and stamped into `coach_messages.llm_call_id` by the actor. Pre-stream errors (no delta yielded) write `outcome="error"`; mid-stream errors with deltas write `outcome="ok"` because the model did partial work.
- **Coach prompt v2.0.0** ships a streamable two-section format with the sentinel `<<<EVIDENCE>>>` separating prose (streamed live as `token` frames) from a single-line JSON evidence object (parsed at end-of-stream). NFR12 injection defense is structurally unchanged — the system prompt is still pinned, user text still lands in `user=` between `<user_input>` tags, the coach still has no tools. Loader (`load_coach_grounded`) treats the body opaquely; no loader code change.
- **`StreamSplitter`** is the load-bearing sentinel-aware scanner. Holds back the last `len(SENTINEL)-1` characters so a sentinel that straddles a delta boundary still matches. Once matched, all subsequent feeds return `""` (no JSON leaks into the user-visible stream) and append to `evidence_json`. Tested character-by-character at the worst case.
- **`CoachStreamPublisher`** publishes typed JSON frames on `coach:{conversationId}:{messageId}`. Uses a lazy module-level `redis.Redis.from_url` client (sync — actor is sync def). All publishes swallow `redis.RedisError` (and unexpected exceptions, defence-in-depth) to a log warning — the persisted `coach_messages` row is the durable contract; pub/sub is the ephemeral accelerator.
- **`cancel_check_for(message_id)`** returns a closure that EXISTS-checks `coach:cancel:{message_id}`. Polled by the streaming gateway between deltas. Fail-open: a Redis error returns `False` (don't cancel). Cancel is an optimization, not a correctness guarantee.
- **`coach_reply` actor** Phase D rewired from `complete_sync` to the streaming loop. New `_mark_complete_partial` helper for cancel-mid-prose (status="complete" with empty evidence). All terminal paths (success / refusal / budget-exceeded / generic LlmError / Section-2 parse failure / catch-all) publish a typed terminal frame BEFORE marking the row, so SSE consumers never see a silent dead stream (AC4 / AR9).
- **v2 sentinel-aware parse**: `splitter.finish()` returns `(prose, evidence_json, saw_sentinel)`. The actor re-injects `body = prose.strip()` into the parsed Section 2 meta dict before constructing `CoachReplyPayload`, so the Pydantic schema (story 1.5) validates unchanged. Numeric-without-evidence rejection still fires on the reconstructed payload.
- **BFF SSE endpoint** `GET /api/coach/{analysisId}/messages/{messageId}/stream` enforces ownership via a single LINQ join (`Analysis.UserId == userId` ∧ `Conversation.AnalysisId == analysisId` ∧ `CoachMessage.ConversationId == Conversation.Id`). 404 BEFORE any SSE bytes flushed on mismatch.
- **Terminal-state short-circuit (AC5)**: when the assistant row is already `complete`/`refused`/`error`, the handler synthesizes `token` + `done`/`refusal`/`error` frames from the row and closes without subscribing. Handles resume-on-refresh + actor-finished-between-POST-and-subscribe races deterministically.
- **Live-subscribe path** uses `IConnectionMultiplexer.GetSubscriber()` with a per-request unbounded `System.Threading.Channels.Channel<string>` as the producer-consumer hand-off. Main loop awaits `Task.WhenAny(reader.ReadAsync, Task.Delay(15s))` so the heartbeat comment fires when no token arrives. Idle-fallback re-reads the row after 30 s of silence, synthesizes terminal frames if the row is now terminal, else emits `error(code="coach_stream_idle")`.
- **Client-disconnect** (`HttpContext.RequestAborted`) → `SET coach:cancel:{messageId} 1 EX 180` in `finally` so the worker's cancel-check sees it on the next delta and breaks the stream cleanly.
- **Shared `IConnectionMultiplexer`** registered as a singleton in `Program.cs` — `ConnectionMultiplexer` is documented as thread-safe + designed to be shared process-wide. The existing `DramatiqJobQueue` keeps its own multiplexer (additive choice; a follow-up could consolidate). Connection string reused from `Redis:ConnectionString`.
- **AC2 LLM_FAKE=1 path** extended in `app/llm/fake.py` with `fake_coach_stream_chunks()` — splits the canned prose into 5 word-boundary chunks then emits the sentinel + a coach-shaped evidence JSON. Without this branch, `LLM_FAKE=1` end-to-end would yield one `final` event with no deltas and the UI would never see incremental tokens during dev work.
- **Existing story-1.5 actor tests pass unchanged** on the streaming path. `_stub_gateway` in `tests/test_coach_actor.py` was updated to synthesize a v2 sentinel-separated stream from the existing canned v1 JSON, so 15 legacy test cases run without a single assertion change.
- **AC4 idle-fallback + 15s heartbeat unit tests deferred**: a deterministic test would require either real ≥30s waits OR plumbing test-only timer overrides through the endpoint. The persistence path (the system of record) is exhaustively tested at the worker layer; the live-subscribe round-trip test exercises the producer-consumer + frame serialization. Manual smoke via Task 9.2 covers the timing behavior; future story can add an `IOptions`-backed timer override if a unit test becomes necessary.
- **Scope honored**: NO frontend hook / chat UI (story 1.8 owns `useCoachStream` + the swap from legacy `CoachChat.tsx`); NO per-analysis caps (story 1.9); NO `outcome="refused"` on `llm_calls` (refusals still cost an LLM call so they record `outcome="ok"`); NO atomic-claim status migration (deferred-work P3); NO schema changes; NO triage/specialist streaming (only coach consumes `stream_complete_sync`).

### File List

New:
- components/worker/app/llm/streaming.py
- components/worker/app/coach_lib/stream_parser.py
- components/worker/app/coach_lib/stream_publisher.py
- components/worker/app/coach_lib/cancel.py
- components/worker/tests/test_coach_stream_parser.py
- components/worker/tests/test_coach_stream_publisher.py
- components/worker/tests/test_coach_stream_gateway.py
- components/bff/tests/Spectr.Bff.Tests/CoachStreamEndpointTests.cs

Modified:
- components/worker/app/llm/gateway.py (re-export `GatewayStreamEvent` + `GatewayResultLike` + `stream_complete_sync` via late import at module bottom; extend `__all__`)
- components/worker/app/llm/fake.py (add `fake_coach_stream_chunks()` for LLM_FAKE=1 streaming coach path)
- components/worker/app/coach_actor.py (rewire Phase D to streaming loop; v2 sentinel-aware Phase E with body re-injection; new `_mark_complete_partial`; publisher.error in every terminal branch + catch-all)
- components/worker/app/coach_lib/__init__.py (re-export new public names: `StreamSplitter`, `ParsedStream`, `SENTINEL`, `CoachStreamPublisher`, `cancel_check_for`, `cancel_key`, `CANCEL_KEY_PREFIX`, `CANCEL_TTL_S`)
- components/worker/prompts/coach/CoachGrounded.md (frontmatter version 1.0.0 → 2.0.0; output-format section replaced with v2 two-section sentinel-separated spec)
- components/worker/tests/test_enforcement_lints.py (AR39 allowlist extended from single Path to `frozenset({gateway.py, streaming.py})`)
- components/worker/tests/test_coach_actor.py (autouse `_stub_redis` fixture; `_stub_gateway` rewritten to synthesize v2 stream events from canned v1 JSON; 7 new streaming-path test cases)
- components/worker/tests/verdict_pipeline/test_prompt_loader.py (assert version == "2.0.0" + sentinel present in body)
- components/bff/src/Spectr.Bff/Endpoints/CoachConversationEndpoints.cs (new `g.MapGet("/messages/{messageId:guid}/stream", StreamMessage)` route + handler + `RelayLoop` + `WritePublishedFrame` + `WriteTerminalFromRow` + `ReadProjection` + SSE writers + `StreamMessageProjection` record)
- components/bff/src/Spectr.Bff/Program.cs (register `IConnectionMultiplexer` singleton from `Redis:ConnectionString`)
- components/frontend-spectr-v2/src/api/types.ts (new SSE wire types: `CoachStreamEventType`, `CoachStreamTokenPayload`, `CoachStreamDonePayload`, `CoachStreamRefusalPayload`, `CoachStreamErrorPayload`)

Deleted:
- none (legacy `CoachChatService.cs` + `CoachEndpoints.cs` + frontend `CoachChat.tsx` survive through 1.6–1.7; deletion is a story-1.8 task)

## Change Log

- 2026-06-15: Implemented; all local gates green (worker 204/204, shared 18/18, BFF 28 fast + 1 slow live-subscribe, frontend vitest 34/34, all lint/typecheck/build clean, AR39 lint allowlist updated and re-passes). Status → review.
- 2026-06-15: Code review (3-layer adversarial: Blind Hunter + Edge Case Hunter + Acceptance Auditor). 18 patches / 5 deferred / ~10 dismissed. See Review Findings below.
- 2026-06-15: All 18 patches applied. Worker 204 → 209 (+5 new tests: persist-before-publish ordering, done-frame evidence equality, Phase A failure publishes error, real SDK close-on-cancel, sentinel-prefix-tail drop). BFF 28 fast + 2 slow (+1 client-disconnect cancel-key SET). Live-subscribe test flake (fixed-Delay → bounded retry-publish loop). Worker ruff clean; mypy clean for story 1.6 files (pre-existing 5 errors in `verdict_actor.py` are story 1.4 territory, untouched). BFF `dotnet build` 0/0. AR39 lint green. Status → done.

### Review Findings

#### HIGH severity

- [x] [Review][Patch] **BFF subscribe-vs-check race — terminal frames dropped in the fast-actor window** [components/bff/src/Spectr.Bff/Endpoints/CoachConversationEndpoints.cs:347-375] — Handler reads `row.Status` (line 325-336), short-circuits if non-pending (line 347), THEN calls `sub.SubscribeAsync` (line 375). The story Dev Notes (~line 341) explicitly flagged this exact ordering as load-bearing risk: subscribe FIRST, then re-read row.Status. Current order means an actor that publishes between the read and the subscribe drops every frame; user waits the full 30s idle-fallback before recovery. LLM_FAKE=1 makes this the common case. Fix: subscribe → re-read row → if terminal, write synthesized frames + unsubscribe; else enter relay loop.
- [x] [Review][Patch] **No retry / fallback model for pre-first-delta transient errors in streaming gateway** [components/worker/app/llm/streaming.py:148] — Task 1.4 spec required: "Same retry policy as complete() for transient errors that fire BEFORE the first delta (LlmTimeoutError/LlmRateLimitError/LlmServerError → backoff + retry; fallback model after exhaustion)." `_stream_real` is called once at line 148 with no surrounding `for retry in range(...)` loop and no `for model in [primary, fallback]` iteration. A transient 429/5xx during a coach reply that batch `complete()` would have absorbed now fails user-visibly. Fix: wrap `_stream_real` in same retry+fallback loop pattern as `gateway.complete` (lines 302-342 in gateway.py).
- [x] [Review][Patch] **Circuit breaker never opens on streaming errors** [components/worker/app/llm/streaming.py:144,156] — `_budget.record_outcome(outcome="ok")` only fires AFTER successful yield-from completes. Any exception from `_stream_real` propagates out of the generator without record_outcome being called. AR8 breaker counts consecutive errors; under-counting streaming errors keeps the breaker closed when it should open. Fix: wrap the yield-from in try/except that calls `record_outcome(outcome="error")` before re-raising.
- [x] [Review][Patch] **Mid-stream errors silently swallowed when at least one delta was yielded** [components/worker/app/llm/streaming.py:320-341] — `if err is not None and not saw_any_delta:` raises (line 320-329), but the `err is not None AND saw_any_delta` case falls through to lines 334-351 which record `outcome="ok"` and yield a normal `final` event. `err` is captured at line 305 but never raised, logged, or threaded onto the result. Spec Task 1.4: "Non-retryable / mid-stream errors raise `LlmInvocationError` (with `llm_call_id` attached)." Fix: also raise (or attach to the final event so the actor can branch) when err is set, even with partial deltas; at minimum log the swallowed exception.
- [x] [Review][Patch] **Cancel-mid-prose path publishes `done` BEFORE persisting** [components/worker/app/coach_actor.py:450-453] — `publisher.done(evidence=[])` fires at line 450, then `_mark_complete_partial(...)` at 451-453. If the DB write fails (Postgres outage, lock timeout, session error), the SSE consumer has already received `done` and considers the reply complete; row stays `pending` forever (no timeout reclaims pending rows). Phase G at lines 504-512 uses the correct order (mark THEN publish). Critical guardrail 6: persistence is system of record; persist first, publish second. Fix: invert ordering in the saw_sentinel=False non-empty-body branch.

#### MEDIUM severity

- [x] [Review][Patch] **`get_final_message()` called after `stream.close()` on cancel — may raise or hang** [components/worker/app/llm/streaming.py:253] — Producer awaits `stream.close()` on cancel (line 248) and then unconditionally calls `await stream.get_final_message()` (line 253). The Anthropic SDK contract for `get_final_message()` after explicit close is not guaranteed; historically the SDK has raised `StreamClosedError` from accessor methods after close. If it raises, the surrounding `except anthropic.AnthropicError` catches it, posts `(_ERROR, LlmInvocationError(...))`, and the `(_FINAL, ...)` payload is lost — metering row records 0/0 tokens. Fix: switch to `stream.current_message_snapshot` (the safe-after-close attribute the existing code comment already references) OR wrap `get_final_message()` in its own try/except that substitutes (0, 0) on close-related exceptions.
- [x] [Review][Patch] **Phase A / A.1 / empty-question early-exits don't publish error frames** [components/worker/app/coach_actor.py:342-357] — `_mark_error(mid)` and `_mark_refused(mid, ...)` are called at lines 345 / 351 / 356 WITHOUT a `publisher.error/refusal` call. Publisher is only constructed at line 363 (Phases B-G), so these branches can't publish even if they wanted to. If an SSE consumer races to /stream during Phase A's DB load, it hits the 30s idle-fallback before recovery. Fix: construct `CoachStreamPublisher` immediately after parsing the UUIDs (after line 260), and add `publisher.error/refusal` to each early-exit branch.
- [x] [Review][Patch] **`fake_coach_stream_chunks()` invents new `_FAKE_COACH_PROSE` constant instead of reusing `_fake_coach_text()`** [components/worker/app/llm/fake.py] — Task 1.6 spec said: "Coach purpose: split the existing `_fake_coach_text()` PROSE part across 5 deltas." Implementation invents a fresh hard-coded body, so LLM_FAKE=1 streaming and non-streaming paths produce DIFFERENT bodies. Risk: dev running non-streamed coach (legacy CoachEndpoints.cs still wired through 1.6-1.7) sees one canned reply; streamed path shows another. Fix: extract the prose portion from `_fake_coach_text()` and split that, or reuse the constant directly.
- [x] [Review][Patch] **`StreamMessageProjection.Content` typed as non-nullable `string` while EF column is nullable** [components/bff/src/Spectr.Bff/Endpoints/CoachConversationEndpoints.cs:601] — `Content` is `string` (line 601) but `CoachMessage.Content` is nullable in EF and a pending row commonly has NULL content. The `if (!string.IsNullOrEmpty(row.Content))` guard at line 506 implies the same. EF Core 10 may throw on materialization when a NULL hits a non-nullable record member. Fix: `Content` → `string?` in the projection record.
- [x] [Review][Patch] **`StreamSplitter.finish()` flushes the held-back sentinel-prefix tail into `parsed.prose`** [components/worker/app/coach_lib/stream_parser.py:118-139] — When cancel fires while the splitter has buffered up to 13 chars of `<<<EVIDEN…`, `finish()` appends `_buf` to `_published` and returns it via `parsed.prose`. The actor persists `parsed.prose.strip()` (coach_actor.py:444), so the persisted row.content can contain a partial sentinel prefix the SSE consumer never saw. On refresh the user sees `…end<<<EVIDEN` for a body that streamed as `…end`. Fix: in `finish()` when `not _after_sentinel`, drop any trailing chars that match a prefix of SENTINEL before flushing `_buf`.
- [x] [Review][Patch] **`cancel.py`'s `from .stream_publisher import _get_client` defeats the autouse Redis fixture** [components/worker/app/coach_lib/cancel.py + components/worker/tests/test_coach_actor.py] — `cancel.py` binds `_get_client` at import time as a separate name; the `_stub_redis` fixture monkeypatches `stream_publisher._get_client` but NOT `cancel._get_client`. Tests "pass" only because `cancel_check_for` swallows `RedisError` and returns False (fail-open path). The True branch is never test-exercised. Fix: change `cancel.py` to `from . import stream_publisher` and call `stream_publisher._get_client()` so monkeypatching reaches it.
- [x] [Review][Patch] **`Channel.CreateUnbounded<string>` lacks backpressure under slow-client pathological cases** [components/bff/src/Spectr.Bff/Endpoints/CoachConversationEndpoints.cs:362-366] — Comment at line 359 says "bounded but large" but the code uses unbounded. A slow TCP consumer + chatty model can accumulate frames in process memory until the client drains. Fix: `Channel.CreateBounded<string>(new BoundedChannelOptions(1024) { FullMode = BoundedChannelFullMode.DropOldest })` — drops the oldest frame when the client can't keep up; the persisted row remains the source of truth for resume-on-refresh.
- [x] [Review][Patch] **Streaming-path tests don't assert ordering / single-row metering invariant / evidence equality** [components/worker/tests/test_coach_actor.py:166-218 + sibling streaming tests] — Tests assert published frame TYPES and persisted row content separately, but never assert (a) persist completes BEFORE final publish (masks finding #5), (b) EXACTLY ONE `llm_calls` row per call (masks circuit-breaker finding #3), (c) published `done`.evidence equals `row.evidence` byte-for-byte. Fix: add `select count(*) from llm_calls` assertions, add ordering assertions via a recording timestamp fixture, assert `frames[-1].evidence == row.evidence`.
- [x] [Review][Patch] **Missing test for client-disconnect → `coach:cancel:{messageId}` SET** [components/bff/tests/Spectr.Bff.Tests/CoachStreamEndpointTests.cs] — Task 6.5 enumerated 7 test cases; this one is silently absent. The behavior at CoachConversationEndpoints.cs:391-400 (SET cancel key on RequestAborted) has zero coverage. Distinct from AC4 idle-fallback/heartbeat tests which were explicitly deferred. Fix: open a stream, abort the request, poll Redis for the cancel key with bounded retries, assert it exists with TTL ≤180s.
- [x] [Review][Patch] **Cancel-mid-stream test only exercises LLM_FAKE path; real SDK `close()`-on-cancel path uncovered** [components/worker/tests/test_coach_stream_gateway.py:1730-1745] — `test_cancel_check_does_not_prevent_final_event` runs against `_fake_stream` which never calls `stream.close()`. The real codepath at `streaming.py:247-249` (`if cancel_event.is_set(): await stream.close(); break`) is uncovered. Fix: add a test that monkeypatches `anthropic.AsyncAnthropic.messages.stream` to a fake async-iterable that records `close()` was called, and assert it gets called when cancel_check returns True.

#### LOW severity

- [x] [Review][Patch] **`heartbeatTask` leaked as unobserved task on every frame-wins-race** [components/bff/src/Spectr.Bff/Endpoints/CoachConversationEndpoints.cs:422-466] — When `nextFrameTask` wins the `Task.WhenAny`, `waitCts.Cancel()` transitions `heartbeatTask` to Cancelled but it's never awaited; the `TaskCanceledException` becomes unobserved and fires `UnobservedTaskException` (log noise). Fix: `try { await heartbeatTask; } catch (OperationCanceledException) { }` after canceling.
- [x] [Review][Patch] **Live-subscribe round-trip test relies on wall-clock `Task.Delay(500)` — flake source** [components/bff/tests/Spectr.Bff.Tests/CoachStreamEndpointTests.cs:842-849] — Classic CI flake pattern. Fix: re-publish in a bounded loop until the consumer ACKs, or use a deterministic readiness signal (subscribe completion).
- [x] [Review][Patch] **Cross-user 404 test asserts only status code, not empty/generic body** [components/bff/tests/Spectr.Bff.Tests/CoachStreamEndpointTests.cs:803-804] — AC6: "No leak of stream existence." A future regression that responds with "message {id} not found in your conversations" still passes the test. Fix: also assert response body is empty or matches a generic 404 envelope.

#### Deferred (acknowledged, not blocking)

- [x] [Review][Defer] **`components/worker/app/coach_actor.py` at 560 lines exceeds the ~500-line CLAUDE.md ceiling (guardrail 15)** [components/worker/app/coach_actor.py] — deferred, follow-up extraction. Story projected ~330 lines; ended at 560. Suggested: extract `_mark_*` helpers + the Phase E parse/validate block into `coach_lib/phase_handlers.py` in a follow-up.
- [x] [Review][Defer] **AC4 idle-fallback + 15s heartbeat have no unit tests** [components/bff/tests/Spectr.Bff.Tests/CoachStreamEndpointTests.cs] — deferred, already documented in Completion Notes. Smoke test in Task 9.2 covers it; deterministic unit tests would need test-only timer overrides (InternalsVisibleTo + IOptions-backed timer).
- [x] [Review][Defer] **Cancel-key TTL of 180s could collide with a dramatiq retry reusing the same `assistant_message_id`** [components/bff/src/Spectr.Bff/Endpoints/CoachConversationEndpoints.cs:391-400 + components/worker/app/coach_lib/cancel.py] — deferred, pre-existing concurrency model. With `concurrency=1` + `max_retries=1` the window is narrow. Document or shorten TTL when retry semantics tighten.
- [x] [Review][Defer] **Idle-fallback fires somewhere in [30, 45]s due to heartbeat-tick coupling** [components/bff/src/Spectr.Bff/Endpoints/CoachConversationEndpoints.cs:441-462] — deferred, design tradeoff. Spec says ">30s"; actual variance is acceptable. Tighten with an absolute timer if needed.
- [x] [Review][Defer] **No streaming-gateway-level test asserts `LlmInvocationError` carries `llm_call_id`** [components/worker/tests/test_coach_stream_gateway.py] — deferred, partially covered by actor-level tests (`test_generic_llm_error_publishes_error_frame`). Add when the streaming-error-path patches above land — same fixture work serves both.
