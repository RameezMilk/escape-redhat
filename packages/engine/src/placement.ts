import type { HazardKind, HazardSnapshot, MapData, Tile } from '@escape/contracts';
import { inBounds, tileIndex } from './map.js';

export const HAZARD_SPECS: Record<HazardKind, { w: number; h: number; buffer: number; visibility: number; label: string }> = {
  fire: { w: 2, h: 2, buffer: 1, visibility: 8, label: 'Fire' },
  blocker: { w: 2, h: 2, buffer: 0, visibility: 4, label: 'Blocker (toppled cabinets)' },
};

export type PlacementCode =
  | 'OUT_OF_BOUNDS'
  | 'NOT_FLOOR'
  | 'FURNITURE'
  | 'EXIT_OR_ASSEMBLY'
  | 'OCCUPIED'
  | 'OVERLAP'
  | 'NOT_PLACEABLE_ZONE'
  | 'ALREADY_PLACED'
  | 'EPISODE_OVER';

export function hazardFootprint(kind: HazardKind, col: number, row: number): Tile[] {
  const { w, h } = HAZARD_SPECS[kind];
  const out: Tile[] = [];
  for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) out.push({ col: col + dc, row: row + dr });
  return out;
}

/** Footprint + buffer, clipped to the map. */
export function hazardNoGo(map: MapData, kind: HazardKind, col: number, row: number): Tile[] {
  const { w, h, buffer } = HAZARD_SPECS[kind];
  const out: Tile[] = [];
  for (let r = row - buffer; r < row + h + buffer; r++) {
    for (let c = col - buffer; c < col + w + buffer; c++) if (inBounds(map, c, r)) out.push({ col: c, row: r });
  }
  return out;
}

const key = (t: Tile) => `${t.col},${t.row}`;

export function validatePlacement(
  map: MapData,
  state: { hazards: HazardSnapshot[]; actors: { col: number; row: number }[] },
  kind: HazardKind,
  col: number,
  row: number,
): { ok: true; tiles: Tile[]; noGo: Tile[] } | { ok: false; code: PlacementCode; reason: string } {
  const tiles = hazardFootprint(kind, col, row);
  if (!tiles.every((t) => inBounds(map, t.col, t.row))) return { ok: false, code: 'OUT_OF_BOUNDS', reason: 'Footprint extends outside the map.' };
  if (state.hazards.some((h) => h.kind === kind)) {
    return { ok: false, code: 'ALREADY_PLACED', reason: `A ${kind} is already placed (one of each; pause to reposition, or reset).` };
  }
  for (const t of tiles) {
    const i = tileIndex(map, t.col, t.row);
    const terrain = map.terrain[i];
    if (terrain !== 'floor' && terrain !== 'outdoor') return { ok: false, code: 'NOT_FLOOR', reason: 'Hazards must be placed on open floor, not walls.' };
    if (!map.walkable[i]) return { ok: false, code: 'FURNITURE', reason: 'That spot collides with furniture.' };
  }
  for (const t of tiles) {
    const z = map.zone[tileIndex(map, t.col, t.row)];
    if (z === 'west_exit' || z === 'east_exit' || z === 'assembly') {
      return { ok: false, code: 'EXIT_OR_ASSEMBLY', reason: 'Exits and the assembly point cannot be covered.' };
    }
    const def = map.zones.find((d) => d.id === z);
    if (!def || !def.hazardPlaceable) return { ok: false, code: 'NOT_PLACEABLE_ZONE', reason: 'Hazards can only be placed inside the office.' };
  }
  const noGo = hazardNoGo(map, kind, col, row);
  const guard = new Set((kind === 'fire' ? noGo : tiles).map(key));
  if (state.actors.some((a) => guard.has(key(a)))) {
    return { ok: false, code: 'OCCUPIED', reason: kind === 'fire' ? 'Too close to a person (fire needs a clear 1-tile margin).' : 'Someone is standing there.' };
  }
  const mine = new Set(tiles.map(key));
  const myNoGo = new Set(noGo.map(key));
  for (const h of state.hazards) {
    if (h.noGo.some((t) => mine.has(key(t))) || h.tiles.some((t) => myNoGo.has(key(t)))) {
      return { ok: false, code: 'OVERLAP', reason: `Overlaps the ${h.kind}.` };
    }
  }
  return { ok: true, tiles, noGo };
}
