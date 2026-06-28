import type { VersionDto } from '../../api/types';
import { scoredAsc, trendSummary } from './song-helpers';
import styles from './SongConsole.module.css';

interface ScoreTrendCardProps {
  versions: VersionDto[];
  onPointClick: (id: string) => void;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

export function ScoreTrendCard({ versions, onPointClick }: ScoreTrendCardProps) {
  const sc = scoredAsc(versions);
  const trend = trendSummary(versions);
  const sparse = sc.length < 2;

  // Build chart geometry (mirrors dc.html lines 603–644)
  const H = 176, padTop = 26, padBottom = 46, padXpct = 8, plotH = H - padTop - padBottom;

  let chartContent: React.ReactNode = null;

  if (!sparse) {
    const scs = sc.map(v => v.latestResult!.score!);
    let lo = Math.max(0, Math.min(...scs) - 8);
    let hi = Math.min(100, Math.max(...scs) + 5);
    if (hi - lo < 20) hi = lo + 20;

    const xOf = (i: number) =>
      sc.length === 1 ? 50 : padXpct + (i / (sc.length - 1)) * (100 - 2 * padXpct);
    const yOf = (s: number) => padTop + (1 - (s - lo) / (hi - lo)) * plotH;

    const bottomY = (H - padBottom).toFixed(1);

    const pts = sc.map((v, i) => {
      const lp = xOf(i);
      const y = yOf(v.latestResult!.score!);
      return {
        n: v.versionNumber,
        score: v.latestResult!.score!,
        leftPct: lp.toFixed(2),
        top: y.toFixed(1),
        scoreTop: (y - 21).toFixed(1),
        dateStr: fmtDate(v.createdAt),
        isCurrent: v.isCurrent,
        id: v.id,
      };
    });

    const linePts = pts.map(p => `${p.leftPct},${p.top}`).join(' ');
    const areaPath = [
      'M',
      pts.map(p => `${p.leftPct},${p.top}`).join(' L '),
      'L', pts[pts.length - 1].leftPct + ',' + bottomY,
      'L', pts[0].leftPct + ',' + bottomY,
      'Z',
    ].join(' ');

    // Grid marks
    const marks: { label: string; top: string; labelTop: string }[] = [];
    for (let g = Math.ceil(lo / 10) * 10; g <= hi; g += 10) {
      marks.push({ label: String(g), top: yOf(g).toFixed(1), labelTop: (yOf(g) - 6).toFixed(1) });
    }

    chartContent = (
      <div className={styles.timelineChart}>
        {/* Grid lines */}
        {marks.map(m => (
          <div key={`gl-${m.label}`} style={{ position: 'absolute', left: 0, right: 0, top: `${m.top}px`, borderTop: '1px dashed var(--border)' }} />
        ))}
        {marks.map(m => (
          <span key={`gt-${m.label}`} className="mono" style={{ position: 'absolute', left: 0, top: `${m.labelTop}px`, fontSize: '9px', color: 'var(--dim)', background: 'var(--card)', paddingRight: '5px' }}>
            {m.label}
          </span>
        ))}

        {/* SVG line + area */}
        <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" width="100%" height={H} style={{ position: 'absolute', inset: 0, display: 'block', overflow: 'visible' }}>
          <path d={areaPath} style={{ fill: 'var(--cyan)', opacity: 0.08 }} />
          <polyline points={linePts} style={{ fill: 'none', stroke: 'var(--cyan)', strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round', vectorEffect: 'non-scaling-stroke' }} />
        </svg>

        {/* Score labels + hit dots */}
        {pts.map(p => (
          <span
            key={`ps-${p.n}`}
            className="mono"
            style={{ position: 'absolute', left: `${p.leftPct}%`, top: `${p.scoreTop}px`, transform: 'translateX(-50%)', fontSize: '12px', fontWeight: 700, color: 'var(--cyan)' }}
          >
            {p.score}
          </span>
        ))}
        {pts.map(p => (
          <button
            key={`pb-${p.n}`}
            onClick={() => onPointClick(p.id)}
            title={`Load v${p.n} into deck A`}
            style={{
              position: 'absolute',
              left: `${p.leftPct}%`,
              top: `${p.top}px`,
              transform: 'translate(-50%,-50%)',
              width: p.isCurrent ? 14 : 10,
              height: p.isCurrent ? 14 : 10,
              padding: 0,
              borderRadius: '50%',
              background: 'var(--cyan)',
              border: p.isCurrent ? '2px solid var(--bg)' : 'none',
              boxShadow: p.isCurrent ? '0 0 12px var(--cyan-glow)' : '0 0 6px var(--cyan-glow)',
              cursor: 'pointer',
            }}
          />
        ))}
        {/* Version labels + dates */}
        {pts.map(p => (
          <div key={`pd-${p.n}`} style={{ position: 'absolute', left: `${p.leftPct}%`, bottom: '2px', transform: 'translateX(-50%)', textAlign: 'center', whiteSpace: 'nowrap' }}>
            <div className="mono" style={{ fontSize: '9.5px', fontWeight: 700, color: 'var(--text-2)' }}>v{p.n}</div>
            <div className="mono" style={{ fontSize: '8.5px', color: 'var(--dim)' }}>{p.dateStr}</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-hd">
        <span className="label">Progress · mix score</span>
        {trend && <span className="mono" style={{ fontSize: '10px', color: 'var(--cyan)', letterSpacing: '0.04em' }}>{trend}</span>}
      </div>
      <div className="card-body">
        {sparse ? (
          <div className={styles.timelineSparse}>
            <div className={styles.timelineRule} />
            <span className={`mono ${styles.timelineSparseHint ?? ''}`} style={{ fontSize: '11px', color: 'var(--muted)' }}>
              Scores appear here as you analyze versions
            </span>
          </div>
        ) : (
          chartContent
        )}
      </div>
    </div>
  );
}
