/* SPECTR · Listen V3 (PRP-4) — Room action senders. Each POST appends to the
 * server's Redis WAL + publishes to the room channel; the change comes back to
 * every client (incl. the sender) via the stream, so these are fire-and-forget
 * (202) — NOT optimistic cache writes. Authority is enforced server-side per
 * event (transport/grant/revoke = host; rack/visuals = the scope holder). Anon
 * callers pass the share/session `token`. */
import { useMemo } from 'react';

import { fetcher } from '../../api/fetcher';
import type {
  ChatRequest,
  ControlGrantDto,
  GrantRequest,
  RackRequest,
  ReactRequest,
  RevokeRequest,
  RoomStatusRequest,
  TransportRequest,
  VisualsRequest,
} from '../../api/types';

export interface RoomActions {
  react: (body: ReactRequest) => Promise<void>;
  chat: (body: ChatRequest) => Promise<void>;
  status: (body: RoomStatusRequest) => Promise<void>;
  transport: (body: TransportRequest) => Promise<void>;
  visuals: (body: VisualsRequest) => Promise<void>;
  rack: (body: RackRequest) => Promise<void>;
  grant: (body: GrantRequest) => Promise<ControlGrantDto>;
  revoke: (body: RevokeRequest) => Promise<void>;
}

export function useRoomActions(sessionId: string, token?: string | null): RoomActions {
  return useMemo<RoomActions>(() => {
    const params = token ? { token } : undefined;
    const post = <T = void>(path: string, data?: unknown) =>
      fetcher<T>({ url: `/sessions/${sessionId}${path}`, method: 'POST', data, params });
    return {
      react: (body) => post('/react', body),
      chat: (body) => post('/chat', body),
      status: (body) => post('/status', body),
      transport: (body) => post('/transport', body),
      visuals: (body) => post('/visuals', body),
      rack: (body) => post('/rack', body),
      grant: (body) => post<ControlGrantDto>('/grant', body),
      revoke: (body) => post('/revoke', body),
    };
  }, [sessionId, token]);
}
