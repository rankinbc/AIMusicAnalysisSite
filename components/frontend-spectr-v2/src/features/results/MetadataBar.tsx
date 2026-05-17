// Six-cell metadata strip below the GradeHero. Semantic <dl>/<dt>/<dd> so
// screen readers see label→value pairs. All formatters tolerate undefined.

import type { Phase1Data } from '../../api/types';
import { fmtBpm, fmtDb, fmtGenre, fmtLufs, fmtPercent } from './helpers/format';
import s from './MetadataBar.module.css';

interface MetadataBarProps {
  phase1: Phase1Data | undefined;
  genre: string | undefined; // typically phase2.data.genre
}

interface Cell {
  label: string;
  value: string;
}

export function MetadataBar({ phase1, genre }: MetadataBarProps) {
  const cells: Cell[] = [
    { label: 'BPM', value: fmtBpm(phase1?.bpm) },
    { label: 'Key', value: phase1?.detected_key ?? '—' },
    { label: 'Genre', value: fmtGenre(genre) },
    { label: 'LUFS', value: fmtLufs(phase1?.lufs) },
    { label: 'True Peak', value: fmtDb(phase1?.true_peak_db) },
    { label: 'Mono Compat', value: fmtPercent(phase1?.mono_compatibility) },
  ];

  return (
    <dl className={s.bar}>
      {cells.map((cell) => (
        <div className={s.cell} key={cell.label}>
          <dt className={s.label}>{cell.label}</dt>
          <dd className={`${s.value} mono`}>{cell.value}</dd>
        </div>
      ))}
    </dl>
  );
}
