import { makeDryWet, type EffectUnit } from '../EffectUnit';
import type { EqState } from '../state';

const EQ_FREQS = [60, 170, 350, 700, 1400, 3500, 7000, 14000];

export function createEqUnit(ctx: AudioContext): EffectUnit<EqState> {
  const filters = EQ_FREQS.map((freq) => {
    const f = ctx.createBiquadFilter();
    f.type = 'peaking';
    f.frequency.value = freq;
    f.Q.value = 1.4;
    f.gain.value = 0;
    return f;
  });
  for (let i = 0; i < filters.length - 1; i += 1) {
    filters[i].connect(filters[i + 1]);
  }
  const { input, output, setWet } = makeDryWet(ctx, filters[0], filters[filters.length - 1]);

  return {
    id: 'eq',
    input,
    output,
    applyParams: (state: EqState) => {
      for (let i = 0; i < filters.length; i += 1) {
        const band = state.bands[i];
        if (!band) continue;
        filters[i].type = band.type;
        filters[i].frequency.value = band.freq;
        filters[i].Q.value = band.q;
        // gain applies to peaking/shelf types only (Web Audio ignores it on
        // filter types). A disabled band — or disabled unit — flattens to 0 dB.
        filters[i].gain.value = state.enabled && band.enabled ? band.gainDb : 0;
      }
      setWet(state.enabled ? 1 : 0);
    },
    setBypass: (bypassed: boolean) => setWet(bypassed ? 0 : 1),
    dispose: () => {
      filters.forEach((f) => f.disconnect());
      input.disconnect();
      output.disconnect();
    },
  };
}
