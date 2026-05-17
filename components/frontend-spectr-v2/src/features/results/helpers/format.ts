// Display formatters. All accept undefined/null and return "—" as the safe
// fallback so report panels never throw on partial pipeline data.

const DASH = '—';

export function fmtNumber(
  n: number | undefined | null,
  digits = 1,
  suffix = '',
): string {
  if (n === undefined || n === null || Number.isNaN(n)) return DASH;
  return n.toFixed(digits) + suffix;
}

/** dB-formatted value, e.g. "-12.4 dB". Uses a real minus sign (en dash style)
 *  via the locale string for visual consistency with the design tokens. */
export function fmtDb(n: number | undefined | null, digits = 1): string {
  if (n === undefined || n === null || Number.isNaN(n)) return DASH;
  return `${n.toFixed(digits)} dB`;
}

export function fmtLufs(n: number | undefined | null, digits = 1): string {
  if (n === undefined || n === null || Number.isNaN(n)) return DASH;
  return `${n.toFixed(digits)} LUFS`;
}

/** 0..1 ratio → "78.5%". Pass digits=0 for whole-percent display. */
export function fmtPercent(
  n: number | undefined | null,
  digits = 1,
): string {
  if (n === undefined || n === null || Number.isNaN(n)) return DASH;
  return (n * 100).toFixed(digits) + '%';
}

/** Seconds → "m:ss" / "h:mm:ss". */
export function fmtDuration(seconds: number | undefined | null): string {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds)) return DASH;
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) {
    const mm = String(m).padStart(2, '0');
    return `${h}:${mm}:${ss}`;
  }
  return `${m}:${ss}`;
}

/** Rounded BPM, e.g. 139.67 → "140". */
export function fmtBpm(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return DASH;
  return String(Math.round(n));
}

/** Rounded integer score with optional "/100" suffix. */
export function fmtScore(n: number | undefined | null, outOf = 100): string {
  if (n === undefined || n === null || Number.isNaN(n)) return DASH;
  return `${Math.round(n)} / ${outOf}`;
}

/** Title-cases a genre slug ("progressive_house" → "Progressive House"). */
export function fmtGenre(g: string | undefined | null): string {
  if (!g) return DASH;
  return g
    .split(/[_\s]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}
