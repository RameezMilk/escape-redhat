import { describe, expect, it } from 'vitest';
import { Driver, errCode, hero, map, okData } from './helpers.js';
import { inEarshot, roomsOf } from '../src/index.js';

// Fire in doorway A: Maya (13,7) sees it, Daniel (15,12) and Alex (22,8) do not. Maya's instinctive shout reaches
// Daniel (same room) but not Alex (lobby), so she is sent to the hallway alarm (via door B → lobby → connector, door A
// is on fire) and pulls it on arrival.
function alerted() {
  const d = new Driver();
  d.run(5);
  d.place('fire', 8, 4);
  d.run(2);
  expect(d.actor('daniel').alerted).toBe(true); // heard Maya shout
  const r = okData(d.call('notify', { actor_id: 'maya', recipient: 'all', topic: 'fire', evidence_ids: ['E1'], message: 'Fire at door A!' }));
  expect(r).toMatchObject({ delivered_to: ['daniel'], not_reached: ['alex'] });
  expect(d.actor('alex').alerted).toBe(false);
  okData(d.call('move', { actor_id: 'maya', destination: 'alarm' }));
  expect(d.until(() => d.idle('maya'), 3000)).toBe(true);
  expect(d.actor('alex').alerted).toBe(true);
  expect(okData(d.call('pull_alarm', { actor_id: 'maya' }))).toMatchObject({ already_active: true });
  return d;
}

describe('tool validation never mutates state', () => {
  it('rejects bad calls with stable hash and useful codes', () => {
    const d = new Driver();
    d.run(5);
    d.place('fire', 8, 4);
    d.run(2);
    const h0 = d.engine.hash();
    const cases: [string, Record<string, unknown>, string][] = [
      ['teleport', { actor_id: 'alex' }, 'UNKNOWN_TOOL'],
      ['move', { actor_id: 'sarah', destination: 'assembly' }, 'INVALID_ARGUMENT'],
      ['move', { actor_id: 'alex', destination: 'mars' }, 'INVALID_ARGUMENT'],
      ['observe', { actor_id: 'alex', extra: 1 }, 'INVALID_ARGUMENT'],
      ['move', { actor_id: 'alex', destination: 'assembly' }, 'NOT_AUTHORIZED'],
      ['notify', { actor_id: 'alex', recipient: 'all', topic: 'fire', evidence_ids: ['E1'], message: 'x' }, 'UNKNOWN_EVIDENCE'],
      ['notify', { actor_id: 'maya', recipient: 'all', topic: 'fire', evidence_ids: ['E9'], message: 'x' }, 'UNKNOWN_EVIDENCE'],
      ['notify', { actor_id: 'maya', recipient: 'maya', topic: 'fire', evidence_ids: ['E1'], message: 'x' }, 'INVALID_ARGUMENT'],
      ['assist', { actor_id: 'alex', person_id: 'daniel' }, 'NOT_AUTHORIZED'],
      ['check_in', { actor_id: 'maya' }, 'OUT_OF_RANGE'],
      ['verify_roster', { actor_id: 'maya' }, 'NOT_AUTHORIZED'],
      ['verify_roster', { actor_id: 'alex' }, 'OUT_OF_RANGE'],
      ['request_assistance', { actor_id: 'alex', helper_id: 'maya' }, 'NOT_AUTHORIZED'],
      ['pull_alarm', { actor_id: 'alex' }, 'NOT_AUTHORIZED'],
      ['pull_alarm', { actor_id: 'maya' }, 'OUT_OF_RANGE'],
    ];
    for (const [name, args, code] of cases) {
      expect(errCode(d.call(name, args)), `${name} ${JSON.stringify(args)}`).toBe(code);
      expect(d.engine.hash(), `${name} mutated state`).toBe(h0);
    }
    const view = d.engine.plannerView();
    expect(view.recent_actions.length).toBe(8);
    expect(view.recent_actions.every((a) => !a.ok && a.error_code)).toBe(true);
    const far = d.call('pull_alarm', { actor_id: 'maya' });
    expect(far.ok ? '' : far.error.hint).toContain('move maya to destination "alarm"');
  });

  it('assistance needs consent and adjacency; idempotent on call id', () => {
    const d = alerted();
    expect(errCode(d.call('assist', { actor_id: 'alex', person_id: 'daniel' }))).toBe('ASSISTANCE_NOT_ACCEPTED');
    okData(d.call('request_assistance', { actor_id: 'daniel', helper_id: 'alex' }));
    const h = d.engine.hash();
    const far = d.call('assist', { actor_id: 'alex', person_id: 'daniel' });
    expect(errCode(far)).toBe('OUT_OF_RANGE');
    expect(far.ok ? null : far.error.hint).toContain("move alex to 'daniel'");
    expect(d.engine.hash()).toBe(h);
    const first = d.call('move', { actor_id: 'alex', destination: 'daniel' }, 'dup-1');
    const nEvents = d.engine.events.length;
    const again = d.call('move', { actor_id: 'alex', destination: 'daniel' }, 'dup-1');
    expect(again).toBe(first);
    expect(d.engine.events.length).toBe(nEvents);
    expect(errCode(d.call('assist', { actor_id: 'alex', person_id: 'daniel' }))).toBe('ACTOR_BUSY');
    expect(d.until(() => d.idle('alex'))).toBe(true);
    okData(d.call('assist', { actor_id: 'alex', person_id: 'daniel' }));
    expect(d.actor('daniel').escort).toEqual({ role: 'follower', partner: 'alex' });
  });

  it('unalerted actors cannot evacuate until told; plan_route and the view ignore unseen hazards', () => {
    const d = new Driver();
    d.run(3);
    d.place('fire', 8, 4);
    d.run(2);
    // Maya's instinctive shout alerted Daniel (same room); Alex in the lobby heard nothing and may not evacuate yet.
    expect(d.actor('daniel').alerted).toBe(true);
    expect(d.actor('daniel').knows).toEqual(['E1']);
    expect(d.actor('alex').alerted).toBe(false);
    const no = d.call('move', { actor_id: 'alex', destination: 'assembly' });
    expect(errCode(no)).toBe('NOT_AUTHORIZED');
    expect(no.ok ? '' : no.error.hint).toContain('pull the fire alarm');
    // South door jammed, out of everyone's sight: plan_route must still use it (unknown).
    expect(d.place('electrical', 26, 15).ok).toBe(true);
    const r = okData(d.call('plan_route', { actor_id: 'daniel', destination: 'assembly' }));
    expect(r.zones).toContain('south_branch');
    expect(r.accessible).toBe(true);
    // Planner view never reveals the unobserved door or unseen fire cells
    const view = d.engine.plannerView();
    expect(JSON.stringify(view)).not.toContain('electrical');
    for (const e of view.evidence) expect(e.cells_known).toBeLessThanOrEqual(d.engine.snapshot().hazards.find((h) => h.kind === 'fire')!.noGo.length);
    expect(view.evidence).toHaveLength(1);
    expect(JSON.stringify(view)).not.toMatch(/"cells"|"tiles"/);
  });

  it('stale route after learning of a jammed door', () => {
    const d = alerted();
    const route = okData(d.call('plan_route', { actor_id: 'alex', destination: 'assembly' }));
    expect(route.zones).toContain('south_branch');
    expect(d.place('electrical', 26, 15).ok).toBe(true);
    // Alex heads for the east exit through the (unknown) jammed door and is interrupted on sight
    okData(d.call('move', { actor_id: 'alex', destination: 'east_exit' }));
    expect(d.until(() => d.idle('alex'))).toBe(true);
    const ev = d.engine.events.filter((e) => e.type === 'move_interrupted');
    expect(ev.length).toBe(1);
    expect(ev[0].data).toMatchObject({ code: 'ROUTE_UNAVAILABLE', hazard_kind: 'electrical', component: 'south_door' });
    const e2 = d.actor('alex').knows.find((x) => x !== 'E1')!;
    expect(d.engine.plannerView().evidence.find((e) => e.id === e2)).toMatchObject({ kind: 'electrical', component: 'south_door', cells_known: 2 });
    const stale = d.call('move', { actor_id: 'alex', destination: 'assembly', route_id: route.route_id });
    expect(errCode(stale)).toBe('STALE_STATE');
    // The re-plan avoids what Alex knows (the jammed door + any fire cells he has actually seen) — never unseen cells.
    expect(d.actor('alex').knows).toContain(e2);
    const r2 = okData(d.call('plan_route', { actor_id: 'alex', destination: 'assembly' }));
    expect(r2.zones).not.toContain('south_branch');
    expect(r2.zones).toContain('west_exit');
  });

  it('a jammed door blocks sight of the fire behind it', () => {
    const d = new Driver(); // Alex at (22,8) in the lobby
    expect(d.place('electrical', 18, 9).ok).toBe(true);
    d.run(2);
    expect(d.actor('alex').knows).toEqual(['E1']); // sees the jammed door B
    expect(d.engine.plannerView().evidence[0]).toMatchObject({ kind: 'electrical', component: 'door_b' });
    expect(d.place('fire', 15, 9).ok).toBe(true);
    d.run(3);
    expect(d.actor('alex').knows).toEqual(['E1']);
  });
});

describe('fire alarm', () => {
  it('needs a pull station; alerts everyone; idempotent; does not share hazard locations', () => {
    const d = new Driver();
    d.run(3);
    d.place('fire', 6, 12);
    d.run(2);
    expect(d.actor('maya').knows).toEqual(['E1']);
    expect(errCode(d.call('pull_alarm', { actor_id: 'maya' }))).toBe('OUT_OF_RANGE');
    const mv = okData(d.call('move', { actor_id: 'maya', destination: 'alarm' }));
    expect(errCode(d.call('pull_alarm', { actor_id: 'maya' }))).toBe('ACTOR_BUSY');
    expect(mv.zones).toBeDefined();
    // Sent to the alarm by the planner, Maya pulls it as soon as she is within reach of the station (the planner's pull).
    expect(d.until(() => d.engine.snapshot().alarm.active)).toBe(true);
    expect(d.actor('maya').zone).toBe('north_corridor');
    expect(d.until(() => d.idle('maya'))).toBe(true);
    expect([d.actor('maya').col, d.actor('maya').row]).toEqual([14, 1]); // the single hallway pull station
    for (const id of ['alex', 'maya', 'daniel']) expect(d.actor(id).alerted).toBe(true);
    expect(d.actor('alex').knows).toEqual([]);
    expect(d.engine.snapshot().alarm).toMatchObject({ active: true, by: 'maya', stationId: 'alarm_corridor' });
    expect(d.engine.plannerView().alarm).toMatchObject({ active: true, by: 'maya' });
    const ev = d.engine.events.find((e) => e.type === 'alarm_activated')!;
    expect(ev).toMatchObject({ actor: 'maya', actionId: expect.any(String), data: { station: 'alarm_corridor', via: 'tool', newly_alerted: ['alex'] } });
    expect(okData(d.call('pull_alarm', { actor_id: 'maya' }))).toMatchObject({ already_active: true });
    // Alerted by the alarm alone, Alex may now evacuate
    okData(d.call('move', { actor_id: 'alex', destination: 'assembly' }));
  });
});

describe('check-in, roster and outcomes', () => {
  it('verify_roster before everyone is in returns outstanding without success', () => {
    const d = alerted();
    okData(d.call('move', { actor_id: 'alex', destination: 'assembly' }));
    expect(d.until(() => d.idle('alex'), 3000)).toBe(true);
    okData(d.call('check_in', { actor_id: 'alex' }));
    const v = okData(d.call('verify_roster', { actor_id: 'alex' }));
    expect(v.complete).toBe(false);
    expect(v.outstanding).toEqual(['maya', 'daniel']);
    expect(d.engine.outcome()).toBeNull();
    expect(errCode(d.call('move', { actor_id: 'alex', destination: 'lobby' }))).toBe('NOT_AUTHORIZED');
  });

  it('someone lost, survivors checked in and verified → partial', () => {
    // Everyone in the Red Hat room so Maya's warning reaches them: Maya (13,7), Daniel (15,12), Alex (12,13).
    // Instincts off so Maya stays at her desk; backing away by instinct, she can outrun the fire on some seeds.
    const base = hero();
    const d = new Driver({ ...base, spawns: { ...base.spawns, alex: { col: 12, row: 13, dir: 'up', pose: 'stand' } } }, { instincts: false });
    expect(d.place('fire', 11, 7).ok).toBe(true);
    d.run(2);
    okData(d.call('notify', { actor_id: 'maya', recipient: 'all', topic: 'fire', evidence_ids: ['E1'], message: 'Fire!' }));
    okData(d.call('move', { actor_id: 'alex', destination: 'assembly' }));
    okData(d.call('move', { actor_id: 'daniel', destination: 'assembly' }));
    // Check in on arrival: the building's south wall can be burning near the assembly point later on.
    expect(d.until(() => d.idle('alex') && d.idle('daniel'), 3000)).toBe(true);
    okData(d.call('check_in', { actor_id: 'alex' }));
    okData(d.call('check_in', { actor_id: 'daniel' }));
    expect(d.until(() => d.lost('maya'), 3000)).toBe(true);
    const v = okData(d.call('verify_roster', { actor_id: 'alex' }));
    expect(v).toMatchObject({ complete: true, lost: ['maya'] });
    expect(d.engine.outcome()!.status).toBe('partial');
    const res = d.engine.result()!;
    expect(res.score.reward).toBe(0);
    expect(res.metrics.procedural).toMatchObject({ escaped: 2, lost: 1 });
    expect(res.debrief[0].id).toBe('losses');
  });
});

describe('earshot: spoken alerts reach only the same room', () => {
  it('rooms: doorways join both sides; outside is one room', () => {
    expect(roomsOf(map, 'rh_room')).toEqual(['rh_room']);
    expect(roomsOf(map, 'door_b')).toEqual(['lobby', 'rh_room']);
    expect(roomsOf(map, 'connector')).toEqual(['lobby', 'north_corridor']);
    expect(roomsOf(map, 'west_exit')).toEqual(['north_corridor', 'outside']);
    expect(inEarshot(map, 'rh_room', 'lobby')).toBe(false);
    expect(inEarshot(map, 'door_b', 'lobby')).toBe(true);
    expect(inEarshot(map, 'door_b', 'rh_room')).toBe(true);
    expect(inEarshot(map, 'plaza', 'assembly')).toBe(true);
    expect(inEarshot(map, 'west_sidewalk', 'assembly')).toBe(true);
    expect(inEarshot(map, 'south_branch', 'lobby')).toBe(false);
    expect(inEarshot(map, null, 'lobby')).toBe(false);
  });

  it('notify all reaches the room only; out-of-earshot named recipient and empty rooms are rejected without mutation', () => {
    const d = new Driver(); // Maya (13,7) + Daniel (15,12) in rh_room; Alex (22,8) in the lobby
    d.run(5);
    d.place('fire', 8, 4);
    d.run(2);
    const h0 = d.engine.hash();
    const named = d.call('notify', { actor_id: 'maya', recipient: 'alex', topic: 'fire', evidence_ids: ['E1'], message: 'Alex, fire!' });
    expect(errCode(named)).toBe('OUT_OF_RANGE');
    expect(named.ok ? null : named.error.details).toMatchObject({ recipient_zone: 'lobby', speaker_zone: 'rh_room' });
    expect(named.ok ? '' : named.error.hint).toContain('hallway fire alarm');
    expect(named.ok ? '' : named.error.message).toBe('Alex is in the NVIDIA lobby — out of earshot of Maya in the Red Hat room.');
    expect(d.engine.hash()).toBe(h0);
    const all = okData(d.call('notify', { actor_id: 'maya', recipient: 'all', topic: 'fire', evidence_ids: ['E1'], message: 'Fire!' }));
    expect(all).toMatchObject({ delivered_to: ['daniel'], not_reached: ['alex'] });
    expect(d.actor('daniel').alerted).toBe(true);
    expect(d.actor('alex').alerted).toBe(false);
    expect(d.actor('alex').knows).toEqual([]);
    const msg = d.engine.events.filter((e) => e.type === 'message_delivered').at(-1)!;
    expect(msg.data).toMatchObject({ recipients: ['daniel'], not_reached: ['alex'] });
  });

  it("'all' with nobody in earshot is OUT_OF_RANGE (state unchanged)", () => {
    const d = new Driver(); // Alex alone in the lobby
    expect(d.place('electrical', 18, 9).ok).toBe(true);
    d.run(2);
    expect(d.actor('alex').knows).toEqual(['E1']);
    const h0 = d.engine.hash();
    const r = d.call('notify', { actor_id: 'alex', recipient: 'all', topic: 'route_blocked', evidence_ids: ['E1'], message: 'Door B is dead.' });
    expect(errCode(r)).toBe('OUT_OF_RANGE');
    expect(r.ok ? '' : r.error.message).toBe('Nobody is within earshot of Alex in the NVIDIA lobby.');
    expect(d.engine.hash()).toBe(h0);
  });

  it('someone standing in a doorway is heard on both sides', () => {
    const base = hero();
    const d = new Driver({ ...base, spawns: { ...base.spawns, maya: { col: 18, row: 9, dir: 'left', pose: 'stand' } } }, { ambient: false });
    d.place('fire', 12, 12);
    d.run(3);
    expect(d.actor('maya').zone).toBe('door_b');
    expect(d.actor('maya').knows).toContain('E1');
    const r = okData(d.call('notify', { actor_id: 'maya', recipient: 'all', topic: 'fire', evidence_ids: ['E1'], message: 'Fire! Everyone out!' }));
    expect([...(r.delivered_to as string[])].sort()).toEqual(['alex', 'daniel']);
    expect(r.not_reached).toEqual([]);
  });
});
