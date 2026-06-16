import { describe, it, expect } from 'vitest';
import { spawnBurst, stepParticles, type Particle } from './fireworksParticles';

describe('fireworks', () => {
  it('spawns the requested ring of particles', () => {
    const parts = spawnBurst(100, 50, () => 0.5, 40);
    expect(parts).toHaveLength(40);
    for (const p of parts) {
      expect(p.x).toBe(100);
      expect(p.y).toBe(50);
      expect(p.life).toBe(1);
    }
  });

  it('applies gravity, drag, and decay each step', () => {
    const start: Particle[] = [
      { x: 0, y: 0, vx: 2, vy: 0, life: 1, decay: 0.1, col: '#fff', r: 2 },
    ];
    const [p] = stepParticles(start);
    expect(p.vy).toBeCloseTo(0.05);
    expect(p.vx).toBeCloseTo(2 * 0.985);
    expect(p.x).toBeCloseTo(2 * 0.985);
    expect(p.life).toBeCloseTo(0.9);
  });

  it('drops dead particles', () => {
    const dying: Particle[] = [
      { x: 0, y: 0, vx: 0, vy: 0, life: 0.05, decay: 0.1, col: '#fff', r: 2 },
    ];
    expect(stepParticles(dying)).toHaveLength(0);
  });
});
