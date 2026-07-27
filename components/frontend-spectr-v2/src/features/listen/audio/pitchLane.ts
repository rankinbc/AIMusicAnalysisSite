// Pitch lane — a constant-tempo pitch shifter sitting at the very end of the
// master path (masterOut -> lane -> destination). It wraps the `pitch-shift`
// AudioWorklet in a dry/wet bypass and boots with the same placeholder→swap
// pattern as the worklet insert effects: passthrough until the processor
// module has registered.
//
// Pitch and tempo are INDEPENDENT here: tempo is the media element's
// playbackRate (which by itself would drag pitch along), and the lane divides
// that back out of its own ratio, so the note you dial is the note you hear at
// any speed.
import { makeDryWet } from './EffectUnit';

const DUCK_SEC = 0.01;
const RATIO_MIN = 0.25;
const RATIO_MAX = 4;

export interface PitchLane {
  input: GainNode;
  output: GainNode;
  /** Shift in semitones+cents, with `playbackRate` (tempo) divided back out. */
  setShift: (semitones: number, cents: number, playbackRate: number) => void;
  setEnabled: (on: boolean) => void;
  /** Build the AudioWorkletNode and swap it in (call once the module loads). */
  materialize: () => void;
  dispose: () => void;
}

export function createPitchLane(ctx: AudioContext): PitchLane {
  const wetIn = ctx.createGain();
  const wetOut = ctx.createGain();
  wetIn.connect(wetOut); // placeholder passthrough until materialize()
  const { input, output, setWet } = makeDryWet(ctx, wetIn, wetOut);

  let node: AudioWorkletNode | null = null;
  let ratio = 1;
  let enabled = false;
  setWet(0); // start dry — the lane must be inaudible until pitch is engaged

  const push = () => {
    const p = node?.parameters.get('ratio');
    if (p) p.value = ratio;
    // Formant preservation is always on — no rack control surfaces it yet,
    // but the AudioParam exists (default 1) for a future dial. Re-asserting
    // it here is redundant with the processor's own default; it's cheap
    // insurance in case that default ever changes.
    const f = node?.parameters.get('formant');
    if (f) f.value = 1;
  };

  return {
    input,
    output,
    setShift: (semitones, cents, playbackRate) => {
      const rate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
      const want = Math.pow(2, (semitones * 100 + cents) / 1200) / rate;
      ratio = Math.min(RATIO_MAX, Math.max(RATIO_MIN, want));
      push();
    },
    setEnabled: (on) => {
      enabled = on;
      setWet(on ? 1 : 0);
    },
    materialize: () => {
      if (node) return;
      try {
        node = new AudioWorkletNode(ctx, 'pitch-shift', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
      } catch {
        return; // registration failed -> stay a passthrough placeholder
      }
      const g = wetOut.gain;
      const t0 = ctx.currentTime;
      g.cancelScheduledValues(t0);
      g.setValueAtTime(g.value, t0);
      g.linearRampToValueAtTime(0, t0 + DUCK_SEC);
      const live = node;
      window.setTimeout(() => {
        try {
          wetIn.disconnect(wetOut);
        } catch {
          /* already disconnected */
        }
        wetIn.connect(live);
        live.connect(wetOut);
        push(); // re-apply the buffered ratio to the live node
        const t1 = ctx.currentTime;
        g.cancelScheduledValues(t1);
        g.setValueAtTime(0, t1);
        g.linearRampToValueAtTime(1, t1 + DUCK_SEC);
        setWet(enabled ? 1 : 0);
      }, DUCK_SEC * 1000 + 2);
    },
    dispose: () => {
      try {
        node?.disconnect();
      } catch {
        /* no-op */
      }
      [wetIn, wetOut, input, output].forEach((n) => n.disconnect());
    },
  };
}
