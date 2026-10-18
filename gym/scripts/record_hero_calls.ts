// Records the scripted FIXTURE policy's tool calls for one dataset case through the Gym session API, so the
// Python Resources Server test can replay the identical sequence (the engine is deterministic) and check
// that the real nemo-gym server classes reach the same verified outcome. Not model output.
//   npx tsx gym/scripts/record_hero_calls.ts [case_id]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOL_DEFS, type CreateEngine } from '@escape/contracts';
import { createEngine } from '@escape/engine';
import { loadCases, loadMapFile, REPO_ROOT } from '../../apps/server/src/data.js';
import { GymSessions, type GymStepResponse } from '../../apps/server/src/gymApi.js';
import { ScriptedProvider } from '../../apps/server/src/providers/scripted.js';

const caseId = process.argv[2] ?? 'dev-00-hero';
const gym = new GymSessions({ map: loadMapFile(), cases: loadCases(), createEngine: createEngine as CreateEngine });
const provider = new ScriptedProvider({ latencyMs: [0, 0], seed: 1 });
let step: GymStepResponse = gym.create({ sessionId: 'rec', caseId, harness: 'v2' });
const calls: { name: string; arguments: Record<string, unknown> }[] = [];
for (let i = 0; i < 80 && !step.done; i++) {
  const d = await provider.decide({ system: '', view: step.state, tools: TOOL_DEFS, signal: new AbortController().signal, deadlineMs: 1000 });
  if (d.kind !== 'tool_call') throw new Error(`fixture produced ${d.kind}`);
  const c = d.calls[0];
  calls.push({ name: c.name, arguments: c.arguments });
  step = gym.tool('rec', c.name, c.arguments);
}
const v = gym.verify('rec');
const out = join(REPO_ROOT, 'gym/resources_servers/escape_red_hat/tests', `${caseId}.calls.json`);
writeFileSync(out, JSON.stringify({ case_id: caseId, source: 'scripted fixture (not a model)', expected: { reward: v.reward, outcome: v.outcome.status }, calls }, null, 2) + '\n');
console.log(`${caseId}: ${calls.length} calls → ${v.outcome.status}, reward ${v.reward} → ${out}`);
