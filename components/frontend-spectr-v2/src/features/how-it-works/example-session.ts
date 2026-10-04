// "Take it back to your DAW" example: a session where the producer uploaded
// stems and their Ableton project, so fixes are addressed to their own tracks
// — not only the master.
//
// MADE-UP VALUES. The demo track has no stems or project, so the per-track
// chains, the notes and the plan file below are an illustration (the page
// labels them "example"). The MASTER lane is separate and real: it is the demo
// track's Coach Mix chain from daw-chain.ts. The plan file is produced by the
// app's own DAW Plan export generator from these example moves, so its FORMAT
// is exactly what a user downloads.
import { DEFAULT_EXPORT_OPTS, generateGamePlan } from '../results/export-generator';
import type { Move } from '../results/move-model';

export interface ExampleDevice {
  /** The Ableton device to reach for. */
  daw: string;
  params: { label: string; value: string }[];
}

export interface ExampleTrack {
  /** The track's name in the producer's project. */
  track: string;
  /** The stem role SPECTR detected for it. */
  role: string;
  /** The finding these moves address. */
  finding: string;
  devices: ExampleDevice[];
  why: string;
}

export const EXAMPLE_SONG = { name: 'Night Drive', version: 'v2' } as const;

export const EXAMPLE_TRACKS: readonly ExampleTrack[] = [
  {
    track: 'Kick',
    role: 'kick',
    finding: 'Kick and Bass are crowding 60–120 Hz',
    devices: [
      {
        daw: 'EQ Eight',
        params: [
          { label: 'High-pass', value: '30 Hz · 24 dB/oct' },
          { label: 'Bell', value: '−3.0 dB @ 250 Hz · Q 1.40' },
        ],
      },
    ],
    why: 'Removes rumble below the kick’s fundamental and the boxy 250 Hz that was masking the bass.',
  },
  {
    track: 'Sub Bass',
    role: 'bass',
    finding: 'Kick and Bass are crowding 60–120 Hz',
    devices: [
      {
        daw: 'Compressor',
        params: [
          { label: 'Sidechain', value: 'from Kick' },
          { label: 'Ratio', value: '4:1' },
          { label: 'Attack', value: '5 ms' },
          { label: 'Release', value: '120 ms' },
        ],
      },
      {
        daw: 'EQ Eight',
        params: [{ label: 'Bell', value: '−3.0 dB @ 80 Hz · Q 1.40' }],
      },
    ],
    why: 'Ducks the bass for the instant each kick hits, and trims the note that sits on top of the kick’s fundamental.',
  },
  {
    track: 'Pad Chords',
    role: 'pad',
    finding: 'Pads are filling the low-mid and narrowing the mix',
    devices: [
      {
        daw: 'EQ Eight',
        params: [{ label: 'High-pass', value: '180 Hz · 12 dB/oct' }],
      },
      {
        daw: 'Utility',
        params: [{ label: 'Width', value: '130%' }],
      },
    ],
    why: 'Gets the pads out of the low-mid and spreads them wider, leaving the centre for the lead.',
  },
];

/** Things to fix that are not a device setting on one track. In the app these
 *  are findings with no one-click fix, added to the plan as notes. */
export const EXAMPLE_NOTES: readonly { title: string; note: string }[] = [
  {
    title: 'Check the mix in mono before you bounce',
    note: 'The pads lose level when the mix is summed to mono. After widening them, listen in mono and pull the width back if they disappear.',
  },
  {
    title: 'Bounce without your own master limiter',
    note: 'The plan’s limiter sets the ceiling. Leave a few dB of headroom on the master so it has room to work.',
  },
  {
    title: 'Re-balance the lead after the low-end changes',
    note: 'With the kick and bass no longer fighting, the lead will sit louder than before. Trim it by ear rather than by number.',
  },
];

function move(
  id: string,
  title: string,
  scope: string,
  directive: string,
  steps: Move['steps'],
  why: string,
): Move {
  return {
    id,
    title,
    group: 'quick',
    sev: 'warn',
    scope,
    directive,
    directional: directive,
    steps,
    hasParams: steps.length > 0,
    why,
    evidence: { type: 'none', metric: '', chartType: null },
    confidence: 0.85,
    impact: 70,
    source: 'example',
    isRule: false,
    specialist: null,
    status: 'committed',
    verdictId: null,
    ops: [],
  };
}

/** The same example as plan moves: track fixes, the master chain, then notes. */
export const EXAMPLE_MOVES: readonly Move[] = [
  move(
    'kick',
    'Clear the kick’s rumble and boxiness',
    'Kick',
    'High-pass the kick at 30 Hz and cut 3 dB at 250 Hz.',
    [
      { where: 'high_pass', detail: 'slope_db=24, frequency_hz=30' },
      { where: 'peaking_eq', detail: 'q=1.40, gain_db=-3, frequency_hz=250' },
    ],
    EXAMPLE_TRACKS[0]!.why,
  ),
  move(
    'bass',
    'Duck the bass under the kick',
    'Sub Bass',
    'Sidechain-compress the bass from the kick, then cut 3 dB at 80 Hz.',
    [
      { where: 'sidechain', detail: 'source=Kick, ratio=4, attack_ms=5, release_ms=120' },
      { where: 'peaking_eq', detail: 'q=1.40, gain_db=-3, frequency_hz=80' },
    ],
    EXAMPLE_TRACKS[1]!.why,
  ),
  move(
    'pads',
    'Lift the pads out of the low-mid and widen them',
    'Pad Chords',
    'High-pass the pads at 180 Hz and widen them to 130%.',
    [
      { where: 'high_pass', detail: 'slope_db=12, frequency_hz=180' },
      { where: 'stereo_width', detail: 'width_pct=130' },
    ],
    EXAMPLE_TRACKS[2]!.why,
  ),
  move(
    'master',
    'Set the master ceiling and loudness',
    'Master',
    'Cut 4 dB at 300 Hz, limit to −1 dB, then trim the output.',
    [
      { where: 'peaking_eq', detail: 'q=1.00, gain_db=-3.96, frequency_hz=300' },
      { where: 'limiter', detail: 'ceiling_db=-1, release_ms=100, lookahead_ms=2' },
      { where: 'gain', detail: 'gain_db=-5.13' },
    ],
    'Carves the low-mid mud, gives a release-ready ceiling and lands the loudness where it should be.',
  ),
  ...EXAMPLE_NOTES.map((n, i) => move(`note-${i}`, n.title, '', n.note, [], '')),
];

/** The Markdown file the example session exports — the real generator's
 *  output for EXAMPLE_MOVES, at "Detailed". */
export function buildExamplePlan(): { filename: string; content: string } {
  const moves = [...EXAMPLE_MOVES];
  const { filename, content } = generateGamePlan(
    {
      format: 'md',
      detail: 'detailed',
      order: 'order',
      opts: { ...DEFAULT_EXPORT_OPTS, facts: false, targets: false, data: false, perDevice: false },
      selectedIds: new Set(moves.map((m) => m.id)),
    },
    moves,
    { bpm: null, key: null, lufs: null, genre: null },
    { trackName: EXAMPLE_SONG.name, versionLabel: EXAMPLE_SONG.version },
  );
  return { filename, content: content.trimEnd() };
}
