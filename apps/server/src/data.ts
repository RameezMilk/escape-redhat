// Loads the published dataset files the server boots from: map + scenario cases.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MAP_ID, type CaseSummary, type MapData, type ScenarioCase } from '@escape/contracts';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const RUNS_DIR = join(REPO_ROOT, 'runs');
export const WEB_DIST = join(REPO_ROOT, 'apps', 'web', 'dist');

export function loadMapFile(mapId: string = DEFAULT_MAP_ID): MapData {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'data', 'maps', `${mapId}.json`), 'utf8')) as MapData;
}

/** demo-hero.json first, then every cases.*.jsonl in data/scenarios (dataset splits). */
export function loadCases(): Map<string, ScenarioCase> {
  const dir = join(REPO_ROOT, 'data', 'scenarios');
  const out = new Map<string, ScenarioCase>();
  const hero = join(dir, 'demo-hero.json');
  if (existsSync(hero)) {
    const c = JSON.parse(readFileSync(hero, 'utf8')) as ScenarioCase;
    out.set(c.caseId, c);
  }
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).sort()) {
      if (!/^cases\..+\.jsonl$/.test(f)) continue;
      for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const c = JSON.parse(line) as ScenarioCase;
          if (c.caseId && !out.has(c.caseId)) out.set(c.caseId, c);
        } catch {
          // skip malformed line
        }
      }
    }
  }
  return out;
}

export function caseSummaries(cases: Map<string, ScenarioCase>): CaseSummary[] {
  return [...cases.values()].map((c) => ({ caseId: c.caseId, split: c.split, family: c.family, notes: c.labels?.notes }));
}
