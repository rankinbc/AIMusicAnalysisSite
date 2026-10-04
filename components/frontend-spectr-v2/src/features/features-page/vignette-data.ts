/* Data for the second batch of /features vignettes.
 *
 * SAMPLE_* values are hand-copied from the sample report (SAMPLE_META in
 * landing/sample/sample-data.ts) and asserted against it in
 * features-page.test.tsx. ILLUSTRATION_* values are made up: the sample track
 * has one version and no stems, project or reference, so those vignettes are
 * tagged "illustration" on the page, never "sample report". */

/** Specialists the sample report's triage ran (SAMPLE_META.specialistsRun). */
export const SAMPLE_SPECIALISTS_RUN: readonly string[] = ['loudness', 'frequency_balance', 'dynamics'];

/** Findings each of those specialists raised in the sample report (primary
 *  verdicts in SAMPLE_FINDINGS, after clustering). */
export const SAMPLE_SPECIALIST_FINDINGS: Readonly<Record<string, number | undefined>> = {
  loudness: 3,
  frequency_balance: 5,
  dynamics: 4,
};

/** Roster groups shown in the team vignette (the audio-only ones + stems). */
export const TEAM_GROUPS = ['Spectrum', 'Loudness', 'Dynamics', 'Stereo', 'Stems'] as const;

export const SAMPLE_STATS = {
  lufs: -8.9,
  truePeakDb: 0.4,
  crestFactorDb: 10.1,
  loudnessRangeLu: 2,
  stereoCorrelation: 0.88,
  key: 'A# minor',
} as const;

// ── illustrations (made-up values) ──────────────────────────────────────

export const ILLUSTRATION_SONG = {
  title: 'Night Drive',
  tags: ['club', 'EP'],
  versions: [
    { v: 'v1', label: 'first bounce', date: 'Sep 2' },
    { v: 'v2', label: 'low end pass', date: 'Sep 9' },
    { v: 'v3', label: 'air + limiter', date: 'Sep 15', current: true },
  ],
  decks: { a: 'v2', b: 'v3' },
  changes: [
    { label: 'Loudness', a: '−8.9', b: '−10.4', unit: 'LUFS', delta: '−1.5', tone: 'good' },
    { label: 'Dynamics', a: '2.0', b: '5.1', unit: 'LU', delta: '+3.1', tone: 'good' },
    { label: 'Bass energy', a: '62', b: '59', unit: '', delta: '−3', tone: 'good' },
    { label: 'Air / highs', a: '−58', b: '−56', unit: '', delta: '+2', tone: 'good' },
    { label: 'Stereo width', a: '12', b: '16', unit: '', delta: '+4', tone: 'neutral' },
  ],
  note: 'Kick finally sits. Top end opened up without getting harsh.',
} as const;

/** The upload dialog with everything attached. Roles are the stem
 *  classifier's own role names. */
export const ILLUSTRATION_UPLOAD = {
  mix: 'NightDrive_v3.wav',
  project: { file: 'Night Drive.als', facts: '14 tracks · 31 devices · 126 BPM' },
  stems: [
    { file: 'kick.wav', role: 'kick' },
    { file: 'sub_808.wav', role: 'bass' },
    { file: 'lead_pluck.wav', role: 'lead' },
    { file: 'pad_chords.wav', role: 'pad' },
    { file: 'hats_loop.wav', role: 'hats' },
    { file: 'vox_chop.wav', role: 'vocals' },
  ],
} as const;

export const ILLUSTRATION_STEMS = {
  bands: ['Sub', 'Low', 'Low-mid', 'Mid', 'High'],
  // 0–3 energy per band; the Low column is where Kick and Bass collide.
  rows: [
    { stem: 'Kick', energy: [2, 3, 1, 1, 1] },
    { stem: 'Bass', energy: [3, 3, 2, 0, 0] },
    { stem: 'Lead', energy: [0, 0, 1, 3, 2] },
    { stem: 'Pads', energy: [0, 1, 2, 2, 1] },
  ],
  clashBand: 1,
  clashStems: ['Kick', 'Bass'],
  finding: 'Kick and Bass are fighting between 60 and 120 Hz',
} as const;

export const ILLUSTRATION_PROJECT = {
  track: 'Bass',
  chain: ['Operator', 'EQ Eight', 'Glue Compressor'],
  fix: 'EQ Eight on “Bass” — bell −3 dB at 110 Hz, Q 1.4',
  finding: 'Kick and Bass are fighting between 60 and 120 Hz',
} as const;

/** Your mix against an uploaded reference. Labels are the Reference tab's own
 *  metric labels; `scale` is the delta that counts as fully "far off". */
export const ILLUSTRATION_REFERENCE = {
  name: 'Your reference track',
  facts: [['BPM', '126'], ['KEY', 'F minor'], ['LUFS', '−9.2'], ['TP', '−1.0']],
  deltas: [
    { label: 'Integrated loudness', delta: -1.4, unit: 'LUFS', scale: 6, digits: 1 },
    { label: 'Sub-bass', delta: 4.1, unit: 'dB', scale: 6, digits: 1 },
    { label: 'Bass', delta: 1.8, unit: 'dB', scale: 6, digits: 1 },
    { label: 'Low mid', delta: 3.4, unit: 'dB', scale: 6, digits: 1 },
    { label: 'Mid', delta: -1.2, unit: 'dB', scale: 6, digits: 1 },
    { label: 'Presence', delta: -0.8, unit: 'dB', scale: 6, digits: 1 },
    { label: 'Air', delta: -4.6, unit: 'dB', scale: 6, digits: 1 },
    { label: 'Stereo correlation', delta: 0.06, unit: '', scale: 0.5, digits: 2 },
  ],
  gaps: ['Sub-bass', 'Air', 'Low mid'],
} as const;
