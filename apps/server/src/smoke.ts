// Endpoint smoke test for the inference lead:
//   npx tsx --env-file=.env apps/server/src/smoke.ts              one real tool-call round trip
//   npx tsx --env-file=.env apps/server/src/smoke.ts --recovery   + feed ROUTE_UNAVAILABLE, check it replans
//   npx tsx --env-file=.env apps/server/src/smoke.ts --n 20       latency p50/p95 over N calls
// Uses the real prompt/tools with a tiny hand-written planner view (no engine needed).
import { TOOL_DEFS, type PlannerView, type ScenarioCase } from '@escape/contracts';
import { describePlanner, readPlannerConfig } from './config.js';
import { loadCases, loadMapFile } from './data.js';
import { createProviderFromEnv } from './headless.js';
import { buildSystemPrompt } from './prompt.js';
import type { DecisionResult } from './providers/types.js';

const args = process.argv.slice(2);
const recovery = args.includes('--recovery');
const nIdx = args.indexOf('--n');
const N = nIdx >= 0 ? Math.max(1, Number(args[nIdx + 1]) || 1) : 1;

const cfg = readPlannerConfig();
const provider = createProviderFromEnv();
const map = loadMapFile();
const scenario: ScenarioCase = loadCases().get('demo-hero')!;
const system = buildSystemPrompt(cfg.harness, map, scenario);

const baseView: PlannerView = {
  sim_time: 4.2,
  phase: 'incident',
  decisions_remaining: 23,
  actors: [
    { id: 'alex', name: 'Alex', role: 'Exercise warden (employee)', zone: 'lobby', tile: [22, 8], status: 'working', alerted: false, checked_in: false, busy: null, knows_evidence: [], escort: null, uses_wheelchair: false },
    { id: 'maya', name: 'Maya', role: 'Employee', zone: 'rh_room', tile: [13, 7], status: 'alerted', alerted: true, checked_in: false, busy: null, knows_evidence: ['E1'], escort: null, uses_wheelchair: false },
    { id: 'daniel', name: 'Daniel', role: 'Visitor (uses a wheelchair)', zone: 'rh_room', tile: [15, 12], status: 'working', alerted: false, checked_in: false, busy: null, knows_evidence: [], escort: null, uses_wheelchair: true },
  ],
  evidence: [{ id: 'E1', kind: 'fire', zone: 'rh_room', tiles: [[8, 5], [9, 5], [8, 6], [9, 6]], observed_by: 'maya', at: 4.1, known_by: ['maya'] }],
  messages: [],
  assistance: { person: 'daniel', preference: 'buddy', buddy: 'alex', requested: false, accepted: false, fulfilled: false },
  roster: { checked_in: [], verified: false },
  routes: [],
  recent_actions: [],
  new_since_last_decision: ['Maya observed fire E1 in rh_room near door_a'],
};

const recoveryView: PlannerView = {
  ...baseView,
  sim_time: 31.5,
  phase: 'evacuating',
  decisions_remaining: 15,
  actors: [
    { ...baseView.actors[0], zone: 'lobby', tile: [26, 11], status: 'escorting', alerted: true, busy: null, knows_evidence: ['E1', 'E2'], escort: 'escorting daniel' },
    { ...baseView.actors[1], zone: 'assembly', tile: [15, 20], status: 'alerted', alerted: true },
    { ...baseView.actors[2], zone: 'lobby', tile: [25, 11], status: 'escorted', alerted: true, knows_evidence: ['E1', 'E2'], escort: 'escorted by alex' },
  ],
  evidence: [
    ...baseView.evidence.map((e) => ({ ...e, known_by: ['alex', 'maya', 'daniel'] as ('alex' | 'maya' | 'daniel')[] })),
    { id: 'E2', kind: 'blocker', zone: 'south_branch', tiles: [[26, 15], [27, 15], [26, 16], [27, 16]], observed_by: 'alex', at: 31.2, known_by: ['alex', 'daniel'] },
  ],
  assistance: { ...baseView.assistance, requested: true, accepted: true },
  recent_actions: [
    { decision: 'D-008', actor: 'alex', tool: 'move', args: { actor_id: 'alex', destination: 'assembly' }, ok: false, summary: 'Move interrupted: route blocked in south_branch (E2). Stopped safely at (26,11).', error_code: 'ROUTE_UNAVAILABLE', hint: 'Tell others, then plan_route to get an alternate route and move with its route_id.' },
  ],
  new_since_last_decision: ["Alex's move was interrupted: blocker E2 in south_branch"],
};

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
  for (let i = 0; i < N; i++) {
    const r = await provider.decide({ system, view: baseView, harness: cfg.harness, tools: TOOL_DEFS, signal: new AbortController().signal, deadlineMs: cfg.deadlineMs });
    show(N > 1 ? `call ${i + 1}` : 'tool call', r);
    if (r.kind !== 'error') lat.push(r.latencyMs);
  }
  if (lat.length > 1) {
    const s = [...lat].sort((a, b) => a - b);
    const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
    console.log(`latency over ${s.length}: p50 ${q(0.5)} ms  p95 ${q(0.95)} ms  min ${s[0]}  max ${s[s.length - 1]}`);
  }
  if (recovery) {
    const r = await provider.decide({ system, view: recoveryView, harness: cfg.harness, tools: TOOL_DEFS, signal: new AbortController().signal, deadlineMs: cfg.deadlineMs });
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
