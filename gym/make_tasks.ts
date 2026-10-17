// Turns the published scenario dataset (data/scenarios/cases.{dev,test}.jsonl) into NeMo Gym task rows
// for gym/resources_servers/escape_red_hat. Prompts are produced by the SAME code the app uses
// (apps/server/src/prompt.ts buildSystemPrompt + userContent), and the initial state is the engine's
// deterministic state at the first decision point — the Resources Server reaches the identical state
// when it seeds the session, because the engine is seeded and has no wall-clock dependence.
//
//   npx tsx gym/make_tasks.ts            (from the repo root)
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOL_DEFS, type CreateEngine } from '@escape/contracts';
import { createEngine } from '@escape/engine';
import { loadCases, loadMapFile, REPO_ROOT } from '../apps/server/src/data.js';
import { GymSessions } from '../apps/server/src/gymApi.js';

const OUT = join(REPO_ROOT, 'gym', 'resources_servers', 'escape_red_hat', 'data');
mkdirSync(OUT, { recursive: true });

const map = loadMapFile('office-v1');
const cases = loadCases();
const gym = new GymSessions({ map, cases, createEngine: createEngine as CreateEngine });

// Responses API function tools (Gym's simple_agent / vllm_model format). Not strict: some args are optional.
const tools = TOOL_DEFS.map((t) => ({
  type: 'function' as const,
  name: t.function.name,
  description: t.function.description,
  parameters: t.function.parameters,
  strict: false,
}));

const MULTI_TURN_NOTE =
  'Each tool result is JSON with "result" (your call\'s outcome or error with a hint), "done", "outcome" and a compact "state" (including "changes" since your last call). Keep calling tools until "done" is true.';

const files: Record<string, number> = {};
for (const split of ['dev', 'test'] as const) {
  for (const harness of ['v1', 'v2'] as const) {
    const rows: string[] = [];
    for (const c of cases.values()) {
      if (c.split !== split) continue;
      const seeded = gym.create({ sessionId: `gen-${c.caseId}-${harness}`, caseId: c.caseId, harness });
      gym.delete(`gen-${c.caseId}-${harness}`);
      rows.push(
        JSON.stringify({
          responses_create_params: {
            input: [
              { role: 'system', content: `${seeded.system_prompt}\n\n${MULTI_TURN_NOTE}` },
              { role: 'user', content: seeded.user_prompt },
            ],
            tools,
          },
          case_id: c.caseId,
          harness,
          split,
          family: c.family,
          solvable: c.labels.solvable,
        }),
      );
    }
    const name = `${split}_${harness}.jsonl`;
    writeFileSync(join(OUT, name), rows.join('\n') + '\n');
    files[name] = rows.length;
  }
}
// A 3-row example (Gym convention) from the dev split, v2 harness.
const example = readFileSync(join(OUT, 'dev_v2.jsonl'), 'utf8').split('\n').filter(Boolean).slice(0, 3);
writeFileSync(join(OUT, 'example.jsonl'), example.join('\n') + '\n');
files['example.jsonl'] = example.length;

const manifest = {
  generated_by: 'gym/make_tasks.ts',
  source: 'data/scenarios/cases.{dev,test}.jsonl (escape-office-scenarios-v1)',
  map_hash: map.hash,
  files: Object.fromEntries(
    Object.keys(files).map((f) => [
      f,
      { rows: files[f], sha256: createHash('sha256').update(readFileSync(join(OUT, f))).digest('hex') },
    ]),
  ),
};
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('wrote', Object.entries(files).map(([f, n]) => `${f} (${n})`).join(', '));
