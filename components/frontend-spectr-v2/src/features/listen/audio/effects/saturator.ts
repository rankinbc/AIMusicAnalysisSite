import { makeSatCurve } from '../dsp/curves';
import { makeDryWet, type EffectUnit } from '../EffectUnit';
import type { SaturationState } from '../state';

// Tone-tilt shelf pivots + max boost/cut for the `tone` param.
const TONE_LOW_HZ = 320;
const TONE_HIGH_HZ = 3200;
const TONE_MAX_DB = 6;

export function createSaturatorUnit(ctx: AudioContext): EffectUnit<SaturationState> {
  const shaper = ctx.createWaveShaper();
  shaper.curve = makeSatCurve(0, 'tanh', 0);
  shaper.oversample = '2x';

  // DC blocker — asymmetry introduces DC. Parked sub-audio (10 Hz, transparent
  // for >=20 Hz program) until asymmetry != 0, where it moves up to 20 Hz.
  const dcBlocker = ctx.createBiquadFilter();
  dcBlocker.type = 'highpass';
  dcBlocker.frequency.value = 10;
  dcBlocker.Q.value = 0.707;

  // Tone tilt — low-shelf + high-shelf pair, both flat (0 dB) at tone=0.
  const toneLow = ctx.createBiquadFilter();
  toneLow.type = 'lowshelf';
  toneLow.frequency.value = TONE_LOW_HZ;
  toneLow.gain.value = 0;
  const toneHigh = ctx.createBiquadFilter();
  toneHigh.type = 'highshelf';
  toneHigh.frequency.value = TONE_HIGH_HZ;
  toneHigh.gain.value = 0;

  const trim = ctx.createGain();
  trim.gain.value = 1;

  shaper.connect(dcBlocker).connect(toneLow).connect(toneHigh).connect(trim);

  const { input, output, setWet } = makeDryWet(ctx, shaper, trim);

  return {
    id: 'sat',
    input,
    output,
    applyParams: (state: SaturationState) => {
      const on = state.enabled;
      shaper.curve = makeSatCurve(on ? state.drive : 0, state.curve, on ? state.asymmetry : 0);
      shaper.oversample = state.oversample;
      dcBlocker.frequency.value = on && state.asymmetry !== 0 ? 20 : 10;
      const tilt = on ? state.tone : 0;
      toneLow.gain.value = -tilt * TONE_MAX_DB;
      toneHigh.gain.value = tilt * TONE_MAX_DB;
      trim.gain.value = Math.pow(10, (on ? state.outputTrimDb : 0) / 20);
      // A saturator has no "full wet" identity — its wet level IS the mix param.
      setWet(on ? state.mix : 0);
    },
    setBypass: () => setWet(0),
    dispose: () => {
      [shaper, dcBlocker, toneLow, toneHigh, trim, input, output].forEach((n) => n.disconnect());
    },
  };
}
