# Listen V3 — UI ↔ Backend Contract

**For:** the React UI thread porting the V3 Listen page.
**Authority:** shapes here are derived from the drafted PRPs and the data-model decisions.
**Status legend:** 🔒 LOCKED (PRP drafted: `PRPs/listen-v3-rack-preset-foundation.md`, `PRPs/listen-v3-version-sharing-permissions.md`) · 🟡 STABLE-BUT-UNDRAFTED (PRP-3 not yet written; data shape is settled by decisions D2.x/D4.x — safe to mock against; **endpoint paths** may still move).
**Wire casing:** BFF serializes C# records to **camelCase JSON** (matches existing `types.ts`: `shareToken`, `versionNumber`, `isCurrent`). All shapes below are camelCase as the client sees them.

---

## Q1 — Mode gating is server-driven. Key off `AccessDto`, not raw visibility. 🔒

There are **two distinct shapes** — don't conflate them:

- **`AccessDto`** = the *resolved* access decision for the current actor. **This is what the SegBar + rail read.** The server already collapses `visibility × role × policy × tier × flags` into booleans so the client never re-derives permission.
- **`ShareSettingsDto`** = the *owner-facing* settings the uploader edits (the share panel). The viewer never keys layout off this.

```ts
// 🔒 GET /api/versions/{versionId}/access   (authenticated actor)
//    anon viewers get the equivalent gates embedded in GET /api/v/{token} (see Q-public)
interface AccessDto {
  role: 'owner' | 'reviewer' | 'invited' | 'anon' | 'none';
  canWork: boolean;        // owner only (decision X.2 — Work is strictly private)
  canView: boolean;        // visibility != private AND actor permitted
  roomHostable: boolean;   // owner|invited per policy AND room_hosting_enabled AND tier >= room_host_min_tier
  roomJoinable: boolean;   // per session_join_policy + invite
  coachAvailable: boolean; // owner only (decision X.1 — coach never for non-owner)
  gates: {
    canComment: boolean;   // already resolves comments_policy (off|link|named) + anon rules
    canSuggest: boolean;
    canBookmark: boolean;
  };
}
```

**SegBar wiring:** render Work iff `canWork`, View iff `canView`, Room iff `roomHostable || roomJoinable`. Render the Coach rail iff `coachAvailable`. Render comment composer iff `gates.canComment`, the "suggest a chain" affordance iff `gates.canSuggest`, the bookmark button iff `gates.canBookmark`. **Do not** branch the SegBar on `visibility` — that's the owner's setting, not the viewer's capability.

```ts
// 🔒 GET /api/versions/{versionId}/share   (owner only) — the SETTINGS PANEL shape
// 🔒 PUT /api/versions/{versionId}/share   (owner) — body = Partial<ShareSettingsDto> (mutable fields)
// 🔒 POST /api/versions/{versionId}/share/rotate  -> { shareToken }
interface ShareSettingsDto {
  visibility: 'private' | 'unlisted' | 'public';
  shareToken: string | null;            // minted lazily when visibility leaves 'private'
  showVerdicts: boolean;
  commentsPolicy: 'off' | 'link' | 'named';   // 'named' => account required; 'link' => anon allowed (D4.4)
  suggestionsAllowed: boolean;
  bookmarkingAllowed: boolean;
  sessionHostPolicy: 'owner_only' | 'invited';
  sessionJoinPolicy: 'invited' | 'link' | 'public';
}
```

> Exact field names confirmed: **visibility, commentsPolicy, suggestionsAllowed, bookmarkingAllowed, sessionHostPolicy** (= "who can host"), **sessionJoinPolicy** (= "who can join"). Note "comments-allowed" is a 3-value `commentsPolicy`, not a boolean; "suggested-presets-allowed" is `suggestionsAllowed`.

```ts
// 🔒 GET /api/v/{token}  (AllowAnonymous) — the View entry for a shared link
interface SharedVersionDto {
  versionId: string;
  songName: string;
  producerHandle: string | null;
  // ...version + current-analysis summary...
  gates: AccessDto['gates'];   // anon-resolved canComment/canSuggest/canBookmark
}
// 🔒 GET /api/v/{token}/audio  (AllowAnonymous, Range) — playback for the shared version
```

---

## Q2 — Server = authority, Client = layout. The §04 matrix IS canonical (spec-matrix-in-code). 🔒

Your assumption is correct. **There is no server-driven layout config and we don't intend to build one.** The split:

| Concern | Owner | Example |
|---|---|---|
| **Authority** (security; must come from server, never trust client) | **Server** via `AccessDto` | "can this actor comment / host a room / see the coach / write to the rack" |
| **Layout** (presentation; which surfaces show/hide/repurpose per mode) | **Client**, driven by current mode + the spec §04 matrix in code | "rack utility-monitor vs full-edit; visuals utility/personal/full; coach primary/reference/hidden; metering prominent/minimal" |

So: **encode the §04 matrix as a client-side `MODE_SURFACE_MATRIX` constant** keyed by `mode → surface → presentation`. The one place authority and layout meet is **rack read-only in View**: render it read-only per the matrix, but the *enforcement* is that **no write endpoint exists for a non-owner to mutate the owner's rack** (a non-owner's only write path is creating a Suggestion — see Q4). Treat `AccessDto.gates`/role as the gate for *actions*, the matrix as the gate for *presentation*.

---

## Q3 — PRP-1 names (presets / draft / viz / apply loop). 🔒

**The chain shape** (the currency for save/recall/coach-apply; mirrors `audio/state.ts`):
```ts
interface Chain {
  order: EffectId[];                                   // insert order; pitch is NOT in here
  modules: Partial<Record<EffectId, ModuleState>>;     // per-module { enabled, ...params }; eq => { enabled, bands: EqBand[] }
  masterBypass: boolean;
}
```

**Apply loop** (`features/listen/chainApply.ts` — framework-agnostic, reused by recall, coach-apply, and View suggestion-audition):
```ts
function applyChainToGraph(graph: AudioGraphHandle, chain: Chain): void;       // full chain -> setEffectParams per id + reorder + masterBypass
function snapshotChainFromGraph(graph: AudioGraphHandle, moduleState): Chain;  // inverse, for Save + autosave
```

**Prototype seam → real wiring map** (so your mock `savePreset`/`recallPreset`/`applyCoach` line up):

| Prototype seam (`useRackState`) | Real call |
|---|---|
| `savePreset(name)` | `snapshotChainFromGraph(graph, state)` → `POST /api/versions/{id}/rack/presets` |
| `recallPreset(id)` | fetch preset → `applyChainToGraph(graph, preset.chain)` |
| `applyCoach(patch)` | patch IS a `Partial<modules>`; either `applyChainToGraph` with merged chain, or call `graph.setEffectParams(id, patch[id])` per id (apply loop does exactly this internally) |
| autosave (debounced) | `snapshotChainFromGraph` → `PUT /api/versions/{id}/rack/draft` |

**DTOs + endpoints:**
```ts
// 🔒 rack presets  — VERSION-SCOPED (owner derived via song_version → song → user; NO userId)
interface RackPresetDto {
  id: string; songVersionId: string; name: string;
  source: 'user' | 'coach' | 'analysis';   // coach/analysis = system-generated full chains (RESERVED; generator is future PRP-8). 'reviewer' DROPPED — accepted suggestions fork as source='user'+fromSuggestionId.
  chain: Chain;
  fromSuggestionId: string | null; createdInSessionId: string | null; viaGrantId: string | null;   // credit-chain provenance (copiedFromId DROPPED)
  createdAt: string; updatedAt: string;
}
// GET  /api/versions/{versionId}/rack/presets            -> RackPresetDto[]   (owner library: source='user')
// POST /api/versions/{versionId}/rack/presets            body SaveRackPresetRequest { name: string; chain: Chain } -> RackPresetDto
// JSON export/import (NO server copy endpoint): export = download envelope { name, source, chain, schemaVersion }; import = client validates + applies/saves onto the current version
// DELETE /api/rack/presets/{id}

// 🔒 rack draft (autosave, one per VERSION — the owner's; NO userId)
interface RackDraftDto { id: string; songVersionId: string; chain: Chain; updatedAt: string; }
// GET /api/versions/{versionId}/rack/draft               -> RackDraftDto | 404
// PUT /api/versions/{versionId}/rack/draft               body UpsertRackDraftRequest { chain: Chain } -> RackDraftDto

// 🔒 viz presets (promoted from localStorage; drop-in for existing vizPresets.ts VizPreset)
interface VizPresetDto { id: string; userId: string; name: string; viz: VizState; stage: StageId; createdAt: string; updatedAt: string; }
// GET /api/viz/presets   POST /api/viz/presets { name, viz, stage }   DELETE /api/viz/presets/{id}
```
> `VizPresetDto` is intentionally shape-compatible with the existing `vizPresets.ts` `VizPreset { name, viz, stage }` so the server hooks are a drop-in (plus a one-time localStorage import).

---

## Q4 — View comment + Suggestion shapes. 🟡 (shapes settled; endpoint paths are PRP-3-proposed)

Reuses the existing `track_comments` table **extended**, and a new `Suggestion` that **carries the proposed `chain` directly** (the proposer keeps no library copy — D4.3; a `RackPreset` materializes only when the owner accepts, as `source='user'` + `fromSuggestionId`). **Important modeling note:** comment/suggestion *status* is **author-owned single-value (a column)** — NOT the `verdict_user_state` per-user overlay. The overlay pattern (composite `(artifact,user)`) is for *multi-user* state (e.g. each user independently dismissing a verdict); a comment has one owner who resolves/pins it. So **don't model per-user comment state.**

**Shared `ActorRef`** (used by comments, suggestions, and later reactions):
```ts
interface ActorRef {
  type: 'user' | 'anon';
  userId?: string;       // present for type='user'
  handle?: string;
  displayName?: string;  // anon display name (existing track_comments.author_display_name)
  hue?: number;
}
```

```ts
// 🟡 CommentDto — extended track_comments (NEW fields: targetVersionId, parentId, status, suggestionId)
interface CommentDto {
  id: string;
  targetVersionId: string;          // re-scoped to the version (was target_share_token)
  parentId: string | null;          // threaded from day one (D2.1)
  t: number | null;                 // timestamp seconds; null = general/track-level note
  author: ActorRef;
  body: string;
  status: 'open' | 'resolved' | 'pinned' | 'hidden';   // author-controlled
  suggestionId: string | null;      // a comment may carry a suggestion
  createdAt: string;
  deletedAt: string | null;
}

// 🟡 SuggestionDto — the SINGLE convergence point for all non-owner chain proposals
//     (async View reviewer AND live Room grantee both produce this — decision D4.3)
interface SuggestionDto {
  id: string;
  songVersionId: string;
  fromActor: ActorRef;
  chain: Chain;                     // the proposed chain lives ON the suggestion (D4.3 — proposer keeps NO library copy)
  commentId: string | null;         // attached comment, if any
  createdInSessionId: string | null;// set if proposed live in a Room (PRP-4 grantee-save)
  viaGrantId: string | null;        // set if proposed under a Room control-grant — rides onto the adopted preset (D4.5 credit chain)
  status: 'proposed' | 'auditioned' | 'accepted' | 'rejected';
  createdAt: string;
}
```
> ✅ **`chain: Chain` IS canonical — keep your flat mock, do NOT switch to a wrapped `RackPresetDto`.**
> The suggestion carries the chain directly; a real `RackPreset` only materializes when the owner *accepts*
> (forks it into their library). This matches D4.3 (the proposer retains no library copy). The provenance you
> were worried about (`viaGrantId` / `createdInSessionId`) rides as **sibling fields** on `SuggestionDto`, not
> inside a wrapped preset — so the flat form loses nothing. On accept, both copy onto the new owner `RackPreset`.

**Audition + accept reuse PRP-1's apply loop** (this is the key cross-seam):
- **Audition a suggestion** (owner preview): `applyChainToGraph(graph, suggestion.chain)` — never mutates anyone's saved state.
- **Accept = fork-to-preset** (decision D2.3): `POST /api/suggestions/{id}/accept` forks `suggestion.chain` into a new owner `RackPreset` (`fromSuggestionId = suggestion.id`, the credit chain to the proposer per D4.5) and returns it; the client then `applyChainToGraph` + lets the owner tweak/re-save. Cherry-pick is **client-side editing only** — no per-param merge records.

**Proposed PRP-3 endpoints** (mock to these; paths may be finalized when PRP-3 is drafted):
```
GET   /api/versions/{id}/comments            -> CommentDto[]
POST  /api/versions/{id}/comments            { parentId?, t?, body } -> CommentDto
PATCH /api/comments/{id}                      { status } -> CommentDto      (resolve/pin/hide)
POST  /api/versions/{id}/suggestions          { commentId?, chain } -> SuggestionDto   (Suggestion carries the chain; NO preset until accept)
POST  /api/suggestions/{id}/accept            -> RackPresetDto   (fork-to-preset)
POST  /api/suggestions/{id}/reject            -> SuggestionDto
```

---

## One-line summary for each question
1. **Server-driven** — read `GET /versions/{id}/access` → `AccessDto` (resolved booleans + `gates`). Owner panel reads/writes `ShareSettingsDto`. Don't branch on `visibility`.
2. **Spec §04 matrix is canonical for layout** (client constant). Server provides *authority only* (`AccessDto`/role); no server layout config.
3. Names locked above — `Chain` + `applyChainToGraph`/`snapshotChainFromGraph` + the `RackPresetDto`/`RackDraftDto`/`VizPresetDto` endpoints; prototype seams map 1:1.
4. `CommentDto` (extended `track_comments`, threaded, author-owned `status` column) + `SuggestionDto` (carries `chain` directly — the one non-owner-proposal path; a preset forks on accept as `source='user'`+`fromSuggestionId`); audition/accept reuse the apply loop. Shapes safe to mock; endpoint paths are PRP-3-proposed.
