import { describe, expect, it } from 'vitest';
import { ACTOR_IDS, type ActorId, type ScenarioCase, ZONE_IDS } from '@escape/contracts';
import { mulberry32, replayRun, tileIndex } from '../src/index.js';
import { Driver, errCode, hero, map, okData } from './helpers.js';

function runHero(): Driver {
  const d = new Driver();
  d.run(20);
  expect(d.engine.needsDecision().needed).toBe(false);
  expect(d.place('fire', 8, 5).ok).toBe(true);
  d.run(2);
  expect(d.engine.needsDecision()).toMatchObject({ needed: true });
  okData(d.call('notify', { actor_id: 'maya', recipient: 'all', topic: 'fire', evidence_ids: ['E1'], message: 'Fire by door A! Use door B.' }));
  okData(d.call('consult_plan', { actor_id: 'alex', section: 'assistance' }));
  okData(d.call('request_assistance', { actor_id: 'daniel', helper_id: 'alex' }));
  okData(d.call('move', { actor_id: 'alex', destination: 'daniel' }));
  okData(d.call('move', { actor_id: 'maya', destination: 'assembly' }));
  expect(d.until(() => d.idle('alex'))).toBe(true);
  okData(d.call('assist', { actor_id: 'alex', person_id: 'daniel' }));
  const east = okData(d.call('move', { actor_id: 'alex', destination: 'assembly' }));
  expect(east.zones).toContain('south_branch');
  // Presenter drops the blocker once Alex+Daniel enter the lobby heading east (Maya is ahead)
  expect(d.until(() => d.actor('alex').zone === 'lobby')).toBe(true);
  expect(d.place('blocker', 26, 15).ok).toBe(true);
  expect(d.until(() => d.idle('alex'))).toBe(true);
  const interrupted = d.engine.events.filter((e) => e.type === 'move_interrupted');
  expect(interrupted.map((e) => e.actor)).toContain('alex');
  const alexInt = interrupted.find((e) => e.actor === 'alex')!;
  expect(alexInt.data.code).toBe('ROUTE_UNAVAILABLE');
  expect(alexInt.data.partial_tiles).toBeGreaterThan(0);
  expect(d.engine.plannerView().new_since_last_decision.join(' ')).toContain('interrupted');
  okData(d.call('notify', { actor_id: 'alex', recipient: 'all', topic: 'route_blocked', evidence_ids: ['E2'], message: 'South branch blocked — north corridor.' }));
  const r = okData(d.call('plan_route', { actor_id: 'alex', destination: 'assembly' }));
  expect(r.zones).toContain('connector');
  okData(d.call('move', { actor_id: 'alex', destination: 'assembly', route_id: r.route_id }));
  if (d.idle('maya') && d.actor('maya').zone !== 'assembly') okData(d.call('move', { actor_id: 'maya', destination: 'assembly' }));
  expect(d.until(() => d.idle('alex') && d.idle('maya'), 3000)).toBe(true);
  for (const id of ['maya', 'alex', 'daniel']) okData(d.call('check_in', { actor_id: id }));
  const v = okData(d.call('verify_roster', { actor_id: 'alex' }));
  expect(v.complete).toBe(true);
  return d;
}

describe('episodes', () => {
  it('scripted hero run reaches verified success (fixture, not a model result)', () => {
    const d = runHero();
    expect(d.engine.outcome()?.status).toBe('success');
    const res = d.engine.result(1000)!;
    expect(res.score.reward).toBe(1);
    expect(res.metrics.procedural).toMatchObject({ hazardReported: true, assistanceFulfilled: true, rosterVerified: true, replannedAfterInterruption: true });
    expect(res.metrics.procedural.routeInterruptions).toBeGreaterThanOrEqual(1);
    expect(res.debrief).toHaveLength(3);
    expect(res.debrief.map((l) => l.id)).toEqual(['routes', 'reporting', 'assistance']);
    expect(res.debrief[0].sources[0].url).toMatch(/^https:\/\/www\.osha\.gov/);
    expect(errCode(d.call('observe', { actor_id: 'alex' }))).toBe('EPISODE_OVER');
  });

  it('replay re-simulates the logged inputs to an identical event log and state', () => {
    const d = runHero();
    const original = d.engine;
    const replayed = replayRun(map, hero(), { episodeId: 'test-ep' }, d.inputs.filter((i) => i.tick <= original.snapshot().tick));
    const strip = (e: (typeof original.events)[number]) => [e.seq, e.tick, e.type, e.actor, e.actionId, JSON.stringify(e.data)];
    expect(replayed.outcome()).toEqual(original.outcome());
    // The final EPISODE_OVER probe in runHero is not part of d.inputs' prefix before the end; compare up to episode_ended
    const end = original.events.findIndex((e) => e.type === 'episode_ended');
    expect(replayed.events.slice(0, end + 1).map(strip)).toEqual(original.events.slice(0, end + 1).map(strip));
  });

  it('a placement that traps the conference room ends unresolved at the decision cap', () => {
    const d = new Driver(hero(), { maxDecisions: 6 });
    d.run(3);
    expect(d.place('fire', 16, 9).ok).toBe(true);
    expect(d.place('blocker', 8, 3).ok).toBe(true);
    d.run(5);
    for (let i = 0; i < 6; i++) d.note('no_call');
    const out = d.engine.outcome();
    expect(out?.status).toBe('unresolved');
    expect(out?.reason).toMatch(/Maya|Daniel/);
    const res = d.engine.result()!;
    expect(res.debrief[0].id).toBe('unresolved');
    expect(res.score.reward).toBe(0);
    // The oracle never leaks into the planner view
    expect(JSON.stringify(d.engine.plannerView())).not.toMatch(/unresolved|trapped|unreachable/);
  });

  it('decision cap without trapped people ends incomplete', () => {
    const d = new Driver(hero(), { maxDecisions: 3 });
    d.place('fire', 8, 5);
    d.run(2);
    d.note('malformed');
    d.note('no_call');
    d.note('provider_error');
    expect(d.engine.outcome()?.status).toBe('incomplete');
    expect(d.engine.result()!.metrics).toMatchObject({ malformed: 2, providerErrors: 1, decisions: 3 });
  });

  it('an unnoticed fire is smelled after 15 s by the nearest person', () => {
    const d = new Driver();
    d.place('fire', 20, 1); // north corridor, behind walls
    d.run(170);
    const obs = d.engine.events.find((e) => e.type === 'observation');
    expect(obs).toBeDefined();
    if (obs!.data.via === 'smoke') expect(obs!.simTime).toBeGreaterThanOrEqual(15);
    expect(d.engine.snapshot().phase).not.toBe('idle');
  });

  it('property: nobody ever occupies (or steps into) a hazard no-go tile', () => {
    const t0 = Date.now();
    for (let seed = 1; seed <= 300; seed++) {
      const rng = mulberry32(seed * 7919);
      const base = hero();
      const spawns = {} as ScenarioCase['spawns'];
      for (const id of ACTOR_IDS) spawns[id] = rng.pick(map.spawnSpots[id]);
      const d = new Driver({ ...base, seed, spawns }, { maxDecisions: 100000, maxSimTime: 100000 });
      const randomPlace = (kind: 'fire' | 'blocker') => {
        for (let k = 0; k < 40; k++) if (d.place(kind, rng.int(0, map.cols - 2), rng.int(0, map.rows - 2)).ok) return true;
        return false;
      };
      randomPlace('fire');
      d.until(() => d.engine.snapshot().actors.some((a) => a.knows.length > 0), 200);
      const knower = d.engine.snapshot().actors.find((a) => a.knows.length > 0);
      if (knower) d.call('notify', { actor_id: knower.id, recipient: 'all', topic: 'evacuate', evidence_ids: [knower.knows[0]], message: 'Go!' });
      const blockerAt = rng.int(5, 120);
      const dests = [...ZONE_IDS, ...ACTOR_IDS];
      for (let t = 0; t < 220; t++) {
        if (t === blockerAt) randomPlace('blocker');
        if (t % 12 === 0) d.call('move', { actor_id: rng.pick(ACTOR_IDS) as ActorId, destination: rng.pick(dests) });
        d.engine.step();
        const s = d.engine.snapshot();
        const nogo = new Set(s.hazards.flatMap((h) => h.noGo.map((x) => tileIndex(map, x.col, x.row))));
        for (const a of s.actors) {
          expect(nogo.has(tileIndex(map, a.col, a.row)), `seed ${seed} t ${t} ${a.id} on hazard`).toBe(false);
          expect(nogo.has(tileIndex(map, Math.round(a.x), Math.round(a.y))), `seed ${seed} t ${t} ${a.id} stepping into hazard`).toBe(false);
          if (a.usesWheelchair) expect(map.accessible[tileIndex(map, a.col, a.row)], `seed ${seed} t ${t} daniel off accessible tiles`).toBe(true);
        }
      }
    }
    expect(Date.now() - t0).toBeLessThan(8000);
  });
});
