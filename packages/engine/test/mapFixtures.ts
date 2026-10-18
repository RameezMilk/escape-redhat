// Map lookups for tests: tests name a zone, door or pull station and these resolve the tiles from the current map, so
// a layout change does not mean hunting raw coordinates through every test.
import { ACTOR_IDS, type ScenarioCase, type Tile, type ZoneId } from '@escape/contracts';
import { fireFootprint, isFlammable, placesFor, tileDistance, tileIndex, validatePlacement, zoneTiles } from '../src/index.js';
import { map } from './helpers.js';

const zoneDef = (zone: ZoneId) => {
  const z = map.zones.find((d) => d.id === zone);
  if (!z) throw new Error(`no zone ${zone} on ${map.id}`);
  return z;
};

/** The zone's representative (walkable) tile. */
export const anchor = (zone: ZoneId): Tile => ({ ...zoneDef(zone).anchor });
export const tilesOf = (zone: ZoneId): Tile[] => zoneTiles(map, zone);

/** An electric sliding door by id. */
export function door(id: string) {
  const d = map.components.find((c) => c.id === id);
  if (!d) throw new Error(`no door ${id} on ${map.id}`);
  return d;
}

/** A pull station by id (default: the first one). */
export function station(id?: string) {
  const s = id ? map.alarms.find((a) => a.id === id) : map.alarms[0];
  if (!s) throw new Error(`no pull station ${id ?? ''} on ${map.id}`);
  return s;
}

/**
 * A valid 2×2 fire seed (top-left tile) with every footprint tile in `zone`, on an empty office. Picks the seed
 * closest to `near` (default: the zone anchor) whose footprint stays at least `minDist` tiles from each of `awayFrom`.
 */
export function fireSeed(zone: ZoneId, opts: { near?: Tile; awayFrom?: Tile[]; minDist?: number } = {}): Tile {
  const near = opts.near ?? anchor(zone);
  const empty = { hazards: [], actors: [] };
  const seeds: Tile[] = [];
  for (const t of tilesOf(zone)) {
    const fp = fireFootprint(t.col, t.row);
    if (!fp.every((f) => map.zone[tileIndex(map, f.col, f.row)] === zone)) continue;
    if (!validatePlacement(map, empty, 'fire', t.col, t.row).ok) continue;
    if (opts.awayFrom?.some((a) => fp.some((f) => tileDistance(f, a) < (opts.minDist ?? 3)))) continue;
    seeds.push(t);
  }
  if (!seeds.length) throw new Error(`no fire seed in ${zone}`);
  return seeds.sort((a, b) => tileDistance(a, near) - tileDistance(b, near) || a.row - b.row || a.col - b.col)[0];
}

/** Everyone standing safely outside: walkable outdoor tiles at least 4 tiles from anything that can burn (beyond the
 *  3-tile smoke radius, so nobody notices or reacts to the fire), nearest the check-in point first. */
export function outsideSpawns(): ScenarioCase['spawns'] {
  const p = placesFor(map);
  const burnable: Tile[] = [];
  for (let r = 0; r < map.rows; r++) for (let c = 0; c < map.cols; c++) if (isFlammable(map, c, r)) burnable.push({ col: c, row: r });
  const outside = map.zones.filter((z) => z.kind === 'outdoor').flatMap((z) => tilesOf(z.id));
  const spots = outside
    .filter((t) => map.accessible[tileIndex(map, t.col, t.row)] && p.isNonFlammable(map.zone[tileIndex(map, t.col, t.row)]))
    .filter((t) => burnable.every((b) => tileDistance(t, b) >= 4))
    .sort((a, b) => tileDistance(a, map.assembly.checkInPoint) - tileDistance(b, map.assembly.checkInPoint) || a.row - b.row || a.col - b.col);
  return Object.fromEntries(ACTOR_IDS.map((id, i) => [id, { ...spots[i], dir: 'down', pose: 'stand' }])) as ScenarioCase['spawns'];
}
