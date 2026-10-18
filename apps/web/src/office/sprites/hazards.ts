// Original hazard sprites (authored procedurally for Escape from Red Hat).
// Fire: per-cell licking flames (16×16 tile, rising into the row above) + a larger seed flame for the card/ghost.
//       No logs or campfire base: fire spreads tile by tile across the office floor.
// Charred: burnt-out floor (impassable debris). Electrical failure: a pixel ⚡ bolt icon.
import { Raster, type SpriteData } from './raster';

const FIRE = {
  outline: '#7a1414',
  deep: '#b8231a',
  red: '#e2362b',
  orange: '#ff8a1f',
  yellow: '#ffd23f',
  core: '#fff4c2',
  ember: '#ff5a1f',
};

// ---------------------------------------------------------------------------
// Per-cell flames: 16 wide × 22 tall (bottom 16 px = the burning tile, top 6 px licks into the row above).
// 3 variants (different tongue layouts) × 4 frames; callers pick by cell hash so a fire field never looks tiled.
// ---------------------------------------------------------------------------

const CELL_W = 16;
const CELL_H = 22;

const VARIANTS: { c: number; w: number; a: number; ph: number }[][] = [
  [
    { c: 4, w: 2.4, a: 11, ph: 0 },
    { c: 9, w: 2.8, a: 16, ph: 1.7 },
    { c: 13, w: 2.0, a: 9, ph: 3.1 },
  ],
  [
    { c: 3, w: 2.0, a: 8, ph: 0.6 },
    { c: 7, w: 2.6, a: 13, ph: 2.2 },
    { c: 12, w: 2.8, a: 17, ph: 4.0 },
  ],
  [
    { c: 5, w: 3.0, a: 15, ph: 1.1 },
    { c: 11, w: 2.4, a: 12, ph: 2.9 },
  ],
];

function cellFlameHeight(x: number, frame: number, variant: number, scale = 1): number {
  let h = 2.5; // low bed of flame across the whole tile
  for (const t of VARIANTS[variant]) {
    const lick = Math.sin(frame * (Math.PI / 2) + t.ph) * 2.6;
    h += (t.a * scale + lick) * Math.exp(-(((x - t.c) / t.w) ** 2));
  }
  return h + Math.sin(x * 1.9 + frame * 1.3 + variant) * 0.8;
}

function buildCellFlame(frame: number, variant: number, height = CELL_H, scale = 1): SpriteData {
  const r = new Raster(CELL_W, height);
  const base = height - 1;
  for (let x = 0; x < CELL_W; x++) {
    const h1 = Math.max(0, cellFlameHeight(x, frame, variant, scale));
    if (h1 < 1) continue;
    const h2 = h1 * 0.66 - 0.5;
    const h3 = h1 * 0.36 - 0.5;
    for (let y = Math.round(base - h1); y <= base; y++) {
      const up = base - y;
      let c = up >= h1 - 1.2 ? FIRE.deep : FIRE.red;
      if (up <= h3) c = up <= h3 * 0.45 ? FIRE.core : FIRE.yellow;
      else if (up <= h2) c = FIRE.orange;
      r.set(x, y, c);
    }
  }
  // A couple of detached flame wisps / sparks above the tongues (frame-dependent)
  const sparks: [number, number][][] = [
    [
      [6, 2],
      [12, 5],
    ],
    [
      [9, 1],
      [3, 6],
    ],
    [
      [11, 3],
      [5, 4],
    ],
    [
      [8, 2],
      [14, 6],
    ],
  ];
  for (const [x, y] of sparks[frame % 4]) r.set((x + variant * 3) % CELL_W, y, frame % 2 ? FIRE.yellow : FIRE.ember);
  return r.sprite();
}

let cellFrames: SpriteData[][] | null = null;
/** [variant][frame] cell flames. */
export function getCellFlames(): SpriteData[][] {
  if (!cellFrames) cellFrames = [0, 1, 2].map((v) => [0, 1, 2, 3].map((f) => buildCellFlame(f, v)));
  return cellFrames;
}
export const CELL_FLAME_HEIGHT = CELL_H;

/** Deterministic per-cell variant + phase so neighbouring cells flicker out of sync. */
export function cellFlameFor(col: number, row: number, timeMs: number): SpriteData {
  const hsh = ((col * 73856093) ^ (row * 19349663)) >>> 0;
  const variant = hsh % 3;
  const frame = (Math.floor(timeMs / 120) + (hsh >>> 4)) % 4;
  return getCellFlames()[variant][frame];
}

// Burning walls: taller tongues (30 px) that climb the 32 px wall sprite (drawn one tile up in ¾ view).
const WALL_H = 30;
let wallFrames: SpriteData[][] | null = null;
export function getWallFlames(): SpriteData[][] {
  if (!wallFrames) wallFrames = [0, 1, 2].map((v) => [0, 1, 2, 3].map((f) => buildCellFlame(f, v, WALL_H, 1.6)));
  return wallFrames;
}
export const WALL_FLAME_HEIGHT = WALL_H;
export function wallFlameFor(col: number, row: number, timeMs: number): SpriteData {
  const hsh = ((col * 83492791) ^ (row * 2971215073)) >>> 0;
  const frame = (Math.floor(timeMs / 110) + (hsh >>> 5)) % 4;
  return getWallFlames()[hsh % 3][frame];
}

// ---------------------------------------------------------------------------
// Charred floor (burnt out, impassable debris)
// ---------------------------------------------------------------------------

function buildChar(variant: number): SpriteData {
  const r = new Raster(16, 16);
  r.rect(0, 0, 16, 16, '#2b2420');
  // mottled ash
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const n = ((x * 7 + y * 13 + variant * 29) * 2654435761) >>> 0;
      if (n % 5 === 0) r.set(x, y, '#3b322c');
      else if (n % 11 === 0) r.set(x, y, '#191412');
      else if (n % 17 === 0) r.set(x, y, '#4a3f37');
    }
  }
  // cracks
  if (variant === 0) {
    r.line(2, 3, 7, 8, '#120e0c').line(7, 8, 13, 6, '#120e0c');
  } else {
    r.line(3, 12, 8, 7, '#120e0c').line(8, 7, 12, 13, '#120e0c');
  }
  return r.sprite();
}

let charTiles: SpriteData[] | null = null;
export function getCharTiles(): SpriteData[] {
  if (!charTiles) charTiles = [buildChar(0), buildChar(1)];
  return charTiles;
}

// ---------------------------------------------------------------------------
// Seed flame (card icon + placement ghost): 32×32, no logs.
// ---------------------------------------------------------------------------

function flameHeight(x: number, frame: number): number {
  const bell = (c: number, w: number, a: number) => a * Math.exp(-(((x - c) / w) ** 2));
  const jitter = Math.sin(x * 1.3 + frame * 2.1) * 2.2 + Math.sin(x * 0.7 - frame * 1.7) * 1.4;
  return bell(16, 6.5, 21) + bell(9, 2.6, 7 + (frame === 1 ? 3 : 0)) + bell(23, 2.6, 8 + (frame === 2 ? 3 : 0)) + jitter;
}

function buildSeedFlame(frame: number): SpriteData {
  const r = new Raster(32, 32);
  const base = 30;
  for (let x = 3; x <= 28; x++) {
    const h1 = Math.max(0, flameHeight(x, frame));
    if (h1 < 1) continue;
    const h2 = Math.max(0, h1 * 0.72 - 1.5);
    const h3 = Math.max(0, h1 * 0.42 - 1.5);
    for (let y = Math.round(base - h1); y <= base; y++) {
      const up = base - y;
      let c = FIRE.red;
      if (up <= h3 && Math.abs(x - 16) < 6) c = up <= h3 * 0.45 ? FIRE.core : FIRE.yellow;
      else if (up <= h2) c = FIRE.orange;
      r.set(x, y, c);
    }
  }
  r.outline(FIRE.outline);
  const sparks = [
    [
      [11, 4],
      [21, 7],
    ],
    [
      [14, 2],
      [24, 5],
      [8, 8],
    ],
    [
      [18, 3],
      [10, 6],
    ],
  ][frame % 3];
  for (const [x, y] of sparks) r.set(x, y, frame % 2 ? FIRE.yellow : FIRE.ember);
  return r.sprite();
}

let fireFrames: SpriteData[] | null = null;
/** Seed flame frames (card icon, ghost). */
export function getFireFrames(): SpriteData[] {
  if (!fireFrames) fireFrames = [0, 1, 2].map(buildSeedFlame);
  return fireFrames;
}

// ---------------------------------------------------------------------------
// Electrical failure: pixel lightning bolt (32×32)
// ---------------------------------------------------------------------------

const BOLT_ART = [
  '..........#####.',
  '.........#YYYY#.',
  '........#YYYY#..',
  '.......#YYYY#...',
  '......#YYYY#....',
  '.....#YYYY#.....',
  '....#YYYYY######',
  '...#YYYYYYYYYY#.',
  '..######YYYYY#..',
  '.......#YYYY#...',
  '......#YYYO#....',
  '.....#YYOO#.....',
  '....#YOOO#......',
  '...#YOO#........',
  '..#OO#..........',
  '..##............',
];

let bolt: SpriteData | null = null;
export function getBoltSprite(): SpriteData {
  if (bolt) return bolt;
  const r = new Raster(32, 32);
  const col: Record<string, string> = { '#': '#3a2a08', Y: '#ffd23f', O: '#ff9a1f' };
  BOLT_ART.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      // 2× scale into the 32×32 canvas
      r.rect(x * 2, y * 2, 2, 2, col[ch]);
    }),
  );
  // highlight
  r.set(19, 3, '#fff6c8').set(18, 5, '#fff6c8').set(17, 7, '#fff6c8');
  bolt = r.sprite();
  return bolt;
}

/** Small 6×9 bolt glyph drawn over a disabled door. */
let miniBolt: SpriteData | null = null;
export function getMiniBolt(): SpriteData {
  if (miniBolt) return miniBolt;
  const art = ['...##', '..##.', '.##..', '#####', '..##.', '.##..', '##...'];
  const r = new Raster(6, 8);
  art.forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && r.set(x, y, '#ffd23f')));
  r.outline('#3a2a08');
  miniBolt = r.sprite();
  return miniBolt;
}
