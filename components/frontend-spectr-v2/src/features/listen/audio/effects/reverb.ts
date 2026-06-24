import { irEnvelope } from '../dsp/irSynth';
import { makeDryWet, type EffectUnit } from '../EffectUnit';
import { REVERB_DEFAULT, type IrType, type ReverbState } from '../state';

const MAX_PREDELAY_SEC = 0.5;

function buildIr(ctx: AudioContext, ir: IrType, decaySec: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const length = Math.max(1, Math.ceil(decaySec * sr));
  const buffer = ctx.createBuffer(2, length, sr);
  for (let ch = 0; ch < 2; ch += 1) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * irEnvelope(ir, i / sr, decaySec);
    }
  }
  return buffer;
}

export function createReverbUnit(ctx: AudioContext): EffectUnit<ReverbState> {
  const preDelay = ctx.createDelay(MAX_PREDELAY_SEC);
  const convolver = ctx.createConvolver();
  const damping = ctx.createBiquadFilter();
  damping.type = 'lowpass';
  preDelay.connect(convolver).connect(damping);

  const { input, output, setWet } = makeDryWet(ctx, preDelay, damping);

  // Rebuild the IR only when ir/decay change (the fill loop is O(decaySec*sr)).
  let lastIr: IrType | null = null;
  let lastDecay = -1;

  const unit: EffectUnit<ReverbState> = {
    id: 'reverb',
    input,
    output,
    applyParams: (state: ReverbState) => {
      if (state.ir !== lastIr || state.decaySec !== lastDecay) {
        convolver.buffer = buildIr(ctx, state.ir, state.decaySec);
        lastIr = state.ir;
        lastDecay = state.decaySec;
      }
      preDelay.delayTime.value = state.preDelayMs / 1000;
      damping.frequency.value = state.dampingHz;
      setWet(state.enabled ? state.mix : 0);
    },
    setBypass: (bypassed: boolean) => setWet(bypassed ? 0 : 1),
    dispose: () => {
      [preDelay, convolver, damping, input, output].forEach((n) => n.disconnect());
    },
  };
  // A null-buffer ConvolverNode outputs silence — self-init builds the default IR
  // and (mix 0 / disabled) sets wet=0 so the built unit is dry passthrough.
  unit.applyParams(REVERB_DEFAULT);
  return unit;
}
