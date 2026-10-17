// The engine boundary. packages/engine implements this; apps/server and apps/eval consume it.
// The engine is pure and deterministic: no timers, no I/O, no Math.random (seeded PRNG only).
import type {
  ActorId,
  EpisodeOutcome,
  EpisodeResult,
  HazardKind,
  MapData,
  NormalizedToolCall,
  PlannerView,
  ScenarioCase,
  Snapshot,
  ToolResult,
  WorldEvent,
} from './types.js';

export interface EngineOptions {
  episodeId: string;
  /** Simulated milliseconds per tick (default 100). */
  tickMs?: number;
  /** Decision cap per episode (default 24). */
  maxDecisions?: number;
  /** Simulated-seconds cap (default 240). */
  maxSimTime?: number;
  /** Seed for idle/ambient behaviour; defaults to scenario.seed. */
  seed?: number;
}

export type PlacementResult =
  | { ok: true; event: WorldEvent }
  | {
      ok: false;
      code: 'OUT_OF_BOUNDS' | 'NOT_FLOOR' | 'FURNITURE' | 'EXIT_OR_ASSEMBLY' | 'OCCUPIED' | 'OVERLAP' | 'NOT_PLACEABLE_ZONE' | 'ALREADY_PLACED' | 'EPISODE_OVER';
      reason: string;
    };

/** Non-tool decision outcomes the orchestrator reports so they count toward the cap and appear in planner feedback. */
export interface DecisionNote {
  decisionId: string;
  kind: 'malformed' | 'no_call' | 'provider_error' | 'discarded_stale' | 'ignored_extra_call';
  detail: string;
}

export interface DecisionMeta {
  decisionId: string;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
}

export interface Engine {
  readonly map: MapData;
  readonly scenario: ScenarioCase;
  readonly episodeId: string;

  /** Advance one tick: movement, perception, scheduled events, idle behaviour, outcome checks. Returns new events. */
  step(): WorldEvent[];

  placeHazard(kind: HazardKind, col: number, row: number): PlacementResult;
  /** Only allowed while the server reports paused, or before an incident. Server enforces pause rule. */
  removeHazard(kind: HazardKind): { ok: boolean; reason?: string; event?: WorldEvent };

  /** Starts a new decision; increments the count. Returns e.g. "D-007". */
  beginDecision(): string;
  /** Validate + apply one tool call. Invalid calls never mutate world state. Idempotent on call.id. */
  executeTool(call: NormalizedToolCall, meta: DecisionMeta): ToolResult;
  /** Record a decision that produced no executable call (counts toward the cap; fed back to the planner). */
  noteDecision(note: DecisionNote, meta?: Omit<DecisionMeta, 'decisionId'>): void;

  /** Whether the planner has useful work now (incident active, not ended, and something changed or someone is ready). */
  needsDecision(): { needed: boolean; reason: string };
  plannerView(): PlannerView;
  /** Marks all events up to now as seen by the planner (call right after building a view for a decision). */
  markViewed(): void;

  snapshot(): Snapshot;
  readonly events: readonly WorldEvent[];
  eventsSince(seq: number): WorldEvent[];

  outcome(): EpisodeOutcome | null;
  /** Force-end (e.g. provider aborted). No-op if already ended. */
  end(status: 'aborted' | 'incomplete', reason: string): void;
  result(wallTimeMs?: number): EpisodeResult | null;

  /** Stable hash of canonical world state (tests: invalid calls must not change it). */
  hash(): string;
}

export type CreateEngine = (map: MapData, scenario: ScenarioCase, opts: EngineOptions) => Engine;

/** Actor display metadata shared by engine/web. */
export const ACTOR_PROFILES: Record<ActorId, { name: string; role: string; profile: string; usesWheelchair: boolean }> = {
  alex: {
    name: 'Alex',
    role: 'Exercise warden (employee)',
    profile: 'Calm, trained in the fictional evacuation plan, knows the layout and roster. Designated buddy for visitors who ask for help.',
    usesWheelchair: false,
  },
  maya: {
    name: 'Maya',
    role: 'Employee',
    profile: 'Observant and empathetic; reports what she sees and helps when appropriate.',
    usesWheelchair: false,
  },
  daniel: {
    name: 'Daniel',
    role: 'Visitor (uses a wheelchair)',
    profile: 'Unfamiliar with the building. Navigates accessible routes himself; has asked for a buddy to guide him if there is an evacuation.',
    usesWheelchair: true,
  },
};
