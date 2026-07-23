/* SPECTR · Listen V3 — story 11.5: REAL room orchestration adapter.
 *
 * Same return shape as useMockRoomOrchestration (ListenRackPage props are
 * unchanged) plus a `live` seam with the SSE-backed feed/roster/senders.
 * Composes the already-written-and-tested hooks: useRoomSession (lifecycle),
 * useRoomStream (receive), useRoomActions (send). Server is the authority —
 * every action POSTs and the change comes back through the stream (the
 * senders are promise-returning so callers can surface failures — E6.13 —
 * but never optimistic cache writes). */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError, fetcher } from '../../api/fetcher';
import { extractApiError } from '../../api/error-utils';
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
  // Promise-returning (E6.13): callers decide what a failed send looks like.
  // Any rejection with code `session_ended` ALSO folds state.ended locally.
  sendReact: (emoji: string, t: number) => Promise<void>;
  sendChat: (body: string, t: number) => Promise<void>;
  sendStatus: (emoji: string) => Promise<void>;
  /** Host-only caller (server 403s others). Never rejects — the stream echo is
   *  the ack; a failed emit self-heals on the next one (E6.11). */
  sendTransport: (playing: boolean, position: number) => Promise<void>;
  /** Manual reconnect from the 'lost' stream state (E6.9). */
  retryStream: () => void;
  endRoom: () => void; // host: end + publish recap (AC4)
  isEnding: boolean;
  /** True once the recap publish succeeded (the ended banner links to it). */
  recapPublished: boolean;
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

function isSessionEnded(err: unknown): boolean {
  return err instanceof ApiError && extractApiError(err.body).code === 'session_ended';
}

export function useRoomOrchestration(versionId: string): RoomOrchestration {
  const { data: me } = useMe(true);
  const { data: apiAccess } = useVersionAccess(versionId);
  const qc = useQueryClient();

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
  // E6.10 — once ended, close the stream (null sessionId aborts it). Emptying
  // presence is what unblocks the backend's finalize path.
  const effectiveSessionId = state.ended ? null : sessionId;
  const { status: streamStatus, retry: retryStream } = useRoomStream(effectiveSessionId, handlers);
  useEffect(() => {
    if (!sessionId) setState(initialRoomState());
  }, [sessionId]);

  // Ended: re-fetch the session history so liveSession clears once the server
  // finalizes (lazy GET backstop / last-leaver job).
  useEffect(() => {
    if (state.ended && versionId) {
      void qc.invalidateQueries({ queryKey: ['versions', versionId, 'sessions'] });
    }
  }, [state.ended, versionId, qc]);

  // A dead room discovered via POST (409 session_ended), not just via event.
  const foldEnded = useCallback(() => {
    setState((s) => (s.ended ? s : { ...s, ended: true }));
  }, []);
  const withEndedFold = useCallback(
    (p: Promise<void>): Promise<void> =>
      p.catch((err: unknown) => {
        if (isSessionEnded(err)) foldEnded();
        throw err;
      }),
    [foldEnded],
  );

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

  // E6.12 — recap publish is idempotent server-side, so the failure toast
  // carries a Retry that re-posts the same request.
  const publishRecap = useCallback(
    function publish(sid: string) {
      recapMut.mutate(
        { sessionId: sid, body: { momentIds: [] } },
        {
          onError: () =>
            toast.error('Room ended — recap publish failed.', {
              id: 'room-recap',
              action: { label: 'Retry', onClick: () => publish(sid) },
            }),
        },
      );
    },
    [recapMut],
  );

  const endRoom = useCallback(() => {
    if (!sessionId) return;
    endMut.mutate(sessionId, {
      onSuccess: () => publishRecap(sessionId),
      onError: () => toast.error("Couldn't end the room.", { id: 'room-end' }),
    });
  }, [sessionId, endMut, publishRecap]);

  // E6.8 — explicit start-failure copy. Click-driven, so mutate-level
  // callbacks are safe (the StrictMode trap is fire-on-mount only).
  const startRoom = useCallback(() => {
    startMut.mutate(undefined, {
      onError: (err: unknown) => {
        const code = err instanceof ApiError ? extractApiError(err.body).code : undefined;
        toast.error(
          code === 'room_not_hostable'
            ? "Room hosting isn't enabled for your account."
            : "Couldn't start the room — try again.",
          { id: 'room-start' },
        );
      },
    });
  }, [startMut]);

  const live: RoomLiveSeam | null = sessionId
    ? {
        sessionId,
        streamStatus,
        state,
        sendReact: (emoji, t) => withEndedFold(actions.react({ emoji, t })),
        sendChat: (body, t) => withEndedFold(actions.chat({ body, t })),
        sendStatus: (emoji) => withEndedFold(actions.status({ emoji })),
        sendTransport: (playing, position) =>
          actions.transport({ playing, position }).catch((err: unknown) => {
            // Fire-and-forget by contract: fold a dead room, swallow the rest
            // (the next transport emit self-heals).
            if (isSessionEnded(err)) foldEnded();
          }),
        retryStream,
        endRoom,
        isEnding: endMut.isPending || recapMut.isPending,
        recapPublished: recapMut.isSuccess,
      }
    : null;

  // Live grant/revoke state wins once synced; otherwise nobody holds control.
  const roomControl: RoomControl = state.roomControl;

  // Mode is client-local UI state; `modes` (from server access) is the real
  // gate. Owner-only switching (the 11-5 placeholder) locked joinable guests
  // out of ROOM entirely — an invitee could be IN the presence roster (the
  // stream is mode-independent) with no way to see the room UI. Anyone may
  // switch among their available modes; single-mode visitors get no switcher.
  const onModeChange = useMemo(
    () =>
      modes.length > 1
        ? (m: ModeId) => {
            if (modes.includes(m)) setMode(m);
          }
        : undefined,
    [modes],
  );

  return {
    mode,
    modes,
    identity,
    access,
    roomControl,
    onModeChange,
    onGrant,
    live,
    startRoom: access.roomHostable && !sessionId ? startRoom : undefined,
    isStartingRoom: startMut.isPending,
  };
}
