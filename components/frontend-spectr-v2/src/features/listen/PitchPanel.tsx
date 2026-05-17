import { useCallback, useEffect, useRef } from 'react';

import s from './PreviewTools.module.css';

interface PitchPanelProps {
  semitones: number;
  cents: number;
  enabled: boolean;
  decoding: boolean;
  decodeError: string | null;
  onSemitonesChange: (st: number) => void;
  onCentsChange: (c: number) => void;
  onEnabledChange: (v: boolean) => void;
}

// Knob geometry (matches v1 PitchPanel.jsx).
const KR = 44;
const KCX = 60;
const KCY = 60;
const KNOB_PX = 120;
const START_ANG = (135 * Math.PI) / 180;
const TOTAL_ARC = 1.5 * Math.PI;

const semToAngle = (st: number) => START_ANG + ((st + 12) / 24) * TOTAL_ARC;

const INTERVAL_NAMES = [
  'Original pitch',
  'Minor 2nd',
  'Major 2nd',
  'Minor 3rd',
  'Major 3rd',
  'Perfect 4th',
  'Tritone',
  'Perfect 5th',
  'Minor 6th',
  'Major 6th',
  'Minor 7th',
  'Major 7th',
  'Octave',
];

export function PitchPanel({
  semitones,
  cents,
  enabled,
  decoding,
  decodeError,
  onSemitonesChange,
  onCentsChange,
  onEnabledChange,
}: PitchPanelProps) {
  const knobRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ startY: number; startSt: number } | null>(null);

  const drawKnob = useCallback(() => {
    const canvas = knobRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = KNOB_PX * dpr;
    canvas.height = KNOB_PX * dpr;
    canvas.style.width = `${KNOB_PX}px`;
    canvas.style.height = `${KNOB_PX}px`;

    const c = canvas.getContext('2d');
    if (!c) return;
    c.save();
    c.scale(dpr, dpr);
    c.clearRect(0, 0, KNOB_PX, KNOB_PX);

    const isPos = semitones >= 0;
    const valAng = semToAngle(semitones);
    const zeroAng = semToAngle(0);
    const accentColor =
      semitones === 0 ? 'rgba(255,255,255,0.5)' : isPos ? '#a78bfa' : '#00e5b0';

    if (semitones !== 0) {
      c.beginPath();
      c.arc(KCX, KCY, KR + 10, 0, Math.PI * 2);
      c.fillStyle = isPos ? 'rgba(167,139,250,0.05)' : 'rgba(0,229,176,0.05)';
      c.fill();
    }

    c.beginPath();
    c.arc(KCX, KCY, KR + 5, 0, Math.PI * 2);
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.fill();

    c.beginPath();
    c.arc(KCX, KCY, KR, START_ANG, START_ANG + TOTAL_ARC, false);
    c.strokeStyle = 'rgba(255,255,255,0.08)';
    c.lineWidth = 7;
    c.lineCap = 'round';
    c.stroke();

    if (Math.abs(semitones) > 0.01) {
      c.beginPath();
      if (isPos) {
        c.arc(KCX, KCY, KR, zeroAng, valAng, false);
      } else {
        c.arc(KCX, KCY, KR, valAng, zeroAng, false);
      }
      c.strokeStyle = accentColor;
      c.lineWidth = 7;
      c.lineCap = 'round';
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
    c.fillStyle = accentColor;
    c.fill();
    c.strokeStyle = '#070a12';
    c.lineWidth = 2;
    c.stroke();

    // Center semitone label
    const stLabel = semitones === 0 ? '0' : `${semitones > 0 ? '+' : ''}${semitones}`;
    c.fillStyle = accentColor;
    c.font = "bold 22px 'JetBrains Mono', monospace";
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(stLabel, KCX, KCY - 5);

    c.font = "10px 'JetBrains Mono', monospace";
    c.fillStyle = 'rgba(100,116,139,0.6)';
    c.fillText('st', KCX, KCY + 13);

    c.restore();
  }, [semitones]);

  useEffect(() => {
    drawKnob();
  }, [drawKnob]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      dragRef.current = { startY: e.clientY, startSt: semitones };
      e.preventDefault();
    },
    [semitones],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dy = dragRef.current.startY - e.clientY;
      const raw = dragRef.current.startSt + Math.round(dy / 10);
      onSemitonesChange(Math.max(-12, Math.min(12, raw)));
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [onSemitonesChange]);

  const absS = Math.abs(semitones);
  const intervalName =
    absS <= 12
      ? semitones === 0
        ? INTERVAL_NAMES[0]
        : (semitones > 0 ? '↑ ' : '↓ ') + INTERVAL_NAMES[absS]
      : '';
  const accentColor =
    semitones === 0 ? 'var(--muted)' : semitones > 0 ? 'var(--violet)' : 'var(--cyan)';

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 12, fontWeight: 700 }}>Pitch enabled</div>
          <div className={s.panelSub} style={{ marginTop: 2, fontSize: 11 }}>
            Decodes audio for sample-accurate detune. Detune scales playbackRate
            in Web Audio — tempo follows pitch (tempo-safe pitch shift needs a
            phase vocoder, follow-up slice).
          </div>
        </div>
        <button
          type="button"
          className={s.bypassToggle}
          data-on={enabled}
          onClick={() => onEnabledChange(!enabled)}
          disabled={decoding}
          style={
            enabled
              ? {
                  color: 'var(--violet)',
                  borderColor: 'rgba(167,139,250,0.4)',
                  background: 'rgba(167,139,250,0.06)',
                }
              : undefined
          }
        >
          {decoding ? 'DECODING…' : enabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {decodeError && (
        <div
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11,
            color: 'var(--red)',
            padding: '8px 10px',
            border: '1px solid rgba(244, 63, 94, 0.4)',
            background: 'rgba(244, 63, 94, 0.06)',
            borderRadius: 6,
          }}
        >
          Decode failed: {decodeError}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '160px 1fr',
          gap: 18,
          alignItems: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            padding: '12px 0',
            background: 'rgba(0, 0, 0, 0.18)',
            borderRadius: 6,
            border: '1px solid var(--border)',
            opacity: enabled ? 1 : 0.55,
          }}
        >
          <canvas
            ref={knobRef}
            style={{
              cursor: enabled ? 'ns-resize' : 'not-allowed',
              userSelect: 'none',
              touchAction: 'none',
            }}
            onMouseDown={enabled ? handleMouseDown : undefined}
          />
          <div
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 11,
              color: accentColor,
              letterSpacing: '0.05em',
            }}
          >
            {intervalName}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {[-12, -7, -5, 0, 5, 7, 12].map((st) => (
              <button
                key={st}
                type="button"
                className={s.smallBtn}
                data-on={semitones === st}
                onClick={() => onSemitonesChange(st)}
                disabled={!enabled}
                style={{ fontSize: 11 }}
              >
                {st >= 0 ? '+' : ''}
                {st}
              </button>
            ))}
            <button
              type="button"
              className={s.smallBtn}
              onClick={() => {
                onSemitonesChange(0);
                onCentsChange(0);
              }}
              disabled={!enabled}
            >
              Reset
            </button>
          </div>

          <div
            style={{
              padding: '10px 12px',
              border: '1px solid var(--border)',
              borderRadius: 6,
              background: 'rgba(255, 255, 255, 0.02)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 9,
                  letterSpacing: '0.12em',
                  color: 'var(--muted)',
                  textTransform: 'uppercase',
                }}
              >
                Fine Tune
              </span>
              <span
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 11,
                  color: 'var(--violet)',
                  fontWeight: 700,
                }}
              >
                {cents >= 0 ? '+' : ''}
                {cents} ¢
              </span>
            </div>
            <input
              type="range"
              min={-50}
              max={50}
              step={1}
              value={cents}
              onChange={(e) => onCentsChange(parseInt(e.target.value, 10))}
              disabled={!enabled}
              className={s.knobInput}
              style={{ accentColor: 'var(--violet)' }}
            />
            <div
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 9,
                color: 'var(--dim)',
                marginTop: 6,
                textAlign: 'center',
              }}
            >
              Drag knob ↕ for semitones · 100 ¢ = 1 semitone
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
