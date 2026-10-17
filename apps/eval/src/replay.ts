// Re-simulate a saved run log through a fresh engine and check it reproduces the recorded run.
// Model calls are NOT re-issued: the recorded, normalized decisions are applied at their recorded ticks.
//
//   npm run replay -- runs/<episodeId>.jsonl [--quiet]
//
// Exit code 0 = reproduced (final state hash + event count + outcome match), 1 = mismatch.
import type { CreateEngine, EpisodeResult, MapData } from '@escape/contracts';
import { loadMapFile } from '../../server/src/data.js';
import { applyInput, readRunLog, type RunHeader, type RunInput, type RunLine } from '../../server/src/runlog.js';

export interface ReplayReport {
  runId: string;
  caseId: string;
  inputs: number;
  finalTick: number;
  expected: { hash?: string; eventCount?: number; outcome?: string };
  actual: { hash: string; eventCount: number; outcome?: string };
  match: boolean;
  notes: string[];
}

const INPUT_TYPES = new Set(['place', 'remove', 'begin', 'view', 'tool', 'note', 'end']);

/** Accepts inputs written flat ({type:'tool', tick, ...}), wrapped ({type:'input', input:{...}}) or
 *  flattened with an inputType field ({type:'input', inputType:'tool', ...}). */
export function extractInputs(lines: readonly unknown[]): RunInput[] {
  const out: RunInput[] = [];
  for (const raw of lines) {
    const l = raw as Record<string, unknown>;
    if (l.type === 'input' && l.input && typeof l.input === 'object') out.push(l.input as RunInput);
    else if (l.type === 'input' && typeof l.inputType === 'string') out.push({ ...l, type: l.inputType } as unknown as RunInput);
    else if (typeof l.type === 'string' && INPUT_TYPES.has(l.type)) out.push(l as unknown as RunInput);
  }
  return out;
}

export async function replayLines(lines: RunLine[], opts: { map?: MapData; createEngine?: CreateEngine } = {}): Promise<ReplayReport> {
  const header = lines.find((l): l is RunHeader => l.type === 'header');
  if (!header) throw new Error('run log has no header');
  const footer = lines.find((l) => l.type === 'footer') as Extract<RunLine, { type: 'footer' }> | undefined;
  const recorded = lines.find((l) => l.type === 'result') as { result: EpisodeResult } | undefined;
  const inputs = extractInputs(lines);

  const map = opts.map ?? loadMapFile(header.mapId);
  const notes: string[] = [];
  if (map.hash !== header.mapHash) notes.push(`map hash differs (log ${header.mapHash}, current ${map.hash}) — replay may diverge`);
  const create: CreateEngine = opts.createEngine ?? (await import('@escape/engine')).createEngine;
  const engine = create(map, header.scenario, { episodeId: header.episodeId, ...header.engineOptions });

  let tick = 0;
  for (const inp of inputs) {
    while (tick < inp.tick) {
      engine.step();
      tick++;
    }
    applyInput(engine, inp);
  }
  const finalTick = footer?.finalTick ?? tick;
  while (tick < finalTick) {
    engine.step();
    tick++;
  }
  if (!footer) notes.push('run log has no footer (run was interrupted?) — compared outcome only');

  const actual = { hash: engine.hash(), eventCount: engine.events.length, outcome: engine.outcome()?.status };
  const expected = { hash: footer?.hash, eventCount: footer?.eventCount, outcome: recorded?.result.outcome.status };
  const match =
    (expected.hash === undefined || expected.hash === actual.hash) &&
    (expected.eventCount === undefined || expected.eventCount === actual.eventCount) &&
    (expected.outcome === undefined || expected.outcome === actual.outcome);
  return { runId: header.runId, caseId: header.scenario.caseId, inputs: inputs.length, finalTick, expected, actual, match, notes };
}

if (process.argv[1]?.endsWith('replay.ts')) {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const path = args.find((a) => !a.startsWith('--'));
  if (!path) {
    console.error('usage: npm run replay -- runs/<episodeId>.jsonl');
    process.exit(2);
  }
  replayLines(readRunLog(path))
    .then((r) => {
      console.log(`[replay] ${r.runId} (case ${r.caseId}) · ${r.inputs} inputs · ${r.finalTick} ticks`);
      console.log(`[replay] expected hash ${r.expected.hash ?? '—'} events ${r.expected.eventCount ?? '—'} outcome ${r.expected.outcome ?? '—'}`);
      console.log(`[replay] actual   hash ${r.actual.hash} events ${r.actual.eventCount} outcome ${r.actual.outcome ?? '—'}`);
      for (const n of r.notes) console.log(`[replay] note: ${n}`);
      console.log(r.match ? '[replay] REPRODUCED ✓' : '[replay] MISMATCH ✗');
      process.exit(r.match ? 0 : 1);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
