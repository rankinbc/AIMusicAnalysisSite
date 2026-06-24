import { makeDryWet, type EffectId, type EffectMeter, type EffectUnit } from './EffectUnit';

// Each side of the materialize duck (down, then up), in seconds.
const DUCK_SEC = 0.01;

export interface WorkletEffectConfig<S> {
  id: EffectId;
  processorName: string;
  // state -> AudioParam name:value pairs (names MUST match the processor's
  // parameterDescriptors).
  params: (state: S) => Record<string, number>;
  // wet amount for the dry/wet bypass: gate/limiter -> enabled?1:0;
  // bitcrusher -> enabled?mix:0.
  wet: (state: S) => number;
  // true if the processor posts a meter object over its port.
  meter: boolean;
}

// A worklet EffectUnit with a placeholder-then-swap boot. input/output are stable
// gains (the composer wires them); the wet lane is a passthrough until
// materialize() builds the AudioWorkletNode and swaps it in.
export function createWorkletEffect<S>(
  ctx: AudioContext,
  config: WorkletEffectConfig<S>,
  defaultState: S,
): EffectUnit<S> {
  const wetIn = ctx.createGain();
  const wetOut = ctx.createGain();
  wetIn.connect(wetOut); // placeholder passthrough
  const { input, output, setWet } = makeDryWet(ctx, wetIn, wetOut);

  let node: AudioWorkletNode | null = null;
  let lastState: S = defaultState;
  let lastMeter: EffectMeter = {};

  const pushParams = (state: S): void => {
    if (!node) return;
    const p = config.params(state);
    for (const name of Object.keys(p)) {
      const ap = node.parameters.get(name);
      if (ap) ap.value = p[name];
    }
  };

  const unit: EffectUnit<S> = {
    id: config.id,
    input,
    output,
    applyParams: (state: S) => {
      lastState = state;
      pushParams(state);
      setWet(config.wet(state));
    },
    setBypass: (bypassed: boolean) => setWet(bypassed ? 0 : 1),
    materialize: () => {
      if (node) return;
      try {
        node = new AudioWorkletNode(ctx, config.processorName, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
      } catch {
        return; // registration failed -> stay a passthrough placeholder
      }
      if (config.meter) {
        node.port.onmessage = (e: MessageEvent) => {
          lastMeter = e.data as EffectMeter;
        };
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
        pushParams(lastState); // re-apply buffered params to the live node
        const t1 = ctx.currentTime;
        g.cancelScheduledValues(t1);
        g.setValueAtTime(0, t1);
        g.linearRampToValueAtTime(1, t1 + DUCK_SEC);
      }, DUCK_SEC * 1000 + 2);
    },
    dispose: () => {
      try {
        node?.port.close();
      } catch {
        /* no-op */
      }
      try {
        node?.disconnect();
      } catch {
        /* no-op */
      }
      [wetIn, wetOut, input, output].forEach((n) => n.disconnect());
    },
  };

  if (config.meter) {
    unit.readMeter = () => lastMeter;
  }

  // Self-init: applyParams(default) -> disabled => setWet(0) => dry passthrough.
  unit.applyParams(defaultState);
  return unit;
}
