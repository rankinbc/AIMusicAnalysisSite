# Listen V3 — Schema Reconciliation (greenfield model → real Spectr schema)

**Date:** 2026-06-25 · **Companion to:** `brainstorming-session-2026-06-25-listen-modes-datamodel.md`
**Method:** mapped the greenfield entity model from the brainstorm against the *actual* current schema (BFF EF Core entities + `shared/` SQLAlchemy mirror + v2 frontend types) via three parallel code surveys.

---

## TL;DR — what changed once we looked at the real schema

1. **The schema is much further along than the prototype's greenfield model assumed.** 23 tables already exist.
2. **4 of our "new" entities already exist** (extend, don't create): `SongVersion`, `session_notes` (= our `WorkNote`), `track_comments` (= our `Comment`, partially), `track_bookmarks` (= our `Bookmark`, partially).
3. **The anonymous-actor pattern is already solved** in `track_comments` (`author_user_id` nullable + `author_display_name` + `author_ip_hash` salted SHA-256, 90-day TTL). That **is** our `actorRef` anon shape (D4.4) — reuse it everywhere.
4. **The per-user-overlay pattern is established** (`verdict_user_state` composite PK `(verdict_id,user_id)` with `dismissed/applied/user_modified_fix/feedback`). That's the template for adoption/outcome state (D4.5, D5.5).
5. **Sharing is at the WRONG SCOPE** for the V3 model: `share_token` lives on `analyses` (analysis-scoped, binary `share_show_verdicts`). D6.1 wants **version-scoped** visibility + capability gates. This is a **scope migration**, not an additive change — the single biggest structural delta.
6. **The "change" representation already exists**: `Verdict.fix.dsp_chain` (`VerdictDspOp[] = {type, params}`). Our `RackPreset.chain` and `GamePlanItem.targetChange` must **align with `dsp_chain`**, not invent a parallel shape.
7. **No rack persistence exists at all** — rack state in `useAudioGraph` is in-memory, resets on reload; `vizPresets` is localStorage-only (VizState, no audio). So `RackPreset`/`RackDraft` are genuinely net-new; `VizPreset` must be promoted from localStorage to a server table.
8. **Build discipline is EF-Core-first:** every new table = C# entity + EF migration (+ raw SQL for partial indexes) **then** mirror in `shared/aimusic_shared/models.py`. The worker reads the mirror. `shared/models.py:1-6` explicitly forbids Python-first columns.

---

## Entity reconciliation table

Legend: ✓ EXISTS (reuse) · ⚠ EXTEND/MIGRATE · ✦ NET-NEW

| Greenfield entity (brainstorm) | Existing reality | Verdict | Reconciliation work |
|---|---|---|---|
| **Version** (immutable audio+analysis) | `song_versions` — `file_path`, `stem_paths`, `als_project_json`, `is_current`, unique `(song_id,version_number)` (`SongVersion.cs`) | ✓ | **Already exactly D1.1.** Optional: add the `is_current` partial-unique index (currently a plain bool — latent dup risk, see CLAUDE.md). |
| **WorkNote** (private timestamped notes) | `session_notes` — `version_id,user_id,t_seconds,text,pinned` (`SessionNote.cs`) | ✓ | **It already IS WorkNote** (X.2 private, version-scoped). No new table. Maybe rename concept in docs only. |
| **actorRef** (user\|anon identity) | `track_comments.author_user_id` (nullable) + `author_display_name` + `author_ip_hash` (salted, 90-day TTL) | ✓ pattern | Reuse this triple as the canonical anon shape across all new social tables (D4.4). |
| **Comment** (threaded, version-scoped, status, suggestion link) | `track_comments` — polymorphic `target_share_token`/`target_published_track`, nullable author (anon), `timestamp_seconds` (null=general), `body`, `deleted_at` (`TrackComment.cs`) | ⚠ | Add: `target_version_id` (re-scope to version), `parent_id` (threading D2.1), `status` (open/resolved/pinned/hidden), `suggestion_id`. Anon + timestamp + soft-delete already there. |
| **Bookmark** | `track_bookmarks` — `user_id`, polymorphic target, authed-only (`TrackComment.cs:43`) | ⚠ | Add: `target_version_id`, optional `t_seconds`, `note`; add anon fallback (D4.4) + identity-opt-in signal (D5.4). |
| **ShareSetting** (visibility + per-capability gates) | `analyses.share_token` + `share_show_verdicts` + `share_enabled_at` (binary, **analysis-scoped**) | ⚠⚠ | **Scope migration** → version-level: `visibility` enum (private/unlisted/public), `comments_policy`, `suggestions_allowed`, `bookmarking_allowed`, `session_host_policy`, `session_join_policy`. Re-point comment/bookmark targets. Note: `target_published_track` UUID already hints at a planned track-level public target — aligned. |
| **VersionComparison** (v↔v) | `compare_cache` — `track_version_id` × `reference_id`, `match_score`, `sub_scores`, `delta_metrics`, `suggestions` (`CompareCache.cs`) | ⚠ | Compare infra exists but for **version↔reference**. v↔v (D5.3, DeltaCard) is a new variant — either a sibling table or generalize the target. |
| **VizPreset** (per-user looks) | `vizPresets.ts` localStorage (VizState+stage only, no audio) | ⚠ | Promote to a server table keyed by user (D1.5). Small. |
| **GamePlanItem** `source=analysis` seed | `verdicts` + `verdict_user_state.applied`; prototype `PLAN_ITEMS`; `Verdict.fix.dsp_chain` | ⚠/✦ | New `game_plan_items` table, but `source=analysis` rows **derive from verdicts**; reuse `dsp_chain` for `targetChange`. |
| **RackPreset** (full-chain snapshot, source, provenance) | nothing (rack state in-memory only) | ✦ | Net-new. `chain` aligns with `audio/state.ts` module-state shapes; `source` ∈ {user,coach,analysis,reviewer}; provenance `copied_from_id/created_in_session_id/via_grant_id`. |
| **RackDraft** (autosave per user+version) | nothing | ✦ | Net-new. |
| **Suggestion** (unified non-owner proposal) | nothing (verdicts aren't user-proposed) | ✦ | Net-new; reuse `verdict_user_state` overlay pattern + `dsp_chain`. Single convergence point for View + Room (D4.3). |
| **ListeningSession** (+`events_json`) | nothing (room is UI-only mock) | ✦ | Net-new, JSON-first (D3.2), mirrors `analyses.final_json` style. |
| **SessionRecap** (derived) | nothing | ✦ | Net-new (derived object/column off the session). |
| **ControlGrant** | nothing | ✦ | Net-new (or events_json entries promoted to rows for provenance — D3.5). |
| **GamePlan** | nothing | ✦ | Net-new, per-version (D5.1). |
| **Invite** | nothing | ✦ | Net-new (D6.3). |
| **Notification** | nothing | ✦ | Net-new, in-app only (D7). |
| **outcome events** (apply→kept/reverted) | `usage_events` (billing only); `verdict_user_state.applied` | ⚠ | New lightweight event type/table (D5.5); don't overload billing `usage_events`. |

**Count:** 4 reuse-as-is · 6 extend/migrate · 10 net-new.

---

## Load-bearing architectural deltas (these drive PRP scope)

**Δ1 — Sharing scope migration (analysis → version) is the riskiest slice.**
`share_token` is on `analyses`; comments/bookmarks target `share_token`. V3 needs visibility+gates on the **version**. This touches the polymorphic FK on `track_comments`/`track_bookmarks`. Sequence it carefully and additively (add `target_version_id` alongside the existing token target; backfill; don't drop the token path until the View UI cuts over). The pre-existing `target_published_track` column shows the team already planned a non-analysis target — lean on that intent.

**Δ2 — `dsp_chain` is the universal "change" currency.**
`Verdict.fix.dsp_chain` (`{type, params}[]`) already represents "a fix." Coach/analysis-generated presets (D1.3), reviewer suggestions, adopted presets, and `GamePlanItem.targetChange` should **all** speak `dsp_chain` (or a superset that also captures chain `order` + per-module `enabled`). This prevents two parallel change formats and makes the **apply-to-rack loop** uniform.

**Δ3 — The apply-to-rack loop is an existing GAP, and it's the keystone of the Game Plan.**
Today `Verdict.fix.dsp_chain` is **not** auto-applied to the `useAudioGraph` rack — `applied` is just a flag. The V3 vision (coach emits full-chain preset → user auditions in draft → adopts) **requires building that apply path**: `dsp_chain`/`RackPreset.chain` → `setEffectParams`/`reorder`. This is net-new wiring and should live in the preset-foundation slice because everything social depends on it.

**Δ4 — Reuse the two proven patterns, don't reinvent.**
- *Anon identity:* `nullable author_user_id + display_name + ip_hash(90d TTL)` → use for all anon artifacts.
- *Per-user overlay on a shared artifact:* `verdict_user_state` composite-PK pattern → use for suggestion status, adoption, outcome telemetry.

**Δ5 — Billing/entitlement is mature; new actions must slot in.**
`subscriptions` + `credit_ledger` (append-only signed) + `usage_events` (append-only, `analysis|coach_message`) + `feature_flags` (operator gates, BFF-owned, worker reads via `text()`). **Hosting a Room, running coach in Listen, or generating an AI preset are billable/gateable actions** — resolve `session_host_policy` (D6.2) through the existing `EntitlementService` + `feature_flags`, and add `usage_events` types rather than new meters. `tier` is on `User` ('free'|'pro'); `EntitlementsDto.tier` adds 'credits'.

**Δ6 — Coach is per-(analysis,user); Listen is per-version.**
`conversations`/`coach_messages` key on `analysis_id`. The Listen page keys on `version_id`. Since a version has one current analysis, coach-in-Listen must resolve version→current-analysis to reuse the existing coach plumbing (and X.1 keeps it author-only, which matches the per-user coach billing already in place).

---

## Build discipline (applies to every PRP)

1. **EF-Core-first:** add C# entity in `Spectr.Data/Entities/` → `dotnet ef migrations add` → append raw SQL for any partial/unique index in `Up()`/`Down()` → **then** mirror in `shared/aimusic_shared/models.py` (worker reads the mirror; never Python-first per `models.py:1-6`).
2. **snake_case columns** via `[Column(...)]`; UUID PKs via `gen_random_uuid()` (pgcrypto); `citext` for case-insensitive text.
3. **Endpoints** group per resource in `Spectr.Bff/Endpoints/*Endpoints.cs`; DTOs as records in `DTOs/`; frontend types hand-mirrored in `src/api/types.ts`.
4. **Worker actors** (if any new async work — recap synthesis, AI-preset generation) are dramatiq, sync `def`, on the right queue (recap/AI-preset = `analysis-paid`, never `default`).
5. **Frontend** v2: CSS Modules + tokens, TanStack Query hooks, no localStorage for server state.

---

## Revised PRP slice plan (re-sequenced for what already exists)

Dependency-ordered. Each is a `/generate-prp` candidate.

1. **PRP-1 · Rack Preset & Draft foundation + apply loop** ✦ *(start here — pure additive, unblocks all social)* — **DRAFTED → `PRPs/listen-v3-rack-preset-foundation.md`**
   `rack_presets` (full chain + `source` + provenance), `rack_drafts` (autosave per user+version), promote `viz_presets` to server. **Build the `dsp_chain`/chain → `useAudioGraph` apply path (Δ3).** No sharing/social deps.
2. **PRP-2 · Version-scoped sharing & permissions** ⚠ *(the Δ1 migration — gates everything in View/Room)* — **DRAFTED → `PRPs/listen-v3-version-sharing-permissions.md`**
   `share_settings` (1:1 version) visibility + gate bundle, `Invite`, `AccessService` (Work/View/Room resolution), anon `/v/{token}` View entry. **Additive** — existing analysis-share path untouched; comment/bookmark re-target deferred to PRP-3/6.
3. **PRP-3 · View feedback layer** ⚠+✦ — **DRAFTED → `PRPs/listen-v3-view-feedback-suggestions.md`**
   Extend `track_comments` (threading, status, version target, suggestion link — the one polymorphic-CHECK migration); net-new `Suggestion` (the unified non-owner-proposal path, D4.3 — carries `chain` directly, no phantom preset); accept = fork-to-preset (reuses PRP-1 apply loop). All routes gated via PRP-2 `AccessService`. UI contract written at `design_handoffs/.../LISTEN_V3_UI_CONTRACT.md`.
4. **PRP-4 · Room sessions** ✦ *(largest; depends on PRP-2 gates)* — **DRAFTED → `PRPs/listen-v3-room-sessions.md`**
   `listening_sessions`+`events_json`, `control_grants`, presence/chat/reactions, derived `recap_json`, recap→View publish (`synthesize_recap` actor on analysis-paid). **Real-time = generalization of the existing coach SSE+Redis-pubsub pattern (zero new infra; no WebSocket/SignalR).** Durability = Redis live-buffer flushed to events_json at end. Room-grantee-save reuses PRP-3 `Suggestion` (sets `created_in_session_id`); adds FKs for `via_grant_id`/`created_in_session_id`.
5. **PRP-5 · Game Plan & version comparison** ⚠+✦ — **DRAFTED → `PRPs/listen-v3-game-plan-comparison.md`**
   `game_plans`(1:1 version)/`game_plan_items` (unified drain; `source=analysis` seeds from verdicts; drain hooks on accept/adopt/recap insert the rest), `version_comparisons` (v↔v sibling of `compare_cache`) fills the existing `DeltaCard`, `apply_outcomes` telemetry (D5.5, separate from billing). `target_change` reuses `dsp_chain`. Owner-only (X.2); no new worker actor.
6. **PRP-6 · Bookmarking** ⚠ — **DRAFTED → `PRPs/listen-v3-bookmarking.md`**
   Extend `track_bookmarks` (version target + the 2nd 3-way CHECK migration, `t`, `note`, `identity_visible`, anon-capable via nullable user_id + anon triple); anon bookmark via `/v/{token}` (server row for the count, browser-local for the anon's own retrieval); owner signal = count default + identity opt-in (D5.4). Reuses AnonActor + canBookmark gate. No worker actor.
7. **PRP-7 · Notifications** ✦ — **DRAFTED → `PRPs/listen-v3-notifications.md`**
   `Notification` center + `INotificationSink` (implements the seam PRP-3/4/6 declared); per-event rows (comment/suggestion/accept/mention) + rolling daily `bookmark_digest` upsert (no scheduler — reuses the partial-unique idempotency pattern); in-app only (D7.2), anon recipient = no-op (D4.5).

---

## ✅ ALL 7 PRPs DRAFTED (2026-06-25)
Full epic on paper, dependency-consistent. Build order = the numbering (1→7); PRP-1 (apply loop) + PRP-2
(AccessService/gates) are the spine everything reuses. Companion UI contracts for the React thread:
`LISTEN_V3_UI_CONTRACT.md` (backend→UI) + `LISTEN_V3_ROOM_UI_SEAMS.md` (UI→backend, Room). Next: `/execute-prp` from
PRP-1, or a cross-PRP review pass. Page implementation remains the separate React thread.

## Adversarial review (2026-06-25) — gaps folded back in
A cynical review ran across all 7 PRPs. Each PRP now carries a **"Known Gaps / Must-Resolve"** section (⛔ blocker /
⚠ in-flight). **Execution blockers** (resolve before/at PRP-1): nullable `RackPreset.user_id` + the unowned coach/analysis
preset slice (PRP-1 G1); share-token auth ≠ JWT + durable anon identity (PRP-2 G1/G2); the `IGamePlanSink` seam (PRP-3 G1);
session durability + chain-key eviction + pub/sub hydrate race (PRP-4 G1/G2/G3).

### ✅ PRP-0 drafted — pre-flight that owns the CROSS-CUTTING blockers → `PRPs/listen-v3-spine-primitives.md`
Builds FIRST (position 0; new order = **0→1→…→7**). No DB migration. Resolves: durable anon identity (replaces ip_hash —
PRP-2 G2/PRP-6 G1), opaque-token auth abstraction so share/session tokens skip the JWT `?t=` path (PRP-2 G1), the no-op
`INotificationSink`/`IGamePlanSink` sink convention that removes backward build deps (PRP-3 G1, PRP-7), a Redis rate-limiter
for anon abuse (PRP-3 G2/PRP-7 G1), and the ratified conventions for nullable preset `user_id` + library filter (PRP-1 G1/G2).
The **PRP-4-internal** blockers (G1/G2/G3 — single consumer) stay folded in PRP-4, resolved when it's built.

### ⛔ Two UNOWNED slices surfaced (no existing PRP covers them)
- **PRP-8 candidate · Coach/analysis full-chain preset generation** (D1.3) — a worker actor that writes `source=coach/analysis`
  `RackPreset` rows the user can audition. The `source` enum already reserves these values; nothing produces them. Depends on PRP-1.
- **PRP-9 candidate · Coach on the Listen page** (Δ6, §04 "Coach primary in Work") — wire the existing per-analysis coach
  plumbing into the version-keyed page (resolve `version → current analysis → conversation`). X.1 gates it owner-only, but
  no slice builds it. Could fold into PRP-5 (the Plan tab) or stand alone.
