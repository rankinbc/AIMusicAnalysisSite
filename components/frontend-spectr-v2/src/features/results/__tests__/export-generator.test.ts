import { describe, expect, it } from 'vitest';

import type { Move } from '../move-model';
import {
  DEFAULT_EXPORT_OPTS,
  generateGamePlan,
  selectMoves,
  stripMarkdown,
  type ExportConfig,
} from '../export-generator';

function move(over: Partial<Move>): Move {
  return {
    id: 'm1', title: 'Tame the sub', group: 'quick', sev: 'warn', scope: 'Master bus',
    directive: 'High-pass the pads at 120 Hz.', directional: 'd',
    steps: [{ where: 'high_pass', detail: 'frequency_hz=120, slope_db=24' }],
    hasParams: true, why: 'Sub mud costs translation.',
    evidence: { type: 'spectrum', metric: '-9 dB sub energy', chartType: 'spectrum' },
    confidence: 0.8, impact: 70, source: 'Low End', isRule: false, specialist: 'low_end',
    status: 'committed', verdictId: 'vrd_1', ops: [], ...over,
  };
}

const MOVES = [
  move({}),
  move({ id: 'm2', title: 'Widen the pads', scope: 'Pad bus', why: '', steps: [], impact: 40 }),
];

function cfg(over: Partial<ExportConfig> = {}): ExportConfig {
  return {
    format: 'md',
    detail: 'standard',
    order: 'order',
    opts: { ...DEFAULT_EXPORT_OPTS },
    selectedIds: new Set(['m1', 'm2']),
    ...over,
  };
}

const FACTS = { bpm: 128.4, key: 'A#m', lufs: -8.213, genre: 'techno' };
const EXTRAS = { trackName: 'Neon Nights', versionLabel: 'v3' };

describe('generateGamePlan', () => {
  it('brief emits titles + directives, no steps/why/evidence', () => {
    const r = generateGamePlan(cfg({ detail: 'brief' }), MOVES, FACTS, EXTRAS);
    expect(r.filename).toBe('daw-plan-neon-nights.md');
    expect(r.mime).toBe('text/markdown');
    expect(r.content).toContain('# Mixing plan — Neon Nights v3');
    expect(r.content).toContain('1. [ ] **Tame the sub** (Master bus)');
    expect(r.content).toContain('→ High-pass the pads at 120 Hz.');
    expect(r.content).not.toContain('high_pass');
    expect(r.content).not.toContain('Why:');
    expect(r.content).not.toContain('measured:');
  });

  it('standard adds steps (opts.params) and why (opts.coach)', () => {
    const withCoach = cfg();
    withCoach.opts.coach = true;
    const r = generateGamePlan(withCoach, MOVES, FACTS, EXTRAS);
    expect(r.content).toContain('- high_pass');
    expect(r.content).not.toContain('frequency_hz=120'); // param detail is detailed-only
    expect(r.content).toContain('Why: Sub mud costs translation.');
  });

  it('detailed adds param detail and evidence rows (opts.data)', () => {
    const r = generateGamePlan(cfg({ detail: 'detailed' }), MOVES, FACTS, EXTRAS);
    expect(r.content).toContain('- high_pass: `frequency_hz=120, slope_db=24`');
    expect(r.content).toContain('↳ measured: `-9 dB sub energy`');
  });

  it('honors selection filtering', () => {
    const r = generateGamePlan(cfg({ selectedIds: new Set(['m2']) }), MOVES, FACTS, EXTRAS);
    expect(r.content).not.toContain('Tame the sub');
    expect(r.content).toContain('Widen the pads');
  });

  it('orders by problem area when configured', () => {
    const sel = selectMoves(cfg({ order: 'area' }), MOVES);
    expect(sel.map((m) => m.scope)).toEqual(['Master bus', 'Pad bus']);
  });

  it('per-device section groups Master first', () => {
    const c = cfg();
    c.opts.perDevice = true;
    const r = generateGamePlan(c, MOVES, FACTS, EXTRAS);
    const masterIdx = r.content.indexOf('### Master');
    const padIdx = r.content.indexOf('### Device: Pad bus');
    expect(masterIdx).toBeGreaterThan(-1);
    expect(padIdx).toBeGreaterThan(masterIdx);
  });

  it('toggles facts and targets sections off', () => {
    const c = cfg();
    c.opts.facts = false;
    c.opts.targets = false;
    const r = generateGamePlan(c, MOVES, FACTS, EXTRAS);
    expect(r.content).not.toContain('Track facts');
    expect(r.content).not.toContain('Streaming targets');
    // And on by default:
    const r2 = generateGamePlan(cfg(), MOVES, FACTS, EXTRAS);
    expect(r2.content).toContain('- Tempo: 128 BPM');
    expect(r2.content).toContain('- Spotify: -14 LUFS');
  });

  it('txt strips markdown syntax and swaps mime/extension', () => {
    const r = generateGamePlan(cfg({ format: 'txt' }), MOVES, FACTS, EXTRAS);
    expect(r.filename).toBe('daw-plan-neon-nights.txt');
    expect(r.mime).toBe('text/plain');
    expect(r.content).not.toContain('**');
    expect(r.content).not.toContain('# Mixing plan');
    expect(r.content).toContain('Mixing plan — Neon Nights v3');
  });

  it('guards the empty selection', () => {
    const r = generateGamePlan(cfg({ selectedIds: new Set() }), MOVES, FACTS, EXTRAS);
    expect(r.content).toContain('No fixes selected');
  });
});

describe('stripMarkdown', () => {
  it('removes headings, bold, italics and code ticks', () => {
    expect(stripMarkdown('## Head\n**bold** _it_ `code`')).toBe('Head\nbold it code');
  });
});
