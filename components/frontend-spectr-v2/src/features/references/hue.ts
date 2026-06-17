import type { CSSProperties } from 'react';

/** CSS custom property carrying a collection's hue into the stylesheet. */
export function hueVar(hue: number | null): CSSProperties {
  return { ['--chip-hue' as string]: `hsl(${hue ?? 168} 70% 60%)` };
}
