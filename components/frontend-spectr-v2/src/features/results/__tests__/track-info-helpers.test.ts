import { describe, expect, it } from 'vitest';

import { pointsToPolyline, segmentBands, timelinePoints } from '../track-info-helpers';

describe('timelinePoints', () => {
  it('expected: maps a series into an inverted [0..w]×[0..h] box', () => {
    const pts = timelinePoints({ t: [0, 5, 10], lufs: [-40, -20, 0] }, 100, 50, -40, 0);
    expect(pts).toHaveLength(3);
    expect(pts[0]).toMatchObject({ x: 0, y: 50 }); // floor → bottom
    expect(pts[2]).toMatchObject({ x: 100, y: 0 }); // ceil → top
    expect(pts[1].x).toBeCloseTo(50, 5);
    expect(pts[1].y).toBeCloseTo(25, 5);
  });

  it('clamps out-of-range loudness to the floor/ceil', () => {
    const pts = timelinePoints({ t: [0, 1], lufs: [-99, 12] }, 10, 10, -40, 0);
    expect(pts[0].y).toBe(10); // clamped to floor
    expect(pts[1].y).toBe(0); // clamped to ceil
  });

  it('failure: missing/short/mismatched series → []', () => {
    expect(timelinePoints(undefined, 10, 10)).toEqual([]);
    expect(timelinePoints({ t: [0], lufs: [-10] }, 10, 10)).toEqual([]);
    expect(timelinePoints({ t: [0, 1], lufs: [-10] }, 10, 10)).toEqual([]);
  });
});

describe('pointsToPolyline', () => {
  it('formats points as an SVG polyline string', () => {
    expect(pointsToPolyline([{ x: 0, y: 50 }, { x: 100, y: 0 }])).toBe('0.0,50.0 100.0,0.0');
  });
});

describe('segmentBands', () => {
  it('expected: proportional bands from segments + duration', () => {
    const bands = segmentBands(
      [
        { label: 'intro', start: 0, end: 30 },
        { label: 'drop', start: 30, end: 60 },
      ],
      120,
    );
    expect(bands).toEqual([
      { label: 'intro', leftPct: 0, widthPct: 25 },
      { label: 'drop', leftPct: 25, widthPct: 25 },
    ]);
  });

  it('edge: drops zero/negative-length segments', () => {
    const bands = segmentBands([{ label: 'x', start: 10, end: 10 }], 100);
    expect(bands).toEqual([]);
  });

  it('failure: no segments or no duration → []', () => {
    expect(segmentBands(undefined, 100)).toEqual([]);
    expect(segmentBands([{ label: 'a', start: 0, end: 5 }], undefined)).toEqual([]);
  });
});
