// Original decor sprites: pixel signage for the fictional office. These are authored pixel treatments
// (a generic red fedora + wordmark; a green NVIDIA wordmark only — no copied logo artwork).
// Fictional hackathon-themed office; not affiliated with or endorsed by Red Hat or NVIDIA.
import { Raster, textWidth, type SpriteData } from './raster';

function redHatSign(): SpriteData {
  const label = 'RED HAT';
  const w = 17 + textWidth(label) + 4;
  const r = new Raster(w, 14);
  r.rect(0, 0, w, 14, '#151515');
  r.box(0, 0, w, 14, '#3b3b3b');
  r.rect(1, 1, w - 2, 1, '#262626');
  // Stylized fedora
  r.rect(5, 3, 7, 4, '#e00000'); // crown
  r.rect(6, 2, 5, 1, '#e00000');
  r.rect(7, 3, 3, 1, '#b80000'); // crease
  r.rect(5, 6, 7, 1, '#1a1a1a'); // band
  r.rect(2, 7, 13, 2, '#c40000'); // brim
  r.rect(3, 9, 11, 1, '#8f0000');
  r.text(label, 17, 5, '#f4f4f4');
  r.rect(17, 11, textWidth(label), 1, '#e00000');
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
  exit: SpriteData;
  plan: SpriteData;
  flag: SpriteData;
}

let cached: DecorSprites | null = null;
export function getDecorSprites(): DecorSprites {
  if (!cached) cached = { redhat: redHatSign(), nvidia: nvidiaSign(), exit: exitSign(), plan: evacPlan(), flag: checkinFlag() };
  return cached;
}
