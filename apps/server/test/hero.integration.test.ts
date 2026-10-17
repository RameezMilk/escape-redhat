// Integration with the real engine: scripted FIXTURE policy (not a model) drives the hero scenario.
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEngine } from '@escape/engine';
import type { ServerMessage } from '@escape/contracts';
import { readPlannerConfig } from '../src/config.js';
import { loadCases, loadMapFile } from '../src/data.js';
import { runEpisodeHeadless } from '../src/headless.js';
import { ScriptedProvider } from '../src/providers/scripted.js';
import { Session } from '../src/session.js';

const flush = () => new Promise((r) => setTimeout(r, 0));
const cases = loadCases();
const map = loadMapFile();

describe('scripted fixture × real engine', () => {
  it('headless dev hero case (fire at t=1, blocker when someone enters the lobby) reaches verified success', async () => {
    const scenario = cases.get('dev-00-hero')!;
    const { result, trace, runLogLines } = await runEpisodeHeadless({
      scenario,
      provider: new ScriptedProvider({ latencyMs: [0, 0] }),
      harness: 'v2',
    });
    expect(result.outcome.status).toBe('success');
    expect(result.score.success).toBe(true);
    expect(trace.some((r) => r.status === 'failed' && r.tool === 'move')).toBe(true); // an interrupted move
    expect(trace.some((r) => r.tool === 'plan_route' && r.status === 'completed')).toBe(true); // recovery
    expect(trace.every((r) => r.kind !== 'decision' || r.origin.startsWith('SCRIPTED fixture'))).toBe(true);
    expect(runLogLines.at(-1)).toMatchObject({ type: 'footer' });
  });

  it('live session: presenter places fire then blocker, episode succeeds, replay re-simulates identically', async () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'escape-runs-'));
    const sent: ServerMessage[] = [];
    const session = new Session({
      map,
      cases,
      provider: new ScriptedProvider({ latencyMs: [0, 0] }),
      planner: { ...readPlannerConfig({}), maxDecisions: 30 },
      createEngine,
      broadcast: (m) => sent.push(m),
      runsDir,
      defaultCase: 'demo-hero',
      tickIntervalMs: 0,
    });
    session.start('demo-hero');
    const episodeId = session.episodeId;
    let blockerPlaced = false;
    for (let i = 0; i < 3000 && !session.currentEngine.outcome(); i++) {
      if (i === 10) expect(session.place('fire', 8, 5)).toMatchObject({ ok: true });
      const snap = session.snapshot();
      const alex = snap.actors.find((a) => a.id === 'alex')!;
      if (!blockerPlaced && alex.status === 'escorting' && alex.zone === 'lobby') {
        expect(session.place('blocker', 26, 15)).toMatchObject({ ok: true });
        blockerPlaced = true;
      }
      session.loop();
      await flush();
    }
    session.loop(); // emits episode_end
    expect(blockerPlaced).toBe(true);
    const end = sent.find((m) => m.type === 'episode_end' && m.episodeId === episodeId);
    expect(end && end.type === 'episode_end' && end.result.outcome.status).toBe('success');
    expect(sent.some((m) => m.type === 'bubble' && m.kind === 'message')).toBe(true);

    // Replay the saved run.
    expect(readdirSync(runsDir)).toContain(`${episodeId}.jsonl`);
    session.handle({ type: 'replay', runId: episodeId });
    const replayId = session.episodeId;
    expect(replayId).toMatch(/^replay-/);
    for (let i = 0; i < 4000; i++) {
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
