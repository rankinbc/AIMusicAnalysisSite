/* SPECTR · Listen rack redesign — DATA + BINDINGS
 *
 * Ported verbatim from features/listen/rackManifest.ts + audio/state.ts so the
 * mockup renders from the SAME control surface the engine exposes. Every module
 * carries its `bind` string — the exact useAudioGraph call the implementer wires.
 * Defaults match state.ts; ranges match rackManifest.ts. state.ts wins on conflict.
 */

// ── Per-module neutral defaults (audio/state.ts) ───────────────────────────
const EQ_FREQS = [60, 170, 350, 700, 1400, 3500, 7000, 14000];
const EQ_BANDS_DEFAULT = EQ_FREQS.map((freq) => ({ type: 'peaking', freq, gainDb: 0, q: 1.4, enabled: true }));

const MODULE_DEFAULTS = {
  djfilter:   { morph: 0, resonance: 0.7, enabled: false },
  eq:         { bands: EQ_BANDS_DEFAULT, enabled: false },
  gate:       { thresholdDb: -40, attackMs: 1, holdMs: 10, releaseMs: 100, floorDb: -80, enabled: false },
  comp:       { thresholdDb: 0, ratio: 1, attackMs: 3, releaseMs: 250, kneeDb: 30, makeupDb: 0, mix: 1, enabled: false },
  sat:        { drive: 0, mix: 0, curve: 'tanh', oversample: '2x', asymmetry: 0, tone: 0, outputTrimDb: 0, enabled: false },
  bitcrusher: { bitDepth: 16, downsample: 1, mix: 0, enabled: false },
  ms:         { width: 1, midGainDb: 0, sideGainDb: 0, monoMakerHz: 0, mono: false, enabled: false },
  pan:        { pan: 0, enabled: false },
  tremolo:    { mode: 'tremolo', sync: true, division: '1/8', rateHz: 5, depth: 0.5, shape: 'sine', bpm: 120, enabled: false },
  delay:      { sync: true, division: '1/8', timeMs: 250, feedback: 0.35, toneHz: 8000, pingPong: false, mix: 0, bpm: 120, enabled: false },
  reverb:     { ir: 'hall', decaySec: 2.0, preDelayMs: 20, dampingHz: 8000, mix: 0, enabled: false },
  limiter:    { ceilingDb: -1.0, releaseMs: 50, lookaheadMs: 5, enabled: false },
  trim:       { gainDb: 0, enabled: true },
  pitch:      { semitones: 0, cents: 0, tempo: 1, enabled: false },
};

// audio/state.ts DEFAULT_ORDER (the insert chain at rest; pitch is NOT in it)
const DEFAULT_ORDER = ['djfilter', 'eq', 'gate', 'comp', 'sat', 'bitcrusher', 'ms', 'pan', 'tremolo', 'delay', 'reverb', 'limiter', 'trim'];

// ── The rack manifest (rackManifest.ts) + per-module presentation metadata ──
// accent/glyph/blurb are UI sugar; tier/params/hasMix/hasMeter/worklet are engine truth.
const DIVISIONS = ['1/4', '1/8', '1/8.', '1/8T', '1/16'];

const EQ_BAND_PARAMS = [
  { key: 'type', label: 'Type', control: 'select', options: ['peaking', 'lowshelf', 'highshelf', 'lowpass', 'highpass', 'bandpass', 'notch', 'allpass'], default: 'peaking' },
  { key: 'freq', label: 'Freq', control: 'knob', min: 20, max: 20000, unit: 'Hz', default: 1000 },
  { key: 'gainDb', label: 'Gain', control: 'knob', min: -24, max: 24, step: 0.1, unit: 'dB', default: 0 },
  { key: 'q', label: 'Q', control: 'knob', min: 0.1, max: 18, step: 0.1, unit: 'none', default: 1.4 },
  { key: 'enabled', label: 'Band', control: 'toggle', default: true },
];

const RACK_MANIFEST = [
  { id: 'eq', label: 'EQ', sub: '8-band parametric', tier: 'mastering', accent: 'var(--cyan)', glyph: '≋', hasMix: false, hasMeter: false,
    bind: "setEffectParams('eq', { enabled, bands })",
    summary: '8 fully-parametric bands — drag the curve. Each band type/freq/gainDb/q/enabled.',
    params: EQ_BAND_PARAMS, perBand: true },
  { id: 'comp', label: 'Compressor', sub: 'Dynamics · GR meter', tier: 'mastering', accent: 'var(--yellow)', glyph: '◐', hasMix: true, hasMeter: true,
    bind: "setEffectParams('comp', patch) · readEffectMeter('comp')",
    summary: 'Threshold/ratio/attack/release/knee/makeup + parallel mix. Live gain-reduction meter.',
    params: [
      { key: 'thresholdDb', label: 'Threshold', control: 'knob', min: -60, max: 0, step: 0.5, unit: 'dB', default: 0 },
      { key: 'ratio', label: 'Ratio', control: 'knob', min: 1, max: 20, step: 0.1, unit: 'ratio', default: 1 },
      { key: 'attackMs', label: 'Attack', control: 'knob', min: 0, max: 250, step: 1, unit: 'ms', default: 3 },
      { key: 'releaseMs', label: 'Release', control: 'knob', min: 0, max: 1000, step: 1, unit: 'ms', default: 250 },
      { key: 'kneeDb', label: 'Knee', control: 'knob', min: 0, max: 40, step: 1, unit: 'dB', default: 30 },
      { key: 'makeupDb', label: 'Makeup', control: 'knob', min: -12, max: 24, step: 0.5, unit: 'dB', default: 0 },
      { key: 'mix', label: 'Mix', control: 'slider', min: 0, max: 1, step: 0.01, unit: 'percent', default: 1 },
    ] },
  { id: 'sat', label: 'Saturator', sub: 'Harmonic drive', tier: 'mastering', accent: 'var(--orange)', glyph: '∿', hasMix: true, hasMeter: false,
    bind: "setEffectParams('sat', patch)",
    summary: '6 curves, oversample, asymmetry, tone tilt, output trim.',
    params: [
      { key: 'drive', label: 'Drive', control: 'knob', min: 0, max: 1, step: 0.01, unit: 'percent', default: 0 },
      { key: 'mix', label: 'Mix', control: 'knob', min: 0, max: 1, step: 0.01, unit: 'percent', default: 0 },
      { key: 'curve', label: 'Curve', control: 'select', options: ['tanh', 'softclip', 'hardclip', 'arctan', 'sinefold', 'tube'], default: 'tanh' },
      { key: 'oversample', label: 'Oversample', control: 'segmented', options: ['none', '2x', '4x'], default: '2x' },
      { key: 'asymmetry', label: 'Asym', control: 'knobBipolar', min: -1, max: 1, step: 0.01, unit: 'none', default: 0 },
      { key: 'tone', label: 'Tone', control: 'knobBipolar', min: -1, max: 1, step: 0.01, unit: 'none', default: 0 },
      { key: 'outputTrimDb', label: 'Out', control: 'knob', min: -24, max: 12, step: 0.5, unit: 'dB', default: 0 },
    ] },
  { id: 'ms', label: 'M/S Width', sub: 'Mid / side · mono-maker', tier: 'mastering', accent: 'var(--blue)', glyph: '⇔', hasMix: false, hasMeter: false,
    bind: "setEffectParams('ms', patch)",
    summary: 'Width + independent M/S gains + bass mono-maker. Pairs with the goniometer.',
    params: [
      { key: 'width', label: 'Width', control: 'knob', min: 0, max: 2, step: 0.01, unit: 'x', default: 1, hint: '1 = identity' },
      { key: 'midGainDb', label: 'Mid', control: 'knob', min: -12, max: 12, step: 0.5, unit: 'dB', default: 0 },
      { key: 'sideGainDb', label: 'Side', control: 'knob', min: -12, max: 12, step: 0.5, unit: 'dB', default: 0 },
      { key: 'monoMakerHz', label: 'Mono <', control: 'knob', min: 0, max: 400, step: 5, unit: 'Hz', default: 0, hint: '0 = off' },
      { key: 'mono', label: 'Mono', control: 'toggle', default: false },
    ] },
  { id: 'limiter', label: 'Limiter', sub: 'True-peak brickwall', tier: 'mastering', accent: 'var(--red)', glyph: '▰', hasMix: false, hasMeter: true, worklet: true,
    bind: "setEffectParams('limiter', patch) · readEffectMeter('limiter')",
    summary: 'The "-1 dBTP" loudness preview. Live gain-reduction meter. Worklet — brief init.',
    params: [
      { key: 'ceilingDb', label: 'Ceiling', control: 'knob', min: -12, max: 0, step: 0.1, unit: 'dBTP', default: -1.0 },
      { key: 'releaseMs', label: 'Release', control: 'knob', min: 1, max: 500, step: 1, unit: 'ms', default: 50 },
      { key: 'lookaheadMs', label: 'Lookahead', control: 'knob', min: 0, max: 10, step: 0.5, unit: 'ms', default: 5 },
    ] },
  { id: 'trim', label: 'Output Trim', sub: 'Chain make-up gain', tier: 'mastering', accent: 'var(--green)', glyph: '⎓', hasMix: false, hasMeter: false,
    bind: "setEffectParams('trim', patch)",
    summary: 'Chain-level make-up gain, separate from player volume. Always on; reorderable.',
    params: [
      { key: 'gainDb', label: 'Gain', control: 'knob', min: -24, max: 12, step: 0.5, unit: 'dB', default: 0 },
    ] },
  // ── creative tier ──
  { id: 'djfilter', label: 'DJ Filter', sub: 'Sweep LP↔HP', tier: 'creative', accent: 'var(--violet)', glyph: '◑', hasMix: false, hasMeter: false,
    bind: "setEffectParams('djfilter', patch)",
    summary: 'Single bipolar sweep: left = LP down, right = HP up, center = open.',
    params: [
      { key: 'morph', label: 'Morph', control: 'knobBipolar', min: -1, max: 1, step: 0.01, unit: 'none', default: 0, hint: 'center = open' },
      { key: 'resonance', label: 'Res', control: 'knob', min: 0.1, max: 20, step: 0.1, unit: 'none', default: 0.7 },
    ] },
  { id: 'delay', label: 'Delay', sub: 'BPM echo · ping-pong', tier: 'creative', accent: 'var(--violet)', glyph: '⇉', hasMix: true, hasMeter: false,
    bind: "setEffectParams('delay', patch)",
    summary: 'BPM-synced echo + feedback tone filter + ping-pong.',
    params: [
      { key: 'sync', label: 'Sync', control: 'toggle', default: true },
      { key: 'division', label: 'Div', control: 'select', options: DIVISIONS, default: '1/8' },
      { key: 'timeMs', label: 'Time', control: 'knob', min: 1, max: 2000, step: 1, unit: 'ms', default: 250 },
      { key: 'feedback', label: 'F.back', control: 'knob', min: 0, max: 0.95, step: 0.01, unit: 'percent', default: 0.35 },
      { key: 'toneHz', label: 'Tone', control: 'knob', min: 200, max: 18000, unit: 'Hz', default: 8000 },
      { key: 'pingPong', label: 'Ping-pong', control: 'toggle', default: false },
      { key: 'mix', label: 'Mix', control: 'slider', min: 0, max: 1, step: 0.01, unit: 'percent', default: 0 },
    ] },
  { id: 'reverb', label: 'Reverb', sub: 'Convolution space', tier: 'creative', accent: 'var(--violet)', glyph: '◌', hasMix: true, hasMeter: false,
    bind: "setEffectParams('reverb', patch)",
    summary: 'Convolution reverb, synthesized IRs. Heaviest node — enable only when used.',
    params: [
      { key: 'ir', label: 'Space', control: 'select', options: ['room', 'hall', 'plate', 'spring', 'ambience'], default: 'hall' },
      { key: 'decaySec', label: 'Decay', control: 'knob', min: 0.2, max: 8, step: 0.1, unit: 's', default: 2.0 },
      { key: 'preDelayMs', label: 'Pre', control: 'knob', min: 0, max: 200, step: 1, unit: 'ms', default: 20 },
      { key: 'dampingHz', label: 'Damp', control: 'knob', min: 1000, max: 18000, unit: 'Hz', default: 8000 },
      { key: 'mix', label: 'Mix', control: 'slider', min: 0, max: 1, step: 0.01, unit: 'percent', default: 0 },
    ] },
  { id: 'pan', label: 'Stereo Pan', sub: 'Balance L↔R', tier: 'creative', accent: 'var(--blue)', glyph: '◎', hasMix: false, hasMeter: false,
    bind: "setEffectParams('pan', patch)",
    summary: 'Stereo balance. More for stems than a finished mix.',
    params: [
      { key: 'pan', label: 'Pan', control: 'knobBipolar', min: -1, max: 1, step: 0.01, unit: 'none', default: 0, hint: 'L ← C → R' },
    ] },
  { id: 'tremolo', label: 'Tremolo', sub: 'LFO amp / auto-pan', tier: 'creative', accent: 'var(--yellow)', glyph: '◇', hasMix: false, hasMeter: false,
    bind: "setEffectParams('tremolo', patch)",
    summary: 'LFO modulates amplitude (tremolo) or pan (auto-pan). BPM-syncable.',
    params: [
      { key: 'mode', label: 'Mode', control: 'segmented', options: ['tremolo', 'autopan'], default: 'tremolo' },
      { key: 'sync', label: 'Sync', control: 'toggle', default: true },
      { key: 'division', label: 'Div', control: 'select', options: DIVISIONS, default: '1/8' },
      { key: 'rateHz', label: 'Rate', control: 'knob', min: 0.1, max: 20, step: 0.1, unit: 'Hz', default: 5 },
      { key: 'depth', label: 'Depth', control: 'knob', min: 0, max: 1, step: 0.01, unit: 'percent', default: 0.5 },
      { key: 'shape', label: 'Shape', control: 'select', options: ['sine', 'triangle', 'square'], default: 'sine' },
    ] },
  { id: 'gate', label: 'Gate', sub: 'Noise gate · GR meter', tier: 'creative', accent: 'var(--cyan)', glyph: '⊓', hasMix: false, hasMeter: true, worklet: true,
    bind: "setEffectParams('gate', patch) · readEffectMeter('gate')",
    summary: 'Noise gate / downward expander. Meter shows open + reduction. Worklet — brief init.',
    params: [
      { key: 'thresholdDb', label: 'Thresh', control: 'knob', min: -80, max: 0, step: 1, unit: 'dB', default: -40 },
      { key: 'attackMs', label: 'Attack', control: 'knob', min: 0, max: 50, step: 0.1, unit: 'ms', default: 1 },
      { key: 'holdMs', label: 'Hold', control: 'knob', min: 0, max: 500, step: 1, unit: 'ms', default: 10 },
      { key: 'releaseMs', label: 'Release', control: 'knob', min: 0, max: 1000, step: 1, unit: 'ms', default: 100 },
      { key: 'floorDb', label: 'Floor', control: 'knob', min: -80, max: 0, step: 1, unit: 'dB', default: -80 },
    ] },
  { id: 'bitcrusher', label: 'Bitcrusher', sub: 'Bit / rate crush', tier: 'creative', accent: 'var(--orange)', glyph: '▦', hasMix: true, hasMeter: false, worklet: true,
    bind: "setEffectParams('bitcrusher', patch)",
    summary: 'Bit-depth quantization + sample-rate decimation. Worklet — brief init.',
    params: [
      { key: 'bitDepth', label: 'Bits', control: 'knob', min: 1, max: 16, step: 1, unit: 'bits', default: 16 },
      { key: 'downsample', label: 'Down', control: 'knob', min: 1, max: 50, step: 1, unit: 'x', default: 1 },
      { key: 'mix', label: 'Mix', control: 'slider', min: 0, max: 1, step: 0.01, unit: 'percent', default: 0 },
    ] },
];

const PITCH_MODULE = { id: 'pitch', label: 'Pitch', sub: 'Shift · tempo-coupled', tier: 'transport', accent: 'var(--violet)', glyph: '♯', hasMix: false, hasMeter: false,
  bind: "enterPitchMode() · setPitchDetune(st, cents)",
  summary: 'Separate buffer lane — NOT an insert. Pitch + tempo are coupled.',
  params: [
    { key: 'semitones', label: 'Semitones', control: 'knob', min: -12, max: 12, step: 1, unit: 'st', default: 0 },
    { key: 'cents', label: 'Cents', control: 'slider', min: -50, max: 50, step: 1, unit: 'cents', default: 0 },
    { key: 'tempo', label: 'Tempo', control: 'knob', min: 0.5, max: 2, step: 0.01, unit: 'x', default: 1, hint: 'coupled' },
  ] };

const MANIFEST_BY_ID = {};
[...RACK_MANIFEST, PITCH_MODULE].forEach((m) => { MANIFEST_BY_ID[m.id] = m; });
const MASTERING_IDS = RACK_MANIFEST.filter((m) => m.tier === 'mastering').map((m) => m.id);
const CREATIVE_IDS = RACK_MANIFEST.filter((m) => m.tier === 'creative').map((m) => m.id);

// ── Value formatting (capabilities doc conventions) ────────────────────────
function fmtVal(unit, v, opts) {
  opts = opts || {};
  if (v === true) return 'on';
  if (v === false) return 'off';
  if (typeof v === 'string') return v;
  switch (unit) {
    case 'dB':   return `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
    case 'dBTP': return `${v.toFixed(1)} dBTP`;
    case 'Hz':   return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} kHz` : `${Math.round(v)} Hz`;
    case 'ms':   return `${Math.round(v)} ms`;
    case 's':    return `${v.toFixed(1)} s`;
    case 'percent': return `${Math.round(v * 100)} %`;
    case 'ratio':   return `${v.toFixed(v < 10 ? 1 : 0)}:1`;
    case 'x':    return `${v.toFixed(2)}×`;
    case 'st':   return `${v > 0 ? '+' : ''}${v} st`;
    case 'cents':return `${v > 0 ? '+' : ''}${v} ¢`;
    case 'bits': return `${Math.round(v)} bit`;
    case 'none': return v.toFixed(opts.dp != null ? opts.dp : 2);
    default:     return `${v}`;
  }
}

// ── Track + room mock (subset of mock-data.jsx, shape-compatible) ──────────
const SECTIONS = [
  { t: 'intro', l: 'Intro', bars: 16 },
  { t: 'buildup', l: 'Build A', bars: 16 },
  { t: 'drop', l: 'Drop A', bars: 32 },
  { t: 'breakdown', l: 'Breakdown', bars: 32 },
  { t: 'buildup', l: 'Build B', bars: 16 },
  { t: 'drop', l: 'Drop B', bars: 32 },
  { t: 'outro', l: 'Outro', bars: 16 },
];

const TRACK = {
  name: 'Aurora — Final Mix (v3)',
  author: 'Mae Karlsson',
  handle: '@maek',
  format: 'WAV · 48 kHz · 24-bit',
  durationSec: 268,
  bpm: 128,
  key: 'F# minor',
  genre: { name: 'Progressive House', confidence: 89 },
  grade: 'B+',
  loudness: { integrated: -11.2, truePeak: -0.6, dynamicRange: 5.4, rms: -14.3 },
  stereo: { width: 62, correlation: 0.71, monoCompat: 0.78 },
  arrangement: { sections: SECTIONS },
  notes: [
    { id: 'n1', t: 18, text: 'Opener feels right — keep this filtered intro', pinned: true },
    { id: 'n2', t: 64, text: 'Drop A: bass might still be 1 dB hot. Check on monitors.', pinned: false },
    { id: 'n3', t: 132, text: 'Breakdown lands too hard. Add 4-bar reverb tail before it.', pinned: true },
    { id: 'n4', t: 214, text: 'Drop B variation working — keep the octave-up lead', pinned: false },
  ],
};

// AI Coach suggestions that map onto rack moves (the "solo analysis" path)
const COACH_SUGGESTIONS = [
  { id: 'c1', sev: 'critical', persona: 'LOUDNESS', color: 'var(--orange)', title: 'Master 2.8 LU too loud', move: 'Limiter ceiling −1.0 dBTP', apply: { limiter: { enabled: true, ceilingDb: -1.0 } } },
  { id: 'c2', sev: 'warning', persona: 'LOW END', color: 'var(--violet)', title: 'Sub competes with kick at 65 Hz', move: 'EQ bell −2 dB @ 120 Hz', apply: { eq: { enabled: true } } },
  { id: 'c3', sev: 'warning', persona: 'FREQUENCY', color: 'var(--cyan)', title: 'Air band 14% below median', move: 'EQ high-shelf +2 dB @ 12 kHz', apply: { eq: { enabled: true } } },
];

// Room mode — listeners (with live state emoji; some anonymous = bot) + reactions
const ROOM_LISTENERS = [
  { handle: 'maek', hue: 168, you: true, state: '🎧' },
  { handle: 'forge', hue: 18, state: '🔥' },
  { handle: 'vela', hue: 220, state: '🤯' },
  { handle: 'river', hue: 195, state: '👀' },
  { handle: 'kestrel', hue: 38, state: '😴' },
  { handle: 'listener-7', hue: 264, anon: true, state: '👍' },
  { handle: 'listener-3', hue: 200, anon: true, state: '👎' },
];
const ROOM_REACTIONS = [
  { id: 'r1', handle: 'forge', emoji: '🔥', t: 64, text: 'that drop' },
  { id: 'r2', handle: 'vela', emoji: '✨', t: 70, text: 'lead is gorgeous' },
  { id: 'r3', handle: 'river', emoji: '👀', t: 132, text: 'breakdown!' },
];
// Reaction / status emojis grouped by sentiment (viewers set an active status)
const REACTIONS_POSITIVE = ['👍', '🔥', '🤯', '😲', '🙌', '💜'];
const REACTIONS_NEUTRAL  = ['👀', '🤔', '😐'];
const REACTIONS_NEGATIVE = ['👎', '😴', '🥱', '😬'];
const REACTION_GROUPS = [
  { id: 'positive', label: 'POSITIVE', sign: '+', tone: 'var(--green)', emojis: REACTIONS_POSITIVE },
  { id: 'neutral', label: 'NEUTRAL', sign: '~', tone: 'var(--muted)', emojis: REACTIONS_NEUTRAL },
  { id: 'negative', label: 'NEGATIVE', sign: '−', tone: 'var(--red)', emojis: REACTIONS_NEGATIVE },
];
const REACTION_EMOJI = [...REACTIONS_POSITIVE, ...REACTIONS_NEUTRAL, ...REACTIONS_NEGATIVE];

// Visualizer stages (StageDisplay registry) + auto-director presets
const STAGES = [
  { id: 'eq', label: 'EQ', glyph: '≋' },
  { id: 'devices', label: 'Devices', glyph: '☰' },
  { id: 'radial', label: 'Radial Pulse', glyph: '◎' },
  { id: 'orbit', label: 'Orbit', glyph: '⊙' },
  { id: 'bloom', label: 'Bloom', glyph: '✺' },
  { id: 'smoke', label: 'Smoke', glyph: '☁' },
  { id: 'spectro', label: 'Spectrogram', glyph: '▤' },
  { id: 'lights', label: 'Light Grid', glyph: '▦' },
  { id: 'room', label: 'Listeners', glyph: '☻' },
  { id: 'info', label: 'Track Info', glyph: 'ⓘ' },
];
// Auto-director presets + generic per-director visual settings
const DIRECTOR_SETTINGS = [
  { key: 'autoColor', label: 'Auto-color from audio' },
  { key: 'laserOn', label: 'Lasers on' },
  { key: 'laserMove', label: 'Roam light source' },
  { key: 'laserFlash', label: 'Multi-point flashes' },
  { key: 'dropFx', label: 'Fireworks on drops' },
  { key: 'bgAuto', label: 'Cycle background' },
];
const LASER_EFFECTS = ['sweep', 'strobe', 'flash', 'beat'];
const LASER_PATTERNS = ['fan', 'parallel', 'scan', 'random'];
// "More Auto" — director presets that auto-pilot the stage with no hand on the controls
// Each non-manual program carries `apply` — module settings it pushes into the
// console when selected (so the modules visibly update), plus behavior (cadence,
// energy, stage-cycle). `behaviorOnly` programs change ONLY cadence/energy and
// leave your module config untouched.
const DIRECTORS = [
  { id: 'off', label: 'Manual', glyph: '✋', blurb: 'You drive the stage — nothing automated.' },
  { id: 'chill', label: 'Chill', glyph: '◐', blurb: 'Slow cross-fades · soft color drift · no strobe', cycleSec: 24, stages: ['bloom', 'orbit', 'radial'], laser: 'sweep', energy: 32,
    apply: { laserOn: true, laserEffect: 'sweep', laserPattern: 'fan', laserFlash: false, laserMove: false, autoColor: true, bgAuto: true, bgFlash: false, dropFx: false } },
  { id: 'club', label: 'Club', glyph: '◉', blurb: 'Beat-synced lasers · auto-color · drops trigger FX', cycleSec: 14, stages: ['eq', 'radial', 'spectro'], laser: 'beat', energy: 60,
    apply: { laserOn: true, laserEffect: 'beat', laserPattern: 'fan', laserFlash: true, laserMove: true, autoColor: true, bgAuto: false, bgFlash: false, dropFx: true } },
  { id: 'hype', label: 'Hype', glyph: '✺', blurb: 'Fast cuts · strobe on drops · fireworks', cycleSec: 8, stages: ['devices', 'lights', 'radial', 'spectro'], laser: 'strobe', energy: 84,
    apply: { laserOn: true, laserEffect: 'strobe', laserPattern: 'scan', laserFlash: true, laserMove: true, autoColor: true, bgAuto: false, bgFlash: true, bgFlashHz: 4, dropFx: true } },
  { id: 'pulse', label: 'Pulse', glyph: '◎', blurb: 'Everything breathes on the beat — your modules kept as-is.', cycleSec: 12, stages: ['radial', 'bloom'], laser: 'beat', energy: 56, behaviorOnly: true },
  { id: 'drift', label: 'Drift', glyph: '☁', blurb: 'Colored smoke · slow hue drift · gentle lasers', cycleSec: 20, stages: ['smoke', 'bloom'], laser: 'sweep', energy: 40,
    apply: { laserOn: true, laserEffect: 'sweep', laserPattern: 'parallel', laserFlash: false, laserMove: true, autoColor: true, bgAuto: true, bgFlash: false, dropFx: false } },
  { id: 'strobe', label: 'Strobe', glyph: '⚡', blurb: 'Hard strobe + multi-point flashes every phrase', cycleSec: 10, stages: ['lights', 'eq'], laser: 'strobe', energy: 78,
    apply: { laserOn: true, laserEffect: 'strobe', laserPattern: 'random', laserFlash: true, laserMove: false, autoColor: false, bgAuto: false, bgFlash: true, bgFlashHz: 6, dropFx: true } },
  { id: 'minimal', label: 'Minimal', glyph: '·', blurb: 'One calm layer · lasers off — lets the music sit.', cycleSec: 28, stages: ['orbit'], laser: 'sweep', energy: 22,
    apply: { laserOn: false, laserFlash: false, laserMove: false, autoColor: false, bgAuto: false, bgFlash: false, dropFx: false } },
];

// Plan tab — actionable fixes derived from the analysis results
const PLAN_ITEMS = [
  { id: 'pl1', tag: 'LOUDNESS', color: 'var(--orange)', title: 'Tame the master for streaming', detail: '−11.2 → −14 LUFS · −1 dBTP ceiling', fix: 'limiter ceiling −1.0 dBTP', apply: { limiter: { enabled: true, ceilingDb: -1.0 } } },
  { id: 'pl2', tag: 'LOW END', color: 'var(--violet)', title: 'Clear sub/kick masking at 65 Hz', detail: 'EQ −2 dB @ 120 Hz + sidechain', fix: 'EQ bell −2 dB @ 120 Hz', apply: { eq: { enabled: true } } },
  { id: 'pl3', tag: 'AIR', color: 'var(--cyan)', title: 'Lift the top end', detail: '+2 dB high-shelf @ 12 kHz', fix: 'high-shelf +2 dB @ 12 kHz', apply: { eq: { enabled: true } } },
  { id: 'pl4', tag: 'STEREO', color: 'var(--blue)', title: 'Mono the sub below 120 Hz', detail: 'M/S mono-maker @ 120 Hz', fix: 'mono-maker @ 120 Hz', apply: { ms: { enabled: true, monoMakerHz: 120 } } },
  { id: 'pl5', tag: 'GLUE', color: 'var(--yellow)', title: 'Glue the mix with bus comp', detail: '2:1 · slow attack · 1–2 dB GR', fix: 'comp 2:1 @ −18 dB', apply: { comp: { enabled: true, thresholdDb: -18, ratio: 2 } } },
];

const BG_COLORS = ['#00e5b0', '#34d399', '#22d3ee', '#60a5fa', '#818cf8', '#a78bfa', '#f472b6', '#f43f5e', '#fb923c', '#fbbf24'];

Object.assign(window, {
  MODULE_DEFAULTS, DEFAULT_ORDER, RACK_MANIFEST, PITCH_MODULE, MANIFEST_BY_ID,
  MASTERING_IDS, CREATIVE_IDS, EQ_BANDS_DEFAULT, fmtVal,
  TRACK, COACH_SUGGESTIONS, ROOM_LISTENERS, ROOM_REACTIONS, REACTION_EMOJI,
  STAGES, LASER_EFFECTS, LASER_PATTERNS, DIRECTOR_SETTINGS, DIRECTORS, PLAN_ITEMS, REACTION_GROUPS, BG_COLORS,
});
