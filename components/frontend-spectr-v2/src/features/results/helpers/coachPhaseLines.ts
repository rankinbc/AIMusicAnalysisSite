/* The coach's per-phase "here's what I learned" lines — one template per
 * measurement, filled from the phase results as they land (partial results
 * while the job runs, final_json after). Pure; ids are stable per event. */
import type {
  FinalJson,
  Phase1Data,
  Phase2Data,
  Phase3Data,
  Phase4Data,
  Phase6Data,
  Phase7Data,
  Phase8Data,
  Phase9Data,
} from '../../../api/types';
import { PHASE_SHORT } from './analysisModalData';
import type { LinePart, LineTone } from './coachNarration';

export interface PhaseLine {
  id: string;
  parts: LinePart[];
  tone: LineTone;
}

const MINUS = '−';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const signed = (n: number, digits = 1): string => {
  const v = n.toFixed(digits);
  return n < 0 ? `${MINUS}${v.slice(1)}` : v;
};
const pct = (x: number): string => `${Math.round(x <= 1 ? x * 100 : x)}%`;

export function ordinal(n: number): string {
  const r = Math.round(n);
  const t = r % 100;
  if (t >= 11 && t <= 13) return `${r}th`;
  return `${r}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[r % 10] ?? 'th'}`;
}

const line = (id: string, parts: LinePart[], tone: LineTone = 'info'): PhaseLine => ({ id, parts, tone });

function phaseOf<T>(fj: FinalJson, n: number): { status: string; data: T | undefined } | undefined {
  const p = fj.phases?.find((x) => x.phase === n);
  return p ? { status: String(p.status), data: p.data as T | undefined } : undefined;
}

// ── phase 1 (early sub-results stream in while it runs) ────────────────────
function loudnessComment(lufs: number): string {
  if (lufs > -8) return 'That’s very loud — streaming platforms will turn it down a lot.';
  if (lufs > -11) return 'A loud, club-ready level.';
  if (lufs > -15) return 'Right around streaming loudness.';
  return 'On the quiet side for a finished master.';
}

function phase1Lines(d: Phase1Data | undefined): PhaseLine[] {
  if (!d) return [];
  const out: PhaseLine[] = [];
  if (isNum(d.lufs)) {
    out.push(line('p1:lufs', ['Integrated loudness: ', { b: `${signed(d.lufs)} LUFS` }, `. ${loudnessComment(d.lufs)}`]));
  }
  if (isNum(d.true_peak_db)) {
    const tp = { b: `${signed(d.true_peak_db)} dBTP` };
    if (d.clipping_detected) {
      const n = isNum(d.clipped_sample_count) && d.clipped_sample_count > 0 ? ` (${d.clipped_sample_count} samples)` : '';
      out.push(line('p1:peak', ['True peak ', tp, ' — and it’s ', { b: 'clipping' }, `${n}.`], 'warn'));
    } else if (d.true_peak_db > -1) {
      out.push(line('p1:peak', ['True peak ', tp, ' — hot; lossy encoding can push that over 0.'], 'warn'));
    } else {
      out.push(line('p1:peak', ['True peak ', tp, ' — safe headroom.']));
    }
  }
  if (isNum(d.bpm)) out.push(line('p1:tempo', ['Tempo locks in at ', { b: `${Math.round(d.bpm)} BPM` }, '.']));
  const key = d.key_estimate?.key ?? d.detected_key;
  if (key) {
    const mode = d.key_estimate?.mode;
    const conf = d.key_estimate?.confidence ?? d.key_detection_confidence;
    out.push(
      line('p1:key', [
        'Key: ',
        { b: `${key}${mode ? ` ${mode}` : ''}` },
        isNum(conf) && conf > 0 ? ` (${pct(conf)} confident).` : '.',
      ]),
    );
  }
  return out;
}

// ── phases 2–9 ─────────────────────────────────────────────────────────────
function genreLine(d: Phase2Data | undefined): PhaseLine | null {
  if (!d?.genre) return null;
  const conf = d.confidence;
  if (isNum(conf) && conf < 0.5) {
    return line('p2', ['Genre: ', { b: d.genre }, ` — but I’m only ${pct(conf)} sure; you can correct it from the report.`]);
  }
  return line('p2', ['This reads as ', { b: d.genre }, isNum(conf) ? ` — ${pct(conf)} confident.` : '.']);
}

function scoreLine(d: Phase3Data | undefined, genre: string | undefined): PhaseLine | null {
  if (!d || !isNum(d.total_score)) return null;
  const parts: LinePart[] = [
    'Against the ',
    { b: d.genre ?? genre ?? 'genre' },
    ' profile it scores ',
    { b: `${Math.round(d.total_score)}/100` },
    '.',
  ];
  const subs = Object.entries(d.sub_scores ?? {}).filter((e): e is [string, number] => isNum(e[1]));
  if (subs.length > 1) {
    const [k, v] = subs.slice().sort((a, b) => a[1] - b[1])[0]!;
    parts.push(' Weakest area: ', { b: k.replace(/_/g, ' ') }, ` (${Math.round(v)}).`);
  }
  return line('p3', parts);
}

function clashLine(d: Phase4Data | undefined): PhaseLine {
  const clashes = d?.clashes ?? [];
  if (!clashes.length) return line('p4', ['No significant frequency clashes.'], 'done');
  const c = clashes[0]!;
  const where = [c.stems, c.frequency_range].filter(Boolean).join(' around ');
  return line(
    'p4',
    [
      'I found ',
      { b: `${clashes.length} frequency clash${clashes.length === 1 ? '' : 'es'}` },
      where ? ` — the biggest: ${where}.` : '.',
    ],
    'warn',
  );
}

function percentileLine(d: Phase6Data | undefined, genre: string | undefined): PhaseLine | null {
  if (!d || !isNum(d.percentile)) return null;
  return line('p6', [
    'That puts you in the ',
    { b: `${ordinal(d.percentile)} percentile` },
    ` against pro ${d.genre ?? genre ?? ''} tracks.`.replace('  ', ' '),
  ]);
}

function arrangementLine(d: Phase7Data | undefined): PhaseLine | null {
  if (!d) return null;
  if (d.arrangement_status === 'pending') {
    return line('p7:pending', ['Structure detection runs in the background — the arrangement fills in when it lands.']);
  }
  if (d.arrangement_status === 'unavailable' || d.arrangement_status === 'failed') {
    return line('p7:settled', ['I couldn’t detect a clear structure, so the arrangement isn’t graded.']);
  }
  if (!d.grade) return null;
  return line('p7:settled', [
    'Arrangement: grade ',
    { b: d.grade },
    d.section_count ? ` across ${d.section_count} sections.` : '.',
  ]);
}

function translationLine(d: Phase9Data | undefined): PhaseLine | null {
  const mono = d?.surround?.mono_compatibility;
  const spk = d?.playback?.speaker_score;
  const hp = d?.playback?.headphone_score;
  const bits: LinePart[] = [];
  const add = (label: string, v: unknown) => {
    if (!isNum(v)) return;
    if (bits.length) bits.push(', ');
    bits.push(`${label} `, { b: String(Math.round(v)) });
  };
  add('mono', mono);
  add('speakers', spk);
  add('headphones', hp);
  if (!bits.length) return null;
  const parts: LinePart[] = ['Translation check — ', ...bits, '.'];
  const weakBass = d?.playback?.bass_translation === 'weak';
  if (weakBass) parts.push(' Bass translation is ', { b: 'weak' }, ' on small speakers.');
  return line('p9', parts, (isNum(mono) && mono < 50) || weakBass ? 'warn' : 'info');
}

function alsLine(d: Phase8Data | undefined): PhaseLine | null {
  if (!d || !isNum(d.health_score)) return null;
  return line('p8', [
    'Your Ableton project: health ',
    { b: `${Math.round(d.health_score)}/100` },
    isNum(d.total_devices) ? ` across ${d.total_devices} devices.` : '.',
  ]);
}

/** Lines for every phase result present in `fj` (+ phase 1's early values),
 *  in pipeline run order. Failed phases get a short "carrying on" line. */
export function phaseLines(fj: FinalJson, p1: Phase1Data | undefined): PhaseLine[] {
  const out: PhaseLine[] = [...phase1Lines(p1)];
  const genre = phaseOf<Phase2Data>(fj, 2)?.data?.genre;
  for (const n of [1, 2, 3, 4, 5, 6, 7, 9, 8]) {
    const p = phaseOf<unknown>(fj, n);
    if (!p) continue;
    if (p.status === 'failed') {
      out.push(line(`fail:${n}`, [{ b: PHASE_SHORT[n] ?? `Phase ${n}` }, ' didn’t finish — I’ll carry on with the rest.'], 'warn'));
      continue;
    }
    if (p.status === 'skipped') continue;
    let l: PhaseLine | null = null;
    if (n === 2) l = genreLine(p.data as Phase2Data);
    else if (n === 3) l = scoreLine(p.data as Phase3Data, genre);
    else if (n === 4) l = clashLine(p.data as Phase4Data);
    else if (n === 5 && (p.data as { status?: string } | undefined)?.status !== 'skipped') {
      l = line('p5', ['Lined up against your reference track — the deltas are in the report.']);
    } else if (n === 6) l = percentileLine(p.data as Phase6Data, genre);
    else if (n === 7) l = arrangementLine(p.data as Phase7Data);
    else if (n === 9) l = translationLine(p.data as Phase9Data);
    else if (n === 8) l = alsLine(p.data as Phase8Data);
    if (l) out.push(l);
  }
  return out;
}
