import { describe, expect, it } from 'vitest';
import { ACTOR_IDS, ACTOR_PROFILES, ALARM_STATION_IDS, ASSISTANCE, DEFAULT_MAP_ID, DOOR_IDS, TOOL_ARG_SCHEMAS, TOOL_DEFS, TOOL_NAMES, WARDEN_ID, ZONE_IDS } from '@escape/contracts';
import { loadMap } from '../src/index.js';

describe('tool contract parity', () => {
  it('every tool has a JSON schema and a zod validator with the same keys', () => {
    expect(TOOL_DEFS.map((t) => t.function.name).sort()).toEqual([...TOOL_NAMES].sort());
    for (const def of TOOL_DEFS) {
      const params = def.function.parameters as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
      const zodShape = (TOOL_ARG_SCHEMAS[def.function.name] as unknown as { shape: Record<string, unknown> }).shape;
      expect(Object.keys(params.properties).sort(), def.function.name).toEqual(Object.keys(zodShape).sort());
      expect(params.additionalProperties).toBe(false);
      for (const req of params.required) expect(zodShape).toHaveProperty(req);
    }
  });
});

describe('map-derived ids', () => {
  it('the generated zone, door and pull-station ids match the current map (run `npm run data:map` if not)', () => {
    const map = loadMap();
    expect(map.id).toBe(DEFAULT_MAP_ID);
    expect([...ZONE_IDS]).toEqual(map.zones.map((z) => z.id));
    expect([...DOOR_IDS]).toEqual(map.components.map((d) => d.id));
    expect([...ALARM_STATION_IDS]).toEqual(map.alarms.map((a) => a.id));
  });

  it('every zone, door and pull station has a human name', () => {
    const map = loadMap();
    for (const z of map.zones) expect(z.name && z.at, z.id).toBeTruthy();
    for (const d of map.components) expect(d.name, d.id).toBeTruthy();
    for (const a of map.alarms) expect(a.name, a.id).toBeTruthy();
  });
});

describe('actor profiles', () => {
  it('exactly one warden; the assistance arrangement names two different people; ids never clash with zones', () => {
    expect(ACTOR_IDS.filter((id) => ACTOR_PROFILES[id].warden)).toEqual([WARDEN_ID]);
    expect(ACTOR_IDS).toContain(ASSISTANCE.person);
    expect(ACTOR_IDS).toContain(ASSISTANCE.buddy);
    expect(ASSISTANCE.person).not.toBe(ASSISTANCE.buddy);
    for (const id of ACTOR_IDS) {
      expect((ZONE_IDS as readonly string[]).includes(id), id).toBe(false);
      const s: string = id;
      expect(s === 'all' || s === 'alarm' || s.startsWith('alarm_'), id).toBe(false);
      expect(ACTOR_PROFILES[id].ambient.length, id).toBeGreaterThan(0);
    }
  });

  it('every person has spawn and activity spots on the map', () => {
    const map = loadMap();
    for (const id of ACTOR_IDS) {
      expect(map.spawnSpots[id]?.length, id).toBeGreaterThan(0);
      expect(map.activitySpots[id]?.length, id).toBeGreaterThan(0);
    }
  });
});
