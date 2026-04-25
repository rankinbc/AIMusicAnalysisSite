import { getToken } from './client.js';

export const SPECIALISTS = [
  'LowEnd', 'FrequencyBalance', 'Dynamics', 'StereoPhase',
  'Loudness', 'Sections', 'TranceArrangement', 'StemReference',
  'HarmonicAnalysis', 'ClarityAnalysis', 'SpatialAnalysis',
  'SurroundCompatibility', 'PlaybackOptimization', 'OverallScore',
  'GainStagingAudit', 'StereoFieldAudit', 'FrequencyCollisionDetection',
  'DynamicsHumanizationReport', 'SectionContrastAnalysis',
  'DensityBusynessReport', 'ChordHarmonyAnalysis',
  'DeviceChainAnalysis', 'PriorityProblemSummary',
];

export const SPECIALIST_LABELS = {
  LowEnd:                     'Low End',
  FrequencyBalance:           'Frequency Balance',
  Dynamics:                   'Dynamics',
  StereoPhase:                'Stereo & Phase',
  Loudness:                   'Loudness',
  Sections:                   'Sections',
  TranceArrangement:          'Trance Arrangement',
  StemReference:              'Stem Reference',
  HarmonicAnalysis:           'Harmonic Analysis',
  ClarityAnalysis:            'Clarity',
  SpatialAnalysis:            'Spatial Analysis',
  SurroundCompatibility:      'Surround Compat.',
  PlaybackOptimization:       'Playback Opt.',
  OverallScore:               'Overall Score',
  GainStagingAudit:           'Gain Staging',
  StereoFieldAudit:           'Stereo Field',
  FrequencyCollisionDetection:'Freq. Collision',
  DynamicsHumanizationReport: 'Dynamics Human.',
  SectionContrastAnalysis:    'Section Contrast',
  DensityBusynessReport:      'Density & Busy.',
  ChordHarmonyAnalysis:       'Chord Harmony',
  DeviceChainAnalysis:        'Device Chain',
  PriorityProblemSummary:     'Priority Summary',
};

export async function runTriage(jobId) {
  const resp = await fetch(`/api/experts/${jobId}/triage`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
    },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Triage failed (${resp.status})${text ? ': ' + text : ''}`);
  }
  return resp.json();
}

export function streamSpecialist(jobId, name, onChunk, onDone, onError) {
  const controller = new AbortController();

  (async () => {
    try {
      const resp = await fetch(`/api/experts/${jobId}/specialist/${name}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getToken()}`,
          Accept: 'text/event-stream',
        },
        signal: controller.signal,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`Specialist failed (${resp.status})${text ? ': ' + text : ''}`);
      }

      if (!resp.body) {
        throw new Error('Streaming not supported in this browser');
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        // sse_starlette 3.x uses \r\n line endings; normalize before splitting
        buffer = buffer.replace(/\r\n/g, '\n');
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';

        for (const block of blocks) {
          let event = '';
          let data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) event = line.slice(7).trim();
            else if (line.startsWith('data: ')) data = line.slice(6).trim();
          }
          if (event === 'chunk' && data) {
            try { const p = JSON.parse(data); if (p.text) onChunk(p.text); } catch {}
          } else if (event === 'done') {
            onDone();
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') onError(err.message ?? 'Stream error');
    }
  })();

  return () => controller.abort();
}
