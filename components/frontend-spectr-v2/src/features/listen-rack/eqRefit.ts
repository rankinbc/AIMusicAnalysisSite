// EQ refit — restate a merged band set as the FEWEST bands that produce the
// same curve.
//
// Why this exists: the merge stage answers "what do all these fixes add up to"
// in the merge's own terms, which is one band per surviving cluster. That is
// correct and unreadable. Seven bands at 30/40/55/110/180/300/350 Hz are, to
// within a tenth of a dB, three moves — and three moves is something a producer
// can hold in their head and dial into a DAW.
//
// It also has to run BEFORE the chain forks into the audition rack and the
// written instructions. If the rack renders seven bands and the guide lists
// three, the user hears one thing and applies another, and the whole point of
// auditioning a fix is gone. So both emitters consume the refit output.
//
// Method: pattern search (derivative-free coordinate descent) against the
// target's summed magnitude response on a log-frequency grid, trying k = 1, 2,
// … bands and accepting the first k that lands inside the tolerance. Uses the
// same RBJ response math as the curve editor and the live engine, so "matches"
// means matches what you'll actually hear. Deterministic — same input, same
// output, no randomness.
//
// MIRROR of the worker's solve_lib/eq_refit.py. Change a rule here, change it
// there too.
import type { EqBand } from './data';
import { bandResponseDb, logFreqs } from './eqResponse';

/** Inaudible by any reasonable standard; the fit usually beats it by half. */
export const DEFAULT_TOLERANCE_DB = 0.3;

const GRID = logFreqs(96);
const GAIN_BOUNDS: [number, number] = [-9, 6];
const Q_BOUNDS: [number, number] = [0.3, 12];
const FREQ_BOUNDS: [number, number] = [20, 20000];
const ROUNDS = 14;

export interface RefitResult {
  /** Filters (hp/lp) passed through untouched, then the refit gain bands. */
  bands: EqBand[];
  /** Worst |target − refit| across the grid, in dB. */
  maxDeviationDb: number;
  /** How many gain bands went in and came out. */
  before: number;
  after: number;
}

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

const isFilter = (b: EqBand): boolean => b.type === 'highpass' || b.type === 'lowpass';

function responseOf(band: EqBand): number[] {
  return GRID.map((f) => bandResponseDb(band, f));
}

function sumInto(curves: number[][]): number[] {
  const out = new Array<number>(GRID.length).fill(0);
  for (const c of curves) {
    for (let i = 0; i < GRID.length; i++) out[i] += c[i]!;
  }
  return out;
}

function sse(target: number[], got: number[]): number {
  let s = 0;
  for (let i = 0; i < target.length; i++) {
    const d = target[i]! - got[i]!;
    s += d * d;
  }
  return s;
}

function maxDev(target: number[], got: number[]): number {
  let m = 0;
  for (let i = 0; i < target.length; i++) m = Math.max(m, Math.abs(target[i]! - got[i]!));
  return m;
}

/** Seed k bands from the k strongest originals — a deterministic start that is
 *  already close, so the search refines rather than explores. */
function seed(originals: EqBand[], k: number): EqBand[] {
  return [...originals]
    .sort((a, b) => Math.abs(b.gainDb) - Math.abs(a.gainDb) || a.freq - b.freq)
    .slice(0, k)
    .map((b) => ({ ...b, type: 'peaking' as const }))
    .sort((a, b) => a.freq - b.freq);
}

/** Fit `k` peaking bands to `target` by pattern search. Returns the candidate
 *  and its worst deviation. */
function fit(target: number[], originals: EqBand[], k: number): { bands: EqBand[]; dev: number } {
  const bands = seed(originals, k);
  // Per-band response cache — perturbing band j only recomputes band j.
  const curves = bands.map(responseOf);
  let sum = sumInto(curves);
  let err = sse(target, sum);

  // Step ladders shrink each round: coarse placement first, then polish.
  let gainStep = 1.5;
  let freqStep = 1.35;
  let qStep = 1.6;

  for (let round = 0; round < ROUNDS; round++) {
    for (let j = 0; j < bands.length; j++) {
      const tryParam = (mutate: (b: EqBand) => EqBand): void => {
        const cand = mutate(bands[j]!);
        const candCurve = responseOf(cand);
        const candSum = sum.slice();
        for (let i = 0; i < GRID.length; i++) candSum[i]! += candCurve[i]! - curves[j]![i]!;
        const candErr = sse(target, candSum);
        if (candErr < err) {
          bands[j] = cand;
          curves[j] = candCurve;
          sum = candSum;
          err = candErr;
        }
      };
      for (const dir of [1, -1]) {
        tryParam((b) => ({ ...b, gainDb: clamp(b.gainDb + dir * gainStep, ...GAIN_BOUNDS) }));
        tryParam((b) => ({ ...b, freq: clamp(b.freq * (dir > 0 ? freqStep : 1 / freqStep), ...FREQ_BOUNDS) }));
        tryParam((b) => ({ ...b, q: clamp(b.q * (dir > 0 ? qStep : 1 / qStep), ...Q_BOUNDS) }));
      }
    }
    gainStep *= 0.62;
    freqStep = 1 + (freqStep - 1) * 0.62;
    qStep = 1 + (qStep - 1) * 0.62;
  }

  return { bands, dev: maxDev(target, sum) };
}

/**
 * Restate `bands` as the fewest bands matching the same response.
 *
 * High/low-pass filters pass through untouched — they are not expressible as
 * peaking bands, and a cutoff is an instruction in its own right. Only the
 * gain bands (peaking + shelves) are refit, and the result is never worse than
 * the input: if no smaller set lands inside tolerance, the originals come back.
 */
export function refitGainBands(
  bands: EqBand[],
  toleranceDb: number = DEFAULT_TOLERANCE_DB,
): RefitResult {
  const filters = bands.filter(isFilter);
  const gains = bands.filter((b) => !isFilter(b) && b.enabled && b.gainDb !== 0);
  const unchanged: RefitResult = {
    bands,
    maxDeviationDb: 0,
    before: gains.length,
    after: gains.length,
  };
  if (gains.length < 2) return unchanged;

  const target = sumInto(gains.map(responseOf));

  for (let k = 1; k < gains.length; k++) {
    const { bands: cand, dev } = fit(target, gains, k);
    if (dev <= toleranceDb) {
      return {
        bands: [
          ...filters,
          ...cand.map((b) => ({
            ...b,
            freq: Math.round(b.freq * 10) / 10,
            gainDb: Math.round(b.gainDb * 100) / 100,
            q: Math.round(b.q * 100) / 100,
            enabled: true,
          })),
        ],
        maxDeviationDb: Math.round(dev * 1000) / 1000,
        before: gains.length,
        after: k,
      };
    }
  }
  return unchanged;
}
