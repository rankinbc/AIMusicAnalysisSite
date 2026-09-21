// Drift guard: re-runs scripts/site-stats.mjs against the live repo and
// checks every floor the engineering page prints still undershoots the real
// count (PRPs/public-surfaces-polish.md §3.3). If the repo shrinks below a
// floor, this fails the build instead of the page quietly lying.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const FE = resolve(__dirname, '../../../..');
const counts = JSON.parse(
  execFileSync(process.execPath, ['scripts/site-stats.mjs', '--json'], { cwd: FE, encoding: 'utf8' }),
) as Record<string, number>;
const { floors } = JSON.parse(readFileSync(resolve(__dirname, '../stats.generated.json'), 'utf8')) as {
  floors: Record<string, number>;
};

describe('engineering page numbers', () => {
  it('prints a floor for every count the script knows, and nothing else', () => {
    expect(Object.keys(floors).sort()).toEqual(Object.keys(counts).sort());
  });

  it.each(Object.keys(floors))('%s never overstates the repo', (key) => {
    expect(floors[key]).toBeGreaterThan(0);
    expect(floors[key]).toBeLessThanOrEqual(counts[key] ?? 0);
  });
});
