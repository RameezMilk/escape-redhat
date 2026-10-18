// Original procedural furniture for the ground floor (GPU racks, cubicles, reception, kitchen, bus shelter).
// Sizes and footprints come from CUSTOM_FURNITURE (packages/contracts/src/furniture.ts), which the map builder also
// reads, so collisions and drawing agree. Desk-like items keep the Pixel Agents desk proportions (surface at y 11–25)
// so stock PCs sit on them naturally.
import { CUSTOM_FURNITURE, type CustomFurnitureId } from '@escape/contracts';
import { Raster, textWidth, type SpriteData } from './raster';

const NV = '#76b900';
const NV_DIM = '#4f7d00';
const RH = '#c4161c';

function gpuRack(): SpriteData {
  const r = new Raster(32, 32);
  r.rect(1, 0, 30, 4, '#3d434a'); // top face
  r.rect(2, 1, 28, 1, '#4a525a');
  r.rect(1, 4, 30, 26, '#15181b'); // cabinet
  r.rect(3, 5, 26, 24, '#22262b');
  for (let i = 0; i < 6; i++) {
    const y = 6 + i * 4;
    r.rect(3, y, 26, 3, '#2c3137'); // one server unit
    r.rect(3, y, 26, 1, '#3a4047');
    r.rect(3, y, 2, 3, NV_DIM); // green bezel
    for (let x = 7; x < 21; x += 2) r.set(x, y + 1, '#1a1d21'); // vents
  }
  r.rect(1, 30, 3, 2, '#0f1113'); // feet
  r.rect(28, 30, 3, 2, '#0f1113');
  r.box(1, 4, 30, 26, '#0b0d0f');
  return r.sprite();
}

/** LED positions (sprite pixels) on a GPU rack's front, for the animated drawable. */
export const RACK_LEDS: { x: number; y: number }[] = Array.from({ length: 6 }, (_, i) => [24, 26].map((x) => ({ x, y: 7 + i * 4 }))).flat();

function cubicle(): SpriteData {
  const r = new Raster(48, 32);
  // Fabric partition behind the desk, with side panels.
  r.rect(1, 0, 46, 12, '#5b6b80');
  r.rect(1, 0, 46, 2, '#8796a8');
  for (let x = 4; x < 46; x += 6) r.rect(x, 3, 1, 8, '#52607a');
  r.rect(0, 0, 2, 26, '#3a4352');
  r.rect(46, 0, 2, 26, '#3a4352');
  // Desk surface (same band as DESK_FRONT) and modesty panel.
  r.rect(2, 11, 44, 15, '#a3988a');
  r.rect(3, 12, 42, 12, '#d8cfc0');
  r.rect(3, 12, 42, 1, '#e8e1d3');
  r.rect(2, 26, 44, 1, '#3d3a37');
  r.rect(4, 27, 40, 5, '#4a4f57');
  r.rect(4, 27, 40, 1, '#5d636c');
  return r.sprite();
}

function receptionDesk(): SpriteData {
  const r = new Raster(64, 32);
  // Raised transaction counter (receptionist sits behind it on the walkable back row).
  r.rect(0, 4, 64, 4, '#e9e6df');
  r.rect(0, 4, 64, 1, '#ffffff');
  r.rect(0, 7, 64, 1, '#b9b4aa');
  // Front panel with Red Hat red and NVIDIA green accent stripes.
  r.rect(1, 8, 62, 22, '#30343b');
  r.rect(1, 11, 62, 2, RH);
  r.rect(1, 14, 62, 1, NV);
  const label = 'RECEPTION';
  r.text(label, 64 - textWidth(label) - 5, 19, '#e9e6df'); // right of the monitor that stands on the left end
  r.rect(1, 29, 62, 3, '#1c1f24');
  r.box(0, 4, 64, 28, '#15171b');
  return r.sprite();
}

function kitchenCounter(): SpriteData {
  const r = new Raster(64, 32);
  // Tiled backsplash
  r.rect(0, 0, 64, 10, '#dfe9e8');
  for (let x = 0; x < 64; x += 4) r.rect(x, 0, 1, 10, '#b9c7c6');
  for (let y = 0; y < 10; y += 4) r.rect(0, y, 64, 1, '#b9c7c6');
  // Stone worktop with a sink and tap
  r.rect(0, 10, 64, 5, '#9aa3a8');
  r.rect(0, 10, 64, 1, '#c3cacd');
  r.rect(38, 11, 14, 3, '#6f7a80');
  r.rect(39, 11, 12, 1, '#56606a');
  r.rect(44, 6, 2, 5, '#c9d1d6');
  r.rect(44, 6, 4, 1, '#c9d1d6');
  // Cabinets
  r.rect(0, 15, 64, 15, '#e8e2d6');
  for (let x = 0; x < 64; x += 16) {
    r.box(x + 1, 16, 14, 13, '#c9c1b2');
    r.rect(x + 7, 21, 2, 1, '#8a8f94');
  }
  r.rect(0, 30, 64, 2, '#3b3631');
  return r.sprite();
}

function fridge(): SpriteData {
  const r = new Raster(16, 32);
  r.rect(1, 0, 14, 31, '#e9edf0');
  r.rect(1, 0, 14, 1, '#ffffff');
  r.rect(1, 10, 14, 1, '#aab3ba'); // freezer seam
  r.rect(12, 3, 1, 5, '#7b858c'); // handles
  r.rect(12, 13, 1, 10, '#7b858c');
  r.rect(1, 30, 14, 2, '#5b636a');
  r.box(1, 0, 14, 31, '#8a949b');
  return r.sprite();
}

function vendingMachine(): SpriteData {
  const r = new Raster(16, 32);
  r.rect(1, 0, 14, 31, '#2b3038');
  r.rect(1, 1, 14, 2, NV); // lit header
  r.rect(2, 4, 8, 17, '#9fd3e6'); // window
  const snacks = ['#e94f37', '#f6c445', '#4fb3e8', '#7fd17f'];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) r.rect(3 + col * 2, 6 + row * 4, 1, 2, snacks[(row + col) % snacks.length]);
    r.rect(2, 8 + row * 4, 8, 1, '#7fb5c8');
  }
  for (let y = 6; y < 13; y += 2) {
    r.set(11, y, '#c9d1d6');
    r.set(13, y, '#c9d1d6');
  }
  r.rect(3, 23, 8, 3, '#14171b'); // pickup slot
  r.rect(1, 30, 14, 2, '#14171b');
  r.box(1, 0, 14, 31, '#14171b');
  return r.sprite();
}

function coffeeMachine(): SpriteData {
  const r = new Raster(16, 16);
  r.rect(4, 1, 8, 2, '#4a4a4a');
  r.rect(4, 3, 8, 8, '#2b2b2b');
  r.rect(5, 4, 3, 2, '#1a1a1a');
  r.set(10, 4, '#e23d3d');
  r.rect(6, 8, 3, 2, '#f4f4f4'); // cup
  r.rect(4, 11, 8, 1, '#1a1a1a');
  return r.sprite();
}

function busShelter(): SpriteData {
  const r = new Raster(80, 32);
  r.rect(0, 0, 80, 4, '#39414a'); // roof
  r.rect(0, 3, 80, 1, '#5b6570');
  r.rect(2, 4, 76, 22, '#a8d8ea66'); // back glass
  r.rect(4, 18, 36, 3, '#7a5a3a'); // bench seen through the glass
  r.rect(6, 21, 2, 4, '#4a3624');
  r.rect(36, 21, 2, 4, '#4a3624');
  // Lit advertising panel
  r.rect(46, 6, 28, 18, '#f4f1e8');
  r.box(46, 6, 28, 18, '#5b6570');
  r.rect(48, 8, 24, 5, RH);
  r.rect(48, 14, 24, 2, NV);
  r.text('CITY BUS', 48, 18, '#30343b');
  for (const x of [0, 40, 78]) r.rect(x, 4, 2, 24, '#5b6570'); // posts
  r.rect(0, 28, 80, 2, '#00000033'); // shadow
  return r.sprite();
}

const DRAW: Record<CustomFurnitureId, () => SpriteData> = {
  GPU_RACK: gpuRack,
  CUBICLE: cubicle,
  RECEPTION_DESK: receptionDesk,
  KITCHEN_COUNTER: kitchenCounter,
  FRIDGE: fridge,
  VENDING_MACHINE: vendingMachine,
  COFFEE_MACHINE: coffeeMachine,
  BUS_SHELTER: busShelter,
};

let cached: Record<string, SpriteData> | null = null;
/** Every custom furniture sprite, checked against its CUSTOM_FURNITURE size. */
export function getCustomFurnitureSprites(): Record<string, SpriteData> {
  if (cached) return cached;
  const out: Record<string, SpriteData> = {};
  for (const [id, def] of Object.entries(CUSTOM_FURNITURE)) {
    const s = DRAW[id as CustomFurnitureId]();
    if (s.length !== def.height || s[0].length !== def.width) throw new Error(`${id} sprite is ${s[0].length}×${s.length}, expected ${def.width}×${def.height}`);
    out[id] = s;
  }
  cached = out;
  return out;
}
