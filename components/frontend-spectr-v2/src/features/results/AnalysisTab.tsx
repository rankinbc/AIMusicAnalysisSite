import { toast } from 'sonner';

import type { PhaseResult } from '../../api/types';
import s from './AnalysisTab.module.css';

interface AnalysisTabProps {
  phases: PhaseResult[] | undefined;
  songName: string;
}

const STATUS_GLYPH: Record<string, string> = {
  ok: '✓',
  skipped: '·',
  failed: '!',
};
const STATUS_LABEL: Record<string, string> = {
  ok: 'OK',
  skipped: 'SKIPPED',
  failed: 'FAILED',
};

export function AnalysisTab({ phases, songName }: AnalysisTabProps) {
  const sorted = (phases ?? []).slice().sort((a, b) => a.phase - b.phase);
  const done = sorted.filter((p) => p.status === 'ok').length;
  const total = sorted.length;
  const failed = sorted.filter((p) => p.status === 'failed').length;
  const skipped = sorted.filter((p) => p.status === 'skipped').length;

  const pct = total ? done / total : 0;
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
                {done}/{total || '—'}
              </div>
            </div>
          </div>
          <div className={s.summaryText}>
            <div className={s.summaryTitle}>
              {done === total && total > 0
                ? `All ${total} phases complete`
                : `${done} of ${total} phases complete`}
            </div>
            <div className={s.summarySub}>
              Upload stems or a reference track to unlock more specialists
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
              <div className={s.statLabel}>Skipped</div>
              <div className={s.statValue} style={{ color: 'var(--orange)' }}>
                {skipped}
              </div>
            </div>
            <div className={s.statBox}>
              <div className={s.statLabel}>Failed</div>
              <div className={s.statValue} style={{ color: 'var(--red)' }}>
                {failed}
              </div>
            </div>
          </div>
        </section>

        <section className={`card ${s.phasesCard}`}>
          <h3 className={s.phasesTitle}>Pipeline phases</h3>
          {sorted.length === 0 ? (
            <p className={s.phaseDetail}>No phase data.</p>
          ) : (
            <ul className={s.phaseList}>
              {sorted.map((p) => (
                <li key={`${p.phase}-${p.name}`} className={s.phaseRow}>
                  <span className={s.phaseIcon} data-status={p.status}>
                    {STATUS_GLYPH[p.status] ?? '·'}
                  </span>
                  <div className={s.phaseMain}>
                    <span className={s.phaseLabel}>
                      Phase {p.phase} · {p.name}
                    </span>
                    {p.status === 'failed' && p.error && (
                      <span className={s.phaseDetail}>{p.error}</span>
                    )}
                  </div>
                  <span
                    className={s.phaseStatus}
                    style={{
                      color:
                        p.status === 'ok'
                          ? 'var(--cyan)'
                          : p.status === 'failed'
                            ? 'var(--red)'
                            : 'var(--muted)',
                    }}
                  >
                    {STATUS_LABEL[p.status] ?? p.status.toUpperCase()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

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
            onClick={() => toast.info('Re-analyze not wired yet')}
          >
            ↺ Re-analyze
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
