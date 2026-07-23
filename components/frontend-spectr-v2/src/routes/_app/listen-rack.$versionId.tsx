import { createFileRoute, Link } from '@tanstack/react-router';
import { useMemo } from 'react';

import { ApiError } from '../../api/fetcher';
import { useJobResults, useNotes, useSong, useVersion } from '../../api/hooks';
import { useAuthedVersionView } from '../../features/listen/useVersionShare';
import {
  isFinalJson, type FinalJson, type Phase1Data, type Phase2Data, type Phase7Data,
} from '../../api/types';
import { ListenRackPage } from '../../features/listen-rack/ListenRackPage';
import type { ReportRef, StatsSource } from '../../features/listen-rack/rail';
import { buildTrack } from '../../features/listen-rack/trackFromAnalysis';
import { useMockRoomOrchestration } from '../../features/listen-rack/useMockRoomOrchestration';
import { useRoomOrchestration } from '../../features/listen-rack/useRoomOrchestration';

// Story 11.5 cutover flag: real SSE room orchestration is the DEFAULT; set
// VITE_ROOM_LIVE_SSE=0 to fall back to the mock during rollout.
const ROOM_LIVE_SSE = import.meta.env['VITE_ROOM_LIVE_SSE'] !== '0';

function pickPhase<T>(fj: FinalJson, phaseNumber: number): T | undefined {
  return fj.phases?.find((p) => p.phase === phaseNumber)?.data as T | undefined;
}

/** Wave-3 E6.1 — honest failure shell for the version load. A 404 (stale deep
 *  link, deleted version) must NEVER fall back to the demo fixture. Exported
 *  for the route-state test. */
export function VersionErrorShell({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 32 }} data-testid="listen-rack-error">
      {notFound ? (
        <>
          <h1>This version doesn&rsquo;t exist or was deleted.</h1>
          <p style={{ color: 'var(--muted)' }}>
            The link may be stale — check your library for the current versions.
          </p>
          <Link to="/library" className="btn primary sm">Go to Library</Link>
        </>
      ) : (
        <>
          <h1>Couldn&rsquo;t load this version.</h1>
          <p style={{ color: 'var(--muted)' }}>Something went wrong fetching it.</p>
          <button type="button" className="btn primary sm" onClick={onRetry}>Retry</button>
        </>
      )}
    </div>
  );
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

  const versionQ = useVersion(versionId);
  const version = versionQ.data;
  const { data: song } = useSong(version?.songId ?? '');
  const latestJobId = song?.latestResult?.jobId;
  const { data: results } = useJobResults(latestJobId ?? '', Boolean(latestJobId));
  // Notes are owner-scoped — only fetch once the owner-scoped version resolved
  // (a guest's notes GET would 404-spam).
  const { data: notes } = useNotes(version ? versionId : '');

  // Room-completion PRP: the owner-scoped GET /versions/{id} 404s for
  // invited/link viewers (who legitimately land here via invite accept or a
  // room join). Fall back to the authed by-id view — access-gated server-side.
  const guestViewQ = useAuthedVersionView(versionId, versionQ.isError);
  const guestView = guestViewQ.data;

  // Build the real track once the song name resolves; stats fill in as the
  // analysis loads. Until then the page falls back to the TRACK fixture.
  const track = useMemo(() => {
    if (song) {
      const fj: FinalJson = isFinalJson(results?.finalJson) ? results.finalJson : {};
      return buildTrack({
        name: song.name,
        phase1: pickPhase<Phase1Data>(fj, 1),
        phase2: pickPhase<Phase2Data>(fj, 2),
        phase7: pickPhase<Phase7Data>(fj, 7),
        notes: notes ?? [],
      });
    }
    // Guest: name-only track (no phase data on the view DTO — stats stay
    // hidden behind the room/view tab matrix; duration fills from the element).
    if (guestView) return buildTrack({ name: guestView.songName, notes: [] });
    return undefined;
  }, [song, results, notes, guestView]);

  // Wave-3 E6.5 — the song's latest report powers "View Report" + the coach
  // hand-off; null (no analysis yet) hides both rather than dead-ending.
  const reportRef: ReportRef | null =
    song && song.latestResult ? { songId: song.id, jobId: song.latestResult.jobId } : null;
  // Wave-3 E6.3 — the stats always come from the song's LATEST analysis, which
  // may be a different version than the one playing. Label the mismatch.
  const statsSource: StatsSource | null = results?.versionId
    ? {
        mismatch: results.versionId !== versionId,
        versionNumber: results.versionNumber ?? null,
      }
    : null;

  // Wave-3 E6.1 — never render the demo fixture for a version that failed to
  // load (or hasn't yet): loading shell first, honest error shell on failure.
  // A guest's owner-scoped 404 first tries the by-id view (above); the error
  // shell only renders when BOTH paths refuse.
  if (versionQ.isLoading || (versionQ.isError && guestViewQ.isLoading)) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 32 }}>
        <p className="mono" style={{ color: 'var(--muted)' }}>Loading version…</p>
      </div>
    );
  }
  if (versionQ.isError && !guestView) {
    return <VersionErrorShell error={versionQ.error} onRetry={() => void versionQ.refetch()} />;
  }

  return (
    <ListenRackPage versionId={versionId} mode={mode} modes={modes} identity={identity}
      access={access} roomControl={roomControl} onGrant={onGrant}
      reportRef={reportRef} statsSource={statsSource}
      {...(fixPreset ? { fixPreset } : {})}
      {...(track ? { track } : {})}
      {...(onModeChange ? { onModeChange } : {})}
      {...(ROOM_LIVE_SSE
        ? { roomLive: real.live, onStartRoom: real.startRoom, isStartingRoom: real.isStartingRoom }
        : {})} />
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
