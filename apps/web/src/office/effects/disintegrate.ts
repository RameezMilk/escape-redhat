// "Thanos snap" loss effect: the sprite darkens to black, then dissolves into ash particles that drift up and to
// the right and fade. Purely visual; driven by elapsed time since the actor was first seen as lost.
import type { SpriteData } from '../sprites/raster';

export const DARKEN_SEC = 0.3;
export const DISSOLVE_SEC = 1.6;
export const TOTAL_SEC = DARKEN_SEC + DISSOLVE_SEC;

function hex(c: string): [number, number, number, number] {
  const v = c.replace('#', '');
  const a = v.length === 8 ? parseInt(v.slice(6, 8), 16) / 255 : 1;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16), a];
}

/** Stable pseudo-random in [0,1) per pixel. */
function rnd(x: number, y: number, k: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * Draw the effect. (drawX, drawY) = top-left of the sprite in canvas pixels; zoom = canvas px per art px.
 * Returns false once fully dissolved (caller can stop drawing).
 */
export function drawDisintegration(ctx: CanvasRenderingContext2D, sprite: SpriteData, drawX: number, drawY: number, zoom: number, elapsed: number): boolean {
  if (elapsed >= TOTAL_SEC) return false;
  const h = sprite.length;
  const w = sprite[0]?.length ?? 0;
  const darken = Math.min(1, elapsed / DARKEN_SEC);
  const t = Math.max(0, elapsed - DARKEN_SEC);
  ctx.save();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = sprite[y][x];
      if (!c) continue;
      const [r, g, b, a] = hex(c);
      // Dissolve front sweeps from the top-right to the bottom-left; each pixel leaves at its own time.
      const order = (w - x) / w * 0.45 + y / h * 0.35 + rnd(x, y, 1) * 0.2;
      const start = order * DISSOLVE_SEC * 0.75;
      const life = t - start;
      const k = 1 - darken * 0.85;
      const col = `rgba(${Math.round(r * k + 18 * darken)}, ${Math.round(g * k + 14 * darken)}, ${Math.round(b * k + 12 * darken)}, ${a})`;
      if (life <= 0) {
        ctx.fillStyle = col;
        ctx.fillRect(drawX + x * zoom, drawY + y * zoom, zoom, zoom);
        continue;
      }
      const fade = 1 - life / (DISSOLVE_SEC * 0.55);
      if (fade <= 0) continue;
      const vx = 10 + rnd(x, y, 2) * 16; // art px / s, drifting right
      const vy = -(8 + rnd(x, y, 3) * 18); // and up
      const jx = Math.sin(life * 9 + x) * 0.8;
      const px = drawX + (x + vx * life + jx) * zoom;
      const py = drawY + (y + vy * life) * zoom;
      const ash = 40 + Math.round(rnd(x, y, 4) * 50);
      ctx.fillStyle = `rgba(${ash}, ${ash - 6}, ${ash - 10}, ${(a * fade).toFixed(3)})`;
      const s = zoom * (fade > 0.5 ? 1 : 0.7);
      ctx.fillRect(px, py, s, s);
    }
  }
  ctx.restore();
  return true;
}
