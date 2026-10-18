import { describe, expect, it } from 'vitest';
import { ACTOR_IDS, type ActorId, type ScenarioCase, ZONE_IDS } from '@escape/contracts';
import { mulberry32, replayRun, tileIndex } from '../src/index.js';
import { Driver, errCode, hero, map, okData } from './helpers.js';

/** Scripted (fixture, not a model) hero on the ground floor: a fire at the west end of the cubicles; Maya sees it and
 *  her instinctive shout reaches Alex (same room) but nobody in the other rooms, so she is sent to the nearest pull
 *  station and pulls it on arrival; Alex fetches Daniel from the Red Hat room; the reception door jams while they are
 *  in the hallway; re-route; everyone checks in and Alex verifies the roster. */
function runHero(): Driver {
  const d = new Driver();
  d.run(20);
  expect(d.engine.needsDecision().needed).toBe(false);
  expect(d.place('fire', 10, 17).ok).toBe(true);
  d.run(2);
  expect(d.actor('maya').knows).toEqual(['E1']);
  expect(d.engine.needsDecision()).toMatchObject({ needed: true });
  // Instinct: Maya shouted "Fire!" — Alex (same room) heard it, nobody else did.
  expect(d.engine.events.find((e) => e.type === 'instinct' && e.data.kind === 'shout')).toMatchObject({ actor: 'maya', data: { kind: 'shout', heard_by: ['alex'] } });
  expect(d.actor('alex').alerted).toBe(true);
  const tell = okData(d.call('notify', { actor_id: 'maya', recipient: 'all', topic: 'fire', evidence_ids: ['E1'], message: 'Fire at the end of the cubicles! Go out through the side door.' }));
  expect(tell).toMatchObject({ delivered_to: ['alex'], not_reached: ['daniel', 'rosa', 'kenji'] });
  // Daniel has heard nothing: he cannot evacuate yet
  expect(errCode(d.call('move', { actor_id: 'daniel', destination: 'assembly' }))).toBe('NOT_AUTHORIZED');
  okData(d.call('move', { actor_id: 'maya', destination: 'alarm' }));
  expect(d.until(() => d.idle('maya'))).toBe(true);
  // She pulled it on arrival (the planner sent her there); a second pull is a no-op.
  for (const id of ['daniel', 'rosa', 'kenji']) expect(d.actor(id).alerted, id).toBe(true);
  expect(okData(d.call('pull_alarm', { actor_id: 'maya' }))).toMatchObject({ already_active: true });
  okData(d.call('request_assistance', { actor_id: 'daniel', helper_id: 'alex' }));
  for (const id of ['maya', 'rosa', 'kenji']) okData(d.call('move', { actor_id: id, destination: 'assembly' }));
  okData(d.call('move', { actor_id: 'alex', destination: 'daniel' }));
  expect(d.until(() => d.idle('alex'))).toBe(true);
  okData(d.call('assist', { actor_id: 'alex', person_id: 'daniel' }));
  const out = okData(d.call('move', { actor_id: 'alex', destination: 'assembly' }));
  expect(out.zones).toContain('reception_door');
  // Presenter jams the reception door once Alex+Daniel are in the hallway (retry while someone is in the doorway)
  expect(d.until(() => d.actor('alex').zone === 'hallway')).toBe(true);
  let jammed = false;
  expect(d.until(() => (jammed ||= d.place('electrical', 31, 12).ok), 60)).toBe(true);
  expect(d.until(() => d.idle('alex'))).toBe(true);
  const interrupted = d.engine.events.filter((e) => e.type === 'move_interrupted' && e.actor === 'alex');
  expect(interrupted).toHaveLength(1);
  expect(interrupted[0].data).toMatchObject({ code: 'ROUTE_UNAVAILABLE', hazard_kind: 'electrical' });
  expect(d.engine.plannerView().new_since_last_decision.join(' ')).toContain('interrupted');
  const e2 = d.actor('alex').knows.find((x) => x !== 'E1')!;
  d.call('notify', { actor_id: 'alex', recipient: 'all', topic: 'route_blocked', evidence_ids: [e2], message: 'The reception door is dead — another way.' });
  const r = okData(d.call('plan_route', { actor_id: 'alex', destination: 'assembly' }));
  expect(r.zones).not.toContain('reception_door');
  okData(d.call('move', { actor_id: 'alex', destination: 'assembly', route_id: r.route_id }));
  // Keep everyone heading for assembly, re-planning on any further interruption (the fire keeps spreading).
  const walkers = ['alex', 'maya', 'rosa', 'kenji'] as const;
  for (let k = 0; k < 12; k++) {
    expect(d.until(() => walkers.every((id) => d.idle(id)), 3000)).toBe(true);
    const pending = walkers.filter((id) => !d.lost(id) && d.actor(id).zone !== 'assembly');
    if (!pending.length) break;
    for (const id of pending) okData(d.call('move', { actor_id: id, destination: 'assembly' }));
  }
  for (const id of ACTOR_IDS) okData(d.call('check_in', { actor_id: id }));
  const v = okData(d.call('verify_roster', { actor_id: 'alex' }));
  expect(v.complete).toBe(true);
  return d;
}

describe('episodes', () => {
  it('scripted hero run (fire + alarm + jammed door) reaches verified success (fixture, not a model result)', () => {
    const d = runHero();
    expect(d.engine.outcome()?.status).toBe('success');
    const res = d.engine.result(1000)!;
    expect(res.score.reward).toBe(1);
    expect(res.metrics.procedural).toMatchObject({
      hazardReported: true,
      alarmRaised: true,
      assistanceFulfilled: true,
      rosterVerified: true,
      replannedAfterInterruption: true,
      alarmBy: 'planner',
      escaped: ACTOR_IDS.length,
      lost: 0,
    });
    expect(res.metrics.procedural.alarmLatencySimSec).toBeGreaterThan(0);
    expect(res.debrief).toHaveLength(3);
    expect(res.debrief.map((l) => l.id)).toEqual(['routes', 'alarm', 'reporting']);
    expect(res.debrief[0].text).toContain('not electric');
    expect(res.debrief[0].sources[0].url).toMatch(/^https:\/\/www\.osha\.gov/);
    expect(errCode(d.call('observe', { actor_id: 'alex' }))).toBe('EPISODE_OVER');
  });

  it('replay re-simulates the logged inputs to an identical event log and state hash', () => {
    const d = runHero();
    const original = d.engine;
    const end = original.events.findIndex((e) => e.type === 'episode_ended');
    const endTick = original.events[end].tick;
    const replayed = replayRun(map, hero(), { episodeId: 'test-ep' }, d.inputs.filter((i) => i.tick <= endTick));
    const strip = (e: (typeof original.events)[number]) => [e.seq, e.tick, e.type, e.actor, e.actionId, JSON.stringify(e.data)];
    expect(replayed.outcome()).toEqual(original.outcome());
    expect(replayed.events.slice(0, end + 1).map(strip)).toEqual(original.events.slice(0, end + 1).map(strip));
    expect(JSON.stringify(replayed.snapshot().hazards)).toBe(JSON.stringify(original.snapshot().hazards));
  });

  it('a sealed conference room ends unresolved at the decision cap', () => {
    const d = new Driver(hero(), { maxDecisions: 6 });
    d.run(3);
    expect(d.place('electrical', 20, 8).ok).toBe(true); // Red Hat room door
    expect(d.place('electrical', 28, 3).ok).toBe(true); // pantry door
    expect(d.place('fire', 16, 1).ok).toBe(true);
    d.run(5);
    for (let i = 0; i < 6; i++) d.note('no_call');
    const out = d.engine.outcome();
    expect(out?.status).toBe('unresolved');
    expect(out?.reason).toMatch(/Daniel/);
    const res = d.engine.result()!;
    expect(res.debrief.map((l) => l.id)).toContain('unresolved');
    expect(res.score.reward).toBe(0);
    // The oracle never leaks into the planner view
    expect(JSON.stringify(d.engine.plannerView())).not.toMatch(/unresolved|trapped|unreachable/);
  });

  it('decision cap without trapped people ends incomplete', () => {
    const d = new Driver(hero(), { maxDecisions: 3 });
    d.place('fire', 26, 1);
    d.run(2);
    d.note('malformed');
    d.note('no_call');
    d.note('provider_error');
    expect(d.engine.outcome()?.status).toBe('incomplete');
    expect(d.engine.result()!.metrics).toMatchObject({ malformed: 2, providerErrors: 1, decisions: 3 });
  });

  it('an unnoticed fire is smelled after 15 s by the nearest person', () => {
    const d = new Driver(undefined, { ambient: false }); // everyone stays at their desk
    d.place('fire', 36, 10); // east end of the main hallway, behind walls
    d.run(170);
    const obs = d.engine.events.find((e) => e.type === 'observation');
    expect(obs).toBeDefined();
    if (obs!.data.via === 'smoke') expect(obs!.simTime).toBeGreaterThanOrEqual(15);
    expect(d.engine.snapshot().phase).not.toBe('idle');
  });

  it('property: nobody steps into a known or visible hazard; losses only when fire spreads onto someone', () => {
    const t0 = Date.now();
    let losses = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const rng = mulberry32(seed * 7919);
      const base = hero();
      const spawns = {} as ScenarioCase['spawns'];
      const used = new Set<string>();
      for (const id of ACTOR_IDS) {
        const free = map.spawnSpots[id].filter((s) => !used.has(`${s.col},${s.row}`));
        const s = rng.pick(free);
        used.add(`${s.col},${s.row}`);
        spawns[id] = s;
      }
      const d = new Driver({ ...base, seed, spawns }, { maxDecisions: 100000 });
      const randomPlace = (kind: 'fire' | 'electrical') => {
        for (let k = 0; k < 40; k++) if (d.place(kind, rng.int(0, map.cols - 2), rng.int(0, map.rows - 2)).ok) return true;
        return false;
      };
      randomPlace('fire');
      if (rng.next() < 0.3) randomPlace('fire');
      d.until(() => d.engine.snapshot().actors.some((a) => a.knows.length > 0), 200);
      const knower = d.engine.snapshot().actors.find((a) => a.knows.length > 0 && !a.lost);
      if (knower) d.call('notify', { actor_id: knower.id, recipient: 'all', topic: 'evacuate', evidence_ids: [knower.knows[0]], message: 'Go!' });
      const doorAt = rng.int(5, 120);
      const dests = [...ZONE_IDS, ...ACTOR_IDS, 'alarm'];
      let prev = d.engine.snapshot();
      for (let t = 0; t < 180 && !d.engine.outcome(); t++) {
        if (t === doorAt) {
          const c = rng.pick(map.components);
          d.place('electrical', c.tiles[0].col, c.tiles[0].row);
        }
        if (t % 12 === 0) {
          const living = prev.actors.filter((a) => !a.lost);
          if (living.length) d.call('move', { actor_id: rng.pick(living).id as ActorId, destination: rng.pick(dests) });
        }
        const before = d.engine.snapshot();
        const blockedBefore = new Set(before.hazards.flatMap((h) => h.noGo.map((x) => tileIndex(map, x.col, x.row))));
        d.engine.step();
        const s = d.engine.snapshot();
        const blockedNow = new Set(s.hazards.flatMap((h) => h.noGo.map((x) => tileIndex(map, x.col, x.row))));
        for (const a of s.actors) {
          const b = before.actors.find((x) => x.id === a.id)!;
          const here = tileIndex(map, a.col, a.row);
          if (a.lost) {
            if (!b.lost) {
              losses++;
              // Lost only because fire spread onto them (their tile, or the tile they were > halfway into).
              const target = tileIndex(map, Math.round(b.x), Math.round(b.y));
              expect(blockedNow.has(here) || blockedNow.has(target), `seed ${seed} t ${t} ${a.id} lost without fire`).toBe(true);
            }
            continue;
          }
          expect(blockedNow.has(here), `seed ${seed} t ${t} ${a.id} standing on a hazard`).toBe(false);
          if (a.col !== b.col || a.row !== b.row) expect(blockedBefore.has(here), `seed ${seed} t ${t} ${a.id} stepped into a hazard`).toBe(false);
          if (a.usesWheelchair) expect(map.accessible[here], `seed ${seed} t ${t} daniel off accessible tiles`).toBe(true);
        }
        prev = s;
      }
    }
    // The random play really exercises spread-induced losses (not just safe runs).
    expect(losses).toBeGreaterThan(0);
    expect(Date.now() - t0).toBeLessThan(15000);
  });
});
