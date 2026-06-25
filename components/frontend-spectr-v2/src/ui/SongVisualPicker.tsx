// Cover-art picker: a live library-card preview + template thumbnails + Shuffle
// + two swatch rows (primary / secondary). Controlled — the parent owns the
// SongVisual value.

import type { SongVisual, SongVisualColor } from '../api/types';
import { SongVisual as SongVisualRenderer } from './SongVisual';
import { PALETTE, TEMPLATES, colorKey, randomVisual, swatchColor } from './songVisualModel';
import p from './SongVisualPicker.module.css';

interface Props {
  name: string;
  value: SongVisual;
  onChange: (value: SongVisual) => void;
}

function MiniWave() {
  return (
    <div className={p.wave} aria-hidden>
      {Array.from({ length: 24 }).map((_, i) => {
        const v = 0.25 + (Math.sin(i * 0.7) * 0.5 + 0.5) * 0.65;
        return <div key={i} style={{ height: `${v * 100}%` }} />;
      })}
    </div>
  );
}

function CardPreview({ name, value }: { name: string; value: SongVisual }) {
  const trimmed = (name || '').trim();
  return (
    <div className={p.card}>
      <div className={p.cover}>
        <SongVisualRenderer template={value.template} primary={value.primary} secondary={value.secondary} />
        <div className={p.overlay}>
          <div className={p.top}>
            <span />
            <span className={p.pill}>new</span>
          </div>
          <div className={p.bottom}>
            <MiniWave />
            <span className={p.play} aria-hidden>
              ▶
            </span>
          </div>
        </div>
      </div>
      <div className={p.body}>
        <span className={p.name} data-empty={trimmed ? 'false' : 'true'}>
          {trimmed || 'Untitled song'}
        </span>
        <span className={p.meta}>— no analysis yet</span>
      </div>
      <div className={p.foot}>
        <span>just now</span>
        <span>0 v</span>
      </div>
    </div>
  );
}

function SwatchRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: SongVisualColor;
  onChange: (c: SongVisualColor) => void;
}) {
  const cur = colorKey(value);
  return (
    <div className={p.controlBlock}>
      <span className={p.eyebrow}>{label}</span>
      <div className={p.swatchRow} role="radiogroup" aria-label={label}>
        {PALETTE.map((col) => {
          const on = colorKey(col) === cur;
          return (
            <button
              key={colorKey(col)}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`color ${Math.round(col.h)}°`}
              className={p.swatch}
              data-on={on ? 'true' : 'false'}
              style={{ background: swatchColor(col), color: swatchColor(col) }}
              onClick={() => onChange(col)}
            />
          );
        })}
      </div>
    </div>
  );
}

export function SongVisualPicker({ name, value, onChange }: Props) {
  return (
    <div className={p.col}>
      <div className={p.previewWrap}>
        <CardPreview name={name} value={value} />
      </div>

      <div className={p.controlBlock}>
        <div className={p.controlHead}>
          <span className={p.eyebrow}>Template</span>
          <button type="button" className={p.shuffle} onClick={() => onChange(randomVisual())}>
            <span className={p.ico} aria-hidden>
              ⟳
            </span>{' '}
            Shuffle
          </button>
        </div>
        <div className={p.tmplGrid} role="radiogroup" aria-label="Visual template">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={t.id === value.template}
              data-on={t.id === value.template ? 'true' : 'false'}
              className={p.tmplThumb}
              onClick={() => onChange({ ...value, template: t.id })}
              title={t.label}
            >
              <span className={p.tmplThumbVis}>
                <SongVisualRenderer template={t.id} primary={value.primary} secondary={value.secondary} mini />
              </span>
              <span className={p.tmplThumbLabel}>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <SwatchRow label="Primary" value={value.primary} onChange={(c) => onChange({ ...value, primary: c })} />
      <SwatchRow label="Secondary" value={value.secondary} onChange={(c) => onChange({ ...value, secondary: c })} />
    </div>
  );
}
