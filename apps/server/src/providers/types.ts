import type { Harness } from '../config.js';
import type { ActorId, AgentView, MapData, NormalizedToolCall, OpenAIToolDef, PlannerView, ProviderInfo } from '@escape/contracts';

export interface DecideRequest {
  system: string;
  /** Central mode: the team-wide view (the user message is built from it). */
  view?: PlannerView;
  /** Per-agent mode: one person's own view and their ready-made user message. */
  agent?: { actor: ActorId; view: AgentView; user: string };
  /** Office map (earshot groups in the central digest). */
  map?: MapData;
  /** Prompt harness for the user message (v1 baseline / v2 with state digest). Default v2. */
  harness?: Harness;
  tools: OpenAIToolDef[];
  signal: AbortSignal;
  deadlineMs: number;
}

export interface Usage {
  promptTokens?: number;
  completionTokens?: number;
}

export type DecisionResult =
  | {
      kind: 'tool_call';
      calls: NormalizedToolCall[];
      parseMode: 'native' | 'content-fallback';
      latencyMs: number;
      usage?: Usage;
      /** Arguments that failed JSON.parse (call kept with arguments {}). */
      malformedArguments?: boolean;
      /** The model's thinking (reasoning on). */
      reasoning?: string;
      raw: { request?: unknown; response?: unknown };
    }
  | { kind: 'no_call'; text: string; latencyMs: number; usage?: Usage; reasoning?: string; raw: { request?: unknown; response?: unknown } }
  | {
      kind: 'error';
      code: 'TIMEOUT' | 'HTTP' | 'NETWORK' | 'PARSE' | 'ABORTED';
      message: string;
      status?: number;
      latencyMs: number;
      raw?: { request?: unknown; response?: unknown };
    };

export interface DecisionProvider {
  info(): ProviderInfo;
  health(): Promise<{ ok: boolean; detail: string }>;
  decide(req: DecideRequest): Promise<DecisionResult>;
}

/** Short model name for per-agent origins, e.g. "Nemotron → Maya (own decision) → move". */
export function modelName(info: ProviderInfo): string {
  if (info.endpointKind === 'scripted') return 'SCRIPTED fixture';
  if (/nemotron/i.test(`${info.model} ${info.label}`)) return 'Nemotron';
  return info.label;
}

/** Name used in trace origins, e.g. "Nemotron planner → Maya → notify". */
export function plannerName(info: ProviderInfo): string {
  if (info.endpointKind === 'scripted') return 'SCRIPTED fixture';
  if (/nemotron/i.test(`${info.model} ${info.label}`)) return 'Nemotron planner';
  return `${info.label} planner`;
}

/** Rolling latency stats shared by providers. */
export class LatencyStats {
  private samples: number[] = [];
  last?: number;
  add(ms: number) {
    this.last = Math.round(ms);
    this.samples.push(ms);
    if (this.samples.length > 200) this.samples.shift();
  }
  p50(): number | undefined {
    if (!this.samples.length) return undefined;
    const s = [...this.samples].sort((a, b) => a - b);
    return Math.round(s[Math.floor((s.length - 1) / 2)]);
  }
}
