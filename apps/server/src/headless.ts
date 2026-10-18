// Headless (lockstep) episodes for evaluation: the sim is frozen while a decision is awaited,
// so simulated time measures plan quality, not inference latency. Wall-clock and latency are
// reported separately in the result metrics. There is no gameplay timer; a stall ceiling (sim seconds
// since the incident) only stops runs where nothing can progress any more.
import type { CreateEngine, EpisodeResult, MapData, ScenarioCase, TraceRow } from '@escape/contracts';
import { readPlannerConfig, type Harness, type PlannerConfig, type PlannerMode } from './config.js';
import { loadMapFile } from './data.js';
import { Orchestrator } from './orchestrator.js';
import { OpenAICompatibleProvider } from './providers/openaiCompatible.js';
import { ScriptedProvider, type ScriptedOptions } from './providers/scripted.js';
import type { DecisionProvider } from './providers/types.js';
import { RunLog } from './runlog.js';

export type { DecisionProvider } from './providers/types.js';

/** Default headless safety stop: sim seconds after the incident with no completion. Not a game timer. */
export const DEFAULT_STALL_CEILING_SIM_SEC = 900;

/** Absolute tick guard for loops that step the engine: the stall ceiling plus pre-incident slack (100 ms ticks). */
export function stallGuardTicks(stallCeilingSimSec: number): number {
  return Math.ceil((stallCeilingSimSec + 300) * 10);
}

export interface HeadlessOptions {
  scenario: ScenarioCase;
  provider: DecisionProvider;
  harness: Harness;
  /** 'central' (default) or 'agents' (each person decides; engine instincts off). */
  mode?: PlannerMode;
  maxDecisions?: number;
  /** Safety stop (sim seconds since the incident) for runs that can no longer progress. Default 900. */
  stallCeilingSimSec?: number;
  episodeId?: string;
  onRow?: (row: TraceRow) => void;
  /** Optional: write the run log to this path as it goes. */
  runLogPath?: string;
  /** Optional overrides (tests). */
  map?: MapData;
  createEngine?: CreateEngine;
  deadlineMs?: number;
}

export async function runEpisodeHeadless(
  opts: HeadlessOptions,
): Promise<{ result: EpisodeResult; trace: TraceRow[]; runLogLines: unknown[] }> {
  const map = opts.map ?? loadMapFile(opts.scenario.mapId);
  const create: CreateEngine = opts.createEngine ?? (await import('@escape/engine')).createEngine;
  const episodeId = opts.episodeId ?? `bench-${opts.scenario.caseId}-${Date.now().toString(36)}`;
  const mode: PlannerMode = opts.mode ?? 'central';
  const maxDecisions = opts.maxDecisions ?? readPlannerConfig({ PLANNER_MODE: mode }).maxDecisions;
  const stallCeilingSimSec = opts.stallCeilingSimSec ?? DEFAULT_STALL_CEILING_SIM_SEC;
  // Per-agent mode: no hard-coded instincts — each person's own model call decides.
  const instincts = mode !== 'agents';
  const engine = create(map, opts.scenario, { episodeId, maxDecisions, stallCeilingSimSec, instincts });

  let tick = 0;
  const rows = new Map<string, TraceRow>();
  const log = new RunLog(opts.runLogPath ?? null);
  const info = opts.provider.info();
  log.write({
    type: 'header',
    runId: episodeId,
    episodeId,
    createdAt: new Date().toISOString(),
    scenario: opts.scenario,
    mapId: map.id,
    mapHash: map.hash,
    provider: { id: info.id, label: info.label, model: info.model, endpointKind: info.endpointKind, baseUrl: info.baseUrl, thinking: info.thinking, ...(info.thinkingBudget ? { thinkingBudget: info.thinkingBudget } : {}) },
    harness: opts.harness,
    mode,
    engineOptions: { maxDecisions, stallCeilingSimSec, instincts },
    clock: 'lockstep',
  });

  const orch = new Orchestrator({
    engine,
    provider: opts.provider,
    map,
    scenario: opts.scenario,
    harness: opts.harness,
    mode,
    deadlineMs: opts.deadlineMs ?? readPlannerConfig().deadlineMs,
    getTick: () => tick,
    isPaused: () => false,
    emitRow: (row) => {
      rows.set(row.id, row);
      opts.onRow?.(row);
      log.write({ type: 'trace', tick, row });
    },
    recordInput: (input) => log.write({ type: 'input', input }),
  });

  const wallStart = Date.now();
  // Hard guard beyond the engine's own stall ceiling (an idle office never times out, so bound it here too).
  const tickLimit = stallGuardTicks(stallCeilingSimSec);
  let decisionsGuard = 0;
  while (!engine.outcome()) {
    const agents = mode === 'agents' ? orch.readyAgents() : [];
    if (mode === 'agents' ? agents.length > 0 : orch.ready()) {
      // Per-agent: everyone ready decides "at the same moment" (asked in parallel, applied in a fixed order).
      if (mode === 'agents') await orch.decideAgents(agents);
      else await orch.decideOnce();
      if (++decisionsGuard > maxDecisions * 3) engine.end('incomplete', 'headless guard: too many decision attempts');
    } else {
      engine.step();
      tick++;
      orch.ingestNew();
      if (tick > tickLimit) engine.end('incomplete', 'headless guard: tick limit');
    }
  }
  orch.ingestNew();
  const result = engine.result(Date.now() - wallStart);
  if (!result) throw new Error('engine ended without a result');
  log.write({ type: 'result', tick, result });
  log.write({ type: 'footer', finalTick: tick, hash: engine.hash(), eventCount: engine.events.length });
  return { result, trace: [...rows.values()], runLogLines: log.lines };
}

/** Build the provider configured by env (PLANNER_*). Overrides win (e.g. harness sweeps, thinking A/B). */
export function createProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
  overrides?: Partial<PlannerConfig> & { scripted?: ScriptedOptions },
): DecisionProvider {
  const cfg = { ...readPlannerConfig(env), ...overrides };
  if (cfg.provider === 'scripted') return new ScriptedProvider({ ...overrides?.scripted, mode: cfg.mode });
  return new OpenAICompatibleProvider(cfg);
}

export { readPlannerConfig } from './config.js';
