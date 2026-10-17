import { describe, expect, it } from 'vitest';
import { ACTOR_IDS, type Tile, type ZoneId } from '@escape/contracts';
import { findPath, hazardNoGo, tileIndex, validatePlacement } from '../src/index.js';
import { map } from './helpers.js';

const exitsAndAssembly = map.assembly.tiles;
const noGoSet = (tiles: Tile[]) => new Set(tiles.map((t) => tileIndex(map, t.col, t.row)));

describe('office-v1 map', () => {
  it('every spawn and activity spot reaches assembly (accessible mask for Daniel)', () => {
    for (const id of ACTOR_IDS) {
      for (const s of [...map.spawnSpots[id], ...map.activitySpots[id]]) {
        const p = findPath(map, s, exitsAndAssembly, { mask: id === 'daniel' ? 'accessible' : 'walkable' });
        expect(p, `${id} at (${s.col},${s.row})`).not.toBeNull();
      }
    }
  });

  it('doors A and B open onto different segments', () => {
    const neighbours = (z: ZoneId) => map.zoneEdges.filter((e) => e.includes(z)).map((e) => (e[0] === z ? e[1] : e[0]));
    expect(neighbours('door_a').sort()).toEqual(['north_corridor', 'rh_room']);
    expect(neighbours('door_b').sort()).toEqual(['lobby', 'rh_room']);
  });

  it('hero fire + blocker still leaves the accessible connector route', () => {
    const blocked = noGoSet([...hazardNoGo(map, 'fire', 8, 5), ...hazardNoGo(map, 'blocker', 26, 15)]);
    const fromRoom = findPath(map, { col: 15, row: 12 }, exitsAndAssembly, { mask: 'accessible', blocked });
    expect(fromRoom).not.toBeNull();
    const zones = new Set(fromRoom!.map((t) => map.zone[tileIndex(map, t.col, t.row)]));
    expect(zones.has('connector')).toBe(true);
    expect(zones.has('south_branch')).toBe(false);
    expect(zones.has('door_a')).toBe(false);
  });

  it('the deliberate 1-wide gap is walkable but not wheelchair-accessible', () => {
    const i = tileIndex(map, 8, 10);
    expect(map.walkable[i]).toBe(true);
    expect(map.accessible[i]).toBe(false);
  });

  it('hero placements are valid with hero spawns', () => {
    const actors = [
      { col: 22, row: 8 },
      { col: 13, row: 7 },
      { col: 15, row: 12 },
    ];
    expect(validatePlacement(map, { hazards: [], actors }, 'fire', 8, 5).ok).toBe(true);
    expect(validatePlacement(map, { hazards: [], actors }, 'blocker', 26, 15).ok).toBe(true);
  });

  it('placement rejects walls, furniture, exits/assembly, occupied tiles and overlaps', () => {
    const actors = [{ col: 13, row: 7 }];
    const v = (k: 'fire' | 'blocker', c: number, r: number, hz = [] as never[]) => validatePlacement(map, { hazards: hz, actors }, k, c, r);
    expect(v('blocker', 3, 4)).toMatchObject({ ok: false, code: 'NOT_FLOOR' });
    expect(v('blocker', 9, 9)).toMatchObject({ ok: false, code: 'FURNITURE' });
    expect(v('blocker', 26, 17)).toMatchObject({ ok: false, code: 'EXIT_OR_ASSEMBLY' });
    expect(v('blocker', 20, 15)).toMatchObject({ ok: false, code: 'NOT_PLACEABLE_ZONE' });
    expect(v('blocker', 14, 20)).toMatchObject({ ok: false, code: 'EXIT_OR_ASSEMBLY' });
    expect(v('blocker', 0, 8)).toMatchObject({ ok: false, code: 'NOT_PLACEABLE_ZONE' });
    expect(v('blocker', 13, 7)).toMatchObject({ ok: false, code: 'OCCUPIED' });
    expect(v('fire', 14, 8)).toMatchObject({ ok: false, code: 'OCCUPIED' });
    expect(v('blocker', -1, 0)).toMatchObject({ ok: false, code: 'OUT_OF_BOUNDS' });
    const fire = { kind: 'fire' as const, col: 8, row: 5, w: 2, h: 2, tiles: [], noGo: hazardNoGo(map, 'fire', 8, 5), placedAtSimTime: 0 };
    expect(validatePlacement(map, { hazards: [fire], actors }, 'blocker', 10, 6)).toMatchObject({ ok: false, code: 'OVERLAP' });
    expect(validatePlacement(map, { hazards: [fire], actors }, 'fire', 20, 10)).toMatchObject({ ok: false, code: 'ALREADY_PLACED' });
  });
});
