import { makeDryWet, type EffectUnit } from '../EffectUnit';
import { EQ_BANDS_DEFAULT, type EqState } from '../state';

const EQ_FREQS = EQ_BANDS_DEFAULT.map((b) => b.freq);

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
        const active = state.enabled && band.enabled;
        // A disabled highpass/lowpass band still FILTERS at gain 0 — force the
        // slot to a flat 0 dB peaking so "band off" is truly neutral.
        filters[i].type = active ? band.type : 'peaking';
        filters[i].frequency.value = band.freq;
        filters[i].Q.value = band.q;
        // gain applies to peaking/shelf types only (Web Audio ignores it on
        // filter types). A disabled band — or disabled unit — flattens to 0 dB.
        filters[i].gain.value = active ? band.gainDb : 0;
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
