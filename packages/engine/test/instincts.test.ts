import { describe, expect, it } from 'vitest';
import { ACTOR_IDS, type ScenarioCase, type WorldEvent } from '@escape/contracts';
import { FLEE_DESTINATION, FLEE_RADIUS, placesFor, replayRun, tileIndex } from '../src/index.js';
import { Driver, errCode, hero, map, okData } from './helpers.js';

const instincts = (d: Driver, kind: string, actor?: string) =>
  d.engine.events.filter((e) => e.type === 'instinct' && e.data.kind === kind && (!actor || e.actor === actor));
const withSpawns = (spawns: Partial<ScenarioCase['spawns']>): ScenarioCase => ({ ...hero(), spawns: { ...hero().spawns, ...spawns } });
const nearestFire = (d: Driver, t: { col: number; row: number }) =>
  Math.min(...d.engine.snapshot().hazards.flatMap((h) => (h.kind === 'fire' ? h.cells : [])).map((c) => Math.hypot(c.col - t.col, c.row - t.row)));

describe('instinct: shout', () => {
  it('first sight of a fire → a shout that alerts the same room only (once per person per fire)', () => {
    // Maya (13,15) + Alex (20,15) in the cubicles; the fire is behind Maya, out of Alex's sight range.
    const d = new Driver(withSpawns({ maya: { col: 13, row: 15, dir: 'up', pose: 'sit' } }), { ambient: false });
    d.place('fire', 5, 16);
    d.run(2);
    const shouts = instincts(d, 'shout');
    expect(shouts).toHaveLength(1);
    expect(shouts[0]).toMatchObject({ actor: 'maya', evidenceIds: ['E1'], data: { kind: 'shout', heard_by: ['alex'], evidence: 'E1', zone: 'cubicles' } });
    expect(d.actor('alex')).toMatchObject({ alerted: true, knows: ['E1'] });
    expect(d.actor('daniel')).toMatchObject({ alerted: false, knows: [] });
    // Shouting is engine behaviour, never a planner decision: nothing in the action log.
    expect(d.engine.plannerView().recent_actions).toHaveLength(0);
    expect(d.engine.plannerView().new_since_last_decision.join(' ')).toMatch(/Maya shouted "Fire!" by instinct — Alex heard it/);
    d.run(100);
    expect(instincts(d, 'shout')).toHaveLength(1); // Alex learned it by ear; neither shouts again
  });
});

describe('instinct: back away from fire', () => {
  it('an idle person next to new fire backs away; a planner move replaces the instinct walk', () => {
    const d = new Driver(withSpawns({ maya: { col: 13, row: 15, dir: 'up', pose: 'sit' } }), { ambient: false });
    expect(d.place('fire', 11, 16).ok).toBe(true); // right next to Maya at (13,15)
    d.run(1);
    const flee = instincts(d, 'flee', 'maya');
    expect(flee).toHaveLength(1);
    const { from, to } = flee[0].data as { from: [number, number]; to: [number, number] };
    expect(from).toEqual([13, 15]);
    expect(nearestFire(d, { col: to[0], row: to[1] })).toBeGreaterThan(nearestFire(d, { col: 13, row: 15 }));
    expect(d.actor('maya')).toMatchObject({ status: 'moving', task: { kind: 'move', destination: FLEE_DESTINATION } });
    expect(d.actor('maya').task!.actionId).toBeUndefined();
    const view = d.engine.plannerView().actors.find((a) => a.id === 'maya')!;
    expect(view.busy).toMatch(/instinct/);
    // Backing away does not make her busy: the planner is asked for a decision, and its move replaces the instinct.
    expect(d.engine.needsDecision()).toMatchObject({ needed: true });
    const mv = okData(d.call('move', { actor_id: 'maya', destination: 'main_entrance' }));
    expect(mv).toMatchObject({ mover: 'maya', destination: 'main_entrance' });
    expect(d.actor('maya').task).toMatchObject({ kind: 'move', destination: 'main_entrance' });
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
    d.place('fire', 10, 17); // Maya sees it from (4,15) — beyond FLEE_RADIUS; Alex (20,15) hears her shout
    d.run(40);
    expect(instincts(d, 'flee')).toHaveLength(0);
    for (const a of d.engine.snapshot().actors) expect(nearestFire(d, a)).toBeGreaterThan(FLEE_RADIUS);
    // Rate limit: at most one flee event per person per 5 s, however often they re-think.
    const d2 = new Driver(hero(), { ambient: false }); // Daniel sealed in the Red Hat room with a fire beside him
    d2.place('electrical', 20, 8);
    d2.place('electrical', 28, 3);
    d2.place('fire', 16, 5);
    d2.run(600);
    for (const id of ['daniel']) {
      const times = instincts(d2, 'flee', id).map((e) => e.simTime);
      for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(5);
    }
    expect(d2.engine.result() ?? null).toBeNull();
  });
});

describe('instinct: the alarm on the way', () => {
  it('an alerted person who passes a pull station pulls it (alarmBy instinct)', () => {
    // Maya is in the main hallway east of its pull station; she sees a fire behind her and is sent to the west exit.
    const d = new Driver(withSpawns({ maya: { col: 20, row: 10, dir: 'left', pose: 'stand' } }), { ambient: false });
    expect(d.place('fire', 26, 10).ok).toBe(true);
    d.run(1);
    expect(d.actor('maya').alerted).toBe(true);
    expect(d.actor('alex').alerted).toBe(false);
    okData(d.call('move', { actor_id: 'maya', destination: 'west_exit' }));
    expect(d.until(() => d.engine.snapshot().alarm.active, 300)).toBe(true);
    const ev = d.engine.events.find((e) => e.type === 'alarm_activated')!;
    expect(ev).toMatchObject({ actor: 'maya', data: { via: 'instinct', station: 'alarm_hallway' } });
    expect(ev.actionId).toBeUndefined();
    expect((ev.data.newly_alerted as string[]).sort()).toEqual(['alex', 'daniel', 'kenji', 'rosa']);
    expect(d.actor('maya').task).toMatchObject({ destination: 'west_exit' }); // she keeps going
    expect(d.engine.plannerView().new_since_last_decision.join(' ')).toContain('on the way past (instinct)');
    d.engine.end('incomplete', 'test');
    expect(d.engine.result()!.metrics.procedural).toMatchObject({ alarmRaised: true, alarmBy: 'instinct' });
    expect(d.engine.result()!.debrief.find((l) => l.id === 'alarm')?.text).toContain('an instinct, not an order');
  });

  it('someone already standing at the station pulls it as soon as they are alerted', () => {
    const d = new Driver(withSpawns({ maya: { col: 4, row: 9, dir: 'up', pose: 'stand' } }), { ambient: false }); // at the hallway station
    expect(d.place('fire', 10, 10).ok).toBe(true);
    d.run(2);
    expect(d.engine.snapshot().alarm).toMatchObject({ active: true, by: 'maya' });
    expect(d.engine.events.find((e) => e.type === 'alarm_activated')!.data.via).toBe('instinct');
  });
});

describe('instinct: no going back in', () => {
  it('people outside cannot be sent back inside (zones, the alarm, people indoors); outside destinations still work', () => {
    const base = hero();
    // Maya and Daniel on the sidewalk in front of the main entrance; Alex inside at his desk.
    const front = { maya: { col: 31, row: 20, dir: 'up', pose: 'stand' }, daniel: { col: 32, row: 20, dir: 'up', pose: 'stand' } } as const;
    const d = new Driver({ ...base, spawns: { ...base.spawns, ...front } }, { ambient: false });
    expect(d.place('fire', 30, 17).ok).toBe(true); // visible from the sidewalk through the main entrance
    d.run(2);
    expect(d.actor('maya').alerted).toBe(true);
    const h0 = d.engine.hash();
    for (const [tool, dest] of [
      ['move', 'reception'],
      ['move', 'alarm'],
      ['move', 'alex'], // Alex is inside
      ['move', 'main_entrance'],
      ['plan_route', 'hallway'],
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
    expect((r.zones as string[]).every((z) => ['sidewalk', 'crosswalk', 'far_sidewalk', 'assembly'].includes(z))).toBe(true);
    okData(d.call('move', { actor_id: 'daniel', destination: 'maya' }));
  });

  it('someone who evacuates during the incident is outside for good', () => {
    const d = new Driver(hero(), { ambient: false });
    d.place('fire', 14, 16); // Alex sees it from his desk (20,15); his way out (east) avoids it
    d.run(2);
    okData(d.call('move', { actor_id: 'alex', destination: 'assembly' }));
    expect(d.until(() => d.idle('alex'), 3000)).toBe(true);
    expect(d.actor('alex').zone).toBe('assembly');
    expect(errCode(d.call('move', { actor_id: 'alex', destination: 'daniel' }))).toBe('NOT_AUTHORIZED');
    expect(errCode(d.call('move', { actor_id: 'alex', destination: 'reception' }))).toBe('NOT_AUTHORIZED');
  });
});

describe('perception: smoke through walls', () => {
  it('someone within a few tiles of fire behind a wall smells it right away', () => {
    // Alex stands in the main hallway right behind the Red Hat room's south wall; the fire starts just the other side.
    const d = new Driver(withSpawns({ alex: { col: 16, row: 9, dir: 'up', pose: 'stand' } }), { ambient: false });
    expect(d.place('fire', 15, 6).ok).toBe(true);
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
    const d = new Driver(withSpawns({ maya: { col: 20, row: 10, dir: 'left', pose: 'stand' } }));
    d.run(5);
    d.place('fire', 26, 10);
    d.run(3);
    okData(d.call('move', { actor_id: 'maya', destination: 'west_exit' }));
    d.run(60);
    d.place('fire', 16, 5); // next to Daniel (18,5): he backs away
    d.run(40);
    expect(instincts(d, 'flee').length).toBeGreaterThan(0);
    expect(d.engine.snapshot().alarm.active).toBe(true);
    okData(d.call('move', { actor_id: 'daniel', destination: 'main_entrance' }));
    d.run(80);
    const original = d.engine;
    const replayed = replayRun(map, d.scenario, { episodeId: 'test-ep' }, d.inputs, d.tick);
    const strip = (e: WorldEvent) => [e.seq, e.tick, e.type, e.actor, e.actionId, JSON.stringify(e.data)];
    expect(replayed.events.map(strip)).toEqual(original.events.map(strip));
    expect(replayed.hash()).toBe(original.hash());
  });
});

describe('readable texts', () => {
  const RAW = new RegExp(`\\b(?:E\\d+|R\\d+)\\b|${placesFor(map).idPattern}`);
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
      d.place('fire', 6 + (seed % 8), 16);
      d.place('electrical', 31, 12);
      d.run(3);
      const ids = [...ACTOR_IDS];
      const dests = ['assembly', 'reception', 'rh_room', 'hallway', 'main_entrance', 'west_exit', 'alarm', 'alex', 'daniel', 'maya', 'rosa', 'kenji', 'cubicles', 'side_door'];
      for (let k = 0; k < 60 && !d.engine.outcome(); k++) {
        const who = ids[(k + seed) % ids.length];
        const dest = dests[(k * 7 + seed) % dests.length];
        switch (k % 9) {
          case 0:
            d.call('move', { actor_id: who, destination: dest });
            break;
          case 1:
            d.call('plan_route', { actor_id: who, destination: dest });
            break;
          case 2:
            d.call('notify', { actor_id: who, recipient: ids[(k + 1) % ids.length], topic: k % 2 ? 'fire' : 'route_blocked', evidence_ids: [`E${(k % 3) + 1}`], message: 'E1 is near side_door!' });
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
  const OUT = ['sidewalk', 'crosswalk', 'far_sidewalk', 'assembly'];
  let flees = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const d = new Driver({ ...hero(), seed }, { ambient: seed % 2 === 0 });
    d.run(5 + (seed % 20));
    d.place('fire', 3 + (seed % 18), 1 + (seed % 17));
    if (seed % 3 === 0) d.place('fire', 19 + (seed % 10), 1 + (seed % 2));
    if (seed % 4 === 0) d.place('electrical', 31, 12);
    const outside = new Set<string>();
    for (let t = 0; t < 900 && !d.engine.outcome(); t++) {
      // Sparse planner orders: everyone out, then (rejected for anyone outside) back to reception.
      if (t % 150 === 10) for (const id of ACTOR_IDS) d.call('move', { actor_id: id, destination: t % 300 === 10 ? 'assembly' : 'reception' });
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
