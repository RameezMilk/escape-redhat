// Original fixture sprites: electric sliding doors (open / stuck shut) and fire-alarm pull stations.
import { Raster, type SpriteData } from './raster';

const D = {
  frame: '#3b4350',
  frameHi: '#5b6574',
  jamb: '#4a5361',
  glass: '#9fc7d6aa',
  glassHi: '#d7eef5cc',
  shut: '#2a3c46',
  shutHi: '#5d7f90',
  seam: '#141c22',
  ledOk: '#3cff7a',
  ledBad: '#ff3b3b',
};

// Horizontal door: spans 2 tiles (32 px) in a horizontal wall; 32 tall, bottom-aligned to the door row
// (the top 16 px rise like the neighbouring wall sprites).
function hDoor(closed: boolean): SpriteData {
  const r = new Raster(32, 32);
  // header (lintel) + jambs
  r.rect(0, 10, 32, 6, D.frame).rect(0, 10, 32, 1, D.frameHi);
  r.rect(0, 10, 2, 22, D.jamb).rect(30, 10, 2, 22, D.jamb);
  if (closed) {
    r.rect(2, 16, 14, 16, D.shut).rect(16, 16, 14, 16, D.shut);
    r.rect(15, 16, 2, 16, D.seam);
    r.line(4, 30, 9, 18, D.shutHi).line(19, 30, 24, 18, D.shutHi);
    r.rect(14, 12, 4, 2, D.ledBad);
  } else {
    // panels retracted into the jambs: thin glass slivers at each side
    r.rect(2, 16, 3, 16, D.glass).rect(27, 16, 3, 16, D.glass);
    r.rect(2, 16, 1, 16, D.glassHi).rect(29, 16, 1, 16, D.glassHi);
    r.rect(15, 12, 2, 2, D.ledOk);
  }
  return r.sprite();
}

// Vertical door: spans 2 tiles (32 px) down a vertical wall, seen from above as a narrow panel in the wall line.
// 16 wide × 48 tall, bottom-aligned to the last door row (top 16 px = header above the doorway).
function vDoor(closed: boolean): SpriteData {
  const r = new Raster(16, 48);
  r.rect(4, 10, 8, 6, D.frame).rect(4, 10, 8, 1, D.frameHi); // header cap
  r.rect(4, 44, 8, 4, D.frame); // bottom stub
  if (closed) {
    r.rect(5, 16, 6, 28, D.shut).rect(5, 16, 1, 28, D.shutHi).rect(5, 29, 6, 2, D.seam);
    r.rect(7, 12, 2, 2, D.ledBad);
  } else {
    r.rect(5, 16, 6, 2, D.glass).rect(5, 42, 6, 2, D.glass); // panel edges retracted to each end
    r.rect(7, 18, 2, 24, '#00000022'); // floor track
    r.rect(7, 12, 2, 2, D.ledOk);
  }
  return r.sprite();
}

let doors: { h: { open: SpriteData; shut: SpriteData }; v: { open: SpriteData; shut: SpriteData } } | null = null;
export function getDoorSprites() {
  if (!doors) doors = { h: { open: hDoor(false), shut: hDoor(true) }, v: { open: vDoor(false), shut: vDoor(true) } };
  return doors;
}

// Pull station: 10×13 red box with a white pull handle, mounted on a wall tile; 6×3 strobe dome above it.
function pullBox(): SpriteData {
  const r = new Raster(10, 13);
  r.rect(0, 0, 10, 13, '#7a1010');
  r.rect(1, 1, 8, 11, '#d42a2a');
  r.rect(1, 1, 8, 1, '#ef5a52');
  r.rect(2, 5, 6, 2, '#f4f4f2'); // handle
  r.rect(4, 7, 2, 2, '#f4f4f2');
  r.rect(2, 10, 6, 1, '#f9c6c0'); // "FIRE" label strip
  return r.sprite();
}
function strobe(color: string, glow: string): SpriteData {
  const r = new Raster(8, 5);
  r.rect(1, 1, 6, 4, '#3a3a40');
  r.rect(2, 0, 4, 3, color);
  r.set(2, 0, glow).set(5, 0, glow);
  return r.sprite();
}

let alarmSprites: { box: SpriteData; off: SpriteData; red: SpriteData; white: SpriteData } | null = null;
export function getAlarmSprites() {
  if (!alarmSprites) {
    alarmSprites = {
      box: pullBox(),
      off: strobe('#d9d2d2', '#efe8e8'),
      red: strobe('#ff2a2a', '#ffb3a8'),
      white: strobe('#ffffff', '#ffe9e9'),
    };
  }
  return alarmSprites;
}
