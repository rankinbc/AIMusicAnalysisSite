/* Story 6.3 (FR7/UX-DR27) — the anonymous instant-analysis funnel at /analyze.
 *
 * State machine: idle → uploading → processing → report, with an AC5 restore
 * leg (GET /api/anon/jobs/current on mount resumes progress or re-renders the
 * report after a refresh — the device cookie is the whole session).
 *
 * The report is claim-bait by design: grade hero + #1 finding + streaming
 * readiness fully visible; everything deeper BlurLocked behind the inline
 * register card. Registration re-parents the device rows server-side (4.5) —
 * the page then unlocks in place via the authed results endpoint.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { fetcher } from '../../api/fetcher';
import { capture } from '../../lib/analytics';
import { readAttribution } from '../../lib/attribution';
import type { JobResultsDto } from '../../api/types';
import { BlurLock } from '../../components/BlurLock';
import { PublicChrome } from '../../components/PublicChrome';
import { usePageMeta } from '../../lib/usePageMeta';
import { GradeHero } from '../results/GradeHero';
import { ProgressStorylineView } from '../results/ProgressStoryline';
import { BASE_PHASES, PHASE_EXPLAINERS } from '../results/progress-phases';
import { StreamingCard } from '../results/StreamingCard';
import { useAnonCurrentJob, useAnonJob, useAnonResults, useAnonUpload } from './useAnonAnalysis';
import { type AnonReportVM, vmFromAnon, vmFromFull } from './anon-report-vm';
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

/** Rotating educational one-liner, KEYED to the current phase (AC2): shows the
 *  explainer for whatever phase the worker reports, advancing with the job.
 *  Falls back to a gentle rotation before the first phase name arrives. */
export function ExplainerLine({ currentPhase, tick }: { currentPhase: string; tick: number }) {
  const known = (BASE_PHASES as readonly string[]).indexOf(currentPhase);
  const name = known >= 0 ? BASE_PHASES[known] : BASE_PHASES[tick % BASE_PHASES.length]!;
  return (
    <p className={`mono ${s.explainer}`} data-testid="rotating-explainer">
      <b>{name}</b> — {PHASE_EXPLAINERS[name]}
    </p>
  );
}

export function AnonReportView({ vm, locked, onUnlock }: {
  vm: AnonReportVM;
  locked: boolean;
  onUnlock: () => void;
}) {
  const lockedCount = Math.max(0, vm.totalFindings - 1);
  return (
    <div className={s.report} data-testid="anon-report">
      <GradeHero grade={vm.grade} score={vm.score} danceability={vm.danceability} />

      {vm.topFinding && (
        <section className={`card ${s.topFinding}`}>
          <span className="label">#1 finding</span>
          <p className={s.topFindingText}>{vm.topFinding}</p>
        </section>
      )}

      <StreamingCard phase1={vm.phase1} />

      {locked ? (
        // The withheld findings are NOT in this payload (server-gated) — the
        // blur teases a count over a placeholder, never the real text.
        vm.totalFindings > 0 && (
          <BlurLock
            locked
            reason={`Create a free account to keep this report + see all ${vm.totalFindings} findings.`}
            ctaLabel="Create free account"
            onUnlock={onUnlock}
          >
            <section className={`card ${s.lockedList}`} aria-hidden>
              <span className="label">All findings</span>
              <ul>
                {Array.from({ length: lockedCount }, (_, i) => (
                  <li key={i}>••••••••••••••••••••••••</li>
                ))}
              </ul>
            </section>
          </BlurLock>
        )
      ) : (
        // Claimed — the full authed report is in hand; show everything.
        vm.allFindings && vm.allFindings.length > 0 && (
          <section className={`card ${s.lockedList}`}>
            <span className="label">All findings</span>
            <ul>
              {vm.allFindings.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
            {vm.coachIntro && <p className={s.coachIntro}>{vm.coachIntro}</p>}
          </section>
        )
      )}

      {locked && lockedCount > 0 && (
        <p className={`mono ${s.lockHint}`}>
          {lockedCount} more finding{lockedCount === 1 ? '' : 's'} behind the blur — already computed, yours to keep.
        </p>
      )}
    </div>
  );
}

// ── the page ────────────────────────────────────────────────────────────────

type Stage = 'idle' | 'uploading' | 'processing' | 'report';

export function AnalyzePage() {
  usePageMeta(
    'Analyze your track free — SPECTR',
    'Drop a track, get a graded 7-phase mix analysis in minutes. No account, no forms — WAV, FLAC or MP3 up to 250 MB.',
  );

  const auth = useAuth();
  const uploadApi = useAnonUpload();
  const [jobId, setJobId] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [startedAtMs] = useState(() => Date.now());
  const [tick, setTick] = useState(0);
  // Once the user resets (after a failure, or to analyze another), STOP the
  // restore query from dragging the same job back — the query is staleTime:
  // Infinity, so without this the failed/old job id reappears forever (review).
  const [restoreDismissed, setRestoreDismissed] = useState(false);

  // AC5 — restore the device's latest job on a cold mount.
  const restore = useAnonCurrentJob(jobId === null && !uploadApi.isUploading && !restoreDismissed);
  useEffect(() => {
    if (jobId === null && !restoreDismissed && restore.data?.jobId) setJobId(restore.data.jobId);
  }, [jobId, restoreDismissed, restore.data]);

  const job = useAnonJob(jobId);
  const status = job.data?.status;
  const stage: Stage = uploadApi.isUploading
    ? 'uploading'
    : jobId === null
      ? 'idle'
      : status === 'complete'
        ? 'report'
        : 'processing';

  const resetToDropZone = useCallback(() => {
    setJobId(null);
    setRestoreDismissed(true); // do not let the cached failed/old job restore
  }, []);

  const anonResults = useAnonResults(jobId, stage === 'report' && !claimed);
  // Post-claim the device rows are re-parented — the AUTHED endpoint owns them
  // and serves the FULL report (the anon endpoint only ever sent the teaser).
  const [claimedResults, setClaimedResults] = useState<JobResultsDto | null>(null);
  useEffect(() => {
    if (!claimed || !jobId || claimedResults) return;
    void fetcher<JobResultsDto>({ url: `/jobs/${jobId}/results`, method: 'GET' })
      .then(setClaimedResults)
      .catch(() => { /* keep the anon render — claim already succeeded */ });
  }, [claimed, jobId, claimedResults]);

  // Rotating explainer clock (AC2).
  useEffect(() => {
    if (stage !== 'processing') return undefined;
    const h = setInterval(() => setTick((t) => t + 1), 6000);
    return () => clearInterval(h);
  }, [stage]);

  // Story 6.5 — funnel telemetry (PII-free; no-op without a PostHog key).
  // analyze_completed fires ONCE, and ONLY for a job THIS session started —
  // a returning visitor whose completed report is RESTORED must not re-fire
  // it (no paired analyze_started → orphaned/negative TTFI; review).
  const startedThisSessionRef = useRef(false);
  const completedFiredRef = useRef(false);
  useEffect(() => {
    if (stage === 'report' && jobId && startedThisSessionRef.current && !completedFiredRef.current) {
      completedFiredRef.current = true;
      capture('analyze_completed', { job_id: jobId });
    }
  }, [stage, jobId]);

  const onFile = useCallback((file: File) => {
    setRestoreDismissed(false);
    void uploadApi.upload(file)
      .then((r) => {
        startedThisSessionRef.current = true;
        setJobId(r.jobId);
        capture('analyze_started', { job_id: r.jobId });
      })
      .catch(() => { /* error state shown */ });
  }, [uploadApi]);

  const vm: AnonReportVM | null = claimedResults
    ? vmFromFull(claimedResults)
    : anonResults.data
      ? vmFromAnon(anonResults.data)
      : null;

  return (
    <div className={s.page}>
      <PublicChrome />
      <main className={s.main}>
        {stage === 'idle' && (
          <DropZoneView onFile={onFile} error={uploadApi.error} />
        )}

        {stage === 'uploading' && (
          <section className={s.center}>
            <h2 className={s.stageTitle}>Uploading…</h2>
            <progress className={s.uploadBar} max={1} value={uploadApi.progress} />
            <p className={`mono ${s.stageHint}`}>{Math.round(uploadApi.progress * 100)}%</p>
          </section>
        )}

        {stage === 'processing' && (
          <section className={s.center} data-testid="anon-progress">
            <h2 className={s.stageTitle}>Analyzing your track</h2>
            <ProgressStorylineView
              status={status ?? 'pending'}
              currentPhase={job.data?.currentPhase ?? ''}
              phasePct={job.data?.phasePct ?? 0}
              elapsedMs={Date.now() - startedAtMs}
              workerOffline={false}
            />
            <ExplainerLine currentPhase={job.data?.currentPhase ?? ''} tick={tick} />
            {status === 'failed' && (
              <p className={s.dropError}>
                {job.data?.errorMessage ?? 'Analysis failed.'}{' '}
                <button type="button" className="btn sm ghost" onClick={resetToDropZone}>
                  Try another file
                </button>
              </p>
            )}
          </section>
        )}

        {stage === 'report' && vm && (
          <AnonReportView
            vm={vm}
            locked={!claimed && !auth.user}
            onUnlock={() => setShowRegister(true)}
          />
        )}
        {stage === 'report' && !vm && (
          <p className={`mono ${s.stageHint}`}>Loading your report…</p>
        )}

        {showRegister && !claimed && (
          <InlineRegisterCard
            onClaimed={() => {
              setClaimed(true);
              setShowRegister(false);
              // AC2/AC4 — the device→user moment + inbound attribution (drains
              // the 7.4 stash). identifyUser already stitched via AuthContext.
              capture('report_claimed', { job_id: jobId, ...readAttribution() });
            }}
            onDismiss={() => setShowRegister(false)}
          />
        )}

        {claimed && (
          <p className={`mono ${s.claimBanner}`} data-testid="claim-banner">
            Your full report is unlocked here and saved to your account.{' '}
            Email verification gates your <b>next</b> analysis, not this one.{' '}
            <a href="/library">Go to your library →</a>
          </p>
        )}
      </main>
    </div>
  );
}

// ── inline register (AC4) — email+password card over the visible report ─────

export function InlineRegisterCard({ onClaimed, onDismiss }: {
  onClaimed: () => void;
  onDismiss: () => void;
}) {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      // The httpOnly device cookie rides this POST — the server claims the
      // device and re-parents the report atomically (4.5). No claim API call.
      await auth.register(email, password);
      onClaimed();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={s.registerOverlay} data-testid="inline-register">
      <form className={`card ${s.registerCard}`} onSubmit={submit}>
        <h3 className={s.registerTitle}>Keep this report</h3>
        <p className={s.registerSub}>Free account · the report re-attaches to it instantly.</p>
        <label className={s.registerLabel}>
          Email
          <input type="email" required autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value)} className={s.registerInput} />
        </label>
        <label className={s.registerLabel}>
          Password
          <input type="password" required minLength={8} autoComplete="new-password" value={password}
            onChange={(e) => setPassword(e.target.value)} className={s.registerInput} />
        </label>
        {error && <p className={s.dropError}>{error}</p>}
        <div className={s.registerActions}>
          <button type="submit" className="btn primary" disabled={pending}>
            {pending ? 'Creating…' : 'Create free account'}
          </button>
          <button type="button" className="btn ghost" onClick={onDismiss} disabled={pending}>
            Not now
          </button>
        </div>
        <p className={`mono ${s.registerTrust}`}>
          <a href="/trust/no-training">No AI training on your audio</a>
          {' · '}
          <a href="/trust/results-forever">reports stay yours</a>
        </p>
      </form>
    </div>
  );
}
