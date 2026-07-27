import type { Phase1Data, Phase5Data, Phase6Data } from '../../api/types';
import { fmtGenre } from './helpers/format';
import {
  buildGenreSection,
  buildReferenceSection,
  type GenreGapMetric,
  type GenreSection,
  type RefCheck,
  type RefDeltaRow,
  type RefStemDelta,
} from './reference-model';

interface ReferenceTabProps {
  genre: string | undefined;
  phase6: Phase6Data | undefined;
  phase5: Phase5Data | undefined;
  phase1: Phase1Data | undefined;
  /** Deep-link out to the Findings/Coach surface for an out-of-range metric. */
  onGoToFindings?: () => void;
}

// ── Icons (stroke 1.7, rounded) — the two the reference tab needs ──────
function Icon({ name, size = 15 }: { name: 'info' | 'arrow'; size?: number }) {
  const p = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (name === 'info') {
    return (
      <svg {...p}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5" />
        <path d="M12 8h.01" />
      </svg>
    );
  }
  return (
    <svg {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function refFmt(v: number, unit: string): string {
  if (unit === 'BPM') return `${Math.round(v)}`;
  if (unit === '') return v.toFixed(2);
  return v.toFixed(1);
}
function fmtSigned(v: number): string {
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
}
/** Deterministic genre-tied hue for the identity dot (decorative only). */
function genreHue(label: string): number {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) % 360;
  return h;
}

// Two complementary comparisons shown together, laid out by per-metric data
// availability (NOT a mode toggle): "Compared to your genre" (phase 6 — the 3
// placed metrics only) and "Compared to your reference" (phase 5 — plain deltas
// + per-stem). Both render when both exist; each shows only what its data backs.
export function ReferenceTab({ genre: phase2Genre, phase6, phase5, phase1, onGoToFindings }: ReferenceTabProps) {
  const genreSection = buildGenreSection(phase6, phase5);
  const refSection = buildReferenceSection(phase5, phase1);
  const genreName = (phase6?.genre ?? phase2Genre) ? fmtGenre(phase6?.genre ?? phase2Genre!) : '—';
  const hasStems = refSection.perStem.length > 0;

  const hue = genreHue(genreName);
  const dotCol = `hsl(${hue} 65% 58%)`;

  return (
    <div className="tabbody fade-up">
      {/* ── Target identity bar ── */}
      <div className="ref-identity">
        <span className="ref-dot" style={{ background: dotCol, boxShadow: `0 0 12px -2px ${dotCol}` }} />
        <div className="ref-id-b">
          <div className="ref-id-name">
            {genreName}
            <span className="ref-id-kind">Genre preset</span>
          </div>
          <div className="ref-id-sub">
            {phase6?.profile_source ? (
              <>
                genre distribution · <b>{phase6.profile_source}</b>
              </>
            ) : (
              <>how you sit against the {genreName} genre</>
            )}
            {refSection.attached && (
              <>
                {' · '}chasing <b>your uploaded reference</b>
              </>
            )}
          </div>
        </div>
        <span className="ref-id-vs">comparison targets</span>
      </div>

      {/* ── Compared to your genre (phase 6) ── */}
      <RefGenreSection section={genreSection} genreName={genreName} onGoToFindings={onGoToFindings} />

      {/* ── Compared to your reference (phase 5) — only when attached ── */}
      {refSection.attached && (
        <section className="ref-section" data-kind="ref">
          <div className="seclabel">
            <span className="t">Compared to your reference</span>
            <span className="hint">phase5 · how close you are to the track you&rsquo;re chasing</span>
            <span className="rule" />
          </div>
          <RefDeltaRows deltas={refSection.deltas} onGoToFindings={onGoToFindings} />
          <div className="ref-legend">
            <span className="lg">
              <span className="d you" />
              you
            </span>
            <span className="lg">
              <span className="dia">◇</span>reference (center)
            </span>
            <span className="lg">bar length = how far off</span>
          </div>
          <RefChecks checks={refSection.checks} />
          {hasStems && <RefStemDeltas perStem={refSection.perStem} />}
        </section>
      )}
    </div>
  );
}

// ── Genre section shell — honest can't-place vs. real placement ────────
function RefGenreSection({
  section,
  genreName,
  onGoToFindings,
}: {
  section: GenreSection;
  genreName: string;
  onGoToFindings?: (() => void) | undefined;
}) {
  if (!section.confident) {
    return (
      <section className="ref-section">
        <div className="seclabel">
          <span className="t">Compared to your genre</span>
          <span className="hint">phase6 gap analysis</span>
          <span className="rule" />
        </div>
        <div className="ref-cant">
          <Icon name="info" size={14} />
          <div>
            <b>Not enough to place you against the genre yet.</b>
            <span>
              Genre confidence is too low to position this mix on the {genreName} distribution — improve
              detection with a cleaner master or a longer section.
            </span>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="ref-section" data-kind="genre">
      <div className="seclabel">
        <span className="t">Compared to your genre</span>
        <span className="hint">phase6 gap analysis · how you stack up against pros in this style</span>
        <span className="rule" />
      </div>
      <RefVerdict section={section} />
      <div className="ref-gaps" style={{ marginTop: 12 }}>
        {section.metrics.map((m) => (
          <RefGapRow key={m.key} m={m} onGoToFindings={onGoToFindings} />
        ))}
      </div>
      <div className="ref-legend">
        <span className="lg">
          <span className="d you" />
          you
        </span>
        <span className="lg">
          <span className="d mean" />
          genre mean
        </span>
        <span className="lg">
          <span className="d range" />
          acceptable range
        </span>
        <span className="lg">
          <span className="dia">◇</span>your reference
        </span>
      </div>
    </section>
  );
}

// ── Genre percentile verdict — phase6.percentile ───────────────────────
function RefVerdict({ section }: { section: GenreSection }) {
  const percentile = section.percentile!;
  const size = 54;
  const rad = (size - 9) / 2;
  const c = 2 * Math.PI * rad;
  const off = c * (1 - percentile / 100);
  return (
    <div className="ref-verdict">
      <div className="rv-ring">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size / 2} cy={size / 2} r={rad} fill="none" stroke="var(--dim)" strokeWidth="6" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={rad}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={off}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dashoffset .7s ease' }}
          />
        </svg>
        <div className="rv-num">
          <span className="n">{percentile}</span>
          <span className="u">th</span>
        </div>
      </div>
      <div className="rv-b">
        <div className="rv-h">
          <span className="n">{section.inRange}</span> of {section.total} placed metrics in range
        </div>
        <div className="rv-take">top {100 - percentile}%</div>
      </div>
    </div>
  );
}

// ── Genre gap row — phase6.gaps.<feature>. When m.ref is present the reference
//    value is layered on as a ◇ marker + read (bpm / stereo width / correlation). ──
function RefGapRow({ m, onGoToFindings }: { m: GenreGapMetric; onGoToFindings?: (() => void) | undefined }) {
  const pos = (v: number) =>
    Math.max(0, Math.min(100, ((v - m.domMin) / Math.max(0.0001, m.domMax - m.domMin)) * 100));
  const rLo = pos(m.rangeLo);
  const rHi = pos(m.rangeHi);
  const u = m.unit ? ` ${m.unit}` : '';
  const hasRef = m.ref != null;
  return (
    <div className={`ref-gap${m.inRange ? '' : ' out'}`} title={m.description}>
      <span className="rg-lab-w">
        <span className="rg-label">{m.label}</span>
        <span className="rg-pct">
          <span className="v">{m.pct}</span>th
        </span>
      </span>
      <div className="rg-bar">
        <span className="rg-range" style={{ left: `${rLo}%`, width: `${rHi - rLo}%` }} />
        <span className="rg-meanTick" style={{ left: `${pos(m.mean)}%` }} />
        {hasRef && (
          <span
            className="rg-refmark"
            style={{ left: `${pos(m.ref!)}%` }}
            title={`reference ${refFmt(m.ref!, m.unit)}`}
          >
            ◇
          </span>
        )}
        <span className={`rg-youdot${m.inRange ? '' : ' out'}`} style={{ left: `${pos(m.user)}%` }} />
      </div>
      <span className="rg-reads">
        <span className={`rg-you${m.inRange ? '' : ' out'}`}>
          you{' '}
          <b>
            {refFmt(m.user, m.unit)}
            {u}
          </b>
        </span>
        <span className="rg-mean">genre {refFmt(m.mean, m.unit)}</span>
        {hasRef && <span className="rg-refval">◇ {refFmt(m.ref!, m.unit)}</span>}
        {!m.inRange && onGoToFindings && (
          <button className="rg-find" onClick={onGoToFindings} title="See in Findings">
            fix <Icon name="arrow" size={11} />
          </button>
        )}
      </span>
    </div>
  );
}

// ── Diverging delta bar — same anatomy as the genre range bar: full-width track,
//    ◇ reference at center, 'you' dot offset by the signed normalized magnitude. ──
function DeltaBar({ mag, tone }: { mag: number; tone: 'warn' | 'ok' }) {
  const m = Math.max(-1, Math.min(1, mag || 0));
  const col = tone === 'warn' ? 'var(--orange)' : 'var(--accent)';
  const half = Math.abs(m) * 46;
  return (
    <span className="rg-bar db-bar" title={`${m > 0 ? 'above' : 'below'} reference`}>
      <span className="db-fill" style={{ left: m >= 0 ? '50%' : `${50 - half}%`, width: `${half}%`, background: col }} />
      <span className="db-refmark">◇</span>
      <span
        className="rg-youdot"
        style={{ left: `${50 + m * 46}%`, background: col, boxShadow: `0 0 8px -1px ${col}` }}
      />
    </span>
  );
}

// ── Plain delta rows — phase5.deltas.*, rendered with the SAME row anatomy as the
//    genre gap rows: label left · bar middle · reads right. ──
function RefDeltaRows({ deltas, onGoToFindings }: { deltas: RefDeltaRow[]; onGoToFindings?: (() => void) | undefined }) {
  if (deltas.length === 0) {
    return <div className="ref-cant" style={{ border: 'none', background: 'none', color: 'var(--muted)', padding: '2px' }}>No comparable metrics between your mix and the reference.</div>;
  }
  return (
    <div className="ref-gaps">
      {deltas.map((d) => {
        const u = d.unit ? ` ${d.unit}` : '';
        return (
          <div className={`ref-gap${d.warn ? ' out' : ''}`} key={d.key} title={d.key}>
            <span className="rg-lab-w">
              <span className="rg-label">{d.label}</span>
              <span className={`rg-pct delta${d.warn ? ' warn' : ''}`}>{fmtSigned(d.delta)}</span>
            </span>
            <DeltaBar mag={d.mag} tone={d.warn ? 'warn' : 'ok'} />
            <span className="rg-reads">
              <span className={`rg-you${d.warn ? ' out' : ''}`}>
                you{' '}
                <b>
                  {d.user != null ? refFmt(d.user, d.unit) : '—'}
                  {d.user != null ? u : ''}
                </b>
              </span>
              <span className="rg-refval">◇ {d.ref != null ? refFmt(d.ref, d.unit) : '—'}</span>
              {d.warn && onGoToFindings && (
                <button className="rg-find" onClick={onGoToFindings} title="See in Findings">
                  fix <Icon name="arrow" size={11} />
                </button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Genre-context checks — phase5.genre_context.checks.* ───────────────
function RefChecks({ checks }: { checks: RefCheck[] }) {
  if (checks.length === 0) return null;
  return (
    <div className="ref-checks">
      {checks.map((c) => (
        <div className="dtile" key={c.key} title={`phase5.genre_context.checks.${c.key}`}>
          <div className="dl">{c.key.replace(/_/g, ' ')}</div>
          <div className={`dv ${c.tone || ''}`}>{c.message}</div>
        </div>
      ))}
    </div>
  );
}

// ── Per-stem reference deltas — phase5.per_stem_reference_deltas[] ──────
function RefStemDeltas({ perStem }: { perStem: RefStemDelta[] }) {
  return (
    <>
      <div className="ref-subhd">
        Per stem<span className="hint">phase5.per_stem_reference_deltas · stems + reference required</span>
      </div>
      <div className="ref-gaps">
        {perStem.map((st, i) => {
          const mag = st.delta != null ? Math.max(-1, Math.min(1, st.delta / 6)) : 0;
          return (
            <div className={`ref-gap${st.warn ? ' out' : ''}`} key={i}>
              <span className="rg-lab-w">
                <span className="rg-label">
                  <b className="mono">{st.role}</b> · {st.metric.replace(/_/g, ' ')}
                </span>
                <span className={`rg-pct delta${st.warn ? ' warn' : ''}`}>
                  {st.delta != null ? fmtSigned(st.delta) : '—'}
                </span>
              </span>
              <DeltaBar mag={mag} tone={st.warn ? 'warn' : 'ok'} />
              <span className="rg-reads">
                <span className={`rg-you${st.warn ? ' out' : ''}`}>
                  you <b>{st.user != null ? st.user.toFixed(1) : '—'}</b>
                </span>
                <span className="rg-refval">◇ {st.ref != null ? st.ref.toFixed(1) : '—'}</span>
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
