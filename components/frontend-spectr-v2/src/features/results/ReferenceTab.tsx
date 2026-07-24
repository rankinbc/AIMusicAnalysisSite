import type { Phase1Data, Phase5Data, Phase6Data } from '../../api/types';
import { fmtGenre } from './helpers/format';
import {
  buildGenreSection,
  buildReferenceSection,
  type GenreGapMetric,
  type RefDeltaRow,
  type RefStemDelta,
} from './reference-model';
import s from './ReferenceTab.module.css';

interface ReferenceTabProps {
  genre: string | undefined;
  phase6: Phase6Data | undefined;
  phase5: Phase5Data | undefined;
  phase1: Phase1Data | undefined;
  /** Deep-link out to the Findings/Coach surface for an out-of-range metric. */
  onGoToFindings?: () => void;
}

// Two complementary comparisons shown together, laid out by per-metric data
// availability (NOT a mode toggle): "Compared to your genre" (phase 6 — the 3
// placed metrics only) and "Compared to your reference" (phase 5 — plain deltas
// + per-stem). Both render when both exist; each shows only what its data backs.
export function ReferenceTab({ genre: phase2Genre, phase6, phase5, phase1, onGoToFindings }: ReferenceTabProps) {
  const genreSection = buildGenreSection(phase6, phase5);
  const refSection = buildReferenceSection(phase5, phase1);
  const genreLabel = (phase6?.genre ?? phase2Genre) ? fmtGenre(phase6?.genre ?? phase2Genre!) : '—';

  return (
    <div className={s.tab}>
      <div className={s.identity}>
        <span className={s.dot} />
        <div>
          <div className={s.idName}>
            {genreLabel} profile
            <span className={s.idKind}>Comparison targets</span>
          </div>
          <div className={s.idSub}>
            {phase6?.profile_source ? (
              <>
                genre distribution · <b>{phase6.profile_source}</b>
              </>
            ) : (
              <>how you sit against the {genreLabel} genre, and against your uploaded reference</>
            )}
          </div>
        </div>
      </div>

      {/* ── Compared to your genre (phase 6) ── */}
      <section className={s.section}>
        <div className={s.seclabel}>
          <span className={s.t}>Compared to your genre</span>
          <span className={s.hint}>phase 6 · how you stack up against pros in this style</span>
        </div>
        {genreSection.confident ? (
          <>
            <GenreVerdict
              percentile={genreSection.percentile!}
              inRange={genreSection.inRange}
              total={genreSection.total}
            />
            <div className={s.gaps}>
              {genreSection.metrics.map((m) => (
                <GapRow key={m.key} m={m} onGoToFindings={onGoToFindings} />
              ))}
            </div>
            <div className={s.legend}>
              <span className={s.lg}>
                <span className={`${s.ld} ${s.ldYou}`} />you
              </span>
              <span className={s.lg}>
                <span className={`${s.ld} ${s.ldMean}`} />genre mean
              </span>
              <span className={s.lg}>
                <span className={`${s.ld} ${s.ldRange}`} />acceptable range
              </span>
              <span className={s.lg}>
                <span className={s.dia}>◇</span>your reference
              </span>
            </div>
          </>
        ) : (
          <div className={s.cant}>
            <span aria-hidden="true">ⓘ</span>
            <div>
              <b>Not enough to place you against the genre yet.</b>
              <span>
                {' '}
                Genre confidence is too low to position this mix on the {genreLabel} distribution —
                a cleaner master or a longer section improves detection.
              </span>
            </div>
          </div>
        )}
      </section>

      {/* ── Compared to your reference (phase 5) — only when attached ── */}
      {refSection.attached && (
        <section className={s.section}>
          <div className={s.seclabel}>
            <span className={s.t}>Compared to your reference</span>
            <span className={s.hint}>phase 5 · how close you are to the track you&rsquo;re chasing</span>
          </div>
          {refSection.deltas.length > 0 ? (
            <div className={s.deltaRows}>
              {refSection.deltas.map((d) => (
                <DeltaRow key={d.key} d={d} onGoToFindings={onGoToFindings} />
              ))}
            </div>
          ) : (
            <div className={s.na}>No comparable metrics between your mix and the reference.</div>
          )}
          {refSection.checks.length > 0 && (
            <div className={s.checks}>
              {refSection.checks.map((c) => (
                <div className={s.dtile} key={c.key}>
                  <div className={s.dl}>{c.key.replace(/_/g, ' ')}</div>
                  <div className={`${s.dv} ${c.tone === 'fail' ? s.warn : ''}`}>{c.message}</div>
                </div>
              ))}
            </div>
          )}
          {refSection.perStem.length > 0 && (
            <>
              <div className={s.subhd}>
                Per stem<span className={s.hint}>stems + reference required</span>
              </div>
              <div className={s.deltaRows}>
                {refSection.perStem.map((st, i) => (
                  <StemDeltaRow key={i} st={st} />
                ))}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function GenreVerdict({ percentile, inRange, total }: { percentile: number; inRange: number; total: number }) {
  const size = 72;
  const stroke = 7;
  const rad = (size - stroke) / 2;
  const circ = 2 * Math.PI * rad;
  const off = circ * (1 - percentile / 100);
  return (
    <div className={s.verdict}>
      <div className={s.ring} role="img" aria-label={`${percentile}th percentile versus the genre profile`}>
        <svg width={size} height={size} aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={rad} fill="none" stroke="var(--dim, rgba(255,255,255,0.08))" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={rad}
            fill="none"
            stroke="var(--cyan, var(--accent))"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={off}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <span className={s.ringNum}>{percentile}</span>
      </div>
      <div>
        <div className={s.vh}>
          <span className={s.n}>{percentile}</span>th percentile
        </div>
        <div className={s.vtake}>
          top {100 - percentile}% · {inRange} of {total} placed metrics in range
        </div>
      </div>
    </div>
  );
}

function pos(v: number, min: number, max: number) {
  return Math.max(0, Math.min(100, ((v - min) / Math.max(0.0001, max - min)) * 100));
}
function fmt(v: number, unit: string) {
  if (unit === 'BPM') return `${Math.round(v)}`;
  if (unit === '') return v.toFixed(2);
  return v.toFixed(1);
}
function fmtSigned(v: number) {
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
}

function GapRow({ m, onGoToFindings }: { m: GenreGapMetric; onGoToFindings?: () => void }) {
  const u = m.unit ? ` ${m.unit}` : '';
  return (
    <div className={`${s.gap} ${m.inRange ? '' : s.out}`} title={m.description}>
      <div className={s.gapTop}>
        <span className={s.gapLabel}>{m.label}</span>
        <span className={`mono ${s.gapPct}`}>{m.pct}th</span>
      </div>
      <div className={s.bar} aria-hidden>
        <span className={s.range} style={{ left: `${pos(m.rangeLo, m.domMin, m.domMax)}%`, width: `${pos(m.rangeHi, m.domMin, m.domMax) - pos(m.rangeLo, m.domMin, m.domMax)}%` }} />
        <span className={s.meanTick} style={{ left: `${pos(m.mean, m.domMin, m.domMax)}%` }} />
        {m.ref != null && (
          <span className={s.refmark} style={{ left: `${pos(m.ref, m.domMin, m.domMax)}%` }} title={`reference ${fmt(m.ref, m.unit)}`}>
            ◇
          </span>
        )}
        <span className={`${s.youdot} ${m.inRange ? '' : s.out}`} style={{ left: `${pos(m.user, m.domMin, m.domMax)}%` }} />
      </div>
      <div className={s.reads}>
        <span className={`${s.you} ${m.inRange ? '' : s.out}`}>
          you <b>{fmt(m.user, m.unit)}{u}</b>
        </span>
        <span className={s.mean}>genre {fmt(m.mean, m.unit)}</span>
        {m.ref != null && <span className={s.refval}>◇ {fmt(m.ref, m.unit)}</span>}
        {!m.inRange && onGoToFindings && (
          <button type="button" className={s.find} onClick={onGoToFindings}>
            fix →
          </button>
        )}
      </div>
    </div>
  );
}

function DeltaBar({ mag, warn }: { mag: number; warn: boolean }) {
  const m = Math.max(-1, Math.min(1, mag || 0));
  const half = Math.abs(m) * 50;
  return (
    <span className={s.db} title={`${m > 0 ? 'above' : 'below'} reference`}>
      <span className={s.dbMid} />
      <span className={`${s.dbFill} ${warn ? s.warn : ''}`} style={{ left: m >= 0 ? '50%' : `${50 - half}%`, width: `${half}%` }} />
      <span className={`${s.dbYou} ${warn ? s.warn : ''}`} style={{ left: `${50 + m * 50}%` }} />
    </span>
  );
}

function DeltaRow({ d, onGoToFindings }: { d: RefDeltaRow; onGoToFindings?: () => void }) {
  const u = d.unit ? ` ${d.unit}` : '';
  return (
    <div className={s.rd}>
      <span className={s.rdLabel}>{d.label}</span>
      <span className={s.rdYou}>{d.user != null ? <>you <b>{fmt(d.user, d.unit)}{u}</b></> : '—'}</span>
      <DeltaBar mag={d.mag} warn={d.warn} />
      <span className={s.rdRef}>{d.ref != null ? <>◇ {fmt(d.ref, d.unit)}</> : '—'}</span>
      <span className={`${s.rdDelta} ${d.warn ? s.warn : ''}`}>{fmtSigned(d.delta)}</span>
      {d.warn && onGoToFindings && (
        <button type="button" className={s.find} onClick={onGoToFindings}>
          fix →
        </button>
      )}
    </div>
  );
}

function StemDeltaRow({ st }: { st: RefStemDelta }) {
  return (
    <div className={`${s.rd} ${s.stem}`}>
      <span className={s.rdLabel}>
        <b className="mono">{st.role}</b> · {st.metric.replace(/_/g, ' ')}
      </span>
      <span className={s.rdYou}>{st.user != null ? <>you <b>{st.user.toFixed(1)}</b></> : '—'}</span>
      <span className={s.rdRef}>{st.ref != null ? <>◇ {st.ref.toFixed(1)}</> : '—'}</span>
      <span className={`${s.rdDelta} ${st.warn ? s.warn : ''}`}>{st.delta != null ? fmtSigned(st.delta) : '—'}</span>
      <span className={s.rdInterp}>{st.interpretation}</span>
    </div>
  );
}
