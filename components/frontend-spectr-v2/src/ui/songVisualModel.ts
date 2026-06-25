// Song cover-art visual model: palette, templates, color helpers, randomizer,
// and (de)serialization for persistence. The color model is an OKLCH triple
// {l,c,h} so the palette can carry vivid AND deep/dark tones. Colors are stored
// on the song as serialized `oklch(l c h)` strings (see types.ts / backend reqs).

import type {
  SongVisual,
  SongVisualColor,
  SongVisualTemplate,
} from '../api/types';

// ── Palette ───────────────────────────────────────────────────────────────────
// Curated swatches, vivid → deep → dark → near-neutral. 14 per picker, 7 across.
export const PALETTE: readonly SongVisualColor[] = [
  { l: 0.72, c: 0.19, h: 352 }, // rose
  { l: 0.72, c: 0.18, h: 25 }, // coral
  { l: 0.76, c: 0.16, h: 70 }, // amber
  { l: 0.8, c: 0.18, h: 135 }, // green
  { l: 0.74, c: 0.15, h: 172 }, // emerald (brand)
  { l: 0.72, c: 0.13, h: 210 }, // sky
  { l: 0.66, c: 0.17, h: 285 }, // violet
  { l: 0.52, c: 0.18, h: 6 }, // deep red
  { l: 0.54, c: 0.15, h: 48 }, // rust
  { l: 0.5, c: 0.13, h: 165 }, // deep teal
  { l: 0.46, c: 0.16, h: 270 }, // indigo
  { l: 0.4, c: 0.14, h: 320 }, // plum
  { l: 0.34, c: 0.1, h: 250 }, // midnight
  { l: 0.3, c: 0.03, h: 250 }, // charcoal
] as const;

export const TEMPLATES: readonly { id: SongVisualTemplate; label: string }[] = [
  { id: 'aurora', label: 'Aurora' },
  { id: 'vinyl', label: 'Vinyl' },
  { id: 'spin', label: 'Spin' },
  { id: 'eq', label: 'EQ' },
  { id: 'skyline', label: 'City' },
  { id: 'robot', label: 'Robot' },
  { id: 'booth', label: 'Booth' },
  { id: 'cassette', label: 'Cassette' },
  { id: 'boombox', label: 'Boombox' },
] as const;

const TEMPLATE_IDS = new Set<string>(TEMPLATES.map((t) => t.id));

// ── Color helpers ───────────────────────────────────────────────────────────
export const colorKey = (c: SongVisualColor): string => `${c.l}|${c.c}|${c.h}`;

export const oklch = (c: SongVisualColor, alpha?: number): string =>
  `oklch(${c.l} ${c.c} ${c.h}${alpha != null ? ` / ${alpha}` : ''})`;

/** Shift lightness / chroma of a color, clamped to a sane range. */
export const shade = (c: SongVisualColor, dl = 0, dc = 0): SongVisualColor => ({
  l: Math.max(0.05, Math.min(0.95, c.l + dl)),
  c: Math.max(0, c.c + dc),
  h: c.h,
});

export const swatchColor = (c: SongVisualColor): string => oklch(c);

/** Linear blend two colors (used for spectrum/eq bars). */
export const mix = (a: SongVisualColor, b: SongVisualColor, t: number): SongVisualColor => ({
  l: a.l + (b.l - a.l) * t,
  c: a.c + (b.c - a.c) * t,
  h: a.h + (b.h - a.h) * t,
});

// ── (De)serialization for persistence ─────────────────────────────────────────
export const serializeColor = (c: SongVisualColor): string => oklch(c);

export function parseColor(value: string | null | undefined): SongVisualColor | null {
  if (!value) return null;
  const m = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(value);
  if (!m) return null;
  const [, l, c, h] = m;
  return { l: Number(l), c: Number(c), h: Number(h) };
}

const DEFAULT_PRIMARY: SongVisualColor = PALETTE[4]!; // emerald (brand)
const DEFAULT_SECONDARY: SongVisualColor = PALETTE[10]!; // indigo

/** Build a SongVisual from serialized DTO fields, or null when nothing is stored. */
export function visualFromDto(
  template: string | null | undefined,
  primary: string | null | undefined,
  secondary: string | null | undefined,
): SongVisual | null {
  if (!template || !TEMPLATE_IDS.has(template)) return null;
  const p = parseColor(primary) ?? DEFAULT_PRIMARY;
  const s = parseColor(secondary) ?? DEFAULT_SECONDARY;
  return { template: template as SongVisualTemplate, primary: p, secondary: s };
}

/** Deterministic, stable Aurora visual derived from a song id (matches the
 *  legacy hueFromId look) — used to seed the picker when editing a song that
 *  has no stored visual, so "Save" preserves its current appearance. */
export function fallbackVisual(id: string | null | undefined): SongVisual {
  let h = 0;
  for (let i = 0; i < (id?.length ?? 0); i += 1) h = (h * 31 + id!.charCodeAt(i)) % 360;
  return {
    template: 'aurora',
    primary: { l: 0.72, c: 0.18, h },
    secondary: { l: 0.46, c: 0.16, h: (h + 60) % 360 },
  };
}

// ── Randomizer (on dialog open + Shuffle) ─────────────────────────────────────
const randColor = (): SongVisualColor => PALETTE[Math.floor(Math.random() * PALETTE.length)]!;

export function randomVisual(): SongVisual {
  const primary = randColor();
  let secondary = randColor();
  let guard = 0;
  while (colorKey(secondary) === colorKey(primary) && guard < 6) {
    secondary = randColor();
    guard += 1;
  }
  const template = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)]!.id;
  return { template, primary, secondary };
}
