// meterHooks.ts — design-agnostic metering glue for the Listen rack UI.
//
// These hooks do the rAF-throttled polling + change-gating so a meter component
// just consumes a number/object and re-renders only when it actually changes.
// They hold NO visual opinion — the UI draws whatever it wants from the values.
//
// IMPORTANT: use these for SCALAR readouts (GR dB, LUFS, true-peak, correlation).
// For canvas visualizers (spectrum bars, scope/goniometer) do NOT route the
// Float32Array buffers through React state — read `graph.readFrame()` imperatively
// in your own rAF and draw to canvas (the buffers are reused/mutated in place).

import { useEffect, useState } from 'react';

import type { EffectId, EffectMeter } from './audio/EffectUnit';
import type { AudioFrame, AudioGraphHandle } from './useAudioGraph';

/**
 * Live gain-reduction (and gate open-state) for a metering module.
 * Only `comp`, `gate`, and `limiter` emit data; everything else stays null.
 *
 *   const gr = useEffectMeter(graph, 'comp');     // { reductionDb } | null
 *   const gate = useEffectMeter(graph, 'gate');   // { reductionDb, open } | null
 */
export function useEffectMeter(
  graph: AudioGraphHandle,
  id: EffectId,
  fps = 30,
): EffectMeter | null {
  const [meter, setMeter] = useState<EffectMeter | null>(null);
  useEffect(() => {
    let raf = 0;
    let last = -Infinity;
    const interval = 1000 / fps;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < interval) return;
      last = t;
      const next = graph.readEffectMeter(id);
      setMeter((prev) => (meterEquals(prev, next) ? prev : next));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [graph, id, fps]);
  return meter;
}

function meterEquals(a: EffectMeter | null, b: EffectMeter | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.reductionDb === b.reductionDb && a.open === b.open;
}

export type AudioLevels = Pick<AudioFrame, 'rmsDb' | 'lufsShort' | 'truePeakDb' | 'correlation'>;

/**
 * Live scalar level readouts from `readFrame()` (RMS, short-LUFS, true-peak,
 * L/R correlation) — safe to hold in React state (plain numbers, not buffers).
 *
 *   const levels = useAudioLevels(graph);  // { rmsDb, lufsShort, truePeakDb, correlation } | null
 */
export function useAudioLevels(graph: AudioGraphHandle, fps = 20): AudioLevels | null {
  const [levels, setLevels] = useState<AudioLevels | null>(null);
  useEffect(() => {
    let raf = 0;
    let last = -Infinity;
    const interval = 1000 / fps;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < interval) return;
      last = t;
      const f = graph.readFrame();
      const next: AudioLevels = {
        rmsDb: f.rmsDb,
        lufsShort: f.lufsShort,
        truePeakDb: f.truePeakDb,
        correlation: f.correlation,
      };
      setLevels((prev) => (levelsEqual(prev, next) ? prev : next));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [graph, fps]);
  return levels;
}

function levelsEqual(a: AudioLevels | null, b: AudioLevels): boolean {
  if (!a) return false;
  return (
    a.rmsDb === b.rmsDb &&
    a.lufsShort === b.lufsShort &&
    a.truePeakDb === b.truePeakDb &&
    a.correlation === b.correlation
  );
}
