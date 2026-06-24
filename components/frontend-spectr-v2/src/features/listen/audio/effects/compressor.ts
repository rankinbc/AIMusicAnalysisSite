import { makeDryWet, type EffectMeter, type EffectUnit } from '../EffectUnit';
import type { CompressorState } from '../state';

export function createCompressorUnit(ctx: AudioContext): EffectUnit<CompressorState> {
  const compressor = ctx.createDynamicsCompressor();
  const makeup = ctx.createGain();
  compressor.connect(makeup);

  const { input, output, setWet } = makeDryWet(ctx, compressor, makeup);

  return {
    id: 'comp',
    input,
    output,
    applyParams: (state: CompressorState) => {
      compressor.threshold.value = state.thresholdDb;
      compressor.ratio.value = state.ratio;
      compressor.attack.value = state.attackMs / 1000;
      compressor.release.value = state.releaseMs / 1000;
      compressor.knee.value = state.kneeDb;
      makeup.gain.value = Math.pow(10, state.makeupDb / 20);
      // Parallel (New York) compression: wet level = mix. mix 1 = fully
      // compressed, < 1 blends the un-compressed dry lane back in.
      setWet(state.enabled ? state.mix : 0);
    },
    setBypass: (bypassed: boolean) => setWet(bypassed ? 0 : 1),
    readMeter: (): EffectMeter => ({ reductionDb: compressor.reduction }),
    dispose: () => {
      compressor.disconnect();
      makeup.disconnect();
      input.disconnect();
      output.disconnect();
    },
  };
}
