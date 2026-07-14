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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { fetcher } from '../../api/fetcher';
import type { FinalJson, JobResultsDto, Phase1Data } from '../../api/types';
import { isFinalJson } from '../../api/types';
import { BlurLock } from '../../components/BlurLock';
import { PublicChrome } from '../../components/PublicChrome';
import { usePageMeta } from '../../lib/usePageMeta';
import { GradeHero } from '../results/GradeHero';
import { ProgressStorylineView } from '../results/ProgressStoryline';
import { PHASE_EXPLAINERS } from '../results/progress-phases';
import { StreamingCard } from '../results/StreamingCard';
import { useAnonCurrentJob, useAnonJob, useAnonResults, useAnonUpload } from './useAnonAnalysis';
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

/** Rotating educational one-liner: cycles through the explainer for the
 *  current phase and its neighbors every 6s (AC2). Pure given an index. */
export function ExplainerLine({ tick }: { tick: number }) {
  const entries = useMemo(() => Object.entries(PHASE_EXPLAINERS), []);
  const [name, text] = entries[tick % entries.length]!;
  return (
    <p className={`mono ${s.explainer}`} data-testid="rotating-explainer">
      <b>{name}</b> — {text}
    </p>
  );
}

export function AnonReportView({ results, locked, onUnlock }: {
  results: JobResultsDto;
  locked: boolean;
  onUnlock: () => void;
}) {
  const fj: FinalJson = isFinalJson(results.finalJson) ? (results.finalJson as FinalJson) : {};
  const phase1 = fj.phases?.find((p) => p.phase === 1)?.data as Phase1Data | undefined;
  const findings = fj.top_fixes ?? fj.coached_fixes ?? [];
  const topFinding = findings[0];
  const lockedCount = Math.max(0, findings.length - 1);

  return (
    <div className={s.report} data-testid="anon-report">
      <GradeHero grade={fj.grade} score={fj.overall_score} danceability={fj.danceability_score} />

      {topFinding && (
        <section className={`card ${s.topFinding}`}>
          <span className="label">#1 finding</span>
          <p className={s.topFindingText}>{topFinding}</p>
        </section>
      )}

      <StreamingCard phase1={phase1} />

      <BlurLock
        locked={locked}
        reason={`Create a free account to keep this report + see all ${findings.length} findings.`}
        ctaLabel="Create free account"
        onUnlock={onUnlock}
      >
        <section className={`card ${s.lockedList}`}>
          <span className="label">All findings</span>
          <ul>
            {findings.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
          {fj.coach_intro && <p className={s.coachIntro}>{fj.coach_intro}</p>}
        </section>
      </BlurLock>

      {locked && lockedCount > 0 && (
        <p className={`mono ${s.lockHint}`}>
          {lockedCount} more finding{lockedCount === 1 ? '' : 's'} behind the blur — they&rsquo;re already computed.
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

  // AC5 — restore the device's latest job on a cold mount.
  const restore = useAnonCurrentJob(jobId === null && !uploadApi.isUploading);
  useEffect(() => {
    if (jobId === null && restore.data?.jobId) setJobId(restore.data.jobId);
  }, [jobId, restore.data]);

  const job = useAnonJob(jobId);
  const status = job.data?.status;
  const stage: Stage = uploadApi.isUploading
    ? 'uploading'
    : jobId === null
      ? 'idle'
      : status === 'complete'
        ? 'report'
        : 'processing';

  const anonResults = useAnonResults(jobId, stage === 'report' && !claimed);
  // Post-claim the device rows are re-parented — the AUTHED endpoint owns them.
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

  const onFile = useCallback((file: File) => {
    void uploadApi.upload(file).then((r) => setJobId(r.jobId)).catch(() => { /* error state shown */ });
  }, [uploadApi]);

  const results = claimedResults ?? anonResults.data ?? null;

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
            <ExplainerLine tick={tick} />
            {status === 'failed' && (
              <p className={s.dropError}>
                {job.data?.errorMessage ?? 'Analysis failed.'}{' '}
                <button type="button" className="btn sm ghost" onClick={() => setJobId(null)}>
                  Try another file
                </button>
              </p>
            )}
          </section>
        )}

        {stage === 'report' && results && (
          <AnonReportView
            results={results}
            locked={!claimed && !auth.user}
            onUnlock={() => setShowRegister(true)}
          />
        )}
        {stage === 'report' && !results && (
          <p className={`mono ${s.stageHint}`}>Loading your report…</p>
        )}

        {showRegister && !claimed && (
          <InlineRegisterCard
            onClaimed={() => { setClaimed(true); setShowRegister(false); }}
            onDismiss={() => setShowRegister(false)}
          />
        )}

        {claimed && (
          <p className={`mono ${s.claimBanner}`} data-testid="claim-banner">
            This report is yours — saved to your account.{' '}
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
