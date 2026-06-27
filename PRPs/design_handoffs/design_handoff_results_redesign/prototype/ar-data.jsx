/* spectre — Analysis Results redesign. Mock data: two scenarios (deep / short).
   Shapes follow uploads/analysis-data-contract.md. In production these derive from
   finalJson.phases[] + verdicts; here they are pre-shaped for the UI. */

// ── Severity model ───────────────────────────────────────────────────
const AR_SEV = {
  critical: { label: 'Critical', color: 'var(--sev-critical)', rank: 0 },
  severe:   { label: 'Severe',   color: 'var(--sev-severe)',   rank: 1 },
  moderate: { label: 'Moderate', color: 'var(--sev-moderate)', rank: 2 },
  minor:    { label: 'Minor',    color: 'var(--sev-minor)',    rank: 3 },
  win:      { label: 'Win',      color: 'var(--sev-win)',      rank: 4 },
};
const arSevColor = (s) => (AR_SEV[s] || AR_SEV.minor).color;

// ── Finding groups ───────────────────────────────────────────────────
const AR_GROUPS = ['Spectrum', 'Loudness', 'Dynamics', 'Stereo', 'Sections', 'Stems', 'Misc'];
const AR_GROUP_COLOR = {
  Spectrum: '#00e5b0', Loudness: '#fb923c', Dynamics: '#a78bfa', Stereo: '#7aa2f7',
  Sections: '#c084fc', Stems: '#f472b6', Misc: '#60a5fa',
};

// ── Specialist catalog (26 across 7 groups; 4 stems-only) ────────────
const AR_SPECIALISTS = [
  { slug: 'low_end', label: 'Low End', group: 'Spectrum', icon: 'wave' },
  { slug: 'frequency_balance', label: 'Frequency Balance', group: 'Spectrum', icon: 'chart' },
  { slug: 'frequency_collision', label: 'Frequency Collisions', group: 'Spectrum', icon: 'collision' },
  { slug: 'clarity', label: 'Clarity', group: 'Spectrum', icon: 'sparkle' },
  { slug: 'harmonic', label: 'Harmonic Content', group: 'Spectrum', icon: 'music' },
  { slug: 'loudness', label: 'Loudness', group: 'Loudness', icon: 'sliders' },
  { slug: 'gain_staging', label: 'Gain Staging', group: 'Loudness', icon: 'sliders' },
  { slug: 'playback', label: 'Playback Targets', group: 'Loudness', icon: 'target' },
  { slug: 'dynamics', label: 'Dynamics', group: 'Dynamics', icon: 'pulse' },
  { slug: 'humanization', label: 'Humanization', group: 'Dynamics', icon: 'users' },
  { slug: 'density', label: 'Density / Busyness', group: 'Dynamics', icon: 'layers' },
  { slug: 'stereo_phase', label: 'Stereo Phase', group: 'Stereo', icon: 'spatial' },
  { slug: 'stereo_field', label: 'Stereo Field', group: 'Stereo', icon: 'spatial' },
  { slug: 'spatial', label: 'Spatial', group: 'Stereo', icon: 'spatial' },
  { slug: 'surround', label: 'Mono Compatibility', group: 'Stereo', icon: 'target' },
  { slug: 'sections', label: 'Sections', group: 'Sections', icon: 'layers' },
  { slug: 'section_contrast', label: 'Section Contrast', group: 'Sections', icon: 'layers' },
  { slug: 'trance_arrangement', label: 'Trance Arrangement', group: 'Sections', icon: 'music' },
  { slug: 'chord_harmony', label: 'Chord / Harmony', group: 'Sections', icon: 'music' },
  { slug: 'device_chain', label: 'Device Chain', group: 'Sections', icon: 'sliders' },
  { slug: 'stem_reference', label: 'Stem Reference', group: 'Stems', icon: 'layers', needsStems: true },
  { slug: 'stem_balance', label: 'Stem Balance', group: 'Stems', icon: 'sliders', needsStems: true },
  { slug: 'stem_stereo_width', label: 'Stem Stereo Width', group: 'Stems', icon: 'spatial', needsStems: true },
  { slug: 'stem_reference_delta', label: 'Stem Reference Δ', group: 'Stems', icon: 'chart', needsStems: true },
  { slug: 'overall', label: 'Overall Score', group: 'Misc', icon: 'sparkle' },
  { slug: 'priority_summary', label: 'Priority Summary', group: 'Misc', icon: 'target' },
];

// ── 7-band tonal labels ──────────────────────────────────────────────
const AR_BAND_LABELS = [
  { key: 'sub_bass', label: 'Sub', hz: '20–60' },
  { key: 'bass', label: 'Bass', hz: '60–250' },
  { key: 'low_mid', label: 'Lo-mid', hz: '250–500' },
  { key: 'mid', label: 'Mid', hz: '0.5–2k' },
  { key: 'upper_mid', label: 'Hi-mid', hz: '2–4k' },
  { key: 'presence', label: 'Pres', hz: '4–8k' },
  { key: 'air', label: 'Air', hz: '8–20k' },
];

// ══════════════════════════════════════════════════════════════════════
// DEEP scenario — full inputs (mix + stems + .als + reference), real fixes
// ══════════════════════════════════════════════════════════════════════
const AR_DEEP = {
  id: 'deep',
  track: { name: 'Lumen', version: 'v3', hue: 168, durationSec: 402, duration: '6:42' },
  inputs: { mix: { on: true, name: 'lumen_master_v3.wav', meta: '48k · 24-bit' },
            stems: { on: true, count: 9, name: '9 stems · roles mapped' },
            als: { on: true, name: 'lumen_v3.als', meta: 'Live 12.1' },
            ref: { on: true, name: 'Anjuna ref · 4 tracks', meta: 'profile' } },

  loudness: {
    lufs: -8.2, lufsTargetStream: -14, rms: -11.4, peakDbfs: -0.3, truePeakDb: 0.4,
    dynamicRange: 6.1, clipping: { detected: true, count: 142 },
  },
  bands: [ // db + genre median
    { ...AR_BAND_LABELS[0], db: -7.1, med: -7.6, tone: 'ok' },
    { ...AR_BAND_LABELS[1], db: -6.4, med: -7.0, tone: 'ok' },
    { ...AR_BAND_LABELS[2], db: -8.9, med: -12.4, tone: 'warn' },
    { ...AR_BAND_LABELS[3], db: -13.2, med: -13.0, tone: 'ok' },
    { ...AR_BAND_LABELS[4], db: -16.8, med: -16.0, tone: 'ok' },
    { ...AR_BAND_LABELS[5], db: -22.4, med: -21.0, tone: 'ok' },
    { ...AR_BAND_LABELS[6], db: -31.8, med: -27.5, tone: 'low' },
  ],
  stereo: { width: 0.62, correlation: 0.41, monoCompat: 0.88 },
  clashes: [
    { pair: 'Kick × Bass', range: '60–90 Hz', severity: 'high', note: 'Both peak near 70 Hz with no carve between them — the low end pumps instead of locking. The fix sidechains the bass to the kick.' },
  ],
  translation: { systems: [{ name: 'Phone', rating: 'good' }, { name: 'Laptop', rating: 'good' }, { name: 'Club', rating: 'great' }], note: 'Holds up across systems. The one caveat: the true-peak clipping becomes audible on lossy phone playback — fix that and it reads clean everywhere.' },
  meta: { bpm: 138, key: 'A min', keyConf: 0.93, genre: 'Trance', genreConf: 0.91 },

  // Reference tab — chosen-target comparison (phase 5 + phase 6). Profile-led,
  // single ref track as ◇ overlay. Only present when a reference is attached.
  reference: {
    profile: { kind: 'user', name: 'Anjuna ref', hue: 168, trackCount: 4, source: 'Your reference set' },
    refTrack: { title: 'Lifelong', artist: 'Anjunabeats' },
    percentile: 78, inRange: 4, total: 6,
    takeaway: 'You track the Anjuna profile closely — the master just runs hotter and the top end darker than your reference set.',
    metrics: [
      { key: 'lufs', label: 'Integrated loudness', unit: 'LUFS', dom: [-18, -4], mean: -9.6, range: [-11.4, -7.8], user: -8.2, ref: -9.1, pct: 90, inRange: false, findingId: 'f4' },
      { key: 'true_peak', label: 'True peak', unit: 'dBTP', dom: [-6, 1.5], mean: -1.1, range: [-2.3, -0.3], user: 0.4, ref: -0.9, pct: 96, inRange: false, findingId: 'f1' },
      { key: 'dynamic_range', label: 'Dynamic range', unit: 'LU', dom: [2, 14], mean: 7.2, range: [5.4, 9.0], user: 6.1, ref: 7.6, pct: 38, inRange: true },
      { key: 'stereo_width', label: 'Stereo width', unit: '', dom: [0, 1], mean: 0.58, range: [0.44, 0.72], user: 0.62, ref: 0.60, pct: 56, inRange: true },
      { key: 'stereo_corr', label: 'Stereo correlation', unit: '', dom: [-1, 1], mean: 0.46, range: [0.28, 0.64], user: 0.41, ref: 0.48, pct: 44, inRange: true },
      { key: 'bpm', label: 'Tempo', unit: 'BPM', dom: [120, 150], mean: 138, range: [135, 141], user: 138, ref: 138, pct: 50, inRange: true },
    ],
    bands: {
      user: [-7.1, -6.4, -8.9, -13.2, -16.8, -22.4, -31.8],
      mean: [-7.4, -6.8, -12.0, -13.5, -16.2, -21.6, -27.0],
      std:  [1.5, 1.4, 1.6, 1.3, 1.4, 1.6, 2.0],
      ref:  [-7.0, -6.6, -11.4, -13.0, -16.0, -21.0, -26.2],
      out:  [false, false, true, false, false, false, true],
      findingId: { 2: 'f2', 6: 'f6' },
    },
  },

  // streaming readiness rows computed vs loudness above
  streaming: [
    { platform: 'Spotify', target: -14, lufsOk: false, tpOk: false, clipOk: false },
    { platform: 'Apple Music', target: -16, lufsOk: false, tpOk: false, clipOk: false },
    { platform: 'YouTube', target: -14, lufsOk: false, tpOk: false, clipOk: false },
    { platform: 'Tidal', target: -14, lufsOk: false, tpOk: false, clipOk: false },
    { platform: 'Amazon Music', target: -14, lufsOk: false, tpOk: false, clipOk: false },
    { platform: 'SoundCloud', target: -10, lufsOk: false, tpOk: false, clipOk: false },
    { platform: 'Beatport', target: -8, lufsOk: true, tpOk: false, clipOk: false },
  ],

  findings: [
    { id: 'f1', sev: 'critical', group: 'Loudness', source: 'measured', spec: 'True-Peak',
      headline: 'Master clips on true-peak (+0.4 dBTP)', metric: 'true peak +0.4 dBTP · 142 clipped samples',
      summary: 'Inter-sample peaks cross 0 dBFS, so lossy encoders (AAC/Ogg) will distort on playback even though the sample peak reads under.',
      why: 'Streaming platforms transcode to lossy formats where inter-sample overshoots become audible clipping. A true-peak ceiling at −1.0 dBTP keeps you clean through every codec.',
      evidence: [{ label: 'True peak +0.4 dBTP', anchor: 'loudness' }, { label: '142 clipped samples', anchor: 'loudness' }], fixId: 'm1' },
    { id: 'f2', sev: 'severe', group: 'Spectrum', source: 'measured', spec: 'Low End',
      headline: 'Low-mids are congested around 280 Hz', metric: 'low-mid +3.5 dB vs genre median',
      summary: 'The 250–500 Hz band sits 3.5 dB above the trance median — the mix reads boxy and the kick loses punch.',
      why: 'Energy stacking in the low-mids masks transients and muddies the vocal/lead. Trance references keep this band scooped so the sub and the lead both breathe.',
      evidence: [{ label: 'Lo-mid +3.5 dB', anchor: 'bands' }], fixId: 'm2' },
    { id: 'f3', sev: 'severe', group: 'Stems', source: 'ai', spec: 'Frequency Collisions',
      headline: 'Kick and bass collide at 60–90 Hz', metric: 'overlap 7.2 dB · kick vs bass',
      summary: 'Kick and bass stems both peak around 70 Hz with no carve between them, so the low end pumps instead of locking.',
      why: 'When kick and bass share the same fundamental the system can only reproduce one cleanly — sidechain or a complementary EQ carve lets each occupy its own pocket.',
      evidence: [{ label: 'kick vs bass · 70 Hz', anchor: 'bands' }], fixId: 'm4' },
    { id: 'f4', sev: 'moderate', group: 'Loudness', source: 'measured', spec: 'Loudness',
      headline: 'Master is hot for streaming (−8.2 LUFS)', metric: '−8.2 LUFS · target −14',
      summary: 'Integrated loudness is 5.8 LU above the Spotify/YouTube target, so the platform turns it down and your dynamics get squashed relative to peers.',
      why: 'Loudness normalization means a hotter master just gets attenuated on playback — you keep the squash and lose the impact. Club/Beatport is the exception where −8 fits.',
      evidence: [{ label: '−8.2 LUFS', anchor: 'loudness' }], fixId: 'm3' },
    { id: 'f5', sev: 'minor', group: 'Stereo', source: 'ai', spec: 'Stereo Field',
      headline: 'Breakdown pads collapse toward mono', metric: 'width 0.34 in 3:10–3:48',
      summary: 'During the breakdown the pad bus narrows to near-mono while the rest of the track stays wide — the section loses its lift.',
      why: 'A widening move on the pad bus in the breakdown restores contrast against the drop. Keep it mid-safe so mono playback (clubs) still holds together.',
      evidence: [{ label: 'width 0.34 · 3:10', anchor: 'stereo' }], fixId: 'm5' },
    { id: 'f6', sev: 'minor', group: 'Spectrum', source: 'measured', spec: 'Frequency Balance',
      headline: 'Air band sits below the genre median', metric: 'air −4.3 dB vs median',
      summary: 'Above 8 kHz the mix is 4.3 dB darker than reference trance — it reads slightly dull on bright systems.',
      why: 'A gentle high shelf opens the top without harshness. Small move; it lifts perceived clarity and the hats.',
      evidence: [{ label: 'air −4.3 dB', anchor: 'bands' }], fixId: 'm6' },
    { id: 'f7', sev: 'win', group: 'Sections', source: 'ai', spec: 'Section Contrast',
      headline: 'Energy contrast between sections is excellent', metric: 'contrast 11.2 dB',
      summary: 'The breakdown-to-drop transition lands an 11.2 dB energy lift — well inside the pro trance range. Leave it alone.',
      why: null, evidence: [{ label: 'contrast 11.2 dB', anchor: null }], fixId: null },
  ],

  moves: [
    { id: 'm1', findingId: 'f1', findingHead: 'Master clips on true-peak', chip: '+0.4 dBTP', sev: 'critical', conf: 0.96,
      title: 'Tame the true-peak overshoot on the master', scope: 'Master bus', source: 'rule engine', rackable: true,
      directive: 'Bring the limiter ceiling to `−1.0 dBTP` and turn on `4×` true-peak oversampling — stops inter-sample peaks from clipping through lossy codecs.',
      evidence: { type: 'meter', label: '+0.4 dBTP', path: 'phase1.true_peak_db', value: 0.4, min: -6, max: 1.5, target: 0, targetLabel: 'ceiling', hot: true } },
    { id: 'm2', findingId: 'f2', findingHead: 'Low-mids congested ~280 Hz', chip: '280 Hz', sev: 'severe', conf: 0.88,
      title: 'Carve the low-mid congestion', scope: 'Master EQ', source: 'rule engine', rackable: true,
      directive: 'Drop a peaking bell `−2.5 dB` at `280 Hz`, `Q 1.2` — clears the boxiness so the kick and lead breathe.',
      evidence: { type: 'spectrum', label: 'low-mid −8.9 dB · +3.5 vs median', path: 'phase1.bands.low_mid', warnIndex: 2 } },
    { id: 'm3', findingId: 'f4', findingHead: 'Master hot for streaming', chip: '−8.2 LUFS', sev: 'moderate', conf: 0.84,
      title: 'Bring the master to streaming loudness', scope: 'Master bus', source: 'rule engine', rackable: true,
      directive: 'Pull `−5.5 dB` of input gain into the limiter to land at `−14 LUFS` for Spotify/YouTube — keep a separate `−8 LUFS` bounce for Beatport.',
      evidence: { type: 'meter', label: '−8.2 LUFS · target −14', path: 'phase1.lufs', value: -8.2, min: -24, max: 0, target: -14, targetLabel: '−14', hot: true } },
    { id: 'm4', findingId: 'f3', findingHead: 'Kick vs bass clash @ 70 Hz', chip: 'kick × bass', sev: 'severe', conf: 0.79, section: '0:00–6:42',
      title: 'Resolve the kick / bass clash at 70 Hz', scope: 'Bass stem', source: 'Frequency Collisions', rackable: true,
      directive: 'Sidechain the bass to the kick (`−4 dB`, `90 ms`) and notch `−3 dB` at `70 Hz` — in the .als, add a Compressor keyed off the Kick on the Bass track.',
      evidence: { type: 'spectrum', label: 'kick vs bass · 60–90 Hz overlap 7.2 dB', path: 'phase4.clashes[0]', warnIndex: 1 } },
    { id: 'm5', findingId: 'f5', findingHead: 'Breakdown pads near-mono', chip: '3:10–3:48', sev: 'minor', conf: 0.66, section: '3:10–3:48',
      title: 'Widen the breakdown pads', scope: 'Pad bus', source: 'Stereo Field', rackable: true,
      directive: 'Widen the pad bus `+18%` M/S across the breakdown — opens it against the drop while the mono sum stays intact.',
      evidence: { type: 'meter', label: 'width 0.34 in 3:10–3:48', path: 'phase1.stereo_width', value: 0.34, min: 0, max: 1, target: 0.62, targetLabel: 'track' } },
    { id: 'm6', findingId: 'f6', findingHead: 'Air below genre median', chip: '12 kHz', sev: 'minor', conf: 0.72,
      title: 'Add a touch of air', scope: 'Master EQ', source: 'rule engine', rackable: true,
      directive: 'Add a high shelf `+1.5 dB` at `12 kHz` — lifts the hats and pads without harshness.',
      evidence: { type: 'spectrum', label: 'air −31.8 dB · −4.3 vs median', path: 'phase1.bands.air', warnIndex: 6 } },
  ],

  // per-phase explainers (Analysis tab)
  phases: [
    { phase: 1, friendly: 'Universal Mix', measures: 'Loudness, peaks, tempo, key, tone balance, stereo health, clipping', status: 'ok',
      values: [{ k: 'LUFS', v: '−8.2' }, { k: 'True peak', v: '+0.4 dBTP', accent: false }, { k: 'BPM', v: '138' }, { k: 'Key', v: 'A min' }],
      meaning: 'Your master is loud and punchy but it clips on true-peak and runs hot for streaming. Tone balance is solid apart from a low-mid bump.' },
    { phase: 2, friendly: 'Genre Detection', measures: 'Classifies the track so every later check uses the right reference', status: 'ok',
      values: [{ k: 'Genre', v: 'Trance', accent: true }, { k: 'Confidence', v: '91%' }, { k: 'BPM', v: '138' }],
      meaning: 'High-confidence trance. All genre-relative checks (tonal medians, arrangement, gap analysis) are calibrated to trance.' },
    { phase: 3, friendly: 'Genre Scoring', measures: 'Scores the mix against a genre-specific rubric', status: 'ok',
      values: [{ k: 'Freq balance', v: '82' }, { k: 'Stereo', v: '74' }, { k: 'Dynamics', v: '61' }],
      meaning: 'Strong frequency and stereo scores; dynamics is dragged down by the heavy limiting. Addressing loudness will lift it.' },
    { phase: 4, friendly: 'Stem Separation & Clash', measures: 'Per-stem band energy and frequency-clash detection', status: 'ok',
      values: [{ k: 'Stems', v: '9' }, { k: 'Clashes', v: '1', accent: true }],
      meaning: 'Your 9 stems were analyzed directly. One real clash: kick vs bass at 70 Hz — see the fix in Actions.' },
    { phase: 5, friendly: 'Reference Comparison', measures: 'Compares your mix to an attached reference / genre preset', status: 'ok',
      values: [{ k: 'Profile', v: 'Anjuna ref' }, { k: 'Tracks', v: '4' }, { k: 'Match', v: '78%' }],
      meaning: 'Measured against your 4-track Anjuna reference profile. You track it well except for the hotter loudness and darker air.' },
    { phase: 6, friendly: 'Gap Analysis', measures: 'Positions each metric against a statistical profile of pro tracks', status: 'ok',
      values: [{ k: 'Percentile', v: '74th', accent: true }, { k: 'Profile', v: 'house/trance · 347' }],
      meaning: 'Overall you sit in the 74th percentile of the genre profile. The low-mid and air bands are the two metrics outside the acceptable range.' },
    { phase: 7, friendly: 'Arrangement', measures: 'Section structure, 8-bar phrasing, energy contrast', status: 'ok',
      values: [{ k: 'Sections', v: '7' }, { k: 'Contrast', v: '11.2 dB', accent: true }, { k: 'Grade', v: 'A−' }],
      meaning: 'Intro → build → breakdown → drop → outro all present and 8-bar compliant. Energy contrast is excellent — this is a strength.' },
    { phase: 8, friendly: 'Ableton Project', measures: 'Reads your .als for device clutter, MIDI health, arrangement markers', status: 'ok',
      values: [{ k: 'Health', v: '86' }, { k: 'Tracks', v: '24' }, { k: 'Disabled dev', v: '7' }],
      meaning: 'Project is healthy. A handful of disabled devices add CPU clutter; MIDI is humanized. See the Project tab.' },
    { phase: 9, friendly: 'Mix Translation', measures: 'Predicts how the mix holds up on phones, laptops, club systems', status: 'ok',
      values: [{ k: 'Phone', v: 'good' }, { k: 'Laptop', v: 'good' }, { k: 'Club', v: 'great', accent: true }],
      meaning: 'Translates well everywhere; the only caveat is the true-peak clipping showing up on lossy phone playback.' },
  ],

  project: {
    health: 86, grade: 'B+', tempo: 138, version: 'Live 12.1', timeSig: '4/4',
    totalDevices: 118, disabledDevices: 7, clutterPct: 6,
    tracks: [
      { name: 'Kick', type: 'audio', muted: false, chain: [{ n: 'Drum Buss' }, { n: 'EQ Eight' }, { n: 'Glue Compressor' }, { n: 'Saturator' }] },
      { name: 'Bass', type: 'midi', muted: false, chain: [{ n: 'Operator' }, { n: 'EQ Eight' }, { n: 'Compressor' }, { n: 'OTT' }, { n: 'Saturator' }, { n: 'Utility', off: true }] },
      { name: 'Reese', type: 'midi', muted: false, chain: [{ n: 'Serum' }, { n: 'EQ Eight' }, { n: 'Chorus-Ensemble' }, { n: 'Auto Filter' }, { n: 'OTT' }, { n: 'Phaser', off: true }, { n: 'Utility' }, { n: 'Limiter', off: true }] },
      { name: 'Pluck Lead', type: 'midi', muted: false, chain: [{ n: 'Serum' }, { n: 'EQ Eight' }, { n: 'Reverb' }, { n: 'Ping Pong Delay' }, { n: 'Compressor' }, { n: 'Saturator' }, { n: 'Utility' }] },
      { name: 'Pad Bus', type: 'audio', muted: false, chain: [{ n: 'EQ Eight' }, { n: 'Reverb' }, { n: 'Chorus-Ensemble' }, { n: 'Auto Pan' }, { n: 'Utility', off: true }] },
      { name: 'Hats', type: 'audio', muted: false, chain: [{ n: 'EQ Eight' }, { n: 'Transient Shaper' }, { n: 'Reverb' }] },
      { name: 'FX / Risers', type: 'audio', muted: false, chain: [{ n: 'EQ Eight' }, { n: 'Reverb' }, { n: 'Delay' }, { n: 'Auto Filter' }, { n: 'Erosion', off: true }, { n: 'Frequency Shifter', off: true }, { n: 'Gate' }, { n: 'Compressor' }, { n: 'Utility', off: true }] },
      { name: 'Vocal Chop', type: 'audio', muted: true, chain: [{ n: 'Sampler' }, { n: 'EQ Eight' }, { n: 'Reverb' }, { n: 'Delay' }, { n: 'Vocoder' }, { n: 'Utility' }] },
    ],
    midi: { humanized: true, quantIssues: 2, notes: 4820, clips: 96 },
    midiIssues: [
      { sev: 'minor', track: 'Reese', text: 'Two clips are hard-quantized to 1/16 — slight stiffness vs the rest of the arrangement.' },
      { sev: 'minor', track: 'Pluck Lead', text: 'Velocity range is narrow (98–104); widening adds movement to the lead.' },
    ],
    plugins: ['Serum', 'EQ Eight', 'Glue Compressor', 'Pro-L 2', 'Valhalla VintageVerb', 'OTT', 'Saturator', 'FabFilter Pro-Q 3'],
    arrangement: [
      { name: 'Intro', bars: 16 }, { name: 'Build', bars: 16 }, { name: 'Breakdown', bars: 32 },
      { name: 'Drop', bars: 32 }, { name: 'Mid', bars: 24 }, { name: 'Drop 2', bars: 32 }, { name: 'Outro', bars: 16 },
    ],
  },

  coachSeed: [
    { role: 'bot', text: "I went through Lumen — it's in good shape. The one thing I'd fix before anything else is the **true-peak clipping** on the master; it'll distort on phones. After that the low-mid carve is the biggest tonal win.", gnd: ['true peak +0.4 dBTP', 'low-mid +3.5 dB'] },
  ],

  // specialists run-state for the deep scenario
  specSuggested: 5,
  specRuns: { low_end: { found: 1 }, frequency_balance: { found: 0 }, frequency_collision: { found: 1 },
    loudness: { found: 1 }, stereo_field: { found: 1 }, section_contrast: { found: 1 },
    dynamics: { found: 0 }, trance_arrangement: { found: 0 } },
};

// ══════════════════════════════════════════════════════════════════════
// SHORT scenario — the real 9s payload (mix only, no stems/.als/ref, "other")
// ══════════════════════════════════════════════════════════════════════
const AR_SHORT = {
  id: 'short',
  track: { name: 'Untitled Idea', version: 'v1', hue: 28, durationSec: 9, duration: '0:09' },
  inputs: { mix: { on: true, name: 'idea_bounce.mp3', meta: 'MP3 · 320k' },
            stems: { on: false }, als: { on: false }, ref: { on: false } },

  loudness: {
    lufs: -16.9, lufsTargetStream: -14, rms: -21.9, peakDbfs: -3.3, truePeakDb: -7.8,
    dynamicRange: 10.5, clipping: { detected: false, count: 0 },
  },
  bands: [
    { ...AR_BAND_LABELS[0], db: -37.4, med: -34.0, tone: 'ok' },
    { ...AR_BAND_LABELS[1], db: -32.8, med: -33.5, tone: 'ok' },
    { ...AR_BAND_LABELS[2], db: -34.8, med: -36.0, tone: 'ok' },
    { ...AR_BAND_LABELS[3], db: -35.2, med: -35.5, tone: 'ok' },
    { ...AR_BAND_LABELS[4], db: -48.4, med: -42.0, tone: 'low' },
    { ...AR_BAND_LABELS[5], db: -66.0, med: -52.0, tone: 'low' },
    { ...AR_BAND_LABELS[6], db: -79.4, med: -60.0, tone: 'low' },
  ],
  stereo: { width: 0.11, correlation: 0.12, monoCompat: 0.74 },
  clashes: [
    { pair: 'Low-end buildup', range: '20–200 Hz', severity: 'high', note: 'Sub and bass stack up — the bottom reads heavy and undefined. Upload stems to split it into kick vs bass.' },
    { pair: 'Low-mid congestion', range: '200–500 Hz', severity: 'high', note: 'Energy crowds the low-mids while presence and air fall away — the mix reads boxy and closed-in.' },
  ],
  translation: null,
  meta: { bpm: 184.6, key: 'D', keyConf: 0.44, genre: 'other', genreConf: 0.5 },

  streaming: [
    { platform: 'Spotify', target: -14, lufsOk: false, tpOk: true, clipOk: true },
    { platform: 'Apple Music', target: -16, lufsOk: true, tpOk: true, clipOk: true },
    { platform: 'YouTube', target: -14, lufsOk: false, tpOk: true, clipOk: true },
    { platform: 'Tidal', target: -14, lufsOk: false, tpOk: true, clipOk: true },
    { platform: 'Amazon Music', target: -14, lufsOk: false, tpOk: true, clipOk: true },
    { platform: 'SoundCloud', target: -10, lufsOk: false, tpOk: true, clipOk: true },
    { platform: 'Beatport', target: -8, lufsOk: false, tpOk: true, clipOk: true },
  ],

  findings: [
    { id: 'f1', sev: 'moderate', group: 'Spectrum', source: 'measured', spec: 'Low End',
      headline: 'Low-end buildup in the sub/bass', metric: 'sub + bass stacked (20–200 Hz)',
      summary: 'The 20–200 Hz region is carrying more energy than the rest of the spectrum — the bottom reads heavy and undefined.',
      why: 'Without stems we can see the buildup but not split it. Carve where the boom is and A/B it — or upload stems and we can pinpoint kick vs bass.',
      evidence: [{ label: 'sub/bass 20–200 Hz', anchor: 'bands' }], fixId: 'm1' },
    { id: 'f2', sev: 'moderate', group: 'Spectrum', source: 'measured', spec: 'Frequency Balance',
      headline: 'Low-mid congestion around 200–500 Hz', metric: 'low-mid heavy vs the top',
      summary: 'Energy stacks in the low-mids while presence and air fall away steeply — the mix reads boxy and closed-in.',
      why: 'A broad dip in the low-mids plus a lift up top would open this out. Exact values need a longer, fuller bounce to be safe.',
      evidence: [{ label: 'low-mid 200–500 Hz', anchor: 'bands' }], fixId: 'm2' },
    { id: 'f3', sev: 'minor', group: 'Loudness', source: 'measured', spec: 'Loudness',
      headline: 'Quiet for streaming (−16.9 LUFS)', metric: '−16.9 LUFS · target −14',
      summary: 'Integrated loudness sits below the Spotify/YouTube sweet spot, with plenty of headroom (peak −3.3 dBFS) to push.',
      why: 'You have room to bring this up — nudge the master ceiling and re-check. Small gain beats a big push; it stays clean.',
      evidence: [{ label: '−16.9 LUFS', anchor: 'loudness' }, { label: 'peak −3.3 dBFS', anchor: 'loudness' }], fixId: 'm3' },
    { id: 'f4', sev: 'minor', group: 'Stereo', source: 'measured', spec: 'Stereo Field',
      headline: 'Image is nearly mono', metric: 'width 0.11 · corr 0.12',
      summary: 'The track is very narrow — almost everything sits dead-centre. Intentional for a sketch, worth widening if it grows.',
      why: 'Narrow can be a choice. If you want space, widen pads/FX and keep the low end mono. Check it sums cleanly.',
      evidence: [{ label: 'width 0.11', anchor: 'stereo' }], fixId: 'm4' },
    { id: 'f5', sev: 'minor', group: 'Sections', source: 'measured', spec: 'Sections', kind: 'integrity',
      headline: 'Too short to assess arrangement', metric: '9 s · no sections detected',
      summary: 'Structure detection needs a fuller track — at 9 seconds there are no sections to score. Not a fault, just not applicable yet.',
      why: null, evidence: [], fixId: null },
  ],

  moves: [
    { id: 'm1', findingId: 'f1', findingHead: 'Low-end buildup (sub/bass)', chip: '20–200 Hz', sev: 'moderate', conf: 0.60,
      title: 'Carve the low-end buildup', scope: 'Master EQ', source: 'rule engine', rackable: true, directional: true,
      directive: 'Find where the boom sits in the low end and ease it back with a broad cut, then A/B on the Listen page. Upload stems to turn this into an exact kick-vs-bass move.',
      evidence: { type: 'spectrum', label: 'sub / bass stacked · 20–200 Hz', path: 'phase4.clashes[0]', warnIndex: 1 } },
    { id: 'm2', findingId: 'f2', findingHead: 'Low-mid congestion', chip: '200–500 Hz', sev: 'moderate', conf: 0.55,
      title: 'Open up the low-mids', scope: 'Master EQ', source: 'rule engine', rackable: true, directional: true,
      directive: 'Dip the boxy low-mids around the congestion and lift the top to taste. Directional only — a fuller bounce lets us pin the frequency and amount.',
      evidence: { type: 'spectrum', label: 'low-mid heavy vs the top', path: 'phase1.bands.low_mid', warnIndex: 2 } },
    { id: 'm3', findingId: 'f3', findingHead: 'Quiet for streaming', chip: '−16.9 LUFS', sev: 'minor', conf: 0.70,
      title: 'Push the master a touch louder', scope: 'Master bus', source: 'rule engine', rackable: true, directional: true,
      directive: 'You have headroom (peak `−3.3 dBFS`) — nudge the limiter ceiling up toward `−14 LUFS` and re-check. Small gain beats a big push.',
      evidence: { type: 'meter', label: '−16.9 LUFS · target −14', path: 'phase1.lufs', value: -16.9, min: -24, max: 0, target: -14, targetLabel: '−14' } },
    { id: 'm4', findingId: 'f4', findingHead: 'Nearly mono', chip: 'width 0.11', sev: 'minor', conf: 0.5,
      title: 'Add width — carefully', scope: 'Pad / FX', source: 'rule engine', rackable: true, directional: true,
      directive: 'If you want space, widen pads and FX while keeping the low end mono. Check the mono sum so nothing disappears.',
      evidence: { type: 'meter', label: 'width 0.11 · corr 0.12', path: 'phase1.stereo_width', value: 0.11, min: 0, max: 1, target: 0.5, targetLabel: 'wider' } },
  ],

  phases: [
    { phase: 1, friendly: 'Universal Mix', measures: 'Loudness, peaks, tempo, key, tone balance, stereo health, clipping', status: 'ok',
      values: [{ k: 'LUFS', v: '−16.9' }, { k: 'Peak', v: '−3.3 dBFS' }, { k: 'BPM', v: '184.6' }, { k: 'Key', v: 'D' }],
      meaning: 'Clean and quiet with headroom to spare. The image is nearly mono and the top end rolls off early — both worth a look as the idea grows.' },
    { phase: 2, friendly: 'Genre Detection', measures: 'Classifies the track so every later check uses the right reference', status: 'ok',
      values: [{ k: 'Genre', v: 'Uncategorized' }, { k: 'Confidence', v: '50%' }],
      meaning: "Couldn't confidently place the genre on a 9-second clip, so genre-relative checks fall back to a neutral profile. A fuller track will classify better." },
    { phase: 3, friendly: 'Genre Scoring', measures: 'Scores the mix against a genre-specific rubric', status: 'ok',
      values: [{ k: 'Freq balance', v: '77' }, { k: 'Stereo', v: '9', accent: false }],
      meaning: 'Scored against a neutral profile. Frequency balance is reasonable; the stereo score is very low because the track is almost mono.' },
    { phase: 4, friendly: 'Stem Separation & Clash', measures: 'Per-stem band energy and frequency-clash detection', status: 'ok',
      values: [{ k: 'Stems', v: 'none' }, { k: 'Buildups', v: '2', accent: true }],
      meaning: 'No stems uploaded, so this ran on the full mix only — it can see two low-end buildups but not which instruments cause them.' },
    { phase: 5, friendly: 'Reference Comparison', measures: 'Compares your mix to an attached reference / genre preset', status: 'skipped',
      values: [], meaning: 'Not applicable — no reference attached. Add a reference track or pick a profile to compare against.' },
    { phase: 6, friendly: 'Gap Analysis', measures: 'Positions each metric against a statistical profile of pro tracks', status: 'ok',
      values: [{ k: 'Percentile', v: '50th' }],
      meaning: "Without a confident genre there's no statistical profile to compare against, so this sits at a neutral 50th percentile." },
    { phase: 7, friendly: 'Arrangement', measures: 'Section structure, 8-bar phrasing, energy contrast', status: 'skipped',
      values: [], meaning: 'Not applicable — the track is too short to detect sections. This will populate once the arrangement is fleshed out.' },
    { phase: 8, friendly: 'Ableton Project', measures: 'Reads your .als for device clutter, MIDI health, arrangement markers', status: 'skipped',
      values: [], meaning: 'Not applicable — no .als uploaded. Drop your Ableton project to surface device clutter and MIDI health.' },
    { phase: 9, friendly: 'Mix Translation', measures: 'Predicts how the mix holds up on phones, laptops, club systems', status: 'skipped',
      values: [], meaning: 'Not assessed on a clip this short.' },
  ],

  project: null,

  coachSeed: [
    { role: 'bot', text: "This is an early sketch — only 9 seconds, so a lot of the deeper analysis is waiting on a fuller bounce. The two things I can already see: the low end is building up, and the image is almost **mono**. Want me to dig into either?", gnd: ['width 0.11', 'sub/bass 20–200 Hz'] },
  ],

  specSuggested: 5,
  specRuns: { low_end: { found: 1 }, frequency_balance: { found: 1 }, surround: { found: 1 } },
};

// ── Raw finalJson.phases per scenario (Debug tab + pipeline) ─────────
const AR_RAW = {
  deep: [
    { phase: 1, name: 'Universal Mix Analysis', status: 'ok', error: null, data: { bpm: 138.0, lufs: -8.21, rms: -11.4, peak_dbfs: -0.33, true_peak_db: 0.41, detected_key: 'A', key_detection_confidence: 0.93, duration_seconds: 402.4, mono_compatibility: 0.881, stereo_width: 0.62, stereo_correlation: 0.41, clipping_detected: true, clipped_sample_count: 142, bands: { sub_bass: -7.1, bass: -6.4, low_mid: -8.9, mid: -13.2, upper_mid: -16.8, presence: -22.4, air: -31.8 } } },
    { phase: 2, name: 'Genre Detection', status: 'ok', error: null, data: { bpm: 138.0, genre: 'trance', confidence: 0.91 } },
    { phase: 3, name: 'Genre-Specific Scoring', status: 'ok', error: null, data: { genre: 'trance', total_score: 78.4, sub_scores: { frequency_balance: 82, stereo_width: 74, dynamics: 61 }, notes: [] } },
    { phase: 4, name: 'Stem Separation & Clash', status: 'ok', error: null, data: { stems: { kick: {}, bass: {}, reese: {}, lead: {}, pad: {}, hats: {}, fx: {}, vox: {}, perc: {} }, band_energy: { sub_bass: 6.0, bass: 9.2, low_mid: 3.1, mid: -2.0, high_mid: -8.4, presence: -14.6, air: -22.1 }, clashes: [{ stems: 'kick vs bass', frequency_range: '60–90 Hz', severity: 'high' }] } },
    { phase: 5, name: 'Reference Comparison', status: 'ok', error: null, data: { status: 'ok', profile_kind: 'user', profile_name: 'Anjuna ref', track_count: 4, deltas: { lufs: 5.8, air: -4.3 } } },
    { phase: 6, name: 'Gap Analysis', status: 'ok', error: null, data: { genre: 'trance', percentile: 74.0, profile_source: 'house/trance_profile (347 tracks)', gaps: { low_mid: { user_val: -8.9, genre_mean: -12.4, delta: 3.5, percentile: 88, in_range: false }, air: { user_val: -31.8, genre_mean: -27.5, delta: -4.3, percentile: 22, in_range: false } } } },
    { phase: 7, name: 'Arrangement Advice', status: 'ok', error: null, data: { grade: 'A-', overall_score: 88, section_count: 7, energy_contrast_score: 92, metadata: { total_bars: 168, has_intro: true, has_buildup: true, has_drop: true, has_breakdown: true, has_outro: true, energy_contrast_db: 11.2 } } },
    { phase: 8, name: 'ALS Analysis', status: 'ok', error: null, data: { health_score: 86, grade: 'B+', tempo: 138, ableton_version: '12.1', total_devices: 118, disabled_devices: 7, clutter_pct: 6, midi_note_count: 4820, has_humanized_midi: true, quantization_issues_count: 2 } },
    { phase: 9, name: 'Mix Translation', status: 'ok', error: null, data: { phone: 'good', laptop: 'good', club: 'great', notes: ['true-peak clipping audible on lossy phone playback'] } },
  ],
  short: [
    { phase: 1, name: 'Universal Mix Analysis', status: 'ok', error: null, data: { bpm: 184.57, rms: 0.08, lufs: -16.885, peak_dbfs: -3.343, true_peak_db: -7.834, detected_key: 'D', key_detection_confidence: 0.44, duration_seconds: 9.221, low_energy: 8.282, stereo_width: 0.107, stereo_correlation: 0.118, mono_compatibility: 0.7435, clipping_detected: false, clipped_sample_count: 0, bands: { sub_bass: -37.44, bass: -32.77, low_mid: -34.84, mid: -35.16, upper_mid: -48.39, presence: -65.98, air: -79.44 }, structure: { beats: [], sections: [] } } },
    { phase: 2, name: 'Genre Detection', status: 'ok', error: null, data: { bpm: 184.57, genre: 'other', confidence: 0.5 } },
    { phase: 3, name: 'Genre-Specific Scoring', status: 'ok', error: null, data: { genre: 'other', total_score: 42.611, notes: [], sub_scores: { frequency_balance: 76.663, stereo_width: 8.559 } } },
    { phase: 4, name: 'Stem Separation & Clash', status: 'ok', error: null, data: { stems: {}, band_energy: { sub_bass: 7.03, bass: 22.72, low_mid: 14.44, mid: 16.41, high_mid: 6.8, presence: -14.62, air: -38.39 }, clashes: [{ stems: 'low-end buildup', severity: 'high', frequency_range: 'sub-bass / bass (20–200 Hz)' }, { stems: 'low-mid congestion', severity: 'high', frequency_range: 'low-mid (200–500 Hz)' }] } },
    { phase: 5, name: 'Reference Comparison', status: 'ok', error: null, data: { status: 'skipped', deltas: {}, genre_context: { genre: 'other', preset_name: 'other', checks: {} } } },
    { phase: 6, name: 'Gap Analysis', status: 'ok', error: null, data: { genre: 'other', percentile: 50.0, gaps: {} } },
    { phase: 7, name: 'Arrangement Advice', status: 'ok', error: null, data: { grade: 'F', overall_score: 0, section_count: 0, section_scores: [], suggestions: [], violations: ['Structure detection failed or no sections found'], issues: [{ severity: 'CRITICAL', section: null, message: 'Structure detection failed or no sections found', fix_suggestion: 'Ensure audio file is valid and long enough for structure detection' }], metadata: { total_bars: 0, section_count: 0, detected_tempo: null, has_intro: false, has_drop: false } } },
    { phase: 8, name: 'ALS Analysis', status: 'skipped', error: null, data: {} },
    { phase: 9, name: 'Mix Translation', status: 'skipped', error: null, data: {} },
  ],
};

// dependency edges for the pipeline diagram
const AR_PIPE_DEPS = { 1: [], 2: [1], 3: [2, 1], 4: [], 5: [1, 2], 6: [2, 1], 7: [1, 2], 8: [], 9: [1] };

const AR_SCENARIOS = { deep: AR_DEEP, short: AR_SHORT };

// ── Rack data — the DSP module(s) each fix compiles to (fix modal + Coach Mix) ──
const AR_MOD_META = {
  EQ: { accent: '#00e5b0', icon: 'sliders' },
  Limiter: { accent: '#fb923c', icon: 'target' },
  Gain: { accent: '#60a5fa', icon: 'sliders' },
  Comp: { accent: '#a78bfa', icon: 'pulse' },
  Width: { accent: '#7aa2f7', icon: 'spatial' },
};
const AR_RACK = {
  deep: {
    m1: [{ mod: 'Limiter', params: { Ceiling: '−1.0 dBTP', 'True-peak': '4× oversample' } }],
    m2: [{ mod: 'EQ', params: { Type: 'Bell @ 280 Hz', Gain: '−2.5 dB', Q: '1.2' } }],
    m3: [{ mod: 'Gain', params: { Input: '−5.5 dB', Target: '−14 LUFS' } }],
    m4: [{ mod: 'Comp', params: { Sidechain: 'Kick', Amount: '−4 dB', Release: '90 ms' } }, { mod: 'EQ', params: { Type: 'Bell @ 70 Hz', Gain: '−3 dB' } }],
    m5: [{ mod: 'Width', params: { 'Pad bus': '+18% M/S', Range: '3:10–3:48' } }],
    m6: [{ mod: 'EQ', params: { Type: 'High shelf @ 12 kHz', Gain: '+1.5 dB' } }],
  },
  short: {
    m1: [{ mod: 'EQ', params: { Type: 'Broad low cut', Range: '20–200 Hz', Set: 'by ear' } }],
    m2: [{ mod: 'EQ', params: { Type: 'Low-mid dip ≈300 Hz', Top: '+ to taste' } }],
    m3: [{ mod: 'Limiter', params: { Ceiling: '↑ toward −14 LUFS' } }],
    m4: [{ mod: 'Width', params: { 'Pads / FX': '+ width', 'Low end': 'keep mono' } }],
  },
};
function arRack(scenarioId, moveId) { return (AR_RACK[scenarioId] || {})[moveId] || []; }

// Coach Mix — consolidate the selected fixes into ONE calculated mastering rack
// (merged EQ curve, combined dynamics/loudness), not a device-per-fix stack.
function compileCoachMix(scenarioId, moves) {
  const mods = moves.flatMap(m => arRack(scenarioId, m.id));
  const eqBands = [], chain = [];
  let limiter = null, gain = null, width = null, comp = null;
  mods.forEach(rm => {
    if (rm.mod === 'EQ') eqBands.push(rm.params);
    else if (rm.mod === 'Limiter') limiter = rm.params;
    else if (rm.mod === 'Gain') gain = rm.params;
    else if (rm.mod === 'Width') width = rm.params;
    else if (rm.mod === 'Comp') comp = rm.params;
  });
  if (eqBands.length) {
    const params = {};
    eqBands.forEach((b) => {
      const parts = [];
      if (b.Gain) parts.push(b.Gain);
      if (b.Q) parts.push(`Q ${b.Q}`);
      Object.entries(b).forEach(([k, v]) => { if (!['Type', 'Gain', 'Q'].includes(k)) parts.push(v); });
      params[b.Type || 'Band'] = parts.join(' · ') || '—';
    });
    chain.push({ mod: 'EQ', sub: `${eqBands.length} ${eqBands.length === 1 ? 'band' : 'bands'} · solved together`, params });
  }
  if (comp) chain.push({ mod: 'Comp', sub: 'glue · low end stays locked', params: comp });
  if (width) chain.push({ mod: 'Width', sub: 'mid-safe', params: width });
  if (limiter || gain) {
    const params = {};
    if (gain && gain.Input) params['Input gain'] = gain.Input;
    if (limiter) Object.assign(params, limiter);
    if (gain && gain.Target) params['Loudness'] = gain.Target;
    chain.push({ mod: 'Limiter', sub: 'true-peak safe · hits target', params });
  }
  return chain;
}

// ── helpers ──────────────────────────────────────────────────────────
function arFmtTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
function arWorstSev(findings) {
  const faults = findings.filter(f => f.sev !== 'win');
  if (!faults.length) return 'win';
  return faults.reduce((w, f) => AR_SEV[f.sev].rank < AR_SEV[w].rank ? f.sev : w, 'minor');
}

Object.assign(window, {
  AR_SEV, arSevColor, AR_GROUPS, AR_GROUP_COLOR, AR_SPECIALISTS, AR_BAND_LABELS,
  AR_SCENARIOS, AR_DEEP, AR_SHORT, AR_RAW, AR_PIPE_DEPS, arFmtTime, arWorstSev,
  AR_RACK, AR_MOD_META, arRack, compileCoachMix,
});
