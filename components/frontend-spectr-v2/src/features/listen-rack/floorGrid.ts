/* The Listen page's scrolling neon floor grid ("ground moving forward"),
 * shared by LightShow (the rack page's atmosphere layer) and the analysis
 * page's listening backdrop. Pure canvas drawing — no React, no loop. */

export interface FloorGridOpts {
  /** Grid hue, 0-360. */
  hue?: number | undefined;
  /** 0-300; 50 = the classic look, 0 hides the ground. */
  gridIntensity?: number | undefined;
  /** Overall layer intensity multiplier (LightShow's `intensity`). */
  intensity: number;
  /** 1 while playing; LightShow dims to 0.35 when paused. */
  live: number;
}

/** Draws the grid's horizontal lines into the lower third of a W×H canvas at
 *  time `t` (seconds). Drawn with 'lighter' + a shadow bloom so the lines
 *  EMIT light: they add over whatever is behind instead of tinting it. */
export function drawFloorGrid(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, o: FloorGridOpts) {
  const gs = (o.gridIntensity ?? 50) / 50; // 1 = classic, up to 6
  const gridA = Math.min(0.9, 0.05 * gs * o.intensity * o.live);
  if (gridA <= 0.001) return;
  const hue = o.hue ?? 168;
  const hy = H * 0.66;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.shadowColor = `hsla(${hue},100%,62%,${Math.min(1, gridA * 2.2)})`;
  ctx.shadowBlur = Math.min(30, 3 + gs * 7);
  ctx.lineWidth = Math.min(3, 1 + gs * 0.25);
  const light = 55 + Math.min(28, gs * 6);
  for (let i = 0; i < 9; i++) {
    const p = (t * 0.06 + i / 9) % 1;
    const y = hy + Math.pow(p, 2.6) * (H - hy);
    // nearer lines (p→1) read brighter — that's the depth cue
    ctx.strokeStyle = `hsla(${hue},95%,${light}%,${gridA * p * 0.9})`;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  ctx.restore();
}
