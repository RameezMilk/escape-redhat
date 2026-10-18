// Deterministic replay: re-simulate an episode from its logged inputs.
// The server records each input with the engine tick at which it was applied (inputs are applied
// BETWEEN steps: at engine tick T, after the step that produced T and before the next step).
import type { DecisionMeta, DecisionNote, Engine, EngineOptions, HazardKind, MapData, NormalizedToolCall, ScenarioCase } from '@escape/contracts';
import { createEngine } from './world.js';

export type RunInput =
  | { tick: number; kind: 'place'; hazard: HazardKind; col: number; row: number }
  /** One planner decision: beginDecision() then (optionally) executeTool(call) then any notes, in that order. */
  | {
      tick: number;
      kind: 'decision';
      decisionId: string;
      call?: NormalizedToolCall;
      notes?: Omit<DecisionNote, 'decisionId'>[];
      meta?: Omit<DecisionMeta, 'decisionId'>;
    }
  /** Force-end (e.g. provider aborted). */
  | { tick: number; kind: 'end'; status: 'aborted' | 'incomplete'; reason: string };

export type RunInputs = RunInput[];

/** Apply one logged input to an engine at its current tick. */
export function applyInput(engine: Engine, input: RunInput): void {
  switch (input.kind) {
    case 'place':
      engine.placeHazard(input.hazard, input.col, input.row);
      break;
    case 'decision': {
      const id = engine.beginDecision();
      if (input.call) engine.executeTool(input.call, { decisionId: id, ...(input.meta ?? {}) });
      for (const n of input.notes ?? []) engine.noteDecision({ ...n, decisionId: id }, input.call ? undefined : input.meta);
      break;
    }
    case 'end':
      engine.end(input.status, input.reason);
      break;
  }
}

/**
 * Re-simulate: at each tick apply that tick's inputs (in order), then step. Stops when the episode
 * ends or the tick passes untilTick (default: the last input's tick).
 */
export function replayRun(map: MapData, scenario: ScenarioCase, opts: EngineOptions, inputs: RunInputs, untilTick?: number): Engine {
  const engine = createEngine(map, scenario, opts);
  const sorted = [...inputs].sort((a, b) => a.tick - b.tick);
  const last = untilTick ?? (sorted.length ? sorted[sorted.length - 1].tick : 0);
  let i = 0;
  for (;;) {
    const t = engine.snapshot().tick;
    while (i < sorted.length && sorted[i].tick <= t) applyInput(engine, sorted[i++]);
    if (engine.outcome() || t >= last) break;
    engine.step();
  }
  return engine;
}
