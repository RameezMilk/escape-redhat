import { describe, expect, it } from 'vitest';
import type { ScenarioCase } from '@escape/contracts';
import { Driver, hero, okData } from './helpers.js';

describe('scheduled presenter events and decision gating', () => {
  it('at_time and actor_enters_zone triggers place hazards; needsDecision gates the planner', () => {
    const sc: ScenarioCase = {
      ...hero(),
      caseId: 'sched-test',
      events: [
        { id: 'f', trigger: { type: 'at_time', simTime: 2 }, action: { type: 'place_hazard', kind: 'fire', col: 8, row: 5 } },
        { id: 'b', trigger: { type: 'actor_enters_zone', actor: 'maya', zone: 'lobby' }, action: { type: 'place_hazard', kind: 'electrical', col: 26, row: 15 } },
      ],
    };
    const d = new Driver(sc);
    d.run(19);
    expect(d.engine.snapshot().hazards).toHaveLength(0);
    expect(d.engine.needsDecision().needed).toBe(false);
    d.run(3);
    expect(d.engine.snapshot().hazards.map((h) => h.kind)).toEqual(['fire']);
    expect(d.engine.needsDecision().needed).toBe(true);
    // Maya's shout reaches Daniel (same room) but not Alex in the lobby
    okData(d.call('notify', { actor_id: 'maya', recipient: 'all', topic: 'fire', evidence_ids: ['E1'], message: 'Fire!' }));
    for (const id of ['maya', 'daniel']) okData(d.call('move', { actor_id: id, destination: 'assembly' }));
    expect(d.engine.needsDecision()).toEqual({ needed: true, reason: 'not yet alerted: alex' });
    expect(d.until(() => d.engine.snapshot().hazards.length === 2, 400)).toBe(true);
    expect(d.actor('maya').zone).toBe('lobby');
  });
});
