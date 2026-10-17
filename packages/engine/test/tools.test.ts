import { describe, expect, it } from 'vitest';
import { Driver, errCode, okData } from './helpers.js';

// Fire in doorway A: Maya (13,7) sees it, Daniel (15,12) and Alex (22,8) do not.
function alerted() {
  const d = new Driver();
  d.run(5);
  d.place('fire', 8, 4);
  d.run(2);
  okData(d.call('notify', { actor_id: 'maya', recipient: 'all', topic: 'fire', evidence_ids: ['E1'], message: 'Fire at door A!' }));
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
      ['request_assistance', { actor_id: 'daniel', helper_id: 'alex' }, 'NOT_AUTHORIZED'],
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

  it('unalerted actors cannot evacuate until notified; plan_route and the view ignore unseen hazards', () => {
    const d = new Driver();
    d.run(3);
    d.place('fire', 8, 4);
    d.run(2);
    expect(errCode(d.call('move', { actor_id: 'daniel', destination: 'assembly' }))).toBe('NOT_AUTHORIZED');
    okData(d.call('notify', { actor_id: 'maya', recipient: 'daniel', topic: 'fire', evidence_ids: ['E1'], message: 'Fire!' }));
    expect(d.actor('daniel').alerted).toBe(true);
    expect(d.actor('alex').alerted).toBe(false);
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
    const r2 = okData(d.call('plan_route', { actor_id: 'alex', destination: 'assembly' }));
    expect(r2.zones).toContain('connector');
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
    expect(d.until(() => d.idle('maya'))).toBe(true);
    expect([d.actor('maya').col, d.actor('maya').row]).toEqual([17, 12]);
    expect(d.actor('alex').alerted).toBe(false);
    const r = okData(d.call('pull_alarm', { actor_id: 'maya' }));
    expect(r).toMatchObject({ alarm: 'active', station: 'alarm_rh' });
    for (const id of ['alex', 'maya', 'daniel']) expect(d.actor(id).alerted).toBe(true);
    expect(d.actor('alex').knows).toEqual([]);
    expect(d.engine.snapshot().alarm).toMatchObject({ active: true, by: 'maya', stationId: 'alarm_rh' });
    expect(d.engine.plannerView().alarm).toMatchObject({ active: true, by: 'maya' });
    const ev = d.engine.events.find((e) => e.type === 'alarm_activated')!;
    expect(ev).toMatchObject({ actor: 'maya', data: { station: 'alarm_rh' } });
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
    const d = new Driver(); // Maya at (13,7), Daniel (15,12), Alex (22,8)
    expect(d.place('fire', 11, 7).ok).toBe(true);
    d.run(2);
    okData(d.call('notify', { actor_id: 'maya', recipient: 'all', topic: 'fire', evidence_ids: ['E1'], message: 'Fire!' }));
    okData(d.call('move', { actor_id: 'alex', destination: 'assembly' }));
    okData(d.call('move', { actor_id: 'daniel', destination: 'assembly' }));
    expect(d.until(() => d.lost('maya'), 3000)).toBe(true);
    expect(d.until(() => d.idle('alex') && d.idle('daniel'), 3000)).toBe(true);
    okData(d.call('check_in', { actor_id: 'alex' }));
    okData(d.call('check_in', { actor_id: 'daniel' }));
    const v = okData(d.call('verify_roster', { actor_id: 'alex' }));
    expect(v).toMatchObject({ complete: true, lost: ['maya'] });
    expect(d.engine.outcome()!.status).toBe('partial');
    const res = d.engine.result()!;
    expect(res.score.reward).toBe(0);
    expect(res.metrics.procedural).toMatchObject({ escaped: 2, lost: 1 });
    expect(res.debrief[0].id).toBe('losses');
  });
});
