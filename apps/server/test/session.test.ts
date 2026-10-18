import { describe, expect, it, vi } from 'vitest';
import type { CreateEngine, ProviderInfo, ServerMessage, TraceRow } from '@escape/contracts';
import { readPlannerConfig } from '../src/config.js';
import { Orchestrator } from '../src/orchestrator.js';
import { OpenAICompatibleProvider } from '../src/providers/openaiCompatible.js';
import type { DecideRequest, DecisionProvider, DecisionResult } from '../src/providers/types.js';
import { Session } from '../src/session.js';
import { FakeEngine, fakeMap, fakeScenario } from './fakeEngine.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Provider whose responses are released manually (and that ignores abort, to simulate a late response). */
class DeferredProvider implements DecisionProvider {
  pending: ((r: DecisionResult) => void)[] = [];
  calls = 0;
  info(): ProviderInfo {
    return { id: 'test', label: 'Nemotron test', model: 'nemotron-test', endpointKind: 'self-hosted-vllm', healthy: true, thinking: false };
  }
  async health() {
    return { ok: true, detail: 'test' };
  }
  decide(_req: DecideRequest): Promise<DecisionResult> {
    this.calls++;
    return new Promise((resolve) => this.pending.push(resolve));
  }
  release(name = 'observe') {
    const r = this.pending.shift();
    r?.({
      kind: 'tool_call',
      calls: [{ id: `c${this.calls}`, name, arguments: { actor_id: 'maya' } }],
      parseMode: 'native',
      latencyMs: 5,
      raw: {},
    });
  }
}

function makeSession(provider: DecisionProvider) {
  const engines: FakeEngine[] = [];
  const sent: ServerMessage[] = [];
  const createEngine: CreateEngine = (map, scenario, opts) => {
    const e = new FakeEngine(map, scenario, opts);
    engines.push(e);
    return e;
  };
  const session = new Session({
    map: fakeMap,
    cases: new Map([[fakeScenario.caseId, fakeScenario]]),
    provider,
    planner: { ...readPlannerConfig({}), maxDecisions: 24 },
    createEngine,
    broadcast: (m) => sent.push(m),
    runsDir: null,
    defaultCase: fakeScenario.caseId,
    tickIntervalMs: 0,
  });
  session.start();
  return { session, engines, sent };
}

const rowsOf = (sent: ServerMessage[]) =>
  sent.filter((m): m is Extract<ServerMessage, { type: 'trace' }> => m.type === 'trace').map((m) => m.row);
const lastRow = (sent: ServerMessage[], pred: (r: TraceRow) => boolean) => rowsOf(sent).filter(pred).at(-1);

describe('session / orchestrator', () => {
  it('discards a response that arrives after reset (stale episode)', async () => {
    const p = new DeferredProvider();
    const { session, engines, sent } = makeSession(p);
    session.loop(); // dispatches a decision on episode 1
    expect(p.calls).toBe(1);
    session.reset();
    expect(engines).toHaveLength(2);
    p.release('observe'); // late response for episode 1
    await flush();
    expect(engines[0].executed).toHaveLength(0);
    expect(engines[1].executed).toHaveLength(0);
    const stale = lastRow(sent, (r) => r.episodeId === engines[0].episodeId && r.kind === 'decision');
    expect(stale?.status).toBe('discarded_stale');
  });

  it('holds a response while paused and applies it on resume', async () => {
    const p = new DeferredProvider();
    const { session, engines, sent } = makeSession(p);
    session.loop();
    session.pause();
    p.release('observe');
    await flush();
    expect(engines[0].executed).toHaveLength(0);
    expect(lastRow(sent, (r) => r.kind === 'decision')?.status).toBe('held');
    // no new dispatch while paused
    session.loop();
    expect(p.calls).toBe(1);
    session.resume();
    await flush();
    expect(engines[0].executed).toHaveLength(1);
    expect(lastRow(sent, (r) => r.kind === 'decision')?.status).toBe('completed');
  });

  it('welcome after reconnect has a consistent snapshot and trace', async () => {
    const p = new DeferredProvider();
    const { session, sent } = makeSession(p);
    session.loop();
    p.release('observe');
    await flush();
    session.loop();
    const w1 = session.welcome();
    const w2 = session.welcome();
    if (w1.type !== 'welcome' || w2.type !== 'welcome') throw new Error('not welcome');
    expect(w1.snapshot.episodeId).toBe(w1.episodeId);
    expect(w2.trace.map((r) => r.id)).toEqual(w1.trace.map((r) => r.id));
    expect(w1.trace.every((r) => r.episodeId === w1.episodeId)).toBe(true);
    // every decision row in the trace equals the latest broadcast version (no duplicates/stale copies)
    const latest = new Map(rowsOf(sent).map((r) => [r.id, r]));
    for (const r of w1.trace) expect(latest.get(r.id)?.status).toBe(r.status);
  });

  it('retries once on HTTP 500, records provider_error rows, aborts after 3 failed decisions', async () => {
    const fetchMock = vi.fn(async () => new Response('upstream exploded', { status: 500 }));
    const provider = new OpenAICompatibleProvider(
      { ...readPlannerConfig({ PLANNER_PROVIDER: 'openai-compatible' }), apiKey: 'secret' },
      fetchMock as unknown as typeof fetch,
    );
    const engine = new FakeEngine(fakeMap, fakeScenario, { episodeId: 'ep-x' });
    const rows: TraceRow[] = [];
    const orch = new Orchestrator({
      engine,
      provider,
      map: fakeMap,
      scenario: fakeScenario,
      harness: 'v2',
      deadlineMs: 1000,
      getTick: () => engine.tick,
      isPaused: () => false,
      emitRow: (r) => rows.push(r),
      recordInput: () => {},
    });
    await orch.decideOnce();
    await orch.decideOnce();
    expect(engine.outcome()).toBeNull();
    await orch.decideOnce();
    expect(fetchMock).toHaveBeenCalledTimes(6); // 1 retry per decision
    const finals = new Map(rows.map((r) => [r.id, r]));
    const errs = [...finals.values()].filter((r) => r.status === 'provider_error');
    expect(errs).toHaveLength(3);
    expect(engine.notes.filter((n) => n.kind === 'provider_error')).toHaveLength(3);
    expect(engine.outcome()?.status).toBe('aborted');
    expect(JSON.stringify(rows)).not.toContain('secret');
  });

  it('times out a hung request and reports TIMEOUT', async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_res, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted')))),
    );
    const provider = new OpenAICompatibleProvider(readPlannerConfig({ PLANNER_PROVIDER: 'openai-compatible' }), fetchMock as unknown as typeof fetch);
    const engine = new FakeEngine(fakeMap, fakeScenario, { episodeId: 'ep-t' });
    const rows: TraceRow[] = [];
    const orch = new Orchestrator({
      engine,
      provider,
      map: fakeMap,
      scenario: fakeScenario,
      harness: 'v2',
      deadlineMs: 30,
      getTick: () => 0,
      isPaused: () => false,
      emitRow: (r) => rows.push(r),
      recordInput: () => {},
    });
    await orch.decideOnce();
    const final = rows.at(-1)!;
    expect(final.status).toBe('provider_error');
    expect(final.summary).toMatch(/TIMEOUT/);
  });
});
