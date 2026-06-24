import { djMorph } from '../dsp/djMorph';
import { makeDryWet, type EffectUnit } from '../EffectUnit';
import { DJFILTER_DEFAULT, type DjFilterState } from '../state';

export function createDjFilterUnit(ctx: AudioContext): EffectUnit<DjFilterState> {
  const filter = ctx.createBiquadFilter();
  const { input, output, setWet } = makeDryWet(ctx, filter, filter);

  const unit: EffectUnit<DjFilterState> = {
    id: 'djfilter',
    input,
    output,
    applyParams: (state: DjFilterState) => {
      const { type, freq } = djMorph(state.morph);
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = state.resonance;
      setWet(state.enabled ? 1 : 0);
    },
    setBypass: (bypassed: boolean) => setWet(bypassed ? 0 : 1),
    dispose: () => {
      [filter, input, output].forEach((n) => n.disconnect());
    },
  };
  // A fresh BiquadFilter is lowpass @ 350 Hz — NOT transparent at wet=1. Self-init
  // to the default (disabled => setWet(0)) so the built unit is dry passthrough.
  unit.applyParams(DJFILTER_DEFAULT);
  return unit;
}
