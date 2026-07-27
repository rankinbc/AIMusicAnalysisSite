/* Listen Rack v2 — live output meters for the toolbar LCD (MeterLcd) + any
 * stage overlays. Real route: read the shared AudioFrame (+ GR via
 * readEffectMeter through `readGr`). Mock route: the prototype's simulated
 * wander so the page still reads as an audio surface.
 *
 * `out` is the output RMS level (dBFS); `clip` is a LATCHING clip indicator —
 * true peak at/over 0 dBTP lights it and it holds for CLIP_HOLD_MS so a
 * single-sample over doesn't blink past the eye (classic DAW clip LED). */
import { useEffect, useRef, useState } from 'react';

import type { AudioFrame } from '../listen/useAudioGraph';
import type { ModuleState } from './data';
import { lrClamp } from './lrUtil';

export interface LiveMeters {
  lufs: number;
  tp: number;
  corr: number;
  gr: number;
  /** Output level, RMS dBFS. */
  out: number;
  /** Latched clip warning (true peak hit ≥ 0 dBTP within the hold window). */
  clip: boolean;
}

const CLIP_HOLD_MS = 2000;
const CLIP_AT_DBTP = -0.02;

export function useLiveMeters(
  playing: boolean,
  mod: Record<string, ModuleState>,
  bypass: boolean,
  getFrame: (() => AudioFrame) | null,
  readGr: (() => number) | null,
): LiveMeters {
  const [v, setV] = useState<LiveMeters>({ lufs: -11.2, tp: -0.6, corr: 0.71, gr: 0, out: -14, clip: false });
  const clipUntil = useRef(0);
  const limEnabled = mod['limiter']?.enabled ?? false;
  const limCeiling = Number(mod['limiter']?.['ceilingDb'] ?? -1);
  const compEnabled = mod['comp']?.enabled ?? false;
  useEffect(() => {
    if (!playing) return undefined;
    const iv = setInterval(() => {
      const now = Date.now();
      const latch = (tp: number) => {
        if (tp >= CLIP_AT_DBTP) clipUntil.current = now + CLIP_HOLD_MS;
        return now < clipUntil.current;
      };
      if (getFrame) {
        const f = getFrame();
        const tp = Number.isFinite(f.truePeakDb) ? lrClamp(f.truePeakDb, -60, 6) : -60;
        setV({
          lufs: Number.isFinite(f.lufsShort) ? lrClamp(f.lufsShort, -60, 0) : -60,
          tp,
          corr: Number.isFinite(f.correlation) ? f.correlation : 0,
          gr: readGr ? readGr() : 0,
          out: Number.isFinite(f.rmsDb) ? lrClamp(f.rmsDb, -60, 6) : -60,
          clip: latch(tp),
        });
        return;
      }
      setV((p) => {
        const lim = limEnabled && !bypass;
        const comp = compEnabled && !bypass;
        const tp = lim ? limCeiling - Math.random() * 0.25 : lrClamp(p.tp + (Math.random() - 0.5) * 0.3, -1.4, 0.4);
        return {
          lufs: lrClamp(p.lufs + (Math.random() - 0.5) * 0.5, -13.5, -9.5),
          tp,
          corr: lrClamp(p.corr + (Math.random() - 0.5) * 0.05, 0.35, 0.95),
          gr: comp || lim ? Math.abs(Math.sin(Date.now() / 420)) * (comp ? 3.4 : 1.6) : 0,
          out: lrClamp(p.out + (Math.random() - 0.5) * 0.6, -18, -10),
          clip: latch(tp),
        };
      });
    }, 220);
    return () => clearInterval(iv);
  }, [playing, limEnabled, limCeiling, compEnabled, bypass, getFrame, readGr]);
  return v;
}
