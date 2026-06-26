# Listen V3 — Identity, Roles & Capabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Listen page's scattered `mode`/`role` checks with a parent-determined mode + a pure `resolveCapabilities()` model, so authority (who can do what) is resolved in one place and the Room DJ/VJ delegation is first-class.

**Architecture:** Two new pure modules — `identity.ts` (who I am: actor + ownership + base role + host-ness; plus `RoomControl` = DJ/VJ holders and derived role labels) and `capabilities.ts` (`resolveCapabilities(mode, identity, roomControl, access) → CapabilitySet`). The page receives `mode` + `identity` + `roomControl` as parent props instead of owning a free SegBar toggle; the SegBar survives only for an owner navigating their own modes (decision B). Local mock grant mutation flips DJ/VJ. Shapes mirror PRP-2 `AccessDto` + PRP-4 `ControlGrant` so the endpoints swap in later.

**Tech Stack:** React 19 + TypeScript strict + Vite 6 + TanStack Router + vitest. Pure logic in `.ts`; tests in the existing vitest style (env `node`; pure functions and `renderToStaticMarkup` for components — no `@testing-library/react`).

**Design spec:** `PRPs/listen-v3-identity-capabilities-design.md`

> **Post-ship reconciliation (2026-06-26):** this plan SHIPPED (`src/features/listen-rack/{identity,capabilities}.ts` + tests). Three points where the as-built code diverged from the plan text below — code is authoritative:
> 1. **`work`-mode `rackReadOnly`** — Step (Task 2) below shows `rackReadOnly: false`; the shipped code is `rackReadOnly: !id.isOwner` (`capabilities.ts:58`). The plan value was a bug. Corrected inline below.
> 2. **`MOCK_IDENTITY.isHost`** — plan says `false`; shipped is `true` (`identity.ts:64`, with a comment) so the host-centric demo Room fixture stays coherent (People panel "you", "You're hosting", +DJ/+Vis grant buttons all line up). Corrected inline below.
> 3. **Mock wiring** — Tasks 3–4 describe lifting `mode`/`roomControl` into route-level `useState` in `routes/_app/listen-rack.tsx`. The as-built code centralizes all mocking in a `useMockRoomOrchestration()` hook consumed by the route (`routes/_app/listen-rack.tsx:22`); the route no longer owns the `useState`. Behavior is identical; the code blocks in Tasks 3–4 are kept as historical plan text.

## Global Constraints

- TypeScript strict + `verbatimModuleSyntax` → type-only imports MUST use `import type`.
- Build tsconfig adds `exactOptionalPropertyTypes` → an optional field forwarded a `T | undefined` value needs `| undefined` in its declared type. `npm run build` is stricter than `tsc --noEmit`; both must pass.
- ESLint runs with `--max-warnings 0` (warnings fail). `react-refresh/only-export-components`: hooks/pure functions live in `.ts`, components in `.tsx`.
- No Tailwind / styled-components; CSS Modules + global utilities only. No new dependencies.
- Four gates, all must pass before a task's commit: `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npx vitest run`.
- All commands run from `components/frontend-spectr-v2/`.
- Reuse `ActorRef`, `AccessDto`, `ModeId`, `MOCK_ACCESS`, `availableModes` from `src/features/listen-rack/access.ts`. Do NOT redefine them.
- Out of scope (gated on PRP-2/PRP-4 backend): real `GET /access`, the Room SSE stream/consumer, server grant persistence, and the deeper bare-handle→`ActorRef` fixture refactor of `ROOM_LISTENERS`/`ReactionFeedItem`. This plan adapts at the boundary only.

---

### Task 1: `identity.ts` — identity model + derived roles

**Files:**
- Create: `src/features/listen-rack/identity.ts`
- Test: `src/features/listen-rack/identity.test.ts`

**Interfaces:**
- Consumes: `ActorRef`, `AccessDto` from `./access`.
- Produces:
  - `type BaseRole = AccessDto['role']`
  - `interface Identity { actor: ActorRef; isOwner: boolean; baseRole: BaseRole; isHost: boolean }`
  - `interface RoomControl { rackHolder: ActorRef | null; visualsHolder: ActorRef | null }`
  - `type SessionHat = 'host' | 'dj' | 'vj' | 'listener'`
  - `sameActor(a: ActorRef | null, b: ActorRef | null): boolean`
  - `sessionHats(id: Identity, control: RoomControl): SessionHat[]`
  - `roleLabels(id: Identity, control: RoomControl): string[]`
  - `const MOCK_IDENTITY: Identity`, `const MOCK_ROOM_CONTROL: RoomControl`

- [ ] **Step 1: Write the failing test**

```ts
// src/features/listen-rack/identity.test.ts
import { describe, it, expect } from 'vitest';

import type { ActorRef } from './access';
import {
  sameActor, sessionHats, roleLabels, MOCK_IDENTITY, MOCK_ROOM_CONTROL,
  type Identity, type RoomControl,
} from './identity';

const me: ActorRef = { type: 'user', userId: 'me', handle: 'maek' };
const vela: ActorRef = { type: 'user', userId: 'u2', handle: 'vela' };
const anonRiver: ActorRef = { type: 'anon', displayName: 'anon-river' };

function ident(over: Partial<Identity> = {}): Identity {
  return { actor: me, isOwner: true, baseRole: 'owner', isHost: false, ...over };
}
const noGrants: RoomControl = { rackHolder: null, visualsHolder: null };

describe('sameActor', () => {
  it('matches users by userId', () => {
    expect(sameActor(me, { type: 'user', userId: 'me', handle: 'different' })).toBe(true);
    expect(sameActor(me, vela)).toBe(false);
  });
  it('matches anon by displayName and never crosses user/anon', () => {
    expect(sameActor(anonRiver, { type: 'anon', displayName: 'anon-river' })).toBe(true);
    expect(sameActor(me, { type: 'anon', displayName: 'maek' })).toBe(false);
  });
  it('is false when either side is null', () => {
    expect(sameActor(me, null)).toBe(false);
    expect(sameActor(null, null)).toBe(false);
  });
});

describe('sessionHats / roleLabels', () => {
  it('host wears a single host hat even though it controls both scopes', () => {
    expect(sessionHats(ident({ isHost: true }), noGrants)).toEqual(['host']);
    expect(roleLabels(ident({ isHost: true }), noGrants)).toEqual(['HOST']);
  });
  it('a non-host holding both grants is DJ and VJ', () => {
    const control: RoomControl = { rackHolder: me, visualsHolder: me };
    expect(sessionHats(ident({ isHost: false }), control)).toEqual(['dj', 'vj']);
    expect(roleLabels(ident({ isHost: false }), control)).toEqual(['DJ', 'VJ']);
  });
  it('holding only rack is DJ', () => {
    expect(sessionHats(ident({ isHost: false }), { rackHolder: me, visualsHolder: vela }))
      .toEqual(['dj']);
  });
  it('holding nothing is a listener', () => {
    expect(roleLabels(ident({ isHost: false }), { rackHolder: vela, visualsHolder: vela }))
      .toEqual(['LISTENER']);
  });
});

describe('mock fixtures', () => {
  it('MOCK_IDENTITY is the owner, not hosting; MOCK_ROOM_CONTROL has no delegates', () => {
    expect(MOCK_IDENTITY.isOwner).toBe(true);
    expect(MOCK_IDENTITY.isHost).toBe(true); // as-built: host-centric demo Room fixture (see reconciliation note at top)
    expect(MOCK_ROOM_CONTROL).toEqual({ rackHolder: null, visualsHolder: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/listen-rack/identity.test.ts`
Expected: FAIL — "Failed to resolve import './identity'".

- [ ] **Step 3: Write the implementation**

```ts
// src/features/listen-rack/identity.ts
/* SPECTR · Listen V3 — actor identity + Room control holders + derived roles.
 *
 * Version-level identity (who I am, do I own this version, am I hosting). The
 * session roles (DJ = rack holder, VJ = visuals holder) are DERIVED from the
 * live RoomControl, never stored — a person can wear both hats. Shapes mirror
 * PRP-4 ControlGrant so the real room stream swaps in without touching callers.
 */
import type { ActorRef, AccessDto } from './access';

export type BaseRole = AccessDto['role'];

export interface Identity {
  actor: ActorRef;     // who I am (user|anon)
  isOwner: boolean;    // I own the version being listened to
  baseRole: BaseRole;  // === AccessDto.role
  isHost: boolean;     // I host the current Room session (false outside Room)
}

export interface RoomControl {
  rackHolder: ActorRef | null;     // the DJ   (null ⇒ host drives / nobody delegated)
  visualsHolder: ActorRef | null;  // the VJ
}

export type SessionHat = 'host' | 'dj' | 'vj' | 'listener';

/** Stable identity key: type-prefixed so a user and an anon never collide. */
function actorKey(a: ActorRef): string {
  return `${a.type}:${a.userId ?? a.handle ?? a.displayName ?? ''}`;
}

export function sameActor(a: ActorRef | null, b: ActorRef | null): boolean {
  return !!a && !!b && actorKey(a) === actorKey(b);
}

/** Host ⇒ ['host'] (implicitly both scopes). Else DJ/VJ from holders; else listener. */
export function sessionHats(id: Identity, control: RoomControl): SessionHat[] {
  if (id.isHost) return ['host'];
  const hats: SessionHat[] = [];
  if (sameActor(control.rackHolder, id.actor)) hats.push('dj');
  if (sameActor(control.visualsHolder, id.actor)) hats.push('vj');
  return hats.length ? hats : ['listener'];
}

/** Uppercased display labels for the People-panel chips. */
export function roleLabels(id: Identity, control: RoomControl): string[] {
  return sessionHats(id, control).map((h) => h.toUpperCase());
}

export const MOCK_IDENTITY: Identity = {
  actor: { type: 'user', userId: 'me', handle: 'maek', displayName: 'Mae Karlsson', hue: 168 },
  isOwner: true,
  baseRole: 'owner',
  isHost: true, // as-built: host-centric demo Room fixture (see reconciliation note at top)
};

export const MOCK_ROOM_CONTROL: RoomControl = { rackHolder: null, visualsHolder: null };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/listen-rack/identity.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Run the type/lint gates**

Run: `npx tsc --noEmit && npm run lint`
Expected: no output / "no-google-fonts lint: clean".

- [ ] **Step 6: Commit**

```bash
git add src/features/listen-rack/identity.ts src/features/listen-rack/identity.test.ts
git commit -m "feat(listen): add actor identity + RoomControl + derived session roles"
```

---

### Task 2: `capabilities.ts` — the resolver

**Files:**
- Create: `src/features/listen-rack/capabilities.ts`
- Test: `src/features/listen-rack/capabilities.test.ts`

**Interfaces:**
- Consumes: `ActorRef`, `AccessDto`, `ModeId` from `./access`; `Identity`, `RoomControl`, `sameActor` from `./identity`.
- Produces:
  - `interface CapabilitySet { canEditRack, rackReadOnly, canControlTransport, transportFollowsHost, canControlVisuals, canUseCoach, canComment, canSuggest, canBookmark, canReact, canChat, canGrantControl, canHostRoom, canJoinRoom: boolean }`
  - `resolveCapabilities(mode: ModeId, id: Identity, control: RoomControl, access: AccessDto): CapabilitySet`

- [ ] **Step 1: Write the failing test**

```ts
// src/features/listen-rack/capabilities.test.ts
import { describe, it, expect } from 'vitest';

import type { AccessDto, ActorRef, ModeId } from './access';
import { resolveCapabilities } from './capabilities';
import type { Identity, RoomControl } from './identity';

const me: ActorRef = { type: 'user', userId: 'me', handle: 'maek' };
const guest: ActorRef = { type: 'user', userId: 'g', handle: 'vela' };

function access(over: Partial<AccessDto> = {}): AccessDto {
  return {
    role: 'owner', canWork: true, canView: true, roomHostable: true, roomJoinable: false,
    coachAvailable: true, gates: { canComment: true, canSuggest: true, canBookmark: true },
    ...over,
  };
}
function ident(over: Partial<Identity> = {}): Identity {
  return { actor: me, isOwner: true, baseRole: 'owner', isHost: false, ...over };
}
const noGrants: RoomControl = { rackHolder: null, visualsHolder: null };
const cap = (m: ModeId, id: Identity, c: RoomControl, a: AccessDto) => resolveCapabilities(m, id, c, a);

describe('work mode', () => {
  it('owner edits the rack, gets the coach, drives their own transport', () => {
    const c = cap('work', ident(), noGrants, access());
    expect(c.canEditRack).toBe(true);
    expect(c.rackReadOnly).toBe(false);
    expect(c.canControlTransport).toBe(true);
    expect(c.canUseCoach).toBe(true);
    expect(c.canReact).toBe(false);
    expect(c.canGrantControl).toBe(false);
  });
  it('coach is gated by coachAvailable (X.1)', () => {
    expect(cap('work', ident(), noGrants, access({ coachAvailable: false })).canUseCoach).toBe(false);
  });
});

describe('view mode', () => {
  it('rack is read-only; suggest follows the gate; coach is reference-only', () => {
    const c = cap('view', ident({ isOwner: false, baseRole: 'reviewer' }), noGrants,
      access({ role: 'reviewer', coachAvailable: false, gates: { canComment: true, canSuggest: true, canBookmark: false } }));
    expect(c.canEditRack).toBe(false);
    expect(c.rackReadOnly).toBe(true);
    expect(c.canSuggest).toBe(true);
    expect(c.canBookmark).toBe(false);
    expect(c.canUseCoach).toBe(false);
    expect(c.canReact).toBe(false);
  });
});

describe('room mode', () => {
  it('host drives transport + grants; holds both scopes by default', () => {
    const c = cap('room', ident({ isHost: true }), noGrants, access());
    expect(c.canControlTransport).toBe(true);
    expect(c.transportFollowsHost).toBe(false);
    expect(c.canEditRack).toBe(true);        // host holds rack while undelegated
    expect(c.canControlVisuals).toBe(true);
    expect(c.canGrantControl).toBe(true);
    expect(c.canUseCoach).toBe(false);       // coach never in Room
    expect(c.canReact && c.canChat).toBe(true);
  });
  it('a plain listener cannot edit, follows the host, may still react/chat', () => {
    const c = cap('room', ident({ isOwner: false, isHost: false, baseRole: 'anon' }), noGrants, access({ role: 'anon' }));
    expect(c.canEditRack).toBe(false);
    expect(c.rackReadOnly).toBe(true);
    expect(c.canControlTransport).toBe(false);
    expect(c.transportFollowsHost).toBe(true);
    expect(c.canGrantControl).toBe(false);
    expect(c.canReact).toBe(true);
  });
  it('granting rack to a listener makes them the DJ and removes it from the host', () => {
    const delegated: RoomControl = { rackHolder: guest, visualsHolder: null };
    const asGuest = cap('room', ident({ actor: guest, isOwner: false, isHost: false }), delegated, access());
    const asHost = cap('room', ident({ isHost: true }), delegated, access());
    expect(asGuest.canEditRack).toBe(true);  // guest is now DJ
    expect(asGuest.canSuggest).toBe(true);   // DJ can grantee-save → Suggestion
    expect(asHost.canEditRack).toBe(false);  // host no longer holds rack
    expect(asHost.canControlVisuals).toBe(true); // host still holds visuals
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/listen-rack/capabilities.test.ts`
Expected: FAIL — "Failed to resolve import './capabilities'".

- [ ] **Step 3: Write the implementation**

```ts
// src/features/listen-rack/capabilities.ts
/* SPECTR · Listen V3 — authority resolver.
 *
 * resolveCapabilities is the single source of "what can THIS actor DO in THIS
 * mode" — the authority layer. It is SEPARATE from MODE_SURFACE_MATRIX (the
 * layout layer in access.ts): the matrix says what SHOWS, this says what's
 * ALLOWED/ENABLED. Inputs mirror PRP-2 AccessDto + PRP-4 ControlGrant so the
 * real endpoints swap in without touching any cap.* read site.
 */
import type { ActorRef, AccessDto, ModeId } from './access';
import { sameActor, type Identity, type RoomControl } from './identity';

export interface CapabilitySet {
  // rack / audio
  canEditRack: boolean;
  rackReadOnly: boolean;
  // transport
  canControlTransport: boolean;
  transportFollowsHost: boolean;
  // visuals
  canControlVisuals: boolean;
  // coach
  canUseCoach: boolean;
  // feedback / social
  canComment: boolean;
  canSuggest: boolean;
  canBookmark: boolean;
  canReact: boolean;
  canChat: boolean;
  // host powers
  canGrantControl: boolean;
  canHostRoom: boolean;
  canJoinRoom: boolean;
}

/** Host holds a scope until it's delegated away; otherwise the named holder does. */
function holds(holder: ActorRef | null, id: Identity): boolean {
  if (id.isHost && holder == null) return true;
  return sameActor(holder, id.actor);
}

export function resolveCapabilities(
  mode: ModeId,
  id: Identity,
  control: RoomControl,
  access: AccessDto,
): CapabilitySet {
  const g = access.gates;
  const base = {
    canComment: g.canComment,
    canBookmark: g.canBookmark,
    canHostRoom: access.roomHostable,
    canJoinRoom: access.roomJoinable,
  };

  if (mode === 'work') {
    return {
      ...base,
      canEditRack: id.isOwner, rackReadOnly: !id.isOwner,
      canControlTransport: true, transportFollowsHost: false,
      canControlVisuals: true,
      canUseCoach: access.coachAvailable,
      canSuggest: g.canSuggest,
      canReact: false, canChat: false,
      canGrantControl: false,
    };
  }

  if (mode === 'view') {
    return {
      ...base,
      canEditRack: false, rackReadOnly: true,
      canControlTransport: true, transportFollowsHost: false,
      canControlVisuals: true,
      canUseCoach: access.coachAvailable,
      canSuggest: g.canSuggest,
      canReact: false, canChat: false,
      canGrantControl: false,
    };
  }

  // room
  const holdsRack = holds(control.rackHolder, id);
  const holdsVisuals = holds(control.visualsHolder, id);
  return {
    ...base,
    canEditRack: holdsRack, rackReadOnly: !holdsRack,
    canControlTransport: id.isHost, transportFollowsHost: !id.isHost,
    canControlVisuals: holdsVisuals,
    canUseCoach: false,
    canSuggest: holdsRack,
    canReact: true, canChat: true,
    canGrantControl: id.isHost,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/listen-rack/capabilities.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Run the type/lint gates**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/listen-rack/capabilities.ts src/features/listen-rack/capabilities.test.ts
git commit -m "feat(listen): add resolveCapabilities authority resolver"
```

---

### Task 3: Parent-determined mode + identity props (decision B SegBar)

Move mode/identity ownership to the route; gate the SegBar to owners.

**Files:**
- Modify: `src/features/listen-rack/ListenRackPage.tsx` (signature + `TrackHeader` + the `mode`/`access` setup, lines ~37-65, ~109-114, ~219-225)
- Modify: `src/routes/_app/listen-rack.tsx`

**Interfaces:**
- Consumes: `Identity`, `RoomControl`, `MOCK_IDENTITY`, `MOCK_ROOM_CONTROL` from `./identity`; `availableModes`, `MOCK_ACCESS`, `ModeId`, `AccessDto` from `./access`.
- Produces: `ListenRackPage(props: ListenRackPageProps)` where
  `interface ListenRackPageProps { mode: ModeId; modes: ModeId[]; identity: Identity; access: AccessDto; roomControl: RoomControl; onModeChange?: (m: ModeId) => void }`

- [ ] **Step 1: Change `ListenRackPage` to accept props (replace lines 109-114)**

Replace:
```tsx
export function ListenRackPage() {
  const access = MOCK_ACCESS;
  const modes = useMemo(() => availableModes(access), [access]);
  const [playing, setPlaying] = useState(true);
  const [position, setPosition] = useState(42);
  const [mode, setMode] = useState<ModeId>(modes[0] ?? 'work');
```
With:
```tsx
export interface ListenRackPageProps {
  mode: ModeId;
  modes: ModeId[];
  identity: Identity;
  access: AccessDto;
  roomControl: RoomControl;
  onModeChange?: (m: ModeId) => void;
}

export function ListenRackPage({ mode, modes, identity, access, roomControl, onModeChange }: ListenRackPageProps) {
  const [playing, setPlaying] = useState(true);
  const [position, setPosition] = useState(42);
```
Then update the imports at the top: change `import { availableModes, MODE_SURFACE_MATRIX, MOCK_ACCESS, type ModeId } from './access';` to `import { MODE_SURFACE_MATRIX, type AccessDto, type ModeId } from './access';` and add `import { type Identity, type RoomControl } from './identity';`. (`availableModes`/`MOCK_ACCESS` move to the route.)

- [ ] **Step 2: Gate the SegBar to owners (TrackHeader, lines 37-65)**

Replace the `TrackHeader` signature + actions block:
```tsx
function TrackHeader({ mode, modes, identity, onModeChange }: {
  mode: ModeId; modes: ModeId[]; identity: Identity; onModeChange?: (m: ModeId) => void;
}) {
  const t = TRACK;
  const surface = MODE_SURFACE_MATRIX[mode];
  const showSwitcher = identity.isOwner && onModeChange && modes.length > 1;
```
…and the actions div:
```tsx
      <div className="lr-head-actions">
        {showSwitcher && (
          <SegBar value={mode} onChange={(id) => onModeChange(id as ModeId)}
            options={modes.map((id) => ({ id, label: MODE_SURFACE_MATRIX[id].label }))} accent={surface.accent} />
        )}
        <button type="button" className="btn primary sm">View Report →</button>
      </div>
```
Add `import { type Identity } from './identity';` usage is via the page import; `TrackHeader` is in the same file so it sees the type. Update its call site (line 225) to:
```tsx
        <TrackHeader mode={mode} modes={modes} identity={identity} onModeChange={onModeChange} />
```

- [ ] **Step 3: Update the route to own mode + supply mocks**

Replace `src/routes/_app/listen-rack.tsx` body:
```tsx
import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { availableModes, MOCK_ACCESS, type ModeId } from '../../features/listen-rack/access';
import { MOCK_IDENTITY, MOCK_ROOM_CONTROL } from '../../features/listen-rack/identity';
import { ListenRackPage } from '../../features/listen-rack/ListenRackPage';

/**
 * Listen — Rack & Visuals redesign (design-handoff port).
 *
 * Parent owns mode + identity (mocked here; later GET /access + the room
 * stream). The SegBar inside the page is owner-only (decision B). The engine
 * wiring map lives in src/features/listen-rack/PORTING_NOTES.md.
 */
function ListenRackRoute() {
  const access = MOCK_ACCESS;
  const identity = MOCK_IDENTITY;
  const modes = useMemo(() => availableModes(access), [access]);
  const [mode, setMode] = useState<ModeId>(modes[0] ?? 'work');
  const onModeChange = identity.isOwner ? setMode : undefined;
  return (
    <ListenRackPage mode={mode} modes={modes} identity={identity} access={access}
      roomControl={MOCK_ROOM_CONTROL} onModeChange={onModeChange} />
  );
}

export const Route = createFileRoute('/_app/listen-rack')({
  component: ListenRackRoute,
});
```

- [ ] **Step 4: Run the four gates**

Run: `npx tsc --noEmit && npm run lint && npm run build && npx vitest run`
Expected: all pass. (`identity`/`roomControl` are accepted but not yet read by capabilities — that's Task 4. They must already be threaded without TS "unused" errors; `identity` is used by `TrackHeader`, `roomControl` will be flagged unused → temporarily reference it in Step 5 of THIS task is not needed because Task 4 follows immediately; to keep this task green, add `void roomControl;` at the top of the page body with a `// consumed in Task 4` comment, removed in Task 4.)

- [ ] **Step 5: Manually verify (Playwright or dev server)**

Owner identity → SegBar visible (WORK/VIEW/ROOM). Temporarily set `MOCK_IDENTITY.isOwner=false` in a scratch edit → SegBar gone, mode fixed. Revert.

- [ ] **Step 6: Commit**

```bash
git add src/features/listen-rack/ListenRackPage.tsx src/routes/_app/listen-rack.tsx
git commit -m "feat(listen): parent-determined mode + owner-only SegBar (decision B)"
```

---

### Task 4: Thread capabilities through the page; RoomControl + onGrant

Replace surface-derived `rackReadOnly` and the string `rackController`/`visualController`/`grantControl` with capability + `RoomControl` (ActorRef) + `onGrant`.

**Files:**
- Modify: `src/features/listen-rack/ListenRackPage.tsx` (lines ~125-126, ~150-154, ~219-220, ~257-282, ~286-289)

**Interfaces:**
- Consumes: `resolveCapabilities`, `CapabilitySet` from `./capabilities`; `RoomControl`, `sameActor` from `./identity`.
- Produces (for Task 5): `RightRail` is passed `cap: CapabilitySet`, `roomControl: RoomControl`, and `onGrant: (scope: 'rack' | 'visuals', actor: ActorRef | null) => void` (replacing `rackController`/`visualController`/the old `onGrant`).

- [ ] **Step 1: Remove the `void roomControl;` shim and compute capabilities**

After `const surface = MODE_SURFACE_MATRIX[mode];` (line ~219), replace `const rackReadOnly = surface.rack === 'readonly';` with:
```tsx
  const cap = resolveCapabilities(mode, identity, roomControl, access);
  const rackReadOnly = cap.rackReadOnly;
```
Add imports: `import { resolveCapabilities } from './capabilities';` and extend the identity import to `import { sameActor, type Identity, type RoomControl } from './identity';`. Add `import type { ActorRef } from './access';` if not already present (it's re-exported from access).

- [ ] **Step 2: Replace the controller state + grant handler (lines 125-126, 150-154)**

The page no longer owns controller state — it comes from the `roomControl` prop. Delete:
```tsx
  const [rackController, setRackController] = useState<string | null>(null);
  const [visualController, setVisualController] = useState<string | null>(null);
```
Replace `grantControl` (lines 151-154) with a prop-bridging handler that announces and delegates upward. Since the route owns `roomControl`, lift mutation via a new `onGrant` prop on the page. **Add to `ListenRackPageProps`** (Task 3's interface): `onGrant?: (scope: 'rack' | 'visuals', actor: ActorRef | null) => void;` and accept it in the destructure. Then:
```tsx
  const grantControl = useCallback((scope: 'rack' | 'visuals', actor: ActorRef | null) => {
    onGrant?.(scope, actor);
    const who = actor ? `@${actor.handle ?? actor.displayName ?? 'someone'}` : 'the host';
    announce(`${who} can now control the ${scope === 'rack' ? 'rack' : 'visuals'}`,
      scope === 'rack' ? 'RACK CONTROL' : 'VISUALS CONTROL');
  }, [onGrant, announce]);
```

- [ ] **Step 3: Update the "controlled by" chip (lines 257-268)**

Replace the chip IIFE that read `rackController`/`visualController` strings with the `roomControl` holders:
```tsx
                  <button type="button" onClick={() => (bottomView === 'rack' ? rs.savePreset(roomControl.rackHolder?.handle || 'you') : saveVizPreset())} className="btn sm primary" style={{ fontSize: 10.5 }}>+ Save preset</button>
                  {(() => {
                    const ac = bottomView === 'rack' ? roomControl.rackHolder : roomControl.visualsHolder;
                    if (!ac) return null;
                    return (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 10px', borderRadius: 8, background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.4)' }}>
                        <Avatar handle={ac.handle ?? ac.displayName ?? '?'} hue={ac.hue || 220} anon={ac.type === 'anon'} size={20} />
                        <span className="mono" style={{ fontSize: 9.5, color: 'var(--violet)' }}>{bottomView === 'rack' ? 'rack' : 'visuals'} · @{ac.handle ?? ac.displayName}</span>
                      </div>
                    );
                  })()}
```

- [ ] **Step 4: Update `InlineRack` controller props + the RightRail call (lines 276, 281, 286-289)**

`InlineRack` currently takes `controller={rackController}` (a string). Pass the holder's handle for display: `controller={roomControl.rackHolder?.handle ?? null}` in both InlineRack usages (lines 276, 281). Then replace the RightRail call (286-289):
```tsx
          <RightRail mode={mode} access={access} cap={cap} rs={rs} track={TRACK} position={position}
            activeNote={activeNote} onNoteClick={(n) => { setActiveNote(n.id); setPosition(n.t); }} onSeek={setPosition}
            onReact={(e) => { setMyStatus(e); spawnReaction(e, 'maek'); }} feed={feed} announce={announce} myStatus={myStatus}
            identity={identity} roomControl={roomControl} onGrant={grantControl} />
```

- [ ] **Step 5: Update the route to handle `onGrant` locally (mock mutation)**

In `src/routes/_app/listen-rack.tsx`, lift `roomControl` to state and implement `onGrant`:
```tsx
  const [roomControl, setRoomControl] = useState(MOCK_ROOM_CONTROL);
  const onGrant = (scope: 'rack' | 'visuals', actor: ActorRef | null) =>
    setRoomControl((rc) => scope === 'rack' ? { ...rc, rackHolder: actor } : { ...rc, visualsHolder: actor });
```
Import `ActorRef` type and pass `roomControl={roomControl} onGrant={onGrant}` to `<ListenRackPage>`. Replace the `roomControl={MOCK_ROOM_CONTROL}` prop with `roomControl={roomControl}`.

- [ ] **Step 6: Run the four gates**

Run: `npx tsc --noEmit && npm run lint && npm run build && npx vitest run`
Expected: all pass. (RightRail's new `cap`/`identity`/`roomControl` props land in Task 5; if `npm run build` flags RightRail prop mismatch here, do Task 5's Step 1-2 in the same commit — the two files must compile together.)

- [ ] **Step 7: Commit**

```bash
git add src/features/listen-rack/ListenRackPage.tsx src/routes/_app/listen-rack.tsx
git commit -m "feat(listen): drive rack/coach/grant off capabilities + RoomControl"
```

---

### Task 5: People panel role labels + capability-gated grants

**Files:**
- Modify: `src/features/listen-rack/rail.tsx` (`RightRail` signature ~573-589, the `people` render ~608, `PeoplePanel` ~326-371)

**Interfaces:**
- Consumes: `CapabilitySet` from `./capabilities`; `Identity`, `RoomControl`, `roleLabels`, `sameActor` from `./identity`; `ActorRef` from `./access`.
- Produces: `RightRail` accepts `cap: CapabilitySet; identity: Identity; roomControl: RoomControl; onGrant: (scope: 'rack' | 'visuals', actor: ActorRef | null) => void` (replacing `rackController`/`visualController`/old `onGrant`).

- [ ] **Step 1: Update `RightRail` signature + people render**

In `RightRail` destructure/types (573-589) replace `rackController`, `visualController`, and `onGrant` with:
```tsx
  cap, identity, roomControl, onGrant,
```
types:
```tsx
  cap: CapabilitySet;
  identity: Identity;
  roomControl: RoomControl;
  onGrant: (scope: 'rack' | 'visuals', actor: ActorRef | null) => void;
```
Add imports at the top of `rail.tsx`:
```tsx
import type { CapabilitySet } from './capabilities';
import { roleLabels, sameActor, type Identity, type RoomControl } from './identity';
```
and add `ActorRef` to the existing `./access` type import.
Update the people render (line 608):
```tsx
        {active === 'people' && <PeoplePanel myStatus={myStatus} onReact={onReact} cap={cap} roomControl={roomControl} onGrant={onGrant} />}
```

- [ ] **Step 2: Rewrite `PeoplePanel` to use roleLabels + cap.canGrantControl**

Replace the `PeoplePanel` signature (326-332) and the per-listener controls (361-369):
```tsx
function PeoplePanel({ myStatus, onReact, cap, roomControl, onGrant }: {
  myStatus: string;
  onReact?: (e: string) => void;
  cap: CapabilitySet;
  roomControl: RoomControl;
  onGrant: (scope: 'rack' | 'visuals', actor: ActorRef | null) => void;
}) {
```
Inside the listener `.map`, build an `ActorRef` for the row and compute holders (replace the `u.you …` chip cluster, 361-369):
```tsx
            <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {u.you && <span className="mono" style={{ fontSize: 8.5, color: 'var(--cyan)', letterSpacing: '0.1em' }}>HOST</span>}
              {!u.you && (() => {
                const actor: ActorRef = { type: u.anon ? 'anon' : 'user', handle: u.handle, hue: u.hue };
                const isDJ = sameActor(roomControl.rackHolder, actor);
                const isVJ = sameActor(roomControl.visualsHolder, actor);
                return (
                  <>
                    {isDJ
                      ? <span className="mono" style={{ fontSize: 7.5, color: 'var(--violet)', padding: '2px 5px', borderRadius: 5, border: '1px solid rgba(167,139,250,0.4)', background: 'rgba(167,139,250,0.08)' }}>● DJ</span>
                      : cap.canGrantControl && <button type="button" onClick={() => onGrant('rack', actor)} className="btn ghost sm" style={{ fontSize: 8, padding: '3px 6px', color: 'var(--muted)' }}>+ DJ</button>}
                    {isVJ
                      ? <span className="mono" style={{ fontSize: 7.5, color: 'var(--cyan)', padding: '2px 5px', borderRadius: 5, border: '1px solid rgba(0,229,176,0.4)', background: 'rgba(0,229,176,0.08)' }}>● VJ</span>
                      : cap.canGrantControl && <button type="button" onClick={() => onGrant('visuals', actor)} className="btn ghost sm" style={{ fontSize: 8, padding: '3px 6px', color: 'var(--muted)' }}>+ Vis</button>}
                  </>
                );
              })()}
              <span style={{ fontSize: 14 }} title="current status">{u.you ? myStatus : u.state}</span>
            </span>
```
Note: `identity`/`roleLabels` are imported for the self-row label; the `u.you` HOST chip already covers the host case, so `roleLabels` is available for future per-row hats but only `cap.canGrantControl` gates the buttons here. If lint flags `roleLabels`/`identity`/`sameActor` as unused after this edit, drop the specific unused name from the import (keep `sameActor`, which IS used).

- [ ] **Step 3: Run the four gates**

Run: `npx tsc --noEmit && npm run lint && npm run build && npx vitest run`
Expected: all pass.

- [ ] **Step 4: Manually verify the grant flow (dev server / Playwright)**

Room mode → as host, People panel shows **+ DJ / + Vis** buttons. Click **+ DJ** on @vela → button becomes **● DJ**, the bottom "controlled by" chip reads `rack · @vela`, and the InlineRack read-only state flips for the host (host no longer holds rack). Set `MOCK_IDENTITY.isHost=false` in a scratch edit → grant buttons disappear (`cap.canGrantControl=false`). Revert.

- [ ] **Step 5: Commit**

```bash
git add src/features/listen-rack/rail.tsx
git commit -m "feat(listen): People panel DJ/VJ labels + capability-gated grants"
```

---

## Self-Review

**Spec coverage:**
- §4.1 Identity/RoomControl/derived roles → Task 1. ✓
- §4.2 CapabilitySet + resolveCapabilities → Task 2. ✓
- §5 parent props + owner-only SegBar (decision B) → Task 3. ✓
- §5 capability threading + local grant mutation → Task 4. ✓
- §6 PeoplePanel roleLabels + canGrantControl + DJ/VJ chips → Task 5. ✓
- §7 testing (resolver matrix + derivation) → Tasks 1-2 tests. ✓
- §8 swap path (mocks isolated in the route) → Task 3/4 route. ✓

**Type consistency:** `resolveCapabilities(mode, id, control, access)` signature identical across Task 2 + call site (Task 4). `onGrant: (scope, actor|null)` identical across page (Task 4) + RightRail/PeoplePanel (Task 5). `RoomControl { rackHolder, visualsHolder }` used consistently. `cap.canGrantControl`/`cap.rackReadOnly` names match the `CapabilitySet` interface.

**Placeholder scan:** No TBD/TODO; every code step shows full code or an exact old→new replacement. The one cross-file compile coupling (RightRail props span Task 4↔5) is called out explicitly in Task 4 Step 6.

**Note on test granularity:** UI wiring (Tasks 3-5) is verified by the four gates + a scripted manual check rather than new component tests, matching the repo's convention (pure logic is unit-tested; the page itself has no component test). The behavioral guarantees live in the Task 1-2 resolver tests.
