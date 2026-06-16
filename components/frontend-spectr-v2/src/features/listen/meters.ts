import type { AudioFrame } from './useAudioGraph';

// A subset of Phase1Data — only the fields the meter module consumes.
export interface MeterPhase1 {
  lufs?: number;
  peak_dbfs?: number;
  stereo_width?: number;
  mono_compatibility?: number;
}

export interface MeterInputs {
  frame: AudioFrame;
  phase1: MeterPhase1;
  /** Live compressor reduction in dB (≤ 0), or null when the compressor is off. */
  grReductionDb: number | null;
}

export type MeterTone = 'neutral' | 'good' | 'warn';

export interface MeterCell {
  key: string;
  label: string;
  /** Display unit suffix, e.g. 'LUFS', 'dB'. */
  unit: string;
  /** Real value, or null when there is no data source for this cell. */
  value: number | null;
  /** Decimals to render. */
  decimals: number;
  tone: MeterTone;
}

function num(v: number | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function buildMeterCells({ frame, phase1, grReductionDb }: MeterInputs): MeterCell[] {
  const truePeak = num(frame.truePeakDb);
  const rms = num(frame.rmsDb);
  const crest = truePeak !== null && rms !== null ? truePeak - rms : null;

  // True peak healthy ceiling = -1 dBTP.
  const tpTone: MeterTone =
    truePeak === null ? 'neutral' : truePeak > -1 ? 'warn' : 'good';

  return [
    { key: 'lufs_i', label: 'Lufs-I', unit: 'LUFS', value: num(phase1.lufs), decimals: 1, tone: 'neutral' },
    { key: 'lufs_s', label: 'Lufs-S', unit: 'LUFS', value: num(frame.lufsShort), decimals: 1, tone: 'neutral' },
    { key: 'lra', label: 'LRA', unit: 'LU', value: null, decimals: 1, tone: 'neutral' },
    { key: 'dr', label: 'DR', unit: 'DR', value: null, decimals: 0, tone: 'neutral' },
    { key: 'crest', label: 'Crest', unit: 'dB', value: crest, decimals: 1, tone: 'neutral' },
    { key: 'rms', label: 'RMS', unit: 'dB', value: rms, decimals: 1, tone: 'neutral' },
    { key: 'true_peak', label: 'True Pk', unit: 'dBTP', value: truePeak, decimals: 1, tone: tpTone },
    { key: 'smp_peak', label: 'Smp Pk', unit: 'dB', value: num(phase1.peak_dbfs), decimals: 1, tone: 'neutral' },
    { key: 'corr', label: 'Corr', unit: '', value: num(frame.correlation), decimals: 2, tone: 'good' },
    { key: 'width', label: 'Width', unit: '', value: num(phase1.stereo_width), decimals: 2, tone: 'neutral' },
    { key: 'mono', label: 'Mono', unit: '', value: num(phase1.mono_compatibility), decimals: 2, tone: 'neutral' },
    { key: 'momentary', label: 'Mom', unit: 'LUFS', value: null, decimals: 1, tone: 'neutral' },
    { key: 'gr', label: 'GR', unit: 'dB', value: grReductionDb, decimals: 1, tone: 'neutral' },
  ];
}
