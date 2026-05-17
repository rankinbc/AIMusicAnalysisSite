// SPECTRUM panel — horizontal bar chart of the 7 frequency bands emitted by
// phase1. Bars below -45 dB are colored violet (energy gap) so the eye picks
// out spectral holes without reading the axis. Tolerant of undefined `bands`:
// renders an empty-state line instead of throwing.

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { Phase1Bands } from '../../api/types';
import { fmtDb } from './helpers/format';
import s from './FrequencyBars.module.css';

interface FrequencyBarsProps {
  bands: Phase1Bands | undefined;
}

const BAND_ORDER = [
  'sub_bass',
  'bass',
  'low_mid',
  'mid',
  'upper_mid',
  'presence',
  'air',
] as const;

type BandKey = (typeof BAND_ORDER)[number];

const BAND_LABEL: Record<BandKey, string> = {
  sub_bass: 'SUB',
  bass: 'BASS',
  low_mid: 'L.MID',
  mid: 'MID',
  upper_mid: 'U.MID',
  presence: 'PRES',
  air: 'AIR',
};

// Floor for missing bands. Matches the chart domain's lower bound so a missing
// value renders as an empty track rather than a phantom mid-level bar.
const FLOOR_DB = -60;
// Above this threshold the band is "present"; below it we tint violet to
// flag a spectral gap.
const GAP_THRESHOLD_DB = -45;

export function FrequencyBars({ bands }: FrequencyBarsProps) {
  if (!bands) {
    return (
      <section className={s.panel}>
        <h3 className={s.title}>Spectrum</h3>
        <p className={s.empty}>No spectrum data.</p>
      </section>
    );
  }

  const data = BAND_ORDER.map((k) => ({
    band: BAND_LABEL[k],
    db: bands[k] ?? FLOOR_DB,
  }));

  return (
    <section className={s.panel}>
      <h3 className={s.title}>Spectrum</h3>
      <div className={s.chart}>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart
            layout="vertical"
            data={data}
            margin={{ top: 8, right: 32, bottom: 8, left: 8 }}
          >
            <XAxis
              type="number"
              domain={[-60, 0]}
              stroke="var(--muted)"
              fontSize={11}
              tickFormatter={(v: number) => `${v} dB`}
            />
            <YAxis
              type="category"
              dataKey="band"
              stroke="var(--muted)"
              fontSize={11}
              width={48}
            />
            <Tooltip
              cursor={{ fill: 'var(--cyan-dim)' }}
              contentStyle={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: 8,
              }}
              labelStyle={{ color: 'var(--text)' }}
              formatter={(value: number) => [fmtDb(value), 'Level']}
            />
            <Bar dataKey="db" fill="var(--cyan)" radius={[0, 4, 4, 0]}>
              {data.map((d, i) => (
                <Cell
                  key={i}
                  fill={d.db < GAP_THRESHOLD_DB ? 'var(--violet)' : 'var(--cyan)'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
