// Shared field group for the New Song + Edit Song dialogs: a two-column layout
// with the cover-art visual picker on the left and Name / Description / Genre /
// Reference profile on the right. Controlled — the parent owns the value.

import { useId, type Ref } from 'react';

import type { SongReferenceProfile, SongVisual } from '../api/types';
import { ReferenceProfileSelect } from '../features/references/ReferenceProfileSelect';
import { SongVisualPicker } from '../ui/SongVisualPicker';
import s from './SongFields.module.css';

export interface SongFieldsValue {
  name: string;
  description: string;
  genreHint: string;
  referenceProfile: SongReferenceProfile | null;
  visual: SongVisual;
}

interface Props {
  value: SongFieldsValue;
  onChange: (value: SongFieldsValue) => void;
  nameRef?: Ref<HTMLInputElement>;
}

const GENRE_SUGGESTIONS = ['Trance', 'Techno', 'House', 'Hip-Hop', 'Pop', 'Drum & Bass', 'Ambient', 'Lo-fi'];

export function SongFields({ value, onChange, nameRef }: Props) {
  const idp = useId();
  const set = <K extends keyof SongFieldsValue>(key: K, v: SongFieldsValue[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className={s.grid}>
      <SongVisualPicker name={value.name} value={value.visual} onChange={(v) => set('visual', v)} />

      <div className={s.fieldsCol}>
        <div className={s.field}>
          <label className={s.fieldLabel} htmlFor={`${idp}-name`}>
            Name <span className={s.req}>required</span>
          </label>
          <input
            id={`${idp}-name`}
            ref={nameRef}
            className={`${s.input} ${s.inputName}`}
            maxLength={200}
            placeholder="Untitled song"
            value={value.name}
            onChange={(e) => set('name', e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className={s.field}>
          <label className={s.fieldLabel} htmlFor={`${idp}-desc`}>
            Description <span className={s.opt}>optional</span>
            <span className={s.count}>{value.description.length}/500</span>
          </label>
          <textarea
            id={`${idp}-desc`}
            className={`${s.input} ${s.textarea}`}
            rows={3}
            maxLength={500}
            placeholder="Notes to self — direction, references, what to fix next…"
            value={value.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </div>

        <div className={s.field}>
          <label className={s.fieldLabel} htmlFor={`${idp}-genre`}>
            Genre hint <span className={s.opt}>optional · helps analysis</span>
          </label>
          <input
            id={`${idp}-genre`}
            className={s.input}
            maxLength={50}
            placeholder="e.g. Melodic techno"
            value={value.genreHint}
            onChange={(e) => set('genreHint', e.target.value)}
          />
          <div className={s.genreSuggest}>
            {GENRE_SUGGESTIONS.map((g) => {
              const on = value.genreHint.trim().toLowerCase() === g.toLowerCase();
              return (
                <button
                  key={g}
                  type="button"
                  className={s.suggestChip}
                  data-on={on ? 'true' : 'false'}
                  onClick={() => set('genreHint', on ? '' : g)}
                >
                  {g}
                </button>
              );
            })}
          </div>
        </div>

        <div className={s.field}>
          <span className={s.fieldLabel}>
            Reference profile <span className={s.opt}>optional · default comparison</span>
          </span>
          <ReferenceProfileSelect
            value={value.referenceProfile}
            onChange={(v) => set('referenceProfile', v)}
          />
        </div>
      </div>
    </div>
  );
}
