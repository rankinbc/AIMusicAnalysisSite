import { describe, expect, it } from 'vitest';

import {
  overallProgress,
  planParts,
  uploadPartsSequential,
  type PartPlan,
} from '../multipart-upload-helpers';

const MiB = 1024 * 1024;
const PART = 16 * MiB;

describe('planParts (story 3.1 — uniform parts, FOOTGUN #3)', () => {
  it('splits 40 MiB into 16+16+8', () => {
    const plans = planParts(40 * MiB, PART);
    expect(plans).toHaveLength(3);
    expect(plans.map((p) => p.partNumber)).toEqual([1, 2, 3]);
    expect(plans[0]).toEqual({ partNumber: 1, start: 0, end: 16 * MiB });
    expect(plans[1]).toEqual({ partNumber: 2, start: 16 * MiB, end: 32 * MiB });
    expect(plans[2]).toEqual({ partNumber: 3, start: 32 * MiB, end: 40 * MiB });
    // Every part except the last is EXACTLY partSize (R2 requirement).
    for (const p of plans.slice(0, -1)) expect(p.end - p.start).toBe(PART);
  });

  it('single part when file fits', () => {
    expect(planParts(PART, PART)).toEqual([{ partNumber: 1, start: 0, end: PART }]);
    expect(planParts(1, PART)).toEqual([{ partNumber: 1, start: 0, end: 1 }]);
  });

  it('190 MB (Journey 2 flaky-FLAC case) is 12 uniform parts', () => {
    // Story 3.5 AC3 arithmetic: 12 parts x 3 attempts inside the 2 h URL
    // window is ample at any plausible uplink — no re-sign endpoint needed
    // at the 250 MB cap (3.1 decision 5, verified here).
    const plans = planParts(190 * 1000 * 1000, PART);
    expect(plans).toHaveLength(12);
    expect(plans.slice(0, -1).every((p) => p.end - p.start === PART)).toBe(true);
  });

  it('250 MB is 16 parts', () => {
    expect(planParts(250 * MiB, PART)).toHaveLength(16);
  });

  it('empty/invalid sizes produce no parts', () => {
    expect(planParts(0, PART)).toEqual([]);
    expect(planParts(-5, PART)).toEqual([]);
  });
});

describe('overallProgress (FR1 aggregation)', () => {
  it('is byte-accurate across completed + inflight', () => {
    expect(overallProgress(100, 0, 0)).toBe(0);
    expect(overallProgress(100, 50, 25)).toBe(0.75);
    expect(overallProgress(100, 100, 0)).toBe(1);
  });

  it('clamps at 1', () => {
    expect(overallProgress(100, 100, 50)).toBe(1);
  });
});

function urls(plans: PartPlan[]): Map<number, string> {
  return new Map(plans.map((p) => [p.partNumber, `https://s3.test/part/${p.partNumber}`]));
}

describe('uploadPartsSequential (NFR3 retry + ordering)', () => {
  it('uploads in ascending order and collects ETags', async () => {
    const plans = planParts(40 * MiB, PART);
    const seen: number[] = [];
    const parts = await uploadPartsSequential({
      plans,
      urlByPart: urls(plans),
      fileSize: 40 * MiB,
      putPart: (_url, plan) => {
        seen.push(plan.partNumber);
        return Promise.resolve(`"etag-${plan.partNumber}"`);
      },
    });
    expect(seen).toEqual([1, 2, 3]);
    expect(parts).toEqual([
      { partNumber: 1, eTag: '"etag-1"' },
      { partNumber: 2, eTag: '"etag-2"' },
      { partNumber: 3, eTag: '"etag-3"' },
    ]);
  });

  it('retries a failed part in place — earlier parts are never redone', async () => {
    const plans = planParts(40 * MiB, PART);
    const attemptsByPart = new Map<number, number>();
    const parts = await uploadPartsSequential({
      plans,
      urlByPart: urls(plans),
      fileSize: 40 * MiB,
      delay: () => Promise.resolve(),
      putPart: (_url, plan) => {
        const n = (attemptsByPart.get(plan.partNumber) ?? 0) + 1;
        attemptsByPart.set(plan.partNumber, n);
        if (plan.partNumber === 2 && n < 3) return Promise.reject(new Error('stall'));
        return Promise.resolve(`"etag-${plan.partNumber}"`);
      },
    });
    expect(attemptsByPart.get(1)).toBe(1); // never restarted from zero (NFR3)
    expect(attemptsByPart.get(2)).toBe(3); // retried in place
    expect(attemptsByPart.get(3)).toBe(1);
    expect(parts).toHaveLength(3);
  });

  it('throws after maxAttemptsPerPart failures', async () => {
    const plans = planParts(PART, PART);
    await expect(
      uploadPartsSequential({
        plans,
        urlByPart: urls(plans),
        fileSize: PART,
        maxAttemptsPerPart: 2,
        delay: () => Promise.resolve(),
        putPart: () => Promise.reject(new Error('always down')),
      }),
    ).rejects.toThrow('always down');
  });

  it('reports monotonic progress through completed and inflight bytes', async () => {
    const plans = planParts(32 * MiB, PART);
    const fractions: number[] = [];
    await uploadPartsSequential({
      plans,
      urlByPart: urls(plans),
      fileSize: 32 * MiB,
      onProgress: (f) => fractions.push(f),
      putPart: (_url, plan, onPartProgress) => {
        onPartProgress((plan.end - plan.start) / 2); // halfway event
        return Promise.resolve(`"e${plan.partNumber}"`);
      },
    });
    expect(fractions).toEqual([0.25, 0.5, 0.75, 1]);
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i]).toBeGreaterThanOrEqual(fractions[i - 1]!);
    }
  });

  it('fails fast when a part has no presigned URL', async () => {
    const plans = planParts(PART, PART);
    await expect(
      uploadPartsSequential({
        plans,
        urlByPart: new Map(),
        fileSize: PART,
        putPart: () => Promise.resolve('"e"'),
      }),
    ).rejects.toThrow('No presigned URL for part 1');
  });
});
