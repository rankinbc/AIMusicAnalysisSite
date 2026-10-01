import { describe, expect, it } from 'vitest';

import type { FinalJson, JobPartial, JobStatusDto } from '../../../../api/types';
import {
  buildLiveSteps,
  fmtElapsed,
  fmtSeconds,
  liveInputsSummary,
  partialFinalJson,
  phase1Values,
  runStatus,
  runningPhase,
} from '../liveRun';

const job = (status: JobStatusDto['status'], partial?: JobPartial | null, currentPhase = ''): JobStatusDto => ({
  id: 'j',
  status,
  currentPhase,
  phasePct: 0,
  versionId: 'v',
  songId: 's',
  errorMessage: null,
  dispatchedAt: '2026-10-01T10:00:00Z',
  startedAt: null,
  completedAt: null,
  failedAt: null,
  partial,
});
const states = (steps: ReturnType<typeof buildLiveSteps>) => steps.map((s) => `${s.phase}:${s.state}`);

describe('buildLiveSteps', () => {
  it('pending job: every step waiting, in run order, predicted skips last', () => {
    const steps = buildLiveSteps({ job: job('pending'), inputs: { hasReference: false, hasAls: false } });
    expect(states(steps)).toEqual([
      '1:waiting', '2:waiting', '3:waiting', '4:waiting', '6:waiting', '7:waiting', '9:waiting', '5:skipped', '8:skipped',
    ]);
  });

  it('running: landed phases are done with their seconds, the running one spins with a start time', () => {
    const partial: JobPartial = {
      phases: {
        '1': { name: 'Universal Mix Analysis', status: 'ok', seconds: 54.4, data: { lufs: -11.9, bpm: 128 } },
        '2': { name: 'Genre Detection', status: 'ok', seconds: 1.2, data: { genre: 'trance', confidence: 0.8 } },
      },
      running: { phase: 3, name: 'Genre-Specific Scoring', started_at: '2026-10-01T10:01:00Z' },
    };
    const steps = buildLiveSteps({ job: job('processing', partial) });
    expect(states(steps).slice(0, 4)).toEqual(['1:done', '2:done', '3:running', '4:waiting']);
    expect(steps[0]!.seconds).toBe(54.4);
    expect(steps[0]!.row!.kv.find((k) => k.k === 'Integrated LUFS')!.v).toBe('-11.9');
    expect(steps[2]!.startedAtMs).toBe(Date.parse('2026-10-01T10:01:00Z'));
  });

  it('phase 1 running: its early values fill in before it finishes (unknowns left out)', () => {
    const partial: JobPartial = { early: { '1': { lufs: -9.2, true_peak_db: -0.4 } }, running: { phase: 1 } };
    const s1 = buildLiveSteps({ job: job('processing', partial) })[0]!;
    expect(s1.state).toBe('running');
    expect(s1.row!.kv.map((k) => k.k)).toEqual(['Integrated LUFS', 'True peak']);
  });

  it('falls back to currentPhase when the worker predates partial.running', () => {
    expect(runningPhase(job('processing', null, 'Gap Analysis'))).toBe(6);
    expect(runningPhase(job('pending'))).toBeNull();
  });

  it('a failed phase shows failed; arrangement pending is background; unavailable is terminal', () => {
    const fj = {
      phases: [
        { phase: 1, status: 'ok', data: {}, duration_s: 60 },
        { phase: 2, status: 'failed', error: 'boom', data: {}, duration_s: 0.4 },
        { phase: 7, status: 'ok', data: { arrangement_status: 'pending' } },
      ],
    } as unknown as FinalJson;
    expect(states(buildLiveSteps({ job: job('complete'), fj }))).toEqual(['1:done', '2:failed', '7:background']);
    const settled = {
      phases: [{ phase: 7, status: 'ok', data: { arrangement_status: 'unavailable' } }],
      phase_durations: { '7': 0.02 },
    } as unknown as FinalJson;
    const [s7] = buildLiveSteps({ job: job('complete'), fj: settled });
    expect(s7).toMatchObject({ state: 'unavailable', seconds: 0.02 });
  });

  it('complete: durations come from final_json, else from the job partial', () => {
    const fj = { phases: [{ phase: 1, status: 'ok', data: {} }] } as unknown as FinalJson;
    const steps = buildLiveSteps({ job: job('complete', { phases: { '1': { seconds: 12.3 } } }), fj });
    expect(steps[0]!.seconds).toBe(12.3);
  });
});

describe('small helpers', () => {
  it('runStatus', () => {
    expect(runStatus(job('pending'))).toBe('queued');
    expect(runStatus(job('processing'))).toBe('analyzing');
    expect(runStatus(job('complete'))).toBe('complete');
    expect(runStatus(undefined, {})).toBe('complete');
  });
  it('partialFinalJson + phase1Values prefer the finished phase over early values', () => {
    const partial: JobPartial = { early: { '1': { lufs: -9 } } };
    expect(phase1Values(partialFinalJson(partial), partial)).toEqual({ lufs: -9 });
    const done: JobPartial = { ...partial, phases: { '1': { status: 'ok', data: { lufs: -9.5 } } } };
    expect(phase1Values(partialFinalJson(done), done)).toEqual({ lufs: -9.5 });
    expect(phase1Values({}, null)).toBeUndefined();
  });
  it('formats durations', () => {
    expect(fmtSeconds(54.44)).toBe('54.4s');
    expect(fmtSeconds(3)).toBe('3.0s');
    expect(fmtSeconds(65)).toBe('1m 05s');
    expect(fmtSeconds(undefined)).toBe('');
    // Sub-50 ms phases (stored rounded to 0.01 s) read "<0.1s", never "0.0s".
    expect(fmtSeconds(0)).toBe('<0.1s');
    expect(fmtSeconds(0.03)).toBe('<0.1s');
    expect(fmtSeconds(0.06)).toBe('0.1s');
    expect(fmtSeconds(Number.NaN)).toBe('');
    expect(fmtElapsed(12_900)).toBe('12s');
    expect(fmtElapsed(125_000)).toBe('2m 05s');
  });
  it('liveInputsSummary', () => {
    expect(liveInputsSummary({ hasStems: true, hasReference: true })).toEqual({
      present: ['Song', 'stems', 'reference'],
      used: 3,
    });
  });
});
