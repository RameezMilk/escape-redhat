import type { DoorComponent, HazardKind, HazardSnapshot, MapData, PlacementCode, Tile, ZoneId } from '@escape/contracts';
import { inBounds, loadMap, tileIndex } from './map.js';
import { placesFor } from './places.js';

export type { PlacementCode } from '@escape/contracts';

/** Fire: 2×2 seed, seen within 9 tiles. Electrical: a disabled sliding door, seen within 5 tiles. */
export const HAZARD_SPECS = {
  fire: { w: 2, h: 2, visibility: 9, label: 'Fire' },
  electrical: { visibility: 5, label: 'Electrical failure' },
} as const satisfies Record<HazardKind, { visibility: number; label: string; w?: number; h?: number }>;

/** Zones of the current map where fire never ignites (exits, outdoors, the assembly point — by ZoneDef.kind). */
export const NON_FLAMMABLE_ZONES: readonly ZoneId[] = placesFor(loadMap()).nonFlammableZones;

/** What can burn: interior floor (furniture-blocked floor included) and the building's walls (interior and
 *  perimeter; they catch slowly). Exits, outdoor tiles and void never burn. */
export function isFlammable(map: MapData, col: number, row: number): boolean {
  if (!inBounds(map, col, row)) return false;
  const i = tileIndex(map, col, row);
  if (map.terrain[i] === 'wall') return true;
  if (map.terrain[i] !== 'floor') return false;
  const z = map.zone[i];
  return !!z && !placesFor(map).isNonFlammable(z);
}

/** 2×2 fire seed footprint with (col,row) as top-left. */
export function fireFootprint(col: number, row: number): Tile[] {
  return [
    { col, row },
    { col: col + 1, row },
    { col, row: row + 1 },
    { col: col + 1, row: row + 1 },
  ];
}

/** The sliding door whose tiles include (col,row) or lie within 1 tile (Chebyshev) of it; nearest wins. */
export function doorNear(map: MapData, col: number, row: number): DoorComponent | null {
  let best: { d: DoorComponent; dist: number } | null = null;
  for (const d of map.components ?? []) {
    for (const t of d.tiles) {
      const dist = Math.max(Math.abs(t.col - col), Math.abs(t.row - row));
      if (dist <= 1 && (!best || dist < best.dist)) best = { d, dist };
    }
  }
  return best?.d ?? null;
}

const key = (t: Tile) => `${t.col},${t.row}`;

export type PlacementCheck = { ok: true; tiles: Tile[]; componentId?: string } | { ok: false; code: PlacementCode; reason: string };

/**
 * Validate a presenter placement (shared by the engine and the web ghost preview).
 * Fire: 2×2 seed at (col,row) on flammable interior floor, not on a person, not overlapping existing
 * burning/charred cells or a disabled door. Electrical: snaps to the sliding door under/near (col,row).
 * Any number of hazards may be placed.
 */
export function validatePlacement(
  map: MapData,
  state: { hazards: HazardSnapshot[]; actors: { col: number; row: number; lost?: boolean }[] },
  kind: HazardKind,
  col: number,
  row: number,
): PlacementCheck {
  const occupied = new Set(state.actors.filter((a) => !a.lost).map(key));
  const taken = new Set(state.hazards.flatMap((h) => h.noGo.map(key)));
  if (kind === 'electrical') {
    const door = doorNear(map, col, row);
    if (!door) return { ok: false, code: 'NOT_A_DOOR', reason: 'Drop the electrical failure on an electric sliding door.' };
    if (state.hazards.some((h) => h.kind === 'electrical' && h.componentId === door.id)) {
      return { ok: false, code: 'ALREADY_DISABLED', reason: `${door.label} is already disabled.` };
    }
    if (door.tiles.some((t) => occupied.has(key(t)))) return { ok: false, code: 'OCCUPIED', reason: 'Someone is standing in that doorway.' };
    if (door.tiles.some((t) => taken.has(key(t)))) return { ok: false, code: 'OVERLAP', reason: 'That doorway is already on fire.' };
    return { ok: true, tiles: door.tiles.map((t) => ({ ...t })), componentId: door.id };
  }
  const tiles = fireFootprint(col, row);
  if (!tiles.every((t) => inBounds(map, t.col, t.row))) return { ok: false, code: 'OUT_OF_BOUNDS', reason: 'Footprint extends outside the map.' };
  for (const t of tiles) {
    const i = tileIndex(map, t.col, t.row);
    const terrain = map.terrain[i];
    if (terrain !== 'floor' && terrain !== 'outdoor') return { ok: false, code: 'NOT_FLOOR', reason: 'Fire must start on open floor, not walls.' };
    if (terrain === 'outdoor' && !map.walkable[i]) return { ok: false, code: 'NOT_PLACEABLE_ZONE', reason: 'Fire can only be started inside the office.' };
    if (!map.walkable[i]) return { ok: false, code: 'FURNITURE', reason: 'That spot collides with furniture.' };
  }
  const places = placesFor(map);
  for (const t of tiles) {
    const z = map.zone[tileIndex(map, t.col, t.row)];
    if (places.isExit(z) || places.isAssembly(z)) return { ok: false, code: 'EXIT_OR_ASSEMBLY', reason: 'Exits and the assembly point cannot catch fire.' };
    const def = map.zones.find((d) => d.id === z);
    if (!def || !def.hazardPlaceable || !isFlammable(map, t.col, t.row)) {
      return { ok: false, code: 'NOT_PLACEABLE_ZONE', reason: 'Fire can only be started inside the office.' };
    }
  }
  if (tiles.some((t) => occupied.has(key(t)))) return { ok: false, code: 'OCCUPIED', reason: 'Someone is standing there.' };
  if (tiles.some((t) => taken.has(key(t)))) return { ok: false, code: 'OVERLAP', reason: 'Overlaps an existing fire or a disabled door.' };
  return { ok: true, tiles };
}
