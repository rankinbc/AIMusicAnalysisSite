/* SPECTR · Listen V3 — story 11.5: REAL room orchestration adapter.
 *
 * Same return shape as useMockRoomOrchestration (ListenRackPage props are
 * unchanged) plus a `live` seam with the SSE-backed feed/roster/senders.
 * Composes the already-written-and-tested hooks: useRoomSession (lifecycle),
 * useRoomStream (receive), useRoomActions (send). Server is the authority —
 * every action POSTs and the change comes back through the stream (the
 * senders are fire-and-forget, never optimistic cache writes).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetcher } from '../../api/fetcher';
import { useMe } from '../../api/hooks';
import type { AccessDto as ApiAccessDto, RoomSnapshot, SessionEvent } from '../../api/types';
import { useRoomActions } from '../listen/useRoomActions';
import { useRoomStream, type RoomStreamStatus } from '../listen/useRoomStream';
import {
  useEndSession,
  usePublishRecap,
  useSessionHistory,
  useStartSession,
} from '../listen/useRoomSession';

import { availableModes, MOCK_ACCESS, type AccessDto, type ActorRef, type ModeId } from './access';
import { type Identity, type RoomControl } from './identity';
import {
  applyEvent,
  applySnapshot,
  initialRoomState,
  type RoomLiveState,
} from './roomStateReducer';
import type { MockRoomOrchestration } from './useMockRoomOrchestration';

// The live seam the page consumes IN ADDITION to the mock-shaped props. null
// until a live session exists (page keeps its demo behavior until then).
export interface RoomLiveSeam {
  sessionId: string;
  streamStatus: RoomStreamStatus;
  state: RoomLiveState;
  sendReact: (emoji: string, t: number) => void;
  sendChat: (body: string, t: number) => void;
  sendStatus: (emoji: string) => void;
  endRoom: () => void; // host: end + publish recap (AC4)
  isEnding: boolean;
}

export interface RoomOrchestration extends MockRoomOrchestration {
  live: RoomLiveSeam | null;
  startRoom: (() => void) | undefined; // host-only; undefined when not hostable
  isStartingRoom: boolean;
}

function useVersionAccess(versionId: string) {
  return useQuery({
    queryKey: ['versions', versionId, 'access'],
    queryFn: () => fetcher<ApiAccessDto>({ url: `/versions/${versionId}/access`, method: 'GET' }),
    enabled: Boolean(versionId),
    staleTime: 60_000,
  });
}

export function useRoomOrchestration(versionId: string): RoomOrchestration {
  const { data: me } = useMe(true);
  const { data: apiAccess } = useVersionAccess(versionId);

  // api AccessDto roles are a subset of the page's (which adds 'reviewer');
  // fall back to the owner mock only while access is loading so the page
  // renders — the server stays the authority once resolved.
  const access: AccessDto = apiAccess ?? MOCK_ACCESS;

  const modes = useMemo(() => availableModes(access), [access]);
  const [mode, setMode] = useState<ModeId>('work');
  useEffect(() => {
    if (!modes.includes(mode)) setMode(modes[0] ?? 'work');
  }, [modes, mode]);

  // ── session discovery + lifecycle ─────────────────────────────────────────
  const history = useSessionHistory(versionId);
  const liveSession = useMemo(
    () => (history.data ?? []).find((s) => s.status === 'live') ?? null,
    [history.data],
  );
  const startMut = useStartSession(versionId);
  const endMut = useEndSession(versionId);
  const recapMut = usePublishRecap(versionId);
  const sessionId = startMut.data?.id ?? liveSession?.id ?? null;

  const meKey = me ? `user:${me.id}` : null;
  const isHost = Boolean(
    sessionId && me && (startMut.data?.hostId === me.id || liveSession?.hostId === me.id),
  );

  const identity: Identity = useMemo(() => {
    const actor: ActorRef = me
      ? {
          type: 'user',
          userId: me.id,
          handle: me.handle ?? me.email,
          displayName: me.displayName ?? me.handle ?? me.email,
        }
      : { type: 'anon' };
    return { actor, isOwner: access.role === 'owner', baseRole: access.role, isHost };
  }, [me, access.role, isHost]);

  // ── live state: sync snapshot then deltas (AC1) ───────────────────────────
  const [state, setState] = useState<RoomLiveState>(initialRoomState);
  const meKeyRef = useRef(meKey);
  meKeyRef.current = meKey;
  const handlers = useMemo(
    () => ({
      onSync: (snap: RoomSnapshot) => setState(applySnapshot(snap, meKeyRef.current)),
      onEvent: (e: SessionEvent) => setState((s) => applyEvent(s, e, meKeyRef.current)),
    }),
    [],
  );
  const streamStatus = useRoomStream(sessionId, handlers);
  useEffect(() => {
    if (!sessionId) setState(initialRoomState());
  }, [sessionId]);

  // ── actions (AC2, AC3) ────────────────────────────────────────────────────
  const actions = useRoomActions(sessionId ?? '');

  const onGrant = useCallback(
    (scope: 'rack' | 'visuals', actor: ActorRef | null) => {
      if (!sessionId) return;
      if (actor === null) {
        void actions.revoke({ scope });
      } else {
        void actions.grant({
          scope,
          grantee: {
            userId: actor.userId ?? null,
            displayName: actor.displayName ?? actor.handle ?? null,
          },
        });
      }
      // No local state write — the grant/revoke event returns via the stream
      // and folds into roomControl (server-authoritative capabilities, AC3).
    },
    [sessionId, actions],
  );

  const endRoom = useCallback(() => {
    if (!sessionId) return;
    endMut.mutate(sessionId, {
      onSuccess: () => recapMut.mutate({ sessionId, body: { momentIds: [] } }),
    });
  }, [sessionId, endMut, recapMut]);

  const live: RoomLiveSeam | null = sessionId
    ? {
        sessionId,
        streamStatus,
        state,
        sendReact: (emoji, t) => void actions.react({ emoji, t }),
        sendChat: (body, t) => void actions.chat({ body, t }),
        sendStatus: (emoji) => void actions.status({ emoji }),
        endRoom,
        isEnding: endMut.isPending || recapMut.isPending,
      }
    : null;

  // Live grant/revoke state wins once synced; otherwise nobody holds control.
  const roomControl: RoomControl = state.roomControl;

  return {
    mode,
    modes,
    identity,
    access,
    roomControl,
    onModeChange: identity.isOwner ? setMode : undefined,
    onGrant,
    live,
    startRoom: access.roomHostable && !sessionId ? () => startMut.mutate() : undefined,
    isStartingRoom: startMut.isPending,
  };
}
