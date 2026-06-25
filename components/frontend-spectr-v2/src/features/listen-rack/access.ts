/* SPECTR · Listen V3 — mode + access + layout contract.
 *
 * Implements LISTEN_V3_UI_CONTRACT.md:
 *   - Q1: mode gating is SERVER-driven → key off AccessDto (resolved booleans),
 *         never off raw visibility. (MOCK_ACCESS here until GET /access is wired.)
 *   - Q2: the spec §04 matrix is the CLIENT layout authority → MODE_SURFACE_MATRIX.
 *         Server = authority (what you CAN do); client = layout (what SHOWS).
 *   - Q4: View comment/suggestion shapes (safe to mock; endpoints PRP-3-proposed).
 */
import type { Chain } from './chain';

export type ModeId = 'work' | 'view' | 'room';

// ── Q1 — resolved access decision (GET /api/versions/{versionId}/access) 🔒 ──
export interface AccessGates {
  canComment: boolean;
  canSuggest: boolean;
  canBookmark: boolean;
}
export interface AccessDto {
  role: 'owner' | 'reviewer' | 'invited' | 'anon' | 'none';
  canWork: boolean;        // owner only — Work is strictly private
  canView: boolean;        // visibility != private AND actor permitted
  roomHostable: boolean;
  roomJoinable: boolean;
  coachAvailable: boolean; // owner only — coach never for a non-owner
  gates: AccessGates;
}

/**
 * MOCK — the page's actor is the owner with full capability. Replace with the
 * real `GET /api/versions/{id}/access` (or the `gates` embedded in
 * `GET /api/v/{token}` for anon link viewers).
 */
export const MOCK_ACCESS: AccessDto = {
  role: 'owner',
  canWork: true,
  canView: true,
  roomHostable: true,
  roomJoinable: false,
  coachAvailable: true,
  gates: { canComment: true, canSuggest: true, canBookmark: true },
};

/** Modes the SegBar should render, in lifecycle order, given resolved access. */
export function availableModes(a: AccessDto): ModeId[] {
  const modes: ModeId[] = [];
  if (a.canWork) modes.push('work');
  if (a.canView) modes.push('view');
  if (a.roomHostable || a.roomJoinable) modes.push('room');
  return modes;
}

// ── Q2 — spec §04 surface matrix (client layout authority) ─────────────────
export type RackPresentation = 'full' | 'readonly' | 'host';
export type VisualsPresentation = 'utility' | 'personal' | 'full';
export type CoachPresentation = 'primary' | 'reference' | 'hidden';
export type MeterPresentation = 'prominent' | 'visible' | 'minimal';
export type PresencePresentation = 'none' | 'commenters' | 'live';
export type ChatPresentation = 'none' | 'async' | 'live';

export interface ModeSurface {
  label: string;
  blurb: string;
  accent: string;
  rack: RackPresentation;
  visuals: VisualsPresentation;
  coach: CoachPresentation;
  metering: MeterPresentation;
  presence: PresencePresentation;
  chat: ChatPresentation;
  /** Ordered candidate rail tabs; further filtered by AccessDto.gates. */
  railTabs: string[];
}

export const MODE_SURFACE_MATRIX: Record<ModeId, ModeSurface> = {
  work: {
    label: 'WORK', blurb: 'Private workbench — analyse & tweak', accent: 'var(--cyan)',
    rack: 'full', visuals: 'utility', coach: 'primary', metering: 'prominent',
    presence: 'none', chat: 'none', railTabs: ['coach', 'plan', 'stats', 'notes'],
  },
  view: {
    label: 'VIEW', blurb: 'Async review — give & get feedback', accent: 'var(--violet)',
    rack: 'readonly', visuals: 'personal', coach: 'reference', metering: 'visible',
    presence: 'commenters', chat: 'async', railTabs: ['comments', 'coach', 'stats', 'notes'],
  },
  room: {
    label: 'ROOM', blurb: 'Live session — listen together', accent: 'var(--orange)',
    rack: 'host', visuals: 'full', coach: 'hidden', metering: 'minimal',
    presence: 'live', chat: 'live', railTabs: ['people', 'chat'],
  },
};

/** Resolve the rail tabs to actually mount: matrix candidates ∩ access gates. */
export function railTabsFor(mode: ModeId, access: AccessDto): string[] {
  return MODE_SURFACE_MATRIX[mode].railTabs.filter((t) =>
    t === 'coach' ? access.coachAvailable : true);
}

// ── Q4 — View comments + suggestions (shapes settled; endpoints PRP-3) 🟡 ──
export interface ActorRef {
  type: 'user' | 'anon';
  userId?: string;
  handle?: string;
  displayName?: string;
  hue?: number;
}

export interface CommentDto {
  id: string;
  targetVersionId: string;
  parentId: string | null;
  t: number | null;                 // timestamp seconds; null = track-level
  author: ActorRef;
  body: string;
  status: 'open' | 'resolved' | 'pinned' | 'hidden';
  suggestionId: string | null;
  createdAt: string;
  deletedAt: string | null;
}

export interface SuggestionDto {
  id: string;
  songVersionId: string;
  fromActor: ActorRef;
  chain: Chain;                     // flat & canonical (D4.3 — no RackPreset until the owner accepts/forks)
  commentId: string | null;
  createdInSessionId: string | null;// set if proposed live in a Room
  viaGrantId: string | null;        // set on a Room grantee-save; copies onto the adopted preset (D4.5)
  status: 'proposed' | 'auditioned' | 'accepted' | 'rejected';
  createdAt: string;
}

/** MOCK View thread — replace with GET /api/versions/{id}/comments. */
export const MOCK_COMMENTS: CommentDto[] = [
  { id: 'c1', targetVersionId: 'mock', parentId: null, t: 64, author: { type: 'user', handle: 'vela', hue: 220 }, body: 'Drop A hits hard — but the sub feels ~1 dB hot against the kick.', status: 'open', suggestionId: 's1', createdAt: '', deletedAt: null },
  { id: 'c2', targetVersionId: 'mock', parentId: null, t: 132, author: { type: 'user', handle: 'forge', hue: 18 }, body: 'Breakdown reverb tail is gorgeous. Wouldn’t touch it.', status: 'pinned', suggestionId: null, createdAt: '', deletedAt: null },
  { id: 'c3', targetVersionId: 'mock', parentId: null, t: null, author: { type: 'anon', displayName: 'anon-river', hue: 195 }, body: 'Overall master is a touch loud for streaming — worth checking −14 LUFS.', status: 'open', suggestionId: null, createdAt: '', deletedAt: null },
];
