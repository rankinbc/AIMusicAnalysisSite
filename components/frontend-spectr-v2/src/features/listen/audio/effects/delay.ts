import { bpmSyncSeconds } from '../dsp/bpmSync';
import { makeDryWet, type EffectUnit } from '../EffectUnit';
import { DELAY_DEFAULT, type DelayState } from '../state';

const MAX_DELAY_SEC = 3;

export function createDelayUnit(ctx: AudioContext): EffectUnit<DelayState> {
  // Stereo cross-feedback topology. Straight vs ping-pong is selected by which
  // feedback gains are live (no runtime reconnect).
  const splitter = ctx.createChannelSplitter(2);
  const dL = ctx.createDelay(MAX_DELAY_SEC);
  const dR = ctx.createDelay(MAX_DELAY_SEC);
  const toneL = ctx.createBiquadFilter();
  const toneR = ctx.createBiquadFilter();
  toneL.type = 'lowpass';
  toneR.type = 'lowpass';
  const fbStraightL = ctx.createGain();
  const fbStraightR = ctx.createGain();
  const fbCrossL = ctx.createGain();
  const fbCrossR = ctx.createGain();
  const merger = ctx.createChannelMerger(2);

  splitter.connect(dL, 0);
  splitter.connect(dR, 1);
  dL.connect(toneL);
  dR.connect(toneR);
  // Straight feedback: each side loops back into itself.
  toneL.connect(fbStraightL).connect(dL);
  toneR.connect(fbStraightR).connect(dR);
  // Cross feedback (ping-pong): each side loops into the other.
  toneL.connect(fbCrossL).connect(dR);
  toneR.connect(fbCrossR).connect(dL);
  // Taps to the stereo output.
  dL.connect(merger, 0, 0);
  dR.connect(merger, 0, 1);

  const { input, output, setWet } = makeDryWet(ctx, splitter, merger);

  const unit: EffectUnit<DelayState> = {
    id: 'delay',
    input,
    output,
    applyParams: (state: DelayState) => {
      const raw = state.sync ? bpmSyncSeconds(state.division, state.bpm) : state.timeMs / 1000;
      const time = Math.min(MAX_DELAY_SEC, Math.max(0, raw));
      dL.delayTime.value = time;
      dR.delayTime.value = time;
      toneL.frequency.value = state.toneHz;
      toneR.frequency.value = state.toneHz;
      const fb = Math.min(0.95, Math.max(0, state.feedback));
      fbStraightL.gain.value = state.pingPong ? 0 : fb;
      fbStraightR.gain.value = state.pingPong ? 0 : fb;
      fbCrossL.gain.value = state.pingPong ? fb : 0;
      fbCrossR.gain.value = state.pingPong ? fb : 0;
      setWet(state.enabled ? state.mix : 0);
    },
    setBypass: (bypassed: boolean) => setWet(bypassed ? 0 : 1),
    dispose: () => {
      [
        splitter,
        dL,
        dR,
        toneL,
        toneR,
        fbStraightL,
        fbStraightR,
        fbCrossL,
        fbCrossR,
        merger,
        input,
        output,
      ].forEach((n) => n.disconnect());
    },
  };
  // Fresh feedback GainNodes default to gain 1 (runaway) — self-init to the
  // default (mix 0 / disabled => setWet(0), feedback set to 0.35 straight).
  unit.applyParams(DELAY_DEFAULT);
  return unit;
}
