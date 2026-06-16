import type { ConfirmStemItem, StemRole } from '../api/types';

/** Pure: build the confirm payload from rows that have been staged server-side. */
export function buildConfirmPayload(
  rows: ReadonlyArray<{ serverId?: string; role: StemRole }>,
): ConfirmStemItem[] {
  return rows
    .filter((r): r is { serverId: string; role: StemRole } => Boolean(r.serverId))
    .map((r) => ({ id: r.serverId, confirmedRole: r.role }));
}
