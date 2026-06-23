// composer.ts
import { createCompressorUnit } from './effects/compressor';
import { createEqUnit } from './effects/eq';
import { createSaturatorUnit } from './effects/saturator';
import { createWidthUnit } from './effects/width';
import { DEFAULT_ORDER } from './state';
import { chainLinks, isPermutation, type ChainEndpoint } from './dsp/chainLinks';
import type { EffectId, EffectUnit } from './EffectUnit';

export interface InsertChain {
  chainIn: AudioNode;
  chainOut: AudioNode;
  units: Record<EffectId, EffectUnit<unknown>>;
  getOrder: () => EffectId[];
  reorder: (order: EffectId[]) => void;
  dispose: () => void;
}

// Duration of each side of the reorder duck (down, then up), in seconds.
const DUCK_SECONDS = 0.01;

export function buildInsertChain(ctx: AudioContext): InsertChain {
  const units: Record<EffectId, EffectUnit<unknown>> = {
    eq: createEqUnit(ctx) as EffectUnit<unknown>,
    comp: createCompressorUnit(ctx) as EffectUnit<unknown>,
    sat: createSaturatorUnit(ctx) as EffectUnit<unknown>,
    ms: createWidthUnit(ctx) as EffectUnit<unknown>,
  };
  const chainIn = ctx.createGain();
  const chainOut = ctx.createGain();
  let order: EffectId[] = [...DEFAULT_ORDER];

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
  };

  wire(order); // initial connect in default order

  return {
    chainIn,
    chainOut,
    units,
    getOrder: () => [...order],
    reorder: (next: EffectId[]) => {
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
    dispose: () => {
      chainIn.disconnect();
      chainOut.disconnect();
      Object.values(units).forEach((u) => u.dispose());
    },
  };
}
