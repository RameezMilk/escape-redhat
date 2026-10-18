// OpenAI-compatible chat-completions provider (vLLM, NVIDIA API Catalog, OpenRouter).
// Plain fetch; native `tool_calls` preferred, with a disclosed content fallback for
// Nemotron's XML tool syntax or a bare JSON object.
import type { NormalizedToolCall, ProviderInfo } from '@escape/contracts';
import type { PlannerConfig } from '../config.js';
import { userContent } from '../prompt.js';
import { LatencyStats, type DecideRequest, type DecisionProvider, type DecisionResult, type Usage } from './types.js';

type FetchLike = typeof fetch;

interface ChatMessage {
  content?: string | null;
  reasoning?: string | null;
  reasoning_content?: string | null;
  tool_calls?: { id?: string; type?: string; function?: { name?: string; arguments?: unknown } }[];
}

let callSeq = 0;
const synthId = () => `call_local_${Date.now().toString(36)}_${++callSeq}`;

export class OpenAICompatibleProvider implements DecisionProvider {
  private stats = new LatencyStats();
  private dropTemplateKwargs = false;
  private healthy: boolean | null = null;
  private healthDetail = 'not checked';

  constructor(
    private cfg: PlannerConfig,
    private fetchImpl: FetchLike = fetch,
  ) {
    // templateKwargs is optional so hand-built test configs keep the default (send them).
    this.dropTemplateKwargs = cfg.templateKwargs === false;
  }

  info(): ProviderInfo {
    const thinkingBudget = this.budget(!this.dropTemplateKwargs);
    return {
      id: 'openai-compatible',
      label: this.cfg.label,
      model: this.cfg.model,
      endpointKind: this.cfg.endpointKind,
      baseUrl: this.cfg.baseUrl,
      healthy: this.healthy,
      healthDetail: this.healthDetail,
      thinking: this.cfg.thinking,
      ...(thinkingBudget ? { thinkingBudget } : {}),
      mode: this.cfg.mode,
      p50LatencyMs: this.stats.p50(),
      lastLatencyMs: this.stats.last,
    };
  }

  /** Reasoning cap in force: a vLLM extension like chat_template_kwargs, so it is sent (and dropped) with them. */
  private budget(withTemplateKwargs: boolean): number {
    return withTemplateKwargs && this.cfg.thinking ? (this.cfg.thinkingBudget ?? 0) : 0;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (this.cfg.apiKey) h.authorization = `Bearer ${this.cfg.apiKey}`;
    return h;
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      const res = await this.fetchImpl(`${this.cfg.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        this.healthy = false;
        this.healthDetail = `GET /models → HTTP ${res.status}`;
      } else {
        const body = (await res.json()) as { data?: { id?: string }[] };
        const ids = (body.data ?? []).map((m) => m.id ?? '');
        const listed = ids.includes(this.cfg.model);
        this.healthy = listed;
        this.healthDetail = listed
          ? `model ${this.cfg.model} listed`
          : `model ${this.cfg.model} NOT listed (${ids.length} models; e.g. ${ids.slice(0, 3).join(', ')})`;
      }
    } catch (e) {
      this.healthy = false;
      this.healthDetail = `GET /models failed: ${(e as Error).message}`;
    }
    return { ok: !!this.healthy, detail: this.healthDetail };
  }

  async decide(req: DecideRequest): Promise<DecisionResult> {
    const first = await this.post(req, !this.dropTemplateKwargs);
    if (
      first.kind === 'error' &&
      first.code === 'HTTP' &&
      first.status === 400 &&
      !this.dropTemplateKwargs &&
      /chat_template_kwargs|extra|unrecognized|not permitted|additional/i.test(first.message)
    ) {
      const second = await this.post(req, false);
      if (second.kind !== 'error') this.dropTemplateKwargs = true;
      return second;
    }
    // Prompt + requested output over the served context (reasoning asks for 4k output): retry once with what fits.
    const ctx = first.kind === 'error' && first.status === 400 ? first.message.match(/maximum context length is (\d+) tokens[\s\S]*?(\d+) input tokens/) : null;
    if (ctx) {
      const room = Number(ctx[1]) - Number(ctx[2]) - 32;
      if (room >= 512) return this.post(req, !this.dropTemplateKwargs, room);
    }
    return first;
  }

  private async post(req: DecideRequest, withTemplateKwargs: boolean, maxTokens?: number): Promise<DecisionResult> {
    // vLLM ends the reasoning at the budget; the tool call then gets the usual output budget on top.
    const budget = this.budget(withTemplateKwargs);
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.agent ? req.agent.user : userContent(req.view!, req.harness, req.map) },
      ],
      tools: req.tools,
      tool_choice: 'auto',
      temperature: this.cfg.temperature,
      top_p: this.cfg.topP,
      max_tokens: maxTokens ?? (budget ? budget + this.cfg.maxTokens : this.cfg.thinking ? Math.max(this.cfg.maxTokens, 4096) : this.cfg.maxTokens),
    };
    if (withTemplateKwargs) body.chat_template_kwargs = { enable_thinking: this.cfg.thinking };
    if (budget) body.thinking_token_budget = budget;
    const rawRequest = { url: `${this.cfg.baseUrl}/chat/completions`, body };

    const timeout = AbortSignal.timeout(req.deadlineMs);
    const signal = AbortSignal.any([req.signal, timeout]);
    const t0 = performance.now();
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      const latencyMs = Math.round(performance.now() - t0);
      if (req.signal.aborted) return { kind: 'error', code: 'ABORTED', message: 'request aborted (episode reset)', latencyMs };
      if (timeout.aborted)
        return { kind: 'error', code: 'TIMEOUT', message: `no response within ${req.deadlineMs} ms`, latencyMs, raw: { request: rawRequest } };
      return { kind: 'error', code: 'NETWORK', message: (e as Error).message, latencyMs, raw: { request: rawRequest } };
    }

    let text = '';
    try {
      text = await res.text();
    } catch (e) {
      const latencyMs = Math.round(performance.now() - t0);
      if (req.signal.aborted) return { kind: 'error', code: 'ABORTED', message: 'request aborted (episode reset)', latencyMs };
      if (timeout.aborted)
        return { kind: 'error', code: 'TIMEOUT', message: `no response within ${req.deadlineMs} ms`, latencyMs, raw: { request: rawRequest } };
      return { kind: 'error', code: 'NETWORK', message: (e as Error).message, latencyMs, raw: { request: rawRequest } };
    }
    const latencyMs = Math.round(performance.now() - t0);

    if (!res.ok) {
      return {
        kind: 'error',
        code: 'HTTP',
        status: res.status,
        message: `HTTP ${res.status}: ${text.slice(0, 300)}`,
        latencyMs,
        raw: { request: rawRequest, response: text.slice(0, 2000) },
      };
    }

    let json: { choices?: { message?: ChatMessage }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    try {
      json = JSON.parse(text);
    } catch {
      return { kind: 'error', code: 'PARSE', message: 'response body is not JSON', latencyMs, raw: { request: rawRequest, response: text.slice(0, 2000) } };
    }
    this.stats.add(latencyMs);

    const usage: Usage | undefined = json.usage
      ? { promptTokens: json.usage.prompt_tokens, completionTokens: json.usage.completion_tokens }
      : undefined;
    const message: ChatMessage = json.choices?.[0]?.message ?? {};
    const raw = { request: rawRequest, response: json };
    return parseChatMessage(message, latencyMs, usage, raw);
  }
}

/** Exported for tests: turn an assistant message into a decision result. */
export function parseChatMessage(
  message: ChatMessage,
  latencyMs: number,
  usage: Usage | undefined,
  raw: { request?: unknown; response?: unknown },
): DecisionResult {
  // vLLM's reasoning parser returns the thinking separately (field name differs across versions).
  const thought = (message.reasoning_content ?? message.reasoning ?? '').trim();
  const reasoning = thought ? { reasoning: thought.slice(0, 6000) } : {};
  const native = message.tool_calls ?? [];
  if (native.length) {
    let malformed = false;
    const calls: NormalizedToolCall[] = native.map((tc) => {
      const name = tc.function?.name ?? '';
      const argRaw = tc.function?.arguments;
      let args: Record<string, unknown> = {};
      let rawArguments: string | undefined;
      if (typeof argRaw === 'string') {
        rawArguments = argRaw;
        try {
          const parsed = argRaw.trim() === '' ? {} : JSON.parse(argRaw);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
          else malformed = true;
        } catch {
          malformed = true;
        }
      } else if (argRaw && typeof argRaw === 'object') {
        args = argRaw as Record<string, unknown>;
      }
      return { id: tc.id || synthId(), name, arguments: args, ...(rawArguments !== undefined ? { rawArguments } : {}) };
    });
    return { kind: 'tool_call', calls, parseMode: 'native', latencyMs, usage, raw, ...reasoning, ...(malformed ? { malformedArguments: true } : {}) };
  }

  const content = message.content ?? '';
  const fallback = parseContentToolCalls(content);
  if (fallback.length) return { kind: 'tool_call', calls: fallback, parseMode: 'content-fallback', latencyMs, usage, raw, ...reasoning };
  return { kind: 'no_call', text: content.slice(0, 500), latencyMs, usage, raw, ...reasoning };
}

function coerceValue(v: string): unknown {
  const t = v.trim();
  if (t === '') return '';
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

/** Nemotron/Qwen-coder XML (`<function=NAME><parameter=K>V</parameter></function>`) or a JSON object. */
export function parseContentToolCalls(content: string): NormalizedToolCall[] {
  if (!content) return [];
  const calls: NormalizedToolCall[] = [];
  const fnRe = /<function=([\w.-]+)>([\s\S]*?)<\/function>/g;
  for (const m of content.matchAll(fnRe)) {
    const args: Record<string, unknown> = {};
    const pRe = /<parameter=([\w.-]+)>([\s\S]*?)<\/parameter>/g;
    for (const p of m[2].matchAll(pRe)) {
      const key = p[1];
      const val = coerceValue(p[2]);
      // Keep free-text fields as strings even if they look like JSON scalars.
      args[key] = (key === 'message' || key === 'reason_summary' || key === 'route_id') && typeof val !== 'string' ? String(p[2].trim()) : val;
    }
    calls.push({ id: synthId(), name: m[1], arguments: args, rawArguments: m[0] });
  }
  if (calls.length) return calls;

  // JSON object, possibly fenced.
  const candidates: string[] = [];
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1]);
  const brace = content.indexOf('{');
  const last = content.lastIndexOf('}');
  if (brace >= 0 && last > brace) candidates.push(content.slice(brace, last + 1));
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c) as Record<string, unknown>;
      const fn = (obj.function ?? obj) as Record<string, unknown>;
      const name = (fn.name ?? obj.tool ?? obj.name) as string | undefined;
      let args = (fn.arguments ?? obj.args ?? obj.parameters ?? obj.arguments) as unknown;
      if (typeof args === 'string') args = JSON.parse(args);
      if (typeof name === 'string' && args && typeof args === 'object' && !Array.isArray(args)) {
        return [{ id: synthId(), name, arguments: args as Record<string, unknown>, rawArguments: c }];
      }
    } catch {
      // try next candidate
    }
  }
  return [];
}
