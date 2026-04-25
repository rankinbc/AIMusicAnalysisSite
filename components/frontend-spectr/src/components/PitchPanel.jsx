import { useRef, useEffect, useCallback } from 'react';

const INTERVAL_NAMES = [
  'Original pitch', 'Minor 2nd', 'Major 2nd', 'Minor 3rd', 'Major 3rd',
  'Perfect 4th', 'Tritone', 'Perfect 5th', 'Minor 6th',
  'Major 6th', 'Minor 7th', 'Major 7th', 'Octave',
];

const KR         = 44;   // knob arc radius
const KCX        = 60;   // knob center x
const KCY        = 60;   // knob center y
const KNOB_PX    = 120;  // canvas logical size
const START_ANG  = 135 * Math.PI / 180;  // 7 o'clock
const TOTAL_ARC  = 1.5 * Math.PI;        // 270°

const semToAngle = st => START_ANG + ((st + 12) / 24) * TOTAL_ARC;

// semitones/cents are lifted state from StickyPlayer (applied to playbackRate there)
export default function PitchPanel({
  semitones,
  onSemitonesChange,
  cents,
  onCentsChange,
  canvasHeight = 200,
  onToggleExpand,
  onClose,
  isExpanded = false,
}) {
  const knobRef = useRef(null);
  const dragRef = useRef(null);

  const drawKnob = useCallback(() => {
    const canvas = knobRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width        = KNOB_PX * dpr;
    canvas.height       = KNOB_PX * dpr;
    canvas.style.width  = KNOB_PX + 'px';
    canvas.style.height = KNOB_PX + 'px';

    const c = canvas.getContext('2d');
    c.save();
    c.scale(dpr, dpr);
    c.clearRect(0, 0, KNOB_PX, KNOB_PX);

    const isPos   = semitones >= 0;
    const valAng  = semToAngle(semitones);
    const zeroAng = semToAngle(0);
    const accentColor = semitones === 0 ? 'rgba(255,255,255,0.5)' : isPos ? '#a78bfa' : '#00e5b0';

    // Outer glow when active
    if (semitones !== 0) {
      c.beginPath();
      c.arc(KCX, KCY, KR + 10, 0, Math.PI * 2);
      c.fillStyle = isPos ? 'rgba(167,139,250,0.05)' : 'rgba(0,229,176,0.05)';
      c.fill();
    }

    // Background disc
    c.beginPath();
    c.arc(KCX, KCY, KR + 5, 0, Math.PI * 2);
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.fill();

    // Full track arc (dimmed)
    c.beginPath();
    c.arc(KCX, KCY, KR, START_ANG, START_ANG + TOTAL_ARC, false);
    c.strokeStyle = 'rgba(255,255,255,0.08)';
    c.lineWidth   = 7;
    c.lineCap     = 'round';
    c.stroke();

    // Value arc (colored, from zero to current)
    if (Math.abs(semitones) > 0.01) {
      c.beginPath();
      if (isPos) {
        c.arc(KCX, KCY, KR, zeroAng, valAng, false);
      } else {
        c.arc(KCX, KCY, KR, valAng, zeroAng, false);
      }
      c.strokeStyle = accentColor;
      c.lineWidth   = 7;
      c.lineCap     = 'round';
      c.stroke();
    }

    // Zero tick
    const zx = KCX + KR * Math.cos(zeroAng);
    const zy = KCY + KR * Math.sin(zeroAng);
    c.beginPath();
    c.arc(zx, zy, 2.5, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255,255,255,0.3)';
    c.fill();

    // Indicator dot
    const dx = KCX + KR * Math.cos(valAng);
    const dy = KCY + KR * Math.sin(valAng);
    c.beginPath();
    c.arc(dx, dy, 6, 0, Math.PI * 2);
    c.fillStyle   = accentColor;
    c.fill();
    c.strokeStyle = '#070a12';
    c.lineWidth   = 2;
    c.stroke();

    // Center semitone value
    const stLabel = semitones === 0 ? '0' : `${semitones > 0 ? '+' : ''}${semitones}`;
    c.fillStyle       = accentColor;
    c.font            = "bold 22px 'JetBrains Mono', monospace";
    c.textAlign       = 'center';
    c.textBaseline    = 'middle';
    c.fillText(stLabel, KCX, KCY - 5);

    c.font      = "10px 'JetBrains Mono', monospace";
    c.fillStyle = 'rgba(100,116,139,0.6)';
    c.fillText('st', KCX, KCY + 13);

    c.restore();
  }, [semitones]);

  useEffect(() => { drawKnob(); }, [drawKnob]);

  // Vertical drag to change semitones
  const handleMouseDown = useCallback((e) => {
    dragRef.current = { startY: e.clientY, startSt: semitones };
    e.preventDefault();
  }, [semitones]);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current) return;
      const dy  = dragRef.current.startY - e.clientY;
      const raw = dragRef.current.startSt + Math.round(dy / 10);
      onSemitonesChange(Math.max(-12, Math.min(12, raw)));
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [onSemitonesChange]);

  const absS         = Math.abs(semitones);
  const intervalName = absS <= 12 ? (semitones === 0 ? INTERVAL_NAMES[0] : (semitones > 0 ? '↑ ' : '↓ ') + INTERVAL_NAMES[absS]) : '';
  const accentColor  = semitones === 0 ? 'var(--muted)' : semitones > 0 ? 'var(--violet)' : 'var(--cyan)';
  const mono         = { fontFamily: "'JetBrains Mono', monospace" };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        background: 'rgba(255,255,255,0.015)',
      }}>
        <span style={{ ...mono, fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--violet)', flex: 1 }}>
          Transpose
        </span>

        <button onClick={() => { onSemitonesChange(0); onCentsChange(0); }} style={{
          ...mono, fontSize: 9, padding: '3px 9px', borderRadius: 5, cursor: 'pointer',
          background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)',
        }}>
          Reset
        </button>

        {onToggleExpand && (
          <button onClick={onToggleExpand} title={isExpanded ? 'Collapse' : 'Expand'} style={{
            ...mono, fontSize: 13, padding: '2px 7px', borderRadius: 5, cursor: 'pointer',
            background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', lineHeight: 1,
          }}>
            {isExpanded ? '⤓' : '⤒'}
          </button>
        )}

        {onClose && (
          <button onClick={onClose} title="Close" style={{
            ...mono, fontSize: 13, padding: '2px 7px', borderRadius: 5, cursor: 'pointer',
            background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', lineHeight: 1,
          }}>
            ✕
          </button>
        )}
      </div>

      {/* Knob area */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 14,
        padding: '24px 14px 20px',
        background: 'rgba(0,0,0,0.28)',
        minHeight: canvasHeight,
        flexShrink: 0,
      }}>
        <canvas
          ref={knobRef}
          style={{ cursor: 'ns-resize', userSelect: 'none', touchAction: 'none' }}
          onMouseDown={handleMouseDown}
        />

        <div style={{ textAlign: 'center' }}>
          <div style={{ ...mono, fontSize: 11, color: accentColor, letterSpacing: '0.05em' }}>
            {intervalName}
          </div>
        </div>

        {/* Quick semitone buttons */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 200 }}>
          {[-12, -7, -5, 0, 5, 7, 12].map(st => (
            <button
              key={st}
              onClick={() => onSemitonesChange(st)}
              style={{
                ...mono, fontSize: 8, padding: '3px 7px', borderRadius: 4, cursor: 'pointer',
                background: semitones === st ? 'rgba(167,139,250,0.15)' : 'transparent',
                border: `1px solid ${semitones === st ? 'rgba(167,139,250,0.4)' : 'var(--border)'}`,
                color: semitones === st ? 'var(--violet)' : 'var(--muted)',
              }}
            >
              {st >= 0 ? '+' : ''}{st}
            </button>
          ))}
        </div>
      </div>

      {/* Fine tune */}
      <div style={{ padding: '10px 14px 12px', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ ...mono, fontSize: 8, letterSpacing: '0.12em', color: 'var(--muted)', textTransform: 'uppercase' }}>Fine Tune</span>
          <span style={{ ...mono, fontSize: 8, color: 'var(--violet)' }}>{cents >= 0 ? '+' : ''}{cents} ¢</span>
        </div>
        <input
          type="range" min={-50} max={50} step={1} value={cents}
          onChange={e => onCentsChange(parseInt(e.target.value, 10))}
          style={{ width: '100%', accentColor: 'var(--violet)', cursor: 'pointer' }}
        />
        <div style={{ ...mono, fontSize: 8, color: 'rgba(100,116,139,0.35)', marginTop: 6, textAlign: 'center' }}>
          Drag knob ↕ for semitones · Tempo unchanged
        </div>
      </div>
    </div>
  );
}
