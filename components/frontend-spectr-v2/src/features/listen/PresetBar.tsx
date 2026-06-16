import { useState } from 'react';
import type { VizPreset } from './vizPresets';
import s from './PresetBar.module.css';

interface Props {
  presets: VizPreset[];
  onSave: (name: string) => void;
  onRecall: (preset: VizPreset) => void;
  onDelete: (name: string) => void;
}

// Save / recall named snapshots of the whole DJ-tab look. Recall crossfades
// (handled by the route). Persisted to localStorage by the parent.
export function PresetBar({ presets, onSave, onRecall, onDelete }: Props) {
  const [name, setName] = useState('');

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setName('');
  };

  return (
    <div className={s.block}>
      <span className={`${s.subLabel} label`}>Presets</span>
      <div className={s.saveRow}>
        <input
          className={s.input}
          value={name}
          maxLength={24}
          placeholder="Name this look…"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
          }}
          aria-label="Preset name"
        />
        <button type="button" className="btn sm" onClick={save} disabled={!name.trim()}>
          Save
        </button>
      </div>
      {presets.length > 0 && (
        <div className={s.chips}>
          {presets.map((p) => (
            <span key={p.name} className={s.chip}>
              <button
                type="button"
                className={s.recall}
                onClick={() => onRecall(p)}
                title={`Recall "${p.name}"`}
              >
                {p.name}
              </button>
              <button
                type="button"
                className={s.del}
                onClick={() => onDelete(p.name)}
                aria-label={`Delete ${p.name}`}
                title="Delete"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
