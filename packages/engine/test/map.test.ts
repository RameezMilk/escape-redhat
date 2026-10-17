import { describe, expect, it } from 'vitest';
import { ACTOR_IDS, type HazardSnapshot, type Tile, type ZoneId } from '@escape/contracts';
import { doorNear, fireFootprint, findPath, lineOfSight, tileIndex, validatePlacement } from '../src/index.js';
import { map } from './helpers.js';

const assemblyTiles = map.assembly.tiles;
const idxSet = (tiles: Tile[]) => new Set(tiles.map((t) => tileIndex(map, t.col, t.row)));
const door = (id: string) => map.components.find((c) => c.id === id)!;

describe('office-v1 map', () => {
  it('every spawn and activity spot reaches assembly (accessible mask for Daniel)', () => {
    for (const id of ACTOR_IDS) {
      for (const s of [...map.spawnSpots[id], ...map.activitySpots[id]]) {
        const p = findPath(map, s, assemblyTiles, { mask: id === 'daniel' ? 'accessible' : 'walkable' });
        expect(p, `${id} at (${s.col},${s.row})`).not.toBeNull();
      }
    }
  });

  it('doors A and B open onto different segments; 4 electric sliding doors and 3 pull stations', () => {
    const neighbours = (z: ZoneId) => map.zoneEdges.filter((e) => e.includes(z)).map((e) => (e[0] === z ? e[1] : e[0]));
    expect(neighbours('door_a').sort()).toEqual(['north_corridor', 'rh_room']);
    expect(neighbours('door_b').sort()).toEqual(['lobby', 'rh_room']);
    expect(map.components.map((c) => c.id).sort()).toEqual(['connector', 'door_a', 'door_b', 'south_door']);
    expect(map.alarms).toHaveLength(3);
    for (const a of map.alarms) expect(map.accessible[tileIndex(map, a.stand.col, a.stand.row)]).toBe(true);
  });

  it('hero fire + disabled south door still leaves the accessible connector route', () => {
    const blocked = idxSet([...fireFootprint(8, 5), ...door('south_door').tiles]);
    const fromRoom = findPath(map, { col: 15, row: 12 }, assemblyTiles, { mask: 'accessible', blocked });
    expect(fromRoom).not.toBeNull();
    const zones = new Set(fromRoom!.map((t) => map.zone[tileIndex(map, t.col, t.row)]));
    expect(zones.has('connector')).toBe(true);
    expect(zones.has('door_a')).toBe(false);
  });

  it('the deliberate 1-wide gap is walkable but not wheelchair-accessible', () => {
    const i = tileIndex(map, 8, 10);
    expect(map.walkable[i]).toBe(true);
    expect(map.accessible[i]).toBe(false);
  });

  it('electrical placement snaps to the nearest sliding door', () => {
    expect(doorNear(map, 26, 15)?.id).toBe('south_door');
    expect(doorNear(map, 18, 11)?.id).toBe('door_b');
    expect(doorNear(map, 27, 4)?.id).toBe('connector');
    expect(doorNear(map, 12, 12)).toBeNull();
    const actors = [{ col: 22, row: 8 }];
    const v = validatePlacement(map, { hazards: [], actors }, 'electrical', 26, 15);
    expect(v).toMatchObject({ ok: true, componentId: 'south_door' });
    expect(v.ok && v.tiles.map((t) => [t.col, t.row])).toEqual([
      [26, 14],
      [27, 14],
    ]);
  });

  it('placement rejects walls, furniture, outside/exits/assembly, occupied tiles, non-doors and overlaps', () => {
    const actors = [{ col: 13, row: 7 }];
    const v = (k: 'fire' | 'electrical', c: number, r: number, hz: HazardSnapshot[] = [], who = actors) => validatePlacement(map, { hazards: hz, actors: who }, k, c, r);
    expect(v('fire', 3, 4)).toMatchObject({ ok: false, code: 'NOT_FLOOR' });
    expect(v('fire', 9, 9)).toMatchObject({ ok: false, code: 'FURNITURE' });
    expect(v('fire', 26, 17)).toMatchObject({ ok: false, code: 'EXIT_OR_ASSEMBLY' });
    expect(v('fire', 20, 15)).toMatchObject({ ok: false, code: 'NOT_PLACEABLE_ZONE' });
    expect(v('fire', 14, 20)).toMatchObject({ ok: false, code: 'EXIT_OR_ASSEMBLY' });
    expect(v('fire', 0, 8)).toMatchObject({ ok: false, code: 'NOT_PLACEABLE_ZONE' });
    expect(v('fire', 13, 7)).toMatchObject({ ok: false, code: 'OCCUPIED' });
    expect(v('fire', 11, 7).ok).toBe(true); // right next to a person is allowed — fire spreads
    expect(v('fire', -1, 0)).toMatchObject({ ok: false, code: 'OUT_OF_BOUNDS' });
    expect(v('electrical', 5, 8)).toMatchObject({ ok: false, code: 'NOT_A_DOOR' });
    expect(v('electrical', 18, 9, [], [{ col: 18, row: 10 }])).toMatchObject({ ok: false, code: 'OCCUPIED' });
    const fire: HazardSnapshot = { id: 'H1', kind: 'fire', col: 8, row: 5, cells: fireFootprint(8, 5), charred: [], noGo: fireFootprint(8, 5), placedAtSimTime: 0 };
    expect(v('fire', 9, 6, [fire])).toMatchObject({ ok: false, code: 'OVERLAP' });
    expect(v('fire', 20, 10, [fire]).ok).toBe(true); // multiple fires allowed
    const doorB: HazardSnapshot = { id: 'H2', kind: 'electrical', col: 18, row: 9, cells: door('door_b').tiles, charred: [], noGo: door('door_b').tiles, componentId: 'door_b', placedAtSimTime: 0 };
    expect(v('electrical', 18, 10, [doorB])).toMatchObject({ ok: false, code: 'ALREADY_DISABLED' });
  });

  it('a disabled (closed) door blocks line of sight', () => {
    const opaque = idxSet(door('door_b').tiles);
    expect(lineOfSight(map, { col: 21, row: 9 }, { col: 15, row: 9 })).toBe(true);
    expect(lineOfSight(map, { col: 21, row: 9 }, { col: 15, row: 9 }, opaque)).toBe(false);
  });
});
