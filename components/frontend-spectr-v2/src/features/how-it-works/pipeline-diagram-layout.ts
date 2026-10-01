// Hand-placed coordinates for the hero pipeline diagram — a wide
// left-to-right layout (desktop) and a narrow top-to-bottom one (phones).
// Every node is something the code does today; the comment on each block
// names the code behind it (same sources as pipeline.ts).
import type { BoxSpec, EdgeSpec, TextSpec, Tone } from './diagram-kit';

export interface Layout {
  width: number;
  height: number;
  stages: readonly TextSpec[];
  boxes: readonly BoxSpec[];
  edges: readonly EdgeSpec[];
  /** The "audio stops here" line: wide = vertical at x, narrow = horizontal at y. */
  boundary: { orient: 'v' | 'h'; at: number; from: number; to: number; labelAt: number };
  notes: readonly TextSpec[];
}

interface Module {
  id: string;
  title: string;
  wide: string;
  narrow: string;
  narrowTitle?: string;
  optional?: boolean;
}

// analysis/src/audio_analysis/phases: phase1_universal (loudness, LRA, true
// peak, clipping, 7 bands, crest factor, transients, stereo width /
// correlation / mono compatibility, BPM, key), phase2_genre (detection),
// phase3_genre_specific (per-genre rubric), phase6_gap (profile from pro
// references), phase4_stems (spectral clash; per-stem with stems),
// phase9_translation, phase5_reference (optional), phase8_als (optional).
// Structure/arrangement detection is deliberately absent — it doesn't run
// in production.
const MODULES: readonly Module[] = [
  { id: 'm-loudness', title: 'Loudness & peaks', wide: 'LUFS · LRA · true peak · clips', narrow: 'LUFS · true peak' },
  { id: 'm-tonal', title: 'Tonal balance', wide: '7 bands, sub-bass → air', narrow: '7 bands, sub → air' },
  { id: 'm-dynamics', title: 'Dynamics', wide: 'crest factor · transients', narrow: 'crest · transients' },
  { id: 'm-stereo', title: 'Stereo & mono', wide: 'width · correlation · mono', narrow: 'width · correlation' },
  { id: 'm-tempo', title: 'Tempo & key', wide: 'BPM · musical key', narrow: 'BPM · key' },
  { id: 'm-genre', title: 'Genre detection', wide: 'from tempo + spectrum', narrow: 'tempo + spectrum' },
  { id: 'm-score', title: 'Genre scoring', wide: "the genre's own rubric", narrow: "the genre's rubric" },
  { id: 'm-gap', title: 'Gap vs genre', wide: 'profile of pro references', narrow: 'vs pro references' },
  { id: 'm-clash', title: 'Frequency clash', wide: 'competing ranges · stems', narrow: 'competing ranges' },
  { id: 'm-translation', title: 'Translation', wide: 'headphones · speakers · mono', narrow: 'headphones · speakers' },
  { id: 'm-reference', title: 'Reference compare', narrowTitle: 'Reference', wide: 'metric by metric · optional', narrow: 'metric by metric', optional: true },
  { id: 'm-als', title: 'Ableton project', wide: 'tracks · devices · MIDI', narrow: 'tracks · devices · MIDI', optional: true },
];

// worker/app/verdict_lib/prompt_loader.py SLUG_TO_FILENAME (26 roles);
// labels from results/helpers/specialists.ts. The six shown are the
// mix-level ones; the rest run on demand.
const SPECIALISTS = ['Low End', 'Frequency Balance', 'Dynamics', 'Stereo Phase', 'Loudness', 'Clarity'] as const;
export const SPECIALIST_TOTAL = 26;

const RULE_LINES = ['deterministic, no AI', 'genre-relative thresholds', 'related problems merged', "skips data it doesn't have"];
const VALIDATOR_LINES = [
  'every cited value',
  'must match the',
  'measurement ±10%',
  '',
  'fix settings must',
  'be in valid range',
  '',
  'priority set by a',
  'fixed formula —',
  "AI can't inflate",
  'its own severity',
];

const box = (b: Omit<BoxSpec, 'tone'> & { tone?: Tone }, tone: Tone): BoxSpec => ({ ...b, tone: b.tone ?? tone });

// ── wide (desktop) ───────────────────────────────────────────────────────
function wide(): Layout {
  const MX = 292;
  const MW = 204;
  const row = (i: number) => 36 + i * 42;
  const mid = (i: number) => row(i) + 18;
  const last = MODULES.length - 1;
  const boxes: BoxSpec[] = [
    box({ id: 'in-mix', x: 0, y: 166, w: 124, h: 48, title: 'Your mix', lines: ['WAV · FLAC · MP3'] }, 'neutral'),
    box({ id: 'in-stems', x: 0, y: 224, w: 124, h: 38, title: 'Stems', lines: ['optional'], optional: true }, 'neutral'),
    box({ id: 'in-ref', x: 0, y: 272, w: 124, h: 38, title: 'Reference', lines: ['optional'], optional: true }, 'neutral'),
    box({ id: 'in-als', x: 0, y: row(last), w: 124, h: 36, title: 'Ableton .als', lines: ['optional'], optional: true }, 'neutral'),
    box({ id: 'convert', x: 152, y: 206, w: 112, h: 64, title: 'Convert', lines: ['to 44.1 kHz WAV', 'one yardstick', 'for every file'] }, 'cyan'),
    ...MODULES.map((m, i) =>
      box({ id: m.id, x: MX, y: row(i), w: MW, h: 36, title: m.title, lines: [m.wide], optional: m.optional }, 'cyan'),
    ),
    box({ id: 'rules', x: 540, y: 52, w: 200, h: 104, title: 'Rule engine', lines: RULE_LINES }, 'blue'),
    box({ id: 'triage', x: 540, y: 196, w: 200, h: 60, title: 'AI triage', lines: ['picks the specialists', '+ a focus for each'] }, 'violet'),
    box({ id: 'spec-group', x: 540, y: 288, w: 200, h: 246, title: 'AI specialists', variant: 'group' }, 'violet'),
    ...SPECIALISTS.map((name, j) =>
      box({ id: `spec-${j}`, x: 556, y: 314 + j * 30, w: 168, h: 24, title: name, variant: 'pill' }, 'violet'),
    ),
    box({ id: 'validator', x: 772, y: 166, w: 128, h: 250, title: 'Validator', lines: VALIDATOR_LINES }, 'yellow'),
    box({ id: 'plan', x: 926, y: 166, w: 122, h: 76, title: 'Your plan', lines: ['findings + fixes', 'in priority order', 'exact settings'] }, 'green'),
    box({ id: 'listen', x: 926, y: 280, w: 122, h: 60, title: 'Listen rack', lines: ['hear fixes on', 'your track · A/B'] }, 'orange'),
    box({ id: 'coach', x: 926, y: 372, w: 122, h: 60, title: 'Coach', lines: ['answers from', 'your report'] }, 'violet'),
  ];
  const edges: EdgeSpec[] = [
    // inputs -> convert (bus at x=138)
    ...[190, 243, 291].map((y): EdgeSpec => ({ pts: [[124, y], [138, y]], bare: true })),
    { pts: [[138, 190], [138, 291]], bare: true },
    { pts: [[138, 238], [152, 238]] },
    // convert -> every audio module (bus at x=278); the .als goes straight
    // to the project parser — it is never converted.
    { pts: [[264, 238], [278, 238]], bare: true },
    { pts: [[278, mid(0)], [278, mid(last - 1)]], bare: true },
    ...MODULES.slice(0, last).map((_, i): EdgeSpec => ({ pts: [[278, mid(i)], [MX, mid(i)]] })),
    { pts: [[124, mid(last)], [MX, mid(last)]], dashed: true },
    // modules -> diagnosis (bus at x=506)
    ...MODULES.map((_, i): EdgeSpec => ({ pts: [[MX + MW, mid(i)], [506, mid(i)]], bare: true })),
    { pts: [[506, mid(0)], [506, mid(last)]], bare: true },
    { pts: [[506, 104], [540, 104]] },
    { pts: [[506, 226], [540, 226]] },
    { pts: [[640, 256], [640, 288]] },
    // triage also reads the rule engine's findings (triage_actor.py rule_rows).
    { pts: [[640, 156], [640, 196]] },
    // both lanes -> validator (bus at x=756)
    { pts: [[740, 104], [756, 104]], bare: true },
    { pts: [[740, 411], [756, 411]], bare: true },
    { pts: [[756, 104], [756, 411]], bare: true },
    { pts: [[756, 291], [772, 291]] },
    // validator -> plan -> listen / coach
    { pts: [[900, 204], [926, 204]] },
    { pts: [[987, 242], [987, 280]] },
    { pts: [[1048, 216], [1057, 216], [1057, 402], [1050, 402]] },
  ];
  return {
    width: 1060,
    height: 552,
    stages: [
      { x: 62, y: 14, text: 'INPUT' },
      { x: 208, y: 14, text: 'PREPARE' },
      { x: MX + MW / 2, y: 14, text: 'MEASURE' },
      { x: 640, y: 14, text: 'DIAGNOSE' },
      { x: 836, y: 14, text: 'VALIDATE' },
      { x: 987, y: 14, text: 'ACT' },
    ],
    boxes,
    edges,
    boundary: { orient: 'v', at: 523, from: 26, to: 540, labelAt: 400 },
    notes: [{ x: 640, y: 514, text: `+${SPECIALIST_TOTAL - SPECIALISTS.length} more, one click away` }],
  };
}

// ── narrow (phones) ──────────────────────────────────────────────────────
function narrow(): Layout {
  const COL = [8, 174] as const;
  const row = (r: number) => 234 + r * 44;
  const boxes: BoxSpec[] = [
    box({ id: 'in-group', x: 0, y: 18, w: 340, h: 112, title: 'Your files', variant: 'group' }, 'neutral'),
    box({ id: 'in-mix', x: 10, y: 42, w: 154, h: 36, title: 'Your mix', lines: ['WAV · FLAC · MP3'] }, 'neutral'),
    box({ id: 'in-stems', x: 176, y: 42, w: 154, h: 36, title: 'Stems', lines: ['optional'], optional: true }, 'neutral'),
    box({ id: 'in-ref', x: 10, y: 84, w: 154, h: 36, title: 'Reference', lines: ['optional'], optional: true }, 'neutral'),
    box({ id: 'in-als', x: 176, y: 84, w: 154, h: 36, title: 'Ableton .als', lines: ['optional'], optional: true }, 'neutral'),
    box({ id: 'convert', x: 0, y: 146, w: 340, h: 44, title: 'Convert', lines: ['every audio file → 44.1 kHz WAV'] }, 'cyan'),
    box({ id: 'm-group', x: 0, y: 208, w: 340, h: 294, title: 'Measurement', variant: 'group' }, 'cyan'),
    ...MODULES.map((m, i) =>
      box(
        { id: m.id, x: COL[i % 2], y: row(Math.floor(i / 2)), w: 158, h: 38, title: m.narrowTitle ?? m.title, lines: [m.narrow], optional: m.optional },
        'cyan',
      ),
    ),
    box({ id: 'rules', x: 0, y: 532, w: 166, h: 124, title: 'Rule engine', lines: ['deterministic, no AI', 'genre-relative', 'thresholds', 'related problems', 'merged', 'skips data it', "doesn't have"] }, 'blue'),
    box({ id: 'triage', x: 174, y: 532, w: 166, h: 52, title: 'AI triage', lines: ['picks specialists'] }, 'violet'),
    box({ id: 'spec-group', x: 174, y: 600, w: 166, h: 222, title: 'AI specialists', variant: 'group' }, 'violet'),
    ...SPECIALISTS.map((name, j) =>
      box({ id: `spec-${j}`, x: 184, y: 624 + j * 28, w: 146, h: 23, title: name, variant: 'pill' }, 'violet'),
    ),
    box({ id: 'validator', x: 0, y: 846, w: 340, h: 74, title: 'Validator', lines: ['cited values must match the measurement ±10%', 'fix settings must be in valid ranges', "fixed priority formula — AI can't inflate it"] }, 'yellow'),
    box({ id: 'plan', x: 0, y: 944, w: 340, h: 52, title: 'Your plan', lines: ['findings + exact fixes, in priority order'] }, 'green'),
    box({ id: 'listen', x: 0, y: 1020, w: 166, h: 52, title: 'Listen rack', lines: ['hear it · A/B'] }, 'orange'),
    box({ id: 'coach', x: 174, y: 1020, w: 166, h: 52, title: 'Coach', lines: ['answers from report'] }, 'violet'),
  ];
  const edges: EdgeSpec[] = [
    { pts: [[120, 130], [120, 146]], label: { x: 126, y: 142, text: 'audio' } },
    { pts: [[120, 190], [120, 208]] },
    // .als bypasses conversion, straight to the project parser.
    { pts: [[330, 102], [352, 102], [352, row(5) + 19], [334, row(5) + 19]], dashed: true },
    { pts: [[83, 502], [83, 532]] },
    { pts: [[257, 502], [257, 532]] },
    { pts: [[257, 584], [257, 600]] },
    { pts: [[166, 558], [174, 558]] },
    { pts: [[83, 656], [83, 846]] },
    { pts: [[257, 822], [257, 846]] },
    { pts: [[170, 920], [170, 944]] },
    { pts: [[83, 996], [83, 1020]] },
    { pts: [[257, 996], [257, 1020]] },
  ];
  return {
    width: 360,
    height: 1076,
    stages: [],
    boxes,
    edges,
    boundary: { orient: 'h', at: 517, from: 0, to: 360, labelAt: 180 },
    notes: [{ x: 257, y: 808, text: `+${SPECIALIST_TOTAL - SPECIALISTS.length} more on demand` }],
  };
}

export const WIDE_LAYOUT = wide();
export const NARROW_LAYOUT = narrow();
export const PIPELINE_SPECIALISTS = SPECIALISTS;

export const LEGEND: readonly { tone: Tone; label: string }[] = [
  { tone: 'cyan', label: 'Measurement (signal processing)' },
  { tone: 'blue', label: 'Deterministic rules' },
  { tone: 'violet', label: 'AI (LLM)' },
  { tone: 'yellow', label: 'Validation' },
  { tone: 'green', label: 'Your plan' },
  { tone: 'orange', label: 'In your browser' },
];
