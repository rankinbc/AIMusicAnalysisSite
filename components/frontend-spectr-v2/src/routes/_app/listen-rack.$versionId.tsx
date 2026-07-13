import { createFileRoute } from '@tanstack/react-router';
import { useMemo } from 'react';

import { useJobResults, useNotes, useSong, useVersion } from '../../api/hooks';
import {
  isFinalJson, type FinalJson, type Phase1Data, type Phase2Data, type Phase7Data,
} from '../../api/types';
import { ListenRackPage } from '../../features/listen-rack/ListenRackPage';
import { buildTrack } from '../../features/listen-rack/trackFromAnalysis';
import { useMockRoomOrchestration } from '../../features/listen-rack/useMockRoomOrchestration';
import { useRoomOrchestration } from '../../features/listen-rack/useRoomOrchestration';

// Story 11.5 cutover flag: real SSE room orchestration is the DEFAULT; set
// VITE_ROOM_LIVE_SSE=0 to fall back to the mock during rollout.
const ROOM_LIVE_SSE = import.meta.env['VITE_ROOM_LIVE_SSE'] !== '0';

function pickPhase<T>(fj: FinalJson, phaseNumber: number): T | undefined {
  return fj.phases?.find((p) => p.phase === phaseNumber)?.data as T | undefined;
}

/**
 * Listen — Rack & Visuals redesign, REAL-AUDIO route (Phase 1 + 2 page port).
 *
 * Plays the real version (Phase 1) and binds the rack/meters/spectrum to the
 * engine (Phase 2). Here it also feeds the page the REAL track header / notes /
 * sections / stats from the version + 7-phase analysis (replacing the TRACK
 * fixture). Mode / identity / room-control stay mocked — PRP-2 (GET /access) +
 * PRP-4 (room stream).
 */
function ListenRackVersionRoute() {
  const { versionId } = Route.useParams();
  const { fixPreset } = Route.useSearch();
  // Both hooks run unconditionally (rules of hooks); the flag selects which
  // one drives the page. The real hook's queries are disabled when the flag
  // is off (empty versionId gates every `enabled:`).
  const real = useRoomOrchestration(ROOM_LIVE_SSE ? versionId : '');
  const mock = useMockRoomOrchestration();
  const { mode, modes, identity, access, roomControl, onModeChange, onGrant } =
    ROOM_LIVE_SSE ? real : mock;

  const { data: version } = useVersion(versionId);
  const { data: song } = useSong(version?.songId ?? '');
  const latestJobId = song?.latestResult?.jobId;
  const { data: results } = useJobResults(latestJobId ?? '', Boolean(latestJobId));
  const { data: notes } = useNotes(versionId);

  // Build the real track once the song name resolves; stats fill in as the
  // analysis loads. Until then the page falls back to the TRACK fixture.
  const track = useMemo(() => {
    if (!song) return undefined;
    const fj: FinalJson = isFinalJson(results?.finalJson) ? results.finalJson : {};
    return buildTrack({
      name: song.name,
      phase1: pickPhase<Phase1Data>(fj, 1),
      phase2: pickPhase<Phase2Data>(fj, 2),
      phase7: pickPhase<Phase7Data>(fj, 7),
      notes: notes ?? [],
    });
  }, [song, results, notes]);

  return (
    <ListenRackPage versionId={versionId} mode={mode} modes={modes} identity={identity}
      access={access} roomControl={roomControl} onGrant={onGrant}
      {...(fixPreset ? { fixPreset } : {})}
      {...(track ? { track } : {})}
      {...(onModeChange ? { onModeChange } : {})}
      {...(ROOM_LIVE_SSE ? { roomLive: real.live, onStartRoom: real.startRoom } : {})} />
  );
}

// Story 12.4: ?fixPreset=<uuid> — the fix-rack carry-over handle written by
// the report's "Open in Listen rack". Validated to uuid shape here (results-
// route idiom); the server round-trip re-validates ownership. Kept in the URL
// (survives refresh/back); the "Fixes applied" chip's reset clears it.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ListenRackSearch {
  fixPreset?: string;
}

export const Route = createFileRoute('/_app/listen-rack/$versionId')({
  validateSearch: (search: Record<string, unknown>): ListenRackSearch =>
    typeof search['fixPreset'] === 'string' && UUID_RE.test(search['fixPreset'])
      ? { fixPreset: search['fixPreset'] }
      : {},
  component: ListenRackVersionRoute,
});
