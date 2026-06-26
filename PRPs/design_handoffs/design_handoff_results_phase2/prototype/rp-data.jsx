/* spectre — Results data. Synced to analysis-page-mock.json (grade-B trance track,
 * stems + .als uploaded, user reference profile attached).
 *
 * One Move = a prescription that references the Problem (finding) it fixes:
 *   { id, n, title(imperative), group, sev, kind, scope, problem{…},
 *     directive(precise), directional(shallow), steps[], why, evidence, meta }
 * A Move with kind:'win' is an observation only — no directive/steps. */

const RP_TRACK = {
  name: 'Halcyon',
  version: 'Mix · v3',
  // measured identity (phase 1 / phase 2) — supporting meta, not a score
  genre: 'Trance',
  genreConfidence: 0.88,
  bpm: 130,
  key: 'A#',
  keyConfidence: 0.81,        // <0.5 ⇒ qualify the badge as "uncertain"
  durationLabel: '6:12',
  coverHue: 196,
};

// severity tone map — contract severities → 4 accent tones + win
// critical|severe → red/orange · moderate → amber · minor → mint · win → green
const RP_SEV = {
  crit:   'var(--red)',
  severe: 'var(--orange)',
  warn:   'var(--orange)',   // moderate
  info:   'var(--accent)',   // minor
  low:    'var(--blue)',
  win:    'var(--green)',
};
const RP_SEV_LABEL = {
  crit: 'critical', severe: 'severe', warn: 'moderate', info: 'minor', low: 'minor', win: 'win',
};

const RP_MOVES = [
  {
    id: 'm1', n: 1, group: 'quick', sev: 'severe', kind: 'action',
    title: 'Pull the master peak under the ceiling',
    scope: 'Master bus',
    problem: { headline: 'True peak is grazing the ceiling', metric: 'phase1.true_peak_db', value: '\u22120.6 dBTP', source: 'rule engine' },
    directive: 'On the `Master bus`, set the limiter ceiling to `\u22121.0 dBTP` in `true-peak` mode with `2\u00d7 lookahead`. The goal is re-encode headroom, not more level.',
    directional: 'Your master peaks are nearly touching the ceiling. Pull the final limiter down until there\u2019s a sliver of headroom, then A/B it on the Listen page.',
    steps: [
      { where: 'Master \u00b7 Limiter ceiling', from: '\u22120.6 dBTP', to: '\u22121.0 dBTP' },
      { where: 'Limiter \u00b7 Detection', from: 'sample peak', to: 'true peak' },
    ],
    why: 'Lossy codecs (Spotify, YouTube) rebuild inter-sample peaks that can push \u22120.6 dBTP over 0 dBFS and clip on playback. A \u22121.0 dBTP ceiling keeps the re-encode clean with no audible pumping.',
    evidence: { type: 'meter', metric: 'phase1.true_peak_db', label: '\u22120.6 dBTP \u00b7 CEILING \u22121.0', value: -0.6, min: -6, max: 0, target: -1.0, targetLabel: 'ceiling \u22121.0' },
    confidence: 1.0, source: 'rule engine', impact: 5, effort: 1,
  },
  {
    id: 'm2', n: 2, group: 'quick', sev: 'warn', kind: 'action',
    title: 'Tame the 2\u20134 kHz bite on the lead',
    scope: 'Lead bus',
    problem: { headline: 'Lead is harsh in the 2\u20134 kHz region', metric: 'phase1.bands.upper_mid', value: '\u221226.8 dB', source: 'frequency balance' },
    directive: 'On the `Lead bus`, drop a `peaking EQ` at `3.1 kHz`, `\u22122 dB`, `Q 1.4` \u2014 just enough to unmask the vocal without dulling the lead.',
    directional: 'The lead is biting in the 2\u20134 kHz range and crowding the vocal. Ease that band back a touch and A/B against the vocal on the Listen page.',
    steps: [
      { where: 'Lead \u00b7 Peaking EQ', from: 'flat', to: '\u22122 dB @ 3.1 kHz' },
      { where: 'Band \u00b7 Q', from: '\u2014', to: '1.4' },
    ],
    why: '2\u20134 kHz is where ear-fatigue and vocal intelligibility live. A narrow \u22122 dB dip opens space for the vocal without making the lead sound dull.',
    evidence: { type: 'spectrum', metric: 'phase1.bands.upper_mid', label: '\u221226.8 dB \u00b7 RANGE \u221232\u2026\u221228', warnBands: [4] },
    confidence: 0.84, source: 'frequency balance', impact: 4, effort: 1,
  },
  {
    id: 'm3', n: 3, group: 'quick', sev: 'warn', kind: 'action',
    title: 'Trim the sub-bass build-up below 40 Hz',
    scope: 'Master bus',
    problem: { headline: 'Low-end build-up in the sub / bass region', metric: 'phase4.clashes', value: '20\u2013200 Hz', source: 'low-end specialist' },
    directive: 'On the `Master bus`, high-pass below `30 Hz` (`12 dB/oct`) and pull `\u22121.5 dB` around `38 Hz`. Clears inaudible rumble that\u2019s eating limiter headroom.',
    directional: 'Energy is piling up below the kick fundamental \u2014 it costs headroom without adding weight. Roll off the deep sub and re-check on the Listen page.',
    steps: [
      { where: 'Master \u00b7 High-pass', from: 'off', to: '30 Hz \u00b7 12 dB/oct' },
      { where: 'Master \u00b7 Bell', from: 'flat', to: '\u22121.5 dB @ 38 Hz' },
    ],
    why: 'Energy below ~35 Hz is mostly felt, not heard; on a hot master it just steals limiter headroom. Clearing it lets the kick and bass hit harder for the same loudness.',
    evidence: { type: 'none', metric: 'phase4.clashes', label: 'LOW-END BUILDUP \u00b7 20\u2013200 HZ \u00b7 MODERATE' },
    confidence: 0.80, source: 'low-end specialist', impact: 4, effort: 2,
  },
  {
    id: 'm4', n: 4, group: 'deep', sev: 'warn', kind: 'action',
    title: 'Deepen the breakdown-to-drop contrast',
    scope: 'Breakdown \u00b7 2:33\u20133:35',
    problem: { headline: 'Breakdown lacks contrast vs the drop', metric: 'phase7.metadata.energy_contrast_db', value: '4.1 dB', source: 'sections' },
    directive: 'Across the `breakdown` (`2:33\u20133:35`), high-pass the master `200 Hz` and duck `\u22123 dB`, then release it 2 bars before the drop. Aim for `6\u20138 dB` of contrast.',
    directional: 'Your breakdown only drops about 4 dB below the drop, so the second drop doesn\u2019t hit. Thin and quiet the breakdown more, then let it rebuild \u2014 try it on the Listen page.',
    steps: [
      { where: 'Breakdown \u00b7 High-pass', from: 'off', to: '200 Hz' },
      { where: 'Breakdown \u00b7 Level', from: '0 dB', to: '\u22123 dB' },
      { where: 'Contrast target', from: '4.1 dB', to: '6\u20138 dB' },
    ],
    why: 'Trance drops land in proportion to the dip before them. At 4.1 dB the ear never fully resets; 6\u20138 dB of contrast makes the re-entry punch.',
    evidence: { type: 'structure', metric: 'phase7.metadata.energy_contrast_db', label: '4.1 dB \u00b7 TARGET 6\u20139 dB' },
    confidence: 0.79, source: 'sections', impact: 4, effort: 4,
  },
  {
    id: 'm5', n: 5, group: 'win', sev: 'win', kind: 'win',
    title: 'Crest factor is healthy \u2014 protect it',
    scope: 'Master bus',
    problem: { headline: 'Healthy crest factor (11.2 dB)', metric: 'phase1.crest_factor', value: '11.2 dB', source: 'rule engine' },
    why: 'Crest factor 11.2 dB \u2014 punchy and dynamic, right in the 8\u201314 dB pocket. Don\u2019t over-limit chasing loudness; you\u2019d trade this away for nothing once streaming normalizes you back down.',
    evidence: { type: 'meter', metric: 'phase1.crest_factor', label: '11.2 dB \u00b7 HEALTHY 8\u201314', value: 11.2, min: 0, max: 22, target: 11.2, targetLabel: 'yours', zone: [8, 14] },
    confidence: 1.0, source: 'rule engine', impact: 0, effort: 0,
  },
];

// Recommended specialists for the "deepen your plan" zone (triage-routed, priced)
const RP_DEEPEN = [
  {
    id: 'd1', title: 'Trance arrangement deep-dive', sub: 'Your breakdown\u2019s weak \u2014 get bar-level energy + transition fixes.', credits: 2,
    result: {
      id: 'x1', n: 6, group: 'deep', sev: 'warn', kind: 'action', title: 'Add a 4-bar riser into the second drop',
      scope: 'Bar 145\u2013148',
      problem: { headline: 'Re-entry into Drop 2 is abrupt', metric: 'phase7.section_scores', value: 'drop \u00b7 80/100', source: 'arrangement \u00b7 deep' },
      directive: 'Before `Drop 2` (`bar 145\u2013148`), layer a `4-bar` noise riser (`HP 200\u21928k`), a reverse-cymbal swell, and a snare roll doubling in the last bar.',
      directional: 'The second drop arrives without a run-up. Build a short riser so the energy lifts into it instead of cutting in.',
      steps: [{ where: 'Bar 145\u2013148', from: 'hard cut', to: '4-bar riser' }, { where: 'Riser \u00b7 Filter', from: '\u2014', to: 'HP 200\u21928k' }],
      why: 'The deep arrangement pass scored Drop 2 at 80 vs Drop 1\u2019s 86 \u2014 the gap is the missing transition. A riser gives the listener a run-up so the drop pays off.',
      evidence: { type: 'structure', metric: 'phase7.section_scores', label: 'DROP 2 80 \u00b7 DROP 1 86 \u00b7 NO RISER' },
      confidence: 0.83, source: 'arrangement specialist \u00b7 deep', impact: 3, effort: 4,
    },
  },
  {
    id: 'd2', title: 'Stem clash map', sub: 'Kick and bass overlap 63% \u2014 get a per-band split.', credits: 1,
    result: {
      id: 'x2', n: 7, group: 'quick', sev: 'info', kind: 'action', title: 'Split the kick / bass overlap at 80 Hz',
      scope: 'Bass stem',
      problem: { headline: 'Kick and bass clash in the bass band', metric: 'phase4.stems.clash_matrix', value: '63% overlap', source: 'low-end \u00b7 deep' },
      directive: 'On the `Bass stem`, bell-cut `\u22122.5 dB at 80 Hz` (`Q 1.4`) and sidechain it `\u22124 dB` to the kick (`10 ms` attack). The kick owns the transient, the bass owns the sustain.',
      directional: 'The kick and bass are fighting in the low end. Give the kick the very bottom and duck the bass under each hit.',
      steps: [{ where: 'Bass \u00b7 Bell cut', from: 'flat', to: '\u22122.5 dB @ 80 Hz' }, { where: 'Bass \u00b7 Sidechain', from: 'off', to: '\u22124 dB \u00b7 kick' }],
      why: 'The stem clash map measured 63% spectral overlap between kick and bass in the bass band \u2014 enough to smear the low end. Splitting the band gives each its own lane.',
      evidence: { type: 'none', metric: 'phase4.stems.clash_matrix', label: 'KICK\u00d7BASS 63% \u00b7 BASS BAND \u00b7 WARNING' },
      confidence: 0.86, source: 'low-end specialist \u00b7 deep', impact: 3, effort: 2,
    },
  },
];

// ── AI specialists — the catalog. `ran` = called in this (deep) analysis;
// `why` explains the routing trigger, `result` what it produced. Others are
// available to run (priced); `needs` gates on uploaded inputs; `yields` links a
// run to the Move it would append (mirrors the Deepen results). ──────────────
const RP_SPECIALISTS = [
  { slug: 'rule_engine', label: 'Rule engine', group: 'Baseline', credits: 0, free: true, ran: true,
    why: 'Always runs — the deterministic guardrail on every analysis, independent of AI budget.',
    result: 'true-peak flag + healthy-crest win' },
  { slug: 'frequency_balance', label: 'Frequency balance', group: 'Spectrum', credits: 1, ran: true,
    why: 'Upper-mid (2\u20134 kHz) measured hot against your genre profile.',
    result: 'lead harshness \u2192 Move 2' },
  { slug: 'low_end', label: 'Low-end', group: 'Spectrum', credits: 1, ran: true,
    why: 'Sub / bass energy piled up below the kick fundamental.',
    result: 'sub build-up \u2192 Move 3' },
  { slug: 'sections', label: 'Arrangement', group: 'Sections', credits: 2, ran: true,
    why: 'Breakdown-to-drop energy contrast came in low (4.1 dB).',
    result: 'breakdown contrast \u2192 Move 4' },
  { slug: 'stem_balance', label: 'Stem balance', group: 'Stems', needs: 'stems', credits: 1, ran: true,
    why: 'Stems were uploaded \u2014 per-stem levels checked against role targets.',
    result: 'lead stem hot' },
  // ── available to run ──
  { slug: 'clarity', label: 'Clarity & masking', group: 'Spectrum', credits: 1, blurb: 'Spectral separation + masking between elements.' },
  { slug: 'dynamics', label: 'Dynamics & punch', group: 'Dynamics', credits: 1, blurb: 'Transient health, pumping, over-compression.' },
  { slug: 'loudness', label: 'Loudness targets', group: 'Loudness', credits: 1, blurb: 'Per-platform LUFS / true-peak with a master chain.' },
  { slug: 'stereo_field', label: 'Stereo field', group: 'Stereo', credits: 1, blurb: 'Width, correlation, per-band mono fold-down.' },
  { slug: 'surround', label: 'Surround / Atmos', group: 'Stereo', credits: 2, blurb: 'Phase, mono-compat and Atmos readiness.' },
  { slug: 'harmonic', label: 'Harmonic & key', group: 'Misc', credits: 1, blurb: 'Key confidence, off-scale notes, chord clashes.' },
  { slug: 'playback', label: 'Playback translation', group: 'Misc', credits: 1, blurb: 'How it holds up on phones, laptops, club rigs.' },
  { slug: 'transition', label: 'Transition design', group: 'Sections', credits: 2, yields: 'd1', blurb: 'Risers, fills and bar-level energy into the drops.' },
  { slug: 'kick_bass', label: 'Kick / bass clash', group: 'Stems', needs: 'stems', credits: 1, yields: 'd2', blurb: 'Per-band kick \u2194 bass collision map + split.' },
  { slug: 'device_chain', label: 'Device chain', group: 'Stems', needs: 'als', credits: 2, blurb: 'Plugin order + gain-staging from your .als.' },
  { slug: 'humanization', label: 'Humanization', group: 'Misc', needs: 'als', credits: 1, blurb: 'MIDI timing + velocity feel from your project.' },
];

/* ── Analysis tab — measured evidence (demoted) ─────────────────────────────
 * Numbers mirror analysis-page-mock.json finalJson.phases[]. */

// Phase 1 — 🆕 Dynamics / Punch (crest_factor + transients)
const RP_DYNAMICS = {
  crest: 11.2, crestZone: [8, 14], crestMin: 0, crestMax: 22,        // dB, peak − RMS
  transientStrength: 0.54,                                            // 0–1 onset-env mean
  transientCount: 612,
  transientsPerSec: 1.64,
  loudnessRange: 5.2,                                                 // LU (EBU R128 LRA)
};

// Phase 1 — 🆕 Loudness detail (streaming-readiness)
const RP_LOUD = {
  integrated: -9.5, shortTerm: -7.8, momentary: -6.9, range: 5.2, truePeak: -0.6,
  scaleMin: -20, scaleMax: -4,
  targets: [
    { name: 'Spotify', lufs: -14 },
    { name: 'Apple', lufs: -16 },
    { name: 'YouTube', lufs: -14 },
    { name: 'Club / DJ', lufs: -8 },
  ],
};

// Phase 1 — 🆕 Tone / Clarity (spectral centroid / contrast / flatness)
const RP_TONE = [
  { k: 'Brightness', metric: 'spectral_centroid_hz', val: 2410, unit: 'Hz', pct: 40, lo: 'dark', hi: 'bright', good: true },
  { k: 'Clarity', metric: 'spectral_contrast', val: 18.6, unit: 'dB', pct: 62, lo: 'muddy', hi: 'clear', good: true },
  { k: 'Tonality', metric: 'spectral_flatness', val: 0.07, unit: '', pct: 7, lo: 'tonal', hi: 'noisy', good: true },
];

// Phase 1 — bands (perceptual tonal balance, normalized to peak). Heights illustrative,
// internally consistent: upper-mid sits hot (harsh → Move 2).
const RP_FREQ = [
  { n: 'SUB', v: 0.47, med: 0.50, warn: false },
  { n: 'BASS', v: 0.58, med: 0.55, warn: false },
  { n: 'L.MID', v: 0.41, med: 0.45, warn: false },
  { n: 'MID', v: 0.49, med: 0.50, warn: false },
  { n: 'U.MID', v: 0.50, med: 0.37, warn: true },
  { n: 'PRES', v: 0.27, med: 0.31, warn: false },
  { n: 'AIR', v: 0.13, med: 0.17, warn: false },
];

// Phase 1 — stereo field
const RP_STEREO = [
  { nm: 'Width', val: '0.42', pct: 42, metric: 'stereo_width' },
  { nm: 'Correlation', val: '+0.78', pct: 89, metric: 'stereo_correlation' },
  { nm: 'Mono compat', val: '0.94', pct: 94, metric: 'mono_compatibility' },
];

// ── Fix Rack (Phase 2) — committed fixable Moves → a mastering RackChain.
// Byte-compatible with features/listen-rack/chain.ts { order, modules, masterBypass }.
// `modules` here carries presentation sugar (glyph/accent/settings) on top of the
// engine params; each setting cross-links the Move (and thus the Problem) it serves.
const RP_FIXRACK = {
  name: 'Fix rack \u2014 Halcyon',
  createdAt: 'Jun 26 \u00b7 from v3',
  masterBypass: false,
  order: ['eq', 'comp', 'limiter', 'trim'],
  modules: [
    {
      id: 'eq', label: 'EQ', sub: '8-band parametric', glyph: '\u224b', accent: 'var(--accent)', enabled: true, moves: [2, 3],
      settings: [
        { ctl: 'High-pass', val: '30 Hz \u00b7 12 dB/oct', move: 3 },
        { ctl: 'Bell', val: '\u22121.5 dB @ 38 Hz', move: 3 },
        { ctl: 'Bell', val: '\u22122.0 dB @ 3.1 kHz', move: 2 },
      ],
    },
    {
      id: 'comp', label: 'Glue comp', sub: 'Dynamics \u00b7 gentle', glyph: '\u25d0', accent: 'var(--yellow)', enabled: true, moves: [],
      settings: [
        { ctl: 'Ratio', val: '1.5 : 1', move: null },
        { ctl: 'Threshold', val: '\u221218 dB \u00b7 ~1 dB GR', move: null },
      ],
    },
    {
      id: 'limiter', label: 'Limiter', sub: 'True-peak brickwall', glyph: '\u25b0', accent: 'var(--red)', enabled: true, moves: [1],
      settings: [
        { ctl: 'Ceiling', val: '\u22121.0 dBTP', move: 1 },
        { ctl: 'Detection', val: 'true-peak \u00b7 2\u00d7 lookahead', move: 1 },
      ],
    },
    {
      id: 'trim', label: 'Output trim', sub: 'Chain make-up', glyph: '\u2393', accent: 'var(--green)', enabled: true, moves: [],
      settings: [{ ctl: 'Gain', val: '+0.4 dB', move: null }],
    },
  ],
  // change_log (why each module was set) — solver-computed, NOT surfaced day one.
  changeLog: [
    'High-passed 30 Hz and dipped 38 Hz to clear the sub build-up that was eating limiter headroom.',
    'Notched 3.1 kHz to unmask the vocal from the lead\u2019s upper-mid bite.',
    'Set the ceiling to \u22121.0 dBTP in true-peak mode so streaming re-encodes stay clean.',
  ],
  // leftover_advice — problems a master rack can't fix. Also follow-on (not day one).
  leftovers: [
    { headline: 'Breakdown lacks contrast', why: 'An arrangement edit, not a processing move \u2014 thin and duck the breakdown by hand.', move: 4 },
    { headline: 'Lead stem is running hot', why: 'A per-stem gain fix \u2014 a master rack can only touch the summed mix.', move: null },
  ],
};
// Empty result — when the solver finds no enabled modules (already-clean master).
const RP_FIXRACK_EMPTY = { name: 'Fix rack \u2014 Halcyon', reason: 'This master is already clean \u2014 nothing worth applying as a rack.' };


const RP_CLASHES = [
  { a: 'Kick', b: 'Bass', rng: 'bass \u00b7 20\u2013200 Hz', pct: 63, sev: 'warn', move: 3, fix: 'High-pass the master sub, trim 38 Hz.' },
  { a: 'Lead', b: 'Drums', rng: 'high-mid \u00b7 2\u20136 kHz', pct: 41, sev: 'info', move: 2, fix: '\u22122 dB @ 3.1 kHz on the lead.' },
];

// Phase 4 — per-stem (grouped). balance_flag → lead rms hot.
const RP_STEMS = [
  { role: 'Kick', lufs: -12.1, rms: -14.8, peak: -1.2, dr: 13.6, centroid: 980, width: 0.02, pan: 0.0, mono: true, flag: null },
  { role: 'Bass', lufs: -11.4, rms: -13.1, peak: -2.0, dr: 11.1, centroid: 320, width: 0.05, pan: 0.0, mono: true, flag: null },
  { role: 'Lead', lufs: -10.8, rms: -12.6, peak: -1.5, dr: 11.1, centroid: 3050, width: 0.61, pan: -0.05, mono: false, flag: 'rms hot' },
  { role: 'Drums', lufs: -13.9, rms: -16.2, peak: -3.1, dr: 13.1, centroid: 4200, width: 0.48, pan: 0.02, mono: false, flag: null },
];

// Phase 8 — .als project parse
const RP_ALS = {
  health: 76, version: '11.3.13', tempo: 130, timeSig: '4/4',
  totalDevices: 48, disabledDevices: 5, clutterPct: 10.4,
  midiNotes: 2840, audioClips: 6, chords: 14, quantIssues: 2, humanized: true,
  plugins: ['Serum', 'FabFilter Pro-Q 3', 'Valhalla VintageVerb', 'OTT'],
  tracks: [
    { name: 'Kick', type: 'audio', devices: 3, disabled: 0, muted: false },
    { name: 'Bass', type: 'midi', devices: 5, disabled: 1, muted: false },
    { name: 'Lead', type: 'midi', devices: 6, disabled: 2, muted: false },
  ],
  midiIssues: [
    { track: 'Pad', clip: 'Pad 3', type: 'duplicate', sev: 'minor', desc: 'Identical to Pad 2', fix: 'Consolidate or delete' },
  ],
};

// Phase 6 — reference profile comparison (gaps vs effective profile)
const RP_REFERENCE = {
  percentile: 72, genre: 'Trance',
  profileKind: 'user', profileName: 'Festival Trance', profileHue: 280, trackCount: 3,
  gaps: [
    { metric: 'LUFS', path: 'phase1.lufs', user: -9.5, mean: -8.2, range: [-10.5, -6.5], delta: -1.3, unit: '', desc: 'Slightly quieter than the genre norm', inRange: true },
    { metric: 'Crest factor', path: 'phase1.crest_factor', user: 11.2, mean: 9.0, range: [6.0, 12.0], delta: 2.2, unit: ' dB', desc: 'More dynamic than typical', inRange: true },
  ],
};

// Phase 7 — arrangement structure (section_scores)
const RP_STRUCTURE = [
  { t: 'intro', l: 'Intro', bars: 16, score: 88 },
  { t: 'build', l: 'Buildup', bars: 32, score: 84 },
  { t: 'drop', l: 'Drop', bars: 32, score: 86 },
  { t: 'break', l: 'Breakdown', bars: 32, score: 72, flag: true },
  { t: 'drop', l: 'Drop', bars: 64, score: 80 },
  { t: 'outro', l: 'Outro', bars: 18, score: 78, flag: true },
];
const RP_STRUCT_COLORS = {
  intro: 'rgba(255,255,255,.08)', build: 'rgba(94,234,212,.35)',
  drop: 'rgba(245,158,11,.55)', break: 'rgba(163,155,209,.5)', outro: 'rgba(255,255,255,.08)',
};
const RP_STRUCT_FLAGS = [
  'Breakdown sits only 4.1 dB under the drop \u2014 low contrast',
  'Outro is 18 bars \u2014 not an 8-bar multiple',
];

/* ── Files tab ──────────────────────────────────────────────────────────────
 * `present` is derived at render time from the inputDepth tweak; `tier` orders
 * mix < stems < als (als also lights the reference profile). */
const RP_INPUTS = [
  { id: 'mix', l: 'Primary mix', n: 'track.wav', meta: '38 MB \u00b7 48k/24 \u00b7 today', ic: '\u266a', tier: 0 },
  { id: 'stems', l: 'Stems', n: '4 stems \u00b7 kick, bass, lead, drums', metaOff: 'unlocks per-stem analysis', meta: 'grouped \u00b7 ok', ic: 'S', tier: 1 },
  { id: 'als', l: 'Ableton project', n: 'demo.als', metaOff: 'unlocks device-chain fixes', meta: '18 tracks \u00b7 Live 11.3.13', ic: 'A', tier: 2 },
  { id: 'ref', l: 'Reference profile', n: 'Festival Trance', metaOff: 'unlocks A/B vs your profile', meta: '3 tracks \u00b7 user profile', ic: 'R', tier: 2 },
];
const RP_VERSIONS = [
  { v: 1, l: 'rough bounce', date: 'Jun 9' },
  { v: 2, l: 'after EQ + sidechain', date: 'Jun 18' },
  { v: 3, l: 'pre-master', date: 'Jun 25', current: true },
];
const RP_EXPORTS = [
  { when: 'Jun 25', what: 'Game Plan v3', detail: '2 committed moves \u00b7 .md' },
  { when: 'Jun 18', what: 'Game Plan v2', detail: '4 committed moves \u00b7 .md' },
];

// Running-state phases (8 analysis phases + specialists; .als present)
const RP_PHASES = [
  { l: 'Audio decoded', d: '6:12 \u00b7 WAV 48k/24', s: 'done' },
  { l: 'Loudness & dynamics', d: '\u22129.5 LUFS \u00b7 11.2 dB crest', s: 'done' },
  { l: 'Frequency & tone', d: '7 bands \u00b7 centroid 2.4 kHz', s: 'done' },
  { l: 'Stereo & phase', d: 'corr +0.78 \u00b7 mono 0.94', s: 'done' },
  { l: 'Genre & scoring', d: 'Trance \u00b7 88%', s: 'done' },
  { l: 'Stems & clash', d: '4 stems \u00b7 2 clashes', s: 'run' },
  { l: 'Arrangement scan', d: '6 sections \u00b7 194 bars', s: 'wait' },
  { l: 'Project (.als) parse', d: '48 devices \u00b7 health 76', s: 'wait' },
  { l: 'AI specialists', d: 'building your plan\u2026', s: 'wait' },
];

// Coach seed conversation (grounded on this analysis)
const RP_COACH_SEED = [];
const RP_COACH_CHIPS = ['Why \u22121.0 dBTP?', 'What\u2019s biting at 3 kHz?', 'Is my breakdown weak?'];
const RP_COACH_INTRO = 'I\u2019ve read every metric on this mix, all four specialist verdicts, and how it stacks up against your Festival Trance profile. Ask what to fix first, what would push it over the line, or why a specialist flagged what it did.';
const RP_COACH_REPLY = 'Streaming normalizes everything down to about \u221214 LUFS, so at \u22129.5 you\u2019re not louder \u2014 you\u2019re just turned down on playback, with your true peak grazing the ceiling on the way there. Move #1 sets a \u22121.0 dBTP ceiling so the re-encode stays clean; your 11.2 dB crest is already healthy, so you won\u2019t lose punch.';

/* ── Problems (Tab 4) — the tracked verdict list (diagnoses).
 * Distinct from Actions (the Moves / prescriptions): each problem cross-links to
 * the Move that fixes it. Mirrors VerdictsListResponse; sorted by priorityScore. */
const RP_SEV_RANK = { crit: 0, severe: 1, warn: 2, info: 3, low: 4, win: 5 };

/* Each row is a VerdictDto carrying the live Problem-engine fields:
 *   problemId · kind(fault|observation|integrity) · source(rule_engine|llm_identifier)
 *   dataTier(audio_only|stems|project_midi) · fixable · suspected · where · refines
 * `specialist` is the human producer label (≠ the source enum); `fixMove` is the
 * cross-link into Actions. Children (refines set) nest under their parent. */
const RP_PROBLEMS = [
  {
    id: 'vrd_01', problemId: 'loudness.true_peak.0', kind: 'fault', source: 'rule_engine',
    sev: 'severe', category: 'loudness', specialist: 'rule engine', priority: 78, confidence: 1.0,
    dataTier: 'audio_only', fixable: true, suspected: false, where: null, refines: null,
    headline: 'True peak is grazing the ceiling',
    summary: 'True peak is \u22120.6 dBTP. Lossy codec re-encoding can push inter-sample peaks over 0 dBFS on streaming and clip.',
    why: 'Aim for \u2264 \u22121.0 dBTP so Spotify / YouTube re-encoding doesn\u2019t introduce distortion you can\u2019t hear in your DAW.',
    evidence: { metric: 'phase1.true_peak_db', value: '\u22120.6 dBTP', range: '\u22126.0 \u2026 \u22121.0' },
    fixMove: 1, state: 'open',
  },
  {
    id: 'vrd_02', problemId: 'frequency_balance.harsh_mid.0', kind: 'fault', source: 'rule_engine',
    sev: 'warn', category: 'frequency_balance', specialist: 'frequency balance', priority: 61, confidence: 0.84,
    dataTier: 'audio_only', fixable: true, suspected: false, where: null, refines: null,
    headline: 'Lead is harsh in the 2\u20134 kHz region',
    summary: 'Upper-mid energy on the lead bus is masking the vocal. A surgical cut opens the mix up.',
    why: '2\u20134 kHz is where ear-fatigue and vocal intelligibility live \u2014 a small dip buys a lot of clarity.',
    evidence: { metric: 'phase1.bands.upper_mid', value: '\u221226.8 dB', range: '\u221232.0 \u2026 \u221228.0' },
    fixMove: 2, state: 'open',
  },
  {
    id: 'sec_04', problemId: 'arrangement.weak_breakdown.0', kind: 'fault', source: 'rule_engine',
    sev: 'warn', category: 'section_contrast', specialist: 'sections', priority: 58, confidence: 0.79,
    dataTier: 'audio_only', fixable: true, suspected: false,
    where: { section_type: 'breakdown', start_seconds: 153, end_seconds: 215 }, refines: null,
    headline: 'Breakdown lacks contrast vs the drop',
    summary: 'The breakdown sits only 4.1 dB below the drop. Trance breakdowns usually drop 6\u20138 dB for impact.',
    why: 'Without a real dip, the second drop doesn\u2019t hit as hard \u2014 the ear never resets.',
    evidence: { metric: 'phase7.metadata.energy_contrast_db', value: '4.1 dB', range: '6.0 \u2026 9.0' },
    fixMove: 4, state: 'open',
  },
  {
    id: 'low_03', problemId: 'low_end.buildup.0', kind: 'fault', source: 'rule_engine',
    sev: 'warn', category: 'low_end', specialist: 'low-end specialist', priority: 55, confidence: 0.80,
    dataTier: 'audio_only', fixable: true, suspected: false, where: null, refines: null,
    headline: 'Low-end build-up in the sub / bass region',
    summary: 'Energy is piling up below the kick fundamental across 20\u2013200 Hz, costing limiter headroom without adding weight.',
    why: 'Sub rumble you can\u2019t hear still eats headroom \u2014 clearing it lets the kick and bass hit harder.',
    evidence: { metric: 'phase4.clashes', value: '20\u2013200 Hz', range: 'moderate' },
    fixMove: 3, state: 'open',
  },
  {
    // refined child of low_end.buildup.0 — nests beneath it, localized to the intro
    id: 'low_03a', problemId: 'low_end.sub_rumble.0', kind: 'fault', source: 'rule_engine',
    sev: 'info', category: 'low_end', specialist: 'low-end specialist', priority: 40, confidence: 0.74,
    dataTier: 'audio_only', fixable: false, suspected: false,
    where: { section_type: 'intro', start_seconds: 0, end_seconds: 32 }, refines: 'low_end.buildup.0',
    headline: 'Worst of it is the intro rumble',
    summary: 'The sub build-up concentrates in the first 32 s, before the kick enters \u2014 mostly DC-ish rumble.',
    why: 'Localizing it means the master high-pass clears this without thinning the drops.',
    evidence: { metric: 'phase4.clashes.intro', value: '\u22123.2 dB', range: 'sub band' },
    fixMove: 3, state: 'open',
  },
  {
    id: 'dyn_clip', problemId: 'dynamics.clipping.0', kind: 'fault', source: 'rule_engine',
    sev: 'warn', category: 'dynamics', specialist: 'rule engine', priority: 52, confidence: 0.46,
    dataTier: 'audio_only', fixable: true, suspected: true,
    where: { section_type: 'drop', start_seconds: 95, end_seconds: 110 }, refines: null,
    headline: 'Possible clipping on the first drop',
    summary: 'A short run of consecutive samples near 0 dBFS around 1:35 \u2014 right at the snare. Could be intentional saturation.',
    why: 'If it\u2019s real clipping it adds harsh odd harmonics; if it\u2019s your saturator, ignore it.',
    evidence: { metric: 'phase1.clip_runs', value: '3 runs', range: '> 0 flags' },
    fixMove: null, state: 'open',
  },
  {
    id: 'arr_front', problemId: 'arrangement.front_loaded.0', kind: 'observation', source: 'llm_identifier',
    sev: 'info', category: 'arrangement', specialist: 'arrangement (AI)', priority: 38, confidence: 0.68,
    dataTier: 'audio_only', fixable: false, suspected: false, where: null, refines: null,
    headline: 'Energy peaks early, tails off late',
    summary: 'The AI arrangement pass reads the back third as lower-energy than the genre norm \u2014 the second half may feel like a comedown.',
    why: 'Front-loaded energy can lose the dancefloor before the outro. Not a defect \u2014 a choice worth hearing.',
    evidence: { metric: 'phase7.energy_curve', value: 'skew \u22120.3', range: 'genre \u00b10.1' },
    fixMove: null, state: 'open',
  },
  {
    id: 'vrd_03', problemId: 'dynamics.healthy_crest.0', kind: 'observation', source: 'rule_engine',
    sev: 'win', category: 'dynamics', specialist: 'rule engine', priority: 34, confidence: 1.0,
    dataTier: 'audio_only', fixable: false, suspected: false, where: null, refines: null,
    headline: 'Healthy crest factor (11.2 dB)',
    summary: 'Crest factor 11.2 dB \u2014 punchy and dynamic, right in the 8\u201314 dB pocket. Don\u2019t over-limit chasing loudness.',
    why: 'Preserving transients keeps the kick and snare punchy after streaming normalization pulls you back down.',
    evidence: { metric: 'phase1.crest_factor', value: '11.2 dB', range: '8.0 \u2026 14.0' },
    fixMove: 5, state: 'observation',
  },
  // ── stems tier (visible once stems are uploaded) ──
  {
    id: 'bal_lead', problemId: 'gain_staging.stem_hot.0', kind: 'fault', source: 'rule_engine',
    sev: 'info', category: 'gain_staging', specialist: 'stem balance', priority: 42, confidence: 0.82,
    dataTier: 'stems', fixable: false, suspected: false, where: null, refines: null,
    headline: 'Lead stem is running hot',
    summary: 'Lead RMS is \u221212.6 dB \u2014 above the \u221216\u2026\u221213 dB pocket expected for its role.',
    why: 'A hot lead eats bus headroom and crowds the vocal even before any EQ.',
    evidence: { metric: 'phase4.stems.balance_flags', value: '\u221212.6 dB', range: '\u221216.0 \u2026 \u221213.0' },
    fixMove: null, state: 'open',
  },
  {
    id: 'int_sum', problemId: 'integrity.stem_sum_mismatch.0', kind: 'integrity', source: 'rule_engine',
    sev: 'warn', category: 'integrity', specialist: 'input check', priority: 50, confidence: 0.9,
    dataTier: 'stems', fixable: false, suspected: false, where: null, refines: null,
    headline: 'Stems don\u2019t sum to the master',
    summary: 'Summed stems land 2.1 dB under the uploaded mix \u2014 likely a missing FX-return or a bus you didn\u2019t export.',
    why: 'Per-stem numbers are only as trustworthy as the export. Worth re-bouncing before acting on stem fixes.',
    evidence: { metric: 'integrity.stem_sum_db', value: '\u22122.1 dB', range: '\u00b10.5 dB' },
    fixMove: null, state: 'open',
  },
  // ── project_midi tier (visible once the .als is uploaded) ──
  {
    id: 'prj_dup', problemId: 'project.duplicate_clip.0', kind: 'fault', source: 'rule_engine',
    sev: 'info', category: 'project_hygiene', specialist: 'project parse', priority: 36, confidence: 0.95,
    dataTier: 'project_midi', fixable: true, suspected: false, where: null, refines: null,
    headline: 'Duplicate clip: Pad 3 mirrors Pad 2',
    summary: 'Two identical pad clips play in unison \u2014 doubling level without widening, and bloating the project.',
    why: 'Consolidate or delete one. Free CPU and an honest gain stage.',
    evidence: { metric: 'phase8.midi.duplicate_clips', value: '1 pair', range: '0 expected' },
    fixMove: null, state: 'open',
  },
  {
    id: 'prj_dev', problemId: 'project.disabled_devices.0', kind: 'observation', source: 'rule_engine',
    sev: 'info', category: 'project_hygiene', specialist: 'project parse', priority: 30, confidence: 1.0,
    dataTier: 'project_midi', fixable: false, suspected: false, where: null, refines: null,
    headline: '5 disabled devices left in the project',
    summary: '10.4% device clutter \u2014 bypassed plugins still loaded across the lead and bass chains.',
    why: 'Harmless to the sound, but they cost load time and make the project harder to read.',
    evidence: { metric: 'phase8.disabled_devices', value: '5 / 48', range: 'fyi' },
    fixMove: null, state: 'observation',
  },
];

// kind → indicator tone + optional badge label
const RP_KIND = {
  fault: { label: null, tone: null, icon: 'alert' },
  observation: { label: 'FYI', tone: 'var(--muted)', icon: 'eye' },
  integrity: { label: 'Data', tone: 'var(--blue)', icon: 'layers' },
};
// dataTier → section meta. Ranked so a tier unlocks at/under the input depth.
const RP_TIERS = [
  { id: 'audio_only', label: 'From your mix', rank: 0, unlock: null },
  { id: 'stems', label: 'From your stems', rank: 1, unlock: 'Upload stems to surface per-stem problems.' },
  { id: 'project_midi', label: 'From your project', rank: 2, unlock: 'Drop your .als to surface project & MIDI problems.' },
];
const rpTierVisible = (tier, depth) => (RP_TIERS.find(t => t.id === tier)?.rank ?? 0) <= (RP_DEPTH_RANK[depth] ?? 2);
const rpFmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

// input-depth ordering: mix < stems < als (als also lights the reference profile)
const RP_DEPTH_RANK = { mix: 0, stems: 1, als: 2 };
const rpPresent = (tier, depth) => tier <= (RP_DEPTH_RANK[depth] ?? 2);

Object.assign(window, {
  RP_TRACK, RP_SEV, RP_SEV_LABEL, RP_SEV_RANK, RP_KIND, RP_TIERS, RP_MOVES, RP_PROBLEMS, RP_DEEPEN, RP_SPECIALISTS, RP_FIXRACK, RP_FIXRACK_EMPTY, RP_DEPTH_RANK, rpPresent, rpTierVisible, rpFmtTime,
  RP_DYNAMICS, RP_LOUD, RP_TONE, RP_FREQ, RP_STEREO, RP_CLASHES,
  RP_STEMS, RP_ALS, RP_REFERENCE, RP_STRUCTURE, RP_STRUCT_COLORS, RP_STRUCT_FLAGS,
  RP_INPUTS, RP_VERSIONS, RP_EXPORTS, RP_PHASES, RP_COACH_SEED, RP_COACH_CHIPS,
  RP_COACH_INTRO, RP_COACH_REPLY,
});
