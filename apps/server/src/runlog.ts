// Run log (runs/<episodeId>.jsonl): header, tick-stamped inputs, trace rows, result, footer.
// Inputs are everything that mutated the engine besides step(): replaying them at the same ticks
// through a fresh engine reproduces the run exactly (engine is deterministic).
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ActorId,
  DecisionMeta,
  DecisionNote,
  Engine,
  EpisodeResult,
  HazardKind,
  NormalizedToolCall,
  ProviderInfo,
  RunSummary,
  ScenarioCase,
  TraceRow,
} from '@escape/contracts';

export type RunInput =
  | { tick: number; type: 'place'; kind: HazardKind; col: number; row: number }
  | { tick: number; type: 'begin'; decisionId: string }
  /** Central: the team view. With `actor` (per-agent mode): that person's own view. */
  | { tick: number; type: 'view'; actor?: ActorId }
  | { tick: number; type: 'tool'; call: NormalizedToolCall; meta: DecisionMeta }
  | { tick: number; type: 'note'; note: DecisionNote; meta?: Omit<DecisionMeta, 'decisionId'> }
  | { tick: number; type: 'end'; status: 'aborted' | 'incomplete'; reason: string };

export interface RunHeader {
  type: 'header';
  runId: string;
  episodeId: string;
  createdAt: string;
  scenario: ScenarioCase;
  mapId: string;
  mapHash: string;
  provider: Omit<ProviderInfo, 'healthy' | 'healthDetail' | 'p50LatencyMs' | 'lastLatencyMs'>;
  harness: string;
  /** 'agents' = each person decided for themselves (absent in older logs = central). */
  mode?: 'central' | 'agents';
  /** Live runs have no stall ceiling (there is no gameplay timer); headless runs record theirs. */
  engineOptions: {
    maxDecisions: number;
    stallCeilingSimSec?: number;
    seed?: number;
    tickMs?: number;
    instincts?: boolean;
    ambient?: boolean;
    fireSpreadPerTick?: number;
  };
  clock: 'live' | 'lockstep';
}

export type RunLine =
  | RunHeader
  | { type: 'input'; input: RunInput }
  | { type: 'trace'; tick: number; row: TraceRow }
  | { type: 'result'; tick: number; result: EpisodeResult }
  | { type: 'footer'; finalTick: number; hash: string; eventCount: number };

/** Engine options recorded in a run header, minus anything older rulesets used (e.g. maxSimTime). */
export function replayEngineOptions(h: RunHeader): RunHeader['engineOptions'] {
  const o = h.engineOptions;
  return {
    maxDecisions: o.maxDecisions,
    ...(o.stallCeilingSimSec !== undefined ? { stallCeilingSimSec: o.stallCeilingSimSec } : {}),
    ...(o.seed !== undefined ? { seed: o.seed } : {}),
    ...(o.tickMs !== undefined ? { tickMs: o.tickMs } : {}),
    ...(o.instincts !== undefined ? { instincts: o.instincts } : {}),
    ...(o.ambient !== undefined ? { ambient: o.ambient } : {}),
    ...(o.fireSpreadPerTick !== undefined ? { fireSpreadPerTick: o.fireSpreadPerTick } : {}),
  };
}

/** Apply a recorded input to an engine (used live, in headless runs and in replay). */
export function applyInput(engine: Engine, input: RunInput): void {
  switch (input.type) {
    case 'place':
      engine.placeHazard(input.kind, input.col, input.row);
      return;
    case 'begin':
      engine.beginDecision();
      return;
    case 'view':
      if (input.actor) {
        engine.agentView(input.actor);
        engine.markAgentViewed(input.actor);
        return;
      }
      engine.plannerView();
      engine.markViewed();
      return;
    case 'tool':
      engine.executeTool(input.call, input.meta);
      return;
    case 'note':
      engine.noteDecision(input.note, input.meta);
      return;
    case 'end':
      engine.end(input.status, input.reason);
      return;
    default:
      // Inputs from older rulesets (e.g. 'remove') have no meaning in this engine; a replay of such a log
      // reports divergence honestly via the footer hash check.
      return;
  }
}

export class RunLog {
  readonly lines: RunLine[] = [];
  constructor(private path: string | null) {
    if (path) {
      const dir = path.slice(0, path.lastIndexOf('/'));
      if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }
  write(line: RunLine) {
    this.lines.push(line);
    if (!this.path) return;
    try {
      appendFileSync(this.path, JSON.stringify(line) + '\n');
    } catch (e) {
      console.error(`[runlog] write failed: ${(e as Error).message}`);
      this.path = null;
    }
  }
}

export function readRunLog(path: string): RunLine[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as RunLine);
}

export function listRuns(dir: string): RunSummary[] {
  if (!existsSync(dir)) return [];
  const out: RunSummary[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    const p = join(dir, f);
    try {
      const text = readFileSync(p, 'utf8');
      const first = text.slice(0, text.indexOf('\n') > 0 ? text.indexOf('\n') : undefined);
      const header = JSON.parse(first) as RunHeader;
      if (header.type !== 'header') continue;
      const m = text.match(/"type":"result".*?"status":"(\w+)"/);
      out.push({
        runId: f.replace(/\.jsonl$/, ''),
        caseId: header.scenario.caseId,
        outcome: m?.[1],
        createdAt: header.createdAt,
        mapHash: header.mapHash,
        scripted: header.provider?.endpointKind === 'scripted',
      });
    } catch {
      out.push({ runId: f.replace(/\.jsonl$/, ''), caseId: '?', createdAt: statSync(p).mtime.toISOString() });
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
