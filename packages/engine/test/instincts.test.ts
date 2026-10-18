import { describe, expect, it } from 'vitest';
import type { ScenarioCase, WorldEvent } from '@escape/contracts';
import { FLEE_DESTINATION, FLEE_RADIUS, replayRun, tileIndex } from '../src/index.js';
import { Driver, errCode, hero, map, okData, outsideSpawns } from './helpers.js';

const instincts = (d: Driver, kind: string, actor?: string) =>
  d.engine.events.filter((e) => e.type === 'instinct' && e.data.kind === kind && (!actor || e.actor === actor));
const withSpawns = (spawns: Partial<ScenarioCase['spawns']>): ScenarioCase => ({ ...hero(), spawns: { ...hero().spawns, ...spawns } });
const nearestFire = (d: Driver, t: { col: number; row: number }) =>
  Math.min(...d.engine.snapshot().hazards.flatMap((h) => (h.kind === 'fire' ? h.cells : [])).map((c) => Math.hypot(c.col - t.col, c.row - t.row)));

describe('instinct: shout', () => {
  it('first sight of a fire → a shout that alerts the same room only (once per person per fire)', () => {
    const d = new Driver(hero(), { ambient: false }); // Maya (13,7) + Daniel (15,12) in the Red Hat room; Alex (22,8) in the lobby
    d.place('fire', 8, 4);
    d.run(2);
    const shouts = instincts(d, 'shout');
    expect(shouts).toHaveLength(1);
    expect(shouts[0]).toMatchObject({ actor: 'maya', evidenceIds: ['E1'], data: { kind: 'shout', heard_by: ['daniel'], evidence: 'E1', zone: 'rh_room' } });
    expect(d.actor('daniel')).toMatchObject({ alerted: true, knows: ['E1'] });
    expect(d.actor('alex')).toMatchObject({ alerted: false, knows: [] });
    // Shouting is engine behaviour, never a planner decision: nothing in the action log.
    expect(d.engine.plannerView().recent_actions).toHaveLength(0);
    expect(d.engine.plannerView().new_since_last_decision.join(' ')).toMatch(/Maya shouted "Fire!" by instinct — Daniel heard it/);
    d.run(100);
    expect(instincts(d, 'shout')).toHaveLength(1); // Daniel learned it by ear; neither shouts again
  });
});

describe('instinct: back away from fire', () => {
  it('an idle person next to new fire backs away; a planner move replaces the instinct walk', () => {
    const d = new Driver(hero(), { ambient: false });
    expect(d.place('fire', 11, 7).ok).toBe(true); // right next to Maya at (13,7)
    d.run(1);
    const flee = instincts(d, 'flee', 'maya');
    expect(flee).toHaveLength(1);
    const { from, to } = flee[0].data as { from: [number, number]; to: [number, number] };
    expect(from).toEqual([13, 7]);
    expect(nearestFire(d, { col: to[0], row: to[1] })).toBeGreaterThan(nearestFire(d, { col: 13, row: 7 }));
    expect(d.actor('maya')).toMatchObject({ status: 'moving', task: { kind: 'move', destination: FLEE_DESTINATION } });
    expect(d.actor('maya').task!.actionId).toBeUndefined();
    const view = d.engine.plannerView().actors.find((a) => a.id === 'maya')!;
    expect(view.busy).toMatch(/instinct/);
    // Backing away does not make her busy: the planner is asked for a decision, and its move replaces the instinct.
    expect(d.engine.needsDecision()).toMatchObject({ needed: true });
    const mv = okData(d.call('move', { actor_id: 'maya', destination: 'east_exit' }));
    expect(mv).toMatchObject({ mover: 'maya', destination: 'east_exit' });
    expect(d.actor('maya').task).toMatchObject({ kind: 'move', destination: 'east_exit' });
    const fleesBefore = instincts(d, 'flee', 'maya').length;
    expect(d.until(() => d.idle('maya') || d.lost('maya'), 3000)).toBe(true);
    expect(d.lost('maya')).toBe(false);
    // Nothing instinctive interrupts a planner order.
    const order = d.engine.events.filter((e) => e.actor === 'maya' && (e.type === 'move_completed' || e.type === 'move_interrupted'));
    expect(order.length).toBeGreaterThan(0);
    expect(instincts(d, 'flee', 'maya').filter((e) => e.seq < order[0].seq)).toHaveLength(fleesBefore);
  });

  it('only people within FLEE_RADIUS of fire they know about back away; flee events are rate-limited', () => {
    const d = new Driver(hero(), { ambient: false });
    d.place('fire', 6, 12); // Maya sees it from (13,7) — far away; Daniel (15,12) hears her shout
    d.run(40);
    expect(instincts(d, 'flee')).toHaveLength(0);
    for (const a of d.engine.snapshot().actors) expect(nearestFire(d, a)).toBeGreaterThan(FLEE_RADIUS);
    // Rate limit: at most one flee event per person per 5 s, however often they re-think.
    const d2 = new Driver(hero(), { ambient: false });
    d2.place('electrical', 8, 4);
    d2.place('electrical', 18, 9);
    d2.place('fire', 11, 7);
    d2.run(600);
    for (const id of ['maya', 'daniel']) {
      const times = instincts(d2, 'flee', id).map((e) => e.simTime);
      for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(5);
    }
    expect(d2.engine.result() ?? null).toBeNull();
  });
});

describe('instinct: the alarm on the way', () => {
  it('an alerted person who passes the hallway pull station pulls it (alarmBy instinct)', () => {
    // Maya is in the north hallway east of the station; she sees a fire behind her and is sent to the west exit.
    const d = new Driver(withSpawns({ maya: { col: 20, row: 1, dir: 'left', pose: 'stand' } }), { ambient: false });
    expect(d.place('fire', 25, 2).ok).toBe(true);
    d.run(1);
    expect(d.actor('maya').alerted).toBe(true);
    expect(d.actor('alex').alerted).toBe(false);
    okData(d.call('move', { actor_id: 'maya', destination: 'west_exit' }));
    expect(d.until(() => d.engine.snapshot().alarm.active, 300)).toBe(true);
    const ev = d.engine.events.find((e) => e.type === 'alarm_activated')!;
    expect(ev).toMatchObject({ actor: 'maya', data: { via: 'instinct', station: 'alarm_corridor' } });
    expect(ev.actionId).toBeUndefined();
    expect((ev.data.newly_alerted as string[]).sort()).toEqual(['alex', 'daniel']);
    expect(d.actor('maya').task).toMatchObject({ destination: 'west_exit' }); // she keeps going
    expect(d.engine.plannerView().new_since_last_decision.join(' ')).toContain('on the way past (instinct)');
    d.engine.end('incomplete', 'test');
    expect(d.engine.result()!.metrics.procedural).toMatchObject({ alarmRaised: true, alarmBy: 'instinct' });
    expect(d.engine.result()!.debrief.find((l) => l.id === 'alarm')?.text).toContain('an instinct, not an order');
  });

  it('someone already standing at the station pulls it as soon as they are alerted', () => {
    const d = new Driver(withSpawns({ maya: { col: 13, row: 2, dir: 'up', pose: 'stand' } }), { ambient: false });
    expect(d.place('fire', 22, 2).ok).toBe(true);
    d.run(2);
    expect(d.engine.snapshot().alarm).toMatchObject({ active: true, by: 'maya' });
    expect(d.engine.events.find((e) => e.type === 'alarm_activated')!.data.via).toBe('instinct');
  });
});

describe('instinct: no going back in', () => {
  it('people outside cannot be sent back inside (zones, the alarm, people indoors); outside destinations still work', () => {
    const base = hero();
    const d = new Driver({ ...base, spawns: { ...outsideSpawns(), alex: base.spawns.alex } }, { ambient: false });
    expect(d.place('fire', 26, 16).ok).toBe(true); // visible from the plaza through the east exit
    d.run(2);
    expect(d.actor('maya').alerted).toBe(true);
    const h0 = d.engine.hash();
    for (const [tool, dest] of [
      ['move', 'lobby'],
      ['move', 'alarm'],
      ['move', 'alex'], // Alex is inside
      ['move', 'east_exit'],
      ['plan_route', 'north_corridor'],
    ] as const) {
      const r = d.call(tool, { actor_id: 'maya', destination: dest });
      expect(errCode(r), `${tool} → ${dest}`).toBe('NOT_AUTHORIZED');
      expect(r.ok ? '' : r.error.message).toBe("Maya is already outside — people don't go back into a burning building.");
      expect(r.ok ? '' : r.error.hint).toContain('Someone still inside must raise the alarm');
      expect(d.engine.hash()).toBe(h0);
    }
    const pull = d.call('pull_alarm', { actor_id: 'maya' });
    expect(errCode(pull)).toBe('OUT_OF_RANGE');
    expect(pull.ok ? '' : pull.error.hint).toContain('cannot go back in');
    // Outside destinations are fine, and the route stays outside.
    const r = okData(d.call('plan_route', { actor_id: 'maya', destination: 'assembly' }));
    expect((r.zones as string[]).every((z) => ['plaza', 'assembly', 'west_sidewalk'].includes(z))).toBe(true);
    okData(d.call('move', { actor_id: 'daniel', destination: 'maya' }));
  });

  it('someone who evacuates during the incident is outside for good', () => {
    const d = new Driver(hero(), { ambient: false });
    d.place('fire', 6, 12);
    d.run(2);
    okData(d.call('move', { actor_id: 'maya', destination: 'assembly' }));
    expect(d.until(() => d.idle('maya'), 3000)).toBe(true);
    expect(d.actor('maya').zone).toBe('assembly');
    expect(errCode(d.call('move', { actor_id: 'maya', destination: 'daniel' }))).toBe('NOT_AUTHORIZED');
    expect(errCode(d.call('move', { actor_id: 'maya', destination: 'lobby' }))).toBe('NOT_AUTHORIZED');
  });
});

describe('perception: smoke through walls', () => {
  it('someone within a few tiles of fire behind a wall smells it right away', () => {
    // Alex stands in the lobby right behind the Red Hat room's east wall; the fire starts just the other side.
    const d = new Driver(withSpawns({ alex: { col: 19, row: 6, dir: 'left', pose: 'stand' } }), { ambient: false });
    expect(d.place('fire', 16, 5).ok).toBe(true);
    d.run(1);
    const obs = d.engine.events.find((e) => e.type === 'observation' && e.actor === 'alex');
    expect(obs).toBeDefined();
    expect(obs!.data).toMatchObject({ kind: 'fire', via: 'smoke' });
    expect(obs!.simTime).toBeLessThan(1);
    expect(d.actor('alex')).toMatchObject({ alerted: true, knows: ['E1'] });
  });
});

describe('determinism with instincts', () => {
  it('replays shouts, flees and the alarm to an identical event log and hash', () => {
    const d = new Driver(withSpawns({ maya: { col: 20, row: 1, dir: 'left', pose: 'stand' } }));
    d.run(5);
    d.place('fire', 25, 2);
    d.run(3);
    okData(d.call('move', { actor_id: 'maya', destination: 'west_exit' }));
    d.run(60);
    d.place('fire', 13, 12); // next to Daniel (15,12): he backs away
    d.run(40);
    expect(instincts(d, 'flee').length).toBeGreaterThan(0);
    expect(d.engine.snapshot().alarm.active).toBe(true);
    okData(d.call('move', { actor_id: 'daniel', destination: 'east_exit' }));
    d.run(80);
    const original = d.engine;
    const replayed = replayRun(map, d.scenario, { episodeId: 'test-ep' }, d.inputs, d.tick);
    const strip = (e: WorldEvent) => [e.seq, e.tick, e.type, e.actor, e.actionId, JSON.stringify(e.data)];
    expect(replayed.events.map(strip)).toEqual(original.events.map(strip));
    expect(replayed.hash()).toBe(original.hash());
  });
});

describe('readable texts', () => {
  const RAW = /\b(E\d+|rh_room|south_branch|door_a|door_b|north_corridor|west_sidewalk|west_exit|east_exit|R\d+)\b/;
  const texts = (d: Driver): string[] => {
    const out: string[] = [];
    for (const e of d.engine.events) {
      if (e.type === 'tool_executed' || e.type === 'tool_rejected') out.push(String(e.data.summary));
      if (e.type === 'tool_rejected') {
        const err = e.data.error as { message: string; hint?: string; details?: { issues?: unknown } };
        out.push(err.message);
        if (err.hint && !err.details?.issues) out.push(err.hint); // schema issues list the allowed enum values verbatim
      }
    }
    const res = d.engine.result();
    if (res) out.push(res.outcome.reason, ...res.debrief.flatMap((l) => [l.title, l.text]));
    return out;
  };

  it('summaries, error messages/hints, debrief and outcome reasons never show evidence, zone or route ids', () => {
    const all: string[] = [];
    for (let seed = 1; seed <= 25; seed++) {
      const d = new Driver({ ...hero(), seed }, { maxDecisions: 400 });
      d.run(5);
      d.place('fire', 6 + (seed % 8), 12);
      d.place('electrical', 26, 14);
      d.run(3);
      const ids = ['alex', 'maya', 'daniel'];
      const dests = ['assembly', 'lobby', 'rh_room', 'north_corridor', 'east_exit', 'west_exit', 'alarm', 'alex', 'daniel', 'maya', 'south_branch', 'door_b'];
      for (let k = 0; k < 60 && !d.engine.outcome(); k++) {
        const who = ids[(k + seed) % 3];
        const dest = dests[(k * 7 + seed) % dests.length];
        switch (k % 9) {
          case 0:
            d.call('move', { actor_id: who, destination: dest });
            break;
          case 1:
            d.call('plan_route', { actor_id: who, destination: dest });
            break;
          case 2:
            d.call('notify', { actor_id: who, recipient: ids[(k + 1) % 3], topic: k % 2 ? 'fire' : 'route_blocked', evidence_ids: [`E${(k % 3) + 1}`], message: 'E1 is near door_b!' });
            break;
          case 3:
            d.call('observe', { actor_id: who });
            break;
          case 4:
            d.call('move', { actor_id: who, destination: dest, route_id: `R${k % 4}` });
            break;
          case 5:
            d.call('pull_alarm', { actor_id: who });
            break;
          case 6:
            d.call('check_in', { actor_id: who });
            break;
          case 7:
            d.call('assist', { actor_id: 'alex', person_id: 'daniel' });
            d.call('request_assistance', { actor_id: 'daniel', helper_id: 'alex' });
            break;
          default:
            d.call('verify_roster', { actor_id: who });
        }
        d.run(25);
      }
      if (!d.engine.outcome()) d.engine.end('incomplete', 'test over');
      all.push(...texts(d));
    }
    expect(all.length).toBeGreaterThan(1000);
    const bad = all.filter((t) => RAW.test(t));
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

it('property (120 seeds): instinct walks keep Daniel on accessible tiles, avoid known fire, and never re-enter', () => {
  const OUT = ['west_sidewalk', 'plaza', 'assembly'];
  let flees = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const d = new Driver({ ...hero(), seed }, { ambient: seed % 2 === 0 });
    d.run(5 + (seed % 20));
    d.place('fire', 4 + (seed % 12), 5 + (seed % 11));
    if (seed % 3 === 0) d.place('fire', 19 + (seed % 10), 1 + (seed % 2));
    if (seed % 4 === 0) d.place('electrical', 26, 14);
    const outside = new Set<string>();
    for (let t = 0; t < 900 && !d.engine.outcome(); t++) {
      // Sparse planner orders: everyone out, then (rejected for anyone outside) back to the lobby.
      if (t % 150 === 10) for (const id of ['alex', 'maya', 'daniel']) d.call('move', { actor_id: id, destination: t % 300 === 10 ? 'assembly' : 'lobby' });
      const before = d.engine.snapshot();
      const blockedBefore = new Set(before.hazards.flatMap((h) => h.noGo.map((x) => tileIndex(map, x.col, x.row))));
      d.engine.step();
      const s = d.engine.snapshot();
      for (const a of s.actors) {
        if (a.lost) continue;
        const b = before.actors.find((x) => x.id === a.id)!;
        const here = tileIndex(map, a.col, a.row);
        if (a.col !== b.col || a.row !== b.row) expect(blockedBefore.has(here), `seed ${seed} t ${t} ${a.id} stepped into a hazard`).toBe(false);
        if (a.usesWheelchair) expect(map.accessible[here], `seed ${seed} daniel off accessible tiles`).toBe(true);
        if (outside.has(a.id)) expect(OUT, `seed ${seed} t ${t} ${a.id} went back in`).toContain(a.zone);
        if (s.phase !== 'idle' && OUT.includes(a.zone ?? '')) outside.add(a.id);
      }
    }
    flees += instincts(d, 'flee').length;
  }
  expect(flees).toBeGreaterThan(20); // the property really exercises instinct walks
});
