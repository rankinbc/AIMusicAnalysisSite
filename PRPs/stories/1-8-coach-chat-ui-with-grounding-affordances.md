# Story 1.8: Coach Chat UI with Grounding Affordances

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a producer,
I want a coach chat on my report that shows its grounding and streams answers,
So that asking feels like talking to someone who actually heard my track.

## Acceptance Criteria

1. **Given** a report, **When** the coach card renders, **Then** it shows the TranceBot avatar (72 px, EQ visor idle-pulse, faster while streaming, **static under `prefers-reduced-motion: reduce`**), the overline `ASK THE COACH · online · trained on your analysis`, six suggestion chips **derived from this report's verdict categories** (no hard-coded list), and an input with `Ask →` (UX-DR13 + UX-spec line 189).
2. **Given** the grounding scope line, **When** the card renders, **Then** `Answers grounded in analysis #{shortid} · {n} measurements · {m} verdicts` shows beneath the input in dim mono (UX-DR14 + UX-spec line 190). `{shortid}` = first 8 hex chars of `analysisId`; `{n}` = count of measurement keys surfaced from `analyses.final_json`; `{m}` = count of `verdicts` for this analysis (already loaded for the Results page).
3. **Given** an answer with citations, **When** rendered, **Then** EvidenceChips (e.g. `LUFS −11.2`, `SUB-DEEP 65 Hz`) parsed from the `evidence` array on the SSE `done` frame are tappable, scroll the matching report panel into view + highlight it for ~1.4 s, and each chip carries an `aria-label` describing what it cites (e.g. `aria-label="Cite: LUFS measurement −11.2 dB"`) (UX-DR15 + UX-spec line 190).
4. **Given** streaming, **When** tokens arrive on the SSE `token` event, **Then** text streams incrementally with a **visible Stop button** (replaces the `Ask →` button while streaming) that POSTs `/api/coach/{analysisId}/messages/{messageId}/cancel` **And** the assistant turn carries an `aria-live="polite"` region whose announcement is **throttled to ≤1 update per 500 ms** so screen readers do not stutter every token (UX-spec line 193 + AR44 streaming envelope).
5. **Given** a refusal, **When** the SSE `refusal` event arrives, **Then** the TranceBot styling is unchanged (same avatar, same bubble background), the body text names the gap (the worker's refusal payload includes `reason` + optional `unlock`), AND if `unlock.action` is set the turn renders a one-tap action chip — e.g. `Add stems` linking to the stems upload flow (UX-DR17 + UX-spec line 192).
6. **Given** the provider-outage state, **When** either (a) the POST `/messages` returns the AR38 error envelope with code `coach_unavailable` / `circuit_open` / `llm_provider_down`, OR (b) the SSE `error` frame arrives with the same codes, **Then** the chat card renders the exact copy `Coach is offline — your measured analysis and rule-based findings are unaffected.` and disables the input row while keeping any prior transcript readable (UX-spec line 197 + matches the BFF's `CoachOfflineBody` constant at `CoachConversationEndpoints.cs:32`).

## Tasks / Subtasks

- [ ] Task 1: Wire `CoachChat` to the v2 BFF coach API (AC: 4)
  - [ ] 1.1 Replace the legacy POST at `/api/coach/{jobId}/chat` (currently used by `CoachChat.tsx:61`) with the story-1.5/1.6 v2 endpoints:
    - `POST /api/coach/{analysisId}/messages` (body: `{ content: string }`) — returns `{ messageId, conversationId }` and enqueues the worker's `coach_reply` actor.
    - `GET /api/coach/{analysisId}/messages/{messageId}/stream` — SSE relay with event types `{token|done|error|refusal}` + `: heartbeat` comments every 15 s (CoachConversationEndpoints.cs:51-58).
    - `POST /api/coach/{analysisId}/messages/{messageId}/cancel` — sets the `coach:cancel:{messageId}` Redis flag so the worker breaks its generation loop between deltas.
  - [ ] 1.2 Use `fetch` + `ReadableStream` for both POST and SSE (NOT `EventSource` — it can't set `Authorization` headers, and the access-token-in-React-state rule from CLAUDE.md forbids cookie auth for SPA fetches). Pattern already established in the legacy code path; the frame parser at `CoachChat.tsx:238-248` needs widening from `{chunk|done}` to `{token|done|error|refusal}` plus heartbeat-comment passthrough.
  - [ ] 1.3 Delete the legacy `/api/coach/{jobId}/chat` consumption from `CoachChat.tsx`. The BFF endpoint at `CoachEndpoints.cs` stays (Story 1.6 explicitly noted it is "unchanged" for now); a future cleanup story can prune it once no v1 frontend references remain.
  - [ ] 1.4 Plumb `analysisId` into `CoachChat` props in place of (or alongside) `jobId`. The Results page already loads the analysis row — pass `analysis.id` down the prop chain. If `analysisId` is only available a render later than `jobId`, accept either and resolve client-side via the existing `/api/jobs/{id}/results` payload.

- [ ] Task 2: Stop button + throttled `aria-live` (AC: 4)
  - [ ] 2.1 While `streaming === true`, the `Ask →` button at `CoachChat.tsx:192-199` swaps to a `Stop` button (`btn ghost` tone, with a small square-stop SVG glyph). On click, the button calls `POST /api/coach/{analysisId}/messages/{messageId}/cancel`, aborts the in-flight `fetch` via the existing `abortRef` AbortController, and leaves the partial transcript visible. The next `Ask →` should be available immediately after.
  - [ ] 2.2 The streaming assistant `<p>` at `CoachChat.tsx:212-214` gets `aria-live="polite"` + `aria-atomic="false"` + `aria-relevant="additions"`. To prevent token-by-token re-announcement (which makes NVDA stutter), wrap the `setTurns` call inside `requestAnimationFrame` AND a 500 ms `throttle` (write to a buffer ref; the `aria-live` text node is flushed at most every 500 ms). After `done` arrives, do a final flush.
  - [ ] 2.3 Add a screen-reader-only status announcement (`<span className="sr-only" aria-live="polite">`) that says `Coach is responding...` on stream start and `Coach finished responding` on `done` — this gives blind users a clear stream-state cue separate from the partial token stream.

- [ ] Task 3: Grounding scope line (AC: 2)
  - [ ] 3.1 Add a `<p className={s.groundingScope}>` directly under the input row (above any transcript). Copy template: `Answers grounded in analysis #{shortid} · {n} measurements · {m} verdicts`. Use the `.label` global class + `.mono` for the shortid token; use `var(--muted)` for color.
  - [ ] 3.2 Source `{shortid}` = `analysisId.replace(/-/g, '').slice(0, 8)`. Source `{n}` = count of leaf numeric keys in `final_json` (use a depth-2 walk, cap at 9999). Source `{m}` = `verdicts.length` from the existing Results page query. If the Results page does not yet expose `final_json` to `CoachChat`, add it as a prop (the Results page already loads it for the Analysis tab).
  - [ ] 3.3 Add an `aria-label` on the scope line: `aria-label="Coach answers are grounded in this report only."` — gives the screen-reader user the same trust signal that sighted users get from the visible copy.

- [ ] Task 4: Suggestion chips derived from verdict categories (AC: 1)
  - [ ] 4.1 Delete the hard-coded `SUGGESTIONS` array at `CoachChat.tsx:18-25`. Replace with a `useMemo`-derived list of 6 chips computed from this report's verdict categories. Algorithm: take the top 6 distinct verdict categories ranked by `verdict.severity` (critical → severe → moderate → minor → win) + tie-broken by `priority_score`. For each category, pick a category-specific prompt template from a new `src/features/results/coach-suggestion-templates.ts` file (e.g. `lowEnd → "What's making my {lowFreqHook} muddy?"`).
  - [ ] 4.2 Fall back to 6 generic prompts if `verdicts.length === 0` (degraded analysis). Generic prompts: `'What's the single biggest issue right now?'`, `"Will this pass Spotify normalization?"`, `'Give me a 3-step fix priority list.'`, `'How does this compare to my genre?'`, `"What's the loudness verdict in plain English?"`, `'Where would you start tonight?'`.
  - [ ] 4.3 Each chip clicked still routes into the input (`setInput(prompt)`) — no behavioural change beyond the source of the strings.

- [ ] Task 5: EvidenceChips component (AC: 3)
  - [ ] 5.1 Create `src/features/results/EvidenceChips.tsx`. Props: `evidence: Array<{ label: string; path?: string; value?: string | number }>` (matches the worker's `evidence_json` shape per `CoachConversationEndpoints.cs:36-41` + the JSONB written by the actor at `components/worker/app/coach_actor.py:127`). Render each item as a `<Pill tone="cyan">` (reuses story 1.7's `Pill`) with the label inside, and an `aria-label` of `Cite: {label}{value ? ', value ' + value : ''}`.
  - [ ] 5.2 Click handler: if `path` is set, scroll the matching report panel into view (the verdict cards have stable DOM ids like `verdict-{id}`; the spectrum panel is `spectrum`, etc.). Apply a transient highlight class on the target — a 1.4 s `outline: 2px solid var(--cyan); transition: outline 0.3s ease` that auto-removes via `setTimeout` + the prefers-reduced-motion override already in story 1.7's `global.css` will collapse the transition to 0.001 ms for vestibular-safety users.
  - [ ] 5.3 Render EvidenceChips inside each `s.turnAssistant` block at `CoachChat.tsx:204-216`, ONLY when `turn.role === 'assistant'` AND the turn is finalized (i.e. the `done` frame's evidence has been received). Store evidence per-turn on the `ChatTurn` shape; widen the type to `{ role: 'user' | 'assistant'; text: string; evidence?: Evidence[]; refused?: boolean; unlock?: { label: string; href: string } }`.
  - [ ] 5.4 Add a unit test `src/features/results/__tests__/EvidenceChips.test.tsx` using `renderToStaticMarkup` (story 1.7's jsdom-free pattern) asserting: (a) one Pill per evidence item, (b) `aria-label` includes "Cite:" + the label, (c) chips without a `path` are still rendered but do not get the clickable `role="button"`.

- [ ] Task 6: Refusal pattern (AC: 5)
  - [ ] 6.1 Extend the SSE frame parser at `CoachChat.tsx:238-248` to recognize `refusal` events. Payload shape: `{ reason: string; unlock?: { label: string; action: 'add_stems' | 'upgrade' | 'add_reference'; href: string } }` (parser shape: pass through verbatim from the worker's `coach_lib/cancel.py` + `coach_actor.py` `_mark_refused` helper).
  - [ ] 6.2 On `refusal`, set the last assistant turn's `text = reason` AND `refused = true` AND `unlock = payload.unlock`. Streaming flips to `false`. The transcript renderer styles `refused` turns identically to normal assistant turns (per AC5 "TranceBot styling unchanged") but adds the unlock action as a `<Pill tone="violet" className={s.unlockChip}>` rendered as a `<button>` that navigates to `unlock.href` on click.
  - [ ] 6.3 Refused turns ALSO render their own evidence chips if the refusal includes a `cite` array (e.g. citing the missing stems file that triggered the refusal).
  - [ ] 6.4 Unit test in `CoachChat.test.tsx` (new file): a stub SSE generator emits a `refusal` frame; assert the turn renders the reason text, the unlock button with the right href, and TranceBot is still in the avatar slot (not replaced with an error icon).

- [ ] Task 7: Provider-outage fallback (AC: 6)
  - [ ] 7.1 Add an `offlineState` boolean to `CoachChat`. Trigger conditions:
    - POST `/api/coach/{analysisId}/messages` returns 503 with AR38 envelope `{ error: { code: "coach_unavailable" | "circuit_open" | "llm_provider_down", message, details } }`.
    - SSE `error` frame arrives with the same codes.
    - Any 5xx without a recognisable code also triggers offline state (defensive default).
  - [ ] 7.2 When `offlineState === true`, render a `<DegradationBanner>` (already exists from story 1.4) with the exact copy `Coach is offline — your measured analysis and rule-based findings are unaffected.` (the BFF's `CoachConversationEndpoints.cs:31-32` constant is the canonical string — copy it byte-for-byte). Disable the input and the Ask/Stop button (`disabled={offlineState}`). Keep any prior transcript readable.
  - [ ] 7.3 Add a Retry button inside the banner — click clears `offlineState` and the user can try again. Do NOT auto-retry (a circuit-open state is best surfaced to the user).
  - [ ] 7.4 Unit test: stub fetch returns the AR38 envelope; assert the banner renders, the input is `disabled`, and clicking Retry re-enables the input.

- [ ] Task 8: `useReducedMotion` hook + TranceBot static under reduced-motion (AC: 1; closes Story 1.7 deferred D1)
  - [ ] 8.1 Create `src/hooks/useReducedMotion.ts`. Implementation:
    ```ts
    import { useEffect, useState } from 'react';
    export function useReducedMotion(): boolean {
      const [reduce, setReduce] = useState(() =>
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true);
      useEffect(() => {
        if (typeof window === 'undefined') return;
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        const onChange = () => setReduce(mq.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
      }, []);
      return reduce;
    }
    ```
  - [ ] 8.2 In `TranceBot.tsx`, gate the rAF loop on `useReducedMotion()`. When `reduce === true`, skip the `requestAnimationFrame` entirely and render a static frame with `bars = [0.4, 0.55, 0.65, 0.5, 0.4]` (the midpoint of the idle wave). The `thinking` prop is ignored in reduced-motion mode.
  - [ ] 8.3 Add a unit test `src/hooks/__tests__/useReducedMotion.test.ts` that mocks `window.matchMedia` and asserts the hook returns `true` when `matches: true`. Use the same jsdom-free pattern as story 1.7 — assert against the initial state only, the event-listener flow is tested by integration smoke.
  - [ ] 8.4 Add a quick smoke note in Completion Notes: "DevTools → Rendering → Emulate `prefers-reduced-motion: reduce`, navigate to a results page, confirm TranceBot bars freeze."

- [ ] Task 9: Validation gates green (AC: all)
  - [ ] 9.1 `cd components/frontend-spectr-v2 && npx tsc --noEmit` — clean.
  - [ ] 9.2 `cd components/frontend-spectr-v2 && npm run lint` — clean (eslint + the chained `lint:fonts` per story 1.7 P8).
  - [ ] 9.3 `cd components/frontend-spectr-v2 && npm run lint:css` — clean.
  - [ ] 9.4 `cd components/frontend-spectr-v2 && npm run lint:prices` — clean.
  - [ ] 9.5 `cd components/frontend-spectr-v2 && npx vitest run` — current baseline: 72 (story 1.7). Target: ~85 after this story's new tests (EvidenceChips ×3, useReducedMotion ×1, CoachChat refusal ×1, CoachChat offline ×1, plus existing tests).
  - [ ] 9.6 `cd components/frontend-spectr-v2 && npm run build` — clean.
  - [ ] 9.7 Backend regression sanity (no backend changes expected): `cd components/bff && dotnet build` 0/0; `pytest -q components/worker/tests/` 209/209.
  - [ ] 9.8 Manual smoke (Completion Notes only):
    - Start the stack (`docker compose up -d`, BFF, worker, frontend). Register/log in, run an analysis, open AI Coach tab.
    - Ask a question — confirm streaming text + Stop button appears.
    - Click Stop mid-stream — confirm cancel POSTs and partial text stays.
    - Trigger a refusal (ask about stems on a no-stems analysis) — confirm refusal turn renders with unlock chip.
    - With BFF stopped, hit Ask — confirm offline banner renders.
    - DevTools → Rendering → emulate `prefers-reduced-motion: reduce` — confirm TranceBot freezes.

- [ ] Task 10: Documentation + Dev Agent Record (AC: all)
  - [ ] 10.1 Update `components/frontend-spectr-v2/README.md` "Results page architecture" section: replace the existing CoachChat bullet ("Chat submit toasts 'not wired' until the LLM endpoint ships") with the actual wired behaviour — v2 SSE endpoints, grounding scope, evidence chips, refusal pattern, offline fallback, reduced-motion-safe TranceBot.
  - [ ] 10.2 Update the validation-gates section's vitest count baseline from 72 to the new number.
  - [ ] 10.3 If `useReducedMotion` is general-purpose enough, document its location (`src/hooks/`) so Phase B / Epic 5 consumers can reuse it (PreviewTools oscilloscope, listen page rAF — Story 1.7 deferred D1's other consumers).

## Dev Notes

### Critical guardrails

1. **Use the v2 BFF coach API only** (`/api/coach/{analysisId}/messages` + `/messages/{id}/stream` + `/messages/{id}/cancel`). The legacy `/api/coach/{jobId}/chat` route at `CoachEndpoints.cs` must NOT be the new code path. Story 1.6's BFF file already documents the migration intent at `CoachConversationEndpoints.cs:25` ("Story 1.8 swaps the frontend over to these new endpoints and deletes the legacy.")

2. **SSE event types are `{token|done|error|refusal}` per AR44** (story 1.6) — NOT the legacy `{chunk|done}` format the current `CoachChat.tsx:238-248` parser handles. Widen the parser, AND accept `: heartbeat` comments by ignoring them (they keep the stream alive through proxies but carry no payload).

3. **Access token in React state ONLY — never `localStorage`** (CLAUDE.md auth rule, repeated in story 1.5/1.6). Use `getAccessToken()` from `src/api/fetcher.ts` exactly like the existing `CoachChat.tsx:60` call.

4. **`fetch` + `ReadableStream` for SSE, not `EventSource`** — `EventSource` cannot attach `Authorization` headers; the cookie auth path is reserved for the audio `<audio>` element's URL-embedded token, NOT for the coach stream.

5. **No new top-level dependencies.** Reuse `react-dom/server` for tests (story 1.7's pattern); reuse story 1.7's `<Pill>` for chips; reuse `sonner` for any toast that survives the refactor; reuse the existing `<DegradationBanner>` for the offline state.

6. **`aria-live` throttling is load-bearing**: an unthrottled token stream makes NVDA announce every character, which is unusable. The 500 ms throttle is a compromise — fast enough to feel responsive, slow enough to flush in coherent phrases. If a user reports stutter, increase to 1000 ms before reaching for `aria-live="off"`.

7. **EvidenceChips must reuse `<Pill>` from story 1.7** — do not create a parallel chip primitive. The `tone="cyan"` variant is the canonical evidence-citation visual.

8. **TranceBot reduced-motion fix closes story 1.7 deferred D1** — the static-frame fallback IS the design intent; do not "improve" it by interpolating between two static frames or any other half-measure.

9. **Refusal styling parity** — UX-DR17 is explicit: refusal answers must look the same as normal answers (same TranceBot, same bubble). The ONLY differentiator is the unlock chip + the body text content. Do NOT add a refusal banner, a warning icon, or a different bubble color.

10. **Provider-outage copy is byte-for-byte canonical** — the string lives in three places (worker `coach_actor.py`, BFF `CoachConversationEndpoints.cs:32`, this story's AC6). If the copy ever changes, all three must change together. Frontend copies the BFF constant; future copy edits start at the worker.

11. **`{shortid}` is 8 hex chars** — not 6, not 10. Match the convention from the verdict pipeline's shortid display (used in some failure logs and verdict ids). `analysisId.replace(/-/g, '').slice(0, 8)` is the exact formula.

12. **Stop button cancels via the BFF cancel endpoint, NOT just the local AbortController** — aborting the fetch on the client only stops the BFF's relay; the worker keeps generating until it hits its own cancel check. The Redis `coach:cancel:{messageId}` SET (issued via `POST /messages/{id}/cancel`) is what actually stops the LLM call. Do both: POST cancel, then abort.

13. **`coach_unavailable` and `circuit_open` are the only AR38 codes that trigger the offline banner** (story 1.4's circuit-breaker emits `circuit_open`; story 1.5/1.6's gateway emits `llm_provider_down` for SDK-level failures). A `coach_cap_reached` code is NOT an outage — that's story 1.9's territory and gets its own UX (CoachGateInline).

14. **No backend changes** — story 1.5/1.6 already shipped the wire format. If the dev agent thinks they need a BFF change, STOP and ask. The contracts are stable.

15. **No DB / migration changes.** All persistence is already in place.

16. **Mobile / responsive** is out of scope for this story (Phase B / Epic 5 owns the responsive sweep). Test on desktop only; the chat card uses the existing CoachChat.module.css width.

17. **Coach Chat E2E is out of scope** for this story — Playwright smoke can wait until Phase B / Epic 5 lands its E2E harness. Unit tests + manual smoke (Task 9.8) are the gates here.

### Source documents referenced

- `PRPs/epics.md` lines 515-528 — AC text for story 1.8 itself.
- `PRPs/epics.md` lines 530-541 — story 1.9 (Per-Analysis Coach Caps) for boundary clarity (this story does NOT implement caps; story 1.9 owns CoachGateInline).
- `PRPs/ux-design-specification.md` lines 186-200 — the canonical "Coach as Product Heart" interaction script (TranceBot 72 px, suggestion chips, grounding scope, refusal pattern, streaming + stop, verdict→chat handoff, failure copy).
- `PRPs/architecture.md` AR44 — SSE wire format `{token|done|error|refusal}` + 15 s heartbeat.
- `PRPs/architecture.md` AR38 — error envelope `{error: {code, message, details}}`.
- `PRPs/architecture.md` AR9/AR10 — coach conversation persistence (shipped story 1.5).
- `PRPs/architecture.md` AR23 — coach queue isolation (shipped story 1.5/1.6 + story 2.5 will tier-split).
- `components/bff/src/Spectr.Bff/Endpoints/CoachConversationEndpoints.cs` — v2 endpoints (POST messages, GET conversation, GET stream); also the canonical offline copy at line 31-32.
- `components/worker/app/coach_actor.py` — refusal/evidence shape source-of-truth; AR9 grounding rules; `_mark_refused` helper at the helper-functions block.
- `components/frontend-spectr-v2/src/features/results/CoachChat.tsx` — file being rewired (currently uses legacy `/api/coach/{jobId}/chat`).
- `components/frontend-spectr-v2/src/features/results/TranceBot.tsx` — file gaining reduced-motion gating.
- `components/frontend-spectr-v2/src/ui/Pill.tsx` — story 1.7's component, consumed by EvidenceChips.
- Story 1.7 file (`PRPs/stories/1-7-design-system-foundation-fidelity-phase-a.md`) — design system foundation this story consumes (Pill/`<span className="sr-only">`/prefers-reduced-motion blanket/ambient signature). Story 1.7 Review Findings → Deferred D1 is specifically closed by Task 8 of this story.

### Project structure notes (what is changing where)

- **New files**:
  - `components/frontend-spectr-v2/src/hooks/useReducedMotion.ts` — new general-purpose hook.
  - `components/frontend-spectr-v2/src/hooks/__tests__/useReducedMotion.test.ts` — initial-state assertion.
  - `components/frontend-spectr-v2/src/features/results/EvidenceChips.tsx` — new component.
  - `components/frontend-spectr-v2/src/features/results/__tests__/EvidenceChips.test.tsx` — Pill-rendering + aria-label assertions.
  - `components/frontend-spectr-v2/src/features/results/__tests__/CoachChat.test.tsx` — refusal + offline assertions.
  - `components/frontend-spectr-v2/src/features/results/coach-suggestion-templates.ts` — category → prompt template map.

- **Modified files**:
  - `components/frontend-spectr-v2/src/features/results/CoachChat.tsx` — endpoint migration; widened SSE parser; grounding scope line; suggestion-chip derivation; transcript shape gains `evidence` + `refused` + `unlock`; stop button + throttled aria-live; offline state.
  - `components/frontend-spectr-v2/src/features/results/CoachChat.module.css` — grounding scope style (mono, dim); EvidenceChip placement; unlock chip style; offline-state input disabled visual; aria-live SR-only region.
  - `components/frontend-spectr-v2/src/features/results/TranceBot.tsx` — `useReducedMotion()` gates the rAF loop.
  - `components/frontend-spectr-v2/src/features/results/ResultsTabs.tsx` — pass `analysisId` and `final_json` props into `CoachChat`.
  - `components/frontend-spectr-v2/README.md` — Coach section updated to reflect wired behaviour; vitest baseline bump.

- **No deleted files** (the legacy `/api/coach/{jobId}/chat` BFF endpoint stays for now — pruning is a follow-up).

- **No backend changes** (no BFF, no worker, no migrations).

- **No new dependencies** (Dev Note 5).

### Testing

- **Unit tests (vitest, node env, no jsdom)**: ~6 new tests targeting (a) `EvidenceChips` rendering + aria-label, (b) `useReducedMotion` initial state, (c) `CoachChat` refusal turn rendering, (d) `CoachChat` offline banner + disabled input, (e) suggestion-chip derivation from verdict categories (small fixture), (f) frame parser widened format.
- **Manual smokes** (Completion Notes, not automated): full stack happy path (Task 9.8 details). The streaming + cancel + refusal + offline + reduced-motion paths each get their own smoke.
- **Existing test count**: vitest 72 (story 1.7 baseline). Target: ~78-85 after this story.
- **No new BFF tests**, **no new worker tests** — story scope is frontend-only.

### Latest tech information

- **TanStack Query** is in the stack — `useMutation` is the right hook for the POST `/messages` call (cancels-on-unmount, error envelope handling). The SSE relay still needs a hand-rolled `fetch`+`ReadableStream` reader though — TanStack Query has no first-class SSE primitive yet.
- **React 19 `use`** is available but the streaming UI is state-driven, not promise-driven; `useState` + `useCallback` (current pattern) stays correct.
- **`prefers-reduced-motion`** media query is universally supported. The `matchMedia` event listener API uses `addEventListener('change', ...)` — Safari ≥14 supports it; older Safari needs `addListener` shim, but Spectr's browser targets per CLAUDE.md don't go that low.

## Dev Agent Record

### Agent Model Used

(filled by dev agent on implementation)

### Debug Log References

(filled by dev agent)

### Completion Notes List

(filled by dev agent — see "smokes" list in Task 9.8 for what to confirm)

### File List

(filled by dev agent)

## Change Log

- 2026-06-15: Story drafted by bmad-create-story. Built directly off story 1.6 (BFF coach SSE relay + cancel + heartbeat) and story 1.7 (Pill, sr-only, prefers-reduced-motion blanket). Task 8 specifically closes story 1.7 Review Findings deferred item D1 (JS rAF + reduced-motion). Status → ready-for-dev.
