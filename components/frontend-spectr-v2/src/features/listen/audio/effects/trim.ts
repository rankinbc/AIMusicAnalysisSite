import { makeDryWet, type EffectUnit } from '../EffectUnit';
import { TRIM_DEFAULT, type TrimState } from '../state';

export function createTrimUnit(ctx: AudioContext): EffectUnit<TrimState> {
  const trimGain = ctx.createGain();
  const { input, output, setWet } = makeDryWet(ctx, trimGain, trimGain);

  const unit: EffectUnit<TrimState> = {
    id: 'trim',
    input,
    output,
    applyParams: (state: TrimState) => {
      trimGain.gain.value = Math.pow(10, state.gainDb / 20);
      setWet(state.enabled ? 1 : 0);
    },
    setBypass: (bypassed: boolean) => setWet(bypassed ? 0 : 1),
    dispose: () => {
      [trimGain, input, output].forEach((n) => n.disconnect());
    },
  };
  // Default is enabled at unity (0 dB) => transparent.
  unit.applyParams(TRIM_DEFAULT);
  return unit;
}
