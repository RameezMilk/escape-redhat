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
import { getBlockerSprite, getFireFrames } from './sprites/hazards';
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
        out.push({ zY: (row + 1) * T + 0.25, draw: (c, ox, oy, z) => blit(c, d.redhat, col * T - 4, row * T - 9, ox, oy, z) });
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

export function hazardDrawables(hazards: HazardSnapshot[], timeMs: number): ExtraDrawable[] {
  const out: ExtraDrawable[] = [];
  for (const h of hazards) {
    const foot = new Set(h.tiles.map((t) => `${t.col},${t.row}`));
    // Danger tint on the no-go area (under walls/furniture/characters)
    out.push({
      zY: -400,
      draw: (c, ox, oy, z) => {
        const s = T * z;
        c.save();
        if (h.kind === 'fire') {
          const pulse = 0.18 + 0.06 * Math.sin(timeMs / 260);
          for (const t of h.noGo) {
            c.fillStyle = foot.has(`${t.col},${t.row}`) ? `rgba(120, 20, 10, 0.35)` : `rgba(255, 96, 32, ${pulse.toFixed(3)})`;
            c.fillRect(ox + t.col * s, oy + t.row * s, s, s);
          }
          const cx = ox + (h.col + h.w / 2) * s;
          const cy = oy + (h.row + h.h / 2) * s;
          const g = c.createRadialGradient(cx, cy, s * 0.4, cx, cy, s * 3.2);
          g.addColorStop(0, 'rgba(255, 170, 60, 0.28)');
          g.addColorStop(1, 'rgba(255, 120, 40, 0)');
          c.fillStyle = g;
          c.fillRect(cx - s * 3.2, cy - s * 3.2, s * 6.4, s * 6.4);
        } else {
          for (const t of h.tiles) {
            c.fillStyle = 'rgba(242, 194, 48, 0.18)';
            c.fillRect(ox + t.col * s, oy + t.row * s, s, s);
          }
        }
        c.restore();
      },
    });
    const sprite = h.kind === 'fire' ? getFireFrames()[Math.floor(timeMs / 140) % 3] : getBlockerSprite();
    out.push({
      zY: (h.row + h.h) * T - 0.25,
      draw: (c, ox, oy, z) => blit(c, sprite, h.col * T, (h.row + h.h) * T - sprite.length, ox, oy, z),
    });
  }
  return out;
}

/** Placement preview drawn on top of the finished frame. */
export function drawGhost(
  ctx: CanvasRenderingContext2D,
  ghost: { kind: HazardKind; col: number; row: number; valid: boolean; tiles: Tile[]; noGo: Tile[] },
  ox: number,
  oy: number,
  zoom: number,
  timeMs: number,
): void {
  const s = T * zoom;
  ctx.save();
  const fill = ghost.valid ? 'rgba(64, 214, 120, 0.28)' : 'rgba(240, 64, 64, 0.32)';
  const stroke = ghost.valid ? '#40d678' : '#f04040';
  if (ghost.kind === 'fire') {
    ctx.setLineDash([3 * zoom, 2 * zoom]);
    ctx.strokeStyle = ghost.valid ? 'rgba(255, 140, 50, 0.9)' : 'rgba(240, 64, 64, 0.7)';
    ctx.lineWidth = Math.max(1, zoom);
    const minC = Math.min(...ghost.noGo.map((t) => t.col));
    const minR = Math.min(...ghost.noGo.map((t) => t.row));
    const maxC = Math.max(...ghost.noGo.map((t) => t.col));
    const maxR = Math.max(...ghost.noGo.map((t) => t.row));
    ctx.strokeRect(ox + minC * s + 0.5, oy + minR * s + 0.5, (maxC - minC + 1) * s - 1, (maxR - minR + 1) * s - 1);
    ctx.setLineDash([]);
  }
  for (const t of ghost.tiles) {
    ctx.fillStyle = fill;
    ctx.fillRect(ox + t.col * s, oy + t.row * s, s, s);
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(2, zoom);
  ctx.strokeRect(ox + ghost.col * s + 1, oy + ghost.row * s + 1, 2 * s - 2, 2 * s - 2);
  const sprite = ghost.kind === 'fire' ? getFireFrames()[Math.floor(timeMs / 140) % 3] : getBlockerSprite();
  blit(ctx, sprite, ghost.col * T, (ghost.row + 2) * T - sprite.length, ox, oy, zoom, ghost.valid ? 0.75 : 0.4);
  ctx.restore();
}
