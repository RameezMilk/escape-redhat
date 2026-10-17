// Server configuration from environment (.env is loaded by `tsx --env-file-if-exists`).
// The API key is kept here only; it is never logged or sent to the browser.
import type { ProviderInfo } from '@escape/contracts';

export type Harness = 'v1' | 'v2';

export interface PlannerConfig {
  provider: 'openai-compatible' | 'scripted';
  baseUrl: string;
  model: string;
  apiKey: string;
  endpointKind: ProviderInfo['endpointKind'];
  label: string;
  thinking: boolean;
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
  return {
    provider,
    baseUrl,
    model: (env.PLANNER_MODEL ?? 'nemotron-3.5-lightning').trim(),
    apiKey: (env.PLANNER_API_KEY ?? '').trim(),
    endpointKind,
    label: (env.PLANNER_LABEL ?? 'Nemotron 3.5 Lightning 30B-A3B').trim(),
    thinking: bool(env.PLANNER_THINKING, false),
    templateKwargs: bool(env.PLANNER_TEMPLATE_KWARGS, endpointKind === 'self-hosted-vllm'),
    freezeWhileThinking: bool(env.PLANNER_FREEZE_WHILE_THINKING, endpointKind === 'hosted-api'),
    temperature: num(env.PLANNER_TEMPERATURE, 0.6),
    topP: num(env.PLANNER_TOP_P, 0.95),
    maxTokens: num(env.PLANNER_MAX_TOKENS, 1024),
    deadlineMs: num(env.PLANNER_DEADLINE_MS, 20000),
    // Safety stop only (there is no gameplay timer). Matches the engine default.
    maxDecisions: num(env.PLANNER_MAX_DECISIONS, 60),
    harness,
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
  return `${c.label} · ${c.model} @ ${c.baseUrl} (${c.endpointKind}, thinking ${c.thinking ? 'on' : 'off'}, key ${c.apiKey ? 'set' : 'MISSING'})`;
}
