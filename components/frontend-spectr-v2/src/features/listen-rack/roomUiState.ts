/* SPECTR · Listen V3 — room UI state selectors (pure).
 *
 * roomHeaderState — the header/panel state matrix for a live room (E6.9/E6.10):
 * which chrome the LIVE badge area renders given the stream status + the
 * latched ended flag. reactOutcome — the E6.13 send-honesty decision: a
 * presence pop only when the server accepted the reaction, status revert on a
 * failed status send. Both unit-tested; the page just applies them.
 */
import type { RoomStreamStatus } from '../listen/useRoomStream';

export type RoomHeaderState = 'live' | 'reconnecting' | 'lost' | 'forbidden' | 'ended';

export function roomHeaderState(streamStatus: RoomStreamStatus, ended: boolean): RoomHeaderState {
  if (ended) return 'ended'; // ended wins — a closed stream is expected then
  switch (streamStatus) {
    case 'open':
      return 'live';
    case 'connecting':
    case 'reconnecting':
      return 'reconnecting';
    case 'lost':
      return 'lost';
    case 'forbidden':
      return 'forbidden';
    default:
      // idle/closed while the seam exists — transitional; render as live
      // rather than flashing an alarming state.
      return 'live';
  }
}

/** Copy shown in place of the People/Chat panels when the room is not usable
 * (frozen roster ≠ honest roster). null ⇒ render the panels normally
 * (reconnecting keeps them up — the data is merely stale). */
export function roomPanelNotice(state: RoomHeaderState): string | null {
  switch (state) {
    case 'ended':
      return 'This room has ended.';
    case 'lost':
      return 'Connection lost — retry from the room header.';
    case 'forbidden':
      return 'You no longer have access to this room.';
    default:
      return null;
  }
}

export interface ReactOutcome {
  pop: boolean; // spawn the presence pop (server accepted the reaction)
  toast: boolean; // surface the failed reaction
  revertStatus: boolean; // roll back the optimistic myStatus
}

export function reactOutcome(settled: {
  react: 'fulfilled' | 'rejected';
  status: 'fulfilled' | 'rejected';
}): ReactOutcome {
  return {
    pop: settled.react === 'fulfilled',
    toast: settled.react === 'rejected',
    revertStatus: settled.status === 'rejected',
  };
}
