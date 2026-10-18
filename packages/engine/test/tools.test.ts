import { describe, expect, it } from 'vitest';
import { Driver, errCode, hero, map, okData } from './helpers.js';
import { inEarshot, roomsOf } from '../src/index.js';
import { tilesOf } from './mapFixtures.js';

// Fire in the Red Hat room's far corner: Daniel (18,5) sees it — alone in the room, so nobody hears him. Alex and Maya
// (cubicles), Rosa (reception) and Kenji (server room) know nothing yet.
function roomFire() {
  const d = new Driver(undefined, { ambient: false });
  d.run(5);
  d.place('fire', 26, 1);
  d.run(2);
  expect(d.actor('daniel').knows).toEqual(['E1']);
  return d;
}

// Fire at the west end of the cubicles: Maya (13,15) sees it and shouts by instinct, so Alex (same room) hears.
function cubicleFire(opts: { ambient?: boolean } = { ambient: false }) {
  const base = hero();
  const d = new Driver({ ...base, spawns: { ...base.spawns, maya: { col: 13, row: 15, dir: 'up', pose: 'sit' } } }, opts);
  d.run(5);
  d.place('fire', 5, 16);
  d.run(2);
  return d;
}

/** Daniel goes to the nearest pull station and pulls it: everyone is alerted. */
function alarmed() {
  const d = roomFire();
  okData(d.call('move', { actor_id: 'daniel', destination: 'alarm' }));
  expect(d.until(() => d.engine.snapshot().alarm.active, 3000)).toBe(true);
  expect(d.until(() => d.idle('daniel'), 3000)).toBe(true);
  for (const id of ['alex', 'maya', 'rosa', 'kenji']) expect(d.actor(id).alerted, id).toBe(true);
  return d;
}

describe('tool validation never mutates state', () => {
  it('rejects bad calls with stable hash and useful codes', () => {
    const d = roomFire();
    const h0 = d.engine.hash();
    const cases: [string, Record<string, unknown>, string][] = [
      ['teleport', { actor_id: 'alex' }, 'UNKNOWN_TOOL'],
      ['move', { actor_id: 'sarah', destination: 'assembly' }, 'INVALID_ARGUMENT'],
      ['move', { actor_id: 'alex', destination: 'mars' }, 'INVALID_ARGUMENT'],
      ['observe', { actor_id: 'alex', extra: 1 }, 'INVALID_ARGUMENT'],
      ['move', { actor_id: 'alex', destination: 'assembly' }, 'NOT_AUTHORIZED'],
      ['notify', { actor_id: 'alex', recipient: 'all', topic: 'fire', evidence_ids: ['E1'], message: 'x' }, 'UNKNOWN_EVIDENCE'],
      ['notify', { actor_id: 'daniel', recipient: 'all', topic: 'fire', evidence_ids: ['E9'], message: 'x' }, 'UNKNOWN_EVIDENCE'],
      ['notify', { actor_id: 'daniel', recipient: 'daniel', topic: 'fire', evidence_ids: ['E1'], message: 'x' }, 'INVALID_ARGUMENT'],
      ['assist', { actor_id: 'alex', person_id: 'daniel' }, 'NOT_AUTHORIZED'],
      ['check_in', { actor_id: 'daniel' }, 'OUT_OF_RANGE'],
      ['verify_roster', { actor_id: 'maya' }, 'NOT_AUTHORIZED'],
      ['verify_roster', { actor_id: 'alex' }, 'OUT_OF_RANGE'],
      ['request_assistance', { actor_id: 'alex', helper_id: 'maya' }, 'NOT_AUTHORIZED'],
      ['pull_alarm', { actor_id: 'alex' }, 'NOT_AUTHORIZED'],
      ['pull_alarm', { actor_id: 'daniel' }, 'OUT_OF_RANGE'],
    ];
    for (const [name, args, code] of cases) {
      expect(errCode(d.call(name, args)), `${name} ${JSON.stringify(args)}`).toBe(code);
      expect(d.engine.hash(), `${name} mutated state`).toBe(h0);
    }
    const view = d.engine.plannerView();
    expect(view.recent_actions.length).toBe(8);
    expect(view.recent_actions.every((a) => !a.ok && a.error_code)).toBe(true);
    const far = d.call('pull_alarm', { actor_id: 'daniel' });
    expect(far.ok ? '' : far.error.hint).toContain('move daniel to destination "alarm"');
  });

  it('assistance needs consent and adjacency; idempotent on call id', () => {
    const d = alarmed();
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
    expect(d.until(() => d.idle('alex'), 3000)).toBe(true);
    okData(d.call('assist', { actor_id: 'alex', person_id: 'daniel' }));
    expect(d.actor('daniel').escort).toEqual({ role: 'follower', partner: 'alex' });
  });

  it('unalerted actors cannot evacuate until told; plan_route and the view ignore unseen hazards', () => {
    const d = roomFire();
    expect(d.actor('alex').alerted).toBe(false);
    const no = d.call('move', { actor_id: 'alex', destination: 'assembly' });
    expect(errCode(no)).toBe('NOT_AUTHORIZED');
    expect(no.ok ? '' : no.error.hint).toContain('pull the fire alarm');
    // The reception door jammed, out of everyone's sight: plan_route must still use it (unknown).
    expect(d.place('electrical', 31, 12).ok).toBe(true);
    const r = okData(d.call('plan_route', { actor_id: 'daniel', destination: 'assembly' }));
    expect(r.zones).toContain('reception_door');
    expect(r.accessible).toBe(true);
    // Planner view never reveals the unobserved door or unseen fire cells
    const view = d.engine.plannerView();
    expect(JSON.stringify(view)).not.toContain('electrical');
    for (const e of view.evidence) expect(e.cells_known).toBeLessThanOrEqual(d.engine.snapshot().hazards.find((h) => h.kind === 'fire')!.noGo.length);
    expect(view.evidence).toHaveLength(1);
    expect(JSON.stringify(view)).not.toMatch(/"cells"|"tiles"/);
  });

  it('stale route after learning of a jammed door', () => {
    const d = roomFire();
    const route = okData(d.call('plan_route', { actor_id: 'daniel', destination: 'assembly' }));
    expect(route.zones).toContain('reception_door');
    expect(d.place('electrical', 31, 12).ok).toBe(true);
    // Daniel heads out through the (unknown) jammed reception door and is interrupted on sight
    okData(d.call('move', { actor_id: 'daniel', destination: 'assembly' }));
    expect(d.until(() => d.idle('daniel'), 3000)).toBe(true);
    const ev = d.engine.events.filter((e) => e.type === 'move_interrupted');
    expect(ev.length).toBe(1);
    expect(ev[0].data).toMatchObject({ code: 'ROUTE_UNAVAILABLE', hazard_kind: 'electrical', component: 'reception_door' });
    const e2 = d.actor('daniel').knows.find((x) => x !== 'E1')!;
    expect(d.engine.plannerView().evidence.find((e) => e.id === e2)).toMatchObject({ kind: 'electrical', component: 'reception_door', cells_known: 2 });
    const stale = d.call('move', { actor_id: 'daniel', destination: 'assembly', route_id: route.route_id });
    expect(errCode(stale)).toBe('STALE_STATE');
    // The re-plan avoids what Daniel knows (the jammed door + any fire cells he has actually seen) — never unseen cells.
    expect(d.actor('daniel').knows).toContain(e2);
    const r2 = okData(d.call('plan_route', { actor_id: 'daniel', destination: 'assembly' }));
    expect(r2.zones).not.toContain('reception_door');
    expect(r2.accessible).toBe(true);
  });

  it('from an exit doorway the route to the assembly point goes around the building, not back through it (both modes)', () => {
    const exitTile = tilesOf('west_exit')[0];
    for (const instincts of [true, false]) {
      const base = hero();
      const d = new Driver({ ...base, spawns: { ...base.spawns, maya: { ...exitTile, dir: 'left', pose: 'stand' } } }, { ambient: false, instincts });
      d.run(5);
      d.place('fire', 26, 1); // Red Hat room: Daniel sees it and pulls the hallway alarm
      d.run(2);
      okData(d.call('move', { actor_id: 'daniel', destination: 'alarm' }));
      expect(d.until(() => d.actor('maya').alerted, 3000)).toBe(true);
      // Through the hallway, the cubicles and reception is shorter than the sidewalk — but she is already in the doorway.
      const route = okData(d.call('plan_route', { actor_id: 'maya', destination: 'assembly' }));
      expect(route.zones, `instincts ${instincts}`).toEqual(['west_exit', 'sidewalk', 'crosswalk', 'assembly']);
      const stay = okData(d.call('move', { actor_id: 'maya', destination: 'west_exit' }));
      expect(stay).toMatchObject({ already_there: true });
      expect(String(stay.next)).toContain('"assembly"');
    }
  });

  it('a jammed door blocks sight of the fire behind it', () => {
    const d = new Driver(undefined, { ambient: false }); // Kenji at his console (11,6), alone in the server room
    expect(d.place('electrical', 7, 8).ok).toBe(true);
    d.run(2);
    expect(d.actor('kenji').knows).toEqual(['E1']); // sees the jammed server-room door
    expect(d.engine.plannerView().evidence[0]).toMatchObject({ kind: 'electrical', component: 'server_door' });
    expect(d.place('fire', 6, 10).ok).toBe(true); // in the hallway, behind the dead door
    d.run(3);
    expect(d.actor('kenji').knows).toEqual(['E1']);
  });
});

describe('fire alarm', () => {
  it('needs a pull station; alerts everyone; idempotent; does not share hazard locations', () => {
    const d = roomFire();
    expect(errCode(d.call('pull_alarm', { actor_id: 'daniel' }))).toBe('OUT_OF_RANGE');
    const mv = okData(d.call('move', { actor_id: 'daniel', destination: 'alarm' }));
    expect(errCode(d.call('pull_alarm', { actor_id: 'daniel' }))).toBe('ACTOR_BUSY');
    expect(mv.zones).toBeDefined();
    // Sent to the alarm by the planner, Daniel pulls it as soon as he is within reach of the station (the planner's pull).
    expect(d.until(() => d.engine.snapshot().alarm.active)).toBe(true);
    const stationId = d.engine.snapshot().alarm.stationId!;
    const st = map.alarms.find((a) => a.id === stationId)!;
    expect(d.actor('daniel').zone).toBe(st.zone);
    expect(d.until(() => d.idle('daniel'))).toBe(true);
    expect([d.actor('daniel').col, d.actor('daniel').row]).toEqual([st.stand.col, st.stand.row]); // the nearest pull station
    for (const id of ['alex', 'maya', 'daniel', 'rosa', 'kenji']) expect(d.actor(id).alerted).toBe(true);
    expect(d.actor('alex').knows).toEqual([]);
    expect(d.engine.snapshot().alarm).toMatchObject({ active: true, by: 'daniel', stationId });
    expect(d.engine.plannerView().alarm).toMatchObject({ active: true, by: 'daniel' });
    const ev = d.engine.events.find((e) => e.type === 'alarm_activated')!;
    expect(ev).toMatchObject({ actor: 'daniel', actionId: expect.any(String), data: { station: stationId, via: 'tool', newly_alerted: ['alex', 'maya', 'rosa', 'kenji'] } });
    expect(okData(d.call('pull_alarm', { actor_id: 'daniel' }))).toMatchObject({ already_active: true });
    // Alerted by the alarm alone, Alex may now evacuate
    okData(d.call('move', { actor_id: 'alex', destination: 'assembly' }));
  });
});

describe('check-in, roster and outcomes', () => {
  it('verify_roster before everyone is in returns outstanding without success', () => {
    const d = alarmed();
    okData(d.call('move', { actor_id: 'alex', destination: 'assembly' }));
    expect(d.until(() => d.idle('alex'), 3000)).toBe(true);
    okData(d.call('check_in', { actor_id: 'alex' }));
    const v = okData(d.call('verify_roster', { actor_id: 'alex' }));
    expect(v.complete).toBe(false);
    expect(v.outstanding).toEqual(['maya', 'daniel', 'rosa', 'kenji']);
    expect(d.engine.outcome()).toBeNull();
    expect(errCode(d.call('move', { actor_id: 'alex', destination: 'reception' }))).toBe('NOT_AUTHORIZED');
  });

  it('someone lost, survivors checked in and verified → partial', () => {
    // Everyone but Daniel already at the bus stop; Daniel at the conference table with a fire beside him. Instincts
    // off so he stays put (backing away by instinct, he could outrun it).
    const base = hero();
    const at = (col: number) => ({ col, row: 26, dir: 'down' as const, pose: 'stand' as const });
    const d = new Driver({ ...base, spawns: { ...base.spawns, alex: at(29), maya: at(30), rosa: at(31), kenji: at(32) } }, { instincts: false, ambient: false });
    expect(d.place('fire', 16, 5).ok).toBe(true);
    d.run(2);
    for (const id of ['alex', 'maya', 'rosa', 'kenji']) okData(d.call('check_in', { actor_id: id }));
    expect(d.until(() => d.lost('daniel'), 3000)).toBe(true);
    const v = okData(d.call('verify_roster', { actor_id: 'alex' }));
    expect(v).toMatchObject({ complete: true, lost: ['daniel'] });
    expect(d.engine.outcome()!.status).toBe('partial');
    const res = d.engine.result()!;
    expect(res.score.reward).toBe(0);
    expect(res.metrics.procedural).toMatchObject({ escaped: 4, lost: 1 });
    expect(res.debrief[0].id).toBe('losses');
  });
});

describe('earshot: spoken alerts reach only the same room', () => {
  it('rooms: doorways join both sides; outside is one room', () => {
    expect(roomsOf(map, 'rh_room')).toEqual(['rh_room']);
    expect(roomsOf(map, 'rh_door')).toEqual(['hallway', 'rh_room']);
    expect(roomsOf(map, 'pantry_door')).toEqual(['kitchen', 'rh_room']);
    expect(roomsOf(map, 'west_exit')).toEqual(['hallway', 'outside']);
    expect(roomsOf(map, 'main_entrance')).toEqual(['outside', 'reception']);
    expect(inEarshot(map, 'rh_room', 'hallway')).toBe(false);
    expect(inEarshot(map, 'rh_door', 'hallway')).toBe(true);
    expect(inEarshot(map, 'rh_door', 'rh_room')).toBe(true);
    expect(inEarshot(map, 'sidewalk', 'assembly')).toBe(true);
    expect(inEarshot(map, 'crosswalk', 'far_sidewalk')).toBe(true);
    expect(inEarshot(map, 'server_room', 'hallway')).toBe(false);
    expect(inEarshot(map, null, 'hallway')).toBe(false);
  });

  it('notify all reaches the room only; out-of-earshot named recipient and empty rooms are rejected without mutation', () => {
    const d = cubicleFire(); // Maya (13,15) + Alex (20,15) in the cubicles; Daniel in the Red Hat room
    const h0 = d.engine.hash();
    const named = d.call('notify', { actor_id: 'maya', recipient: 'daniel', topic: 'fire', evidence_ids: ['E1'], message: 'Daniel, fire!' });
    expect(errCode(named)).toBe('OUT_OF_RANGE');
    expect(named.ok ? null : named.error.details).toMatchObject({ recipient_zone: 'rh_room', speaker_zone: 'cubicles' });
    expect(named.ok ? '' : named.error.hint).toContain('a fire alarm');
    expect(named.ok ? '' : named.error.message).toBe('Daniel is in the Red Hat room — out of earshot of Maya in the cubicles.');
    expect(d.engine.hash()).toBe(h0);
    const all = okData(d.call('notify', { actor_id: 'maya', recipient: 'all', topic: 'fire', evidence_ids: ['E1'], message: 'Fire!' }));
    expect(all).toMatchObject({ delivered_to: ['alex'], not_reached: ['daniel', 'rosa', 'kenji'] });
    expect(d.actor('alex').alerted).toBe(true);
    expect(d.actor('daniel').alerted).toBe(false);
    expect(d.actor('daniel').knows).toEqual([]);
    const msg = d.engine.events.filter((e) => e.type === 'message_delivered').at(-1)!;
    expect(msg.data).toMatchObject({ recipients: ['alex'], not_reached: ['daniel', 'rosa', 'kenji'] });
  });

  it("'all' with nobody in earshot is OUT_OF_RANGE (state unchanged)", () => {
    const d = new Driver(undefined, { ambient: false }); // Kenji alone in the server room
    expect(d.place('electrical', 7, 8).ok).toBe(true);
    d.run(2);
    expect(d.actor('kenji').knows).toEqual(['E1']);
    const h0 = d.engine.hash();
    const r = d.call('notify', { actor_id: 'kenji', recipient: 'all', topic: 'route_blocked', evidence_ids: ['E1'], message: 'The server-room door is dead.' });
    expect(errCode(r)).toBe('OUT_OF_RANGE');
    expect(r.ok ? '' : r.error.message).toBe('Nobody is within earshot of Kenji in the GPU server room.');
    expect(d.engine.hash()).toBe(h0);
  });

  it('someone standing in a doorway is heard on both sides', () => {
    const base = hero();
    const spawns = { ...base.spawns, maya: { col: 20, row: 8, dir: 'up' as const, pose: 'stand' as const }, alex: { col: 22, row: 10, dir: 'up' as const, pose: 'stand' as const } };
    const d = new Driver({ ...base, spawns }, { ambient: false });
    d.place('fire', 26, 1);
    d.run(3);
    expect(d.actor('maya').zone).toBe('rh_door');
    expect(d.actor('maya').knows).toContain('E1');
    const r = okData(d.call('notify', { actor_id: 'maya', recipient: 'all', topic: 'fire', evidence_ids: ['E1'], message: 'Fire! Everyone out!' }));
    expect([...(r.delivered_to as string[])].sort()).toEqual(['alex', 'daniel']);
    expect(r.not_reached).toEqual(['rosa', 'kenji']);
  });
});
