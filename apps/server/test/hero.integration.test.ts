// Integration with the real engine: scripted FIXTURE policy (not a model) drives the hero scenario.
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEngine, loadMap } from '@escape/engine';
import type { ScenarioCase, ServerMessage, TraceRow } from '@escape/contracts';
import { readPlannerConfig } from '../src/config.js';
import { loadCases, loadMapFile } from '../src/data.js';
import { runEpisodeHeadless } from '../src/headless.js';
import { ScriptedProvider } from '../src/providers/scripted.js';
import { Session } from '../src/session.js';
import { idLeakRegex } from './idLeak.js';
import { heroStoryCase } from '../../../data/scenarios/heroStory.js';

const flush = () => new Promise((r) => setTimeout(r, 0));
/** Viewer-facing text must never contain evidence ids, raw zone/door ids, action ids or coordinates. */
const ID_LEAK = idLeakRegex(loadMap());
/** Sim time of the first alarm in a trace: a completed pull_alarm decision or an instinct alarm story line. */
const alarmAt = (rows: TraceRow[]) =>
  rows.find((r) => (r.kind === 'decision' && r.tool === 'pull_alarm' && r.status === 'completed') || (r.kind === 'engine' && r.summary.startsWith('🚨')))?.simTime;
const cases = loadCases();
const map = loadMapFile();

/** The hero scenario built in-test (independent of dataset regeneration): fire just inside door A at t=1, and the
 *  south-branch sliding door loses power when anyone enters the lobby. */
/** The scripted hero story (data/scenarios/hero-story.json): fire in the cubicles at t=1, and the reception door loses
 *  power when anyone enters the main hallway. */
function heroCase(): ScenarioCase {
  return { ...heroStoryCase(), caseId: 'test-hero-v2' };
}

describe('scripted fixture × real engine', () => {
  it('headless hero (fire, then a dead reception door) reaches verified success with an alarm/report, an interruption and a replan', async () => {
    const { result, trace, runLogLines } = await runEpisodeHeadless({
      scenario: heroCase(),
      map,
      provider: new ScriptedProvider({ latencyMs: [0, 0] }),
      harness: 'v2',
    });
    expect(result.outcome.status).toBe('success');
    expect(result.score.success).toBe(true);
    // Voice only reaches the same room: the people in the other rooms hear a fire alarm (pulled by a decision or by
    // someone's instinct on their way past) before they are ever moved.
    expect(result.metrics.procedural.alarmRaised).toBe(true);
    const alarm = alarmAt(trace);
    expect(alarm).toBeDefined();
    // Kenji (alone in the server room) is warned only by the alarm or IN PERSON by someone in earshot — never across rooms.
    const kenjiFirstMove = trace.find((r) => r.kind === 'decision' && r.actor === 'kenji' && r.tool === 'move' && r.status !== 'rejected');
    const toldInPerson = trace.find(
      (r) => r.kind === 'decision' && r.tool === 'notify' && r.result?.ok && ((r.result.data.delivered_to as string[] | undefined) ?? []).includes('kenji'),
    );
    if (kenjiFirstMove) expect(kenjiFirstMove.simTime).toBeGreaterThanOrEqual(Math.min(alarm!, toldInPerson?.simTime ?? Infinity));
    // Story beats only: no echo rows, no ids on screen.
    const engineRows = trace.filter((r) => r.kind === 'engine');
    expect(engineRows.some((r) => /checked in at the assembly|Roster verified|→ all:|requested assistance|stopped: route/i.test(r.summary))).toBe(false);
    for (const r of engineRows) expect(r.summary).not.toMatch(ID_LEAK);
    expect(trace.some((r) => r.status === 'failed' && r.tool === 'move')).toBe(true); // an interrupted move
    expect(trace.some((r) => (r.tool === 'plan_route' && r.status === 'completed') || (r.tool === 'move' && !!r.args?.route_id))).toBe(true); // recovery
    expect(trace.every((r) => r.kind !== 'decision' || r.origin.startsWith('SCRIPTED fixture'))).toBe(true);
    expect(trace.some((r) => /spread|charred/i.test(r.summary) && r.kind === 'engine')).toBe(false);
    expect(runLogLines[0]).toMatchObject({ type: 'header', engineOptions: { stallCeilingSimSec: 900 } });
    expect(runLogLines.at(-1)).toMatchObject({ type: 'footer' });
  });

  it('live session: presenter starts a fire then cuts power to the reception door; success; replay re-simulates identically', async () => {
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
      if (i === 10) expect(session.place('fire', 15, 5)).toMatchObject({ ok: true });
      const snap = session.snapshot();
      if (!powerCut && snap.actors.some((a) => a.zone === 'hallway' && a.task?.kind === 'move' && a.task.destination === 'assembly')) {
        expect(session.place('electrical', 31, 12)).toMatchObject({ ok: true });
        powerCut = true;
      }
      session.loop();
      await flush();
    }
    session.loop(); // emits episode_end
    expect(powerCut).toBe(true);
    const end = sent.find((m) => m.type === 'episode_end' && m.episodeId === episodeId);
    expect(end && end.type === 'episode_end' && end.result.outcome.status).toBe('success');
    expect(end && end.type === 'episode_end' && end.result.metrics.procedural.alarmRaised).toBe(true);
    expect(sent.some((m) => m.type === 'bubble' && m.kind === 'message')).toBe(true);
    expect(sent.some((m) => m.type === 'trace' && m.row.summary === '⚡ Power cut — the reception door is stuck shut')).toBe(true);
    expect(sent.some((m) => m.type === 'trace' && m.row.summary === '🔥 Fire started in the Red Hat room')).toBe(true);
    for (const m of sent) {
      if (m.type === 'bubble') expect(m.text).not.toMatch(ID_LEAK);
      if (m.type === 'trace' && m.row.kind === 'engine') expect(m.row.summary).not.toMatch(ID_LEAK);
    }

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
