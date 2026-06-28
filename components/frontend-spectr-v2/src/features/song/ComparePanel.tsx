import { useEffect, useState } from 'react';
import type { SongDto } from '../../api/types';
import {
  useSetPersonalScore,
  useClearPersonalScore,
  useCompareNotes,
  useSaveCompareNotes,
} from '../../api/hooks';
import { METRICS, metricDelta, personalVerdict } from './song-helpers';
import styles from './SongConsole.module.css';

interface ComparePanelProps {
  song: SongDto;
  slotA: string | null;
  slotB: string | null;
}

function toneColor(tone: 'good' | 'bad' | 'neutral'): string {
  if (tone === 'good') return 'var(--green)';
  if (tone === 'bad') return 'var(--red)';
  return 'var(--muted)';
}

export function ComparePanel({ song, slotA, slotB }: ComparePanelProps) {
  const versionA = song.versions.find(v => v.id === slotA) ?? null;
  const versionB = song.versions.find(v => v.id === slotB) ?? null;

  const [aInput, setAInput] = useState<string>(
    versionA?.personalScore != null ? String(versionA.personalScore) : '',
  );
  const [bInput, setBInput] = useState<string>(
    versionB?.personalScore != null ? String(versionB.personalScore) : '',
  );

  // Re-sync inputs when slots change
  useEffect(() => {
    setAInput(versionA?.personalScore != null ? String(versionA.personalScore) : '');
  }, [slotA, versionA?.personalScore]);

  useEffect(() => {
    setBInput(versionB?.personalScore != null ? String(versionB.personalScore) : '');
  }, [slotB, versionB?.personalScore]);

  const setScoreA = useSetPersonalScore(slotA ?? '');
  const setScoreB = useSetPersonalScore(slotB ?? '');
  const clearScoreA = useClearPersonalScore(slotA ?? '');
  const clearScoreB = useClearPersonalScore(slotB ?? '');

  const notesQuery = useCompareNotes(song.id, slotA, slotB);
  const saveNotes = useSaveCompareNotes(song.id);

  const [notesText, setNotesText] = useState('');
  useEffect(() => {
    if (notesQuery.data?.body != null) setNotesText(notesQuery.data.body);
  }, [notesQuery.data?.body]);

  if (!slotA || !slotB || !versionA || !versionB) return null;

  const aPersonal = aInput !== '' ? Number(aInput) : null;
  const bPersonal = bInput !== '' ? Number(bInput) : null;
  const verdict = personalVerdict(aPersonal, bPersonal);

  const handlePersonalA = (raw: string) => {
    setAInput(raw);
    if (raw === '') {
      if (slotA) clearScoreA.mutate();
    } else {
      const v = Math.max(0, Math.min(100, Math.round(Number(raw) || 0)));
      if (slotA) setScoreA.mutate(v);
    }
  };

  const handlePersonalB = (raw: string) => {
    setBInput(raw);
    if (raw === '') {
      if (slotB) clearScoreB.mutate();
    } else {
      const v = Math.max(0, Math.min(100, Math.round(Number(raw) || 0)));
      if (slotB) setScoreB.mutate(v);
    }
  };

  const handleNotesSave = () => {
    if (slotA && slotB) saveNotes.mutate({ a: slotA, b: slotB, body: notesText });
  };

  return (
    <div className={styles.compareSection}>
      {/* Header: what changed + personal verdict */}
      <div className={styles.compareHeader}>
        <span className="label">
          What changed ·{' '}
          <span style={{ color: 'var(--cyan)' }}>A·v{versionA.versionNumber}</span>
          {' '}vs{' '}
          <span style={{ color: 'var(--text-2)' }}>B·v{versionB.versionNumber}</span>
        </span>
        <span className="mono" style={{ fontSize: '10px', color: toneColor(verdict.tone) }}>
          {verdict.label}
        </span>
      </div>

      {/* Metric tiles */}
      <div className={styles.compareTiles}>
        {METRICS.map(m => {
          const av = versionA.latestResult?.[m.key] ?? null;
          const bv = versionB.latestResult?.[m.key] ?? null;
          const delta = metricDelta(av as number | null, bv as number | null, m);
          return (
            <div key={m.key} className={styles.compareTile}>
              <div className={`label ${styles.compareTileLbl}`}>{m.label}</div>
              <div className={styles.compareTileValues}>
                <span className={`mono ${styles.compareTileAB}`}>
                  <span style={{ color: 'var(--cyan)' }}>{delta.aStr}</span>
                  {' '}
                  <span style={{ color: 'var(--dim)', fontSize: '9.5px' }}>vs</span>
                  {' '}
                  <span style={{ color: 'var(--text-2)' }}>{delta.bStr}</span>
                </span>
                <span className="mono" style={{ fontSize: '12px', fontWeight: 700, color: toneColor(delta.tone) }}>
                  {delta.deltaStr}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Personal score inputs */}
      <div className={styles.comparePersonal}>
        <span className="label" style={{ color: 'var(--violet)' }}>Your score</span>
        <div className={styles.scoreInputGroup}>
          <span className="mono" style={{ fontSize: '10px', color: 'var(--cyan)' }}>A</span>
          <input
            type="number"
            min={0}
            max={100}
            placeholder="—"
            value={aInput}
            onChange={e => handlePersonalA(e.target.value)}
            className={styles.personalInput}
          />
        </div>
        <span className="mono" style={{ fontSize: '10px', color: 'var(--dim)' }}>vs</span>
        <div className={styles.scoreInputGroup}>
          <span className="mono" style={{ fontSize: '10px', color: 'var(--text-2)' }}>B</span>
          <input
            type="number"
            min={0}
            max={100}
            placeholder="—"
            value={bInput}
            onChange={e => handlePersonalB(e.target.value)}
            className={styles.personalInput}
          />
        </div>
        {(aPersonal != null && bPersonal != null) && (
          <span className="mono" style={{ fontSize: '13px', fontWeight: 700, color: toneColor(verdict.tone) }}>
            {verdict.deltaStr}
          </span>
        )}
        <span className={`mono ${styles.savedToSong}`}>
          saved to this song
        </span>
      </div>

      {/* Notes textarea */}
      <textarea
        className={styles.notesArea}
        placeholder="Notes — what changed between these two, and is it actually better to your ear?"
        value={notesText}
        onChange={e => setNotesText(e.target.value)}
        onBlur={handleNotesSave}
      />
    </div>
  );
}
