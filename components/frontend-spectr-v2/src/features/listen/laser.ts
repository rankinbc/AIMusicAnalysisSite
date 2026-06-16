export interface LaserVars {
  '--laser-i': number;
  '--laser-w': string;
  '--laser-glow': string;
  '--laser-boost': string;
  '--laser-sat': string;
}

export const LASER_MAX = 400;

// Mirrors the prototype's setLaserIntensity. 0-100% scales opacity; above 100%
// opacity is pinned and brightness/saturation keep escalating.
export function laserVars(percent: number): LaserVars {
  const v = Math.max(0, Math.min(LASER_MAX, percent));
  const f = v / 100;
  const over = Math.max(0, f - 1);
  return {
    '--laser-i': Math.min(1, 0.12 + f * 0.62),
    '--laser-w': `${(2 + f * 13).toFixed(1)}px`,
    '--laser-glow': `${(1.5 + f * 16).toFixed(1)}px`,
    '--laser-boost': (1 + over * 0.95).toFixed(2),
    '--laser-sat': (1 + over * 0.45).toFixed(2),
  };
}
