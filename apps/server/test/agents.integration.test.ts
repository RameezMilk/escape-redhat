// Per-agent mode with the scripted FIXTURE policy (not a model): each person decides from their own view, actor ids
// are pinned to the person deciding, engine instincts are off, and a live run replays identically.
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEngine } from '@escape/engine';
import type { ScenarioCase, ServerMessage } from '@escape/contracts';
import { readPlannerConfig } from '../src/config.js';
import { loadCases, loadMapFile } from '../src/data.js';
import { runEpisodeHeadless } from '../src/headless.js';
import { ScriptedProvider } from '../src/providers/scripted.js';
import { Session } from '../src/session.js';

const flush = () => new Promise((r) => setTimeout(r, 0));
const cases = loadCases();
const map = loadMapFile();

function heroCase(): ScenarioCase {
  const base = cases.get('demo-hero') ?? [...cases.values()][0];
  return {
    ...base,
    caseId: 'test-hero-agents',
    split: 'dev',
    family: 'hero',
    events: [
      { id: 'ev-fire', trigger: { type: 'at_time', simTime: 1 }, action: { type: 'place_hazard', kind: 'fire', col: 5, row: 12 } },
      { id: 'ev-power', trigger: { type: 'actor_enters_zone', actor: 'any', zone: 'lobby' }, action: { type: 'place_hazard', kind: 'electrical', col: 26, row: 14 } },
    ],
    labels: { solvable: true, primaryRouteBlocked: true },
  };
}

describe('per-agent mode (scripted fixture × real engine)', () => {
  it('headless hero: everyone decides for themselves, no instincts, verified success', async () => {
    const { result, trace, runLogLines } = await runEpisodeHeadless({
      scenario: heroCase(),
      map,
      provider: new ScriptedProvider({ latencyMs: [0, 0], mode: 'agents' }),
      harness: 'v2',
      mode: 'agents',
    });
    expect(result.outcome.status).toBe('success');
    expect(result.metrics.procedural.alarmRaised).toBe(true);
    expect(result.metrics.procedural.alarmBy).toBe('planner');
    expect(result.metrics.procedural.instinctFlees).toBe(0);
    const decisions = trace.filter((r) => r.kind === 'decision');
    expect(decisions.length).toBeGreaterThan(3);
    for (const r of decisions) {
      expect(r.origin).toMatch(/^SCRIPTED fixture → (Alex|Maya|Daniel) \(own decision\)/);
      if (r.args) expect(r.args.actor_id).toBe(r.actor);
    }
    // Several people made their own decisions.
    expect(new Set(decisions.map((r) => r.actor)).size).toBe(3);
    expect(trace.some((r) => r.origin.startsWith('Instinct'))).toBe(false);
    expect(runLogLines[0]).toMatchObject({ type: 'header', mode: 'agents', engineOptions: { instincts: false } });
  });

  it('live session in agents mode reaches success and replays identically', async () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'escape-agents-runs-'));
    const sent: ServerMessage[] = [];
    const session = new Session({
      map,
      cases,
      provider: new ScriptedProvider({ latencyMs: [0, 0], mode: 'agents' }),
      planner: readPlannerConfig({ PLANNER_MODE: 'agents' }),
      createEngine,
      broadcast: (m) => sent.push(m),
      runsDir,
      defaultCase: 'demo-hero',
      tickIntervalMs: 0,
    });
    session.start('demo-hero');
    const episodeId = session.episodeId;
    let powerCut = false;
    for (let i = 0; i < 6000 && !session.currentEngine.outcome(); i++) {
      if (i === 10) expect(session.place('fire', 5, 12)).toMatchObject({ ok: true });
      const snap = session.snapshot();
      if (!powerCut && snap.actors.some((a) => a.zone === 'lobby' && a.task?.kind === 'move' && a.task.destination === 'assembly')) {
        expect(session.place('electrical', 26, 14)).toMatchObject({ ok: true });
        powerCut = true;
      }
      session.loop();
      await flush();
    }
    session.loop();
    const end = sent.find((m) => m.type === 'episode_end' && m.episodeId === episodeId);
    expect(end && end.type === 'episode_end' && end.result.outcome.status).toBe('success');
    expect(sent.some((m) => m.type === 'trace' && m.row.kind === 'decision' && /\(own decision\)/.test(m.row.origin))).toBe(true);

    expect(readdirSync(runsDir)).toContain(`${episodeId}.jsonl`);
    session.handle({ type: 'replay', runId: episodeId });
    const replayId = session.episodeId;
    for (let i = 0; i < 8000; i++) {
      session.loop();
      if (sent.some((m) => m.type === 'episode_end' && m.episodeId === replayId)) break;
    }
    const verify = sent.find((m) => m.type === 'trace' && m.row.id === `${replayId}:verify`);
    expect(verify && verify.type === 'trace' && verify.row.summary).toMatch(/REPLAY verified/);
    session.stop();
  });
});
