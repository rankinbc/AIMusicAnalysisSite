import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';

import { useCompare } from '../api/hooks';
import type { CompareSideDto, SongDto } from '../api/types';
import { GradePill } from '../ui/GradePill';
import f from '../styles/forms.module.css';
import s from './CompareDialog.module.css';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  song: SongDto;
  defaultVersionA?: string | null;
  defaultVersionB?: string | null;
}

interface Metric {
  label: string;
  unit: string;
  better: 'higher' | 'lower' | 'neutral';
  get: (side: CompareSideDto) => number | null | undefined;
  format?: (v: number) => string;
}

// Order matters — the table renders in declared sequence.
const METRICS: Metric[] = [
  { label: 'Mix score', unit: '', better: 'higher', get: (s) => s.score },
  { label: 'LUFS', unit: ' LUFS', better: 'higher', get: (s) => s.lufs }, // higher = quieter = generally safer for streaming
  { label: 'True peak', unit: ' dBTP', better: 'lower', get: (s) => s.truePeakDb },
  {
    label: 'Dyn range',
    unit: ' LU',
    better: 'higher',
    get: (s) => (s.rmsDb != null && s.lufs != null ? Math.abs(s.rmsDb - s.lufs) : null),
  },
  { label: 'BPM', unit: '', better: 'neutral', get: (s) => s.bpm },
  { label: 'Stereo width', unit: '', better: 'higher', get: (s) => s.stereoWidth },
  { label: 'Correlation', unit: '', better: 'higher', get: (s) => s.stereoCorrelation },
  { label: 'Mono compat', unit: '', better: 'higher', get: (s) => s.monoCompatibility },
];

function fmt(v: number | null | undefined): string {
  if (v == null) return '—';
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function deltaColor(delta: number, better: Metric['better']): string {
  if (better === 'neutral' || Math.abs(delta) < 0.01) return 'var(--muted)';
  const positiveIsGood = better === 'higher';
  const positive = delta > 0;
  return positive === positiveIsGood ? 'var(--green)' : 'var(--red)';
}

export function CompareDialog({
  open,
  onOpenChange,
  song,
  defaultVersionA,
  defaultVersionB,
}: Props) {
  // Use defaults the parent passed in; fall back to (first, current/last)
  // so opening Compare with no preselection still gives a sensible view.
  const sortedVersions = [...song.versions].sort(
    (a, b) => a.versionNumber - b.versionNumber,
  );
  const first = sortedVersions[0]?.id ?? null;
  const last = sortedVersions[sortedVersions.length - 1]?.id ?? null;

  const [versionA, setVersionA] = useState<string | null>(defaultVersionA ?? first);
  const [versionB, setVersionB] = useState<string | null>(defaultVersionB ?? last);

  // Re-sync when defaults change (e.g. user clicked a different preset).
  useEffect(() => {
    if (defaultVersionA !== undefined) setVersionA(defaultVersionA);
    if (defaultVersionB !== undefined) setVersionB(defaultVersionB);
  }, [defaultVersionA, defaultVersionB]);

  const { data, isLoading, error } = useCompare(versionA, versionB);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={f.dialogOverlay} />
        <Dialog.Content className={`${f.dialogContent} ${s.wide}`}>
          <Dialog.Title className={f.dialogTitle}>Compare versions</Dialog.Title>
          <Dialog.Description className={f.dialogDescription}>
            Pick any two versions of <strong>{song.name}</strong>. Deltas use the
            most recent analysis on each side.
          </Dialog.Description>

          <div className={s.pickers}>
            <VersionPicker
              label="From"
              song={song}
              value={versionA}
              onChange={setVersionA}
              exclude={versionB}
            />
            <span className={s.arrow}>→</span>
            <VersionPicker
              label="To"
              song={song}
              value={versionB}
              onChange={setVersionB}
              exclude={versionA}
            />
          </div>

          {isLoading && <p className={s.status}>Loading…</p>}
          {error && (
            <p className={s.error}>
              {error instanceof Error ? error.message : 'Could not load comparison'}
            </p>
          )}
          {data && <DeltaTable a={data.a} b={data.b} />}

          <div className={f.dialogActions}>
            <Dialog.Close asChild>
              <button type="button" className={f.button}>
                Close
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function VersionPicker({
  label,
  song,
  value,
  onChange,
  exclude,
}: {
  label: string;
  song: SongDto;
  value: string | null;
  onChange: (id: string) => void;
  exclude: string | null;
}) {
  return (
    <label className={s.picker}>
      <span className={s.pickerLabel}>{label}</span>
      <select
        className={s.pickerSelect}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        {song.versions
          .slice()
          .sort((a, b) => a.versionNumber - b.versionNumber)
          .map((v) => (
            <option key={v.id} value={v.id} disabled={v.id === exclude}>
              v{v.versionNumber}
              {v.label ? ` · ${v.label}` : ''}
              {v.isCurrent ? ' · current' : ''}
            </option>
          ))}
      </select>
    </label>
  );
}

function DeltaTable({ a, b }: { a: CompareSideDto; b: CompareSideDto }) {
  return (
    <div className={s.tableWrap}>
      <div className={s.sideHeader}>
        <SideCol side={a} />
        <span className={s.arrow}>→</span>
        <SideCol side={b} />
      </div>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Metric</th>
            <th>v{a.versionNumber}</th>
            <th>v{b.versionNumber}</th>
            <th>Δ</th>
          </tr>
        </thead>
        <tbody>
          {METRICS.map((m) => {
            const va = m.get(a);
            const vb = m.get(b);
            const delta = va != null && vb != null ? vb - va : null;
            const color = delta != null ? deltaColor(delta, m.better) : 'var(--muted)';
            const sign = delta != null && delta > 0 ? '+' : '';
            return (
              <tr key={m.label}>
                <td>{m.label}</td>
                <td className="mono">
                  {fmt(va)}
                  {va != null && m.unit}
                </td>
                <td className="mono">
                  {fmt(vb)}
                  {vb != null && m.unit}
                </td>
                <td className="mono" style={{ color, fontWeight: 700 }}>
                  {delta != null ? `${sign}${fmt(delta)}` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SideCol({ side }: { side: CompareSideDto }) {
  return (
    <div className={s.sideCol}>
      <GradePill grade={side.grade} size="sm" />
      <div>
        <div className={s.sideTitle}>v{side.versionNumber}</div>
        {side.label && <div className={s.sideLabel}>{side.label}</div>}
        <div className={`mono ${s.sideMeta}`}>
          {new Date(side.createdAt).toLocaleDateString()}
        </div>
      </div>
    </div>
  );
}
