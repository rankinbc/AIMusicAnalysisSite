import { Link, Outlet, createFileRoute, useChildMatches } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';

import { useSetCurrentVersion, useSong } from '../../api/hooks';
import { CompareDialog } from '../../components/CompareDialog';
import { SharePublishDialog } from '../../components/SharePublishDialog';
import { UnifiedUploadDialog } from '../../components/UnifiedUploadDialog';
import { CoverArt } from '../../ui/CoverArt';
import { hueFromId } from '../../ui/hueFromId';
import { GradePill } from '../../ui/GradePill';
import { Pill } from '../../ui/Pill';
import { ProgressTimeline, type TimelineVersion } from '../../ui/ProgressTimeline';
import s from './songDetail.module.css';

export const Route = createFileRoute('/_app/songs/$songId')({
  component: SongDetailPage,
});

function SongDetailPage() {
  const { songId } = Route.useParams();
  const { data: song, isLoading, error } = useSong(songId);
  const [uploadOpen, setUploadOpen] = useState(false);
  const childMatches = useChildMatches();

  const [compareOpen, setCompareOpen] = useState(false);
  const [comparePreset, setComparePreset] = useState<{ a: string | null; b: string | null }>({
    a: null,
    b: null,
  });
  const [publishOpen, setPublishOpen] = useState(false);
  const openCompare = (a: string | null, b: string | null) => {
    setComparePreset({ a, b });
    setCompareOpen(true);
  };

  // When a nested route is active (e.g. /songs/:id/results/:jobId), render
  // only the child via <Outlet />. The song-detail UI is not a layout shell
  // for the report page — they're separate full-page views.
  if (childMatches.length > 0) {
    return <Outlet />;
  }

  if (isLoading) {
    return (
      <div className={s.page}>
        <p className={`mono ${s.status}`}>Loading…</p>
      </div>
    );
  }
  if (error || !song) {
    return (
      <div className={s.page}>
        <Link to="/library" className={s.backLink}>
          ← Library
        </Link>
        <p className={s.error}>Song not found.</p>
      </div>
    );
  }

  // Score history sketch: only the latest result is exposed by the current
  // BFF shape. Future revisions can plumb per-version scores. For now, the
  // most recent version gets the score; older versions are unscored.
  const lastVersionNumber = song.versions.length;
  const versions: TimelineVersion[] = song.versions.map((v) => ({
    versionNumber: v.versionNumber,
    label: v.label,
    score:
      v.versionNumber === lastVersionNumber ? song.latestResult?.score ?? null : null,
    grade:
      v.versionNumber === lastVersionNumber ? song.latestResult?.grade ?? null : null,
    createdAt: v.createdAt,
    isCurrent: v.isCurrent,
  }));

  const hue = hueFromId(song.id);
  const latestScore = song.latestResult?.score;
  const versionCount = song.versions.length;
  const latestVersion = song.versions.find((v) => v.isCurrent) ?? song.versions[0];

  return (
    <div className={s.page}>
      <Link to="/library" className={s.backLink}>
        ← Library
      </Link>

      <section className={`card ${s.hero}`}>
        <CoverArt hue={hue} size="fluid" ratio={1} />
        <div className={s.heroMeta}>
          <div className={s.heroTopRow}>
            <div>
              <div className={s.heroOverline}>
                Song · {versionCount} {versionCount === 1 ? 'version' : 'versions'}
              </div>
              <h1 className={s.title}>{song.name}</h1>
              <div className={s.pills}>
                {song.genreHint && <Pill tone="cyan">{song.genreHint}</Pill>}
                {latestScore != null && (
                  <Pill>
                    <span className="mono">{Math.round(latestScore)}</span>/100
                  </Pill>
                )}
                {song.latestResult?.grade && (
                  <Pill tone="green">grade {song.latestResult.grade}</Pill>
                )}
                <Pill>
                  <span className="mono">v{versionCount}</span> current
                </Pill>
              </div>
            </div>
            <div className={s.actions}>
              <button
                type="button"
                className="btn violet sm"
                onClick={() => {
                  if (!song.latestResult) {
                    toast.info('Analyze a version first — there’s nothing to share yet.');
                    return;
                  }
                  setPublishOpen(true);
                }}
                disabled={!song.latestResult}
              >
                ★ Publish
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => setUploadOpen(true)}
              >
                + Add version
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className={`card ${s.timelineCard}`}>
        <header className={s.timelineHd}>
          <span className={s.timelineTitle}>Progress timeline</span>
          <Pill>
            <span className="mono">{versionCount}</span> versions
          </Pill>
        </header>
        <ProgressTimeline versions={versions} />
      </section>

      <div className={s.layout}>
        <section className={`card ${s.versionListCard}`}>
          <span className={s.versionListTitle}>All versions</span>
          {song.versions.length === 0 ? (
            <div className={s.emptyVersions}>
              No versions yet. Upload one to start analysis.
            </div>
          ) : (
            [...song.versions]
              .sort((a, b) => b.versionNumber - a.versionNumber)
              .map((v) => {
                const isLatest = v.versionNumber === lastVersionNumber;
                const score = isLatest ? song.latestResult?.score ?? null : null;
                const grade = isLatest ? song.latestResult?.grade ?? null : null;
                return (
                  <div key={v.id} className={s.versionRow}>
                    {grade ? (
                      <GradePill grade={grade} size="sm" />
                    ) : (
                      <span
                        className="mono"
                        style={{
                          width: 30,
                          textAlign: 'center',
                          color: 'var(--muted)',
                          fontSize: 12,
                        }}
                      >
                        v{v.versionNumber}
                      </span>
                    )}
                    <div className={s.versionRowMain}>
                      <span className={v.label ? s.versionLabel : s.versionLabelEmpty}>
                        {v.label ?? `Version ${v.versionNumber}`}
                      </span>
                      <span className={s.versionMeta}>
                        v{v.versionNumber} ·{' '}
                        {new Date(v.createdAt).toLocaleDateString()}{' '}
                        {v.isCurrent && <span className={s.currentPill}>current</span>}
                      </span>
                    </div>
                    <div className={s.versionScore}>
                      {score != null ? (
                        <span style={{ color: 'var(--cyan)' }}>{Math.round(score)}/100</span>
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>—</span>
                      )}
                    </div>
                    <div className={s.versionAction}>
                      <Link
                        to="/listen/$versionId"
                        params={{ versionId: v.id }}
                        className={s.resultsLink}
                        style={{
                          background: 'rgba(167, 139, 250, 0.1)',
                          borderColor: 'rgba(167, 139, 250, 0.32)',
                          color: 'var(--violet)',
                        }}
                      >
                        ▶ Listen
                      </Link>
                      {!v.isCurrent && <MakeCurrentButton versionId={v.id} />}
                      {isLatest && song.latestResult && (
                        <Link
                          to="/songs/$songId/results/$jobId"
                          params={{ songId: song.id, jobId: song.latestResult.jobId }}
                          className={s.resultsLink}
                        >
                          Report ↗
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })
          )}
        </section>

        <aside className={`card ${s.deltaCard}`}>
          <span className={s.deltaCardTitle}>Compare two versions</span>
          <div className={s.deltaCardHeadline}>Spot what changed</div>
          <p className={s.deltaCardSub}>
            Pick any two versions to see the delta on mix score, loudness, dynamics, bass
            energy, air, and stereo width.
          </p>
          <div className={s.deltaSuggestions}>
            <button
              type="button"
              className={s.deltaSuggest}
              onClick={() => {
                const sorted = [...song.versions].sort((a, b) => a.versionNumber - b.versionNumber);
                openCompare(sorted[0]?.id ?? null, sorted[sorted.length - 1]?.id ?? null);
              }}
              disabled={versionCount < 2}
            >
              <span>v1 → current</span>
              <span style={{ color: 'var(--muted)' }}>↗</span>
            </button>
            {versionCount > 1 && (
              <button
                type="button"
                className={s.deltaSuggest}
                onClick={() => {
                  const sorted = [...song.versions].sort((a, b) => a.versionNumber - b.versionNumber);
                  openCompare(
                    sorted[sorted.length - 2]?.id ?? null,
                    sorted[sorted.length - 1]?.id ?? null,
                  );
                }}
              >
                <span>Last two</span>
                <span style={{ color: 'var(--muted)' }}>↗</span>
              </button>
            )}
            <button
              type="button"
              className={s.deltaSuggest}
              onClick={() => openCompare(null, null)}
              disabled={versionCount < 2}
            >
              <span>Pick two…</span>
              <span style={{ color: 'var(--muted)' }}>↗</span>
            </button>
          </div>
        </aside>
      </div>

      <UnifiedUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        songId={song.id}
        {...(song.genreHint ? { defaultGenre: song.genreHint } : {})}
      />
      <CompareDialog
        open={compareOpen}
        onOpenChange={setCompareOpen}
        song={song}
        defaultVersionA={comparePreset.a}
        defaultVersionB={comparePreset.b}
      />
      {song.latestResult && (
        <SharePublishDialog
          open={publishOpen}
          onOpenChange={setPublishOpen}
          analysisId={song.latestResult.id}
          songName={song.name}
        />
      )}
      {latestVersion && null /* suppress unused-var: kept for future audio wiring */}
    </div>
  );
}

function MakeCurrentButton({ versionId }: { versionId: string }) {
  const setCurrent = useSetCurrentVersion(versionId);
  return (
    <button
      type="button"
      className={s.resultsLink}
      disabled={setCurrent.isPending}
      onClick={(e) => {
        e.stopPropagation();
        setCurrent.mutate(undefined, {
          onSuccess: () => toast.success('Marked as current version'),
          onError: (err) =>
            toast.error(err instanceof Error ? err.message : 'Could not set current'),
        });
      }}
    >
      {setCurrent.isPending ? '…' : 'Make current'}
    </button>
  );
}
