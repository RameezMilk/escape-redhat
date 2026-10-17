// Gameplay v2 on the server side (fake engine — no simulation): event wording, bubbles, quiet spread events,
// multi-placement, v2 action masking and the state digest.
import { describe, expect, it } from 'vitest';
import type { CreateEngine, PlannerView, ServerMessage, TraceRow, WorldEvent } from '@escape/contracts';
import { TOOL_DEFS } from '@escape/contracts';
import { readPlannerConfig } from '../src/config.js';
import { bubblesForEvent, describeEvent, Orchestrator } from '../src/orchestrator.js';
import { stateDigest, toolsFor } from '../src/prompt.js';
import { ScriptedProvider } from '../src/providers/scripted.js';
import { Session } from '../src/session.js';
import { FakeEngine, fakeMap, fakeScenario } from './fakeEngine.js';

const ev = (type: WorldEvent['type'], data: Record<string, unknown>, extra: Partial<WorldEvent> = {}): WorldEvent => ({
  seq: 1,
  tick: 10,
  simTime: 1,
  type,
  data,
  ...extra,
});

const stations: PlannerView['alarm']['stations'] = [{ id: 'alarm_corridor', zone: 'north_corridor', stand: [14, 1] }];

function view(over: Partial<PlannerView> = {}): PlannerView {
  const actor = (id: 'alex' | 'maya' | 'daniel', o: Partial<PlannerView['actors'][number]> = {}) => ({
    id,
    name: id[0].toUpperCase() + id.slice(1),
    role: 'x',
    zone: 'rh_room' as const,
    tile: [10, 10] as [number, number],
    status: 'alerted' as const,
    alerted: true,
    checked_in: false,
    busy: null,
    knows_evidence: ['E1'],
    escort: null,
    uses_wheelchair: id === 'daniel',
    lost: false,
    ...o,
  });
  return {
    sim_time: 12,
    phase: 'evacuating',
    decisions_remaining: 50,
    actors: [actor('alex', { tile: [14, 2], zone: 'north_corridor' }), actor('maya'), actor('daniel', { tile: [15, 12] })],
    evidence: [
      { id: 'E1', kind: 'fire', zone: 'rh_room', zones: ['rh_room', 'door_a'], cells_known: 37, bbox: [6, 4, 12, 9], spreading: true, observed_by: 'maya', at: 3, known_by: ['alex', 'maya', 'daniel'] },
    ],
    alarm: { active: false, stations },
    messages: [],
    assistance: { person: 'daniel', preference: 'buddy', buddy: 'alex', requested: false, accepted: false, fulfilled: false },
    roster: { checked_in: [], verified: false, lost: [] },
    routes: [],
    recent_actions: [],
    new_since_last_decision: [],
    ...over,
  };
}

const enumOf = (tools: ReturnType<typeof toolsFor>, name: string) =>
  ((tools.find((t) => t.function.name === name)?.function.parameters as { properties: { actor_id: { enum?: string[] } } } | undefined)?.properties
    .actor_id.enum ?? null);

describe('v2 event wording and bubbles', () => {
  it('describes alarm, losses, power cuts and fires in fixed wording', () => {
    expect(describeEvent(ev('alarm_activated', { stationId: 'alarm_corridor' }, { actor: 'maya' }), fakeMap)).toBe('Alarm raised by Maya — north corridor pull station');
    expect(describeEvent(ev('actor_lost', { cause: 'fire' }, { actor: 'maya' }), fakeMap)).toBe('Maya was lost to the fire');
    expect(describeEvent(ev('door_disabled', { componentId: 'door_b' }), fakeMap)).toBe('Presenter cut power to sliding door B');
    expect(describeEvent(ev('hazard_placed', { kind: 'electrical', componentId: 'door_b' }), fakeMap)).toBe('Presenter cut power to sliding door B');
    expect(describeEvent(ev('hazard_placed', { kind: 'fire', col: 8, row: 5, summary: 'generic' }), fakeMap)).toMatch(/^Presenter started a fire at \(8,5\)/);
    expect(describeEvent(ev('episode_ended', { status: 'partial', reason: 'Maya was lost' }))).toBe('Episode ended: partial — Maya was lost');
  });

  it('alarm → 🚨 on every living actor + a message on the puller; loss → no bubble; ⚡ for dead doors', () => {
    const b = bubblesForEvent(ev('alarm_activated', { stationId: 'alarm_corridor' }, { actor: 'maya' }), { living: ['alex', 'maya'] });
    expect(b).toContainEqual(expect.objectContaining({ actor: 'alex', text: '🚨', kind: 'alert' }));
    expect(b).toContainEqual(expect.objectContaining({ actor: 'maya', text: 'Pulling the fire alarm!', kind: 'message' }));
    expect(b.some((x) => x.actor === 'daniel')).toBe(false); // lost people get nothing
    expect(bubblesForEvent(ev('actor_lost', {}, { actor: 'maya' }))).toEqual([]);
    expect(bubblesForEvent(ev('observation', { kind: 'electrical' }, { actor: 'alex', evidenceIds: ['E2'] }))[0].text).toBe('⚡ E2');
    expect(bubblesForEvent(ev('observation', { kind: 'fire' }, { actor: 'alex', evidenceIds: ['E1'] }))[0].text).toBe('🔥 E1');
  });

  it('orchestrator: no rows for fire spread/charring; one row per dead door', () => {
    const engine = new FakeEngine(fakeMap, fakeScenario, { episodeId: 'ep-x' });
    const rows: TraceRow[] = [];
    const orch = new Orchestrator({
      engine,
      provider: new ScriptedProvider({ latencyMs: [0, 0] }),
      map: fakeMap,
      scenario: fakeScenario,
      harness: 'v2',
      deadlineMs: 1000,
      getTick: () => 0,
      isPaused: () => false,
      emitRow: (r) => rows.push(r),
      recordInput: () => {},
    });
    for (let i = 0; i < 20; i++) engine.emitEvent('fire_spread', { cells: [[1, i]] });
    engine.emitEvent('cell_charred', { cells: [[1, 1]] });
    engine.emitEvent('hazard_placed', { kind: 'electrical', componentId: 'door_b', col: 18, row: 9 });
    engine.emitEvent('door_disabled', { componentId: 'door_b' });
    engine.emitEvent('alarm_activated', { stationId: 'alarm_corridor' }, { actor: 'maya' });
    engine.emitEvent('actor_lost', { cause: 'fire' }, { actor: 'daniel' });
    orch.ingestNew();
    const summaries = rows.map((r) => r.summary);
    expect(summaries.filter((s) => /spread|charred/i.test(s))).toEqual([]);
    expect(summaries.filter((s) => s === 'Presenter cut power to sliding door B')).toHaveLength(1);
    expect(summaries).toContain('Alarm raised by Maya — north corridor pull station');
    expect(summaries).toContain('Daniel was lost to the fire');
    orch.dispose();
  });
});

describe('v2 masking and digest', () => {
  it('drops lost people from every enum and offers pull_alarm only next to a station while the alarm is off', () => {
    const v = view({
      actors: view().actors.map((a) => (a.id === 'daniel' ? { ...a, lost: true, status: 'lost' as const } : a)),
    });
    const tools = toolsFor('v2', v, fakeMap);
    for (const t of tools) expect(enumOf(tools, t.function.name) ?? []).not.toContain('daniel');
    expect(enumOf(tools, 'pull_alarm')).toEqual(['alex']); // alex at (14,2) is 1 tile from the hallway stand (14,1); maya is far
    expect(enumOf(tools, 'move')).toEqual(['alex', 'maya']);
    const active = toolsFor('v2', view({ alarm: { active: true, by: 'alex', at: 5, stations } }), fakeMap);
    expect(enumOf(active, 'pull_alarm')).toBeNull();
    expect(toolsFor('v1', v, fakeMap)).toBe(TOOL_DEFS);
  });

  it('Daniel may move on his own (buddy optional); verify_roster once every survivor is checked in', () => {
    expect(enumOf(toolsFor('v2', view(), fakeMap), 'move')).toContain('daniel');
    const done = view({
      actors: view().actors.map((a) =>
        a.id === 'maya' ? { ...a, lost: true, status: 'lost' as const } : { ...a, zone: 'assembly' as const, checked_in: true, status: 'checked_in' as const },
      ),
      roster: { checked_in: ['alex', 'daniel'], verified: false, lost: ['maya'] },
    });
    expect(enumOf(toolsFor('v2', done, fakeMap), 'verify_roster')).toEqual(['alex']);
  });

  it('digest summarises fire extent, alarm status, losses and the optional buddy', () => {
    const d = stateDigest(
      view({ actors: view().actors.map((a) => (a.id === 'maya' ? { ...a, lost: true, status: 'lost' as const } : a)) }),
      fakeMap,
    );
    expect(d).toMatch(/E1 fire: ~37 known burning cells across rh_room, door_a — spreading/);
    expect(d).toMatch(/ALARM: not raised\. Next to a pull station now: alex/);
    expect(d).toMatch(/LOST \(cannot act\): maya/);
    expect(d).toMatch(/Optional: Daniel may ask Alex for help/);
    expect(d).not.toMatch(/do not check Alex in/);
    const dead = stateDigest(
      view({
        evidence: [{ id: 'E2', kind: 'electrical', zone: 'south_branch', zones: ['south_branch'], cells_known: 2, bbox: [26, 14, 27, 14], component: 'south_door', observed_by: 'alex', at: 9, known_by: ['alex'] }],
        alarm: { active: true, by: 'maya', at: 4, stations },
      }),
    );
    expect(dead).toMatch(/E2 dead sliding door: south_door \(south_branch\)/);
    expect(dead).toMatch(/ALARM: sounding \(pulled by maya at 4s\)/);
  });
});

describe('v2 session placement', () => {
  it('accepts any number of either threat, also while paused; there is no remove message', () => {
    const engines: FakeEngine[] = [];
    const sent: ServerMessage[] = [];
    const createEngine: CreateEngine = (map, scenario, opts) => {
      const e = new FakeEngine(map, scenario, opts);
      engines.push(e);
      return e;
    };
    const session = new Session({
      map: fakeMap,
      cases: new Map([[fakeScenario.caseId, fakeScenario]]),
      provider: new ScriptedProvider({ latencyMs: [0, 0] }),
      planner: readPlannerConfig({}),
      createEngine,
      broadcast: (m) => sent.push(m),
      runsDir: null,
      defaultCase: fakeScenario.caseId,
      tickIntervalMs: 0,
    });
    session.start();
    expect(session.handle({ type: 'place', kind: 'fire', col: 8, row: 5 })).toMatchObject({ type: 'placement_result', kind: 'fire', ok: true });
    expect(session.handle({ type: 'place', kind: 'fire', col: 12, row: 12 })).toMatchObject({ ok: true });
    session.pause();
    expect(session.handle({ type: 'place', kind: 'electrical', col: 18, row: 9 })).toMatchObject({ kind: 'electrical', ok: true });
    expect(engines[0].placements).toHaveLength(3);
    // createEngine received no time limit
    session.stop();
  });
});

describe('earshot: voice reaches only the same room', () => {
  const split = () =>
    view({
      actors: view().actors.map((a) =>
        a.id === 'alex'
          ? { ...a, zone: 'lobby' as const, tile: [22, 8] as [number, number], alerted: false, status: 'working' as const, knows_evidence: [] }
          : { ...a, zone: 'rh_room' as const },
      ),
      evidence: [{ ...view().evidence[0], known_by: ['maya', 'daniel'] }],
    });

  it('digest shows who can hear whom and sends the unreachable to the hallway alarm', () => {
    const d = stateDigest(split(), fakeMap);
    const earshotLine = d.split('\n').find((l) => l.startsWith('EARSHOT (who can hear whom — notify reaches only these groups):'))!;
    expect(earshotLine).toContain('rh_room: maya, daniel');
    expect(earshotLine).toContain('lobby: alex');
    expect(d).toMatch(/Not alerted yet: alex \(in lobby\) — out of earshot of everyone who knows; only the fire alarm in the north corridor reaches them/);
    const near = stateDigest(
      view({ actors: view().actors.map((a) => (a.id === 'daniel' ? { ...a, alerted: false, status: 'working' as const, knows_evidence: [] } : a)) }),
      fakeMap,
    );
    expect(near).toMatch(/Not alerted yet: daniel \(in rh_room\) — maya can tell them in person/);
  });

  it('notify is offered only to speakers with someone in earshot; recipients = people in earshot', () => {
    const tools = toolsFor('v2', split(), fakeMap);
    expect(enumOf(tools, 'notify')).toEqual(['maya', 'daniel']);
    const recipients = (tools.find((t) => t.function.name === 'notify')!.function.parameters as { properties: { recipient: { enum: string[] } } }).properties.recipient.enum;
    expect(recipients).toEqual(['all', 'maya', 'daniel']);
    // Alone in the lobby, alerted Alex has nobody to talk to: notify is not offered to him
    const alone = view({
      actors: view().actors.map((a) => (a.id === 'alex' ? { ...a, zone: 'lobby' as const, tile: [22, 8] as [number, number] } : { ...a, zone: 'rh_room' as const })),
    });
    expect(enumOf(toolsFor('v2', alone, fakeMap), 'notify')).toEqual(['maya', 'daniel']);
  });
});
