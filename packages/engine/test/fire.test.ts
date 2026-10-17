import { describe, expect, it } from 'vitest';
import type { ScenarioCase } from '@escape/contracts';
import { FIRE_BURN_TICKS, NON_FLAMMABLE_ZONES, createEngine, tileIndex } from '../src/index.js';
import { Driver, errCode, hero, map, outsideSpawns } from './helpers.js';

const zoneOf = (t: { col: number; row: number }) => map.zone[tileIndex(map, t.col, t.row)];
const outside = (seed = 7): ScenarioCase => ({ ...hero(), seed, spawns: outsideSpawns() });
const fireCells = (d: Driver) => d.engine.snapshot().hazards.filter((h) => h.kind === 'fire').flatMap((h) => h.noGo);

describe('spreading fire', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const run = (seed: number) => {
      const d = new Driver(outside(seed), { ambient: false });
      d.place('fire', 10, 13);
      d.run(300);
      return JSON.stringify(d.engine.snapshot().hazards);
    };
    expect(run(3)).toBe(run(3));
    expect(run(3)).not.toBe(run(4));
  });

  it('grows at a moderate pace (median of 9 seeds: ~20–35 cells at 20 s, ~55–90 at 40 s)', () => {
    const at20: number[] = [];
    const at40: number[] = [];
    for (let seed = 1; seed <= 9; seed++) {
      const d = new Driver(outside(seed), { ambient: false });
      expect(d.place('fire', 10, 13).ok).toBe(true);
      d.run(200);
      at20.push(fireCells(d).length);
      d.run(200);
      at40.push(fireCells(d).length);
    }
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    expect(med(at20)).toBeGreaterThanOrEqual(20);
    expect(med(at20)).toBeLessThanOrEqual(35);
    expect(med(at40)).toBeGreaterThanOrEqual(55);
    expect(med(at40)).toBeLessThanOrEqual(90);
  });

  it('never ignites outdoors, exits or the assembly area, and burns out into charred debris', () => {
    const d = new Driver(outside(), { ambient: false });
    expect(d.place('fire', 26, 16).ok).toBe(true); // south branch, right by the east exit
    d.run(FIRE_BURN_TICKS[1] + 50);
    const s = d.engine.snapshot().hazards[0];
    for (const t of [...s.cells, ...s.charred]) expect(NON_FLAMMABLE_ZONES).not.toContain(zoneOf(t));
    for (const t of [{ col: 26, row: 16 }, { col: 27, row: 17 }]) expect(s.charred).toContainEqual(t);
    expect(s.noGo.length).toBe(s.cells.length + s.charred.length);
  });

  it('closed (disabled) sliding doors contain the fire', () => {
    const d = new Driver(outside(), { ambient: false });
    expect(d.place('electrical', 8, 4).ok).toBe(true);
    expect(d.place('electrical', 18, 9).ok).toBe(true);
    expect(d.place('fire', 10, 13).ok).toBe(true);
    d.run(1500);
    const cells = fireCells(d);
    expect(cells.length).toBeGreaterThan(60);
    expect(new Set(cells.map(zoneOf))).toEqual(new Set(['rh_room']));
  });

  it('someone the fire reaches is lost and can no longer act', () => {
    const d = new Driver(); // Maya sits at (13,7)
    expect(d.place('fire', 11, 7).ok).toBe(true);
    expect(d.until(() => d.lost('maya'), 3000)).toBe(true);
    const lostEv = d.engine.events.find((e) => e.type === 'actor_lost')!;
    expect(lostEv.actor).toBe('maya');
    expect(d.actor('maya')).toMatchObject({ status: 'lost', lost: true });
    expect(d.actor('maya').lostAtSimTime).toBeGreaterThan(0);
    const r = d.call('notify', { actor_id: 'maya', recipient: 'all', topic: 'fire', evidence_ids: ['E1'], message: 'x' });
    expect(errCode(r)).toBe('NOT_AUTHORIZED');
    expect(r.ok ? '' : r.error.message).toContain('lost to the fire');
    expect(d.engine.snapshot().roster.lost).toEqual(['maya']);
    expect(d.engine.plannerView().actors.find((a) => a.id === 'maya')!.lost).toBe(true);
  });

  it('everyone lost → failed (reward −1)', () => {
    const sc: ScenarioCase = {
      ...hero(),
      spawns: {
        maya: { col: 13, row: 7, dir: 'up', pose: 'sit' },
        daniel: { col: 15, row: 12, dir: 'left', pose: 'sit' },
        alex: { col: 16, row: 10, dir: 'left', pose: 'stand' },
      },
    };
    const d = new Driver(sc);
    for (const [c, r] of [
      [11, 7],
      [13, 12],
      [14, 9],
    ])
      expect(d.place('fire', c, r).ok).toBe(true);
    expect(d.until(() => !!d.engine.outcome(), 4000)).toBe(true);
    expect(d.engine.outcome()!.status).toBe('failed');
    const res = d.engine.result()!;
    expect(res.score.reward).toBe(-1);
    expect(res.metrics.procedural.lost).toBe(3);
    expect(res.debrief[0].id).toBe('losses');
  });

  it('has no time limit; the headless stall ceiling is opt-in', () => {
    const d = new Driver(outside(), { ambient: false });
    d.place('fire', 10, 13);
    d.run(3000); // 300 s
    expect(d.engine.snapshot().phase).not.toBe('idle'); // smelled after 15 s
    expect(d.engine.outcome()).toBeNull();
    const e = createEngine(map, outside(), { episodeId: 'stall', stallCeilingSimSec: 60, ambient: false });
    e.placeHazard('fire', 10, 13);
    for (let i = 0; i < 2000 && !e.outcome(); i++) e.step();
    expect(e.outcome()).toMatchObject({ status: 'incomplete' });
    expect(e.outcome()!.reason).toMatch(/Stalled/);
  });
});
