export interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; decay: number; col: string; r: number;
}

export const FIREWORK_PALETTE = [
  '#f472b6', '#5eead4', '#fbbf24', '#60a5fa', '#a3e635', '#a78bfa', '#fb7185', '#ffffff',
];

type Rng = () => number;

// One radial burst of `count` particles from (x, y). `rng` is injectable for tests.
export function spawnBurst(x: number, y: number, rng: Rng, count = 50 + ((Math.random() * 30) | 0)): Particle[] {
  const base = FIREWORK_PALETTE[(rng() * FIREWORK_PALETTE.length) | 0] ?? '#ffffff';
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const a = Math.PI * 2 * (i / count) + rng() * 0.35;
    const sp = 1.8 + rng() * 3.8;
    out.push({
      x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: 1, decay: 0.009 + rng() * 0.011,
      col: rng() < 0.16 ? '#ffffff' : base,
      r: 1.3 + rng() * 1.9,
    });
  }
  return out;
}

// Advances every particle one frame and returns survivors (life > 0).
export function stepParticles(parts: Particle[]): Particle[] {
  const out: Particle[] = [];
  for (const p of parts) {
    const vy = (p.vy + 0.05) * 0.985;
    const vx = p.vx * 0.985;
    const next: Particle = {
      ...p, vx, vy,
      x: p.x + vx, y: p.y + vy,
      life: p.life - p.decay,
    };
    if (next.life > 0) out.push(next);
  }
  return out;
}
