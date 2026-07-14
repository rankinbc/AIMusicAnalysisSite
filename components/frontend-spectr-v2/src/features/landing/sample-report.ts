/* Story 6.1 (UX-DR24) — the landing page's live sample-report data.
 *
 * PROVENANCE: trimmed by hand from `schemas/samples/sample1_8aeef3b4.json`
 * (repo root — the same canonical sample the BFF DemoSeeder bundles as
 * DemoAssets/demo-final-json.json). Values are REAL pipeline output from a
 * real rough mix — the F grade is deliberate: the landing shows the tool
 * finding real problems, not flattering a fake A. If the sample fixture ever
 * changes, re-trim these fields; do NOT invent numbers.
 */

export interface SampleFinding {
  /** Short category tag rendered as the finding's pill. */
  tag: string;
  text: string;
}

export interface SampleReport {
  grade: string;
  overallScore: number;
  danceability: number;
  bpm: number;
  detectedKey: string;
  lufs: number;
  findings: SampleFinding[];
}

export const SAMPLE_REPORT: SampleReport = {
  grade: 'F',
  overallScore: 42,
  danceability: 20,
  bpm: 71,
  detectedKey: 'C#',
  lufs: -13.3,
  findings: [
    {
      tag: 'TRUE PEAK',
      text: 'True peak is hitting 0.0 dBTP. Streaming platforms reject above 0 dBTP; keep it below −1.0 dBTP for safety.',
    },
    {
      tag: 'LOW END',
      text: 'EQ clash from low-end buildup: reduce sub-bass / bass (20–200 Hz).',
    },
    {
      tag: 'STEREO',
      text: 'Stereo image is unstable across the track — automate width changes deliberately rather than letting it drift.',
    },
  ],
};
