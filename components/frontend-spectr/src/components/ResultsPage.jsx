import { useState } from 'react';
import { Label, gradeColor } from './primitives';

function MetricTooltip({ label, tip }) {
  const [show, setShow] = useState(false);
  return (
    <div
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'default' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.13em', textTransform: 'uppercase', color: 'var(--muted)' }}>
        {label}
      </span>
      <span style={{ fontSize: 9, color: 'var(--dim)', lineHeight: 1 }}>?</span>
      {show && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%',
          transform: 'translateX(-50%)',
          background: '#0f1828', border: '1px solid var(--border)',
          borderRadius: 7, padding: '7px 11px',
          fontSize: 11, color: 'var(--muted)',
          fontFamily: 'JetBrains Mono, monospace',
          whiteSpace: 'nowrap', zIndex: 50,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          pointerEvents: 'none',
          animation: 'slideDown 0.12s ease both',
        }}>
          {tip}
          <div style={{
            position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
            width: 0, height: 0,
            borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
            borderTop: '5px solid var(--border)',
          }} />
        </div>
      )}
    </div>
  );
}
import {
  FixCard, StreamingTable, FrequencyBars,
  StereoCard, StemClashes, ArrangementSection, GapAnalysis,
} from './ResultsSections';
import { PerStemBalanceCard, StemClashMatrixCard, StemReferenceDeltasCard } from './StemSections';
import AIAnalysisPanel from './AIAnalysisModal';
import ALSProjectPanel from './ALSProjectPanel';

function StatCell({ label, value, sub, color, last, bottom }) {
  return (
    <div style={{ padding: '8px 12px', borderRight: last ? 'none' : '1px solid var(--border)', borderBottom: bottom ? 'none' : '1px solid var(--border)' }}>
      <div className="mono" style={{ fontSize: 8, letterSpacing: '0.13em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 3 }}>{label}</div>
      <div className="mono" style={{ fontSize: 15, fontWeight: 600, color, lineHeight: 1.1 }}>{value}</div>
      {sub && <div className="mono" style={{ fontSize: 8, color: 'var(--dim)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function VerdictStrip({ data }) {
  const gc = gradeColor(data.grade);
  const verdictText = { A: 'Release-ready', B: 'Almost there', C: 'Work needed', D: 'Major issues', F: 'Start over' }[data.grade[0]] ?? data.grade;

  const lufs    = data.loudness.integrated;
  const lufsColor = lufs <= -14 ? 'var(--cyan)' : lufs <= -9 ? 'var(--yellow)' : 'var(--red)';
  const tp      = data.loudness.truePeak ?? -1.0;
  const tpColor = tp <= -1.0 ? 'var(--cyan)' : tp <= -0.5 ? 'var(--yellow)' : 'var(--red)';
  const dr      = data.loudness.dynamicRange ?? 6;
  const drColor = dr >= 8 ? 'var(--cyan)' : dr >= 4 ? 'var(--yellow)' : 'var(--orange)';
  const rms     = data.loudness.rms ?? -14;
  const dance   = data.danceScore;
  const danceColor = dance == null ? 'var(--muted)' : dance >= 75 ? 'var(--cyan)' : dance >= 50 ? 'var(--yellow)' : 'var(--orange)';
  const sw      = data.stereo?.width ?? 0;
  const swColor = sw >= 40 ? 'var(--cyan)' : sw >= 20 ? 'var(--yellow)' : 'var(--orange)';
  const mc      = Math.round((data.stereo?.monoCompat ?? 0.5) * 100);
  const mcColor = mc >= 70 ? 'var(--cyan)' : mc >= 50 ? 'var(--yellow)' : 'var(--orange)';
  const pct     = data.percentile != null ? Math.round(data.percentile) : null;

  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
      display: 'flex', overflow: 'hidden', marginBottom: 20,
    }}>
      {/* Track name + grade + score */}
      <div style={{ padding: '14px 24px 18px', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.06em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
          {data.track.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1, color: gc, filter: `drop-shadow(0 0 14px ${gc}55)` }}>
            {data.grade}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span className="mono" style={{ fontSize: 28, fontWeight: 700, color: gc }}>{data.score}</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>/100</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{verdictText}</div>
          </div>
        </div>
      </div>

      {/* Genre + BPM + Key */}
      <div style={{ padding: '14px 18px', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10, flexShrink: 0 }}>
        <div>
          <div className="mono" style={{ fontSize: 8, letterSpacing: '0.13em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 3 }}>Genre</div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{data.genre.name}</div>
          <div className="mono" style={{ fontSize: 9, color: 'var(--muted)', marginTop: 1 }}>{data.genre.confidence}% conf</div>
        </div>
        <div>
          <div className="mono" style={{ fontSize: 8, letterSpacing: '0.13em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 3 }}>BPM / Key</div>
          <div className="mono" style={{ fontSize: 18, fontWeight: 500 }}>{data.bpm}</div>
          <div className="mono" style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{data.key}</div>
        </div>
      </div>

      {/* Compact stats grid — 4 cols × 2 rows */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <StatCell label="LUFS"       value={lufs.toFixed(1)}             sub={data.genreMedianLufs != null ? `med ${data.genreMedianLufs.toFixed(1)}` : 'integrated'} color={lufsColor} />
        <StatCell label="True Peak"  value={`${tp.toFixed(1)} dBTP`}     sub={tp >= -0.5 ? 'clipping risk' : 'safe'}                color={tpColor} />
        <StatCell label="Dyn Range"  value={`${dr.toFixed(1)} LU`}       sub={dr >= 8 ? 'good' : dr >= 4 ? 'compressed' : 'heavy'} color={drColor} />
        <StatCell label="RMS"        value={`${rms.toFixed(1)} dB`}      sub="average level"                                       color="var(--muted)"  last />
        <StatCell label="Dance"      value={dance != null ? dance : '—'} sub={dance >= 75 ? 'high energy' : dance >= 50 ? 'moderate' : 'low energy'} color={danceColor} bottom />
        <StatCell label="Width"      value={`${sw}%`}                    sub={sw >= 40 ? 'wide' : 'narrow'}                       color={swColor}       bottom />
        <StatCell label="Mono"       value={`${mc}%`}                    sub={mc >= 70 ? 'safe' : 'check mono'}                   color={mcColor}       bottom />
        <StatCell label="Percentile" value={pct != null ? `${pct}th` : '—'} sub={data.genre?.name ?? 'genre'}                    color="var(--violet)"  last bottom />
      </div>
    </div>
  );
}

export default function ResultsPage({ data, jobId, onBack, onProfile }) {

  return (
    <div>
      {/* ── Nav ── */}
      <nav style={{
        padding: '14px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--border)',
        position: 'sticky', top: 0,
        background: 'rgba(7,10,18,0.94)', backdropFilter: 'blur(12px)',
        zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={onBack} style={{
            background: 'none', color: 'var(--muted)', fontSize: 12,
            padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)',
          }}>← Back</button>
          <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: '0.22em', color: 'var(--cyan)' }}>SPECTR</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{data.track.name}</div>

          <button onClick={onProfile} style={{
            background: 'none', color: 'var(--muted)', fontSize: 12,
            padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 6,
          }}>Profile</button>
        </div>
      </nav>

      {/* ── Page content ── */}
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '28px 24px' }}>

        {/* 1. Verdict — grade, score, key metadata */}
        <div className="fade-up">
          <VerdictStrip data={data} />
        </div>

        {/* 1b. AI Analysis panel — always shown when jobId present */}
        {jobId && (
          <AIAnalysisPanel jobId={jobId} />
        )}

        {/* 1c. Ableton project browser — shown only when .als was uploaded */}
        {jobId && (
          <ALSProjectPanel jobId={jobId} />
        )}

        {/* 2. Fix Queue — ranked actionable issues */}
        <div className="fade-up" style={{ animationDelay: '0.07s' }}>
          <Label>Fix Queue — ranked by impact</Label>
          {data.fixes.map((f, i) => <FixCard fix={f} i={i} key={i} chartData={data} />)}
        </div>

        {/* 3. Frequency Balance — spectral health */}
        <div className="fade-up" style={{ animationDelay: '0.12s', marginBottom: 16 }}><FrequencyBars data={data} /></div>

        {/* 4. Stereo Health */}
        <div className="fade-up" style={{ animationDelay: '0.17s', marginBottom: 16 }}><StereoCard data={data} /></div>

        {/* 5. Stem Clashes — element conflicts (mix-level spectral) */}
        <div className="fade-up" style={{ animationDelay: '0.20s' }}><StemClashes data={data} /></div>

        {/* 5b. Per-stem analysis (only when user uploaded stems) */}
        {data.stems && (
          <>
            <div className="fade-up" style={{ animationDelay: '0.21s' }}>
              <PerStemBalanceCard perStem={data.stems.perStem} />
            </div>
            <div className="fade-up" style={{ animationDelay: '0.22s' }}>
              <StemClashMatrixCard clashes={data.stems.clashMatrix} />
            </div>
          </>
        )}
        {data.stemReferenceDeltas && (
          <div className="fade-up" style={{ animationDelay: '0.23s' }}>
            <StemReferenceDeltasCard deltas={data.stemReferenceDeltas} />
          </div>
        )}

        {/* 6. Gap Analysis — reference comparison */}
        <div className="fade-up" style={{ animationDelay: '0.23s' }}><GapAnalysis data={data} /></div>

        {/* 7. Arrangement — structural issues */}
        <div className="fade-up" style={{ animationDelay: '0.26s' }}><ArrangementSection data={data} /></div>

        {/* 8. Streaming Readiness — platform pass/fail (reference, not creative) */}
        <div className="fade-up" style={{ animationDelay: '0.29s' }}><StreamingTable data={data} /></div>

        <div className="mono fade-up" style={{ textAlign: 'center', fontSize: 11, color: 'var(--dim)', marginTop: 40, paddingBottom: 100, animationDelay: '0.32s' }}>
          SPECTR · AI Music Analysis · {data.tranceDNA.parts.length} genre DNA components
        </div>
      </div>

    </div>
  );
}
