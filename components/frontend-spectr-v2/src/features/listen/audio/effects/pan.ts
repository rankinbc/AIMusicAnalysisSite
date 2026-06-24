import { makeDryWet, type EffectUnit } from '../EffectUnit';
import { PAN_DEFAULT, type PanState } from '../state';

export function createPanUnit(ctx: AudioContext): EffectUnit<PanState> {
  const panner = ctx.createStereoPanner();
  const { input, output, setWet } = makeDryWet(ctx, panner, panner);

  const unit: EffectUnit<PanState> = {
    id: 'pan',
    input,
    output,
    applyParams: (state: PanState) => {
      panner.pan.value = state.enabled ? state.pan : 0;
      setWet(state.enabled ? 1 : 0);
    },
    setBypass: (bypassed: boolean) => setWet(bypassed ? 0 : 1),
    dispose: () => {
      [panner, input, output].forEach((n) => n.disconnect());
    },
  };
  // Self-init to transparent (dry passthrough) — no post-build sweep exists.
  unit.applyParams(PAN_DEFAULT);
  return unit;
}
