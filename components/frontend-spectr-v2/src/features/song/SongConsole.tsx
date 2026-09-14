/**
 * SongConsole — the full song-detail page assembled from feature components.
 *
 * Owns: data fetching, dialog state, audio player state, toast routing, and the
 * four screen states (loading / error / empty / populated).
 *
 * The route (`songs.$songId.tsx`) is now a thin shell that renders this component.
 */
import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  useArchiveSong,
  useDeleteVersion,
  useSong,
} from '../../api/hooks';
import { fetcher } from '../../api/fetcher';
import type { ReanalyzeResponse, VersionDto as VD } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { SongEditDialog } from '../../components/SongEditDialog';
import { SharePublishDialog } from '../../components/SharePublishDialog';
import { UnifiedUploadDialog } from '../../components/UnifiedUploadDialog';
import { showAnalysisDispatchError } from '../../components/verify-email';
import { ReanalyzeWithReferenceDialog } from '../../features/references/ReanalyzeWithReferenceDialog';
import { hueFromId } from '../../ui/hueFromId';
import { visualFromDto } from '../../ui/songVisualModel';

import { GamePlanViewModal } from './GamePlanViewModal';
import { QuickPlayer } from './QuickPlayer';
import { ScoreTrendCard } from './ScoreTrendCard';
import { SongHeader } from './SongHeader';
import { VersionList } from './VersionList';
import { hasGamePlan } from './song-helpers';
import { useQuickPlayer } from './useQuickPlayer';

import styles from './SongConsole.module.css';

interface SongConsoleProps {
  songId: string;
}


export function SongConsole({ songId }: SongConsoleProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  // ── Data ─────────────────────────────────────────────────────────────────
  const { data: song, isLoading, error } = useSong(songId);

  // ── Audio player ─────────────────────────────────────────────────────────
  const player = useQuickPlayer(song?.versions ?? []);

  // ── Dialog state ─────────────────────────────────────────────────────────
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteVersionId, setDeleteVersionId] = useState<string | null>(null);
  const [refReanalyzeVersionId, setRefReanalyzeVersionId] = useState<string | null>(null);
  const [gamePlanVersionId, setGamePlanVersionId] = useState<string | null>(null);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const archive = useArchiveSong();
  const deleteVersion = useDeleteVersion();

  /** Make a version the current one. */
  const makeCurrentMutation = useMutation({
    mutationFn: (versionId: string) =>
      fetcher<void>({ url: `/versions/${versionId}/set-current`, method: 'POST' }),
    onSuccess: (_, versionId) => {
      void qc.invalidateQueries({ queryKey: ['versions', versionId] });
      void qc.invalidateQueries({ queryKey: ['songs'] });
    },
  });

  /** Patch a version label. */
  const patchVersionMutation = useMutation({
    mutationFn: ({ versionId, label }: { versionId: string; label: string | null }) =>
      fetcher<VD>({ url: `/versions/${versionId}`, method: 'PATCH', data: { label } }),
    onSuccess: (_, { versionId }) => {
      void qc.invalidateQueries({ queryKey: ['versions', versionId] });
      void qc.invalidateQueries({ queryKey: ['songs'] });
    },
  });

  /** Trigger a full re-analysis. Returns ReanalyzeResponse with jobId. */
  const reanalyzeMutation = useMutation({
    mutationFn: (versionId: string) =>
      fetcher<ReanalyzeResponse>({ url: `/versions/${versionId}/analyze`, method: 'POST' }),
    onSuccess: (_, versionId) => {
      void qc.invalidateQueries({ queryKey: ['versions', versionId] });
      void qc.invalidateQueries({ queryKey: ['songs'] });
    },
  });

  // ── Computed ──────────────────────────────────────────────────────────────
  const gamePlanIds = useMemo<ReadonlySet<string>>(() => {
    if (!song) return new Set();
    return new Set(song.versions.filter((v) => hasGamePlan(v.id)).map((v) => v.id));
  }, [song]);

  const coverVisual = useMemo(
    () =>
      song
        ? visualFromDto(song.visualTemplate, song.visualPrimary, song.visualSecondary)
        : null,
    [song],
  );
  const coverHue = useMemo(() => hueFromId(song?.id), [song?.id]);

  // ── Version action callbacks ──────────────────────────────────────────────
  const onPlay = useCallback(
    (id: string) => {
      player.loadIntoA(id);
    },
    [player],
  );

  const onReport = useCallback(
    () => {
      // The BFF currently exposes the latest analysis via song.latestResult.
      // Navigate there; per-version jobIds land once the BFF shape widens.
      if (!song?.latestResult) return;
      void navigate({
        to: '/songs/$songId/results/$jobId',
        params: { songId: song.id, jobId: song.latestResult.jobId },
      });
    },
    [song, navigate],
  );

  const startReanalysis = useCallback(
    (versionId: string) => {
      reanalyzeMutation.mutate(versionId, {
        onSuccess: (res) => {
          toast.success('Re-analysis started');
          if (song) {
            void navigate({
              to: '/songs/$songId/results/$jobId',
              params: { songId: song.id, jobId: res.jobId },
            });
          }
        },
        // Story 12.1 (AC2) — verify-gate 403 gets the resend-action toast.
        onError: (err) => showAnalysisDispatchError(err, 'Could not start re-analysis'),
      });
    },
    [song, reanalyzeMutation, navigate],
  );

  const onRetry = useCallback(
    (versionId: string) => startReanalysis(versionId),
    [startReanalysis],
  );

  const onMakeCurrent = useCallback(
    (versionId: string) => {
      makeCurrentMutation.mutate(versionId, {
        onSuccess: () => toast.success('Marked as current version'),
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : 'Could not set current'),
      });
    },
    [makeCurrentMutation],
  );

  const onReanalyze = useCallback(
    (versionId: string) => startReanalysis(versionId),
    [startReanalysis],
  );

  const onEditLabel = useCallback(
    (versionId: string, label: string): Promise<void> =>
      patchVersionMutation
        .mutateAsync({ versionId, label: label.trim() || null })
        .then(() => undefined)
        .catch((err: unknown) => {
          toast.error('Could not update label');
          throw err;
        }),
    [patchVersionMutation],
  );

  const onOpenListen = useCallback(
    (versionId: string) => {
      void navigate({
        to: '/listen-rack/$versionId',
        params: { versionId },
      });
    },
    [navigate],
  );

  const onViewGamePlan = useCallback((versionId: string) => {
    setGamePlanVersionId(versionId);
  }, []);

  const onDelete = useCallback((versionId: string) => {
    setDeleteVersionId(versionId);
  }, []);

  // ── Screen: loading ───────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className={styles.page}>
        <div className="card" style={{ padding: 22, display: 'flex', gap: 20, alignItems: 'flex-start' }}>
          <div className={styles.shimmer} style={{ width: 152, height: 152, borderRadius: 14, flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6 }}>
            <div className={styles.shimmer} style={{ width: '54%', height: 30, borderRadius: 8 }} />
            <div className={styles.shimmer} style={{ width: '78%', height: 16, borderRadius: 6 }} />
            <div className={styles.shimmer} style={{ width: '38%', height: 16, borderRadius: 6 }} />
          </div>
        </div>
        <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className={styles.shimmer} style={{ width: '30%', height: 14, borderRadius: 6 }} />
          <div className={styles.shimmer} style={{ width: '100%', height: 56, borderRadius: 10 }} />
          <div className={styles.shimmer} style={{ width: '100%', height: 56, borderRadius: 10 }} />
        </div>
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
            <div className={styles.shimmer} style={{ width: '26%', height: 14, borderRadius: 6 }} />
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '15px 18px', borderBottom: '1px solid var(--border)' }}>
              <div className={styles.shimmer} style={{ width: 34, height: 34, borderRadius: 8 }} />
              <div className={styles.shimmer} style={{ width: '40%', height: 15, borderRadius: 6 }} />
              <div style={{ flex: 1 }} />
              <div className={styles.shimmer} style={{ width: 64, height: 15, borderRadius: 6 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Screen: error ─────────────────────────────────────────────────────────
  if (error || !song) {
    return (
      <div className={styles.page}>
        <div className={`card ${styles.fadeUp}`} style={{ padding: '52px 32px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 54, height: 54, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--red-dim)', border: '1px solid rgba(244,63,94,.24)', color: 'var(--red)', fontSize: 22, marginBottom: 8 }}>!</div>
          <div style={{ fontSize: 19, fontWeight: 700 }}>Song not found</div>
          <div style={{ color: 'var(--muted)', fontSize: 14 }}>This track may have been deleted or moved.</div>
          <Link to="/library" className={styles.backLink} style={{ marginTop: 14 }}>← Back to Library</Link>
        </div>
      </div>
    );
  }

  // ── Screen: empty (song exists but has no versions) ───────────────────────
  if (song.versions.length === 0) {
    return (
      <div className={styles.page}>
        <div className={`card ${styles.fadeUp}`} style={{ padding: '56px 32px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 60, height: 60, borderRadius: 16, display: 'grid', placeItems: 'center', background: 'var(--cyan-dim)', border: '1px solid rgba(0,229,176,.22)', marginBottom: 10, fontSize: 24 }}>◇</div>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-.01em' }}>No versions yet</div>
          <div style={{ color: 'var(--muted)', fontSize: 14, maxWidth: 340, lineHeight: 1.5 }}>
            Upload your first bounce to start analysis. Scores, A/B audition and progress show up here.
          </div>
          <button type="button" className="btn primary" style={{ marginTop: 16 }} onClick={() => setUploadOpen(true)}>
            + Add version
          </button>
        </div>
        <UnifiedUploadDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          songId={song.id}
          {...(song.genreHint ? { defaultGenre: song.genreHint } : {})}
        />
      </div>
    );
  }

  // ── Screen: populated ─────────────────────────────────────────────────────
  return (
    <div className={styles.page}>
      <SongHeader
        song={song}
        visual={coverVisual}
        hue={coverHue}
        onEdit={() => setEditOpen(true)}
        onPublish={() => {
          if (!song.latestResult) {
            toast.info("Analyze a version first — there's nothing to share yet.");
            return;
          }
          setPublishOpen(true);
        }}
        onAddVersion={() => setUploadOpen(true)}
        onArchive={() => setArchiveOpen(true)}
      />

      <QuickPlayer
        song={song}
        player={player}
        onOpenListen={onOpenListen}
      />

      <ScoreTrendCard
        versions={song.versions}
        onPointClick={(id) => player.loadIntoA(id)}
      />

      <VersionList
        versions={song.versions}
        slotA={player.slotA}
        slotB={player.slotB}
        highlight={player.highlight}
        onPlay={onPlay}
        onReport={onReport}
        onRetry={onRetry}
        onMakeCurrent={onMakeCurrent}
        onReanalyze={onReanalyze}
        onReanalyzeRef={(id) => setRefReanalyzeVersionId(id)}
        onOpenListen={onOpenListen}
        onViewGamePlan={onViewGamePlan}
        onDelete={onDelete}
        onEditLabel={onEditLabel}
        gamePlanIds={gamePlanIds}
      />

      {/* ── Dialogs ────────────────────────────────────────────────────── */}
      <UnifiedUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        songId={song.id}
        {...(song.genreHint ? { defaultGenre: song.genreHint } : {})}
      />

      <SongEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        song={song}
      />

      {song.latestResult && (
        <SharePublishDialog
          open={publishOpen}
          onOpenChange={setPublishOpen}
          analysisId={song.latestResult.id}
          songName={song.name}
        />
      )}

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Archive song"
        description={`Archive "${song.name}"? It will be hidden from your library but not deleted.`}
        confirmLabel="Archive"
        onConfirm={async () => {
          try {
            await archive.mutateAsync(song.id);
            toast.success(`"${song.name}" archived`);
            void navigate({ to: '/library' });
          } catch {
            toast.error('Could not archive song');
          }
        }}
        isPending={archive.isPending}
      />

      <ConfirmDialog
        open={deleteVersionId !== null}
        onOpenChange={(v) => { if (!v) setDeleteVersionId(null); }}
        title="Delete version"
        description="Delete this version? This cannot be undone and will remove the uploaded file."
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          if (!deleteVersionId) return;
          try {
            await deleteVersion.mutateAsync(deleteVersionId);
            void qc.invalidateQueries({ queryKey: ['songs', songId] });
            toast.success('Version deleted');
            setDeleteVersionId(null);
          } catch {
            toast.error('Could not delete version');
          }
        }}
        isPending={deleteVersion.isPending}
      />

      {refReanalyzeVersionId && (
        <ReanalyzeWithReferenceDialog
          key={refReanalyzeVersionId}
          versionId={refReanalyzeVersionId}
          songId={song.id}
          open={refReanalyzeVersionId !== null}
          onOpenChange={(v) => { if (!v) setRefReanalyzeVersionId(null); }}
        />
      )}

      {gamePlanVersionId && (
        <GamePlanViewModal
          key={gamePlanVersionId}
          versionId={gamePlanVersionId}
          open={gamePlanVersionId !== null}
          onOpenChange={(v) => { if (!v) setGamePlanVersionId(null); }}
          onApplyInListen={() => {
            void navigate({
              to: '/listen-rack/$versionId',
              params: { versionId: gamePlanVersionId },
            });
          }}
        />
      )}
    </div>
  );
}
