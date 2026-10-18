// Server configuration from environment (.env is loaded by `tsx --env-file-if-exists`).
// The API key is kept here only; it is never logged or sent to the browser.
import type { ProviderInfo } from '@escape/contracts';

export type Harness = 'v1' | 'v2';
/** 'central' = one planner call directs everyone; 'agents' = each person makes their own call (reasoning on). */
export type PlannerMode = 'central' | 'agents';

export interface PlannerConfig {
  provider: 'openai-compatible' | 'scripted';
  baseUrl: string;
  model: string;
  apiKey: string;
  endpointKind: ProviderInfo['endpointKind'];
  label: string;
  thinking: boolean;
  /** Reasoning-token cap per decision (vLLM `thinking_token_budget`, sent only with thinking on and the template
   *  kwargs); 0 or absent = no cap. */
  thinkingBudget?: number;
  /** Send chat_template_kwargs (vLLM supports it; the hosted NVIDIA API Catalog hangs on it as of 2026-10-17). */
  templateKwargs?: boolean;
  /** Live mode: hold the sim clock while a decision is in flight (for slow endpoints; sim time then excludes inference wait). */
  freezeWhileThinking?: boolean;
  temperature: number;
  topP: number;
  maxTokens: number;
  deadlineMs: number;
  maxDecisions: number;
  harness: Harness;
  mode: PlannerMode;
}

export interface ServerConfig {
  port: number;
  demoCase: string;
  planner: PlannerConfig;
}

type Env = Record<string, string | undefined>;

function num(v: string | undefined, d: number): number {
  if (v === undefined || v.trim() === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function bool(v: string | undefined, d: boolean): boolean {
  if (v === undefined || v.trim() === '') return d;
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}

export function readPlannerConfig(env: Env = process.env): PlannerConfig {
  const provider = (env.PLANNER_PROVIDER ?? 'scripted').trim() === 'openai-compatible' ? 'openai-compatible' : 'scripted';
  const baseUrl = (env.PLANNER_BASE_URL ?? 'http://localhost:8000/v1').trim().replace(/\/+$/, '');
  const kindRaw = (env.PLANNER_ENDPOINT_KIND ?? '').trim();
  const endpointKind: ProviderInfo['endpointKind'] =
    provider === 'scripted'
      ? 'scripted'
      : kindRaw === 'hosted-api' || kindRaw === 'self-hosted-vllm'
        ? kindRaw
        : /integrate\.api\.nvidia\.com|openrouter\.ai/.test(baseUrl)
          ? 'hosted-api'
          : 'self-hosted-vllm';
  const harness = (env.PLANNER_HARNESS ?? 'v2').trim() === 'v1' ? 'v1' : 'v2';
  const mode: PlannerMode = (env.PLANNER_MODE ?? 'central').trim() === 'agents' ? 'agents' : 'central';
  const agents = mode === 'agents';
  return {
    provider,
    baseUrl,
    model: (env.PLANNER_MODEL ?? 'nemotron-3.5-lightning').trim(),
    apiKey: (env.PLANNER_API_KEY ?? '').trim(),
    endpointKind,
    label: (env.PLANNER_LABEL ?? 'Nemotron 3.5 Lightning 30B-A3B').trim(),
    // Per-agent mode has its own switches so the central settings in .env stay as they are.
    thinking: agents ? bool(env.PLANNER_AGENT_THINKING, true) : bool(env.PLANNER_THINKING, false),
    // Uncapped, per-agent reasoning ran ~715 tokens per decision (p50 3.5 s, p95 ~10 s, live hero runs); latency is
    // almost all reasoning decode, so it is capped. PLANNER_AGENT_THINKING_BUDGET=0 removes the cap.
    thinkingBudget: agents ? Math.max(0, Math.round(num(env.PLANNER_AGENT_THINKING_BUDGET, 128))) : 0,
    templateKwargs: bool(env.PLANNER_TEMPLATE_KWARGS, endpointKind === 'self-hosted-vllm'),
    // Per-agent mode reasons for ~3 s (p95 ~13 s) per decision: holding the clock keeps inference time from costing
    // lives, so people are judged on their decisions. PLANNER_AGENT_FREEZE_WHILE_THINKING=false restores real-time pressure.
    freezeWhileThinking: agents
      ? bool(env.PLANNER_AGENT_FREEZE_WHILE_THINKING, true)
      : bool(env.PLANNER_FREEZE_WHILE_THINKING, endpointKind === 'hosted-api'),
    temperature: num(env.PLANNER_TEMPERATURE, 0.6),
    topP: num(env.PLANNER_TOP_P, 0.95),
    maxTokens: num(env.PLANNER_MAX_TOKENS, 1024),
    deadlineMs: num(env.PLANNER_DEADLINE_MS, 20000),
    // Safety stop only (there is no gameplay timer). Matches the engine default.
    // Everyone deciding for themselves makes roughly one planner's calls per person.
    maxDecisions: agents ? num(env.PLANNER_AGENT_MAX_DECISIONS, 250) : num(env.PLANNER_MAX_DECISIONS, 100),
    harness,
    mode,
  };
}

export function readServerConfig(env: Env = process.env): ServerConfig {
  return {
    port: num(env.PORT, 8787),
    demoCase: (env.DEMO_CASE ?? 'demo-hero').trim(),
    planner: readPlannerConfig(env),
  };
}

/** Safe-to-log description (never includes the key). */
export function describePlanner(c: PlannerConfig): string {
  if (c.provider === 'scripted') return 'SCRIPTED fixture (not a model)';
  return `${c.label} · ${c.model} @ ${c.baseUrl} (${c.endpointKind}, ${c.mode === 'agents' ? 'each person decides' : 'central planner'}, thinking ${c.thinking ? `on${c.thinkingBudget ? ` ≤${c.thinkingBudget} tokens` : ''}` : 'off'}, key ${c.apiKey ? 'set' : 'MISSING'})`;
}
