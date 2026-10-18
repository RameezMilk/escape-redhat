// Loads the vendored Pixel Agents art (MIT, pinned 3537e14) in the browser and installs it into the
// renderer's module state. Reworked from vendor/.../browserMock.ts: same decode logic and load order,
// but no VS Code message bus and no default layout (our layout comes from the map JSON in data/maps/).
import { rgbaToHex } from '../vendor/pixel-agents/core/src/assets/colorUtils';
import {
  CHAR_FRAME_H,
  CHAR_FRAME_W,
  CHAR_FRAMES_PER_ROW,
  CHARACTER_DIRECTIONS,
  FLOOR_TILE_SIZE,
  WALL_BITMASK_COUNT,
  WALL_GRID_COLS,
  WALL_PIECE_HEIGHT,
  WALL_PIECE_WIDTH,
} from '../vendor/pixel-agents/core/src/assets/constants';
import type { AssetIndex, CatalogEntry, CharacterDirectionSprites } from '../vendor/pixel-agents/core/src/assets/types';
import { setFloorSprites } from '../vendor/pixel-agents/webview-ui/src/office/floorTiles';
import { buildDynamicCatalog } from '../vendor/pixel-agents/webview-ui/src/office/layout/furnitureCatalog';
import { setCarpetSprites } from '../vendor/pixel-agents/webview-ui/src/office/sprites/carpetTiles';
import { setCharacterTemplates } from '../vendor/pixel-agents/webview-ui/src/office/sprites/spriteData';
import { setWallSprites } from '../vendor/pixel-agents/webview-ui/src/office/wallTiles';
import { CUSTOM_FURNITURE } from '@escape/contracts';
import { withDerivedOutfits } from './sprites/characters';
import { getCustomFurnitureSprites } from './sprites/furniture';

interface DecodedPng {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

function readSprite(png: DecodedPng, width: number, height: number, ox = 0, oy = 0): string[][] {
  const sprite: string[][] = [];
  for (let y = 0; y < height; y++) {
    const row: string[] = [];
    for (let x = 0; x < width; x++) {
      const i = ((oy + y) * png.width + (ox + x)) * 4;
      row.push(rgbaToHex(png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]));
    }
    sprite.push(row);
  }
  return sprite;
}

async function decodePng(url: string): Promise<DecodedPng> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
  const bitmap = await createImageBitmap(await res.blob());
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2d context unavailable');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: img.data };
}

const asset = (rel: string) => `${import.meta.env.BASE_URL}assets/${rel}`;
const withDir = (kind: string, rel: string) => (rel.startsWith(`${kind}/`) ? rel : `${kind}/${rel}`);

let loaded: Promise<void> | null = null;

/** Idempotent: decodes all PNGs once and installs them into the renderer. */
export function loadPixelAssets(): Promise<void> {
  if (!loaded) loaded = doLoad();
  return loaded;
}

async function doLoad(): Promise<void> {
  const [index, catalog] = await Promise.all([
    fetch(asset('asset-index.json')).then((r) => r.json() as Promise<AssetIndex>),
    fetch(asset('furniture-catalog.json')).then((r) => r.json() as Promise<CatalogEntry[]>),
  ]);

  const characters = await Promise.all(
    index.characters.map(async (rel) => {
      const png = await decodePng(asset(withDir('characters', rel)));
      const byDir: CharacterDirectionSprites = { down: [], up: [], right: [] };
      CHARACTER_DIRECTIONS.forEach((dir, d) => {
        const frames: string[][][] = [];
        for (let f = 0; f < CHAR_FRAMES_PER_ROW; f++) {
          frames.push(readSprite(png, CHAR_FRAME_W, CHAR_FRAME_H, f * CHAR_FRAME_W, d * CHAR_FRAME_H));
        }
        byDir[dir] = frames;
      });
      return byDir;
    }),
  );

  const floors = await Promise.all(
    index.floors.map(async (rel) => readSprite(await decodePng(asset(withDir('floors', rel))), FLOOR_TILE_SIZE, FLOOR_TILE_SIZE)),
  );

  const walls = await Promise.all(
    index.walls.map(async (rel) => {
      const png = await decodePng(asset(withDir('walls', rel)));
      const set: string[][][] = [];
      for (let mask = 0; mask < WALL_BITMASK_COUNT; mask++) {
        const ox = (mask % WALL_GRID_COLS) * WALL_PIECE_WIDTH;
        const oy = Math.floor(mask / WALL_GRID_COLS) * WALL_PIECE_HEIGHT;
        set.push(readSprite(png, WALL_PIECE_WIDTH, WALL_PIECE_HEIGHT, ox, oy));
      }
      return set;
    }),
  );

  const furnitureSprites: Record<string, string[][]> = {};
  await Promise.all(
    catalog.map(async (entry) => {
      furnitureSprites[entry.id] = readSprite(await decodePng(asset(entry.furniturePath)), entry.width, entry.height);
    }),
  );

  // Our procedural furniture (no PNGs): catalog entries from CUSTOM_FURNITURE, sprites drawn in sprites/furniture.ts.
  const custom = getCustomFurnitureSprites();
  const customEntries: CatalogEntry[] = Object.entries(CUSTOM_FURNITURE).map(([id, f]) => ({
    id,
    name: f.label,
    label: f.label,
    category: f.category,
    file: '',
    furniturePath: '',
    width: f.width,
    height: f.height,
    footprintW: f.footprintW,
    footprintH: f.footprintH,
    isDesk: f.isDesk,
    canPlaceOnWalls: false,
    canPlaceOnSurfaces: 'canPlaceOnSurfaces' in f ? f.canPlaceOnSurfaces : false,
    backgroundTiles: f.backgroundTiles,
  }));

  // Load order matches Pixel Agents: characters → floors → walls → carpets → furniture catalog.
  setCharacterTemplates(withDerivedOutfits(characters));
  setFloorSprites(floors);
  setWallSprites(walls);
  setCarpetSprites([]);
  buildDynamicCatalog({ catalog: [...catalog, ...customEntries], sprites: { ...furnitureSprites, ...custom } });
}
