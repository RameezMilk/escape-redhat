// Integration with the real engine: scripted FIXTURE policy (not a model) drives the hero scenario.
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

/** The hero scenario built in-test (independent of dataset regeneration): fire just inside door A at t=1, and the
 *  south-branch sliding door loses power when anyone enters the lobby. */
function heroCase(): ScenarioCase {
  const base = cases.get('demo-hero') ?? [...cases.values()][0];
  return {
    ...base,
    caseId: 'test-hero-v2',
    split: 'dev',
    family: 'hero',
    events: [
      { id: 'ev-fire', trigger: { type: 'at_time', simTime: 1 }, action: { type: 'place_hazard', kind: 'fire', col: 8, row: 5 } },
      { id: 'ev-power', trigger: { type: 'actor_enters_zone', actor: 'any', zone: 'lobby' }, action: { type: 'place_hazard', kind: 'electrical', col: 26, row: 14 } },
    ],
    labels: { solvable: true, primaryRouteBlocked: true },
  };
}

describe('scripted fixture × real engine', () => {
  it('headless hero (fire, then a dead south door) reaches verified success with an alarm/report, an interruption and a replan', async () => {
    const { result, trace, runLogLines } = await runEpisodeHeadless({
      scenario: heroCase(),
      map,
      provider: new ScriptedProvider({ latencyMs: [0, 0] }),
      harness: 'v2',
    });
    expect(result.outcome.status).toBe('success');
    expect(result.score.success).toBe(true);
    expect(trace.some((r) => r.kind === 'decision' && (r.tool === 'pull_alarm' || r.tool === 'notify') && r.status === 'completed')).toBe(true);
    expect(trace.some((r) => r.status === 'failed' && r.tool === 'move')).toBe(true); // an interrupted move
    expect(trace.some((r) => (r.tool === 'plan_route' && r.status === 'completed') || (r.tool === 'move' && !!r.args?.route_id))).toBe(true); // recovery
    expect(trace.every((r) => r.kind !== 'decision' || r.origin.startsWith('SCRIPTED fixture'))).toBe(true);
    expect(trace.some((r) => /spread|charred/i.test(r.summary) && r.kind === 'engine')).toBe(false);
    expect(runLogLines[0]).toMatchObject({ type: 'header', engineOptions: { stallCeilingSimSec: 900 } });
    expect(runLogLines.at(-1)).toMatchObject({ type: 'footer' });
  });

  it('live session: presenter starts a fire then cuts power to the south door; success; replay re-simulates identically', async () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'escape-runs-'));
    const sent: ServerMessage[] = [];
    const session = new Session({
      map,
      cases,
      provider: new ScriptedProvider({ latencyMs: [0, 0] }),
      planner: readPlannerConfig({}),
      createEngine,
      broadcast: (m) => sent.push(m),
      runsDir,
      defaultCase: 'demo-hero',
      tickIntervalMs: 0,
    });
    session.start('demo-hero');
    const episodeId = session.episodeId;
    let powerCut = false;
    for (let i = 0; i < 5000 && !session.currentEngine.outcome(); i++) {
      if (i === 10) expect(session.place('fire', 8, 5)).toMatchObject({ ok: true });
      const snap = session.snapshot();
      if (!powerCut && snap.actors.some((a) => a.zone === 'lobby' && a.task?.kind === 'move' && a.task.destination === 'assembly')) {
        expect(session.place('electrical', 26, 14)).toMatchObject({ ok: true });
        powerCut = true;
      }
      session.loop();
      await flush();
    }
    session.loop(); // emits episode_end
    expect(powerCut).toBe(true);
    const end = sent.find((m) => m.type === 'episode_end' && m.episodeId === episodeId);
    expect(end && end.type === 'episode_end' && end.result.outcome.status).toBe('success');
    expect(sent.some((m) => m.type === 'bubble' && m.kind === 'message')).toBe(true);
    expect(sent.some((m) => m.type === 'trace' && m.row.summary.startsWith('Presenter cut power to'))).toBe(true);

    // Replay the saved run.
    expect(readdirSync(runsDir)).toContain(`${episodeId}.jsonl`);
    session.handle({ type: 'replay', runId: episodeId });
    const replayId = session.episodeId;
    expect(replayId).toMatch(/^replay-/);
    for (let i = 0; i < 6000; i++) {
      session.loop();
      if (sent.some((m) => m.type === 'episode_end' && m.episodeId === replayId)) break;
    }
    const verify = sent.find((m) => m.type === 'trace' && m.row.id === `${replayId}:verify`);
    expect(verify && verify.type === 'trace' && verify.row.summary).toMatch(/REPLAY verified/);
    const snap = sent.filter((m) => m.type === 'snapshot' && m.episodeId === replayId).at(-1);
    expect(snap && snap.type === 'snapshot' && snap.snapshot.mode).toBe('replay');
    session.stop();
  });
});
