// Human-readable place, door and hazard names for every user-facing text (summaries, errors, debrief).
// Raw zone ids (rh_room, south_branch …) and evidence ids (E1, E2 …) never appear in these strings.
import { ACTOR_IDS, ACTOR_PROFILES, type ActorId, type HazardKind, type MapData, type Tile, type ZoneId } from '@escape/contracts';
import { inBounds, tileIndex } from './map.js';

const PLACES: Record<ZoneId, { name: string; at: string }> = {
  rh_room: { name: 'the Red Hat room', at: 'in the Red Hat room' },
  door_a: { name: 'door A', at: 'at door A' },
  door_b: { name: 'door B', at: 'at door B' },
  north_corridor: { name: 'the north hallway', at: 'in the north hallway' },
  connector: { name: 'the lobby connector', at: 'in the lobby connector' },
  lobby: { name: 'the NVIDIA lobby', at: 'in the NVIDIA lobby' },
  south_branch: { name: 'the south corridor', at: 'in the south corridor' },
  west_exit: { name: 'the west exit', at: 'at the west exit' },
  east_exit: { name: 'the east exit', at: 'at the east exit' },
  west_sidewalk: { name: 'outside', at: 'outside' },
  plaza: { name: 'outside', at: 'outside' },
  assembly: { name: 'the assembly point', at: 'at the assembly point' },
};

/** Outdoor zones: once someone has evacuated to one of these during an incident, they never go back inside. */
export const OUTSIDE_ZONES: readonly ZoneId[] = ['west_sidewalk', 'plaza', 'assembly'];
export const isOutsideZone = (z: ZoneId | null | undefined): boolean => !!z && OUTSIDE_ZONES.includes(z);

/** Noun phrase for a zone: "the Red Hat room", "door A", "outside". */
export function placeName(zone: ZoneId | null | undefined): string {
  return (zone && PLACES[zone]?.name) || 'the building';
}

/** Locative phrase for a zone: "in the Red Hat room", "at door A", "outside". */
export function atPlace(zone: ZoneId | null | undefined): string {
  return (zone && PLACES[zone]?.at) || 'in the building';
}

/** Zone of a tile; for walls (no zone) the first adjacent zone, so burning walls get a sensible place. */
export function zoneNear(map: MapData, col: number, row: number): ZoneId | null {
  if (!inBounds(map, col, row)) return null;
  const own = map.zone[tileIndex(map, col, row)];
  if (own) return own;
  for (const [dc, dr] of [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    const c = col + dc;
    const r = row + dr;
    if (!inBounds(map, c, r)) continue;
    const z = map.zone[tileIndex(map, c, r)];
    if (z) return z;
  }
  return null;
}

export const placeNameAt = (map: MapData, t: Tile): string => placeName(zoneNear(map, t.col, t.row));

const DOORS: Record<string, string> = {
  door_a: 'door A',
  door_b: 'door B',
  connector: 'the lobby connector door',
  south_door: 'the south door',
};

/** Short sliding-door name: "door A", "the south door". */
export function doorName(componentId: string | null | undefined): string {
  return (componentId && DOORS[componentId]) || 'a sliding door';
}

/** The single hallway pull station. */
export const ALARM_NAME = 'the hallway fire alarm';

const isActor = (x: unknown): x is ActorId => typeof x === 'string' && (ACTOR_IDS as readonly string[]).includes(x);

/** Destination argument → words: zones by place name, people by name, alarm destinations as the hallway alarm. */
export function destinationName(dest: string): string {
  if (dest === 'alarm' || dest.startsWith('alarm_')) return ALARM_NAME;
  if (isActor(dest)) return ACTOR_PROFILES[dest].name;
  if (dest in PLACES) return placeName(dest as ZoneId);
  return 'there';
}

/** "the fire in the Red Hat room" / "the dead south door" — never an evidence id. */
export function describeHazard(h: { kind: HazardKind | string; zone?: ZoneId | null; component?: string | null; componentId?: string | null }): string {
  if (h.kind === 'electrical') {
    const d = doorName(h.component ?? h.componentId);
    return `the dead ${d.replace(/^the /, '')}`;
  }
  return h.zone ? `the fire ${atPlace(h.zone)}` : 'the fire';
}
export const describeEvidence = describeHazard;

/** Join names: "Maya", "Maya and Daniel", "Alex, Maya and Daniel". */
export function joinNames(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export const capitalize = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
