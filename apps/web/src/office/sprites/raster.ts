// Tiny raster helper for authoring original pixel sprites as Pixel Agents SpriteData (string[][] of hex colours).
// All Escape-from-Red-Hat sprites (wheelchair, fire, doors, alarms, signs) are drawn with this — no external art.
import type { SpriteData } from '../../vendor/pixel-agents/webview-ui/src/office/types';

export type { SpriteData };

export class Raster {
  readonly px: string[][];
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = Array.from({ length: h }, () => Array<string>(w).fill(''));
  }

  set(x: number, y: number, c: string): this {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi >= 0 && yi >= 0 && xi < this.w && yi < this.h) this.px[yi][xi] = c;
    return this;
  }

  get(x: number, y: number): string {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.px[y][x] : '';
  }

  rect(x: number, y: number, w: number, h: number, c: string): this {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
    return this;
  }

  /** Rectangle outline. */
  box(x: number, y: number, w: number, h: number, c: string): this {
    for (let xx = x; xx < x + w; xx++) {
      this.set(xx, y, c);
      this.set(xx, y + h - 1, c);
    }
    for (let yy = y; yy < y + h; yy++) {
      this.set(x, yy, c);
      this.set(x + w - 1, yy, c);
    }
    return this;
  }

  line(x0: number, y0: number, x1: number, y1: number, c: string): this {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
    return this;
  }

  /** Filled disc / ellipse (rx, ry radii, centre may be fractional). */
  disc(cx: number, cy: number, rx: number, ry: number, c: string): this {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
    }
    return this;
  }

  /** Ring between inner and outer radius (circular). */
  ring(cx: number, cy: number, rOuter: number, rInner: number, c: string): this {
    for (let y = Math.floor(cy - rOuter); y <= Math.ceil(cy + rOuter); y++) {
      for (let x = Math.floor(cx - rOuter); x <= Math.ceil(cx + rOuter); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= rOuter && d >= rInner) this.set(x, y, c);
      }
    }
    return this;
  }

  /** Draw text with the 3×5 font (1px letter spacing), each font pixel `s`×`s`. Returns width used. */
  text(str: string, x: number, y: number, c: string, s = 1): number {
    let cx = x;
    for (const chRaw of str.toUpperCase()) {
      const glyph = FONT_3X5[chRaw] ?? FONT_3X5['?'];
      glyph.forEach((row, gy) => {
        for (let gx = 0; gx < row.length; gx++) if (row[gx] === '#') this.rect(cx + gx * s, y + gy * s, s, s, c);
      });
      cx += (glyph[0].length + 1) * s;
    }
    return cx - x - s;
  }

  /** Add a 1px dark outline around all opaque pixels (outside only). */
  outline(c: string): this {
    const src = this.px.map((r) => [...r]);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (src[y][x]) continue;
        const n = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dy]) => {
          const yy = y + dy;
          const xx = x + dx;
          return yy >= 0 && xx >= 0 && yy < this.h && xx < this.w && src[yy][xx] !== '';
        });
        if (n) this.px[y][x] = c;
      }
    }
    return this;
  }

  sprite(): SpriteData {
    return this.px.map((r) => [...r]);
  }
}

export function textWidth(str: string, s = 1): number {
  let w = 0;
  for (const ch of str.toUpperCase()) w += (FONT_3X5[ch] ?? FONT_3X5['?'])[0].length + 1;
  return Math.max(0, w - 1) * s;
}

export function mirrorSprite(s: SpriteData): SpriteData {
  return s.map((row) => [...row].reverse());
}

/** 3×5 uppercase pixel font with digits (I/1 are narrow, M/W are 5 wide and N 4 wide for legibility). */
const FONT_3X5: Record<string, string[]> = {
  A: ['###', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['###', '#..', '#..', '#..', '###'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['###', '#..', '#.#', '#.#', '###'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['#', '#', '#', '#', '#'],
  J: ['..#', '..#', '..#', '#.#', '###'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  P: ['###', '#.#', '###', '#..', '#..'],
  Q: ['###', '#.#', '#.#', '###', '..#'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['###', '#..', '###', '..#', '###'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#', '##', '.#', '.#', '.#'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '..#', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  '.': ['.', '.', '.', '.', '#'],
  ':': ['.', '#', '.', '#', '.'],
  ' ': ['..', '..', '..', '..', '..'],
  '?': ['###', '..#', '.##', '...', '.#.'],
  '!': ['#', '#', '#', '.', '#'],
  '-': ['...', '...', '###', '...', '...'],
};
