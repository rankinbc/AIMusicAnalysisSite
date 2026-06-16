import { describe, it, expect } from 'vitest';
import { buildMeterCells, type MeterInputs } from './meters';

const baseFrame = {
  fftBins: new Float32Array(0),
  bandAverages: new Float32Array(0),
  rmsDb: -18,
  lufsShort: -8.4,
  truePeakDb: -0.9,
  correlation: 0.62,
  scopeL: new Float32Array(0),
  scopeR: new Float32Array(0),
};

const basePhase1 = {
  lufs: -9.2,
  peak_dbfs: -1.2,
  stereo_width: 1.1,
  mono_compatibility: 0.86,
};

function find(cells: ReturnType<typeof buildMeterCells>, key: string) {
  const c = cells.find((x) => x.key === key);
  if (!c) throw new Error(`missing cell ${key}`);
  return c;
}

describe('buildMeterCells', () => {
  const inputs: MeterInputs = { frame: baseFrame, phase1: basePhase1, grReductionDb: -2.4 };

  it('returns the full cell set', () => {
    expect(buildMeterCells(inputs)).toHaveLength(13);
  });

  it('maps live frame values', () => {
    const cells = buildMeterCells(inputs);
    expect(find(cells, 'lufs_s').value).toBeCloseTo(-8.4);
    expect(find(cells, 'true_peak').value).toBeCloseTo(-0.9);
    expect(find(cells, 'rms').value).toBeCloseTo(-18);
    expect(find(cells, 'corr').value).toBeCloseTo(0.62);
  });

  it('derives crest as truePeak minus rms', () => {
    expect(find(buildMeterCells(inputs), 'crest').value).toBeCloseTo(-0.9 - -18);
  });

  it('reads GR from compressor reduction', () => {
    expect(find(buildMeterCells(inputs), 'gr').value).toBeCloseTo(-2.4);
  });

  it('GR is null when compressor is off', () => {
    const cells = buildMeterCells({ ...inputs, grReductionDb: null });
    expect(find(cells, 'gr').value).toBeNull();
  });

  it('maps static phase1 values', () => {
    const cells = buildMeterCells(inputs);
    expect(find(cells, 'lufs_i').value).toBeCloseTo(-9.2);
    expect(find(cells, 'smp_peak').value).toBeCloseTo(-1.2);
    expect(find(cells, 'width').value).toBeCloseTo(1.1);
    expect(find(cells, 'mono').value).toBeCloseTo(0.86);
  });

  it('returns null for sourceless cells', () => {
    const cells = buildMeterCells(inputs);
    expect(find(cells, 'lra').value).toBeNull();
    expect(find(cells, 'momentary').value).toBeNull();
    expect(find(cells, 'dr').value).toBeNull();
  });

  it('null phase1 fields yield null cells, not NaN', () => {
    const cells = buildMeterCells({ frame: baseFrame, phase1: {}, grReductionDb: null });
    expect(find(cells, 'lufs_i').value).toBeNull();
    expect(find(cells, 'width').value).toBeNull();
  });

  it('flags true peak above -1 dBTP as warn', () => {
    const hot = { ...baseFrame, truePeakDb: -0.4 };
    expect(find(buildMeterCells({ ...inputs, frame: hot }), 'true_peak').tone).toBe('warn');
    const safe = { ...baseFrame, truePeakDb: -2.0 };
    expect(find(buildMeterCells({ ...inputs, frame: safe }), 'true_peak').tone).toBe('good');
  });
});
