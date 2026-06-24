import { bpmSyncHz } from '../dsp/bpmSync';
import { tremoloOffsets } from '../dsp/tremoloMath';
import { makeDryWet, type EffectUnit } from '../EffectUnit';
import { TREMOLO_DEFAULT, type TremoloState } from '../state';

export function createTremoloUnit(ctx: AudioContext): EffectUnit<TremoloState> {
  // Signal path: wetIn -> tremGain -> panner -> wetOut.
  const tremGain = ctx.createGain();
  const panner = ctx.createStereoPanner();
  tremGain.connect(panner);

  // LFO modulation: osc -> depthTrem -> tremGain.gain ; osc -> depthPan -> panner.pan.
  // constTrem provides the DC offset that centers the tremolo gain.
  const osc = ctx.createOscillator();
  const depthTrem = ctx.createGain();
  const depthPan = ctx.createGain();
  const constTrem = ctx.createConstantSource();
  osc.connect(depthTrem).connect(tremGain.gain);
  osc.connect(depthPan).connect(panner.pan);
  constTrem.connect(tremGain.gain);
  osc.start();
  constTrem.start();

  const { input, output, setWet } = makeDryWet(ctx, tremGain, panner);

  const unit: EffectUnit<TremoloState> = {
    id: 'tremolo',
    input,
    output,
    applyParams: (state: TremoloState) => {
      if (!state.enabled) {
        // Neutralize modulation AND dry-pass: gain unity, pan centered.
        depthTrem.gain.value = 0;
        depthPan.gain.value = 0;
        constTrem.offset.value = 1;
        setWet(0);
        return;
      }
      const { offset, depthTrem: dt, depthPan: dp } = tremoloOffsets(state.mode, state.depth);
      constTrem.offset.value = offset;
      depthTrem.gain.value = dt;
      depthPan.gain.value = dp;
      osc.frequency.value = state.sync ? bpmSyncHz(state.division, state.bpm) : state.rateHz;
      osc.type = state.shape;
      setWet(1);
    },
    setBypass: (bypassed: boolean) => setWet(bypassed ? 0 : 1),
    dispose: () => {
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
      try {
        constTrem.stop();
      } catch {
        /* already stopped */
      }
      [tremGain, panner, osc, depthTrem, depthPan, constTrem, input, output].forEach((n) =>
        n.disconnect(),
      );
    },
  };
  unit.applyParams(TREMOLO_DEFAULT);
  return unit;
}
