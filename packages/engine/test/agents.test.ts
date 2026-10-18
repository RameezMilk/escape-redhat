// Per-agent mode: each person's view holds only what they saw, heard or were told; with instincts off the engine
// never shouts, flees, pulls the alarm in passing or blocks re-entry on anyone's behalf.
import { describe, expect, it } from 'vitest';
import { Driver, okData } from './helpers.js';

// Fire in doorway A: Maya (13,7) sees it; Daniel (15,12) and Alex (22,8) do not (see tools.test.ts).
function fireAtDoorA() {
  const d = new Driver(undefined, { instincts: false });
  d.run(5);
  d.place('fire', 8, 4);
  d.run(2);
  return d;
}

describe('per-agent views', () => {
  it('only the witness knows; nobody else is told by the engine', () => {
    const d = fireAtDoorA();
    const e = d.engine;
    expect(e.events.some((x) => x.type === 'instinct')).toBe(false);
    expect(e.agentView('maya').hazards.map((h) => h.id)).toEqual(['E1']);
    expect(e.agentView('maya').hazards[0].places).toContain('the Red Hat room');
    expect(e.agentView('daniel').hazards).toEqual([]);
    expect(e.agentView('alex').hazards).toEqual([]);
    expect(d.actor('daniel').alerted).toBe(false);
    expect(e.agentNeedsDecision('maya').needed).toBe(true);
    expect(e.agentNeedsDecision('daniel')).toMatchObject({ needed: false, reason: 'unaware' });
    expect(e.agentNeedsDecision('alex').needed).toBe(false);
    // Same room: Maya can hear/see Daniel; Alex (lobby) is not in sight.
    expect(e.agentView('maya').with_me.map((p) => p.id)).toEqual(['daniel']);
    expect(e.agentView('maya').others).toEqual([{ id: 'alex', name: 'Alex', where: 'not in sight' }]);
    expect(e.agentView('maya').alarm.sounding).toBe(false);
  });

  it('a spoken warning reaches only its listeners, and wakes them', () => {
    const d = fireAtDoorA();
    const e = d.engine;
    okData(d.call('notify', { actor_id: 'maya', recipient: 'all', topic: 'fire', evidence_ids: ['E1'], message: 'Fire at door A — get out!' }));
    const dv = e.agentView('daniel');
    expect(dv.heard.map((m) => m.message)).toEqual(['Fire at door A — get out!']);
    expect(dv.hazards.map((h) => h.id)).toEqual(['E1']);
    expect(dv.new_for_me.some((t) => t.includes('Maya told you'))).toBe(true);
    expect(e.agentNeedsDecision('daniel').needed).toBe(true);
    expect(e.agentView('alex').heard).toEqual([]);
    expect(e.agentNeedsDecision('alex').needed).toBe(false);
    e.markAgentViewed('daniel');
    expect(e.agentView('daniel').new_for_me).toEqual([]);
  });

  it('instincts off: no flee or passing pull; a deliberate trip to the alarm still pulls it', () => {
    const d = fireAtDoorA();
    d.run(100); // the fire is within a tile of Maya by now: with instincts on she would have backed away
    expect(d.engine.events.some((x) => x.type === 'instinct')).toBe(false);
    expect(d.engine.events.some((x) => x.type === 'alarm_activated')).toBe(false);
    okData(d.call('move', { actor_id: 'maya', destination: 'alarm' }));
    expect(d.until(() => d.idle('maya'), 3000)).toBe(true);
    const alarm = d.engine.events.find((x) => x.type === 'alarm_activated');
    expect(alarm?.actor).toBe('maya');
    expect(alarm?.data.via).toBe('tool');
    expect(d.engine.agentView('alex').alarm.sounding).toBe(true);
    expect(d.engine.agentNeedsDecision('alex').needed).toBe(true);
  });

  it('the warden is woken for the roster only once everyone is checked in', () => {
    const d = fireAtDoorA();
    expect(d.engine.agentNeedsDecision('alex').needed).toBe(false);
    expect(d.engine.agentView('alex').roster).toBeNull();
  });
});
