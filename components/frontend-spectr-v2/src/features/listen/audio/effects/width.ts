import { msGains } from '../dsp/msMatrix';
import { makeDryWet, type EffectUnit } from '../EffectUnit';
import type { WidthState } from '../state';

export function createWidthUnit(ctx: AudioContext): EffectUnit<WidthState> {
  const splitter = ctx.createChannelSplitter(2);
  const midL = ctx.createGain();
  const midR = ctx.createGain();
  const sideL = ctx.createGain();
  const sideR = ctx.createGain();
  const merger = ctx.createChannelMerger(2);

  // L_in -> midL -> merger.0 ; R_in -> sideL -> merger.0
  // L_in -> midR -> merger.1 ; R_in -> sideR -> merger.1
  splitter.connect(midL, 0);
  splitter.connect(sideL, 1);
  splitter.connect(midR, 0);
  splitter.connect(sideR, 1);
  midL.connect(merger, 0, 0);
  sideL.connect(merger, 0, 0);
  midR.connect(merger, 0, 1);
  sideR.connect(merger, 0, 1);

  const setMatrix = (width: number) => {
    const g = msGains(width);
    midL.gain.value = g.midL;
    midR.gain.value = g.midR;
    sideL.gain.value = g.sideL;
    sideR.gain.value = g.sideR;
  };
  setMatrix(1); // identity default

  const { input, output, setWet } = makeDryWet(ctx, splitter, merger);

  return {
    id: 'ms',
    input,
    output,
    applyParams: (state: WidthState) => setMatrix(state.enabled ? state.width : 1),
    setBypass: (bypassed: boolean) => setWet(bypassed ? 0 : 1),
    dispose: () => {
      [splitter, midL, midR, sideL, sideR, merger, input, output].forEach((n) =>
        n.disconnect(),
      );
    },
  };
}
