import { describe, expect, it } from 'vitest';
import { ACTOR_IDS, ACTOR_PROFILES, type HazardSnapshot, type Tile, type ZoneId } from '@escape/contracts';
import { doorNear, fireFootprint, findPath, lineOfSight, tileIndex, validatePlacement } from '../src/index.js';
import { sealableRooms } from '../../../data/maps/builder.js';
import { map } from './helpers.js';
import { door, station } from './mapFixtures.js';

const assemblyTiles = map.assembly.tiles;
const idxSet = (tiles: Tile[]) => new Set(tiles.map((t) => tileIndex(map, t.col, t.row)));
const zoneAt = (t: Tile) => map.zone[tileIndex(map, t.col, t.row)];

describe('office-v2 map (ground floor)', () => {
  it('every spawn and activity spot reaches the assembly point (accessible mask for wheelchair users)', () => {
    for (const id of ACTOR_IDS) {
      for (const s of [...map.spawnSpots[id], ...map.activitySpots[id]]) {
        const p = findPath(map, s, assemblyTiles, { mask: ACTOR_PROFILES[id].usesWheelchair ? 'accessible' : 'walkable' });
        expect(p, `${id} at (${s.col},${s.row})`).not.toBeNull();
      }
    }
  });

  it('six rooms joined by seven electric sliding doors; three manual exits; two pull stations', () => {
    const neighbours = (z: ZoneId) => map.zoneEdges.filter((e) => e.includes(z)).map((e) => (e[0] === z ? e[1] : e[0])).sort();
    expect(neighbours('rh_door')).toEqual(['hallway', 'rh_room']);
    expect(neighbours('pantry_door')).toEqual(['kitchen', 'rh_room']);
    expect(neighbours('side_door')).toEqual(['cubicles', 'reception']);
    expect(neighbours('server_room')).toEqual(['server_door']);
    expect(neighbours('main_entrance')).toEqual(['reception', 'sidewalk']);
    expect(map.components.map((c) => c.id).sort()).toEqual(['cubicles_door', 'kitchen_door', 'pantry_door', 'reception_door', 'rh_door', 'server_door', 'side_door']);
    expect(map.exits.map((e) => e.id)).toEqual(['west_exit', 'back_exit', 'main_entrance']);
    expect(map.alarms.map((a) => [a.id, a.zone])).toEqual([
      ['alarm_hallway', 'hallway'],
      ['alarm_reception', 'reception'],
    ]);
    for (const a of map.alarms) expect(map.accessible[tileIndex(map, a.stand.col, a.stand.row)]).toBe(true);
    expect(sealableRooms(map)).toEqual(['server_room', 'rh_room', 'cubicles']);
  });

  it('outside: the road is walkable only at the crosswalk, and the assembly point is across it', () => {
    expect(map.walkable[tileIndex(map, 10, 23)]).toBe(false); // road
    expect(map.zone[tileIndex(map, 10, 23)]).toBeNull();
    expect(zoneAt({ col: 31, row: 23 })).toBe('crosswalk');
    const p = findPath(map, { col: 31, row: 20 }, assemblyTiles, { mask: 'accessible' })!;
    expect(p.every((t) => zoneAt(t) !== null)).toBe(true);
    expect(p.some((t) => zoneAt(t) === 'crosswalk')).toBe(true);
  });

  it('hero story: fire in the cubicles + a dead reception door still leaves Daniel an accessible route', () => {
    const blocked = idxSet([...fireFootprint(10, 17), ...door('reception_door').tiles]);
    const route = findPath(map, map.spawnSpots.daniel[0], assemblyTiles, { mask: 'accessible', blocked });
    expect(route).not.toBeNull();
    const zones = new Set(route!.map(zoneAt));
    expect(zones.has('reception_door')).toBe(false);
    expect(zones.has('rh_door')).toBe(true);
  });

  it('the deliberate 1-wide aisle in the server room is walkable but not wheelchair-accessible', () => {
    const i = tileIndex(map, 9, 5);
    expect(map.walkable[i]).toBe(true);
    expect(map.accessible[i]).toBe(false);
  });

  it('electrical placement snaps to the nearest sliding door', () => {
    expect(doorNear(map, 31, 13)?.id).toBe('reception_door');
    expect(doorNear(map, 23, 17)?.id).toBe('side_door');
    expect(doorNear(map, 28, 2)?.id).toBe('pantry_door');
    expect(doorNear(map, 12, 12)).toBeNull();
    const v = validatePlacement(map, { hazards: [], actors: [{ col: 20, row: 15 }] }, 'electrical', 31, 13);
    expect(v).toMatchObject({ ok: true, componentId: 'reception_door' });
    expect(v.ok && v.tiles.map((t) => [t.col, t.row])).toEqual([
      [31, 12],
      [32, 12],
    ]);
  });

  it('placement rejects walls, furniture, outside/road/exits/assembly, occupied tiles, non-doors and overlaps', () => {
    const actors = [{ col: 16, row: 6 }];
    const v = (k: 'fire' | 'electrical', c: number, r: number, hz: HazardSnapshot[] = [], who = actors) => validatePlacement(map, { hazards: hz, actors: who }, k, c, r);
    expect(v('fire', 13, 4)).toMatchObject({ ok: false, code: 'NOT_FLOOR' });
    expect(v('fire', 19, 3)).toMatchObject({ ok: false, code: 'FURNITURE' }); // conference table
    expect(v('fire', 30, 19)).toMatchObject({ ok: false, code: 'EXIT_OR_ASSEMBLY' }); // main entrance
    expect(v('fire', 29, 26)).toMatchObject({ ok: false, code: 'EXIT_OR_ASSEMBLY' }); // bus stop
    expect(v('fire', 0, 8)).toMatchObject({ ok: false, code: 'NOT_PLACEABLE_ZONE' }); // sidewalk
    expect(v('fire', 5, 23)).toMatchObject({ ok: false, code: 'NOT_PLACEABLE_ZONE' }); // road
    expect(v('fire', 16, 6)).toMatchObject({ ok: false, code: 'OCCUPIED' });
    expect(v('fire', 14, 6).ok).toBe(true); // right next to a person is allowed — fire spreads
    expect(v('fire', -1, 0)).toMatchObject({ ok: false, code: 'OUT_OF_BOUNDS' });
    expect(v('electrical', 16, 6)).toMatchObject({ ok: false, code: 'NOT_A_DOOR' });
    expect(v('electrical', 20, 8, [], [{ col: 21, row: 8 }])).toMatchObject({ ok: false, code: 'OCCUPIED' });
    const fire: HazardSnapshot = { id: 'H1', kind: 'fire', col: 15, row: 5, cells: fireFootprint(15, 5), charred: [], noGo: fireFootprint(15, 5), placedAtSimTime: 0 };
    expect(v('fire', 16, 6, [fire], [])).toMatchObject({ ok: false, code: 'OVERLAP' });
    expect(v('fire', 30, 15, [fire]).ok).toBe(true); // multiple fires allowed
    const dead: HazardSnapshot = { id: 'H2', kind: 'electrical', col: 20, row: 8, cells: door('rh_door').tiles, charred: [], noGo: door('rh_door').tiles, componentId: 'rh_door', placedAtSimTime: 0 };
    expect(v('electrical', 21, 8, [dead])).toMatchObject({ ok: false, code: 'ALREADY_DISABLED' });
  });

  it('a disabled (closed) door blocks line of sight', () => {
    const opaque = idxSet(door('rh_door').tiles);
    expect(lineOfSight(map, { col: 20, row: 10 }, { col: 20, row: 6 })).toBe(true);
    expect(lineOfSight(map, { col: 20, row: 10 }, { col: 20, row: 6 }, opaque)).toBe(false);
  });

  it('pull stations sit on a wall next to their stand', () => {
    for (const id of ['alarm_hallway', 'alarm_reception']) {
      const s = station(id);
      expect(map.terrain[tileIndex(map, s.wall.col, s.wall.row)]).toBe('wall');
      expect(Math.abs(s.wall.col - s.stand.col) + Math.abs(s.wall.row - s.stand.row)).toBe(1);
    }
  });
});
