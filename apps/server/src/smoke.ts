// Endpoint smoke test for the inference lead:
//   npx tsx --env-file=.env apps/server/src/smoke.ts              one real tool-call round trip
//   npx tsx --env-file=.env apps/server/src/smoke.ts --recovery   + feed ROUTE_UNAVAILABLE, check it replans
//   npx tsx --env-file=.env apps/server/src/smoke.ts --n 20       latency p50/p95 over N calls
// Uses the real prompt/tools and views taken from a real engine running the scripted hero story (dev-00-hero): the
// first decision after the fire is seen, and (for --recovery) the first decision after a move is cut by a dead door.
import type { PlannerView, ScenarioCase } from '@escape/contracts';
import { createEngine } from '@escape/engine';
import { describePlanner, readPlannerConfig } from './config.js';
import { loadCases, loadMapFile } from './data.js';
import { createProviderFromEnv } from './headless.js';
import { buildSystemPrompt, toolsFor as toolsForHarness } from './prompt.js';
import { ScriptedProvider } from './providers/scripted.js';
import type { DecisionResult } from './providers/types.js';

const args = process.argv.slice(2);
const recovery = args.includes('--recovery');
const nIdx = args.indexOf('--n');
const N = nIdx >= 0 ? Math.max(1, Number(args[nIdx + 1]) || 1) : 1;

const cfg = readPlannerConfig();
const provider = createProviderFromEnv();
const map = loadMapFile();
const scenario: ScenarioCase = loadCases().get('dev-00-hero') ?? [...loadCases().values()][0];
const system = buildSystemPrompt(cfg.harness, map, scenario);
const toolsFor = (view: PlannerView) => toolsForHarness(cfg.harness, view, map);

/** Run the hero story with the scripted fixture; return the first planner view matching `want` (or the last one). */
async function viewWhere(want: (v: PlannerView) => boolean): Promise<PlannerView> {
  const engine = createEngine(map, scenario, { episodeId: 'smoke' });
  const fixture = new ScriptedProvider({ latencyMs: [0, 0] });
  let last: PlannerView | null = null;
  for (let guard = 0; guard < 6000 && !engine.outcome(); guard++) {
    if (!engine.needsDecision().needed) {
      engine.step();
      continue;
    }
    const decisionId = engine.beginDecision();
    const view = engine.plannerView();
    engine.markViewed();
    if (want(view)) return view;
    last = view;
    const r = await fixture.decide({ system, view, harness: cfg.harness, tools: toolsFor(view), signal: new AbortController().signal, deadlineMs: cfg.deadlineMs });
    if (r.kind === 'tool_call') engine.executeTool(r.calls[0], { decisionId, latencyMs: 0 });
  }
  if (!last) throw new Error('the hero story never asked for a decision');
  return last;
}

const interrupted = (v: PlannerView) => v.recent_actions.some((a) => !a.ok && a.error_code === 'ROUTE_UNAVAILABLE') || v.new_since_last_decision.some((t) => /interrupted/i.test(t));

function show(label: string, r: DecisionResult) {
  if (r.kind === 'tool_call') {
    console.log(`${label}: ${r.latencyMs} ms  parse=${r.parseMode}  tokens=${r.usage?.promptTokens ?? '?'}/${r.usage?.completionTokens ?? '?'}`);
    for (const c of r.calls) console.log(`  → ${c.name}(${JSON.stringify(c.arguments)})`);
  } else if (r.kind === 'no_call') {
    console.log(`${label}: ${r.latencyMs} ms  NO TOOL CALL: ${r.text.slice(0, 200)}`);
  } else {
    console.log(`${label}: ${r.latencyMs} ms  ERROR ${r.code}: ${r.message}`);
  }
}

async function main() {
  console.log(`planner: ${describePlanner(cfg)}`);
  const h = await provider.health();
  console.log(`health: ${h.ok ? 'OK' : 'FAIL'} — ${h.detail}`);
  const lat: number[] = [];
  const baseView = await viewWhere(() => true);
  for (let i = 0; i < N; i++) {
    const r = await provider.decide({ system, view: baseView, harness: cfg.harness, tools: toolsFor(baseView), signal: new AbortController().signal, deadlineMs: cfg.deadlineMs });
    show(N > 1 ? `call ${i + 1}` : 'tool call', r);
    if (r.kind !== 'error') lat.push(r.latencyMs);
  }
  if (lat.length > 1) {
    const s = [...lat].sort((a, b) => a - b);
    const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
    console.log(`latency over ${s.length}: p50 ${q(0.5)} ms  p95 ${q(0.95)} ms  min ${s[0]}  max ${s[s.length - 1]}`);
  }
  if (recovery) {
    const recoveryView = await viewWhere(interrupted);
    if (!interrupted(recoveryView)) console.log('note: the scripted run never had a move cut short; using its last view');
    const r = await provider.decide({ system, view: recoveryView, harness: cfg.harness, tools: toolsFor(recoveryView), signal: new AbortController().signal, deadlineMs: cfg.deadlineMs });
    show('recovery', r);
    const name = r.kind === 'tool_call' ? r.calls[0]?.name : undefined;
    const good = name === 'plan_route' || name === 'notify' || (name === 'move' && !!(r.kind === 'tool_call' && r.calls[0].arguments.route_id));
    console.log(`recovery check: ${good ? 'PASS' : 'CHECK'} (expected notify route_blocked or plan_route after ROUTE_UNAVAILABLE; got ${name ?? r.kind})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
