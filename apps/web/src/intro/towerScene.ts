// Procedural pixel-art skyline for the start screen: a stylised Red Hat tower (Raleigh) with a glowing floor.
// Everything is drawn with integer rects on a low-res canvas and scaled up with nearest-neighbour, so it matches
// the office's pixel style. Original artwork; the sign is a simple fedora silhouette + pixel wordmark.

import { ACTOR_IDS } from '@escape/contracts';

import { ACTOR_VIEW } from '../office/actors';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TowerLayout {
  /** The clickable glowing floor, in logical pixels. */
  glow: Rect;
}

const C = {
  skyTop: '#7f8a97',
  skyMid: '#97a1ac',
  skyLow: '#b4bcc4',
  cloud: '#c5cbd1',
  cloudShade: '#aab2ba',
  haze1: '#9ba4ae',
  haze2: '#8c96a1',
  hazeWin: '#b3bcc5',
  pnc: '#7b8794',
  pncGlass: '#93a7b6',
  pncDark: '#66717e',
  darkFrame: '#d3d6da',
  darkStripe: '#262a31',
  darkStripe2: '#3a3f48',
  aptBody: '#b4bac1',
  aptWin: '#6e8ea6',
  aptWin2: '#8daec4',
  concrete: '#cfc9bf',
  concreteShade: '#aaa499',
  glass: '#3d6b71',
  glassLight: '#5b8d92',
  mullion: '#2b4a4f',
  curtain: '#33545c',
  curtainLight: '#4a737a',
  red: '#d4262c',
  redDark: '#a31c21',
  redLight: '#ea4b50',
  white: '#f4f4f2',
  podium: '#bdb6ac',
  podiumWin: '#2f3a41',
  column: '#dbd5cc',
  street: '#5f6266',
  sidewalk: '#a39f98',
  line: '#e6e1d3',
  warm: '#ffd98a',
  warmHi: '#fff0c4',
  car1: '#c43c3c',
  car2: '#3c6cc4',
  car3: '#e0e0e0',
} as const;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rect(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

// Tiny 3×5 bitmap font for the sign wordmark.
const GLYPHS: Record<string, string[]> = {
  R: ['110', '101', '110', '101', '101'],
  E: ['111', '100', '110', '100', '111'],
  D: ['110', '101', '101', '101', '110'],
  H: ['101', '101', '111', '101', '101'],
  A: ['010', '101', '111', '101', '101'],
  T: ['111', '010', '010', '010', '010'],
  N: ['101', '111', '111', '111', '101'],
  ' ': ['000', '000', '000', '000', '000'],
};
function pixelText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  ctx.fillStyle = color;
  let cx = x;
  for (const ch of text) {
    const g = GLYPHS[ch] ?? GLYPHS[' '];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (g[r][c] === '1') ctx.fillRect(cx + c, y + r, 1, 1);
    cx += ch === ' ' ? 3 : 4;
  }
  return cx - x;
}

// 9×6 fedora silhouette.
const FEDORA = ['...###...', '..#####..', '..#####..', '.#######.', '#########', '.#######.'];
function fedora(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.fillStyle = color;
  FEDORA.forEach((row, r) => [...row].forEach((p, c) => p === '#' && ctx.fillRect(x + c, y + r, 1, 1)));
}

/**
 * Draws the scene into a canvas of logical size W×H (W ≥ 400, H ≥ 225; extra space extends sky and street).
 * `t` is seconds since start (animation), `hover` brightens the glowing floor.
 */
export function drawTowerScene(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, hover: boolean): TowerLayout {
  ctx.imageSmoothingEnabled = false;
  const ground = H - 24; // street level (the street and the far sidewalk below it)
  const cx = Math.floor(W / 2);

  // --- sky (stepped bands = pixel dithering feel)
  const bands = [C.skyTop, '#858f9c', C.skyMid, '#9fa8b2', '#a9b1ba', C.skyLow];
  const bandH = Math.ceil((ground - 20) / bands.length);
  bands.forEach((col, i) => rect(ctx, col, 0, i * bandH, W, bandH + 1));
  rect(ctx, C.skyLow, 0, bands.length * bandH, W, ground);

  // --- drifting clouds
  const rnd = mulberry32(17);
  for (let i = 0; i < 7; i++) {
    const w = 30 + Math.floor(rnd() * 40);
    const y = 8 + Math.floor(rnd() * 50);
    const x = Math.floor(((rnd() * W + t * (2 + rnd() * 3)) % (W + w)) - w);
    rect(ctx, C.cloudShade, x + 3, y + 3, w, 4);
    rect(ctx, C.cloud, x, y, w, 4);
    rect(ctx, C.cloud, x + 6, y - 3, w - 14, 3);
  }

  // --- far hazy skyline
  const far = mulberry32(5);
  for (let x = -10; x < W + 10; ) {
    const w = 14 + Math.floor(far() * 22);
    const h = 18 + Math.floor(far() * 45);
    const col = far() < 0.5 ? C.haze1 : C.haze2;
    rect(ctx, col, x, ground - 28 - h, w, h + 28);
    for (let wy = ground - 26 - h; wy < ground - 30; wy += 4) for (let wx = x + 2; wx < x + w - 2; wx += 3) if (far() < 0.35) rect(ctx, C.hazeWin, wx, wy, 1, 2);
    x += w + Math.floor(far() * 4);
  }

  // --- PNC-like tower with spire (behind, right of centre)
  const px = cx + 38;
  const pTop = ground - 168;
  rect(ctx, C.pnc, px, pTop, 36, 168);
  for (let y = pTop + 4; y < ground - 6; y += 4) rect(ctx, C.pncGlass, px + 2, y, 32, 2);
  rect(ctx, C.pncDark, px + 30, pTop, 6, 168);
  rect(ctx, '#aeb8c2', px + 6, pTop - 8, 24, 8);
  for (let i = 0; i < 12; i++) rect(ctx, C.pncDark, px + 12 + Math.floor(i / 2), pTop - 9 - i, 12 - i, 1);
  rect(ctx, C.pncDark, px + 17, pTop - 26, 2, 6);
  if (Math.floor(t * 1.2) % 2 === 0) rect(ctx, '#ff3b3b', px + 17, pTop - 27, 2, 2); // aircraft light

  // --- left dark striped office tower
  const lx = cx - 196;
  const lTop = ground - 128;
  rect(ctx, C.darkFrame, lx, lTop, 84, 128);
  for (let x = lx + 3; x < lx + 81; x += 4) {
    rect(ctx, C.darkStripe, x, lTop + 5, 2, 123);
    rect(ctx, C.darkStripe2, x + 2, lTop + 5, 1, 123);
  }
  rect(ctx, '#b9bcc1', lx, lTop, 84, 3);

  // --- right apartment tower
  const ax = cx + 128;
  const aTop = ground - 120;
  rect(ctx, C.aptBody, ax, aTop, 62, 120);
  const ar = mulberry32(9);
  for (let y = aTop + 4; y < ground - 4; y += 5) {
    for (let x = ax + 3; x < ax + 59; x += 5) rect(ctx, ar() < 0.2 ? C.warm : ar() < 0.5 ? C.aptWin2 : C.aptWin, x, y, 3, 3);
  }
  rect(ctx, '#3f8fd0', ax, aTop - 3, 62, 3);

  // --- MAIN TOWER
  const floors = 14;
  const floorH = 8;
  const tw = 142;
  const tx = cx - Math.floor(tw / 2) - 6;
  const bodyBottom = ground - 26; // podium below
  const tTop = bodyBottom - floors * floorH;
  const curtainW = 20;
  const lit = mulberry32(42);
  const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);

  // shadow side + body
  rect(ctx, C.concreteShade, tx + tw, tTop + 4, 4, floors * floorH);
  for (let f = 0; f < floors; f++) {
    const y = tTop + f * floorH;
    rect(ctx, C.concrete, tx, y, tw - curtainW, 3); // spandrel
    rect(ctx, C.glass, tx, y + 3, tw - curtainW, 5); // window band
    rect(ctx, C.glassLight, tx, y + 3, tw - curtainW, 1);
    for (let x = tx + 3; x < tx + tw - curtainW; x += 5) rect(ctx, C.mullion, x, y + 3, 1, 5);
    // lit office windows (warm), with a slow flicker
    for (let x = tx + 4; x < tx + tw - curtainW - 3; x += 5) {
      const r = lit();
      if (r < 0.16 && (r > 0.02 || Math.floor(t * 0.7 + x) % 3 !== 0)) rect(ctx, C.warm, x, y + 4, 4, 3);
    }
    // curtain-wall column on the right
    rect(ctx, f % 2 ? C.curtain : C.curtainLight, tx + tw - curtainW, y, curtainW, floorH);
    for (let x = tx + tw - curtainW + 2; x < tx + tw; x += 4) rect(ctx, C.mullion, x, y, 1, floorH);
    rect(ctx, '#c2bcb2', tx + tw - curtainW, y, curtainW, 1);
  }
  rect(ctx, '#e3ded6', tx, tTop - 2, tw, 2); // roof slab
  rect(ctx, C.white, tx - 1, tTop, 1, floors * floorH); // left edge highlight

  // rooftop frame (glass box at the top right in the photos)
  rect(ctx, '#8e989f', tx + 6, tTop - 22, 22, 20);
  rect(ctx, '#b7c4cb', tx + 8, tTop - 20, 18, 16);
  for (let x = tx + 8; x < tx + 26; x += 6) rect(ctx, '#8e989f', x, tTop - 20, 1, 16);

  // red crown sign
  const crownX = tx + 22;
  const crownW = tw - 30;
  const crownTop = tTop - 22;
  rect(ctx, C.redDark, crownX, crownTop, crownW, 20);
  rect(ctx, C.red, crownX, crownTop, crownW - 3, 19);
  rect(ctx, C.redLight, crownX, crownTop, crownW - 3, 1);
  fedora(ctx, crownX + crownW - 52, crownTop + 7, C.white);
  pixelText(ctx, 'RED HAT', crownX + crownW - 40, crownTop + 8, C.white);

  // --- podium
  const pdx = tx - 10;
  const pdw = tw + 22;
  rect(ctx, C.podium, pdx, bodyBottom, pdw, 26);
  rect(ctx, '#d9d3ca', pdx, bodyBottom, pdw, 2);
  for (let x = pdx + 4; x < pdx + pdw - 8; x += 14) {
    rect(ctx, C.podiumWin, x + 3, bodyBottom + 5, 9, 8);
    rect(ctx, C.podiumWin, x + 3, bodyBottom + 16, 9, 8);
    rect(ctx, C.column, x, bodyBottom + 3, 3, 23);
  }
  rect(ctx, '#58646b', cx - 12, bodyBottom + 16, 16, 10); // entrance
  rect(ctx, C.warm, cx - 10, bodyBottom + 18, 12, 1);

  // --- the GLOWING GROUND FLOOR (the storefront podium): the floor everyone escapes from
  const glow: Rect = { x: pdx, y: bodyBottom, w: pdw, h: 26 };
  const a = (hover ? 0.55 : 0.28) + (hover ? 0.25 : 0.22) * pulse;
  ctx.fillStyle = `rgba(255, 210, 120, ${(a * 0.45).toFixed(3)})`;
  ctx.fillRect(pdx - 6, bodyBottom - 4, pdw + 12, 30);
  ctx.fillStyle = `rgba(255, 225, 150, ${(a * 0.7).toFixed(3)})`;
  ctx.fillRect(pdx - 3, bodyBottom - 2, pdw + 6, 28);
  for (let x = pdx + 4; x < pdx + pdw - 8; x += 14) {
    rect(ctx, hover ? '#fffbe8' : C.warmHi, x + 3, bodyBottom + 5, 9, 8);
    rect(ctx, hover ? '#fffbe8' : C.warmHi, x + 3, bodyBottom + 16, 9, 8);
    rect(ctx, '#e9c27a', x + 7, bodyBottom + 5, 1, 19);
  }
  rect(ctx, hover ? '#fff4c8' : '#ffe2a0', cx - 12, bodyBottom + 16, 16, 10); // lit entrance
  rect(ctx, '#58646b', cx - 5, bodyBottom + 16, 1, 10);
  // tiny silhouettes of the people inside, in their colours
  ACTOR_IDS.forEach((id, i) => {
    const sx = pdx + 22 + i * 24 + (i % 2) * 3;
    rect(ctx, ACTOR_VIEW[id].color, sx, bodyBottom + 19, 2, 5);
    rect(ctx, '#3b2a22', sx, bodyBottom + 18, 2, 1);
  });

  // bobbing pixel arrow + label pointing at the glowing ground floor (from the right)
  const bob = Math.round(Math.sin(t * 5) * 2);
  const ax0 = pdx + pdw + 8 + bob;
  const ay0 = bodyBottom + 13;
  ctx.fillStyle = '#ffd27a';
  for (let i = 0; i < 5; i++) ctx.fillRect(ax0 + i, ay0 - i, 1, i * 2 + 1); // ◀ head
  ctx.fillRect(ax0 + 5, ay0 - 1, 9, 3); // shaft
  ctx.fillStyle = '#1a0709';
  ctx.fillRect(ax0 + 14, ay0 - 1, 1, 3);
  rect(ctx, '#1a0709', ax0 + 17, ay0 - 4, 21, 9);
  rect(ctx, '#ffd27a', ax0 + 18, ay0 - 3, 19, 7);
  pixelText(ctx, 'ENTER', ax0 + 18, ay0 - 2, '#1a0709');

  // --- street level
  rect(ctx, C.sidewalk, 0, ground, W, 4);
  rect(ctx, C.street, 0, ground + 4, W, 14);
  rect(ctx, C.sidewalk, 0, ground + 18, W, H - ground - 18); // far sidewalk
  // a zebra crossing to the far side and the bus stop where everyone meets (right of the centred prompt button)
  const zx = cx + 78;
  for (let x = 0; x < W; x += 16) if (x + 8 < zx || x > zx + 16) rect(ctx, C.line, x, ground + 10, 8, 1);
  for (let x = zx; x < zx + 16; x += 3) rect(ctx, '#e8e8e0', x, ground + 5, 2, 12);
  rect(ctx, '#6b7178', zx + 22, ground + 9, 1, 10); // stop pole
  rect(ctx, '#f4f4f4', zx + 20, ground + 7, 5, 4);
  rect(ctx, '#1e5aa8', zx + 20, ground + 7, 5, 2);
  rect(ctx, '#39414a', zx + 28, ground + 13, 18, 1); // shelter roof
  rect(ctx, '#a8d8ea', zx + 29, ground + 14, 16, 5);
  rect(ctx, '#5b6570', zx + 28, ground + 14, 1, 5);
  rect(ctx, '#5b6570', zx + 45, ground + 14, 1, 5);
  // streetlights
  for (let x = 20; x < W; x += 70) {
    rect(ctx, '#4a4d52', x, ground - 14, 1, 14);
    rect(ctx, '#4a4d52', x, ground - 14, 4, 1);
    rect(ctx, C.warm, x + 3, ground - 13, 2, 1);
  }
  // cars
  const cars = [C.car1, C.car2, C.car3, C.car1];
  cars.forEach((col, i) => {
    const dir = i % 2 ? -1 : 1;
    const speed = 14 + i * 5;
    const span = W + 40;
    let x = ((t * speed + i * 97) % span) - 20;
    if (dir < 0) x = W - x;
    const y = dir > 0 ? ground + 6 : ground + 13;
    rect(ctx, col, x, y, 9, 3);
    rect(ctx, '#2a2d31', x + 2, y - 1, 5, 1);
    rect(ctx, '#1d1f22', x + 1, y + 3, 2, 1);
    rect(ctx, '#1d1f22', x + 6, y + 3, 2, 1);
  });

  return { glow };
}
