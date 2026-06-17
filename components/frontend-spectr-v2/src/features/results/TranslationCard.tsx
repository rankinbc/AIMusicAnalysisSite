// TRANSLATION panel — Phase 9 "Mix Translation". Answers the bedroom-producer
// question: will this hold up on a phone speaker, on headphones, summed to mono?
// Leads with three 0..100 scores (mono / speaker / headphone) as left-anchored
// meters, then surfaces the analyzer's plain-language notes. Tolerant of
// undefined throughout — the phase can fail or skip.

import { Pill } from '../../ui/Pill';
import type { Phase9Data } from '../../api/types';
import s from './TranslationCard.module.css';

interface TranslationCardProps {
  phase9: Phase9Data | undefined;
}

// 0..100 score → readout + meter color. Below 50 reads red (won't translate),
// 50–70 orange (marginal), 70+ cyan (good).
function scoreColor(v: number | undefined): string {
  if (v === undefined) return 'var(--muted)';
  if (v >= 70) return 'var(--cyan)';
  if (v >= 50) return 'var(--orange)';
  return 'var(--red)';
}

function fmtScore(v: number | undefined): string {
  return v === undefined ? '—' : `${Math.round(v)}`;
}

function clampPct(v: number | undefined): number {
  if (v === undefined) return 0;
  return Math.min(100, Math.max(0, v));
}

interface MeterRow {
  label: string;
  value: number | undefined;
}

export function TranslationCard({ phase9 }: TranslationCardProps) {
  const surround = phase9?.surround;
  const playback = phase9?.playback;

  const rows: MeterRow[] = [
    { label: 'Mono Compat', value: surround?.mono_compatibility },
    { label: 'Speaker', value: playback?.speaker_score },
    { label: 'Headphone', value: playback?.headphone_score },
  ];

  // Headline pill: flag the most concrete translation risk if there is one.
  const bass = playback?.bass_translation;
  const monoCompat = surround?.mono_compatibility;
  let pill: { tone: 'cyan' | 'orange' | 'red'; text: string };
  if (monoCompat !== undefined && monoCompat < 40) {
    pill = { tone: 'red', text: 'collapses in mono' };
  } else if (bass === 'weak') {
    pill = { tone: 'orange', text: 'weak on small speakers' };
  } else if (playback?.crossfeed_safe === false) {
    pill = { tone: 'orange', text: 'wide for headphones' };
  } else if (phase9 === undefined) {
    pill = { tone: 'orange', text: 'no data' };
  } else {
    pill = { tone: 'cyan', text: 'translates well' };
  }

  // De-dupe the analyzer notes across the three modes for the detail list.
  const notes = Array.from(
    new Set([
      ...(surround?.analysis ?? []),
      ...(playback?.analysis ?? []),
      ...(phase9?.spatial?.analysis ?? []),
    ]),
  );

  return (
    <section className={s.panel}>
      <div className={s.head}>
        <h3 className={s.title}>Translation</h3>
        <Pill tone={pill.tone}>{pill.text}</Pill>
      </div>

      <div className={s.rows}>
        {rows.map((r) => {
          const color = scoreColor(r.value);
          return (
            <div className={s.row} key={r.label}>
              <div className={s.rowHead}>
                <span className={s.label}>{r.label}</span>
                <span className={`${s.value} mono`} style={{ color }}>
                  {fmtScore(r.value)}
                </span>
              </div>
              <div className={s.track}>
                <div
                  className={s.fillLeft}
                  style={{ width: `${clampPct(r.value)}%`, background: color }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {notes.length > 0 && (
        <ul className={s.notes}>
          {notes.map((n, i) => (
            <li key={i} className={s.note}>
              {n}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
