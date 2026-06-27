# Listen V3 — Identity, Roles & Capabilities (client model) — design

**Status:** design (approved 2026-06-25) · **Type:** frontend (`components/frontend-spectr-v2`)
**Companion to:** `listen-v3-version-sharing-permissions.md` (PRP-2, `AccessDto`), `listen-v3-room-sessions.md` (PRP-4, `ControlGrant`/roles). This spec is the **client-side** consumer model; the cited PRPs own the server authority.

---

## 1. Problem

The ported Listen page (`src/features/listen-rack/`) decides "what can this person do" with scattered ad-hoc checks — `mode === 'work'`, `access.role === 'owner'`, an internal free `mode` SegBar toggle, and a mock `grantControl(handle, scope)`. Two gaps:

1. **Mode is user-chosen, not parent-determined.** The SegBar lets anyone flip Work/View/Room freely. In reality the *server* resolves which mode(s) an actor may use, and the parent route hands the active one to the page. A non-owner should never toggle into a privileged surface.
2. **No first-class identity / role / capability model.** "Who am I, what's my role here, and which actions can I take" is implicit and duplicated. There's no single place that answers it, and nothing that expresses the Room DJ/VJ delegation.

## 2. Goals / non-goals

**Goals**
- Mode ("room type") + identity are **parent props**, not in-page state. Owner keeps a bounded navigation SegBar across *their own* modes; non-owners are fixed to the parent-set mode.
- A single pure resolver `resolveCapabilities(mode, identity, roomControl, access) → CapabilitySet` that the page reads instead of ad-hoc checks.
- A first-class **Identity** (actor + ownership + base role + host-ness) and **RoomControl** (DJ = rack holder, VJ = visuals holder), with derived display roles.
- Shapes match PRP-2 `AccessDto` + PRP-4 `ControlGrant` exactly, so wiring real endpoints later is a swap.
- Local (mock) grant mutation so the host→delegate→listener-becomes-DJ flow is demoable without the SSE stream.

**Non-goals (gated on backend)**
- Real `GET /versions/{id}/access` / `GET /v/{token}` resolution (PRP-2).
- The Room SSE stream / realtime consumer and server-side grant persistence (PRP-4).
- Any change to the server authority model — this is a faithful client mirror only.

## 3. Locked context (from the PRPs — do not diverge)

- **"Room type" = the mode** Work / View / Room. Resolved server-side by `AccessService`, which returns *available modes, the actor's role, the gates, roomHostable/joinable*.
- **Roles are contextual** (PRP-4 D4.2). Base `AccessDto.role` = `owner | reviewer | invited | anon | none`. The `Invite` entity carries **reviewer / listener / host**. Inside a Room, **controller** = the current holder of a `control_grant`, scope ∈ `{rack, visuals}`, **one holder per scope**, granting auto-revokes the prior holder.
- **DJ = rack controller; VJ = visuals controller.** Host holds both by default; each can be delegated to a listener independently ("grant rack and visuals control to listeners separately" — screenshot 04).
- **Authority is per-action**: transport + grant = host; rack/visuals = current scope-holder; react/chat/status = anyone permitted (incl. anon).
- **Authority vs layout split** (PRP contract Q1/Q2): `MODE_SURFACE_MATRIX` is the client *layout* authority (what shows); `AccessDto`/capabilities are *action* authority (what's allowed). Both are read; neither replaces the other.
- **Launch reality**: `room_hosting_enabled=false` at launch — admin hosts the single Room; everyday use is Work (own track) + View (someone else's).

## 4. Model

### 4.1 Identity (version-level) — `identity.ts` (NEW, pure)

```ts
type BaseRole = 'owner' | 'reviewer' | 'invited' | 'anon' | 'none';  // === AccessDto.role

interface Identity {
  actor: ActorRef;     // who I am (user|anon) — reused from access.ts
  isOwner: boolean;    // I own the version being listened to
  baseRole: BaseRole;
  isHost: boolean;     // I host the current Room session (false outside Room)
}

interface RoomControl {
  rackHolder: ActorRef | null;     // the DJ   (null ⇒ host drives / nobody delegated)
  visualsHolder: ActorRef | null;  // the VJ
}
```

A person can wear **both** DJ and VJ hats (the host does by default), so role is not a single enum — it is derived:

```ts
type SessionHat = 'host' | 'dj' | 'vj' | 'listener';
sameActor(a: ActorRef | null, b: ActorRef | null): boolean   // user→userId, anon→handle/displayName
sessionHats(id: Identity, control: RoomControl): SessionHat[] // host ⇒ ['host']; else dj/vj from holders; fallback ['listener']
roleLabels(id: Identity, control: RoomControl): string[]      // People chips: ['HOST'] / ['DJ','VJ'] / ['DJ'] / ['LISTENER']
```

- `sessionHats`: if `isHost` → `['host']` (host implicitly controls both; we don't also tag dj/vj). Otherwise collect `'dj'` if they hold rack, `'vj'` if they hold visuals; empty → `['listener']`.
- `roleLabels`: uppercase display strings from `sessionHats`.
- Mock stand-ins: `MOCK_IDENTITY` (owner, not hosting), `MOCK_ROOM_CONTROL` (`{rackHolder:null, visualsHolder:null}` ⇒ host drives).

### 4.2 Capabilities — `capabilities.ts` (NEW, pure)

```ts
interface CapabilitySet {
  // rack / audio
  canEditRack: boolean;          // write to the DSP chain
  rackReadOnly: boolean;         // show read-only + "fork to suggest" affordance
  // transport
  canControlTransport: boolean;  // drive playback (self in Work/View; host in Room)
  transportFollowsHost: boolean; // Room non-host: position mirrors the host
  // visuals
  canControlVisuals: boolean;    // Room: VJ only; Work/View: self
  // coach
  canUseCoach: boolean;          // owner only (X.1); never in Room (matrix hides it)
  // feedback / social
  canComment: boolean;
  canSuggest: boolean;
  canBookmark: boolean;
  canReact: boolean;             // Room only; any permitted incl. anon
  canChat: boolean;              // Room only; any permitted incl. anon
  // host powers
  canGrantControl: boolean;      // host only (Room)
  canHostRoom: boolean;          // AccessDto.roomHostable
  canJoinRoom: boolean;          // AccessDto.roomJoinable
}

resolveCapabilities(
  mode: ModeId,
  id: Identity,
  control: RoomControl,
  access: AccessDto,   // gates + roomHostable/joinable + coachAvailable
): CapabilitySet
```

**Resolution rules (authority layer):**

| capability | work | view | room |
|---|---|---|---|
| `canEditRack` | `isOwner` | `false` | holds-rack (DJ) |
| `rackReadOnly` | `false` | `true` | `!holds-rack` |
| `canControlTransport` | `true` (self) | `true` (self) | `isHost` |
| `transportFollowsHost` | `false` | `false` | `!isHost` |
| `canControlVisuals` | `true` | `true` | holds-visuals (VJ) |
| `canUseCoach` | `access.coachAvailable` | `access.coachAvailable` | `false` |
| `canComment` / `canBookmark` | gates | gates | gates |
| `canSuggest` | gates.canSuggest | gates.canSuggest | holds-rack (grantee-save → Suggestion) |
| `canReact` / `canChat` | `false` | `false` | `true` |
| `canGrantControl` | `false` | `false` | `isHost` |
| `canHostRoom` / `canJoinRoom` | `access.roomHostable` / `access.roomJoinable` (all modes) |

where *holds-rack* = `sameActor(control.rackHolder, id.actor) || (id.isHost && control.rackHolder == null)`, and likewise *holds-visuals*. Host holds a scope whenever it hasn't been delegated away.

**Invariants the tests pin:** coach is owner-only and never in Room (X.1); Work is owner-only (X.2 — a non-owner never resolves Work, enforced upstream by `availableModes`, asserted here defensively as `canEditRack=false` if somehow mode=work & !owner); Room transport is host-only; a non-host listener with no grants has `canEditRack=false` + `rackReadOnly=true`; granting rack to a listener flips their `canEditRack` true and the host's false.

## 5. Data flow — parent owns mode + identity

- `ListenRackPage` props: `mode`, `availableModes`, `identity`, `access`, `roomControl`, `onModeChange?`, `onGrant?`. **No internal free `mode` state.**
- Parent route `_app/listen-rack.tsx` owns active-mode `useState`, supplies `MOCK_IDENTITY` / `MOCK_ROOM_CONTROL` / `MOCK_ACCESS` (later: `GET /access` + room stream), and passes `onModeChange` **only when `identity.isOwner`**.
- **SegBar (decision B):** renders iff `identity.isOwner && availableModes.length > 1`. It navigates the owner's *own* surfaces (Work↔View↔host Room) — never changes type or escalates privilege. Non-owners: fixed parent-set mode, no switcher.
- **Local grant mutation (mock):** host's "grant DJ/VJ to @listener" → `onGrant(scope, actor)` → parent updates `roomControl` → capabilities re-resolve → rack enable/disable, "controlled by @x" chip, and People role labels update locally. `onGrant(scope, null)` revokes (returns the scope to the host). Payload shape = PRP-4 `ControlGrant`.
- The page computes `const cap = resolveCapabilities(mode, identity, roomControl, access)` once and threads `cap` to surfaces. `MODE_SURFACE_MATRIX[mode]` still drives *layout*; `cap` drives *enablement*.

## 6. Files

**NEW**
- `src/features/listen-rack/identity.ts` — `BaseRole`, `Identity`, `RoomControl`, `SessionHat`, `sameActor`, `sessionHats`, `roleLabels`, `MOCK_IDENTITY`, `MOCK_ROOM_CONTROL`.
- `src/features/listen-rack/capabilities.ts` — `CapabilitySet`, `resolveCapabilities`.
- `src/features/listen-rack/capabilities.test.ts`, `identity.test.ts`.

**CHANGE**
- `ListenRackPage.tsx` — accept the new props; drop internal free mode state; compute + thread `cap`; gate the SegBar to owners; `onGrant` handler.
- `routes/_app/listen-rack.tsx` — mock identity/access/roomControl provider + active-mode state + owner-only `onModeChange`.
- `rail.tsx` `PeoplePanel` — `roleLabels` for chips; grant buttons gated by `cap.canGrantControl`; "controlled by" reads DJ/VJ holders.
- Rack read-only / coach / comment-composer / suggest affordances — read `cap.*` instead of ad-hoc `mode`/`role` checks (replace, don't duplicate).

## 7. Testing

Exhaustive resolver matrix in the existing vitest style (pure, env `node`):
- Every `mode × {owner, reviewer, anon} × {host, holds-rack, holds-visuals, plain listener}` combination asserts the right capability bits (~40–50 assertions).
- `sessionHats` / `roleLabels` / `sameActor` derivation incl. anon actors and dual-hat (DJ+VJ) holders.
- Named invariants: coach owner-only & never-in-Room (X.1), Work owner-only (X.2), Room transport host-only, grant flips DJ from host→listener and back on revoke.

## 8. Swap path (when backend lands)

- Replace `MOCK_IDENTITY`/`MOCK_ACCESS` in the route with `GET /versions/{id}/access` (authed) / `GET /v/{token}` (anon) — same `AccessDto` shape.
- Replace local `roomControl` state + `onGrant` with the PRP-4 room stream's `grant` events + `POST .../grant|revoke`. `resolveCapabilities` and every `cap.*` read are unchanged.

## 9. Out of scope

Real access/stream endpoints, SSE consumer, server grant persistence (PRP-2/PRP-4 backend). The bare-handle→`ActorRef` fixture refactor remains sequenced with PRP-4 execution.
