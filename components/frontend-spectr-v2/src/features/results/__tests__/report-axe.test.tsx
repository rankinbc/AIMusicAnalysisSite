// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render } from '@testing-library/react';
import { run as axeRun } from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import type { FinalJson, Phase1Data, Phase2Data } from '../../../api/types';
import { DegradationBanner } from '../DegradationBanner';
import { FindingsTab } from '../FindingsTab';
import { ProjectUnlock } from '../ProjectUnlock';
import { ResultsTabs } from '../ResultsTabs';
import { SongHeader } from '../SongHeader';
import { TrackInfoTab } from '../TrackInfoTab';

// Story 5.10 (UX-DR44 / AC2) — axe-core smoke over the report surface.
//
// DELIBERATE DEVIATION (noted in the story record): the report route's
// monolithic ReportView needs a live TanStack Router (useNavigate/Link) that
// jsdom tests in this repo never mount — so the axe pass runs over the
// report's composed major sections instead. Same DOM the route renders,
// minus the router chrome. color-contrast is disabled: axe's contrast rule
// needs real paint/layout, which jsdom does not do — every other WCAG 2.1 AA
// rule (roles, names, labels, aria validity, structure) runs.

afterEach(cleanup);

const AXE_OPTS = {
  runOnly: { type: 'tag' as const, values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  rules: { 'color-contrast': { enabled: false } },
};

async function expectNoViolations(container: HTMLElement) {
  const results = await axeRun(container, AXE_OPTS);
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join('; ')}`,
  );
  expect(summary).toEqual([]);
}

const degradedFj: FinalJson = {
  phases: [
    { phase: 1, name: 'Mix', status: 'ok' },
    { phase: 4, name: 'Stems', status: 'failed', error: 'boom' },
  ],
};

const phase1: Phase1Data = {
  lufs: -9.4,
  bpm: 128,
  detected_key: 'A#',
  true_peak_db: -0.4,
  stereo_width: 0.6,
  stereo_correlation: 0.8,
  mono_compatibility: 0.9,
  clipping_detected: false,
  duration_seconds: 214,
} as Phase1Data;
const phase2: Phase2Data = { genre: 'techno', confidence: 0.92 } as Phase2Data;

describe('report surface — axe WCAG 2.1 AA smoke (story 5.10 AC2)', () => {
  it('header + tabs + banner compose clean', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <main>
          <SongHeader
            songId="s1"
            versionId="v1"
            versionLabel="v3"
            trackName="Neon Nights"
            genre="techno"
            durationSeconds={214}
            inputs={{ mix: true, stems: false, als: false, reference: false }}
            findingCount={3}
            suggestionCount={5}
            onAddInputs={() => {}}
          />
          <ResultsTabs
            current="findings"
            onChange={() => {}}
            findingCount={3}
            hasProject={false}
            projectTrackCount={0}
            hasReference={false}
          />
          <DegradationBanner fj={degradedFj} jobId="job-1" onRetryDispatched={() => {}} />
        </main>
      </QueryClientProvider>,
    );
    await expectNoViolations(container);
  });

  it('findings + track info + project unlock compose clean', async () => {
    const { container } = render(
      <main>
        <FindingsTab verdicts={[]} onGoToActions={() => {}} />
        <TrackInfoTab
          phase1={phase1}
          phase2={phase2}
          phase3={undefined}
          phase4={undefined}
          phase9={undefined}
        />
        <ProjectUnlock />
      </main>,
    );
    await expectNoViolations(container);
  });
});
