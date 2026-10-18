// Per-agent mode: each person's view holds only what they saw, heard or were told; with instincts off the engine
// never shouts, flees, pulls the alarm in passing or blocks re-entry on anyone's behalf.
import { describe, expect, it } from 'vitest';
import { Driver, hero, okData } from './helpers.js';

// Fire at the west end of the cubicles: Maya (13,15) sees it; Alex (20,15) shares the room but is out of sight range;
// Daniel (Red Hat room), Rosa (reception) and Kenji (server room) are elsewhere. Her way out (east) avoids the fire.
function cubicleFire() {
  const base = hero();
  const d = new Driver({ ...base, spawns: { ...base.spawns, maya: { col: 13, row: 15, dir: 'up', pose: 'sit' } } }, { instincts: false });
  d.run(5);
  d.place('fire', 5, 16);
  d.run(2);
  return d;
}

describe('per-agent views', () => {
  it('only the witness knows; nobody else is told by the engine', () => {
    const d = cubicleFire();
    const e = d.engine;
    expect(e.events.some((x) => x.type === 'instinct')).toBe(false);
    expect(e.agentView('maya').hazards.map((h) => h.id)).toEqual(['E1']);
    expect(e.agentView('maya').hazards[0].places).toContain('the cubicles');
    for (const id of ['alex', 'daniel', 'rosa', 'kenji'] as const) expect(e.agentView(id).hazards, id).toEqual([]);
    expect(d.actor('alex').alerted).toBe(false);
    expect(e.agentNeedsDecision('maya').needed).toBe(true);
    expect(e.agentNeedsDecision('alex')).toMatchObject({ needed: false, reason: 'unaware' });
    expect(e.agentNeedsDecision('daniel').needed).toBe(false);
    // Same room: Maya can hear/see Alex; everyone else is elsewhere.
    expect(e.agentView('maya').with_me.map((p) => p.id)).toEqual(['alex']);
    expect(e.agentView('maya').others).toEqual([
      { id: 'daniel', name: 'Daniel', where: 'not in sight' },
      { id: 'rosa', name: 'Rosa', where: 'not in sight' },
      { id: 'kenji', name: 'Kenji', where: 'not in sight' },
    ]);
    expect(e.agentView('maya').alarm.sounding).toBe(false);
  });

  it('a spoken warning reaches only its listeners, and wakes them', () => {
    const d = cubicleFire();
    const e = d.engine;
    okData(d.call('notify', { actor_id: 'maya', recipient: 'all', topic: 'fire', evidence_ids: ['E1'], message: 'Fire at the end of the cubicles — get out!' }));
    const av = e.agentView('alex');
    expect(av.heard.map((m) => m.message)).toEqual(['Fire at the end of the cubicles — get out!']);
    expect(av.hazards.map((h) => h.id)).toEqual(['E1']);
    expect(av.new_for_me.some((t) => t.includes('Maya told you'))).toBe(true);
    expect(e.agentNeedsDecision('alex').needed).toBe(true);
    expect(e.agentView('daniel').heard).toEqual([]);
    expect(e.agentNeedsDecision('daniel').needed).toBe(false);
    e.markAgentViewed('alex');
    expect(e.agentView('alex').new_for_me).toEqual([]);
  });

  it('instincts off: no flee or passing pull; a deliberate trip to the alarm still pulls it', () => {
    const d = cubicleFire();
    d.run(100); // the fire is close to Maya by now: with instincts on she would have backed away
    expect(d.engine.events.some((x) => x.type === 'instinct')).toBe(false);
    expect(d.engine.events.some((x) => x.type === 'alarm_activated')).toBe(false);
    okData(d.call('move', { actor_id: 'maya', destination: 'alarm' }));
    expect(d.until(() => d.idle('maya'), 3000)).toBe(true);
    const alarm = d.engine.events.find((x) => x.type === 'alarm_activated');
    expect(alarm?.actor).toBe('maya');
    expect(alarm?.data.via).toBe('tool');
    expect(d.engine.agentView('kenji').alarm.sounding).toBe(true);
    expect(d.engine.agentNeedsDecision('kenji').needed).toBe(true);
  });

  it('the warden is woken for the roster only once everyone is checked in', () => {
    const d = cubicleFire();
    expect(d.engine.agentNeedsDecision('alex').needed).toBe(false);
    expect(d.engine.agentView('alex').roster).toBeNull();
  });
});
