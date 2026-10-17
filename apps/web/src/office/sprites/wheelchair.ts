// Daniel's sprite: an ORIGINAL pixel-art wheelchair user (authored for Escape from Red Hat; not from any asset pack).
// Daniel always renders seated in his wheelchair — never as a walking sprite. Directions: down/up/right (+ mirrored
// left), 2 roll frames each. Palette-keyed ASCII so the art is reviewable in source.
import { Raster, mirrorSprite, type SpriteData } from './raster';

const PALETTE: Record<string, string> = {
  O: '#1b1418', // outline
  H: '#2b1b14', // hair
  h: '#4a3224', // hair highlight
  S: '#a8714f', // skin
  s: '#8a5a3c', // skin shadow
  E: '#1b1418', // eye
  T: '#2e9e8f', // shirt (teal)
  t: '#237466', // shirt shadow
  P: '#3d4468', // trousers
  p: '#2b3050', // trousers shadow
  K: '#26262c', // shoes
  F: '#b9c1c9', // frame (silver)
  f: '#7d8690', // frame shadow
  C: '#3a3d48', // seat/back cushion
  c: '#2a2c35', // cushion shadow
  R: '#22242a', // tyre
  r: '#4a4f5a', // tyre highlight
  X: '#d7dde3', // rim / spokes
};

function fromAscii(rows: string[]): Raster {
  const w = rows[0].length;
  const r = new Raster(w, rows.length);
  rows.forEach((line, y) => {
    if (line.length !== w) throw new Error(`wheelchair art row ${y} width ${line.length} != ${w}`);
    for (let x = 0; x < w; x++) {
      const k = line[x];
      if (k !== '.') r.set(x, y, PALETTE[k] ?? k);
    }
  });
  return r;
}

// Facing the viewer. Wheels are seen edge-on at both sides.
const FRONT = [
  '................',
  '.....OOOOOO.....',
  '....OHHHHHHO....',
  '...OHHhhHHHHO...',
  '...OHhHHHHHHO...',
  '...OHHSSSSHHO...',
  '...OHSSSSSSHO...',
  '...OSSESSESSO...',
  '...OsSSSSSSsO...',
  '....OsSssSsO....',
  '.....OOSSOO.....',
  '..F.OTTTTTTO.F..',
  '..FOTTTTTTTTOF..',
  '.RFOTtTTTTtTOFR.',
  'RrOSOtTTTTtOSORr',
  'RrOSFFTTTTFFSORr',
  'RrROfCPPPPCfORrR',
  'RrRFFPPppPPFFRrR',
  'RrRO.PPOOPP.ORrR',
  'RrRO.PPOOPP.ORrR',
  'RrRO.PP..PP.ORrR',
  'RrR.OPP..PPO.RrR',
  'RrR.OKKO.OKKO.rR',
  'RrR.FFFFFFFFF.rR',
  '.RR..f.....f..R.',
  '................',
];

// Facing away: back of head, backrest with push handles.
const BACK = [
  '................',
  '.....OOOOOO.....',
  '....OHHHHHHO....',
  '...OHHhhHHHHO...',
  '...OHhHHHHHHO...',
  '...OHHHHHHHHO...',
  '...OHHHHHHHHO...',
  '...OHHHHHHHHO...',
  '...OsHHHHHHsO...',
  '....OHHHHHHO....',
  '.KK.OOSSSSOO.KK.',
  '.FFOTTTTTTTTOFF.',
  '.RFOCCCCCCCCOFR.',
  'RrFOCcCCCCcCOFRr',
  'RrFOCcCCCCcCOFRr',
  'RrFOCCCCCCCCOFRr',
  'RrFOCCCCCCCCOFrR',
  'RrFOccccccccOFrR',
  'RrRFFFFFFFFFFRrR',
  'RrRf........fRrR',
  'RrR.f......f.RrR',
  'RrR..f....f..RrR',
  'RrR...FFFF...RrR',
  'RrR..........RrR',
  '.RR..O....O..RR.',
  '................',
];

// Profile, facing right. The big wheel is drawn procedurally on top (see buildSide).
const SIDE_BODY = [
  '................',
  '....OOOOOO......',
  '...OHHHHHHO.....',
  '..OHHhhHHHHO....',
  '..OHhHHHHHHHO...',
  '..OHHHHHSSSSO...',
  '..OHHHHSSSESO...',
  '..OHHHSSSSSSSO..',
  '..OHHHSSSSSSO...',
  '...OHHsSSSSO....',
  '.KO.OOOSSOO.....',
  '.FCOTTTTTTO.....',
  '.FCOTTTTTTTO....',
  '..COTTtTTTTO....',
  '..COTTTtTSSO....',
  '..COTTTTFFFFFO..',
  '..COTTPPPPPPPPO.',
  '..CFFPPPPPPPPPPO',
  '..FfffPPPPPPPPPO',
  '..F....f....OPPO',
  '..F.....f...OPPO',
  '..F......f..OPPO',
  '..F.......f.OPPO',
  '..........ffOKKKO',
  '.........FFFFFFF',
  '................',
].map((l) => l.slice(0, 16));

function buildSide(frame: number): SpriteData {
  const r = fromAscii(SIDE_BODY);
  // Big rear wheel on the near side: tyre ring, rim, spokes, hub. Spokes rotate between frames.
  const cx = 6.5;
  const cy = 19.5;
  r.ring(cx, cy, 6.0, 4.9, PALETTE.R);
  r.ring(cx, cy, 4.9, 4.2, PALETTE.F);
  const base = frame % 2 === 0 ? 0 : Math.PI / 6;
  for (let k = 0; k < 3; k++) {
    const a = base + (k * Math.PI) / 3;
    for (let d = 1.4; d < 4.2; d += 0.6) {
      r.set(cx - 0.5 + Math.cos(a) * d, cy - 0.5 + Math.sin(a) * d, PALETTE.f);
      r.set(cx - 0.5 - Math.cos(a) * d, cy - 0.5 - Math.sin(a) * d, PALETTE.f);
    }
  }
  r.disc(cx, cy, 1.1, 1.1, '#5c646e');
  // Tyre highlight moves with the roll
  const hl = frame % 2 === 0 ? [-2, -5] : [2, -5];
  r.set(cx - 0.5 + hl[0], cy - 0.5 + hl[1], PALETTE.r);
  // Front caster
  r.disc(12.5, 24.3, 1.3, 1.3, PALETTE.R);
  r.set(12, 24, PALETTE.r);
  return r.sprite();
}

function buildEdgeOn(rows: string[], frame: number): SpriteData {
  const r = fromAscii(rows);
  // Roll animation: tyre highlight pixels shift along the edge-on wheels
  if (frame % 2 === 1) {
    for (let y = 0; y < r.h; y++) {
      for (const x of [1, r.w - 2]) {
        if (r.get(x, y) === PALETTE.r) r.set(x, y, (y % 3 === 0 ? PALETTE.R : PALETTE.r));
        else if (r.get(x, y) === PALETTE.R && y % 3 === 1) r.set(x, y, PALETTE.r);
      }
    }
  }
  return r.sprite();
}

export interface WheelchairSprites {
  down: [SpriteData, SpriteData];
  up: [SpriteData, SpriteData];
  right: [SpriteData, SpriteData];
  left: [SpriteData, SpriteData];
}

let cached: WheelchairSprites | null = null;

export function getWheelchairSprites(): WheelchairSprites {
  if (cached) return cached;
  const right: [SpriteData, SpriteData] = [buildSide(0), buildSide(1)];
  cached = {
    down: [buildEdgeOn(FRONT, 0), buildEdgeOn(FRONT, 1)],
    up: [buildEdgeOn(BACK, 0), buildEdgeOn(BACK, 1)],
    right,
    left: [mirrorSprite(right[0]), mirrorSprite(right[1])],
  };
  return cached;
}
