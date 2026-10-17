import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { TOOL_DEFS, type CreateEngine } from '@escape/contracts';
import { createEngine } from '@escape/engine';
import { loadCases, loadMapFile } from '../src/data.js';
import { GymError, GymSessions, compactState, registerGymRoutes, type GymStepResponse } from '../src/gymApi.js';
import { ScriptedProvider } from '../src/providers/scripted.js';

const map = loadMapFile('office-v1');
const cases = loadCases();
// Dataset cases are regenerated with the rules; pick by family rather than by fixed id.
const devCase = (family: string) => [...cases.values()].find((c) => c.split === 'dev' && c.family === family && c.events.every((e) => e.trigger.type !== 'manual'));
const HERO = (devCase('hero') ?? devCase('fire_then_door') ?? devCase('fire_only'))!.caseId;
const FIRE_ONLY = (devCase('fire_only') ?? devCase('hero'))!.caseId;
const make = (maxSessions?: number) => new GymSessions({ map, cases, createEngine: createEngine as CreateEngine, maxSessions });

describe('Gym session API (engine-backed, lockstep)', () => {
  it('seeds a dataset case to its first decision point with the app prompt and tools', () => {
    const gym = make();
    const s = gym.create({ sessionId: 's1', caseId: HERO, harness: 'v2' });
    expect(s.case_id).toBe(HERO);
    expect(s.tools).toHaveLength(TOOL_DEFS.length);
    expect(s.system_prompt).toContain('PROCEDURE');
    expect(s.done).toBe(false);
    // the fire was scheduled and observed before the first decision is needed
    expect(s.state.evidence.length).toBeGreaterThan(0);
    expect(s.user_prompt).toContain('Current state (JSON)');
    const v1 = gym.create({ sessionId: 's1b', caseId: HERO, harness: 'v1' });
    expect(v1.system_prompt).not.toContain('PROCEDURE');
  });

  it('rejects presenter-only (manual) cases, unknown cases and unknown sessions', () => {
    const gym = make();
    expect(() => gym.create({ sessionId: 'x', caseId: 'demo-hero' })).toThrow(GymError);
    expect(() => gym.create({ sessionId: 'x', caseId: 'nope' })).toThrow(/unknown case_id/);
    expect(() => gym.tool('missing', 'observe', { actor_id: 'alex' })).toThrow(/unknown session/);
  });

  it('invalid calls are rejected without changing the world, and count as a decision', () => {
    const gym = make();
    const s = gym.create({ sessionId: 's2', caseId: HERO });
    const r = gym.tool('s2', 'move', { actor_id: 'nobody', destination: 'assembly' });
    expect(r.result?.ok).toBe(false);
    if (r.result && !r.result.ok) expect(r.result.error.code).toBe('INVALID_ARGUMENT');
    expect(r.decisions_used).toBe(1);
    expect(r.sim_time).toBeGreaterThanOrEqual(s.sim_time);
  });

  it('a scripted policy driving the Gym API reaches a verified success with reward +1 (fixture, not a model)', async () => {
    const gym = make();
    const provider = new ScriptedProvider({ latencyMs: [0, 0], seed: 1 });
    let step: GymStepResponse = gym.create({ sessionId: 'hero', caseId: HERO, harness: 'v2' });
    let guard = 0;
    while (!step.done && guard++ < 80) {
      const d = await provider.decide({
        system: '',
        view: step.state,
        tools: TOOL_DEFS,
        harness: 'v2',
        signal: new AbortController().signal,
        deadlineMs: 1000,
      });
      if (d.kind !== 'tool_call') {
        step = gym.note('hero', 'no_call', 'scripted policy had nothing to do');
        continue;
      }
      const call = d.calls[0];
      step = gym.tool('hero', call.name, call.arguments, { call_id: call.id });
    }
    const v = gym.verify('hero');
    expect(v.outcome.status).toBe('success');
    expect(v.success).toBe(true);
    expect(v.reward).toBe(1);
    expect(v.ended_by_verify).toBe(false);
  });

  it('verify before completion ends the episode as incomplete (honest score)', () => {
    const gym = make();
    gym.create({ sessionId: 's3', caseId: FIRE_ONLY });
    const v = gym.verify('s3');
    expect(v.ended_by_verify).toBe(true);
    expect(v.success).toBe(false);
    expect(v.reward).toBeLessThanOrEqual(0);
    expect(['incomplete', 'unresolved']).toContain(v.outcome.status);
    expect(v.outcome.reason).toMatch(/verified complete|stopped/);
    const after = gym.tool('s3', 'observe', { actor_id: 'alex' });
    expect(after.result?.ok).toBe(false);
    if (after.result && !after.result.ok) expect(after.result.error.code).toBe('EPISODE_OVER');
  });

  it('bounds the number of live sessions (oldest evicted)', () => {
    const gym = make(2);
    gym.create({ sessionId: 'a', caseId: HERO });
    gym.create({ sessionId: 'b', caseId: HERO });
    gym.create({ sessionId: 'c', caseId: HERO });
    expect(gym.size).toBe(2);
    expect(() => gym.tool('a', 'observe', { actor_id: 'alex' })).toThrow(/unknown session/);
  });

  it('compact state keeps the essentials and stays small', () => {
    const gym = make();
    const s = gym.create({ sessionId: 'c1', caseId: HERO });
    const c = compactState(s.state);
    expect(c.actors).toHaveLength(3);
    expect(c.actors.every((a) => a.lost === false)).toBe(true);
    expect(c.alarm).toHaveProperty('active');
    expect(JSON.stringify(c).length).toBeLessThan(JSON.stringify(s.state).length);
  });

  it('HTTP routes: seed → tool (compact) → verify → delete', async () => {
    const app = Fastify();
    registerGymRoutes(app, make());
    const seed = await app.inject({ method: 'POST', url: '/api/gym/sessions', payload: { session_id: 'h1', case_id: HERO, harness: 'v1' } });
    expect(seed.statusCode).toBe(200);
    expect(seed.json().harness).toBe('v1');
    const bad = await app.inject({ method: 'POST', url: '/api/gym/sessions', payload: { session_id: 'h2', case_id: 'demo-hero' } });
    expect(bad.statusCode).toBe(400);
    const t = await app.inject({
      method: 'POST',
      url: '/api/gym/sessions/h1/tools/observe?view=compact',
      payload: { arguments: { actor_id: 'maya' } },
    });
    expect(t.statusCode).toBe(200);
    expect(t.json().result.ok).toBe(true);
    expect(t.json().state.actors).toHaveLength(3);
    expect(t.json().state).not.toHaveProperty('messages');
    const v = await app.inject({ method: 'POST', url: '/api/gym/sessions/h1/verify' });
    expect(v.statusCode).toBe(200);
    expect(typeof v.json().reward).toBe('number');
    const d = await app.inject({ method: 'DELETE', url: '/api/gym/sessions/h1' });
    expect(d.json().deleted).toBe(true);
    const missing = await app.inject({ method: 'POST', url: '/api/gym/sessions/h1/verify' });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });
});
