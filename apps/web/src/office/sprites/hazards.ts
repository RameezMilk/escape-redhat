// Original hazard sprites (authored procedurally for Escape from Red Hat).
// Fire: stylized 3-frame flame for a 2×2-tile footprint (no fire physics — a marker with a defined no-go area).
// Blocker: toppled filing cabinet + box (2×2 tiles) that cuts a corridor.
import { Raster, type SpriteData } from './raster';

const FIRE = {
  outline: '#7a1414',
  red: '#e2362b',
  orange: '#ff8a1f',
  yellow: '#ffd23f',
  core: '#fff4c2',
  log: '#4a2a1a',
  logHi: '#6e4126',
  ember: '#ff5a1f',
  scorch: '#1e0f0a88',
};

function flameHeight(x: number, frame: number): number {
  const bell = (c: number, w: number, a: number) => a * Math.exp(-(((x - c) / w) ** 2));
  const jitter = Math.sin(x * 1.3 + frame * 2.1) * 2.2 + Math.sin(x * 0.7 - frame * 1.7) * 1.4;
  return bell(16, 6.5, 21) + bell(9, 2.6, 7 + (frame === 1 ? 3 : 0)) + bell(23, 2.6, 8 + (frame === 2 ? 3 : 0)) + jitter;
}

function buildFire(frame: number): SpriteData {
  const r = new Raster(32, 32);
  r.disc(16, 28, 14, 3.6, FIRE.scorch);
  const base = 28;
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
  // Logs at the base
  r.rect(7, 27, 18, 2, FIRE.log);
  r.rect(9, 26, 6, 1, FIRE.logHi);
  r.rect(18, 26, 5, 1, FIRE.logHi);
  // Sparks
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
export function getFireFrames(): SpriteData[] {
  if (!fireFrames) fireFrames = [0, 1, 2].map(buildFire);
  return fireFrames;
}

const BLK = {
  outline: '#1b1418',
  top: '#a3acb6',
  topHi: '#c4ccd4',
  face: '#6b737d',
  faceDk: '#555c66',
  handle: '#2a2d33',
  box: '#c9965a',
  boxDk: '#a5733f',
  tape: '#ead7a4',
  paper: '#f2f2ee',
  paperLine: '#b9c3cf',
  stripeY: '#f2c230',
  stripeK: '#26262c',
  shadow: '#1e0f0a66',
};

let blocker: SpriteData | null = null;
export function getBlockerSprite(): SpriteData {
  if (blocker) return blocker;
  const r = new Raster(32, 32);
  r.disc(15, 27, 15, 3.5, BLK.shadow);
  // Toppled filing cabinet (lying on its side): top surface + front face with drawers turned sideways
  r.rect(2, 13, 23, 8, BLK.top);
  r.rect(2, 13, 23, 2, BLK.topHi);
  r.rect(2, 21, 23, 7, BLK.face);
  for (const x of [9, 17]) r.rect(x, 21, 1, 7, BLK.faceDk);
  for (const x of [5, 13, 20]) r.rect(x, 24, 2, 1, BLK.handle);
  // Cardboard box tumbled on top, tilted
  r.rect(17, 5, 12, 9, BLK.box);
  r.rect(17, 11, 12, 4, BLK.boxDk);
  r.rect(22, 5, 2, 6, BLK.tape);
  // Scattered papers
  r.rect(3, 9, 6, 4, BLK.paper);
  r.rect(4, 10, 4, 1, BLK.paperLine);
  r.rect(26, 22, 5, 4, BLK.paper);
  r.rect(27, 23, 3, 1, BLK.paperLine);
  r.outline(BLK.outline);
  // Caution stripe on the cabinet face so it reads as "blocked"
  for (let x = 3; x < 24; x++) r.set(x, 27, Math.floor(x / 2) % 2 ? BLK.stripeY : BLK.stripeK);
  blocker = r.sprite();
  return blocker;
}
