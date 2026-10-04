import type { EqBand } from '../landing/eq-response';

/* Copy + sample-report excerpts for the public /features page.
 *
 * Copy rules (same as the landing list): the product helps you FIX a mix — no
 * score/grade is ever the payoff; the Coach reads measurements (never
 * "hears"); no arrangement/structure promise; no tier claims for stems/.als;
 * other mix checkers are never named.
 *
 * The excerpts are hand-copied from the generated sample report (NOT an
 * import of the 40 kB fixture — this page is a public entry point).
 * features-page.test.tsx asserts every value still matches sample-data.ts. */

export interface VignetteFix {
  headline: string;
  device: string;
  /** Short gloss of the dsp_chain for the toggle row. */
  does: string;
  bands: readonly EqBand[];
}

/** "Hear it": three of the sample report's EQ fixes, each switchable. */
export const HEAR_FIXES: readonly VignetteFix[] = [
  {
    headline: 'Excessive sub-bass will overwhelm small speakers',
    device: 'EQ Eight',
    does: 'HP 35 Hz · −2 dB @ 50 Hz',
    bands: [
      { n: 1, type: 'high_pass', freqHz: 35, slopeDb: 24 },
      { n: 2, type: 'bell', freqHz: 50, gainDb: -2, q: 1.2 },
    ],
  },
  {
    headline: 'Bass band overpowering mid frequencies',
    device: 'EQ Eight',
    does: '−4 dB @ 100 Hz · −3 dB @ 150 Hz · −2 dB @ 200 Hz',
    bands: [
      { n: 3, type: 'bell', freqHz: 100, gainDb: -4, q: 1 },
      { n: 4, type: 'bell', freqHz: 150, gainDb: -3, q: 1.2 },
      { n: 5, type: 'bell', freqHz: 200, gainDb: -2, q: 1 },
    ],
  },
  {
    headline: 'Missing air and sparkle (6-20kHz band very low)',
    device: 'EQ Eight',
    does: 'High shelf +3 dB @ 10 kHz · +2 dB @ 12 kHz',
    bands: [
      { n: 6, type: 'high_shelf', freqHz: 10000, gainDb: 3, q: 0.7 },
      { n: 7, type: 'bell', freqHz: 12000, gainDb: 2, q: 1 },
    ],
  },
];

/** "Exact fix": a second device from the same report, so it is clear a fix is
 *  not always an EQ move. The clipping finding's limiter, verbatim. */
export const LIMITER_FIX = {
  finding: 'Master output clipping detected — 92 hard-clipped samples',
  device: 'Limiter',
  target: 'Master',
  params: [
    { label: 'Ceiling', value: '−1 dB' },
    { label: 'Threshold', value: '−3 dB' },
    { label: 'Release', value: '100 ms' },
    { label: 'Lookahead', value: '5 ms' },
  ],
  outcome: 'Clipping will be eliminated, true peak will stay below -1.0 dBTP for streaming compliance.',
} as const;

/** "Evidence": the sub-bass finding's two measured rows + its plain-language why. */
/** The sub-bass finding's fix as the report's fix detail shows it: raw op
 *  names and parameter keys, straight from the verdict's dsp_chain. */
export const FIX_DETAIL = {
  severity: 'moderate',
  category: 'Playback',
  headline: 'Excessive sub-bass will overwhelm small speakers',
  ops: [
    { type: 'high_pass', params: [['q', '0.707'], ['slope_db', '24'], ['frequency_hz', '35']] },
    { type: 'peaking_eq', params: [['q', '1.2'], ['gain_db', '-2'], ['frequency_hz', '50']] },
  ],
} as const;

export const EVIDENCE_FINDING = {
  raisedBy: 'Loudness',
  confidencePct: 85,
  priority: 70,
  rows: [
    { label: 'Energy below 30 Hz', value: 24.9, unit: '%', range: [5, 15], scale: [0, 30] },
    { label: 'Sub-bass band level', value: -20.0, unit: ' dB', range: [-30, -24], scale: [-36, -12] },
  ],
  why: 'Most listeners hear your track on phones/laptops. Excessive sub-bass causes speaker distortion and muddy low-end translation, making the mix sound unprofessional.',
} as const;

/** "Learn": a made-up stems example (the sample track has no stems, so this
 *  vignette is tagged "illustration"). Modelled on a real stem-clash finding:
 *  the pair of stems, the band, and the overlap severity (0-1) with its tier.
 *  `terms` are the product's own glossary entries (results/glossary-terms.ts). */
export const LEARN_FINDING = {
  severity: 'severe',
  category: 'Frequency Collisions',
  headline: 'Kick and Bass are crowding 60–120 Hz',
  stems: ['Kick', 'Bass'],
  band: [60, 120],
  overlap: 0.82,
  tier: 'critical',
  why: 'When the kick and the bass both peak in the same band, each hides the other: the kick loses its punch and the bass note loses its definition. Turning either one up does not fix it — one of them has to make room.',
  fix: 'Sidechain the Bass to the Kick',
  fixWhy: 'Ducking the bass a few dB for the instant each kick hits gives the kick the band to itself, then hands it straight back. It also frees headroom, so the low end hits harder without getting louder.',
  terms: ['sidechain', 'headroom'],
} as const;

export const COACH_MODES = ['Concise', 'Normal', 'Teach'] as const;

export interface LeadFeature {
  id: 'hear' | 'fix' | 'evidence' | 'learn' | 'reference' | 'coach' | 'team' | 'mix' | 'plan' | 'library' | 'deeper' | 'analysis';
  /** false = made-up example values (tagged "illustration", not "sample report"). */
  sample?: false;
  kicker: string;
  head: string;
  body: string;
  points: readonly string[];
  note?: string;
}

export const FEATURES: readonly LeadFeature[] = [
  {
    id: 'hear',
    kicker: 'Hear it',
    head: 'Hear every fix on your own track',
    body: 'Every fix SPECTR suggests can be switched on in the browser and heard on your own audio — one at a time, or stacked. Flip Bypass to compare with the original, adjust any setting, and only take the moves you like back to your project.',
    points: [
      'Toggle each fix live — no export, no plugin, no DAW',
      'Stack fixes into one chain and save it as a preset',
      'A/B against your original with one switch',
    ],
    note: 'Try the switches. The Listen rack itself needs a desktop-width screen.',
  },
  {
    id: 'fix',
    kicker: 'The fix',
    head: 'An exact fix for every problem',
    body: 'Not “tame the low end”. A specific move: which processor, which frequency, how much, and where it goes — in priority order, so you know where to start.',
    points: [
      'Real values: frequency, gain, Q, ceiling, release',
      'Each fix says what you should hear when it works',
      'Ranked into a plan, not left as a list',
    ],
  },
  {
    id: 'evidence',
    kicker: 'The finding',
    head: 'Evidence behind every finding',
    body: 'Each finding shows the measurement it is based on next to the range expected for your genre, and explains why it matters. Every number a finding cites is checked against your analysis before you see it.',
    points: [
      'Your value next to the expected range',
      'Why it matters, in plain language',
      'Checks that agree are shown together',
    ],
  },
  {
    id: 'learn',
    sample: false,
    kicker: 'Learn',
    head: 'Learn why — not just what to change',
    body: 'SPECTR explains itself. Every finding says why it is a problem for the listener, every fix says what it should change and what to listen for, and mix jargon is defined right where it appears. Put the Coach in Teach mode and it walks you through the reasoning — so your next mix starts in a better place.',
    points: [
      'Why it matters, on every finding',
      'Why this fix: the result to expect and what to listen for',
      'Plain-language definitions on mix terms',
      'Teach mode: the Coach explains the reasoning step by step',
    ],
    note: 'Tap a term to see its definition.',
  },
  {
    id: 'deeper',
    sample: false,
    kicker: 'Your project',
    head: 'Upload your stems and project — SPECTR learns your session',
    body: 'The mix file alone is enough to start. Add your stems and your Ableton project and SPECTR stops guessing: it sorts the stems into roles by listening to them, reads your tracks, devices and tempo from the project, and then names the exact stems that collide and addresses every fix to your own tracks.',
    points: [
      'Stems: drop up to 100 WAV or FLAC files — roles are detected for you',
      'Ableton project (.als): fixes named to your own tracks and devices',
      'Per-stem balance, stereo width and clashes, stem by stem',
    ],
    note: 'Switch between the upload and what each input unlocks.',
  },
  {
    id: 'reference',
    sample: false,
    kicker: 'Reference',
    head: 'Use your own reference tracks as the target',
    body: 'Upload a finished track you love and SPECTR measures it exactly the way it measures your mix, then shows how far apart the two are — loudness, stereo and band by band. A genre average only tells you what is typical. A reference tells you how close you are to the sound you are actually chasing.',
    points: [
      'Your target is a real track you chose — so it fits any style, not just the common ones',
      'Compared on the same measurements: loudness, stereo and seven frequency bands',
      'Keep a reference library and reuse it across songs and versions',
      'Add stems as well and the comparison goes stem by stem',
    ],
  },
  {
    id: 'coach',
    kicker: 'The Coach',
    head: 'A Coach that knows your mix',
    body: 'Ask anything in plain language. The Coach has your whole report in front of it and answers from your measurements — with the numbers it relied on linked, so you can check them.',
    points: [
      'Concise, Normal or Teach — you choose the depth',
      'Every answer cites your own measurements',
      'Ask about any finding straight from the report',
    ],
    note: 'A real exchange from the sample report’s coach conversation.',
  },
  {
    id: 'team',
    kicker: 'Specialists',
    head: 'A team of specialists, not one verdict',
    body: 'More than 20 specialist roles look at your track — low end, clarity, dynamics, stereo field and more. SPECTR picks the ones your track needs and runs them for you; call in any of the others whenever you want a second opinion.',
    points: [
      'Triage chooses the right specialists for this track',
      'Their findings land in the same list, with the same evidence',
      'Run more on demand',
    ],
  },
  {
    id: 'mix',
    kicker: 'Coach Mix',
    head: 'Coach Mix: your fixes as one chain',
    body: 'Pick the fixes you want and the Coach merges them into a single gain-staged chain — within do-no-harm limits, and with a reason for every device. Then audition the whole thing at once in the Listen rack.',
    points: [
      'Overlapping moves are merged, not stacked blindly',
      'Each device says why it is there',
      'It also tells you what it left out, and why',
    ],
  },
  {
    id: 'plan',
    kicker: 'DAW Plan',
    head: 'A plan to take back to your DAW',
    body: 'You finish with a checklist, not a list of complaints: the fixes you chose, in signal-chain order, with the exact settings for each device. Export it as Markdown or plain text and tick each move off as you make it.',
    points: [
      'Laid out move by move, or grouped per device',
      'Only the fixes you selected',
      'Markdown or plain text',
    ],
    note: 'Tick a box.',
  },
  {
    id: 'library',
    sample: false,
    kicker: 'Library',
    head: 'Library and version tracking',
    body: 'Keep every song and every bounce in one place. Load two versions onto two decks and switch between them, see what changed, and record your own verdict on whether it is actually better.',
    points: [
      'A/B any two versions by ear',
      'What changed: loudness, dynamics, bass, highs, stereo width',
      'Your own rating and notes on every version',
      'Tags, sorting, archive and timestamped notes',
    ],
  },
  {
    id: 'analysis',
    kicker: 'Track analysis',
    head: 'A full track analysis underneath',
    body: 'Everything above stands on measurement: loudness and true peak, dynamics, tonal balance, stereo and mono compatibility, frequency clashes, and how the mix translates to headphones, speakers and mono.',
    points: [
      'Tonal balance across seven bands',
      'Translation to headphones, speakers and mono',
      'Mix terms explained where they appear',
    ],
  },
];

export const TRUST_POINTS: readonly { head: string; body: string; href: string; link: string }[] = [
  {
    head: 'Try it with no account',
    body: 'Your first analysis needs no signup — or open the demo and explore a finished report.',
    href: '/demo',
    link: 'Explore the demo',
  },
  {
    head: 'Your audio never trains a model',
    body: 'Raw audio is never sent to any LLM. The AI steps receive only derived text from your report.',
    href: '/trust/no-training',
    link: 'Read the pledge',
  },
  {
    head: 'Your reports stay yours',
    body: 'Every report you generate stays accessible. Export everything or delete your account at any time.',
    href: '/trust/results-forever',
    link: 'How retention works',
  },
];
