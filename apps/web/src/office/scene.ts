// Scene: turns the authored map + server snapshots into Pixel Agents renderer inputs.
// The server is authoritative; this module only interpolates accepted positions between snapshots.
import type { ActorSnapshot, Dir, HazardKind, HazardSnapshot, MapData, Snapshot, Tile } from '@escape/contracts';

import { createCharacter, updateCharacter } from '../vendor/pixel-agents/webview-ui/src/office/engine/characters';
import type { ExtraDrawable } from '../vendor/pixel-agents/webview-ui/src/office/engine/renderer';
import { getAnimationFrames } from '../vendor/pixel-agents/webview-ui/src/office/layout/furnitureCatalog';
import { layoutToFurnitureInstances, layoutToTileMap } from '../vendor/pixel-agents/webview-ui/src/office/layout/layoutSerializer';
import { getCachedSprite } from '../vendor/pixel-agents/webview-ui/src/office/sprites/spriteCache';
import type {
  Character,
  FurnitureInstance,
  OfficeLayout,
  TileType as TileTypeVal,
} from '../vendor/pixel-agents/webview-ui/src/office/types';
import { CharacterState, Direction } from '../vendor/pixel-agents/webview-ui/src/office/types';
import { ACTOR_VIEW } from './actors';
import { getDecorSprites } from './sprites/decor';
import { getAlarmSprites, getDoorSprites } from './sprites/fixtures';
import { RACK_LEDS } from './sprites/furniture';
import { CELL_FLAME_HEIGHT, cellFlameFor, getBoltSprite, getCharTiles, getFireFrames, getMiniBolt, wallFlameFor } from './sprites/hazards';
import { Raster, type SpriteData } from './sprites/raster';
import { getWheelchairSprites } from './sprites/wheelchair';

const T = 16;
const DIR: Record<Dir, Direction> = { down: Direction.DOWN, left: Direction.LEFT, right: Direction.RIGHT, up: Direction.UP };
/** Render this far behind the newest snapshot so we always interpolate between two real states. */
const INTERP_DELAY_MS = 100;

export interface Scene {
  map: MapData;
  tileMap: TileTypeVal[][];
  furniture: FurnitureInstance[];
  characters: Map<string, Character>;
  rolled: Map<string, number>;
  lastPos: Map<string, { x: number; y: number }>;
  animTimer: number;
  animFrame: number;
}

export function createScene(map: MapData): Scene {
  const layout = map.layout as unknown as OfficeLayout;
  const scene: Scene = {
    map,
    tileMap: layoutToTileMap(layout),
    furniture: layoutToFurnitureInstances(layout.furniture),
    characters: new Map(),
    rolled: new Map(),
    lastPos: new Map(),
    animTimer: 0,
    animFrame: 0,
  };
  for (const [id, v] of Object.entries(ACTOR_VIEW)) {
    const ch = createCharacter(v.numId, v.palette, null, null, v.hueShift);
    ch.scripted = true;
    ch.isActive = false;
    ch.state = CharacterState.IDLE;
    scene.characters.set(id, ch);
  }
  return scene;
}

/** Animate furniture with frame groups (e.g. PC screens) — swaps instance sprites every 0.45 s. */
function animateFurniture(scene: Scene, dt: number): void {
  scene.animTimer += dt;
  if (scene.animTimer < 0.45) return;
  scene.animTimer = 0;
  scene.animFrame++;
  const layout = scene.map.layout as unknown as OfficeLayout;
  const furniture = layout.furniture.map((f) => {
    const frames = getAnimationFrames(f.type);
    return frames && frames.length > 1 ? { ...f, type: frames[scene.animFrame % frames.length] } : f;
  });
  scene.furniture = layoutToFurnitureInstances(furniture);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Interpolated actor states for the current render time. */
export function interpolateActors(prev: { at: number; snap: Snapshot } | null, curr: { at: number; snap: Snapshot } | null, now: number): ActorSnapshot[] {
  if (!curr) return [];
  if (!prev || prev === curr || curr.at === prev.at) return curr.snap.actors;
  const t = Math.max(0, Math.min(1, (now - INTERP_DELAY_MS - prev.at) / (curr.at - prev.at)));
  return curr.snap.actors.map((ca) => {
    const pa = prev.snap.actors.find((a) => a.id === ca.id);
    if (!pa || Math.hypot(pa.x - ca.x, pa.y - ca.y) > 3) return ca; // teleport-sized jump (reset/replay seek): snap
    return { ...ca, x: lerp(pa.x, ca.x, t), y: lerp(pa.y, ca.y, t), dir: t < 0.5 ? pa.dir : ca.dir, anim: t < 0.5 ? pa.anim : ca.anim };
  });
}

/** Push interpolated actor state into the Pixel Agents characters and advance their animation frames. */
export function updateScene(scene: Scene, actors: ActorSnapshot[], dt: number): void {
  animateFurniture(scene, dt);
  const wheel = getWheelchairSprites();
  // Render-only nudge so two characters reported on (almost) the same tile stay distinguishable.
  const nudge = new Map<string, number>();
  actors.forEach((a, i) => {
    for (let j = 0; j < i; j++) {
      const b = actors[j];
      if (Math.abs(a.x - b.x) < 0.35 && Math.abs(a.y - b.y) < 0.35) {
        nudge.set(b.id, (nudge.get(b.id) ?? 0) - 4);
        nudge.set(a.id, (nudge.get(a.id) ?? 0) + 4);
      }
    }
  });
  for (const a of actors) {
    const ch = scene.characters.get(a.id);
    if (!ch) continue;
    ch.x = a.x * T + T / 2 + (nudge.get(a.id) ?? 0);
    ch.y = a.y * T + T / 2;
    ch.tileCol = Math.round(a.x);
    ch.tileRow = Math.round(a.y);
    ch.dir = DIR[a.dir];
    const moving = a.anim === 'walk';
    let state: Character['state'] = moving ? CharacterState.WALK : a.anim === 'idle' ? CharacterState.IDLE : CharacterState.TYPE;
    if (a.usesWheelchair) {
      // Daniel is always seated in his wheelchair: never the walk/typing sprite, no chair sitting offset.
      state = moving ? CharacterState.WALK : CharacterState.IDLE;
      const last = scene.lastPos.get(a.id);
      const dist = last ? Math.hypot(a.x - last.x, a.y - last.y) : 0;
      const rolled = (scene.rolled.get(a.id) ?? 0) + dist;
      scene.rolled.set(a.id, rolled);
      const f = Math.floor(rolled * 3) % 2;
      ch.spriteOverride = wheel[a.dir][f];
    }
    scene.lastPos.set(a.id, { x: a.x, y: a.y });
    if (ch.state !== state) {
      ch.state = state;
      ch.frame = 0;
      ch.frameTimer = 0;
    }
    updateCharacter(ch, dt, [], new Map(), scene.tileMap, new Set());
  }
}

// ---------------------------------------------------------------------------
// Extra drawables: hazards, signage, assembly marker
// ---------------------------------------------------------------------------

function blit(ctx: CanvasRenderingContext2D, sprite: SpriteData, x: number, y: number, ox: number, oy: number, zoom: number, alpha = 1): void {
  const img = getCachedSprite(sprite, zoom);
  if (alpha !== 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
  }
  ctx.drawImage(img, Math.round(ox + x * zoom), Math.round(oy + y * zoom));
  if (alpha !== 1) ctx.restore();
}

let groundLabel: SpriteData | null = null;
function assemblyLabel(): SpriteData {
  if (!groundLabel) {
    const r = new Raster(39, 9);
    r.text('ASSEMBLY', 2, 2, '#fff1c2');
    r.outline('#3a2a08');
    groundLabel = r.sprite();
  }
  return groundLabel;
}

export function staticDrawables(map: MapData): ExtraDrawable[] {
  const d = getDecorSprites();
  const out: ExtraDrawable[] = [];
  for (const deco of map.decor) {
    const { col, row } = deco;
    switch (deco.kind) {
      case 'sign_redhat':
        // Big room signs are centred on the left edge of `col` and on the 32 px outer wall (−16…+16 around the row top).
        out.push({ zY: (row + 1) * T + 0.25, draw: (c, ox, oy, z) => blit(c, d.redhat, col * T - Math.floor(d.redhat[0].length / 2), row * T - 13, ox, oy, z) });
        break;
      case 'sign_nvidia':
        out.push({ zY: (row + 1) * T + 0.25, draw: (c, ox, oy, z) => blit(c, d.nvidia, col * T + 2, row * T - 8, ox, oy, z) });
        break;
      case 'exit_sign':
        out.push({ zY: (row + 1) * T + 0.25, draw: (c, ox, oy, z) => blit(c, d.exit, col * T + (T - d.exit[0].length) / 2, row * T - 8, ox, oy, z) });
        break;
      case 'evac_plan':
        out.push({ zY: (row + 1) * T + 0.25, draw: (c, ox, oy, z) => blit(c, d.plan, col * T + 1, row * T - 8, ox, oy, z) });
        break;
      case 'checkin_flag':
        out.push({ zY: (row + 1) * T - 0.5, draw: (c, ox, oy, z) => blit(c, d.flag, col * T, (row + 1) * T - d.flag.length, ox, oy, z) });
        break;
      case 'sign_nvidia_logo':
        out.push({ zY: (row + 1) * T + 0.25, draw: (c, ox, oy, z) => blit(c, d.nvidiaLogo, col * T - Math.floor(d.nvidiaLogo[0].length / 2), row * T - 13, ox, oy, z) });
        break;
      case 'sign_welcome':
        out.push({ zY: (row + 1) * T + 0.25, draw: (c, ox, oy, z) => blit(c, d.welcome, col * T, row * T - 8, ox, oy, z) });
        break;
      case 'warden_sign':
        out.push({ zY: (row + 1) * T + 0.25, draw: (c, ox, oy, z) => blit(c, d.warden, col * T + (T - d.warden[0].length) / 2, row * T - 8, ox, oy, z) });
        break;
      case 'bus_stop_sign':
        out.push({ zY: (row + 1) * T - 0.5, draw: (c, ox, oy, z) => blit(c, d.busStop, col * T, (row + 1) * T - d.busStop.length, ox, oy, z) });
        break;
      case 'crosswalk':
      case 'lane_line':
      case 'curb':
        out.push(groundMarking(deco.kind, col, row, deco.w ?? 1, deco.h ?? 1));
        break;
    }
  }
  // Ground lettering under the assembly area
  const a = map.assembly.tiles;
  if (a.length) {
    const minC = Math.min(...a.map((t) => t.col));
    const maxC = Math.max(...a.map((t) => t.col));
    const maxR = Math.max(...a.map((t) => t.row));
    const lbl = assemblyLabel();
    out.push({
      zY: -500,
      draw: (c, ox, oy, z) => blit(c, lbl, ((minC + maxC + 1) * T) / 2 - lbl[0].length / 2, (maxR + 1) * T + 2, ox, oy, z),
    });
    out.push({
      zY: -600,
      draw: (c, ox, oy, z) => {
        const s = T * z;
        c.save();
        c.strokeStyle = 'rgba(122, 90, 18, 0.9)';
        c.lineWidth = Math.max(1, z);
        c.setLineDash([2 * z, 2 * z]);
        const minR = Math.min(...a.map((t) => t.row));
        c.strokeRect(ox + minC * s + z, oy + minR * s + z, (maxC - minC + 1) * s - 2 * z, (maxR - minR + 1) * s - 2 * z);
        c.restore();
      },
    });
  }
  return out;
}

/** Kerbs and centre lines that reach the map's left or right edge, continued `ext` tiles past it (for the backdrop
 *  beyond the map). Keep `ext` a multiple of 5 tiles so the 10 px dash rhythm stays in step with the map's own. */
export function extendedGroundMarkings(map: MapData, ext: number): ExtraDrawable[] {
  const out: ExtraDrawable[] = [];
  for (const deco of map.decor) {
    if (deco.kind !== 'lane_line' && deco.kind !== 'curb') continue;
    const w = deco.w ?? 1;
    const left = deco.col === 0 ? ext : 0;
    const right = deco.col + w === map.cols ? ext : 0;
    if (left || right) out.push(groundMarking(deco.kind, deco.col - left, deco.row, w + left + right, deco.h ?? 1));
  }
  return out;
}

/** Road markings, drawn on the ground under everything else (zY −700, below the assembly outline). */
function groundMarking(kind: 'crosswalk' | 'lane_line' | 'curb', col: number, row: number, w: number, h: number): ExtraDrawable {
  return {
    zY: -700,
    draw: (c, ox, oy, z) => {
      const x0 = ox + col * T * z;
      const y0 = oy + row * T * z;
      c.save();
      if (kind === 'crosswalk') {
        // Bars parallel to the traffic (east–west), so people walking north–south step across them.
        c.fillStyle = 'rgba(236, 236, 228, 0.92)';
        for (let y = 2; y < h * T; y += 6) c.fillRect(x0 + z, y0 + y * z, (w * T - 2) * z, 3 * z);
      } else if (kind === 'lane_line') {
        // Dashed centre line along the top edge of `row`.
        c.fillStyle = 'rgba(242, 194, 48, 0.9)';
        for (let x = 1; x < w * T; x += 10) c.fillRect(x0 + x * z, y0 - z, Math.min(6, w * T - x) * z, 2 * z);
      } else {
        // Kerb along the top edge of `row`: a light stone edge with a dark gutter below it.
        c.fillStyle = 'rgba(196, 192, 182, 0.95)';
        c.fillRect(x0, y0 - 2 * z, w * T * z, 2 * z);
        c.fillStyle = 'rgba(0, 0, 0, 0.25)';
        c.fillRect(x0, y0, w * T * z, z);
      }
      c.restore();
    },
  };
}

/** Blinking status LEDs on every GPU rack (phases hashed per LED so racks never blink in step; dark once charred). */
export function rackLedDrawables(map: MapData, hazards: HazardSnapshot[], timeMs: number, reducedMotion: boolean): ExtraDrawable[] {
  const racks = map.furniture.filter((f) => f.type === 'GPU_RACK');
  if (!racks.length) return [];
  const charred = new Set(hazards.flatMap((h) => [...h.cells, ...h.charred]).map((t) => `${t.col},${t.row}`));
  const period = reducedMotion ? 4000 : 1300;
  return racks.map((f, ri) => {
    const dead = f.blocks.some((b) => charred.has(`${b.col},${b.row}`));
    return {
      zY: f.row * T + 32 + 0.2,
      draw: (c, ox, oy, z) => {
        RACK_LEDS.forEach((p, li) => {
          const h = Math.imul(ri * 131 + li * 977 + 7, 2654435761) >>> 0;
          const phase = (h % 1000) / 1000;
          const on = !dead && ((timeMs / period + phase) % 1) < (h % 7 === 0 ? 0.25 : 0.7);
          c.fillStyle = dead ? '#1a1a1a' : on ? (h % 11 === 0 ? '#ffb000' : '#a6ff00') : '#24360f';
          c.fillRect(ox + (f.col * T + p.x) * z, oy + (f.row * T + p.y) * z, z, z);
        });
      },
    };
  });
}

// Ignition pop-in: when a cell is first seen burning (per episode), fade/scale its flame in over 250 ms.
const firstSeen = new Map<string, number>();
let seenEpisode = '';

/** Fire cells (flames, ember glow, heat margin) and charred floor; burning/charred WALL tiles get flames climbing the
 *  wall face (drawn above the wall sprite) or a soot overlay. Electrical hazards are drawn by fixtureDrawables. */
export function hazardDrawables(hazards: HazardSnapshot[], timeMs: number, episodeId = '', map?: MapData): ExtraDrawable[] {
  if (episodeId !== seenEpisode) {
    firstSeen.clear();
    seenEpisode = episodeId;
  }
  const out: ExtraDrawable[] = [];
  const chars = getCharTiles();
  const burning = new Set<string>();
  const charred = new Set<string>();
  const isWall = (col: number, row: number) => !!map && map.terrain[row * map.cols + col] === 'wall';
  const wallBurning: [number, number][] = [];
  const wallCharred: [number, number][] = [];
  for (const h of hazards) {
    if (h.kind !== 'fire') continue;
    for (const t of h.cells) {
      if (isWall(t.col, t.row)) wallBurning.push([t.col, t.row]);
      else burning.add(`${t.col},${t.row}`);
    }
    for (const t of h.charred) {
      if (isWall(t.col, t.row)) wallCharred.push([t.col, t.row]);
      else charred.add(`${t.col},${t.row}`);
    }
  }
  out.push(...wallFireDrawables(wallBurning, wallCharred, timeMs));
  if (!burning.size && !charred.size) return out;

  // Ground layer: charred floor, ember glow under burning cells, faint heat margin around the fire front.
  out.push({
    zY: -400,
    draw: (c, ox, oy, z) => {
      const s = T * z;
      c.save();
      for (const k of charred) {
        const [col, row] = k.split(',').map(Number);
        const img = getCachedSprite(chars[(col + row) % 2], z);
        c.drawImage(img, ox + col * s, oy + row * s);
        // occasional glowing ember pixels
        const ph = Math.floor(timeMs / 380) + col * 7 + row * 3;
        if (ph % 5 === 0) {
          c.fillStyle = 'rgba(255, 110, 40, 0.9)';
          c.fillRect(ox + (col * T + 3 + ((col * 5) % 9)) * z, oy + (row * T + 4 + ((row * 3) % 8)) * z, z, z);
        }
      }
      const pulse = 0.3 + 0.08 * Math.sin(timeMs / 230);
      for (const k of burning) {
        const [col, row] = k.split(',').map(Number);
        c.fillStyle = `rgba(150, 30, 10, 0.55)`;
        c.fillRect(ox + col * s, oy + row * s, s, s);
        c.fillStyle = `rgba(255, 140, 40, ${pulse.toFixed(3)})`;
        c.fillRect(ox + col * s, oy + row * s, s, s);
      }
      // heat margin: walkable neighbours of burning cells (where the fire can spread next)
      const margin = new Set<string>();
      for (const k of burning) {
        const [col, row] = k.split(',').map(Number);
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const nk = `${col + dc},${row + dr}`;
            if (!burning.has(nk) && !charred.has(nk)) margin.add(nk);
          }
      }
      c.fillStyle = `rgba(255, 120, 40, ${(0.1 + 0.05 * Math.sin(timeMs / 300)).toFixed(3)})`;
      for (const k of margin) {
        const [col, row] = k.split(',').map(Number);
        c.fillRect(ox + col * s, oy + row * s, s, s);
      }
      c.restore();
    },
  });

  // Flames: one z-sorted drawable per burning cell (rises 6 px into the row above).
  for (const k of burning) {
    const [col, row] = k.split(',').map(Number);
    const seenKey = k;
    if (!firstSeen.has(seenKey)) firstSeen.set(seenKey, timeMs);
    const age = timeMs - (firstSeen.get(seenKey) ?? timeMs);
    const grow = Math.min(1, age / 250);
    out.push({
      zY: (row + 1) * T - 0.25,
      draw: (c, ox, oy, z) => {
        const sprite = cellFlameFor(col, row, timeMs);
        const img = getCachedSprite(sprite, z);
        const x = ox + col * T * z;
        const bottom = oy + (row + 1) * T * z;
        if (grow >= 1) {
          c.drawImage(img, Math.round(x), Math.round(bottom - CELL_FLAME_HEIGHT * z));
        } else {
          // pop in: grow upward from the floor + fade in
          c.save();
          c.globalAlpha = 0.35 + 0.65 * grow;
          const h = img.height * (0.35 + 0.65 * grow);
          c.drawImage(img, Math.round(x), Math.round(bottom - h), img.width, h);
          c.restore();
        }
      },
    });
  }
  return out;
}

/** Walls on fire: the wall sprite occupies [(row-1)*T, (row+1)*T) and sorts at (row+1)*T, so these draw just above it.
 *  Charred walls get a soot overlay with the odd glowing ember; burning walls glow and carry tall licking flames. */
function wallFireDrawables(burning: [number, number][], charred: [number, number][], timeMs: number): ExtraDrawable[] {
  const out: ExtraDrawable[] = [];
  for (const [col, row] of charred) {
    out.push({
      zY: (row + 1) * T + 0.3,
      draw: (c, ox, oy, z) => {
        const x = ox + col * T * z;
        const top = oy + (row - 1) * T * z;
        c.save();
        c.fillStyle = 'rgba(22, 15, 12, 0.62)';
        c.fillRect(x, top, T * z, 2 * T * z);
        c.fillStyle = 'rgba(0, 0, 0, 0.25)';
        for (let i = 0; i < 4; i++) c.fillRect(x + ((col * 5 + i * 4) % 14) * z, top + ((row * 7 + i * 9) % 30) * z, 2 * z, z);
        if ((Math.floor(timeMs / 420) + col * 3 + row) % 6 === 0) {
          c.fillStyle = 'rgba(255, 110, 40, 0.9)';
          c.fillRect(x + ((col * 7) % 12 + 2) * z, top + (18 + ((row * 5) % 10)) * z, z, z);
        }
        c.restore();
      },
    });
  }
  for (const [col, row] of burning) {
    const key = `w${col},${row}`;
    if (!firstSeen.has(key)) firstSeen.set(key, timeMs);
    const grow = Math.min(1, (timeMs - (firstSeen.get(key) ?? timeMs)) / 400);
    out.push({
      zY: (row + 1) * T + 0.35,
      draw: (c, ox, oy, z) => {
        const x = ox + col * T * z;
        const bottom = oy + (row + 1) * T * z;
        c.save();
        // heated, scorched wall face
        const pulse = 0.22 + 0.08 * Math.sin(timeMs / 210 + col);
        c.fillStyle = `rgba(255, 110, 30, ${pulse.toFixed(3)})`;
        c.fillRect(x, bottom - 2 * T * z, T * z, 2 * T * z);
        c.fillStyle = 'rgba(40, 18, 10, 0.35)';
        c.fillRect(x, bottom - 2 * T * z, T * z, 6 * z);
        const img = getCachedSprite(wallFlameFor(col, row, timeMs), z);
        c.globalAlpha = 0.4 + 0.6 * grow;
        const h = img.height * (0.45 + 0.55 * grow);
        c.drawImage(img, Math.round(x), Math.round(bottom - h), img.width, h);
        c.restore();
      },
    });
  }
  return out;
}

/** Sliding doors (open, or stuck shut with sparks when an electrical hazard disabled them) and pull stations. */
export function fixtureDrawables(
  map: MapData,
  hazards: HazardSnapshot[],
  alarm: { active: boolean; stationId?: string } | undefined,
  timeMs: number,
  reducedMotion = false,
): ExtraDrawable[] {
  const out: ExtraDrawable[] = [];
  const ds = getDoorSprites();
  const disabled = new Set(hazards.filter((h) => h.kind === 'electrical').map((h) => h.componentId ?? ''));
  for (const d of map.components ?? []) {
    const shut = disabled.has(d.id);
    const minC = Math.min(...d.tiles.map((t) => t.col));
    const minR = Math.min(...d.tiles.map((t) => t.row));
    const maxR = Math.max(...d.tiles.map((t) => t.row));
    if (d.orientation === 'horizontal') {
      const sprite = shut ? ds.h.shut : ds.h.open;
      out.push({ zY: (minR + 1) * T, draw: (c, ox, oy, z) => blit(c, sprite, minC * T, (minR + 1) * T - sprite.length, ox, oy, z) });
    } else {
      const sprite = shut ? ds.v.shut : ds.v.open;
      out.push({ zY: (maxR + 1) * T, draw: (c, ox, oy, z) => blit(c, sprite, minC * T, (maxR + 1) * T - sprite.length, ox, oy, z) });
    }
    if (shut) {
      // flickering electric sparks + a small ⚡ over the stuck door
      const cx = (minC + (d.orientation === 'horizontal' ? 1 : 0.5)) * T;
      const cy = d.orientation === 'horizontal' ? minR * T + 2 : (minR + 1) * T;
      const bolt = getMiniBolt();
      out.push({
        zY: (maxR + 1) * T + 0.5,
        draw: (c, ox, oy, z) => {
          const f = Math.floor(timeMs / 70);
          c.save();
          for (let i = 0; i < 6; i++) {
            const h = Math.sin(f * 12.9898 + i * 78.233) * 43758.5453;
            const r = h - Math.floor(h);
            if (r < 0.45) continue;
            const ang = r * Math.PI * 2;
            const dist = 3 + r * 7;
            c.fillStyle = r > 0.8 ? '#ffffff' : r > 0.62 ? '#ffe65a' : '#7fd3ff';
            c.fillRect(ox + (cx + Math.cos(ang) * dist) * z, oy + (cy + Math.sin(ang) * dist * 0.7) * z, z, z);
          }
          if (Math.floor(timeMs / 400) % 2 === 0) blit(c, bolt, cx - 3, cy - 13, ox, oy, z);
          c.restore();
        },
      });
    }
  }
  const as = getAlarmSprites();
  for (const a of map.alarms ?? []) {
    const { col, row } = a.wall;
    const active = !!alarm?.active;
    const phase = Math.floor(timeMs / (reducedMotion ? 700 : 210)) % 3;
    const strobe = !active ? as.off : phase === 0 ? as.white : as.red;
    // Mounted on a vertical wall (wall continues below): sort after the wall tile beneath so the box stays visible.
    const wallBelow = row + 1 < map.rows && map.terrain[(row + 1) * map.cols + col] === 'wall';
    out.push({
      zY: (row + (wallBelow ? 2 : 1)) * T + 0.3,
      draw: (c, ox, oy, z) => {
        blit(c, as.box, col * T + 3, row * T - 4, ox, oy, z);
        blit(c, strobe, col * T + 4, row * T - 10, ox, oy, z);
        if (active) {
          const cx = ox + (col * T + 8) * z;
          const cy = oy + (row * T - 8) * z;
          const g = c.createRadialGradient(cx, cy, 0, cx, cy, 26 * z);
          g.addColorStop(0, `rgba(255, 40, 40, ${phase === 0 ? 0.45 : 0.25})`);
          g.addColorStop(1, 'rgba(255, 40, 40, 0)');
          c.save();
          c.fillStyle = g;
          c.fillRect(cx - 26 * z, cy - 26 * z, 52 * z, 52 * z);
          c.restore();
        }
      },
    });
  }
  return out;
}

/** The building's footprint in tiles: the bounding box of its walls (rooms, doorways and exits all lie inside). */
export function buildingBounds(map: MapData): { col: number; row: number; cols: number; rows: number } {
  let c0 = map.cols;
  let r0 = map.rows;
  let c1 = -1;
  let r1 = -1;
  for (let i = 0; i < map.terrain.length; i++) {
    if (map.terrain[i] !== 'wall') continue;
    const c = i % map.cols;
    const r = Math.floor(i / map.cols);
    c0 = Math.min(c0, c);
    c1 = Math.max(c1, c);
    r0 = Math.min(r0, r);
    r1 = Math.max(r1, r);
  }
  return { col: c0, row: r0, cols: c1 - c0 + 1, rows: r1 - r0 + 1 };
}

/** Red strobe over the building while the alarm is active (≤ 0.18 alpha; slow and soft with reduced motion). The
 *  rect is in canvas pixels; only pixels already drawn there are tinted (source-atop), so the wall tops above the
 *  first row flash with the building but the street and sidewalks outside it never do. */
export function drawAlarmStrobe(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }, timeMs: number, reducedMotion: boolean): void {
  const hz = reducedMotion ? 0.35 : 1.2;
  const wave = 0.5 + 0.5 * Math.sin((timeMs / 1000) * hz * Math.PI * 2);
  const a = reducedMotion ? 0.04 + 0.04 * wave : 0.03 + 0.15 * wave * wave;
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = `rgba(255, 24, 24, ${a.toFixed(3)})`;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

/** Placement preview drawn on top of the finished frame. */
export function drawGhost(
  ctx: CanvasRenderingContext2D,
  ghost: { kind: HazardKind; col: number; row: number; valid: boolean; tiles: Tile[] },
  ox: number,
  oy: number,
  zoom: number,
  timeMs: number,
): void {
  const s = T * zoom;
  ctx.save();
  if (ghost.kind === 'fire') {
    const fill = ghost.valid ? 'rgba(255, 150, 60, 0.28)' : 'rgba(240, 64, 64, 0.32)';
    // hint that fire spreads: dashed ring one tile around the seed
    ctx.setLineDash([3 * zoom, 2 * zoom]);
    ctx.strokeStyle = ghost.valid ? 'rgba(255, 140, 50, 0.8)' : 'rgba(240, 64, 64, 0.6)';
    ctx.lineWidth = Math.max(1, zoom);
    ctx.strokeRect(ox + (ghost.col - 1) * s + 0.5, oy + (ghost.row - 1) * s + 0.5, 4 * s - 1, 4 * s - 1);
    ctx.setLineDash([]);
    for (const t of ghost.tiles) {
      ctx.fillStyle = fill;
      ctx.fillRect(ox + t.col * s, oy + t.row * s, s, s);
    }
    ctx.strokeStyle = ghost.valid ? '#ff9a3a' : '#f04040';
    ctx.lineWidth = Math.max(2, zoom);
    ctx.strokeRect(ox + ghost.col * s + 1, oy + ghost.row * s + 1, 2 * s - 2, 2 * s - 2);
    const sprite = getFireFrames()[Math.floor(timeMs / 140) % 3];
    blit(ctx, sprite, ghost.col * T, (ghost.row + 2) * T - sprite.length, ox, oy, zoom, ghost.valid ? 0.8 : 0.4);
  } else {
    // electrical: highlight the snapped door's tiles (yellow) or the hovered tile (red)
    const pulse = 0.25 + 0.15 * Math.sin(timeMs / 160);
    for (const t of ghost.tiles) {
      ctx.fillStyle = ghost.valid ? `rgba(255, 214, 60, ${(pulse + 0.15).toFixed(3)})` : 'rgba(240, 64, 64, 0.35)';
      ctx.fillRect(ox + t.col * s, oy + t.row * s, s, s);
      ctx.strokeStyle = ghost.valid ? '#ffd23f' : '#f04040';
      ctx.lineWidth = Math.max(2, zoom);
      ctx.strokeRect(ox + t.col * s + 1, oy + t.row * s + 1, s - 2, s - 2);
    }
    const minC = Math.min(...ghost.tiles.map((t) => t.col));
    const minR = Math.min(...ghost.tiles.map((t) => t.row));
    const bolt = getBoltSprite();
    blit(ctx, bolt, minC * T - 8, minR * T - 30, ox, oy, zoom, ghost.valid ? 0.9 : 0.45);
  }
  ctx.restore();
}
