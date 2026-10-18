import { describe, expect, it, vi } from 'vitest';
import { TOOL_DEFS, type PlannerView } from '@escape/contracts';
import { readPlannerConfig } from '../src/config.js';
import { OpenAICompatibleProvider, parseContentToolCalls } from '../src/providers/openaiCompatible.js';

const view = { sim_time: 1 } as unknown as PlannerView;
const cfg = { ...readPlannerConfig({ PLANNER_PROVIDER: 'openai-compatible', PLANNER_API_KEY: 'k' }) };
const req = () => ({ system: 'sys', view, tools: TOOL_DEFS, signal: new AbortController().signal, deadlineMs: 2000 });
const ok = (message: unknown, usage = { prompt_tokens: 100, completion_tokens: 20 }) =>
  new Response(JSON.stringify({ choices: [{ message }], usage }), { status: 200 });

describe('openai-compatible provider', () => {
  it('parses native tool_calls', async () => {
    const f = vi.fn(async () =>
      ok({
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'notify', arguments: '{"actor_id":"maya","recipient":"all","topic":"fire","evidence_ids":["E1"],"message":"Fire!"}' } },
        ],
      }),
    );
    const p = new OpenAICompatibleProvider(cfg, f as unknown as typeof fetch);
    const r = await p.decide(req());
    expect(r.kind).toBe('tool_call');
    if (r.kind !== 'tool_call') return;
    expect(r.parseMode).toBe('native');
    expect(r.calls[0]).toMatchObject({ id: 'call_1', name: 'notify', arguments: { actor_id: 'maya', evidence_ids: ['E1'] } });
    expect(r.usage).toEqual({ promptTokens: 100, completionTokens: 20 });
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body.tool_choice).toBe('auto');
    expect(JSON.stringify(r.raw.request)).not.toContain('Bearer');
  });

  it('falls back to Nemotron XML tool syntax in content', async () => {
    const content =
      '<tool_call>\n<function=move>\n<parameter=actor_id>\nalex\n</parameter>\n<parameter=destination>\nassembly\n</parameter>\n<parameter=expected_revision>\n3\n</parameter>\n</function>\n</tool_call>';
    const f = vi.fn(async () => ok({ content }));
    const r = await new OpenAICompatibleProvider(cfg, f as unknown as typeof fetch).decide(req());
    expect(r.kind).toBe('tool_call');
    if (r.kind !== 'tool_call') return;
    expect(r.parseMode).toBe('content-fallback');
    expect(r.calls[0]).toMatchObject({ name: 'move', arguments: { actor_id: 'alex', destination: 'assembly', expected_revision: 3 } });
  });

  it('keeps the reasoning text and retries with a smaller output budget when the prompt is too long', async () => {
    const tooLong = new Response(
      JSON.stringify({ error: { message: "This model's maximum context length is 8192 tokens. However, you requested 4096 output tokens and your prompt contains at least 4300 input tokens." } }),
      { status: 400 },
    );
    const f = vi
      .fn()
      .mockResolvedValueOnce(tooLong)
      .mockResolvedValueOnce(ok({ reasoning_content: 'Fire is close — go out east.', tool_calls: [{ id: 'c1', function: { name: 'move', arguments: '{"actor_id":"maya","destination":"assembly"}' } }] }));
    const thinking = { ...cfg, thinking: true };
    const r = await new OpenAICompatibleProvider(thinking, f as unknown as typeof fetch).decide(req());
    expect(r.kind).toBe('tool_call');
    if (r.kind !== 'tool_call') return;
    expect(r.reasoning).toBe('Fire is close — go out east.');
    const bodies = f.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string));
    expect(bodies[0].max_tokens).toBe(4096);
    expect(bodies[1].max_tokens).toBe(8192 - 4300 - 32);
  });

  it('caps per-agent reasoning with thinking_token_budget (default 128), and drops the cap with the template kwargs', async () => {
    const agentsCfg = readPlannerConfig({ PLANNER_PROVIDER: 'openai-compatible', PLANNER_API_KEY: 'k', PLANNER_MODE: 'agents' });
    expect(agentsCfg.thinkingBudget).toBe(128);
    expect(readPlannerConfig({ PLANNER_MODE: 'agents', PLANNER_AGENT_THINKING_BUDGET: '0' }).thinkingBudget).toBe(0);
    expect(cfg.thinkingBudget).toBe(0); // central mode: no cap
    const call = { tool_calls: [{ id: 'c1', function: { name: 'move', arguments: '{"actor_id":"maya","destination":"assembly"}' } }] };
    const f = vi
      .fn()
      .mockResolvedValueOnce(ok(call))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'chat_template_kwargs: extra inputs are not permitted' } }), { status: 400 }))
      .mockResolvedValueOnce(ok(call));
    const p = new OpenAICompatibleProvider(agentsCfg, f as unknown as typeof fetch);
    expect(p.info().thinkingBudget).toBe(128);
    await p.decide(req());
    await p.decide(req());
    const bodies = f.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string));
    expect(bodies[0]).toMatchObject({ thinking_token_budget: 128, max_tokens: 128 + agentsCfg.maxTokens, chat_template_kwargs: { enable_thinking: true } });
    expect(bodies[2].thinking_token_budget).toBeUndefined();
    expect(bodies[2].chat_template_kwargs).toBeUndefined();
    expect(bodies[2].max_tokens).toBe(4096);
    expect(p.info().thinkingBudget).toBeUndefined();
  });

  it('parses a bare JSON object in content', () => {
    const calls = parseContentToolCalls('Sure:\n```json\n{"name":"check_in","arguments":{"actor_id":"maya"}}\n```');
    expect(calls[0]).toMatchObject({ name: 'check_in', arguments: { actor_id: 'maya' } });
  });

  it('flags malformed JSON arguments but keeps the call', async () => {
    const f = vi.fn(async () => ok({ tool_calls: [{ id: 'c', function: { name: 'observe', arguments: '{"actor_id": "maya"' } }] }));
    const r = await new OpenAICompatibleProvider(cfg, f as unknown as typeof fetch).decide(req());
    expect(r.kind).toBe('tool_call');
    if (r.kind !== 'tool_call') return;
    expect(r.malformedArguments).toBe(true);
    expect(r.calls[0].arguments).toEqual({});
    expect(r.calls[0].rawArguments).toContain('actor_id');
  });

  it('returns no_call when content has no tool call', async () => {
    const f = vi.fn(async () => ok({ content: 'I think everyone should leave.' }));
    const r = await new OpenAICompatibleProvider(cfg, f as unknown as typeof fetch).decide(req());
    expect(r.kind).toBe('no_call');
  });

  it('retries without chat_template_kwargs after a 400 and remembers it', async () => {
    const bodies: Record<string, unknown>[] = [];
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      const b = JSON.parse(init.body as string);
      bodies.push(b);
      if (b.chat_template_kwargs) return new Response('{"error":"Unrecognized field chat_template_kwargs"}', { status: 400 });
      return ok({ tool_calls: [{ id: 'c', function: { name: 'observe', arguments: '{"actor_id":"alex"}' } }] });
    });
    const p = new OpenAICompatibleProvider(cfg, f as unknown as typeof fetch);
    const r1 = await p.decide(req());
    expect(r1.kind).toBe('tool_call');
    expect(bodies).toHaveLength(2);
    await p.decide(req());
    expect(bodies).toHaveLength(3);
    expect(bodies[2].chat_template_kwargs).toBeUndefined();
  });

  it('health checks the model is listed', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'nemotron-3.5-lightning' }] }), { status: 200 }));
    const p = new OpenAICompatibleProvider(cfg, f as unknown as typeof fetch);
    expect((await p.health()).ok).toBe(true);
    expect(p.info().healthy).toBe(true);
  });
});
