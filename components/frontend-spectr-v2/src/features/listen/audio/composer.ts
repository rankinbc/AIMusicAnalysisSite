// composer.ts
import { createBitcrusherUnit } from './effects/bitcrusher';
import { createCompressorUnit } from './effects/compressor';
import { createDelayUnit } from './effects/delay';
import { createDjFilterUnit } from './effects/djFilter';
import { createEqUnit } from './effects/eq';
import { createGateUnit } from './effects/gate';
import { createLimiterUnit } from './effects/limiter';
import { createPanUnit } from './effects/pan';
import { createReverbUnit } from './effects/reverb';
import { createSaturatorUnit } from './effects/saturator';
import { createTremoloUnit } from './effects/tremolo';
import { createTrimUnit } from './effects/trim';
import { createWidthUnit } from './effects/width';
import { DEFAULT_ORDER } from './state';
import { chainLinks, isPermutation, type ChainEndpoint } from './dsp/chainLinks';
import type { EffectId, EffectUnit } from './EffectUnit';
import { registerWorklets } from './worklets';

/** RMS levels (dBFS) at one unit's input/output — the bay's IN/OUT meters. */
export interface DeviceIoLevels {
  inDb: number;
  outDb: number;
}

export interface InsertChain {
  chainIn: AudioNode;
  chainOut: AudioNode;
  units: Record<EffectId, EffectUnit<unknown>>;
  getOrder: () => EffectId[];
  reorder: (order: EffectId[]) => void;
  /** Resolves once the worklet processor modules have registered (or failed —
   *  it never rejects). The pitch lane waits on this to materialize. */
  ready: Promise<void>;
  /** Attach the I/O meter taps to one unit (null detaches). Parallel analyser
   *  taps — never part of the audio path, safe to move while playing. */
  setTap: (id: EffectId | null) => void;
  /** Levels at the tapped unit, or null when nothing is tapped. */
  readTap: () => DeviceIoLevels | null;
  dispose: () => void;
}

// Duration of each side of the reorder duck (down, then up), in seconds.
const DUCK_SECONDS = 0.01;

export function buildInsertChain(ctx: AudioContext): InsertChain {
  const units: Record<EffectId, EffectUnit<unknown>> = {
    djfilter: createDjFilterUnit(ctx) as EffectUnit<unknown>,
    eq: createEqUnit(ctx) as EffectUnit<unknown>,
    gate: createGateUnit(ctx) as EffectUnit<unknown>,
    comp: createCompressorUnit(ctx) as EffectUnit<unknown>,
    sat: createSaturatorUnit(ctx) as EffectUnit<unknown>,
    bitcrusher: createBitcrusherUnit(ctx) as EffectUnit<unknown>,
    ms: createWidthUnit(ctx) as EffectUnit<unknown>,
    pan: createPanUnit(ctx) as EffectUnit<unknown>,
    tremolo: createTremoloUnit(ctx) as EffectUnit<unknown>,
    delay: createDelayUnit(ctx) as EffectUnit<unknown>,
    reverb: createReverbUnit(ctx) as EffectUnit<unknown>,
    limiter: createLimiterUnit(ctx) as EffectUnit<unknown>,
    trim: createTrimUnit(ctx) as EffectUnit<unknown>,
  };
  const chainIn = ctx.createGain();
  const chainOut = ctx.createGain();
  let order: EffectId[] = [...DEFAULT_ORDER];

  // Device I/O metering: two roaming analyser taps on the selected unit's
  // input/output. wire() severs unit-output edges on reorder, so it re-applies
  // the tap after relinking (connect() is idempotent per the Web Audio spec).
  const tapIn = ctx.createAnalyser();
  const tapOut = ctx.createAnalyser();
  tapIn.fftSize = 1024;
  tapOut.fftSize = 1024;
  const tapBuf = new Float32Array(tapIn.fftSize);
  let tapped: EffectId | null = null;
  const applyTap = () => {
    if (!tapped) return;
    units[tapped].input.connect(tapIn);
    units[tapped].output.connect(tapOut);
  };
  const clearTap = () => {
    if (!tapped) return;
    try { units[tapped].input.disconnect(tapIn); } catch { /* not connected */ }
    try { units[tapped].output.disconnect(tapOut); } catch { /* severed by wire() */ }
  };
  const rmsDb = (an: AnalyserNode): number => {
    an.getFloatTimeDomainData(tapBuf);
    let sum = 0;
    for (let i = 0; i < tapBuf.length; i++) sum += tapBuf[i] * tapBuf[i];
    const rms = Math.sqrt(sum / tapBuf.length);
    return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  };

  // A link's source is a unit's OUTPUT (or chainIn); its dest is a unit's
  // INPUT (or chainOut). 'IN' is never a dest, 'OUT' never a source.
  const sourceNode = (e: ChainEndpoint): AudioNode =>
    e === 'IN' ? chainIn : units[e as EffectId].output;
  const destNode = (e: ChainEndpoint): AudioNode =>
    e === 'OUT' ? chainOut : units[e as EffectId].input;

  // Tear down the inter-unit links and rebuild them for `next`. We disconnect
  // chainIn and every unit OUTPUT (the only nodes that source a link); we never
  // disconnect chainOut (it feeds the hook's masterProcessed downstream) — its
  // incoming link is dropped when the previous last-unit output is disconnected.
  const wire = (next: EffectId[]) => {
    chainIn.disconnect();
    (Object.keys(units) as EffectId[]).forEach((id) => units[id].output.disconnect());
    for (const [from, to] of chainLinks(next)) {
      sourceNode(from).connect(destNode(to));
    }
    applyTap(); // restore the output tap the disconnect sweep severed
  };

  wire(order); // initial connect in default order

  // Worklet boot: register the processor modules, then swap each worklet unit's
  // placeholder for its real AudioWorkletNode. Fire-and-forget; on failure the
  // units stay passthrough placeholders (graceful degradation).
  const ready = registerWorklets(ctx)
    .then(() => {
      (Object.keys(units) as EffectId[]).forEach((id) => units[id].materialize?.());
    })
    .catch(() => undefined);

  return {
    chainIn,
    chainOut,
    units,
    ready,
    getOrder: () => [...order],
    reorder: (next: EffectId[]) => {
      // No-op fast path: same order means nothing to rewire — skip the duck.
      if (next.length === order.length && next.every((id, i) => id === order[i])) {
        return;
      }
      if (!isPermutation(next, order)) {
        throw new Error(`reorder: [${next.join(',')}] is not a permutation of [${order.join(',')}]`);
      }
      const g = chainOut.gain;
      const t0 = ctx.currentTime;
      // Duck the chain output to silence over DUCK_SECONDS.
      g.cancelScheduledValues(t0);
      g.setValueAtTime(g.value, t0);
      g.linearRampToValueAtTime(0, t0 + DUCK_SECONDS);
      // Rewire once the dip has landed (JS runs synchronously, so the
      // disconnect/connect must be deferred to ~the bottom of the ramp to
      // hide the click), then ramp back up.
      window.setTimeout(() => {
        wire(next);
        order = [...next];
        const t1 = ctx.currentTime;
        g.cancelScheduledValues(t1);
        g.setValueAtTime(0, t1);
        g.linearRampToValueAtTime(1, t1 + DUCK_SECONDS);
      }, DUCK_SECONDS * 1000 + 2);
    },
    setTap: (id: EffectId | null) => {
      if (id === tapped) return;
      clearTap();
      tapped = id;
      applyTap();
    },
    readTap: () =>
      tapped ? { inDb: rmsDb(tapIn), outDb: rmsDb(tapOut) } : null,
    dispose: () => {
      clearTap();
      tapped = null;
      chainIn.disconnect();
      chainOut.disconnect();
      Object.values(units).forEach((u) => u.dispose());
    },
  };
}
