// Regenerates the landing page's live sample report fixture
// (src/features/landing/sample/sample-data.ts) from a demo snapshot export
// (format `spectr-demo-snapshot/v1`, written by the BFF admin snapshot
// endpoint). The snapshot itself is gitignored (data/audio/), so the generated
// TS module is the committed artifact.
//
//   node scripts/gen-sample-report.mjs [path/to/snapshot.json]
//
// Default input: <repo root>/data/audio/demo/snapshot/snapshot.json.
//
// What is extracted: the analysis numbers the header needs + the verdicts
// (findings, evidence, fixes). What is NOT: the coach conversation, rack
// preset names, file paths, ids of the source rows, or any user-typed text.
//
// Curation (deliberate, listed so it can be re-reviewed on a new snapshot):
//   - EXCLUDE: a few verdicts that contradict a better-evidenced verdict in
//     the same report (see EXCLUDE below, each with its reason). The live
//     product shows everything; a 90-second landing sample should not open
//     with two cards that disagree.
//   - CLUSTER: non-win verdicts whose primary evidence metric is the same
//     measurement (e.g. three specialists all flag the L/R balance) collapse
//     into ONE finding; the others are kept as "corroborated by" entries.
//   - SOURCE: AI-specialist verdicts in older snapshots carry
//     source="rule_engine" (known worker bug); provenance is re-derived from
//     `model` so the source tag reads "AI specialist" vs "Measured" correctly.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO = join(ROOT, '..', '..');
const OUT = join(ROOT, 'src', 'features', 'landing', 'sample', 'sample-data.ts');
const input = process.argv[2] ?? join(REPO, 'data', 'audio', 'demo', 'snapshot', 'snapshot.json');

if (!existsSync(input)) {
  console.error(`gen-sample-report: snapshot not found: ${input}`);
  process.exit(2);
}

const snap = JSON.parse(readFileSync(input, 'utf-8'));
if (snap.format !== 'spectr-demo-snapshot/v1') {
  console.error(`gen-sample-report: unexpected format ${snap.format}`);
  process.exit(2);
}

/** [specialist slug, headline regex, reason] */
const EXCLUDE = [
  [
    'rule_engine.bpm_genre_match',
    /BPM/,
    'tempo read double-time on the short excerpt; the rule itself says it is likely a detection artefact',
  ],
  [
    'rule_engine.weak_transients',
    /transient/i,
    'provisional threshold, contradicted by the Dynamics specialist measuring punchy transients',
  ],
  [
    'stereo_field',
    /narrow stereo image/i,
    'widening advice contradicted by the higher-priority Stereo Phase mono-collapse finding',
  ],
];

const phases = snap.analysis.finalJson.phases;
const p1 = phases.find((p) => p.phase === 1)?.data ?? {};
const fj = snap.analysis.finalJson;

const excluded = [];
const kept = snap.verdicts.filter((v) => {
  const hit = EXCLUDE.find(([slug, re]) => v.specialist === slug && re.test(v.headline));
  if (hit) excluded.push(`${v.specialist}: ${v.headline} — ${hit[2]}`);
  return !hit;
});

const strip = (v, i) => ({
  id: `sample-${String(i + 1).padStart(2, '0')}`,
  analysisId: 'sample',
  specialist: v.specialist,
  promptVersion: v.promptVersion,
  model: v.model,
  severity: v.severity,
  category: v.category,
  confidence: v.confidence,
  priorityScore: v.priorityScore,
  impact: v.impact,
  chartType: v.chartType,
  headline: v.headline,
  summary: v.summary,
  body: v.body,
  metricLine: v.metricLine,
  whyItMatters: v.whyItMatters,
  presetName: null,
  evidence: v.evidence,
  fix: v.fix
    ? {
        target: v.fix.target,
        dsp_chain: v.fix.dsp_chain,
        expected_outcome: v.fix.expected_outcome,
        ableton_hint: v.fix.ableton_hint,
      }
    : null,
  sources: null,
  problemId: v.problemId,
  kind: v.kind,
  source: v.model === 'rules' ? 'rule_engine' : 'llm_identifier',
  dataTier: v.dataTier,
  fixable: v.fixable,
  suspected: v.suspected,
  where: v.where,
  refines: null,
  priorityBase: v.priorityBase,
  priorityCategoryWeight: v.priorityCategoryWeight,
  priorityScopeMultiplier: v.priorityScopeMultiplier,
  scope: v.scope,
  createdAt: '2026-09-21T00:00:00Z',
  userState: { dismissed: false, applied: false, feedback: null },
});

const verdicts = kept.map(strip);

// Cluster by primary evidence metric (non-wins only).
const primaryMetric = (v) =>
  Array.isArray(v.evidence) && v.evidence[0]?.metric ? v.evidence[0].metric : null;
const rank = (v) => [v.fix ? 1 : 0, v.priorityScore, v.source === 'llm_identifier' ? 1 : 0, v.confidence];
const better = (a, b) => {
  const ra = rank(a);
  const rb = rank(b);
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] > rb[i];
  return false;
};

const clusters = new Map();
const findings = [];
for (const v of verdicts) {
  const key = v.severity === 'win' ? null : primaryMetric(v);
  if (!key) {
    findings.push({ verdict: v, corroboratedBy: [] });
    continue;
  }
  const c = clusters.get(key);
  if (!c) {
    const entry = { verdict: v, corroboratedBy: [] };
    clusters.set(key, entry);
    findings.push(entry);
  } else if (better(v, c.verdict)) {
    c.corroboratedBy.push({ specialist: c.verdict.specialist, headline: c.verdict.headline });
    c.verdict = v;
  } else {
    c.corroboratedBy.push({ specialist: v.specialist, headline: v.headline });
  }
}

const SEV = { critical: 5, severe: 4, moderate: 3, minor: 2, win: 1 };
findings.sort(
  (a, b) =>
    (SEV[b.verdict.severity] ?? 0) - (SEV[a.verdict.severity] ?? 0) ||
    b.verdict.priorityScore - a.verdict.priorityScore ||
    b.verdict.confidence - a.verdict.confidence,
);

const keyEst = p1.key_estimate ?? {};
const meta = {
  title: snap.song.title,
  artist: null,
  // The exported song description — for the demo track, the artist credit /
  // demo-use disclaimer. Shown verbatim under the title.
  credit: snap.song.description ?? null,
  genre: snap.song.genreHint ?? null,
  key: keyEst.key ? `${keyEst.key} ${keyEst.mode ?? ''}`.trim() : (p1.detected_key ?? null),
  grade: fj.grade,
  score: Math.round(fj.overall_score),
  lufs: round(p1.lufs, 1),
  truePeakDb: round(p1.true_peak_db, 1),
  crestFactorDb: round(p1.crest_factor, 1),
  loudnessRangeLu: round(p1.loudness_range_lu, 1),
  stereoCorrelation: round(p1.stereo_correlation, 2),
  specialistsRun: (snap.analysis.routingPlan?.specialists_to_run ?? []).map((s) => s.name),
  pipelineVersion: snap.analysis.pipelineVersion,
  verdictsInSnapshot: snap.verdicts.length,
};

function round(n, d) {
  return typeof n === 'number' && Number.isFinite(n) ? Number(n.toFixed(d)) : null;
}

const body = `/* GENERATED by scripts/gen-sample-report.mjs — do not edit by hand.
 * Source: demo snapshot (${snap.format}, exported ${snap.exportedAt}),
 * demo track "${snap.song.title}" (curated). Real analyzer
 * output: ${verdicts.length} of ${snap.verdicts.length} verdicts kept, clustered into ${findings.length} findings.
 * Excluded (contradicted in the same report):
${excluded.map((e) => ` *   - ${e}`).join('\n')}
 * Regenerate: node scripts/gen-sample-report.mjs <snapshot.json> */
import type { VerdictDto } from '../../../api/types';

export interface SampleCorroboration {
  specialist: string;
  headline: string;
}

export interface SampleFinding {
  verdict: VerdictDto;
  /** Other specialists that independently flagged the same measurement. */
  corroboratedBy: SampleCorroboration[];
}

export interface SampleMeta {
  title: string;
  artist: string | null;
  credit: string | null;
  genre: string | null;
  key: string | null;
  grade: string;
  score: number;
  lufs: number | null;
  truePeakDb: number | null;
  crestFactorDb: number | null;
  loudnessRangeLu: number | null;
  stereoCorrelation: number | null;
  specialistsRun: string[];
  pipelineVersion: string;
  verdictsInSnapshot: number;
}

export const SAMPLE_META: SampleMeta = ${JSON.stringify(meta, null, 2)};

export const SAMPLE_FINDINGS: SampleFinding[] = ${JSON.stringify(findings, null, 2)};
`;

writeFileSync(OUT, body.replace(/\r?\n/g, '\n'), 'utf-8');
console.log(
  `gen-sample-report: wrote ${OUT} — ${findings.length} findings (${verdicts.length} verdicts kept, ${excluded.length} excluded)`,
);
