// Dev tool: renders the original sprites to apps/web/.preview/sprites.png for visual review.
//   npx tsx apps/web/scripts/preview-sprites.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PNG } from 'pngjs';

import { getDecorSprites } from '../src/office/sprites/decor';
import { getBlockerSprite, getFireFrames } from '../src/office/sprites/hazards';
import { getWheelchairSprites } from '../src/office/sprites/wheelchair';

type Sprite = string[][];
const scale = 6;
const sprites: Sprite[][] = [];
const wc = getWheelchairSprites();
sprites.push([...wc.down, ...wc.up, ...wc.right, ...wc.left]);
sprites.push([...getFireFrames(), getBlockerSprite()]);
const d = getDecorSprites();
sprites.push([d.redhat, d.nvidia, d.exit, d.plan, d.flag]);

const pad = 4;
const rowH = sprites.map((row) => Math.max(...row.map((s) => s.length)));
const rowW = sprites.map((row) => row.reduce((a, s) => a + s[0].length + pad, pad));
const W = Math.max(...rowW) * scale;
const H = rowH.reduce((a, h) => a + h + pad, pad) * scale;
const png = new PNG({ width: W, height: H });
for (let i = 0; i < W * H; i++) png.data.set([60, 58, 70, 255], i * 4);
let oy = pad;
sprites.forEach((row, ri) => {
  let ox = pad;
  for (const s of row) {
    s.forEach((line, y) =>
      line.forEach((c, x) => {
        if (!c) return;
        const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
        for (let yy = 0; yy < scale; yy++)
          for (let xx = 0; xx < scale; xx++) {
            const idx = (((oy + y) * scale + yy) * W + (ox + x) * scale + xx) * 4;
            png.data.set([r, g, b, 255], idx);
          }
      }),
    );
    ox += s[0].length + pad;
  }
  oy += rowH[ri] + pad;
});
const out = join(dirname(fileURLToPath(import.meta.url)), '..', '.preview', 'sprites.png');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, PNG.sync.write(png));
console.log('wrote', out, W, H);
