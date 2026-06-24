import { msGains } from '../dsp/msMatrix';
import { makeDryWet, type EffectUnit } from '../EffectUnit';
import type { WidthState } from '../state';

export function createWidthUnit(ctx: AudioContext): EffectUnit<WidthState> {
  // Stable wet entry/exit so the mono-maker correction can tap the same input
  // and sum into the same output as the width matrix.
  const preGain = ctx.createGain();
  const finalMerger = ctx.createChannelMerger(2);

  // ── Width matrix (full-range) ──
  const splitter = ctx.createChannelSplitter(2);
  const midL = ctx.createGain();
  const midR = ctx.createGain();
  const sideL = ctx.createGain();
  const sideR = ctx.createGain();
  preGain.connect(splitter);
  splitter.connect(midL, 0);
  splitter.connect(sideL, 1);
  splitter.connect(midR, 0);
  splitter.connect(sideR, 1);
  midL.connect(finalMerger, 0, 0);
  sideL.connect(finalMerger, 0, 0);
  midR.connect(finalMerger, 0, 1);
  sideR.connect(finalMerger, 0, 1);

  // ── Mono-maker correction ──
  // sideBus = 0.5*L - 0.5*R = S (mono). lowpass(S) -> corrGain -> ±finalMerger.
  // corrGain 0 (default / monoMakerHz<=0) => exactly the matrix above.
  const corrSplitter = ctx.createChannelSplitter(2);
  const sPos = ctx.createGain();
  const sNeg = ctx.createGain();
  sPos.gain.value = 0.5;
  sNeg.gain.value = -0.5;
  const sideBus = ctx.createGain();
  const corrLP = ctx.createBiquadFilter();
  corrLP.type = 'lowpass';
  corrLP.frequency.value = 200;
  corrLP.Q.value = 0.707;
  const corrGain = ctx.createGain();
  corrGain.gain.value = 0;
  const cNeg = ctx.createGain(); // -> L_out (subtract low-band side)
  const cPos = ctx.createGain(); // -> R_out (add low-band side)
  cNeg.gain.value = -1;
  cPos.gain.value = 1;

  preGain.connect(corrSplitter);
  corrSplitter.connect(sPos, 0);
  corrSplitter.connect(sNeg, 1);
  sPos.connect(sideBus);
  sNeg.connect(sideBus);
  sideBus.connect(corrLP).connect(corrGain);
  corrGain.connect(cNeg).connect(finalMerger, 0, 0);
  corrGain.connect(cPos).connect(finalMerger, 0, 1);

  const setMatrix = (width: number, midGain: number, sideGain: number) => {
    const g = msGains(width, midGain, sideGain);
    midL.gain.value = g.midL;
    midR.gain.value = g.midR;
    sideL.gain.value = g.sideL;
    sideR.gain.value = g.sideR;
  };
  setMatrix(1, 1, 1); // identity default

  const { input, output, setWet } = makeDryWet(ctx, preGain, finalMerger);

  return {
    id: 'ms',
    input,
    output,
    applyParams: (state: WidthState) => {
      if (!state.enabled) {
        setMatrix(1, 1, 1);
        corrGain.gain.value = 0;
        return;
      }
      const gM = Math.pow(10, state.midGainDb / 20);
      const gS = Math.pow(10, state.sideGainDb / 20);
      const w = state.mono ? 0 : state.width;
      setMatrix(w, gM, gS);
      // Mono-maker: null the low-band side. Correction level tracks the matrix
      // side level (gS * w). Off (gain 0) when monoMakerHz <= 0 => pure matrix.
      if (state.monoMakerHz > 0) {
        corrLP.frequency.value = state.monoMakerHz;
        corrGain.gain.value = gS * w;
      } else {
        corrGain.gain.value = 0;
      }
    },
    setBypass: (bypassed: boolean) => setWet(bypassed ? 0 : 1),
    dispose: () => {
      [
        preGain,
        splitter,
        midL,
        midR,
        sideL,
        sideR,
        corrSplitter,
        sPos,
        sNeg,
        sideBus,
        corrLP,
        corrGain,
        cNeg,
        cPos,
        finalMerger,
        input,
        output,
      ].forEach((n) => n.disconnect());
    },
  };
}
