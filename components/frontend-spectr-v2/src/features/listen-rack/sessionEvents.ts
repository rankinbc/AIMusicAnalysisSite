/* SPECTR · Listen V3 — Room realtime protocol (PRP-4).
 *
 * The canonical SessionEvent union the page consumes over SSE, matched verbatim
 * to PRPs/.../listen-v3-room-sessions.md + LISTEN_V3_UI_CONTRACT.md. Today the
 * Room mock (ListenRackPage `setInterval`) fabricates these locally; when the
 * real stream lands, the consumer becomes `subscribe()` → these events.
 *
 * CONSUMER CONTRACT (load-bearing):
 *   1. The FIRST frame on connect is always `{ type:'sync' }` — a full snapshot.
 *      Hydrate ALL state from it (chain, transport, visuals, roster, feed)
 *      BEFORE applying any delta. A late joiner cannot rebuild the chain from
 *      the delta tail.
 *   2. Then apply deltas in order:
 *      - rack      → applyChainToGraph delta: graph.setEffectParams(effectId, params)
 *      - transport → host-only; mirror playing/position (clients play the file
 *        locally at the synced position — there is NO host audio stream)
 *      - visuals   → from the visuals-grant holder; patch viz/stages/director
 *      - presence/status/reaction/chat → roster + ticker UI
 *      - grant     → update holder chips; authority is the server echo, not the
 *        local optimistic set
 *   3. Audio model: ONE shared rack chain per session (server `room:{id}:chain`).
 *      Every client applies the controller's param changes to its own local
 *      playback, so everyone hears the same processing.
 *
 * Per decision §0 (locked): every actor/grantee is an `ActorRef`, never a bare
 * handle — same identity object as comments + suggestions.
 */
import type { ActorRef } from './access';
import type { Chain, EffectId } from './chain';
import type { ModuleState, VizState } from './data';

export interface ControlGrant {
  id: string;                  // === Suggestion.viaGrantId === RackPreset.viaGrantId (real FKs)
  sessionId: string;
  scope: 'rack' | 'visuals';   // exactly two scopes; one active holder each
  grantee: ActorRef;
  grantedBy: ActorRef;         // the host
  revokedAt: string | null;    // granting a scope auto-revokes the prior holder
}

/** One-shot reaction (burst + ticker + recap anchor). `t` = playhead seconds. */
export interface ReactionEvent {
  type: 'reaction';
  id: string;
  actor: ActorRef;
  emoji: string;
  t: number;
}

/**
 * NOTE: the contract types the rack event's `params` as `object`; narrowed here
 * to `Partial<ModuleState>` — the same patch `graph.setEffectParams(id, patch)`
 * already accepts (a type-safe refinement, wire-compatible).
 */
export type SessionEvent =
  | {
      type: 'sync';            // connect-only hydrate, emitted once before deltas
      chain: Chain;
      transport: { playing: boolean; position: number };
      visuals: { patch: Partial<VizState>; stages: string[]; director: string };
      roster: ActorRef[];
      feed: ReactionEvent[];
    }
  | { type: 'presence'; actor: ActorRef; state: 'join' | 'leave' }
  | ReactionEvent
  | { type: 'status'; actor: ActorRef; status: string }
  | { type: 'chat'; id: string; actor: ActorRef; body: string; t: number }
  | { type: 'grant'; grant: ControlGrant }
  | { type: 'transport'; playing: boolean; position: number }          // host only
  | { type: 'visuals'; patch: Partial<VizState>; stages?: string[]; director?: string }  // visuals-controller
  | { type: 'rack'; effectId: EffectId; params: Partial<ModuleState> }; // rack-controller
