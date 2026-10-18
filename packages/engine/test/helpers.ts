import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Engine, NormalizedToolCall, ScenarioCase, ToolResult } from '@escape/contracts';
import { createEngine, loadMap, type RunInputs } from '../src/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const map = loadMap();
/** demo-hero spawns/seed/preference; its presenter events are 'manual' (ignored by the engine), so they are dropped. */
export const hero = (): ScenarioCase => ({ ...(JSON.parse(readFileSync(join(root, 'data/scenarios/demo-hero.json'), 'utf8')) as ScenarioCase), events: [] });

/** Test driver that also records RunInputs for replay checks. */
export class Driver {
  engine: Engine;
  inputs: RunInputs = [];
  private n = 0;
  constructor(public scenario: ScenarioCase = hero(), opts: { maxDecisions?: number; stallCeilingSimSec?: number; fireSpreadPerTick?: number; ambient?: boolean; instincts?: boolean } = {}) {
    this.engine = createEngine(map, scenario, { episodeId: 'test-ep', ...opts });
  }
  get tick() {
    return this.engine.snapshot().tick;
  }
  actor(id: string) {
    return this.engine.snapshot().actors.find((a) => a.id === id)!;
  }
  place(kind: 'fire' | 'electrical', col: number, row: number) {
    this.inputs.push({ tick: this.tick, kind: 'place', hazard: kind, col, row });
    return this.engine.placeHazard(kind, col, row);
  }
  call(name: string, args: Record<string, unknown>, id?: string): ToolResult {
    const call: NormalizedToolCall = { id: id ?? `call-${++this.n}`, name, arguments: args };
    const tick = this.tick;
    const decisionId = this.engine.beginDecision();
    const r = this.engine.executeTool(call, { decisionId, latencyMs: 100 });
    this.inputs.push({ tick, kind: 'decision', decisionId, call, meta: { latencyMs: 100 } });
    this.engine.markViewed();
    return r;
  }
  note(kind: 'malformed' | 'no_call' | 'provider_error', detail = 'test') {
    const tick = this.tick;
    const decisionId = this.engine.beginDecision();
    this.engine.noteDecision({ decisionId, kind, detail });
    this.inputs.push({ tick, kind: 'decision', decisionId, notes: [{ kind, detail }] });
  }
  run(ticks: number) {
    for (let i = 0; i < ticks && !this.engine.outcome(); i++) this.engine.step();
  }
  until(pred: () => boolean, max = 2000) {
    for (let i = 0; i < max && !pred() && !this.engine.outcome(); i++) this.engine.step();
    return pred();
  }
  lost(id: string) {
    return this.actor(id).lost;
  }
  idle(id: string) {
    const a = this.actor(id);
    return !a.task && !(a.escort?.role === 'follower' && this.actor(a.escort.partner).task);
  }
}

export const okData = (r: ToolResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r.data;
};
export const errCode = (r: ToolResult) => (r.ok ? 'OK' : r.error.code);
