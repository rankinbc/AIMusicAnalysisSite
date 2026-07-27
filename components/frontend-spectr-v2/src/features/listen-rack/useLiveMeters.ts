/* Listen Rack v2 — live output meters for the stage overlay chips + header
 * stat line. Real route: read the shared AudioFrame (+ GR via readEffectMeter
 * through `readGr`). Mock route: the prototype's simulated wander so the page
 * still reads as an audio surface. */
import { useEffect, useState } from 'react';

import type { AudioFrame } from '../listen/useAudioGraph';
import type { ModuleState } from './data';
import { lrClamp } from './lrUtil';

export interface LiveMeters { lufs: number; tp: number; corr: number; gr: number }

export function useLiveMeters(
  playing: boolean,
  mod: Record<string, ModuleState>,
  bypass: boolean,
  getFrame: (() => AudioFrame) | null,
  readGr: (() => number) | null,
): LiveMeters {
  const [v, setV] = useState<LiveMeters>({ lufs: -11.2, tp: -0.6, corr: 0.71, gr: 0 });
  const limEnabled = mod['limiter']?.enabled ?? false;
  const limCeiling = Number(mod['limiter']?.['ceilingDb'] ?? -1);
  const compEnabled = mod['comp']?.enabled ?? false;
  useEffect(() => {
    if (!playing) return undefined;
    const iv = setInterval(() => {
      if (getFrame) {
        const f = getFrame();
        setV({
          lufs: Number.isFinite(f.lufsShort) ? lrClamp(f.lufsShort, -60, 0) : -60,
          tp: Number.isFinite(f.truePeakDb) ? lrClamp(f.truePeakDb, -60, 6) : -60,
          corr: Number.isFinite(f.correlation) ? f.correlation : 0,
          gr: readGr ? readGr() : 0,
        });
        return;
      }
      setV((p) => {
        const lim = limEnabled && !bypass;
        const comp = compEnabled && !bypass;
        return {
          lufs: lrClamp(p.lufs + (Math.random() - 0.5) * 0.5, -13.5, -9.5),
          tp: lim ? limCeiling - Math.random() * 0.25 : lrClamp(p.tp + (Math.random() - 0.5) * 0.3, -1.4, 0.4),
          corr: lrClamp(p.corr + (Math.random() - 0.5) * 0.05, 0.35, 0.95),
          gr: comp || lim ? Math.abs(Math.sin(Date.now() / 420)) * (comp ? 3.4 : 1.6) : 0,
        };
      });
    }, 220);
    return () => clearInterval(iv);
  }, [playing, limEnabled, limCeiling, compEnabled, bypass, getFrame, readGr]);
  return v;
}
