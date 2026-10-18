// Fire measurement setups shared by fire.test.ts (which pins the bands) and scripts/measure-fire.ts (which prints the
// medians to re-pin them after a map or fire-tuning change). Everyone stands safely outside; ambient off.
import type { ScenarioCase, Tile, ZoneId } from '@escape/contracts';
import { tileIndex } from '../src/index.js';
import { Driver, hero, map } from './helpers.js';
import { outsideSpawns } from './mapFixtures.js';

/** Where each measurement starts, for the current map. */
export const FIRE_SITES: {
  /** Open floor in the largest room (growth bands). */
  growth: Tile;
  /** A seed and the two zones whose first ignition times are measured. */
  reach: { seed: Tile; first: ZoneId; second: ZoneId };
  /** A room sealed by disabling all its doors: how long walls/dead doors hold once fire touches them. */
  sealed: { room: ZoneId; doorTiles: Tile[]; seed: Tile; touch: (t: Tile) => boolean };
  /** Seeds right against a wall, and the zone on the far side that the fire should reach. */
  walls: { seed: Tile; far: ZoneId }[];
} = {
  growth: { col: 16, row: 16 }, // open floor in the cubicles
  reach: { seed: { col: 15, row: 5 }, first: 'hallway', second: 'kitchen' }, // in the Red Hat room, beside Daniel's seat
  // Burning floor right against the Red Hat room's south wall/door (row 7) or its east wall/pantry door (col 27).
  sealed: { room: 'rh_room', doorTiles: [{ col: 20, row: 8 }, { col: 28, row: 3 }], seed: { col: 16, row: 6 }, touch: (t) => t.row === 7 || t.col === 27 },
  walls: [
    { seed: { col: 26, row: 1 }, far: 'kitchen' }, // against the Red Hat room's east wall
    { seed: { col: 15, row: 6 }, far: 'hallway' }, // against its south wall
  ],
};

export const zoneOf = (t: Tile) => map.zone[tileIndex(map, t.col, t.row)];
export const terrainOf = (t: Tile) => map.terrain[tileIndex(map, t.col, t.row)];
export const outside = (seed = 7): ScenarioCase => ({ ...hero(), seed, spawns: outsideSpawns() });
export const fireCells = (d: Driver) => d.engine.snapshot().hazards.filter((h) => h.kind === 'fire').flatMap((h) => h.noGo);
/** Burning/charred FLOOR cells (walls burn too, but the growth bands are about floor). */
export const floorFire = (d: Driver) => fireCells(d).filter((t) => terrainOf(t) === 'floor');
export const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

/** Floor cells burning/charred at 20 s and 40 s, seeds 1..n. */
export function measureGrowth(n = 9): { at20: number[]; at40: number[] } {
  const at20: number[] = [];
  const at40: number[] = [];
  for (let seed = 1; seed <= n; seed++) {
    const d = new Driver(outside(seed), { ambient: false });
    if (!d.place('fire', FIRE_SITES.growth.col, FIRE_SITES.growth.row).ok) throw new Error('growth seed is not placeable');
    d.run(200);
    at20.push(floorFire(d).length);
    d.run(200);
    at40.push(floorFire(d).length);
  }
  return { at20, at40 };
}

/** Seconds until the fire first reaches each of the two reach zones (Infinity if not within 150 s), seeds 1..n. */
export function measureReach(n = 15): { first: number[]; second: number[] } {
  const first: number[] = [];
  const second: number[] = [];
  const { seed: s, first: z1, second: z2 } = FIRE_SITES.reach;
  for (let seed = 1; seed <= n; seed++) {
    const d = new Driver(outside(seed), { ambient: false });
    if (!d.place('fire', s.col, s.row).ok) throw new Error('reach seed is not placeable');
    let a = -1;
    let b = -1;
    for (let t = 1; t <= 1500 && (a < 0 || b < 0); t++) {
      d.run(1);
      const cells = fireCells(d);
      if (a < 0 && cells.some((c) => zoneOf(c) === z1)) a = t;
      if (b < 0 && cells.some((c) => zoneOf(c) === z2)) b = t;
    }
    first.push(a < 0 ? Infinity : a / 10);
    second.push(b < 0 ? Infinity : b / 10);
  }
  return { first, second };
}

/** With all the room's doors dead: how many seeds escape the room within 300 s, and the hold time after touching. */
export function measureSealed(n = 15): { escaped: number; delays: number[] } {
  const delays: number[] = [];
  let escaped = 0;
  const { room, doorTiles, seed: s, touch: touches } = FIRE_SITES.sealed;
  for (let seed = 1; seed <= n; seed++) {
    const d = new Driver(outside(seed), { ambient: false });
    for (const t of doorTiles) if (!d.place('electrical', t.col, t.row).ok) throw new Error('sealed door is not placeable');
    if (!d.place('fire', s.col, s.row).ok) throw new Error('sealed seed is not placeable');
    let touch = -1;
    let out = -1;
    for (let t = 1; t <= 3000 && out < 0; t++) {
      d.run(1);
      const cells = fireCells(d);
      if (touch < 0 && cells.some((c) => terrainOf(c) === 'floor' && touches(c))) touch = t;
      if (cells.some((c) => terrainOf(c) === 'floor' && zoneOf(c) !== room)) out = t;
    }
    if (out > 0) {
      escaped++;
      delays.push((out - touch) / 10);
    }
  }
  return { escaped, delays };
}

/** Seconds until the first wall tile ignites from each wall seed, and how many runs reach the far zone in 120 s. */
export function measureWalls(n = 21): { firstWall: number[]; nextRoom: number; runs: number } {
  const firstWall: number[] = [];
  let nextRoom = 0;
  let runs = 0;
  for (const { seed: s, far } of FIRE_SITES.walls) {
    for (let seed = 1; seed <= n; seed++) {
      runs++;
      const d = new Driver(outside(seed), { ambient: false });
      if (!d.place('fire', s.col, s.row).ok) throw new Error('wall seed is not placeable');
      let wall = -1;
      let reached = false;
      for (let t = 1; t <= 1200 && !(wall > 0 && reached); t++) {
        d.run(1);
        const cells = fireCells(d);
        if (wall < 0 && cells.some((c) => terrainOf(c) === 'wall')) wall = t;
        reached ||= cells.some((c) => zoneOf(c) === far);
      }
      if (wall > 0) firstWall.push(wall / 10);
      if (reached) nextRoom++;
    }
  }
  return { firstWall, nextRoom, runs };
}
