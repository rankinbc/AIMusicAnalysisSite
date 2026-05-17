/* SPECTR — mock track + library data. Mirrors data shape from frontend-spectr. */

const FREQ_BANDS = [
  { n: 'SUB',   hz: '20–60',   v: 0.62, warn: false },
  { n: 'BASS',  hz: '60–250',  v: 0.88, warn: true  },
  { n: 'L.MID', hz: '250–500', v: 0.71, warn: false },
  { n: 'MID',   hz: '500–2k',  v: 0.64, warn: false },
  { n: 'H.MID', hz: '2k–4k',   v: 0.58, warn: false },
  { n: 'PRES',  hz: '4k–6k',   v: 0.52, warn: false },
  { n: 'BRIL',  hz: '6k–10k',  v: 0.46, warn: false },
  { n: 'AIR',   hz: '10k+',    v: 0.32, warn: true  },
];

const GENRE_MED_BANDS = [0.58, 0.74, 0.69, 0.67, 0.60, 0.55, 0.50, 0.42];

const STREAMING = [
  { p: 'Spotify',    target: -14, yours: -11.2 },
  { p: 'Apple Music', target: -16, yours: -11.2 },
  { p: 'YouTube',    target: -14, yours: -11.2 },
  { p: 'Tidal',      target: -14, yours: -11.2 },
  { p: 'SoundCloud', target: -8,  yours: -11.2 },
  { p: 'TikTok',     target: -10, yours: -11.2 },
];

const ARRANGEMENT_SECTIONS = [
  { t: 'intro',     l: 'Intro',      bars: 16, flag: false, start: 0,   end: 28 },
  { t: 'buildup',   l: 'Build A',    bars: 16, flag: false, start: 28,  end: 56 },
  { t: 'drop',      l: 'Drop A',     bars: 32, flag: false, start: 56,  end: 112 },
  { t: 'breakdown', l: 'Breakdown',  bars: 32, flag: true,  start: 112, end: 168 },
  { t: 'buildup',   l: 'Build B',    bars: 16, flag: false, start: 168, end: 196 },
  { t: 'drop',      l: 'Drop B',     bars: 32, flag: false, start: 196, end: 252 },
  { t: 'outro',     l: 'Outro',      bars: 16, flag: false, start: 252, end: 280 },
];

const FIXES = [
  {
    sev: 'critical',
    title: 'Too loud for streaming targets',
    metricLine: 'INTEGRATED -11.2 LUFS · SPOTIFY TARGET -14 LUFS · -2.8 LU OVER',
    badge: 'LOUDNESS',
    body: 'Master is 2.8 LU hotter than Spotify normalization. Streaming services will turn it down — squashing your dynamic range without giving you the loudness credit.',
    coachFix: 'Pull back the limiter by 2-3 dB. If you need the energy back, automate a 0.5 dB push only in the drops. -14 LUFS sounds louder than -11 LUFS if your transients survive.',
    chartType: 'lufs',
  },
  {
    sev: 'warning',
    title: 'Bass region masked by sub',
    metricLine: 'BASS BAND +0.14 OVER MEDIAN · OVERLAP WITH SUB 38%',
    badge: 'FREQUENCY',
    body: 'Your 60–250 Hz region is sitting 14% above the genre median while sub is healthy. The result is muddy low end — the kick lacks punch because bass is competing for the same air.',
    coachFix: 'Bell-cut bass guitar/synth by 2 dB at 120 Hz, Q 1.4. Sidechain the bass to the kick with a 60 ms release. The sub should breathe, the bass should swing.',
    chartType: 'frequency',
  },
  {
    sev: 'warning',
    title: 'Breakdown drops energy too fast',
    metricLine: 'SECTION 4 (BREAKDOWN, 32 BARS) · -8.1 LUFS DROP IN 4 BARS',
    badge: 'ARRANGEMENT',
    body: 'Energy drop from Drop A into Breakdown is abrupt — listeners on commercial playlists may skip here. Average pro release drops over 6-8 bars, not 4.',
    coachFix: 'Add a 4-bar transition with a long reverb tail or filtered noise sweep. Keep the kick under a high-pass that opens slowly. Bridge, don\'t cliff.',
    chartType: 'none',
  },
];

const STEM_CLASHES = [
  { a: 'Kick',  b: 'Bass',     range: '80–180 Hz',   pct: 38, sev: 'severe',   fix: 'Sidechain bass to kick with 60 ms release; notch bass at 120 Hz.' },
  { a: 'Lead',  b: 'Pad',      range: '1.5–3 kHz',   pct: 26, sev: 'moderate', fix: 'Bell-cut pad -3 dB at 2 kHz to make space for the lead.' },
  { a: 'Vocal', b: 'Cymbals',  range: '8–12 kHz',    pct: 22, sev: 'moderate', fix: 'High-shelf cut cymbals -2 dB above 8 kHz when vocal is present.' },
];

const GAP = [
  { n: 'Integrated LUFS',  userVal: -11.2, mean: -10.8, std: 1.4, acceptableRange: [-13, -8.5],  unit: ' LUFS', inRange: true,  sev: null,        pct: 58, delta: -0.4,  description: 'Comfortably in commercial range.' },
  { n: 'Bass Energy',      userVal: 0.88,  mean: 0.74,  std: 0.08, acceptableRange: [0.62, 0.86], unit: '',      inRange: false, sev: 'warning',   pct: 91, delta: 0.14,  description: 'Hotter bass than the median release.' },
  { n: 'High Energy (8k+)',userVal: 0.32,  mean: 0.46,  std: 0.07, acceptableRange: [0.36, 0.58], unit: '',      inRange: false, sev: 'warning',   pct: 12, delta: -0.14, description: 'Lacking air — mix sounds darker than reference.' },
  { n: 'Stereo Width',     userVal: 62,    mean: 58,    std: 12,   acceptableRange: [38, 82],     unit: '%',     inRange: true,  sev: null,        pct: 64, delta: 4,     description: 'Healthy spread for the genre.' },
  { n: 'Dynamic Range',    userVal: 5.4,   mean: 6.8,   std: 1.6,  acceptableRange: [4.5, 9.5],   unit: ' LU',   inRange: true,  sev: null,        pct: 32, delta: -1.4,  description: 'Slightly more squashed than typical.' },
  { n: 'Danceability',     userVal: 82,    mean: 74,    std: 9,    acceptableRange: [60, 90],     unit: '',      inRange: true,  sev: null,        pct: 78, delta: 8,     description: 'Strong rhythmic pulse — playlist-friendly.' },
  { n: 'BPM',              userVal: 128,   mean: 128,   std: 4,    acceptableRange: [125, 134],   unit: ' BPM',  inRange: true,  sev: null,        pct: 50, delta: 0,     description: 'Right in the genre pocket.' },
];

const SPECIALIST_GROUPS = [
  { id: 'low-end',     label: 'Low End',         items: [
    { slug: 'low_end',           label: 'Low End',           status: 'cached',   findings: 2 },
    { slug: 'stem_balance',      label: 'Stem Balance',      status: 'cached',   findings: 1 },
  ]},
  { id: 'frequency',   label: 'Frequency',       items: [
    { slug: 'frequency_balance', label: 'Frequency Balance', status: 'cached',   findings: 3 },
    { slug: 'frequency_collision', label: 'Frequency Collisions', status: 'idle' },
    { slug: 'harmonic',          label: 'Harmonic Analysis', status: 'idle' },
    { slug: 'chord_harmony',     label: 'Chord Harmony',     status: 'idle' },
  ]},
  { id: 'dynamics',    label: 'Dynamics',        items: [
    { slug: 'dynamics',          label: 'Dynamics',          status: 'cached',   findings: 2 },
    { slug: 'humanization',      label: 'Humanization',      status: 'idle' },
    { slug: 'density',           label: 'Density / Busyness',status: 'idle' },
  ]},
  { id: 'stereo',      label: 'Stereo & Width',  items: [
    { slug: 'stereo_phase',      label: 'Stereo & Phase',    status: 'cached',   findings: 0 },
    { slug: 'stereo_field',      label: 'Stereo Field',      status: 'idle' },
    { slug: 'spatial',           label: 'Spatial',           status: 'idle' },
    { slug: 'stem_stereo_width', label: 'Stem Stereo Width', status: 'disabled', disabledReason: 'Upload stems to enable.' },
  ]},
  { id: 'loudness',    label: 'Loudness',        items: [
    { slug: 'loudness',          label: 'Loudness',          status: 'cached',   findings: 1 },
    { slug: 'gain_staging',      label: 'Gain Staging',      status: 'idle' },
    { slug: 'playback',          label: 'Playback Optimization', status: 'idle' },
  ]},
  { id: 'arrangement', label: 'Arrangement',     items: [
    { slug: 'sections',          label: 'Sections',          status: 'running' },
    { slug: 'trance_arrangement',label: 'Trance Arrangement',status: 'idle' },
    { slug: 'section_contrast',  label: 'Section Contrast',  status: 'idle' },
  ]},
  { id: 'reference',   label: 'Reference',       items: [
    { slug: 'stem_reference',         label: 'Stem vs Reference',  status: 'disabled', disabledReason: 'Upload a reference track to enable.' },
    { slug: 'stem_reference_delta',   label: 'Stem Reference Delta', status: 'disabled', disabledReason: 'Upload stems + reference to enable.' },
  ]},
  { id: 'detail',      label: 'Production Detail', items: [
    { slug: 'clarity',           label: 'Clarity',           status: 'idle' },
    { slug: 'surround',          label: 'Surround Compat',   status: 'idle' },
    { slug: 'device_chain',      label: 'Device Chain',      status: 'disabled', disabledReason: 'Upload an .als project to enable.' },
  ]},
  { id: 'overall',     label: 'Big Picture',     items: [
    { slug: 'overall',           label: 'Overall Score',     status: 'cached',   findings: 4 },
  ]},
];

const VERDICTS = [
  {
    id: 'v1', specialist: 'low_end', sev: 'warning',
    title: 'Sub frequencies competing with kick fundamentals',
    summary: 'Sub bass (40-80 Hz) overlaps with kick fundamental at 65 Hz, causing 6 dB of subjective punch loss.',
    fix: 'Sidechain sub to kick at 8 ms attack / 80 ms release, or HP the sub at 50 Hz to clear room.',
  },
  {
    id: 'v2', specialist: 'frequency_balance', sev: 'warning',
    title: 'Air band (10k+) sits 14% below genre median',
    summary: 'Track will sound darker than other releases on bright club systems.',
    fix: 'Gentle 2 dB high-shelf at 12 kHz on the master bus, or open up cymbal/hat top end.',
  },
  {
    id: 'v3', specialist: 'dynamics', sev: 'info',
    title: 'Punch index 6.1 — within healthy zone',
    summary: 'Transient preservation is good for the loudness target you\'re hitting.',
    fix: null,
  },
];

const TRACK = {
  id: 't_aurora_v3',
  name: 'Aurora — Final Mix (v3)',
  artist: 'You',
  durationSec: 268,
  format: 'WAV · 48 kHz · 24-bit',
  grade: 'B+',
  score: 78,
  bpm: 128,
  key: 'F# minor',
  genre: { name: 'Progressive House', confidence: 89 },
  loudness: { integrated: -11.2, truePeak: -0.6, dynamicRange: 5.4, rms: -14.3, shortTermSeries: [
    -22,-20,-18,-15,-14,-13,-12,-11.5,-11,-11.2,-11,-11.2,-11.1,-11,-10.8,-11,-11.3,
    -14,-15,-13,-12,-11.5,-11.2,-11,-10.8,-11,-11.1,-11.2,-11.4,-11.6,-11.8,-12,-11.5,
    -11.2,-11.1,-11,-11.3
  ]},
  stereo: { width: 62, correlation: 0.71, monoCompat: 0.78 },
  frequency: { clarity: 74, label: 'Bass-heavy', bands: FREQ_BANDS, genreMedianBands: GENRE_MED_BANDS },
  genreMedianLufs: -10.8,
  percentile: 68,
  profileSource: 'Reference set: 1,240 Progressive House releases · 2022–2026',
  danceScore: 82,
  streaming: STREAMING,
  streamingPassCount: 3,
  arrangement: { score: 76, sections: ARRANGEMENT_SECTIONS, issues: ['Breakdown drops energy too fast (4 bars vs. typical 6-8)', 'Drop B is identical to Drop A — consider a variation hook'] },
  clashes: STEM_CLASHES,
  gap: GAP,
  fixes: FIXES,
  tranceDNA: { parts: ['anthemic lead','plucky bass','sidechained pad','riser fx','breakdown vox'] },
  verdicts: VERDICTS,
  notes: [
    { id: 'n1', t: 18,  text: 'Opener feels right — keep this filtered intro',                  pinned: true  },
    { id: 'n2', t: 64,  text: 'Drop A: bass might still be 1 dB hot. Check on monitors.',       pinned: false },
    { id: 'n3', t: 132, text: 'Breakdown lands too hard. Add 4-bar reverb tail before it.',     pinned: true  },
    { id: 'n4', t: 214, text: 'Drop B variation working — keep the octave-up lead',             pinned: false },
  ],
};

const LIBRARY = [
  { id: 'l1', name: 'Aurora',       genre: 'Prog House',    bpm: 128, key: 'F# min', updatedDays: 0,  hue: 168, plays: 124,
    versions: [
      { v: 1, label: 'rough mix',         grade: 'C+', score: 58, date: 'Mar 3' },
      { v: 2, label: 'after EQ pass',     grade: 'B-', score: 70, date: 'Mar 10' },
      { v: 3, label: 'mastered',          grade: 'B+', score: 78, date: 'Mar 17', current: true },
    ]},
  { id: 'l2', name: 'Voidcaller',   genre: 'Trance',        bpm: 138, key: 'A min',  updatedDays: 2,  hue: 220, plays: 312,
    versions: [
      { v: 1, label: 'demo',              grade: 'D',  score: 42, date: 'Feb 1' },
      { v: 2, label: 'arrangement v2',    grade: 'C',  score: 58, date: 'Feb 8' },
      { v: 3, label: 'mix v1',            grade: 'C+', score: 64, date: 'Feb 14' },
      { v: 4, label: 'mix v2',            grade: 'B',  score: 76, date: 'Feb 22' },
      { v: 5, label: 'final master',      grade: 'A-', score: 88, date: 'Mar 15', current: true },
    ]},
  { id: 'l3', name: 'Lowtide',      genre: 'Deep House',    bpm: 122, key: 'C# min', updatedDays: 5,  hue: 195, plays: 88,
    versions: [
      { v: 1, label: 'sketch',            grade: 'C',  score: 56, date: 'Mar 8' },
      { v: 2, label: 'reduced low end',   grade: 'B',  score: 74, date: 'Mar 13', current: true },
    ]},
  { id: 'l4', name: 'Filament',     genre: 'Techno',        bpm: 132, key: 'G min',  updatedDays: 8,  hue: 18,  plays: 56,
    versions: [
      { v: 1, label: 'jam',               grade: 'D+', score: 48, date: 'Mar 1' },
      { v: 2, label: 'kick refit',        grade: 'C-', score: 54, date: 'Mar 4' },
      { v: 3, label: 'arrangement pass',  grade: 'C',  score: 60, date: 'Mar 8' },
      { v: 4, label: 'mix pass 1',        grade: 'C+', score: 66, date: 'Mar 10', current: true },
    ]},
  { id: 'l5', name: 'Cold Permit',  genre: 'Tech House',    bpm: 126, key: 'D min',  updatedDays: 14, hue: 264, plays: 41,
    versions: [
      { v: 1, label: 'first take',        grade: 'B-', score: 68, date: 'Mar 1', current: true },
    ]},
  { id: 'l6', name: 'Postcard',     genre: 'Ambient',       bpm: 90,  key: 'E maj',  updatedDays: 21, hue: 320, plays: 207,
    versions: [
      { v: 1, label: 'long version',      grade: 'B+', score: 82, date: 'Feb 18' },
      { v: 2, label: 'radio edit',        grade: 'A',  score: 92, date: 'Feb 24', current: true },
    ]},
  { id: 'l7', name: 'Gridline',     genre: 'Prog House',    bpm: 130, key: 'B min',  updatedDays: 26, hue: 145, plays: 178,
    versions: [
      { v: 1, label: 'demo',              grade: 'C-', score: 54, date: 'Feb 4' },
      { v: 2, label: 'rough mix',         grade: 'C',  score: 60, date: 'Feb 8' },
      { v: 3, label: 'mix v1',            grade: 'C+', score: 66, date: 'Feb 12' },
      { v: 4, label: 'mix v2 + ref',      grade: 'B-', score: 72, date: 'Feb 17' },
      { v: 5, label: 'pre-master',        grade: 'B',  score: 76, date: 'Feb 20' },
      { v: 6, label: 'master',            grade: 'B+', score: 80, date: 'Feb 22', current: true },
    ]},
  { id: 'l8', name: 'Saltwater',    genre: 'Drum & Bass',   bpm: 174, key: 'F min',  updatedDays: 35, hue: 38,  plays: 22,
    versions: [
      { v: 1, label: 'sketch',            grade: 'D',  score: 44, date: 'Feb 1' },
      { v: 2, label: 'arrangement',       grade: 'C-', score: 52, date: 'Feb 12', current: true },
    ]},
];

// Helpers — latest grade/score derived from versions
for (const s of LIBRARY) {
  const cur = s.versions.find(v => v.current) || s.versions[s.versions.length - 1];
  s.grade = cur.grade;
  s.score = cur.score;
  s.versionCount = s.versions.length;
  s.scoreDelta = s.versions.length > 1
    ? cur.score - s.versions[0].score
    : 0;
}

// ── Specialist personas ───────────────────────────────────────────────────
// Each specialist is treated like a member of an analysis team. Visual identity
// makes verdicts feel authored, not anonymous.

const SPECIALIST_PERSONAS = {
  loudness:           { label: 'LOUDNESS',     color: '#fb923c', glyph: 'L' },
  low_end:            { label: 'LOW END',      color: '#a78bfa', glyph: 'B' },
  frequency_balance:  { label: 'FREQUENCY',    color: '#00e5b0', glyph: 'F' },
  frequency_collision:{ label: 'COLLISIONS',   color: '#00e5b0', glyph: 'X' },
  dynamics:           { label: 'DYNAMICS',     color: '#fbbf24', glyph: 'D' },
  stereo_phase:       { label: 'STEREO',       color: '#60a5fa', glyph: 'S' },
  sections:           { label: 'ARRANGEMENT',  color: '#a78bfa', glyph: 'A' },
  trance_arrangement: { label: 'ARRANGEMENT',  color: '#a78bfa', glyph: 'A' },
  stem_balance:       { label: 'STEM BALANCE', color: '#a78bfa', glyph: 'M' },
  clarity:            { label: 'CLARITY',      color: '#00e5b0', glyph: 'C' },
  overall:            { label: 'BIG PICTURE',  color: '#e2e8f4', glyph: '★' },
};

// ── Detailed coach findings (the centerpiece of Results page) ─────────────

const COACH_FINDINGS = [
  {
    id: 'f1',
    rank: 1,
    specialist: 'loudness',
    sev: 'critical',
    impact: 'high',
    confidence: 0.96,
    title: 'Master is 2.8 LU too loud for streaming targets',
    body: "You're hitting -11.2 integrated LUFS but Spotify normalizes to -14. The platform will quietly turn your track down — except your transients are already crushed from getting there.",
    metricLine: '-11.2 LUFS INTEGRATED · -14 SPOTIFY TARGET · 5.4 LU DYN RANGE',
    chartType: 'lufs',
    fix: {
      title: 'Pull back the master limiter',
      steps: [
        { kind: 'plugin',     where: 'Master bus',  what: 'Limiter output',  from: '-1.0 dB',  to: '-3.0 dB' },
        { kind: 'automation', where: 'Drop sections', what: 'Master gain',   from: '0 dB',     to: '+0.5 dB' },
        { kind: 'target',     where: 'New integrated', what: 'LUFS',         from: '-11.2',    to: '-14.0' },
      ],
      why: '-14 LUFS sounds louder than -11 LUFS once playback normalization kicks in — if your transients survive. Streaming loudness is a perception game, not a level game.',
    },
    presetName: 'Spotify-safe master',
  },
  {
    id: 'f2',
    rank: 2,
    specialist: 'low_end',
    sev: 'warning',
    impact: 'high',
    confidence: 0.91,
    title: 'Sub competing with kick fundamental at 65 Hz',
    body: 'Your sub bass (40–80 Hz) overlaps the kick fundamental, costing roughly 6 dB of subjective punch. The kick sounds soft on club systems because it never gets to be alone.',
    metricLine: 'OVERLAP 38% AT 60–120 HZ · KICK FUND 65 HZ · SUB BAND -3.2 DB FROM TARGET',
    chartType: 'sidechain',
    fix: {
      title: 'Sidechain the sub to the kick',
      steps: [
        { kind: 'plugin',     where: 'Sub bass channel', what: 'Sidechain trigger', from: '—',       to: 'Kick (pre-fader)' },
        { kind: 'plugin',     where: 'Sub bass channel', what: 'Attack',            from: '—',       to: '8 ms' },
        { kind: 'plugin',     where: 'Sub bass channel', what: 'Release',           from: '—',       to: '80 ms' },
        { kind: 'plugin',     where: 'Sub bass channel', what: 'Gain reduction',    from: '0 dB',    to: '-6 dB' },
      ],
      why: 'Sub ducks under the kick transient for ~80 ms, then breathes back in. The kick gets its punch back without losing low-end weight overall.',
    },
    presetName: 'Kick sidechain — club mix',
  },
  {
    id: 'f3',
    rank: 3,
    specialist: 'frequency_balance',
    sev: 'warning',
    impact: 'med',
    confidence: 0.88,
    title: 'Air band (10 kHz+) sits 14% below genre median',
    body: 'Your top end is darker than typical Progressive House releases. On bright club systems the track will feel small. On laptop speakers it will sound dull.',
    metricLine: 'AIR BAND 0.32 · GENRE MEDIAN 0.46 · -14% RELATIVE',
    chartType: 'eq-curve',
    fix: {
      title: 'Open up the top end on the master',
      steps: [
        { kind: 'plugin',     where: 'Master bus EQ',  what: 'High shelf',  from: 'flat',   to: '+2 dB @ 12 kHz' },
        { kind: 'plugin',     where: 'Cymbal bus',     what: 'Top end',     from: 'flat',   to: '+1.5 dB @ 10 kHz' },
        { kind: 'check',      where: 'Reference',      what: 'A/B vs Anjuna 2024 release', from: '—', to: 'match air feel' },
      ],
      why: 'A gentle broad shelf is safer than narrow bumps — it adds presence without making cymbals harsh on lossy playback.',
    },
    presetName: 'Air lift +2 dB @ 12k',
  },
  {
    id: 'f4',
    rank: 4,
    specialist: 'sections',
    sev: 'warning',
    impact: 'med',
    confidence: 0.84,
    title: 'Breakdown drops energy too fast',
    body: "Drop A → Breakdown loses 8.1 LUFS in 4 bars. Commercial Prog House typically bridges this over 6–8 bars. Listeners on playlists will skip here.",
    metricLine: 'SECTION 4 BREAKDOWN · -8.1 LUFS IN 4 BARS · TYPICAL: -6 LUFS IN 6–8',
    chartType: 'arrangement',
    fix: {
      title: 'Add a 4-bar bridge into the breakdown',
      steps: [
        { kind: 'arrangement', where: 'Bar 109–112', what: 'Add transition', from: 'hard cut',  to: '4-bar bridge' },
        { kind: 'fx',          where: 'Bridge bars', what: 'Reverb tail',    from: 'dry',       to: '+8 s, 100% wet' },
        { kind: 'fx',          where: 'Bridge bars', what: 'Filter sweep',   from: '—',         to: 'HP 80→2k over 4 bars' },
        { kind: 'arrangement', where: 'Kick',        what: 'High-pass open', from: 'closed',    to: 'open over 2 bars' },
      ],
      why: 'A long reverb tail + filtered noise sweep gives the listener time to register the drop, then arrive in the breakdown rather than being dumped.',
    },
    presetName: 'Cliff → bridge',
  },
  {
    id: 'f5',
    rank: 5,
    specialist: 'stereo_phase',
    sev: 'info',
    impact: 'low',
    confidence: 0.79,
    title: 'Stereo width healthy, but bass leaks below 120 Hz',
    body: "Correlation reads +0.71 (healthy). However sub elements are spread to ±18% width below 120 Hz, which will cancel partially on mono playback.",
    metricLine: 'CORR +0.71 · WIDTH 62% · SUB SPREAD 18% BELOW 120 HZ',
    chartType: 'frequency',
    fix: {
      title: 'Mono the bottom end',
      steps: [
        { kind: 'plugin', where: 'Master bus',     what: 'Bass mono utility', from: 'off',     to: 'on, cutoff 120 Hz' },
        { kind: 'check',  where: 'Mono playback',  what: 'Phase scope',       from: '—',       to: 'verify no dips at 60 Hz' },
      ],
      why: 'Phone speakers, club subs and laptop fold playback all sum to mono. Wide bass is fragile — collapse it deliberately.',
    },
    presetName: 'Bass mono < 120 Hz',
  },
  {
    id: 'f6',
    rank: 6,
    specialist: 'trance_arrangement',
    sev: 'info',
    impact: 'low',
    confidence: 0.72,
    title: 'Drop B is identical to Drop A — needs a variation hook',
    body: "Second drop matches the first within 92% spectral similarity. Commercial releases vary the second drop with a melodic counterpoint, a new texture, or a structural twist.",
    metricLine: 'DROP A↔B SIMILARITY 92% · TYPICAL TARGET <80%',
    chartType: 'arrangement',
    fix: {
      title: 'Differentiate Drop B',
      steps: [
        { kind: 'production', where: 'Drop B lead',  what: 'New counter-melody',  from: 'reprise', to: 'octave-up variant' },
        { kind: 'production', where: 'Drop B perc',  what: 'New layer',           from: '—',       to: 'shaker + tom fill' },
        { kind: 'arrangement',where: 'Last 8 bars',  what: 'Structural twist',    from: 'reprise', to: 'half-time outro hook' },
      ],
      why: 'Listeners stay through Drop B only if it pays off the journey — sameness is the most common reason for skip-rate spikes in this genre.',
    },
    presetName: 'Drop B variation kit',
  },
];

TRACK.coach = COACH_FINDINGS;
TRACK.coachSummary = {
  total: COACH_FINDINGS.length,
  critical: COACH_FINDINGS.filter(f => f.sev === 'critical').length,
  warning:  COACH_FINDINGS.filter(f => f.sev === 'warning').length,
  info:     COACH_FINDINGS.filter(f => f.sev === 'info').length,
  specialistsRun: 14,
  specialistsTotal: 26,
};

// Sub-scores by mix dimension — used in the Verdict Hero right panel and surfaced
// as drill-down anchors into the AI Coach categories.
TRACK.dimensionScores = [
  { id: 'loudness',    label: 'Loudness',    score: 62, change: -6, findings: 1, sev: 'critical', anchor: 'LOUDNESS' },
  { id: 'balance',     label: 'Balance',     score: 71, change: +2, findings: 2, sev: 'warning',  anchor: 'FREQUENCY' },
  { id: 'low-end',     label: 'Low end',     score: 64, change: -1, findings: 1, sev: 'warning',  anchor: 'LOW END' },
  { id: 'dynamics',    label: 'Dynamics',    score: 70, change: -3, findings: 0, sev: 'info',     anchor: 'DYNAMICS' },
  { id: 'stereo',      label: 'Stereo',      score: 84, change: +4, findings: 1, sev: 'info',     anchor: 'STEREO' },
  { id: 'arrangement', label: 'Arrangement', score: 76, change:  0, findings: 2, sev: 'warning',  anchor: 'ARRANGEMENT' },
];

// Top-level analysis pipeline status — what's been done on this song so far.
// Aimed at: "have we extracted everything we can from this file, and what
// could we unlock by uploading more material?"
TRACK.analysisPipeline = [
  { id: 'decode',      label: 'Audio decoded',        status: 'done',    detail: '4:28 · WAV · 48k · 24-bit',  durationMs: 1240 },
  { id: 'loudness',    label: 'Loudness & dynamics',  status: 'done',    detail: 'LUFS · dBTP · DR · RMS',     durationMs: 820 },
  { id: 'spectrum',    label: 'Frequency spectrum',   status: 'done',    detail: '8 bands · clarity 74',       durationMs: 1480 },
  { id: 'stereo',      label: 'Stereo & phase',       status: 'done',    detail: 'corr +0.71 · width 62%',     durationMs: 640 },
  { id: 'genre',       label: 'Genre profile match',  status: 'done',    detail: 'Prog House · 89% conf',      durationMs: 2100 },
  { id: 'arrange',     label: 'Arrangement scan',     status: 'done',    detail: '7 sections · 280 bars',      durationMs: 1820 },
  { id: 'specialists', label: 'AI specialists',       status: 'partial', detail: '14 / 26 run',  progress: 14/26, cta: 'Run all', running: 1 },
  { id: 'stems',       label: 'Stem analysis',        status: 'missing', detail: 'No stems uploaded',  cta: '+ Stems',     unlocks: 4 },
  { id: 'reference',   label: 'Reference comparison', status: 'missing', detail: 'No reference uploaded', cta: '+ Reference', unlocks: 2 },
  { id: 'als',         label: 'Ableton project',      status: 'missing', detail: 'No .als uploaded',  cta: '+ ALS',      unlocks: 1 },
];

window.SPECTR_PERSONAS = SPECIALIST_PERSONAS;

// ── Discover — public tracks from the SPECTR community ─────────────────────
// Minimal community surface: producers can publish a song version, others
// browse + listen. No comments, no follows, no likes — yet.

const PUBLIC_USERS = {
  maek: {
    handle: 'maek',
    displayName: 'Mae Karlsson',
    bio: 'Progressive house producer based in Stockholm. Ableton Live. Open to syncs and remixes.',
    avatarHue: 168,
    bannerHue: 168,
    accent: 'cyan',
    link: 'soundcloud.com/maek',
    joinedMonths: 5,
    isYou: true,
  },
  forge: {
    handle: 'forge',
    displayName: 'Anya Forge',
    bio: 'Berlin-based techno + ambient. Field recordings + modular.',
    avatarHue: 18, bannerHue: 18, accent: 'orange',
    link: 'forge.studio',
    joinedMonths: 11,
  },
  kestrel: {
    handle: 'kestrel',
    displayName: 'Jin Kestrel',
    bio: 'DnB & drum-funk. Bristol.',
    avatarHue: 38, bannerHue: 38, accent: 'yellow',
    link: 'kestrel.fm',
    joinedMonths: 18,
  },
  vela: {
    handle: 'vela',
    displayName: 'Vela',
    bio: 'Trance, prog, ambient interludes.',
    avatarHue: 220, bannerHue: 220, accent: 'violet',
    link: 'vela.io',
    joinedMonths: 7,
  },
  river: {
    handle: 'river',
    displayName: 'River Quinn',
    bio: 'Deep house, organic textures. London.',
    avatarHue: 195, bannerHue: 195, accent: 'cyan',
    link: 'riverquinn.com',
    joinedMonths: 28,
  },
  oort: {
    handle: 'oort',
    displayName: 'Oort',
    bio: 'Tech house. Mostly anonymous, mostly nocturnal.',
    avatarHue: 264, bannerHue: 264, accent: 'violet',
    link: '',
    joinedMonths: 3,
  },
};

const DISCOVER_TRACKS = [
  { id: 'p1',  title: 'Equinox',          artist: 'maek',    genre: 'Progressive House', moods: ['driving', 'hopeful'],         bpm: 128, key: 'F# min', durationSec: 268, lufs: -10.2, license: 'Sync-cleared',     allowDownload: true,  plays: 124, savesCount: 8,  publishedDays: 2,  hue: 168, description: 'Anthemic prog-house — cinematic openers.' },
  { id: 'p2',  title: 'Filament',         artist: 'maek',    genre: 'Techno',            moods: ['gritty', 'pulsing'],          bpm: 132, key: 'G min',  durationSec: 392, lufs: -9.8,  license: 'Royalty-free',     allowDownload: true,  plays: 56,  savesCount: 3,  publishedDays: 14, hue: 18,  description: 'Industrial techno workout.' },
  { id: 'p3',  title: 'Lowtide',          artist: 'maek',    genre: 'Deep House',        moods: ['warm', 'mellow'],             bpm: 122, key: 'C# min', durationSec: 346, lufs: -11.4, license: 'Personal only',    allowDownload: false, plays: 88,  savesCount: 5,  publishedDays: 28, hue: 195, description: 'Late-night opener.' },

  { id: 'p4',  title: 'Carrier Wave',     artist: 'forge',   genre: 'Techno',            moods: ['driving', 'industrial'],      bpm: 134, key: 'F# min', durationSec: 412, lufs: -8.6,  license: 'Sync-cleared',     allowDownload: false, plays: 312, savesCount: 42, publishedDays: 5,  hue: 18,  description: 'Heavy peak-time techno.' },
  { id: 'p5',  title: 'Smoke Stack',      artist: 'forge',   genre: 'Ambient',           moods: ['dark', 'cinematic'],          bpm: 0,   key: 'D min',  durationSec: 624, lufs: -16.2, license: 'Royalty-free',     allowDownload: true,  plays: 188, savesCount: 28, publishedDays: 22, hue: 264, description: 'Field-recorded ambient piece.' },

  { id: 'p6',  title: 'Lowtide Bassline', artist: 'kestrel', genre: 'Drum & Bass',       moods: ['funky', 'rolling'],           bpm: 174, key: 'A min',  durationSec: 322, lufs: -9.2,  license: 'Sync-cleared',     allowDownload: false, plays: 412, savesCount: 64, publishedDays: 3,  hue: 38,  description: 'Rollers section ID.' },
  { id: 'p7',  title: 'Wireframe',        artist: 'kestrel', genre: 'Drum & Bass',       moods: ['minimal', 'glitchy'],         bpm: 172, key: 'F min',  durationSec: 304, lufs: -9.6,  license: 'Royalty-free',     allowDownload: true,  plays: 156, savesCount: 18, publishedDays: 11, hue: 320, description: 'Tech-step from a different angle.' },

  { id: 'p8',  title: 'Anchorline',       artist: 'vela',    genre: 'Trance',            moods: ['euphoric', 'lifting'],        bpm: 138, key: 'A min',  durationSec: 478, lufs: -8.8,  license: 'Sync-cleared',     allowDownload: false, plays: 622, savesCount: 88, publishedDays: 1,  hue: 220, description: 'Stadium-ready uplifter.' },
  { id: 'p9',  title: 'Interlude II',     artist: 'vela',    genre: 'Ambient',           moods: ['quiet', 'melancholic'],       bpm: 0,   key: 'B min',  durationSec: 196, lufs: -18.0, license: 'Personal only',    allowDownload: false, plays: 84,  savesCount: 6,  publishedDays: 14, hue: 145, description: 'A short breath between sets.' },

  { id: 'p10', title: 'Saltmarsh',        artist: 'river',   genre: 'Deep House',        moods: ['warm', 'organic'],            bpm: 118, key: 'E min',  durationSec: 456, lufs: -11.2, license: 'Sync-cleared',     allowDownload: true,  plays: 244, savesCount: 36, publishedDays: 6,  hue: 145, description: 'Slow-build deep house. Acoustic textures.' },
  { id: 'p11', title: 'Hollow',           artist: 'river',   genre: 'Deep House',        moods: ['melodic', 'spacious'],        bpm: 120, key: 'G# min', durationSec: 412, lufs: -11.6, license: 'Royalty-free',     allowDownload: true,  plays: 188, savesCount: 22, publishedDays: 17, hue: 195, description: 'Atmospheric deep house.' },

  { id: 'p12', title: 'Side Mission',     artist: 'oort',    genre: 'Tech House',        moods: ['groovy', 'dark'],             bpm: 126, key: 'D min',  durationSec: 386, lufs: -9.4,  license: 'All rights reserved', allowDownload: false, plays: 38,  savesCount: 2,  publishedDays: 4,  hue: 264, description: 'Late-night tech house. ID.' },
];

const DISCOVER_GENRES = ['All', 'Progressive House', 'Techno', 'Deep House', 'Drum & Bass', 'Trance', 'Ambient', 'Tech House'];
const DISCOVER_MOODS  = ['driving', 'hopeful', 'gritty', 'pulsing', 'warm', 'mellow', 'industrial', 'dark', 'cinematic', 'funky', 'rolling', 'minimal', 'glitchy', 'euphoric', 'lifting', 'quiet', 'melancholic', 'organic', 'melodic', 'spacious', 'groovy'];
const DISCOVER_LICENSES = ['All licenses', 'Sync-cleared', 'Royalty-free', 'Personal only', 'All rights reserved'];

// User's own publishing preferences for their songs
const YOUR_PUBLIC_TRACK_IDS = ['p1', 'p2', 'p3'];

// (SPECTR_DATA assigned at very end of file once everything is declared)

// ── Reference track library ─────────────────────────────────────────────────
// Producers save commercial tracks here to reuse as "match targets" instead of
// re-uploading a reference WAV every time they upload a new mix.

const REFERENCES = [
  {
    id: 'r1', title: 'Strangers (Above & Beyond Remix)',
    artist: 'Yotto',
    source: 'youtube', sourceUrl: 'youtube.com/watch?v=xyz',
    addedDays: 4,
    genre: 'Progressive House', bpm: 128, key: 'F# min', durationSec: 426,
    lufs: -9.2, truePeak: -0.3, dynamicRange: 6.8,
    width: 68, correlation: 0.78,
    hue: 168,
    tags: ['prog-house-2024', 'club', 'anjuna'],
    analyzed: true, used: 12,
    notes: 'Reference for the club-ready master. Hot but musical.',
  },
  {
    id: 'r2', title: 'Embers',
    artist: 'Lane 8',
    source: 'spotify',  sourceUrl: 'spotify.com/track/abc',
    addedDays: 14,
    genre: 'Deep House', bpm: 122, key: 'A min', durationSec: 372,
    lufs: -10.8, truePeak: -1.0, dynamicRange: 7.4,
    width: 56, correlation: 0.84,
    hue: 220,
    tags: ['deep', 'melodic', 'chill'],
    analyzed: true, used: 5,
    notes: 'Use for arrangement pacing — long breakdowns.',
  },
  {
    id: 'r3', title: 'Daylight Robbery',
    artist: 'Eli & Fur',
    source: 'youtube', sourceUrl: 'youtube.com/watch?v=q1',
    addedDays: 22,
    genre: 'Indie Dance', bpm: 124, key: 'D min', durationSec: 348,
    lufs: -9.8, truePeak: -0.5, dynamicRange: 6.2,
    width: 72, correlation: 0.74,
    hue: 320,
    tags: ['vocal', 'indie-dance'],
    analyzed: true, used: 7,
  },
  {
    id: 'r4', title: 'Loomis',
    artist: 'Yotto',
    source: 'file',    sourceUrl: 'yotto-loomis.wav',
    addedDays: 30,
    genre: 'Progressive House', bpm: 126, key: 'C# min', durationSec: 412,
    lufs: -9.5, truePeak: -0.4, dynamicRange: 7.0,
    width: 64, correlation: 0.80,
    hue: 145,
    tags: ['prog-house-2024', 'club'],
    analyzed: true, used: 9,
  },
  {
    id: 'r5', title: 'Cascadia',
    artist: 'Tinlicker',
    source: 'youtube', sourceUrl: 'youtube.com/watch?v=ctk',
    addedDays: 3,
    genre: 'Progressive House', bpm: 130, key: 'B min', durationSec: 388,
    lufs: 0, truePeak: 0, dynamicRange: 0, width: 0, correlation: 0,
    hue: 195,
    tags: ['new'],
    analyzed: false, analyzing: true, used: 0,
  },
  {
    id: 'r6', title: 'Adagio for Strings',
    artist: 'Tiësto',
    source: 'spotify', sourceUrl: 'spotify.com/track/def',
    addedDays: 60,
    genre: 'Trance', bpm: 138, key: 'A min', durationSec: 540,
    lufs: -8.4, truePeak: -0.1, dynamicRange: 5.8,
    width: 70, correlation: 0.76,
    hue: 18,
    tags: ['classic', 'trance', 'mainstage'],
    analyzed: true, used: 14,
  },
  {
    id: 'r7', title: 'Skin',
    artist: 'Rüfüs Du Sol',
    source: 'soundcloud', sourceUrl: 'soundcloud.com/rufus',
    addedDays: 90,
    genre: 'Deep House', bpm: 116, key: 'E min', durationSec: 432,
    lufs: -11.4, truePeak: -1.2, dynamicRange: 8.2,
    width: 60, correlation: 0.82,
    hue: 264,
    tags: ['melodic', 'organic'],
    analyzed: true, used: 4,
  },
];

const REFERENCE_SETS = [
  { id: 'set1', name: 'Anjuna 2024 club masters', count: 4, refIds: ['r1','r4','r5','r6'], hue: 168 },
  { id: 'set2', name: 'Deep & melodic',          count: 3, refIds: ['r2','r3','r7'],       hue: 220 },
];

// ── User profile mock ──────────────────────────────────────────────────────
const PROFILE = {
  name: 'Mae Karlsson',
  handle: '@maek',
  email: 'mae@spectr.fm',
  initial: 'M',
  plan: 'Studio',
  joined: 'Joined Jan 2025',
  stats: {
    songs: LIBRARY.length,
    versions: LIBRARY.reduce((a, b) => a + b.versionCount, 0),
    references: REFERENCES.length,
    analyses: 47,
    plays: LIBRARY.reduce((a, b) => a + b.plays, 0),
  },
  usage: {
    analysesThisMonth: 23,
    analysesCap: 50,
    specialistsCalls: 184,
    specialistsCap: 500,
  },
  activity: [
    { kind: 'analysis', t: '2h ago',  text: 'Re-analyzed Aurora v3' },
    { kind: 'upload',   t: '5h ago',  text: 'Uploaded stems for Aurora v3' },
    { kind: 'ref',      t: 'yesterday', text: 'Added 4 reference tracks (Anjuna 2024)' },
    { kind: 'compare',  t: '2d ago',  text: 'Compared Voidcaller v5 vs Adagio for Strings' },
    { kind: 'song',     t: '3d ago',  text: 'Created song "Aurora" with first upload' },
    { kind: 'analysis', t: 'last week', text: 'Ran AI specialists — Loudness on 6 tracks' },
  ],
};

window.SPECTR_DATA = { TRACK, LIBRARY, REFERENCES, REFERENCE_SETS, PROFILE, DISCOVER_TRACKS, DISCOVER_GENRES, DISCOVER_MOODS, DISCOVER_LICENSES, PUBLIC_USERS, YOUR_PUBLIC_TRACK_IDS };
