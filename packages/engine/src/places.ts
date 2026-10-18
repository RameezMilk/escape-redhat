// Human-readable place, door, pull-station and hazard names for every user-facing text (summaries, errors, debrief).
// Raw zone ids (rh_room, south_branch …) and evidence ids (E1, E2 …) never appear in these strings. The names come
// from the map (ZoneDef.name/at, DoorComponent.name, AlarmStation.name); placesFor(map) builds the lookups once.
import { ACTOR_IDS, ACTOR_PROFILES, type ActorId, type HazardKind, type MapData, type Tile, type ZoneDef, type ZoneId } from '@escape/contracts';
import { inBounds, loadMap, tileIndex } from './map.js';

export interface Places {
  /** Noun phrase for a zone: "the Red Hat room", "door A", "outside"; unknown → "the building". */
  placeName(zone: ZoneId | string | null | undefined): string;
  /** Locative phrase: "in the Red Hat room", "at door A", "outside"; unknown → "in the building". */
  atPlace(zone: ZoneId | string | null | undefined): string;
  /** Noun phrase without a leading "the": "Red Hat room", "door A". Unknown zones → the id with spaces. */
  shortName(zone: string): string;
  isZone(id: string): id is ZoneId;
  /** Sliding-door name: "door A", "the south door"; unknown → "a sliding door". */
  doorName(componentId: string | null | undefined): string;
  /** Pull-station name for a station id; 'alarm' (nearest) or unknown → the only station, or "the nearest fire alarm". */
  stationName(stationId?: string | null): string;
  /** Any pull station, for general advice: the only station's name, or "a fire alarm" when there are several. */
  readonly anyStationName: string;
  /** Destination argument → words: zones by place name, people by name, alarm destinations by station name. */
  destinationName(dest: string): string;
  /** Outdoor zones: once someone has evacuated to one of these during an incident, they never go back inside. */
  isOutside(zone: ZoneId | null | undefined): boolean;
  isExit(zone: ZoneId | null | undefined): boolean;
  isAssembly(zone: ZoneId | null | undefined): boolean;
  /** Exits, outdoors and the assembly point never burn. */
  isNonFlammable(zone: ZoneId | null | undefined): boolean;
  readonly outsideZones: readonly ZoneId[];
  readonly nonFlammableZones: readonly ZoneId[];
  /** Code-like ids (zone/door/station ids with an underscore) that viewer text must never show. */
  readonly idPattern: string;
}

const cache = new WeakMap<MapData, Places>();
const isActor = (x: unknown): x is ActorId => typeof x === 'string' && (ACTOR_IDS as readonly string[]).includes(x);
const OUTSIDE_KINDS: ReadonlySet<ZoneDef['kind']> = new Set(['outdoor', 'assembly']);
const NON_FLAMMABLE_KINDS: ReadonlySet<ZoneDef['kind']> = new Set(['exit', 'outdoor', 'assembly']);

export function placesFor(map: MapData): Places {
  const hit = cache.get(map);
  if (hit) return hit;
  const zones = new Map<string, ZoneDef>(map.zones.map((z) => [z.id, z]));
  const doors = new Map((map.components ?? []).map((d) => [d.id, d.name]));
  const stations = new Map((map.alarms ?? []).map((a) => [a.id, a.name]));
  const kindOf = (z: ZoneId | null | undefined) => (z ? zones.get(z)?.kind : undefined);
  const outsideZones = map.zones.filter((z) => OUTSIDE_KINDS.has(z.kind)).map((z) => z.id);
  const nonFlammableZones = map.zones.filter((z) => NON_FLAMMABLE_KINDS.has(z.kind)).map((z) => z.id);
  const ids = [...zones.keys(), ...doors.keys(), ...stations.keys()].filter((k) => k.includes('_'));
  const p: Places = {
    placeName: (z) => (z && zones.get(z)?.name) || 'the building',
    atPlace: (z) => (z && zones.get(z)?.at) || 'in the building',
    shortName: (z) => {
      const name = zones.get(z)?.name;
      return name ? name.replace(/^the /, '') : z.replace(/_/g, ' ');
    },
    isZone: (id): id is ZoneId => zones.has(id),
    doorName: (id) => (id && doors.get(id)) || 'a sliding door',
    stationName: (id) => {
      const named = id ? stations.get(id) : undefined;
      if (named) return named;
      return stations.size === 1 ? [...stations.values()][0] : 'the nearest fire alarm';
    },
    anyStationName: stations.size === 1 ? [...stations.values()][0] : 'a fire alarm',
    destinationName: (dest) => {
      if (dest === 'alarm' || stations.has(dest) || dest.startsWith('alarm_')) return p.stationName(dest);
      if (isActor(dest)) return ACTOR_PROFILES[dest].name;
      if (zones.has(dest)) return p.placeName(dest);
      return 'there';
    },
    isOutside: (z) => OUTSIDE_KINDS.has(kindOf(z)!),
    isExit: (z) => kindOf(z) === 'exit',
    isAssembly: (z) => kindOf(z) === 'assembly',
    isNonFlammable: (z) => NON_FLAMMABLE_KINDS.has(kindOf(z)!),
    outsideZones,
    nonFlammableZones,
    idPattern: ids.length ? `\\b(?:${ids.sort((a, b) => b.length - a.length).join('|')})\\b` : '(?!)',
  };
  cache.set(map, p);
  return p;
}

/** Places of the current map (data/maps/<DEFAULT_MAP_ID>.json). */
const here = (): Places => placesFor(loadMap());

/** Noun phrase for a zone: "the Red Hat room", "door A", "outside". */
export const placeName = (zone: ZoneId | null | undefined): string => here().placeName(zone);
/** Locative phrase for a zone: "in the Red Hat room", "at door A", "outside". */
export const atPlace = (zone: ZoneId | null | undefined): string => here().atPlace(zone);
/** Short sliding-door name: "door A", "the south door". */
export const doorName = (componentId: string | null | undefined): string => here().doorName(componentId);
/** Pull-station name: "the hallway fire alarm". */
export const stationName = (stationId?: string | null): string => here().stationName(stationId);
/** Any pull station, for general advice: the only station's name, or "a fire alarm". */
export const anyStationName = (): string => here().anyStationName;
/** Destination argument → words: zones by place name, people by name, alarm destinations by station name. */
export const destinationName = (dest: string): string => here().destinationName(dest);
/** Outdoor zones: once someone has evacuated to one of these during an incident, they never go back inside. */
export const isOutsideZone = (z: ZoneId | null | undefined): boolean => here().isOutside(z);

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

export const placeNameAt = (map: MapData, t: Tile): string => placesFor(map).placeName(zoneNear(map, t.col, t.row));

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
