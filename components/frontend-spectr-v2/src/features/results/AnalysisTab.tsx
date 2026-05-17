import { useMemo, useRef } from 'react';
import { toast } from 'sonner';

import { useRunSpecialist, useVerdicts } from '../../api/hooks';
import type { Phase8Data, PhaseResult, RoutingPlanEntry } from '../../api/types';
import { CoachPanel } from './CoachPanel';
import { SPECIALIST_CATALOG, specialistLabel } from './helpers/specialists';
import s from './AnalysisTab.module.css';

interface AnalysisTabProps {
  phases: PhaseResult[] | undefined;
  songName: string;
  jobId: string;
  coachName: string | undefined;
  coachIntro: string | undefined;
  coachedFixes: string[] | undefined;
  phase8: Phase8Data | undefined;
  onReanalyze?: () => void;
  reanalyzing?: boolean;
}

type PipelineStatus = 'ok' | 'partial' | 'running' | 'missing' | 'failed' | 'skipped';

interface PipelineRow {
  id: string;
  label: string;
  status: PipelineStatus;
  detail?: string;
  unlocks?: number;
  cta?: string;
  ctaTone?: 'cyan' | 'violet';
  progress?: number;
}

const STATUS_GLYPH: Record<PipelineStatus, string> = {
  ok: '✓',
  partial: '·',
  running: '·',
  missing: '',
  skipped: '·',
  failed: '!',
};

export function AnalysisTab({
  phases,
  songName,
  jobId,
  coachName,
  coachIntro,
  coachedFixes,
  phase8,
  onReanalyze,
  reanalyzing,
}: AnalysisTabProps) {
  // Pull verdicts so we can populate the "AI specialists" row. The hook also
  // owns its own polling; we only need a snapshot here.
  const emptySet = useRef<ReadonlySet<string>>(new Set<string>());
  const { data: verdictsData } = useVerdicts(jobId, {
    enabled: Boolean(jobId),
    optimisticRunning: emptySet.current,
  });

  const pipeline = useMemo<PipelineRow[]>(
    () => derivePipeline(phases ?? [], verdictsData?.specialists ?? []),
    [phases, verdictsData],
  );

  const done = pipeline.filter((r) => r.status === 'ok').length;
  const running = pipeline.filter((r) => r.status === 'running' || r.status === 'partial').length;
  const missing = pipeline.filter((r) => r.status === 'missing' || r.status === 'failed').length;
  const totalUnlocks = pipeline
    .filter((r) => r.status === 'missing')
    .reduce((acc, r) => acc + (r.unlocks ?? 0), 0);
  const missingUploadable = pipeline.filter(
    (r) => r.status === 'missing' && r.cta,
  ).length;

  const pct = pipeline.length ? done / pipeline.length : 0;
  const ringSize = 84;
  const stroke = 6;
  const r = (ringSize - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c - pct * c;

  return (
    <div className={s.layout}>
      <div className={s.left}>
        <section className={`card ${s.summary}`}>
          <div className={s.dial}>
            <svg width={ringSize} height={ringSize} style={{ transform: 'rotate(-90deg)' }}>
              <circle
                cx={ringSize / 2}
                cy={ringSize / 2}
                r={r}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth={stroke}
                fill="none"
              />
              <circle
                cx={ringSize / 2}
                cy={ringSize / 2}
                r={r}
                stroke="var(--cyan)"
                strokeWidth={stroke}
                fill="none"
                strokeDasharray={c}
                strokeDashoffset={off}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(.4,0,.2,1)' }}
              />
            </svg>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <div
                className="mono"
                style={{ fontSize: 20, fontWeight: 700, color: 'var(--cyan)', lineHeight: 1 }}
              >
                {done}/{pipeline.length || '—'}
              </div>
            </div>
          </div>
          <div className={s.summaryText}>
            <div className={s.summaryTitle}>
              {done === pipeline.length && pipeline.length > 0
                ? `All ${pipeline.length} phases complete`
                : `${done} of ${pipeline.length} phases complete`}
            </div>
            <div className={s.summarySub}>
              {missingUploadable > 0 ? (
                <>
                  Upload{' '}
                  <span style={{ color: 'var(--violet)', fontWeight: 700 }}>
                    {missingUploadable} more file{missingUploadable === 1 ? '' : 's'}
                  </span>
                  {totalUnlocks > 0 && (
                    <>
                      {' '}to unlock{' '}
                      <span style={{ color: 'var(--cyan)', fontWeight: 700 }}>
                        +{totalUnlocks} specialist{totalUnlocks === 1 ? '' : 's'}
                      </span>
                    </>
                  )}{' '}
                  and deepen the report.
                </>
              ) : (
                'Everything analyzed.'
              )}
            </div>
          </div>
          <div className={s.statBoxes}>
            <div className={s.statBox}>
              <div className={s.statLabel}>Done</div>
              <div className={s.statValue} style={{ color: 'var(--cyan)' }}>
                {done}
              </div>
            </div>
            <div className={s.statBox}>
              <div className={s.statLabel}>Running</div>
              <div className={s.statValue} style={{ color: 'var(--orange)' }}>
                {running}
              </div>
            </div>
            <div className={s.statBox}>
              <div className={s.statLabel}>Missing</div>
              <div className={s.statValue} style={{ color: 'var(--muted)' }}>
                {missing}
              </div>
            </div>
          </div>
        </section>

        {(coachName || coachIntro || (coachedFixes && coachedFixes.length > 0)) && (
          <section className={`card ${s.coachCard}`}>
            <div className={s.coachOverline}>Recommended fixes — from initial analysis</div>
            <CoachPanel name={coachName} intro={coachIntro} fixes={coachedFixes} />
          </section>
        )}

        <AlsHealthCard phase8={phase8} />

        <section className={`card ${s.phasesCard}`}>
          <h3 className={s.phasesTitle}>Phase-by-phase status</h3>
          {pipeline.length === 0 ? (
            <p className={s.phaseDetail}>No phase data.</p>
          ) : (
            <ul className={s.phaseList}>
              {pipeline.map((row) => (
                <PipelineRowItem key={row.id} row={row} />
              ))}
            </ul>
          )}
        </section>

        <SuggestedSpecialists
          jobId={jobId}
          plan={verdictsData?.routing_plan}
          cachedSlugs={
            new Set(
              (verdictsData?.specialists ?? [])
                .filter((sp) => sp.status === 'cached' || sp.status === 'failed')
                .map((sp) => sp.slug),
            )
          }
        />

        <section className={`card ${s.unlocks}`}>
          <h3 className={s.phasesTitle}>Unlock more specialists</h3>
          <div className={s.unlockGrid}>
            <UnlockZone
              tone="cyan"
              label="Stems"
              title="Drop stems"
              description="Kick, bass, drums, lead. Unlocks stem-balance, stereo-width, reference Δ."
              hint="FLAC · WAV · up to 250 MB each"
            />
            <UnlockZone
              tone="violet"
              label="Reference"
              title="Drop reference track"
              description="A pro track in your genre. Unlocks comparative analysis."
              hint="WAV · FLAC · MP3 · up to 200 MB"
            />
            <UnlockZone
              tone="orange"
              label="Ableton"
              title="Drop .als"
              description="Track names, devices, automation. Power-user only."
              hint="Ableton Live 11+ · gzip OK"
            />
          </div>
        </section>
      </div>

      <aside className={s.right}>
        <section className={`card ${s.sideCard}`}>
          <span className={s.sideHd}>Current uploads</span>
          <ul className={s.uploadList}>
            <li className={s.uploadItem} data-present="true">
              <span>{songName}</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--cyan)' }}>
                ✓ Master
              </span>
            </li>
            <li className={s.uploadItem} data-present="false">
              <span>No stems yet</span>
              <span className="mono" style={{ fontSize: 10 }}>
                +
              </span>
            </li>
            <li className={s.uploadItem} data-present="false">
              <span>No reference yet</span>
              <span className="mono" style={{ fontSize: 10 }}>
                +
              </span>
            </li>
            <li className={s.uploadItem} data-present="false">
              <span>No .als yet</span>
              <span className="mono" style={{ fontSize: 10 }}>
                +
              </span>
            </li>
          </ul>
        </section>

        <section className={`card ${s.sideCard}`}>
          <span className={s.sideHd}>Re-analyze on changes</span>
          <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
            Re-run the pipeline against the current uploads. Existing verdicts are
            preserved; only stale specialists re-fire.
          </p>
          <button
            type="button"
            className="btn primary sm"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => onReanalyze?.()}
            disabled={!onReanalyze || reanalyzing}
          >
            ↺ {reanalyzing ? 'Re-analyzing…' : 'Re-analyze'}
          </button>
        </section>

        <section className={`card ${s.sideCard}`}>
          <span className={s.sideHd}>Analysis history</span>
          <ul className={s.uploadList}>
            <li className={s.uploadItem} data-present="true">
              <span>Initial analysis</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
                now
              </span>
            </li>
          </ul>
        </section>
      </aside>
    </div>
  );
}

interface SuggestedSpecialistsProps {
  jobId: string;
  plan: import('../../api/types').RoutingPlanDto | undefined;
  cachedSlugs: ReadonlySet<string>;
}

function SuggestedSpecialists({ jobId, plan, cachedSlugs }: SuggestedSpecialistsProps) {
  const run = useRunSpecialist(jobId);
  // Plan absent: Triage is either still enqueued (BFF lazy-fires on first
  // ListVerdicts) or it failed silently. Show a thin "loading/idle" tile
  // so the section doesn't pop in unexpectedly.
  if (!plan) {
    return (
      <section className={`card ${s.suggestedCard}`}>
        <h3 className={s.phasesTitle}>Suggested specialists</h3>
        <p className={s.suggestedHint}>
          Generating suggestions from your mix — refresh in a moment.
        </p>
      </section>
    );
  }

  const ordered = [...plan.specialists_to_run].sort(
    (a, b) => a.priority - b.priority,
  );
  const pending = ordered.filter((e) => !cachedSlugs.has(e.name));

  const onRunAll = async () => {
    for (const e of pending) {
      try {
        await run.mutateAsync(e.name);
      } catch {
        // Best-effort batch run; skip failures silently. Per-slug feedback
        // is handled by the VerdictsPanel polling layer.
      }
    }
  };

  return (
    <section className={`card ${s.suggestedCard}`}>
      <div className={s.suggestedHeader}>
        <h3 className={s.phasesTitle}>Suggested specialists</h3>
        {pending.length > 0 && (
          <button
            type="button"
            className={s.phaseCta}
            data-tone="cyan"
            onClick={onRunAll}
            disabled={run.isPending}
          >
            Run {pending.length} suggested
          </button>
        )}
      </div>
      {plan.rationale && (
        <p className={s.suggestedRationale}>{plan.rationale}</p>
      )}
      <ul className={s.suggestedList}>
        {ordered.map((entry) => (
          <SuggestedSpecialistRow
            key={entry.name}
            entry={entry}
            cached={cachedSlugs.has(entry.name)}
            disabled={run.isPending}
            onRun={() => run.mutate(entry.name)}
          />
        ))}
      </ul>
      {plan.skip.length > 0 && (
        <p className={s.suggestedSkip}>
          Skipped:{' '}
          {plan.skip
            .map((slug) => specialistLabel(slug))
            .join(' · ')}
        </p>
      )}
    </section>
  );
}

function SuggestedSpecialistRow({
  entry,
  cached,
  disabled,
  onRun,
}: {
  entry: RoutingPlanEntry;
  cached: boolean;
  disabled: boolean;
  onRun: () => void;
}) {
  return (
    <li className={s.suggestedRow}>
      <span className={s.suggestedPriority}>#{entry.priority}</span>
      <div className={s.suggestedMain}>
        <span className={s.suggestedLabel}>{specialistLabel(entry.name)}</span>
        {entry.focus && (
          <span className={s.suggestedFocus}>{entry.focus}</span>
        )}
      </div>
      {cached ? (
        <span className={s.suggestedDone}>✓ run</span>
      ) : (
        <button
          type="button"
          className={s.phaseCta}
          data-tone="violet"
          onClick={onRun}
          disabled={disabled}
        >
          Run
        </button>
      )}
    </li>
  );
}

interface AlsHealthCardProps {
  phase8: Phase8Data | undefined;
}

/** Ableton project (.als) health card. Renders only when phase 8 produced
 *  meaningful data — for jobs without a .als upload the card is omitted
 *  entirely (the missing-row "+ ALS" CTA already covers that case in the
 *  pipeline list). */
function AlsHealthCard({ phase8 }: AlsHealthCardProps) {
  if (
    !phase8 ||
    (phase8.health_score == null &&
      phase8.total_devices == null &&
      !phase8.tracks?.length)
  ) {
    return null;
  }

  const health = phase8.health_score;
  const grade = phase8.grade;
  const healthTone =
    health == null
      ? 'var(--muted)'
      : health >= 80
        ? 'var(--cyan)'
        : health >= 60
          ? 'var(--yellow)'
          : 'var(--orange)';

  const enabled =
    phase8.total_devices != null && phase8.disabled_devices != null
      ? phase8.total_devices - phase8.disabled_devices
      : null;
  const trackCount = phase8.tracks?.length ?? 0;
  const mutedTracks = phase8.tracks?.filter((t) => t.muted).length ?? 0;
  const midi = phase8.midi;

  return (
    <section className={`card ${s.alsCard}`}>
      <header className={s.alsHd}>
        <div>
          <div className={s.coachOverline}>Ableton project · phase 8</div>
          <div className={s.alsTitle}>
            {phase8.ableton_version ? `Live ${phase8.ableton_version}` : '.als project'}
            {phase8.tempo != null && (
              <span className={s.alsTitleSub}>
                {' · '}
                <span className="mono">{Math.round(phase8.tempo)}</span> BPM
                {phase8.time_signature && (
                  <>
                    {' · '}
                    <span className="mono">{phase8.time_signature}</span>
                  </>
                )}
              </span>
            )}
          </div>
        </div>
        {health != null && (
          <div className={s.alsHealthBlock}>
            <span className={s.alsHealthValue} style={{ color: healthTone }}>
              {Math.round(health)}
            </span>
            <span className={s.alsHealthUnit}>
              /100{grade && <> · {grade}</>}
            </span>
          </div>
        )}
      </header>

      <div className={s.alsStats}>
        {phase8.total_devices != null && (
          <Stat
            label="Devices"
            value={String(phase8.total_devices)}
            sub={
              enabled != null && phase8.disabled_devices && phase8.disabled_devices > 0
                ? `${enabled} active · ${phase8.disabled_devices} off`
                : 'all active'
            }
          />
        )}
        {trackCount > 0 && (
          <Stat
            label="Tracks"
            value={String(trackCount)}
            sub={mutedTracks > 0 ? `${mutedTracks} muted` : 'none muted'}
          />
        )}
        {phase8.clutter_pct != null && (
          <Stat
            label="Clutter"
            value={`${Math.round(phase8.clutter_pct)}%`}
            sub={phase8.clutter_pct > 30 ? 'heavy' : 'clean'}
            tone={phase8.clutter_pct > 30 ? 'var(--orange)' : 'var(--cyan)'}
          />
        )}
        {midi && (
          <Stat
            label="MIDI clips"
            value={String(midi.total_clips)}
            sub={
              midi.empty_clips + midi.short_clips + midi.duplicate_clips > 0
                ? `${midi.empty_clips}∅ · ${midi.short_clips}◇ · ${midi.duplicate_clips}≡`
                : 'clean'
            }
          />
        )}
      </div>

      {phase8.plugin_list && phase8.plugin_list.length > 0 && (
        <div className={s.alsPlugins}>
          <div className={s.coachOverline}>Plugins · {phase8.plugin_list.length}</div>
          <div className={s.alsPluginChips}>
            {phase8.plugin_list.slice(0, 12).map((p) => (
              <span key={p} className={s.alsPluginChip}>
                {p}
              </span>
            ))}
            {phase8.plugin_list.length > 12 && (
              <span className={s.alsPluginChip} style={{ opacity: 0.6 }}>
                +{phase8.plugin_list.length - 12} more
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className={s.alsStat}>
      <div className={s.alsStatLabel}>{label}</div>
      <div className={s.alsStatValue} style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      {sub && <div className={s.alsStatSub}>{sub}</div>}
    </div>
  );
}

function PipelineRowItem({ row }: { row: PipelineRow }) {
  const isMissing = row.status === 'missing';
  const isRunning = row.status === 'running';
  const isPartial = row.status === 'partial';
  const isFailed = row.status === 'failed';

  return (
    <li className={s.phaseRow}>
      <span className={s.phaseIcon} data-status={row.status}>
        {STATUS_GLYPH[row.status]}
      </span>
      <div className={s.phaseMain}>
        <div className={s.phaseHeader}>
          <span
            className={s.phaseLabel}
            style={{ color: isMissing ? 'var(--muted)' : 'var(--text)' }}
          >
            {row.label}
          </span>
          {isRunning && <span className={s.runningPill}>RUNNING</span>}
          {isPartial && <span className={s.runningPill}>PARTIAL</span>}
          {row.unlocks != null && row.unlocks > 0 && (
            <span className={s.unlockPill}>
              +{row.unlocks} specialist{row.unlocks === 1 ? '' : 's'} pending
            </span>
          )}
        </div>
        {row.detail && (
          <span
            className={s.phaseDetail}
            style={{ color: isFailed ? 'var(--red)' : undefined }}
          >
            {row.detail}
          </span>
        )}
        {(isPartial || isRunning) && row.progress != null && (
          <div className={s.progressTrack}>
            <div
              className={s.progressFill}
              style={{ width: `${Math.round(row.progress * 100)}%` }}
            />
          </div>
        )}
      </div>
      {row.cta && (
        <button
          type="button"
          className={s.phaseCta}
          data-tone={row.ctaTone ?? 'violet'}
          onClick={() =>
            toast.info(`${row.cta} — upload flow not wired yet`)
          }
        >
          {row.cta}
        </button>
      )}
    </li>
  );
}

interface UnlockZoneProps {
  tone: 'cyan' | 'violet' | 'orange';
  label: string;
  title: string;
  description: string;
  hint: string;
}

function UnlockZone({ tone, label, title, description, hint }: UnlockZoneProps) {
  const color =
    tone === 'cyan'
      ? 'var(--cyan)'
      : tone === 'violet'
        ? 'var(--violet)'
        : 'var(--orange)';
  return (
    <div
      className={s.unlockZone}
      style={
        {
          ['--zone-color' as string]: color,
          ['--zone-border' as string]: `${color}40`,
          ['--zone-bg' as string]: `${color}06`,
        } as React.CSSProperties
      }
    >
      <span className={s.unlockZoneLabel}>{label}</span>
      <span className={s.unlockZoneTitle}>{title}</span>
      <span className={s.unlockZoneDescription}>{description}</span>
      <span className={s.unlockHint}>{hint}</span>
    </div>
  );
}

// ── Derivation ────────────────────────────────────────────────────────────
// Build a curated pipeline view by combining worker PhaseResult[] with
// "virtual" rows that depend on upload state and specialist progress.
// Anything we can't source from the BFF (durations, file format, etc.) is
// simply omitted rather than faked.

const PHASE_LABEL_OVERRIDES: Record<number, string> = {
  1: 'Mix analysis',
  2: 'Genre detection',
  3: 'Genre scoring',
  4: 'Stem clash',
  5: 'Reference comparison',
  6: 'Gap analysis',
  7: 'Arrangement advice',
  // Phase 8 deliberately omitted — handled by the virtual ALS row below to
  // avoid a duplicate stage.
};

function derivePipeline(
  phases: PhaseResult[],
  specialists: ReadonlyArray<{ slug: string; status: string }>,
): PipelineRow[] {
  const sorted = phases.slice().sort((a, b) => a.phase - b.phase);
  const phase8 = sorted.find((p) => p.phase === 8);
  const rows: PipelineRow[] = sorted
    .filter((p) => p.phase !== 8)
    .map((p) => {
      const detail = deriveDetail(p);
      const row: PipelineRow = {
        id: `phase-${p.phase}`,
        label: PHASE_LABEL_OVERRIDES[p.phase] ?? p.name,
        status: phaseStatus(p.status),
      };
      if (detail) row.detail = detail;
      return row;
    });

  // AI specialists row — count from verdict-pipeline state.
  const total = SPECIALIST_CATALOG.length;
  const run = specialists.filter(
    (sp) => sp.status === 'cached' || sp.status === 'failed',
  ).length;
  const specialistsRow: PipelineRow = {
    id: 'specialists',
    label: 'AI specialists',
    status: run === 0 ? 'missing' : run >= total ? 'ok' : 'partial',
    detail: `${run} / ${total} run`,
    progress: total > 0 ? run / total : 0,
    ctaTone: 'cyan',
  };
  if (run < total) specialistsRow.cta = 'Run all';
  rows.push(specialistsRow);

  // Stem analysis row — slice 1 has no stem-upload state in the report DTO,
  // so this is always "missing" for now. The +N count comes from the catalog.
  const stemUnlocks = SPECIALIST_CATALOG.filter((s) => s.needsStems).length;
  rows.push({
    id: 'stems',
    label: 'Stem analysis',
    status: 'missing',
    detail: 'No stems uploaded',
    cta: '+ Stems',
    ctaTone: 'violet',
    unlocks: stemUnlocks,
  });

  // Reference comparison — currently no DTO field that tells us whether a
  // reference was attached, so we render this as missing without an unlock
  // count (we don't track which specialists are reference-gated).
  rows.push({
    id: 'reference',
    label: 'Reference upload',
    status: 'missing',
    detail: 'No reference uploaded',
    cta: '+ Reference',
    ctaTone: 'violet',
  });

  // Ableton project — folds in worker phase 8. "skipped" / absent means the
  // user never uploaded a .als (rendered as a drop target); "ok" means we
  // parsed one and can surface health-score detail.
  const alsRow: PipelineRow = (() => {
    if (phase8?.status === 'ok') {
      const detail = deriveDetail(phase8);
      const r: PipelineRow = { id: 'als', label: 'Ableton project', status: 'ok' };
      if (detail) r.detail = detail;
      return r;
    }
    if (phase8?.status === 'failed') {
      return {
        id: 'als',
        label: 'Ableton project',
        status: 'failed',
        detail: phase8.error ?? 'ALS parse failed',
        cta: 'Retry',
        ctaTone: 'violet',
      };
    }
    return {
      id: 'als',
      label: 'Ableton project',
      status: 'missing',
      detail: 'No .als uploaded',
      cta: '+ ALS',
      ctaTone: 'violet',
    };
  })();
  rows.push(alsRow);

  return rows;
}

function phaseStatus(raw: string): PipelineStatus {
  if (raw === 'ok') return 'ok';
  if (raw === 'failed') return 'failed';
  return 'skipped';
}

function deriveDetail(p: PhaseResult): string | undefined {
  if (p.status === 'failed') return p.error ?? 'Phase failed';
  if (p.status !== 'ok' || !p.data) return undefined;
  const d = p.data as Record<string, unknown>;
  switch (p.phase) {
    case 1: {
      const parts: string[] = [];
      if (typeof d.duration_seconds === 'number') {
        parts.push(formatDuration(d.duration_seconds));
      }
      if (typeof d.lufs === 'number') parts.push(`${d.lufs.toFixed(1)} LUFS`);
      if (typeof d.bpm === 'number') parts.push(`${Math.round(d.bpm)} BPM`);
      if (typeof d.detected_key === 'string') parts.push(d.detected_key);
      return parts.length ? parts.join(' · ') : undefined;
    }
    case 2: {
      if (typeof d.genre === 'string') {
        const conf =
          typeof d.confidence === 'number'
            ? `${Math.round(d.confidence * 100)}% conf`
            : null;
        return [d.genre, conf].filter(Boolean).join(' · ');
      }
      return undefined;
    }
    case 3: {
      const parts: string[] = [];
      if (typeof d.genre === 'string') parts.push(`${d.genre}`);
      if (typeof d.total_score === 'number')
        parts.push(`score ${Math.round(d.total_score)}`);
      return parts.length ? parts.join(' · ') : undefined;
    }
    case 4: {
      const clashes = Array.isArray(d.clashes) ? d.clashes.length : null;
      const stems =
        d.per_stem && typeof d.per_stem === 'object'
          ? Object.keys(d.per_stem as object).length
          : null;
      const parts: string[] = [];
      if (stems) parts.push(`${stems} stems`);
      if (clashes != null) parts.push(`${clashes} clash${clashes === 1 ? '' : 'es'}`);
      return parts.length ? parts.join(' · ') : undefined;
    }
    case 5: {
      const parts: string[] = [];
      if (typeof d.preset_name === 'string') parts.push(`${d.preset_name} preset`);
      const checks = d.checks as Record<string, { status?: string }> | undefined;
      if (checks) {
        const pass = Object.values(checks).filter((c) => c?.status === 'ok').length;
        const total = Object.keys(checks).length;
        if (total > 0) parts.push(`${pass}/${total} checks`);
      }
      return parts.length ? parts.join(' · ') : undefined;
    }
    case 6: {
      if (typeof d.percentile === 'number') {
        const genre = typeof d.genre === 'string' ? d.genre : null;
        return [
          `${Math.round(d.percentile)}th pct`,
          genre,
        ]
          .filter(Boolean)
          .join(' · ');
      }
      return undefined;
    }
    case 7: {
      const parts: string[] = [];
      if (typeof d.section_count === 'number') parts.push(`${d.section_count} sections`);
      if (typeof d.overall_score === 'number')
        parts.push(`score ${Math.round(d.overall_score)}`);
      if (typeof d.grade === 'string') parts.push(`grade ${d.grade}`);
      return parts.length ? parts.join(' · ') : undefined;
    }
    case 8: {
      const parts: string[] = [];
      if (typeof d.health_score === 'number')
        parts.push(`health ${Math.round(d.health_score)}`);
      if (typeof d.grade === 'string') parts.push(`grade ${d.grade}`);
      if (typeof d.total_devices === 'number') parts.push(`${d.total_devices} devices`);
      return parts.length ? parts.join(' · ') : undefined;
    }
    default:
      return undefined;
  }
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const ss = total % 60;
  return `${m}:${String(ss).padStart(2, '0')}`;
}
