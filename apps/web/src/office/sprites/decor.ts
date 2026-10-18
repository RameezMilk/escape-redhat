// Original decor sprites: pixel signage for the fictional office. These are authored pixel treatments: a generic red
// fedora + wordmark, a green NVIDIA wordmark, and — in the GPU server room, at the team's request — a small hand-drawn
// pixel rendition of the NVIDIA eye logo (trademark artwork of NVIDIA, used as set dressing; see THIRD_PARTY_NOTICES).
// Fictional hackathon-themed office; not affiliated with or endorsed by Red Hat or NVIDIA.
import { Raster, textWidth, type SpriteData } from './raster';

/** Red Hat room sign at 2× (pixel-doubled fedora and lettering), 26 px tall to fill the outer wall. */
function redHatSign(): SpriteData {
  const label = 'RED HAT';
  const tw = textWidth(label, 2);
  const w = 36 + tw + 6;
  const r = new Raster(w, 26);
  r.rect(0, 0, w, 26, '#151515');
  r.box(0, 0, w, 26, '#3b3b3b');
  r.rect(1, 1, w - 2, 1, '#262626');
  // Stylized fedora, drawn on a 2× grid
  const f = (x: number, y: number, fw: number, fh: number, c: string) => r.rect(2 * x, 2 * y + 1, 2 * fw, 2 * fh, c);
  f(5, 3, 7, 4, '#e00000'); // crown
  f(6, 2, 5, 1, '#e00000');
  f(7, 3, 3, 1, '#b80000'); // crease
  f(5, 6, 7, 1, '#1a1a1a'); // band
  f(2, 7, 13, 2, '#c40000'); // brim
  f(3, 9, 11, 1, '#8f0000');
  r.text(label, 36, 7, '#f4f4f4', 2);
  r.rect(36, 19, tw, 2, '#e00000');
  return r.sprite();
}

function nvidiaSign(): SpriteData {
  const label = 'NVIDIA';
  const w = textWidth(label) + 8;
  const r = new Raster(w, 12);
  r.rect(0, 0, w, 12, '#111111');
  r.box(0, 0, w, 12, '#333333');
  r.text(label, 4, 3, '#76b900');
  r.rect(3, 9, w - 6, 1, '#4f7d00');
  return r.sprite();
}

/** 16×11 pixel eye mark: a green field with a black eye swirl whose arcs open to the right, the outer arc rounding
 *  off on the left. */
const NVIDIA_EYE = [
  '...GGGGGGGGGGGGG',
  '.GGGkkkkkkGGGGGG',
  'GGkkGGGGGGkkGGGG',
  'GkGGGkkkkGGGkGGG',
  'kGGGkGGGGkGGGGGG',
  'kGGkGGkkGGGGGGGG',
  'kGGGkGGGGkGGGGGG',
  'GkGGGkkkkGGGkGGG',
  'GGkkGGGGGGkkGGGG',
  '.GGGkkkkkkGGGGGG',
  '...GGGGGGGGGGGGG',
];

function drawEye(r: Raster, x: number, y: number, s = 1) {
  NVIDIA_EYE.forEach((row, yy) => {
    for (let xx = 0; xx < row.length; xx++) {
      if (row[xx] === 'G') r.rect(x + xx * s, y + yy * s, s, s, '#76b900');
      else if (row[xx] === 'k') r.rect(x + xx * s, y + yy * s, s, s, '#0d0d0d');
    }
  });
}

/** Server-room sign at 2×: eye logo + white NVIDIA wordmark on a dark plate, 26 px tall to fill the outer wall. */
function nvidiaLogoSign(): SpriteData {
  const label = 'NVIDIA';
  const tw = textWidth(label, 2);
  const w = 4 + 32 + 6 + tw + 6;
  const r = new Raster(w, 26);
  r.rect(0, 0, w, 26, '#111111');
  r.box(0, 0, w, 26, '#333333');
  drawEye(r, 4, 2, 2);
  r.text(label, 42, 7, '#f4f4f4', 2);
  r.rect(42, 19, tw, 2, '#76b900');
  return r.sprite();
}

function welcomeSign(): SpriteData {
  const label = 'WELCOME';
  const w = textWidth(label) + 10;
  const r = new Raster(w, 11);
  r.rect(0, 0, w, 11, '#1b1d22');
  r.box(0, 0, w, 11, '#3a3d44');
  r.rect(1, 1, 2, 9, '#c4161c');
  r.rect(w - 3, 1, 2, 9, '#76b900');
  r.text(label, 5, 3, '#f4f4f4');
  return r.sprite();
}

function wardenSign(): SpriteData {
  const label = 'FIRE WARDEN';
  const w = textWidth(label) + 4;
  const r = new Raster(w, 9);
  r.rect(0, 0, w, 9, '#c62828');
  r.box(0, 0, w, 9, '#7f1414');
  r.text(label, 2, 2, '#ffffff');
  return r.sprite();
}

/** Bus stop pole with its sign: the evacuation landmark across the street. */
function busStopSign(): SpriteData {
  const r = new Raster(16, 40);
  r.disc(8, 38, 4, 1.5, '#00000055');
  r.rect(7, 12, 2, 26, '#6b7178');
  r.rect(7, 12, 1, 26, '#8a9098');
  r.rect(1, 0, 14, 13, '#f4f4f4');
  r.box(1, 0, 14, 13, '#1e5aa8');
  r.rect(2, 1, 12, 5, '#1e5aa8');
  r.text('BUS', 3, 1, '#ffffff');
  r.text('42', 5, 7, '#1e5aa8');
  return r.sprite();
}

function exitSign(): SpriteData {
  const label = 'EXIT';
  const w = textWidth(label) + 4;
  const r = new Raster(w, 9);
  r.rect(0, 0, w, 9, '#1f9d55');
  r.box(0, 0, w, 9, '#11673a');
  r.text(label, 2, 2, '#ffffff');
  return r.sprite();
}

function evacPlan(): SpriteData {
  const r = new Raster(14, 12);
  r.rect(0, 0, 14, 12, '#f1efe6');
  r.box(0, 0, 14, 12, '#7f7a6c');
  r.box(2, 2, 10, 7, '#5470a8');
  r.rect(6, 2, 1, 5, '#5470a8');
  r.rect(2, 9, 3, 1, '#2e9e5a');
  r.rect(10, 9, 3, 1, '#2e9e5a');
  r.set(8, 5, '#e23d3d');
  r.set(9, 5, '#e23d3d');
  r.rect(3, 10, 8, 1, '#c9c4b5');
  return r.sprite();
}

function checkinFlag(): SpriteData {
  const r = new Raster(16, 30);
  r.disc(5, 28, 4, 1.5, '#00000055');
  r.rect(3, 2, 1, 26, '#5e5e66');
  r.rect(2, 27, 3, 1, '#3a3a42');
  r.rect(4, 2, 11, 9, '#3fbf6f');
  r.rect(4, 10, 11, 1, '#2a8a4e');
  // white check mark
  r.line(6, 6, 8, 8, '#ffffff');
  r.line(8, 8, 12, 4, '#ffffff');
  r.set(3, 1, '#f2c230');
  return r.sprite();
}

export interface DecorSprites {
  redhat: SpriteData;
  nvidia: SpriteData;
  nvidiaLogo: SpriteData;
  welcome: SpriteData;
  warden: SpriteData;
  busStop: SpriteData;
  exit: SpriteData;
  plan: SpriteData;
  flag: SpriteData;
}

let cached: DecorSprites | null = null;
export function getDecorSprites(): DecorSprites {
  if (!cached)
    cached = {
      redhat: redHatSign(),
      nvidia: nvidiaSign(),
      nvidiaLogo: nvidiaLogoSign(),
      welcome: welcomeSign(),
      warden: wardenSign(),
      busStop: busStopSign(),
      exit: exitSign(),
      plan: evacPlan(),
      flag: checkinFlag(),
    };
  return cached;
}
