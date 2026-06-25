import { createFileRoute } from '@tanstack/react-router';
import { useMemo } from 'react';

import { useJobResults, useNotes, useSong, useVersion } from '../../api/hooks';
import {
  isFinalJson, type FinalJson, type Phase1Data, type Phase2Data, type Phase7Data,
} from '../../api/types';
import { ListenRackPage } from '../../features/listen-rack/ListenRackPage';
import { buildTrack } from '../../features/listen-rack/trackFromAnalysis';
import { useMockRoomOrchestration } from '../../features/listen-rack/useMockRoomOrchestration';

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
  const { mode, modes, identity, access, roomControl, onModeChange, onGrant } =
    useMockRoomOrchestration();

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
      {...(track ? { track } : {})}
      {...(onModeChange ? { onModeChange } : {})} />
  );
}

export const Route = createFileRoute('/_app/listen-rack/$versionId')({
  component: ListenRackVersionRoute,
});
