---
stepsCompleted: [1]
inputDocuments:
  - PRPs/design_handoffs/design_handoff_listen_rack/docs/Listen Modes Spec.html
  - PRPs/design_handoffs/design_handoff_listen_rack/docs/Listen Feature Reference.html
  - PRPs/design_handoffs/design_handoff_listen_rack/README.md
  - PRPs/design_handoffs/design_handoff_listen_rack/PORTING_GUIDE.md
  - PRPs/design_handoffs/design_handoff_listen_rack/src/data.jsx
session_topic: 'V3 Listen page — Work/View/Room modes: data model, entity associations, persisted page-state, person-to-person interactions, and resolving open questions to shape PRPs'
session_goals: 'Decide what new entities must be stored, what each associates with, define their shapes, map person-to-person interactions to concrete system effects, resolve the open questions — all to produce a PRP decomposition. Implementation of the page itself happens in a separate thread.'
selected_approach: 'AI-Recommended: Question Storming → First-Principles Entity Modeling. Greenfield-first shapes; output = resolved decisions (PRP slicing deferred).'
techniques_used: ['Question Storming', 'First-Principles Entity Modeling']
ideas_generated:
  - 'Preset source is first-class: user|coach|analysis|reviewer (coach/analysis can emit full-chain presets)'
  - 'Suggestion is the single convergence point for async View + live Room non-owner chain proposals'
  - 'GamePlanItem is the unified drain for every suggestion path → the user DAW change-set for next version'
  - 'Session stored JSON-first (events_json) + derived SessionRecap, mirroring analyses.final_json'
  - 'Accept = fork-to-preset; cherry-pick is UI-only — dissolves the merge-model open question'
  - 'VersionComparison powers the existing DeltaCard placeholder and closes the v(n)->v(n+1) loop'
context_file: ''
---

# Brainstorming Session Results

**Facilitator:** Brian Rankin
**Date:** 2026-06-25

## Session Overview

**Topic:** V3 Listen page — Work / View / Room modes. Backend/data-model decomposition for PRP generation.

**Goals:**
- Identify every new thing we need to **store** and what it **associates with** (e.g. rack preset → version).
- Decide what page-generated info to **persist for further analysis** (reactions, recaps, suggestions, etc).
- Define **shapes** for the new entities.
- Map **person-to-person interactions** to concrete system effects (grant control → save → cross-author adoption).
- Resolve the spec **open questions** (or park them explicitly).
- Output: a PRP decomposition + sequencing. (Page implementation is a separate thread.)

### Session Setup

This is a backend/data-architecture brainstorm, not pure divergent ideation — convergent decisions are the deliverable.

---

## Domain 1 — Versions ↔ Presets — DECISIONS

**D1.1 — Version = immutable audio asset + analysis.** The rack is always a live Web-Audio *overlay* on playback; it never bakes into the version. (Aligns with existing `song_versions`.)

**D1.2 — `RackPreset` = full chain snapshot** (`order[]` + per-module params + enabled), stored whole (not a sparse diff).
- `songVersionId` = **origin** binding (where it was made).
- **Copyable across versions**: copy = new row + `copiedFromId` provenance; original never mutated.
- `authorId` distinct from the version owner (sets up reviewer + cross-author cases).

**D1.3 — Preset `source` is a first-class field** ⭐ (key insight from this session):
`source ∈ { user, coach, analysis, reviewer }`.
- Today's `COACH_SUGGESTIONS` are single-device `apply` patches. The model must also allow the **Coach AI or the analysis pipeline to emit a FULL-CHAIN preset** the user can audition/listen to — not just one-knob moves.
- This generalizes "Suggestion" (Domain 2) and feeds Analytics (Domain 5). A system-generated preset is a `RackPreset` with `source != user` and no human author.

**D1.4 — `RackDraft` = autosaved working state per `(userId, songVersionId)`.** Unsaved tweaks survive reload/device. Named presets are explicit promotions from the draft. System-generated presets (D1.3) can also seed a draft for audition.

**D1.5 — `VizPreset` = per-user reusable "looks" library**, independent of audio; optional pinned default look per song. Not version-scoped.

**D1.6 — A/B compare = ephemeral client state** (two in-memory chain states); no persistent A/B entity. "A/B against reference" resolves a second `songVersionId` only.

**Candidate entities so far:** `RackPreset`, `RackDraft`, `VizPreset` (+ provenance edges `copiedFromId`, `source`).
**Open downstream:** preset `source` interacts heavily with Domain 2 (suggestions) and Domain 5 (what coach/analysis-generated presets we store + their acceptance telemetry).

---

## Domain 2 — Feedback layer (comments + suggestions + merge) — DECISIONS

**D2.1 — `Comment` is threaded from day one and anchored to a version.**
`Comment { id, songVersionId, parentId?|null, t?|null, authorId, body, status, suggestionId?, createdAt }`
- `parentId` → one-or-more-level reply threads (chosen over flat).
- `t` = optional waveform timestamp (null = general/track-level note).
- `status ∈ { open, resolved, pinned, hidden }` — author-controlled.
- Comments stay on their origin version; they do **not** auto-migrate to v4.

**D2.2 — A `Suggestion` wraps a reviewer-authored full-chain preset.**
`Suggestion = RackPreset(source=reviewer)` + the `Comment` it's attached to + `status ∈ { proposed, auditioned, accepted, rejected }`.

**D2.3 — "Accept" = fork-to-preset; cherry-pick is client-side only.**
One acceptance path: suggestion's full chain loads into the author's **draft**, author edits freely, saves as their own `RackPreset` (`source=user`, `copiedFromId`→suggestion). **No per-param merge records** in the DB. "Replace vs cherry-pick" is a UI affordance, not a schema branch. (Does NOT spawn a new version — that would contradict D1.1.)

**D2.4 — ⭐ Adopted presets/suggestions feed a `GamePlan` (new cross-cutting entity).**
The user's real goal is the *next version*. Coach (`source=coach`), reviewer (`source=reviewer`), and analysis (`source=analysis`, the prototype's `PLAN_ITEMS`) all converge into a **Game Plan**: the change-set the user takes back to their DAW. An adopted preset = evidence of "what this version needed" → **version-to-version comparison analysis** signal. Full model deferred to Domain 5.

**Candidate entities added:** `Comment`, `Suggestion` (as a typed `RackPreset` + status), `GamePlan` + `GamePlanItem` (Domain 5).

---

## Domain 3 — Room session lifecycle — DECISIONS

**D3.1 — `ListeningSession` is a persistent record.** `{ id, songVersionId, hostId, startedAt, endedAt, status }`. A version accrues a history of many sessions.

**D3.2 — ⭐ Session stored JSON-first (mirrors `analyses.final_json`).**
- `ListeningSession.events_json` = the **raw event stream** (reactions, chat, presence join/leave, control grants) appended live. Cheap, denormalized, replayable.
- A **derived `SessionRecap` object** extracts the *key data points* into a useful structured shape for further analysis + feedback: `hottestMoments[]`, `reactionHistogram`, `peakConcurrency`, attendance. (Same raw-blob → derived-rollup philosophy as the analysis pipeline — don't over-normalize into a table per event type.)

**D3.3 — Recap auto-generated at session end; publishing is host opt-in.** Host chooses whether hottest moments post as timestamped `Comment`s on the version's View thread (Room→View lifecycle). Keeps the author's feedback surface uncluttered.

**D3.4 — Chat retained** inside the session event JSON (subject to Domain 6 privacy controls).

**D3.5 — Control-grant events live in the stream and are provenance.** A preset saved *during* a session references the `sessionId` + the active grant — the backbone for the cross-author adoption case (Domain 4).

**Candidate entities added:** `ListeningSession` (+ `events_json`), `SessionRecap` (derived). `actorRef` shape defined in Domain 4.

---

## Domain 4 — Person-to-person interactions — DECISIONS

**Flagship case proven against the model** (A author+host grants rack to B; B saves a good chain; A adopts it):
ListeningSession(host=A) → ControlGrant(rack→B) → B drives the **session shared live chain** → B saves = **Suggestion on A's version** → A adopts via fork-to-preset (`copiedFromId`→B), credited to B.

**D4.1 — `actorRef` is the universal "who":** `{ type: 'user' | 'anon', userId? , anonId?, handle, hue }`. Used by reactions, comments, presets, grants, participants.

**D4.2 — Roles are contextual, not global** — owner/author, reviewer, host, listener, controller(scope) — resolved per track/version/session. Not stored as user-level roles.

**D4.3 — ⭐ Non-owner save = a Suggestion on the owner's version ONLY (unified path).** Whether a chain is proposed by an async **View reviewer** or a live **Room grantee**, it lands as the *same* `Suggestion` entity on the owner's version. The saver does **not** retain a personal library copy. Room-handoff-save and View-suggestion are one feature, one data path.

**D4.4 — Full anonymous participation.** Anon actors (ephemeral `anonId`) may react, chat, comment, suggest, and bookmark.
- Reconciliation notes the PRPs must handle:
  - `anonId` should be **stable within a link/session** so one anon's artifacts cluster (and can be moderated as a unit).
  - **Notifications to anon are best-effort / in-session only** — no durable inbox (see D4.5, Domain 7).
  - **Anon bookmarks need a fallback destination** (no account library) → browser-local or link-scoped (Domain 5).
  - Larger abuse surface → lean on owner gating (Domain 6) + rate limits.

**D4.5 — Adoption credit + notify.** Adopted preset shows the provenance chain (visible credit to original author); original author is **notified** (Domain 7). For an **anon** original author, credit shows the ephemeral handle and async notification degrades to none/in-session.

**D4.6 — Universal provenance on durable artifacts:** `{ authorRef, createdInSessionId?, viaGrantId?, copiedFromId? }`.

**Candidate entities added:** `ControlGrant`, `SessionParticipant`, `actorRef` (value shape), anon-identity handling. Note: `Suggestion` is now the single convergence point for *all* non-owner chain proposals (async + live).

---

## Domain 5 — Analytics, Game Plan & bookmarking — DECISIONS

**D5.1 — `GamePlan` is per-version.** `{ id, songVersionId, status }` — "what this mix needs," the snapshot that informs v(n+1).

**D5.2 — ⭐ `GamePlanItem` is the unified actionable drain.** `{ id, gamePlanId, source ∈ {coach, reviewer, analysis, adopted_preset, recap}, refId, title, detail, targetChange, status ∈ {open, applied, dismissed}, createdAt }`. **Every** suggestion path defined in this session (coach AI, reviewer suggestion, analysis `PLAN_ITEMS`, adopted preset, Room recap highlight) drains into this one list — it is the user's DAW change-set for the next version.

**D5.3 — `VersionComparison` derived artifact** `{ fromVersionId, toVersionId, metricDeltas, planItemsAddressed[] }` → powers the existing `DeltaCard` placeholder and closes the v(n)→v(n+1) loop (did planned changes land + did metrics move).

**D5.4 — `Bookmark`** `{ id, actorRef, songVersionId, t?|null, note?, createdAt }`; anon → browser-local/link-scoped fallback (D4.4). **Signal:** aggregate count to author by default; named bookmarkers' identity shown only on opt-in; anon always counted anonymously.

**D5.5 — Outcome telemetry: `apply → kept | reverted` events** for coach + preset suggestions. Improves coach quality over time and tells the Game Plan what actually *stuck*. Lives in session `events_json` for live, a small append log for solo Work.

**Candidate entities added:** `GamePlan`, `GamePlanItem`, `VersionComparison`, `Bookmark`, outcome-event log.

---

## Domain 6 — Permissions & sharing — DECISIONS

**D6.1 — Visibility is per-version with song-level defaults.** `Private / Unlisted / Public`. Song supplies defaults for new versions; each version can override. Reuses the existing v1 `share_token`. (Keep v1 private while sharing v3.)

**D6.2 — `ShareSetting` block on the version gates which controls render.**
`{ visibility, commentsPolicy ∈ {off, link, named}, suggestionsAllowed, bookmarkingAllowed, sessionHostPolicy, sessionJoinPolicy }`. This is the spec's central rule: gates decide what even renders in View/Room.

**D6.3 — Lightweight `Invite` entity.** `{ scope ∈ {version, session}, invitedActorRef, role, token, status }` — supports "named accounts only" gating and the Room invited-roster. Needed for non-public collaboration.

---

## Domain 7 — Notifications — DECISIONS

**D7.1 — Unified `Notification` entity.** `{ id, recipientUserId, type, refId, read, createdAt }`.

**D7.2 — In-app notification center only for now.** No email design this pass (defer to the planned `maintenance`/`send_email` actor later). Anon recipients: best-effort/none (D4.5).

**D7.3 — Per-event for high-signal, digest for noisy.** Immediate: new comment, new suggestion, suggestion accepted, **preset adopted** (D4.5), @mention. Digested: bookmarks, reactions.

---

## Cross-cutting — DECISIONS

**X.1 — Coach in View is author-only, never gateable.** Reviewers give human feedback only; the Coach AI is strictly the version owner's tool. Cleanest billing (no reviewer-spend ambiguity) + no leaking the author's analysis into reviewer-driven coach prompts.

**X.2 — Work mode is strictly private, zero social signal.** No presence/comments/bookmark/social data surfaces in Work until the author explicitly publishes to View. Private working notes stay private across the transition.

---

## Consolidated entity model (greenfield)

Anchor identity: **`actorRef`** `{ type: user|anon, userId?, anonId?, handle, hue }` — used everywhere a "who" is recorded.

**Mode `mode ∈ { work, view, room }`** replaces today's `solo|room` SegBar (the seam called out in PORTING_GUIDE §0).

| Entity | Shape (key fields) | Associates with | Notes |
|--------|--------------------|-----------------|-------|
| `RackPreset` | id, name, **source** ∈ {user,coach,analysis,reviewer}, authorRef, chain{order[],mod{}}, **songVersionId (origin)**, copiedFromId?, createdInSessionId?, viaGrantId?, createdAt | Version (origin), Song | Full-chain snapshot. `source` is first-class (D1.3). Provenance edges (D4.6). |
| `RackDraft` | userId, songVersionId, chain{}, updatedAt | (user, version) | Autosaved working state (D1.4). System-gen presets can seed it. |
| `VizPreset` | id, name, authorId, stages[], viz{}, isSongDefault? | User (library), Song (optional default) | Per-user reusable looks (D1.5). |
| `Comment` | id, songVersionId, parentId?, t?, authorRef, body, status ∈ {open,resolved,pinned,hidden}, suggestionId?, createdAt | Version | Threaded (D2.1). |
| `Suggestion` | id, songVersionId, fromActorRef, rackPresetId, commentId?, **createdInSessionId?**, status ∈ {proposed,auditioned,accepted,rejected} | Version | **Single convergence point** for all non-owner chain proposals — async View *and* live Room (D2.2, D4.3). |
| `ListeningSession` | id, songVersionId, hostId, startedAt, endedAt, status, **events_json** | Version | Raw event stream JSON-first (D3.1/D3.2). |
| `SessionRecap` | sessionId, hottestMoments[], reactionHistogram, peakConcurrency, attendance | Session | Derived; publish→View is host opt-in (D3.3). |
| `ControlGrant` | sessionId, scope ∈ {rack,visuals}, granteeRef, grantedBy, grantedAt, revokedAt | Session | Provenance backbone (D3.5/D4). Lives in stream; may also be a row. |
| `Bookmark` | id, actorRef, songVersionId, t?, note?, createdAt | Version | Anon→local fallback. Aggregate-count signal, identity opt-in (D5.4). |
| `GamePlan` | id, songVersionId, status | Version | "What this mix needs" (D5.1). |
| `GamePlanItem` | id, gamePlanId, source ∈ {coach,reviewer,analysis,adopted_preset,recap}, refId, title, detail, targetChange, status ∈ {open,applied,dismissed} | GamePlan | **Unified drain** for every suggestion path (D5.2). |
| `VersionComparison` | fromVersionId, toVersionId, metricDeltas, planItemsAddressed[] | two Versions | Powers `DeltaCard`; closes the loop (D5.3). |
| `ShareSetting` | songVersionId, visibility ∈ {private,unlisted,public}, commentsPolicy, suggestionsAllowed, bookmarkingAllowed, sessionHostPolicy, sessionJoinPolicy | Version | Gates which controls render (D6.1/D6.2). |
| `Invite` | id, scope ∈ {version,session}, invitedActorRef, role, token, status | Version/Session | Named-account gating + Room roster (D6.3). |
| `Notification` | id, recipientUserId, type, refId, read, createdAt | User | In-app only for now (D7). |
| outcome events | apply→kept/reverted, refId, actorRef, t | Session/Work log | Coach-quality + Game Plan signal (D5.5). |

### The "private notes" entity
The prototype `TRACK.notes[]` (timestamped to-fix markers, Work-only) maps to a **`WorkNote`** `{ id, songVersionId, userId, t?, body, pinned }` — strictly private (X.2). Distinct from `Comment` (which is the View social-feedback entity).

## Open-questions resolution (both specs)

| Spec open question | Resolution |
|--------------------|------------|
| Version model (immutable vs label) | **Immutable audio asset + analysis; rack is overlay** (D1.1) |
| Preset ↔ version binding | **Origin + copyable across versions** w/ provenance (D1.2) |
| Suggestion merge (replace vs cherry-pick) | **Fork-to-preset; cherry-pick is UI-only**, no per-param merge records (D2.3) |
| Anonymous participation | **Full anon participation** w/ reconciliation notes (D4.4) |
| Bookmark signal | **Aggregate count default, identity opt-in** (D5.4) |
| Room recap → View | **Auto-generate, host opt-in to publish** (D3.3) |
| Coach in View | **Author-only, never gateable** (X.1) |
| Notifications | **Unified in-app Notification, per-event + digest** (D7) |
| Work privacy | **Strictly private, zero social signal** (X.2) |
| Versions vs presets (same thing?) | **Distinct concepts, related by `songVersionId`** (D1.1/D1.2) |

## Reconciliation notes for the PRPs (carry-forward risks)
1. **Anon identity vs notifications/bookmarks/credit** — `anonId` stable per link/session; async notify degrades to none; anon bookmarks need local fallback; full-anon widens abuse surface → owner gates (D6) + rate limits.
2. **`mode` seam** — Work/View/Room replaces `solo|room`; changes which rail panels mount (PORTING_GUIDE §0). Decide before frontend port (separate thread).
3. **Existing-schema reconciliation pass — ✅ DONE 2026-06-25** → see `listen-v3-schema-reconciliation-2026-06-25.md`. Key surprises: 4 entities already exist (`SongVersion`, `session_notes`=our WorkNote, `track_comments`=Comment partial, `track_bookmarks`=Bookmark partial); the **anon-actor pattern is already solved** in `track_comments`; the **per-user-overlay pattern** exists in `verdict_user_state`; **sharing is analysis-scoped and must migrate to version-scoped** (biggest delta); `Verdict.fix.dsp_chain` is the existing "change" currency to reuse; the **apply-to-rack loop is an unbuilt gap** that the Game Plan depends on.
4. **Session shared live chain ≠ personal `RackDraft`** — the Room has a host-synced session chain the controller drives; saving from it creates a `Suggestion` (D4.3), not a mutation of anyone's draft.
5. **`GamePlanItem` already half-exists** as the prototype's analysis `PLAN_ITEMS` — that's the `source=analysis` seed; unify rather than build parallel.

---

## Suggested PRP slices → SUPERSEDED by the reconciliation doc
The post-reconciliation, re-sequenced slice plan (accounting for what already exists) lives in
`listen-v3-schema-reconciliation-2026-06-25.md → "Revised PRP slice plan"`. Headline change: slice 1 is no
longer "Versions & presets" (Versions already exist) but **Rack Preset & Draft foundation + the apply-to-rack
loop** — the genuine unblocker. PRP-1 drafted at `PRPs/listen-v3-rack-preset-foundation.md`.
