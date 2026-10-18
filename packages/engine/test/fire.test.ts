import { describe, expect, it } from 'vitest';
import { ACTOR_IDS, type ScenarioCase } from '@escape/contracts';
import { FIRE_BURN_TICKS, NON_FLAMMABLE_ZONES, WALL_IGNITION_FACTOR, createEngine, lineOfSight, tileIndex } from '../src/index.js';
import { FIRE_SITES, fireCells, measureGrowth, measureReach, measureSealed, measureWalls, med, outside, terrainOf, zoneOf } from './fireSetups.js';
import { Driver, errCode, hero, map } from './helpers.js';

// Bands are re-pinned from `npx tsx scripts/measure-fire.ts` (same setups, see fireSetups.ts).
describe('spreading fire', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const run = (seed: number) => {
      const d = new Driver(outside(seed), { ambient: false });
      d.place('fire', FIRE_SITES.growth.col, FIRE_SITES.growth.row);
      d.run(300);
      return JSON.stringify(d.engine.snapshot().hazards);
    };
    expect(run(3)).toBe(run(3));
    expect(run(3)).not.toBe(run(4));
  });

  it('grows quickly (median of 9 seeds in the cubicles: ~20–35 floor cells at 20 s, ~55–85 at 40 s)', () => {
    const { at20, at40 } = measureGrowth();
    expect(med(at20)).toBeGreaterThanOrEqual(20);
    expect(med(at20)).toBeLessThanOrEqual(35);
    expect(med(at40)).toBeGreaterThanOrEqual(55);
    expect(med(at40)).toBeLessThanOrEqual(85);
  });

  it('spreads anywhere indoors: from the Red Hat room (by Daniel) it reaches the main hallway (median 35–50 s) and the kitchen', () => {
    const { first, second } = measureReach();
    expect(med(first)).toBeGreaterThanOrEqual(35);
    expect(med(first)).toBeLessThanOrEqual(50);
    expect(second.filter((t) => t <= 150).length).toBeGreaterThanOrEqual(8); // a majority of seeds within 150 s
  });

  it('never ignites outdoors, exits or the assembly area (walls next to them may burn), and burns out into charred debris', () => {
    const d = new Driver(outside(), { ambient: false });
    expect(d.place('fire', 30, 17).ok).toBe(true); // reception, right by the main entrance
    d.run(FIRE_BURN_TICKS[1] + 50);
    const s = d.engine.snapshot().hazards[0];
    for (const t of [...s.cells, ...s.charred]) expect(NON_FLAMMABLE_ZONES).not.toContain(zoneOf(t));
    d.run(1500); // long enough for the walls around the exit to burn
    const late = d.engine.snapshot().hazards[0];
    expect([...late.cells, ...late.charred].some((t) => terrainOf(t) === 'wall')).toBe(true);
    for (const t of [...late.cells, ...late.charred]) {
      expect(terrainOf(t), `(${t.col},${t.row})`).not.toBe('outdoor');
      expect(NON_FLAMMABLE_ZONES).not.toContain(zoneOf(t));
    }
    for (const t of [{ col: 30, row: 17 }, { col: 31, row: 18 }]) expect(s.charred).toContainEqual(t);
    expect(s.noGo.length).toBe(s.cells.length + s.charred.length);
  });

  it('closed (disabled) sliding doors and walls hold the fire back (≥15 s median), then it breaks through', () => {
    const { escaped, delays } = measureSealed();
    expect(escaped).toBeGreaterThanOrEqual(12); // it gets out of the sealed room (through walls / burnt doors)
    expect(med(delays)).toBeGreaterThanOrEqual(15);
  });

  it(`a wall next to burning floor ignites after ~20–35 s (median; WALL_IGNITION_FACTOR ${WALL_IGNITION_FACTOR}) and the fire reaches the next room`, () => {
    const { firstWall, nextRoom, runs } = measureWalls();
    expect(firstWall.length).toBe(runs);
    expect(med(firstWall)).toBeGreaterThanOrEqual(20);
    expect(med(firstWall)).toBeLessThanOrEqual(35);
    expect(nextRoom).toBeGreaterThanOrEqual(Math.round(runs * 0.85)); // within 120 s, almost always
  });

  it('a burning wall is visible from the far side and is never lethal or passable', () => {
    const d = new Driver(outside(), { ambient: false });
    expect(d.place('fire', FIRE_SITES.walls[0].seed.col, FIRE_SITES.walls[0].seed.row).ok).toBe(true);
    expect(d.until(() => fireCells(d).some((c) => terrainOf(c) === 'wall'), 3000)).toBe(true);
    const wall = fireCells(d).find((c) => terrainOf(c) === 'wall')!;
    expect(map.walkable[tileIndex(map, wall.col, wall.row)]).toBe(false);
    expect(lineOfSight(map, { col: wall.col + 1, row: wall.row }, wall)).toBe(true);
    expect(lineOfSight(map, { col: wall.col - 1, row: wall.row }, wall)).toBe(true);
  });

  it('someone the fire reaches is lost and can no longer act', () => {
    const d = new Driver(); // Daniel is alone in the Red Hat room (18,5): he backs away by instinct, but the sealed room burns
    expect(d.place('electrical', 20, 8).ok).toBe(true); // Red Hat room door
    expect(d.place('electrical', 28, 3).ok).toBe(true); // pantry door
    expect(d.place('fire', 16, 5).ok).toBe(true);
    expect(d.until(() => d.engine.events.some((e) => e.type === 'actor_lost'), 4000)).toBe(true);
    const lostEv = d.engine.events.find((e) => e.type === 'actor_lost')!;
    const who = lostEv.actor!;
    expect(who).toBe('daniel');
    expect(d.actor(who)).toMatchObject({ status: 'lost', lost: true });
    expect(d.actor(who).lostAtSimTime).toBeGreaterThan(0);
    const r = d.call('notify', { actor_id: who, recipient: 'all', topic: 'fire', evidence_ids: ['E1'], message: 'x' });
    expect(errCode(r)).toBe('NOT_AUTHORIZED');
    expect(r.ok ? '' : r.error.message).toContain('lost to the fire');
    expect(d.engine.snapshot().roster.lost).toContain(who);
    expect(d.engine.plannerView().actors.find((a) => a.id === who)!.lost).toBe(true);
  });

  it('everyone lost → failed (reward −1)', () => {
    // Everyone in the Red Hat room with both its sliding doors dead: instinct buys time, but nobody gets them out.
    const sc: ScenarioCase = {
      ...hero(),
      spawns: {
        maya: { col: 15, row: 6, dir: 'up', pose: 'stand' },
        daniel: { col: 18, row: 5, dir: 'right', pose: 'sit' },
        alex: { col: 17, row: 6, dir: 'left', pose: 'stand' },
        rosa: { col: 22, row: 6, dir: 'up', pose: 'stand' },
        kenji: { col: 25, row: 6, dir: 'up', pose: 'stand' },
      },
    };
    const d = new Driver(sc);
    expect(d.place('electrical', 20, 8).ok).toBe(true);
    expect(d.place('electrical', 28, 3).ok).toBe(true);
    for (const [c, r] of [
      [16, 1],
      [20, 6],
      [26, 1],
    ])
      expect(d.place('fire', c, r).ok).toBe(true);
    expect(d.until(() => !!d.engine.outcome(), 6000)).toBe(true);
    expect(d.engine.outcome()!.status).toBe('failed');
    const res = d.engine.result()!;
    expect(res.score.reward).toBe(-1);
    expect(res.metrics.procedural.lost).toBe(ACTOR_IDS.length);
    expect(res.debrief[0].id).toBe('losses');
  });

  it('has no time limit; the headless stall ceiling is opt-in', () => {
    const d = new Driver(outside(), { ambient: false });
    d.place('fire', FIRE_SITES.growth.col, FIRE_SITES.growth.row);
    d.run(3000); // 300 s
    expect(d.engine.snapshot().phase).not.toBe('idle'); // smelled after 15 s
    expect(d.engine.outcome()).toBeNull();
    const e = createEngine(map, outside(), { episodeId: 'stall', stallCeilingSimSec: 60, ambient: false });
    e.placeHazard('fire', FIRE_SITES.growth.col, FIRE_SITES.growth.row);
    for (let i = 0; i < 2000 && !e.outcome(); i++) e.step();
    expect(e.outcome()).toMatchObject({ status: 'incomplete' });
    expect(e.outcome()!.reason).toMatch(/Stalled/);
  });
});
