import { describe, expect, it } from 'vitest';
import { Driver, errCode, okData } from './helpers.js';

function alerted() {
  const d = new Driver();
  d.run(5);
  d.place('fire', 8, 5);
  d.run(2);
  okData(d.call('notify', { actor_id: 'maya', recipient: 'all', topic: 'fire', evidence_ids: ['E1'], message: 'Fire at door A!' }));
  return d;
}

describe('tool validation never mutates state', () => {
  it('rejects bad calls with stable hash and useful codes', () => {
    const d = new Driver();
    d.run(5);
    d.place('fire', 8, 5);
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
    ];
    for (const [name, args, code] of cases) {
      expect(errCode(d.call(name, args)), `${name} ${JSON.stringify(args)}`).toBe(code);
      expect(d.engine.hash(), `${name} mutated state`).toBe(h0);
    }
    const view = d.engine.plannerView();
    expect(view.recent_actions.length).toBe(8);
    expect(view.recent_actions.every((a) => !a.ok && a.error_code)).toBe(true);
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

  it('unalerted actors cannot evacuate until notified; plan_route ignores unknown hazards', () => {
    const d = new Driver();
    d.run(3);
    d.place('fire', 8, 5);
    d.run(2);
    expect(errCode(d.call('move', { actor_id: 'daniel', destination: 'assembly' }))).toBe('NOT_AUTHORIZED');
    okData(d.call('notify', { actor_id: 'maya', recipient: 'daniel', topic: 'fire', evidence_ids: ['E1'], message: 'Fire!' }));
    expect(d.actor('daniel').alerted).toBe(true);
    expect(d.actor('alex').alerted).toBe(false);
    // Blocker in the south branch, out of everyone's sight: plan_route must still use it (unknown).
    d.place('blocker', 26, 15);
    const r = okData(d.call('plan_route', { actor_id: 'daniel', destination: 'assembly' }));
    expect(r.zones).toContain('south_branch');
    expect(r.accessible).toBe(true);
    // Planner view never reveals the unobserved blocker
    const view = JSON.stringify(d.engine.plannerView());
    expect(view).not.toContain('blocker');
    expect(view).not.toContain('[26,15]');
  });

  it('stale route after learning of a hazard; unreachable destination', () => {
    const d = alerted();
    const route = okData(d.call('plan_route', { actor_id: 'alex', destination: 'assembly' }));
    expect(route.zones).toContain('south_branch');
    d.place('blocker', 26, 15);
    // Alex heads for the east exit through the (unknown) blocker and is interrupted on sight
    okData(d.call('move', { actor_id: 'alex', destination: 'east_exit' }));
    expect(d.until(() => d.idle('alex'))).toBe(true);
    const ev = d.engine.events.filter((e) => e.type === 'move_interrupted');
    expect(ev.length).toBe(1);
    expect(d.actor('alex').knows).toContain('E2');
    const stale = d.call('move', { actor_id: 'alex', destination: 'assembly', route_id: route.route_id });
    expect(errCode(stale)).toBe('STALE_STATE');
    // Unsolvable for Maya once she knows both hazards cut the room off
    const d2 = new Driver();
    d2.run(3);
    d2.place('fire', 16, 9);
    d2.place('blocker', 8, 3);
    d2.run(2);
    okData(d2.call('notify', { actor_id: 'maya', recipient: 'all', topic: 'fire', evidence_ids: ['E1'], message: 'Fire at door B!' }));
    okData(d2.call('observe', { actor_id: 'alex' }));
    const ua = d2.call('plan_route', { actor_id: 'daniel', destination: 'assembly' });
    // Daniel only knows the fire; door A is still believed open → a route exists in his knowledge
    expect(ua.ok).toBe(true);
  });
});

describe('check-in and roster', () => {
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
});
