import { makeSatCurve } from '../dsp/curves';
import { makeDryWet, type EffectUnit } from '../EffectUnit';
import type { SaturationState } from '../state';

export function createSaturatorUnit(ctx: AudioContext): EffectUnit<SaturationState> {
  const shaper = ctx.createWaveShaper();
  shaper.curve = makeSatCurve(0);
  shaper.oversample = '2x';

  const { input, output, setWet } = makeDryWet(ctx, shaper, shaper);

  return {
    id: 'sat',
    input,
    output,
    applyParams: (state: SaturationState) => {
      shaper.curve = makeSatCurve(state.enabled ? state.drive : 0);
      setWet(state.enabled ? state.mix : 0);
    },
    // A saturator has no "full wet" identity — its wet level IS the mix param,
    // re-applied by the next applyParams. Bypass forces dry.
    setBypass: () => setWet(0),
    dispose: () => {
      shaper.disconnect();
      input.disconnect();
      output.disconnect();
    },
  };
}
