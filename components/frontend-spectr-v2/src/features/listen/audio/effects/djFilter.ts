// DJ Tools — the classic DJ performance trio in one insert:
//   sweep  bipolar LP↔HP morph filter (djMorph) + resonance
//   wobble an LFO on the sweep cutoff via the filter's detune param (cents →
//          multiplicative, so depth is musical: 1.0 = ±2 octaves)
//   kills  LOW / MID / HIGH isolator kills (full-cut shelves + mid notch),
//          the DJ-mixer EQ-kill staple
// All native nodes — the LFO oscillator runs permanently (cheap) and its gain
// is 0 unless wobble depth is up.
import { djMorph } from '../dsp/djMorph';
import { makeDryWet, type EffectUnit } from '../EffectUnit';
import { DJFILTER_DEFAULT, type DjFilterState } from '../state';

const WOBBLE_CENTS_MAX = 2400; // depth 1.0 = ±2 octaves around the sweep cutoff
const KILL_DB = -40;

export function createDjFilterUnit(ctx: AudioContext): EffectUnit<DjFilterState> {
  const filter = ctx.createBiquadFilter();
  const killLow = ctx.createBiquadFilter();
  killLow.type = 'lowshelf';
  killLow.frequency.value = 120;
  killLow.gain.value = 0;
  const killMid = ctx.createBiquadFilter();
  killMid.type = 'peaking';
  killMid.frequency.value = 1000;
  killMid.Q.value = 0.7;
  killMid.gain.value = 0;
  const killHigh = ctx.createBiquadFilter();
  killHigh.type = 'highshelf';
  killHigh.frequency.value = 6000;
  killHigh.gain.value = 0;
  filter.connect(killLow).connect(killMid).connect(killHigh);

  // Wobble LFO → filter.detune (cents — multiplicative on the cutoff).
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 2;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0;
  lfo.connect(lfoGain).connect(filter.detune);
  lfo.start();

  const { input, output, setWet } = makeDryWet(ctx, filter, killHigh);

  const unit: EffectUnit<DjFilterState> = {
    id: 'djfilter',
    input,
    output,
    applyParams: (state: DjFilterState) => {
      const { type, freq } = djMorph(state.morph);
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = state.resonance;
      // `??` guards: presets saved before the DJ Tools upgrade carry only
      // morph/resonance — absent params mean "feature off / default".
      lfo.frequency.value = state.wobbleRateHz ?? 2;
      lfo.type = (state.wobbleShape ?? 'sine') as OscillatorType;
      lfoGain.gain.value = (state.wobbleDepth ?? 0) * WOBBLE_CENTS_MAX;
      killLow.gain.value = (state.killLow ?? false) ? KILL_DB : 0;
      killMid.gain.value = (state.killMid ?? false) ? KILL_DB * 0.75 : 0;
      killHigh.gain.value = (state.killHigh ?? false) ? KILL_DB : 0;
      setWet(state.enabled ? 1 : 0);
    },
    setBypass: (bypassed: boolean) => setWet(bypassed ? 0 : 1),
    dispose: () => {
      lfo.stop();
      [lfo, lfoGain, filter, killLow, killMid, killHigh, input, output].forEach((n) => n.disconnect());
    },
  };
  // A fresh BiquadFilter is lowpass @ 350 Hz — NOT transparent at wet=1. Self-init
  // to the default (disabled => setWet(0)) so the built unit is dry passthrough.
  unit.applyParams(DJFILTER_DEFAULT);
  return unit;
}
