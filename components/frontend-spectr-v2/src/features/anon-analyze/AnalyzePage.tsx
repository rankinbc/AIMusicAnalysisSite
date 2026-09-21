/* Task G5 (spec G-D1/G-D4, controller addendum 2026-09-21) — the public
 * instant-analysis funnel at /analyze. Owner's ruling on the old teaser page
 * ("I dont want this shit bait page. I want to show off the product. Do the
 * full analysis ... I'd like them to have all the features."): an upload
 * here becomes the visitor's OWN song inside the real app — full 7-phase
 * analysis, full report, every feature — as a capped, 24-hour guest account.
 * No grade teaser, no blur, no "create an account to see your findings".
 *
 * The old AnonReportView/InlineRegisterCard teaser + its /api/anon/* polling
 * vertical (useAnonAnalysis.ts, anon-report-vm.ts, resume-dismissed.ts) are
 * gone. The BFF /api/anon/* endpoints stay (unused by this page now) for a
 * later cleanup — see the task brief's scope notes.
 *
 * Sequencing (startGuestUpload.ts): a first-time visitor gets a guest
 * session minted via startDemo() before the mix upload; an EXISTING guest or
 * a signed-in real user skips straight to the upload (a real user is routed
 * to their library before the drop zone ever renders — see below). The mix
 * goes through the SAME useMixUpload() hook UnifiedUploadDialog uses for a
 * plain mix-only upload (no stems/.als/reference on this page) — one
 * upload, one dispatch — then straight onto the real signed-in results
 * route, which owns its own honest progress list (G0) and the full report.
 * "Explore a finished report while yours is analyzing" (scope note, spec
 * G-D1) belongs on THAT route, not here — left for G6.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useRouter } from '@tanstack/react-router';

import { handleGuestRestricted } from '../../api/mutation-error-toast';
import { useAuth } from '../../auth/AuthContext';
import { useMixUpload } from '../../hooks/useMixUpload';
import { capture } from '../../lib/analytics';
import { PublicChrome } from '../../components/PublicChrome';
import { PublicFooter } from '../../components/PublicFooter';
import { usePageMeta } from '../../lib/usePageMeta';
import { GuestStartFailedError, startGuestUpload } from './startGuestUpload';
import s from './analyze.module.css';

// ── pure pieces (static-render testable) ────────────────────────────────────

export function DropZoneView({ onFile, error, disabled }: {
  onFile: (f: File) => void;
  error: string | null;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  return (
    <section
      data-testid="anon-drop-zone"
      className={`${s.dropZone} ${dragOver ? s.dropZoneActive : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f && !disabled) onFile(f);
      }}
    >
      <h1 className={s.dropTitle}>Drop your track. Get the truth.</h1>
      <p className={s.dropSub}>
        A real 7-phase mix analysis — graded, measured, no account needed.
      </p>
      <button
        type="button"
        className="btn primary"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        Choose a file
      </button>
      <p className={`mono ${s.dropHints}`}>WAV · FLAC · MP3 · ≤250 MB · no forms, ever</p>
      {error && <p className={s.dropError}>{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept=".wav,.flac,.mp3,.aiff,.aif,.m4a,.ogg"
        style={{ display: 'none' }}
        data-testid="anon-file-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
    </section>
  );
}

// ── the page ────────────────────────────────────────────────────────────────

type Stage = 'idle' | 'busy' | 'failed';

export function AnalyzePage() {
  usePageMeta(
    'Analyze your track free — SPECTR',
    'Drop a track, get a graded 7-phase mix analysis in minutes. No account, no forms — WAV, FLAC or MP3 up to 250 MB.',
  );

  const auth = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const mixUpload = useMixUpload();
  const [stage, setStage] = useState<Stage>('idle');
  const [dropError, setDropError] = useState<string | null>(null);

  // Scope note (addendum) — an already-signed-in REAL user never mints a
  // guest here; send them to their library's upload entry point instead.
  const isRealUser = !auth.isLoading && Boolean(auth.user) && !auth.user?.isGuest;
  useEffect(() => {
    if (isRealUser) void navigate({ to: '/library', replace: true });
  }, [isRealUser, navigate]);

  const onFile = useCallback((file: File) => {
    setDropError(null);
    setStage('busy');
    startGuestUpload(
      { user: auth.user, startDemo: auth.startDemo, upload: (f) => mixUpload.upload(f) },
      file,
    )
      .then(async (res) => {
        // The _app route guard reads router context — invalidate so it sees
        // a freshly-minted guest's auth state BEFORE navigating (DemoLauncher
        // precedent), or the first landing bounces to /login.
        await router.invalidate();
        if (!res.jobId) {
          // UploadResponse.jobId is only null when analyze=false — this page
          // never sends that, but never guess at a job that doesn't exist.
          await navigate({ to: '/songs/$songId', params: { songId: res.songId } });
          return;
        }
        capture('guest_upload_started', { job_id: res.jobId });
        await navigate({
          to: '/songs/$songId/results/$jobId',
          params: { songId: res.songId, jobId: res.jobId },
        });
      })
      .catch((err: unknown) => {
        if (err instanceof GuestStartFailedError) {
          setStage('failed');
          return;
        }
        setStage('idle');
        // Guest upload/analysis caps refused the request — the shared
        // upgrade dialog owns this, not page-local copy (D10).
        if (handleGuestRestricted(err)) return;
        setDropError(err instanceof Error ? err.message : 'Upload failed. Try again.');
      });
  }, [auth.user, auth.startDemo, mixUpload, navigate, router]);

  const showDropZone = stage === 'idle' && !auth.isLoading && !isRealUser;

  return (
    <div className={s.page}>
      <PublicChrome />
      <main className={s.main}>
        {showDropZone && <DropZoneView onFile={onFile} error={dropError} />}

        {stage === 'busy' && (
          <section className={s.center}>
            <h2 className={s.stageTitle}>
              {mixUpload.isUploading ? 'Uploading…' : 'Setting up your guest session…'}
            </h2>
            <progress className={s.uploadBar} max={1} value={mixUpload.progress} />
            {mixUpload.isUploading && (
              <p className={`mono ${s.stageHint}`}>{Math.round(mixUpload.progress * 100)}%</p>
            )}
          </section>
        )}

        {stage === 'failed' && (
          <section className={`card ${s.center}`} role="alert">
            <span className="label">Guest session</span>
            <h2 className={s.stageTitle}>Uploads aren&rsquo;t available right now.</h2>
            <div className={s.failedActions}>
              <a href="/register" className="btn primary">Create a free account</a>
              <a href="/demo" className="btn ghost">Explore the demo</a>
              <a href="/" className="btn ghost">Back home</a>
            </div>
          </section>
        )}
      </main>
      <PublicFooter currentPath="/analyze" />
    </div>
  );
}
