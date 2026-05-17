// Streaming-platform LUFS targets + pass/warn/fail rule.
//
// Margins:
//   |yourLufs - target| ≤ 1.0  → pass
//   |yourLufs - target| ≤ 2.0  → warn
//   otherwise                  → fail
//
// Sources for targets:
//   - CLAUDE.md (api gotcha block) and the Claude-design audit doc.
//   - SoundCloud officially documents a range of -8 to -14; we use the midpoint
//     (-11) for the single-number comparison.
//   - True-peak ceiling (-1.0 dBTP) is a Spotify-aligned industry default.

export interface PlatformTarget {
  name: string;
  lufs: number;
}

export const PLATFORM_TARGETS: ReadonlyArray<PlatformTarget> = [
  { name: 'Spotify',      lufs: -14 },
  { name: 'Apple Music',  lufs: -16 },
  { name: 'YouTube',      lufs: -14 },
  { name: 'Tidal',        lufs: -14 },
  { name: 'Amazon Music', lufs: -14 },
  { name: 'SoundCloud',   lufs: -11 },  // midpoint of -8 to -14
  { name: 'Beatport',     lufs: -8 },
];

export const TRUE_PEAK_CEILING_DB = -1.0;

export type LufsVerdict = 'pass' | 'warn' | 'fail' | 'unknown';

export function evaluateLufs(your: number | undefined | null, target: number): LufsVerdict {
  if (your === undefined || your === null || Number.isNaN(your)) return 'unknown';
  const diff = Math.abs(your - target);
  if (diff <= 1.0) return 'pass';
  if (diff <= 2.0) return 'warn';
  return 'fail';
}

export function evaluateTruePeak(yourDbTp: number | undefined | null): LufsVerdict {
  if (yourDbTp === undefined || yourDbTp === null || Number.isNaN(yourDbTp)) return 'unknown';
  return yourDbTp <= TRUE_PEAK_CEILING_DB ? 'pass' : 'fail';
}

export function evaluateClipping(clippingDetected: boolean | undefined | null): LufsVerdict {
  if (clippingDetected === undefined || clippingDetected === null) return 'unknown';
  return clippingDetected ? 'fail' : 'pass';
}

/** Maps a verdict to its CSS variable (defined in tokens.css). */
export function verdictColor(v: LufsVerdict): string {
  switch (v) {
    case 'pass':    return 'var(--sev-ok)';
    case 'warn':    return 'var(--sev-warn)';
    case 'fail':    return 'var(--sev-fail)';
    case 'unknown': return 'var(--sev-unknown)';
  }
}
