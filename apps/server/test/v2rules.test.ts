// Gameplay v2 on the server side (fake engine — no simulation): event wording, bubbles, quiet spread events,
// multi-placement, v2 action masking and the state digest.
import { describe, expect, it } from 'vitest';
import type { CreateEngine, PlannerView, ServerMessage, TraceRow, WorldEvent } from '@escape/contracts';
import { TOOL_DEFS } from '@escape/contracts';
import { loadMap } from '@escape/engine';
import { readPlannerConfig } from '../src/config.js';
import { bubblesForEvent, describeEvent, Orchestrator } from '../src/orchestrator.js';
import { stateDigest, toolsFor } from '../src/prompt.js';
import { EvidenceBook } from '../src/places.js';
import { ScriptedProvider } from '../src/providers/scripted.js';
import { Session } from '../src/session.js';
import { FakeEngine, fakeMap, fakeScenario } from './fakeEngine.js';
import { idLeakRegex } from './idLeak.js';

const ev = (type: WorldEvent['type'], data: Record<string, unknown>, extra: Partial<WorldEvent> = {}): WorldEvent => ({
  seq: 1,
  tick: 10,
  simTime: 1,
  type,
  data,
  ...extra,
});

const stations: PlannerView['alarm']['stations'] = [
  { id: 'alarm_hallway', zone: 'hallway', stand: [4, 9] },
  { id: 'alarm_reception', zone: 'reception', stand: [29, 18] },
];

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
    actors: [actor('alex', { tile: [4, 10], zone: 'hallway' }), actor('maya', { tile: [16, 5] }), actor('daniel', { tile: [18, 5] })],
    evidence: [
      { id: 'E1', kind: 'fire', zone: 'rh_room', zones: ['rh_room', 'rh_door'], cells_known: 37, bbox: [14, 2, 17, 6], spreading: true, observed_by: 'maya', at: 3, known_by: ['alex', 'maya', 'daniel'] },
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

/** Nothing a viewer sees may contain evidence ids, raw zone/door ids, action ids or tile coordinates. */
const ID_LEAK = idLeakRegex(loadMap());

describe('story beats: wording and bubbles (no ids)', () => {
  it('describes each story beat in plain English with names and places', () => {
    expect(describeEvent(ev('hazard_placed', { kind: 'fire', col: 16, row: 5 }), fakeMap)).toBe('🔥 Fire started in the Red Hat room');
    expect(describeEvent(ev('door_disabled', { component: 'reception_door' }), fakeMap)).toBe('⚡ Power cut — the reception door is stuck shut');
    expect(describeEvent(ev('hazard_placed', { kind: 'electrical', componentId: 'side_door' }), fakeMap)).toBe('⚡ Power cut — the reception side door is stuck shut');
    expect(describeEvent(ev('observation', { kind: 'fire', zone: 'rh_room', via: 'sight' }, { actor: 'daniel', evidenceIds: ['E1'] }))).toBe('🔥 Daniel spots fire in the Red Hat room');
    expect(describeEvent(ev('observation', { kind: 'fire', zone: 'rh_room', via: 'smoke' }, { actor: 'alex', evidenceIds: ['E1'] }))).toBe('🔥 Alex smells smoke — fire in the Red Hat room');
    expect(describeEvent(ev('observation', { kind: 'electrical', zone: 'reception_door', component: 'reception_door' }, { actor: 'maya', evidenceIds: ['E2'] }))).toBe('⚡ Maya finds the reception door dead');
    expect(describeEvent(ev('instinct', { kind: 'shout', heard_by: ['maya'] }, { actor: 'daniel' }))).toBe('📣 Daniel shouts “Fire!” — Maya hears');
    expect(describeEvent(ev('instinct', { kind: 'shout', heard_by: [] }, { actor: 'daniel' }))).toBe('📣 Daniel shouts “Fire!”');
    expect(describeEvent(ev('instinct', { kind: 'flee' }, { actor: 'maya' }))).toBe('🏃 Maya backs away from the fire');
    expect(describeEvent(ev('alarm_activated', { station: 'alarm_hallway', via: 'instinct' }, { actor: 'maya' }))).toBe('🚨 Maya pulls the hallway alarm on the way out — everyone hears the siren');
    expect(describeEvent(ev('alarm_activated', { station: 'alarm_reception', via: 'tool' }, { actor: 'rosa' }))).toBe('🚨 Rosa pulls the reception alarm — everyone hears the siren');
    expect(describeEvent(ev('actor_lost', { cause: 'fire', zone: 'rh_room', tile: [8, 6] }, { actor: 'maya' }))).toBe('✖ Maya was lost to the fire');
    expect(describeEvent(ev('episode_ended', { status: 'success', reason: 'x' }))).toBe('🏁 Everyone made it out');
    expect(describeEvent(ev('episode_ended', { status: 'partial', reason: 'x' }), fakeMap, { escaped: 2 })).toBe('🏁 Partial — 2 of 5 escaped');
    expect(describeEvent(ev('episode_ended', { status: 'failed', reason: 'x' }))).toBe('🏁 Nobody made it out');
    // Not story beats: covered by decision rows or noise
    for (const t of ['message_delivered', 'checked_in', 'roster_verified', 'assistance_requested', 'escort_started', 'assistance_fulfilled', 'move_interrupted', 'fire_spread'] as const) {
      expect(describeEvent(ev(t, {}, { actor: 'maya' }), fakeMap)).toBeNull();
    }
  });

  it('bubbles: 🔥 Fire! / ⚡ dead door / shout / alarm — never an id', () => {
    const b = bubblesForEvent(ev('alarm_activated', { stationId: 'alarm_hallway' }, { actor: 'maya' }), { living: ['alex', 'maya'] });
    expect(b).toContainEqual(expect.objectContaining({ actor: 'alex', text: '🚨', kind: 'alert' }));
    expect(b).toContainEqual(expect.objectContaining({ actor: 'maya', text: 'Pulling the fire alarm!', kind: 'message' }));
    expect(b.some((x) => x.actor === 'daniel')).toBe(false); // lost people get nothing
    expect(bubblesForEvent(ev('actor_lost', {}, { actor: 'maya' }))).toEqual([]);
    expect(bubblesForEvent(ev('observation', { kind: 'electrical' }, { actor: 'alex', evidenceIds: ['E2'] }))[0].text).toBe("⚡ This door's dead!");
    expect(bubblesForEvent(ev('observation', { kind: 'fire' }, { actor: 'alex', evidenceIds: ['E1'] }))[0].text).toBe('🔥 Fire!');
    expect(bubblesForEvent(ev('observation', { kind: 'fire', via: 'smoke' }, { actor: 'alex', evidenceIds: ['E1'] }))[0].text).toBe('🔥 I smell smoke!');
    const shout = bubblesForEvent(ev('instinct', { kind: 'shout', heard_by: ['maya'] }, { actor: 'daniel' }), { living: ['maya', 'daniel', 'alex'] });
    expect(shout).toEqual([
      expect.objectContaining({ actor: 'daniel', text: 'Fire! Get out!', kind: 'message' }),
      expect.objectContaining({ actor: 'maya', text: '!', kind: 'alert' }),
    ]);
    expect(bubblesForEvent(ev('instinct', { kind: 'flee' }, { actor: 'maya' }))).toEqual([]);
    // A model message that still cites an evidence id is shown in words.
    const book = new EvidenceBook();
    book.learn(ev('observation', { kind: 'electrical', zone: 'reception_door', component: 'reception_door' }, { actor: 'maya', evidenceIds: ['E2'] }));
    const msg = bubblesForEvent(ev('message_delivered', { message: 'Door E2 is dead, use side_door!', recipients: ['daniel'] }, { actor: 'maya' }), { book })[0];
    expect(msg.text).toBe('the dead reception door is dead, use reception side door!');
    for (const x of [...b, ...shout, msg]) expect(x.text).not.toMatch(ID_LEAK);
  });

  it('orchestrator keeps only story beats: no duplicates, no echoes, first sighting only, flee rate-limited', () => {
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
    engine.emitEvent('hazard_placed', { kind: 'fire', col: 16, row: 5 });
    for (let i = 0; i < 20; i++) engine.emitEvent('fire_spread', { evidence: 'E1', zone: 'rh_door' }, { evidenceIds: ['E1'] });
    engine.emitEvent('observation', { kind: 'fire', zone: 'rh_room', via: 'sight', firstReport: true }, { actor: 'daniel', evidenceIds: ['E1'] });
    engine.emitEvent('instinct', { kind: 'shout', heard_by: ['maya'] }, { actor: 'daniel' });
    engine.emitEvent('observation', { kind: 'fire', zone: 'rh_room', via: 'sight', firstReport: false }, { actor: 'maya', evidenceIds: ['E1'] });
    engine.emitEvent('instinct', { kind: 'flee' }, { actor: 'maya', simTime: 2 });
    engine.emitEvent('instinct', { kind: 'flee' }, { actor: 'maya', simTime: 5 }); // within 10 s → no second line
    engine.emitEvent('instinct', { kind: 'flee' }, { actor: 'maya', simTime: 14 });
    engine.emitEvent('message_delivered', { message: 'Fire!', recipients: ['daniel'] }, { actor: 'maya' });
    engine.emitEvent('door_disabled', { component: 'reception_door', col: 31, row: 12 });
    engine.emitEvent('hazard_placed', { kind: 'electrical', component: 'reception_door', col: 31, row: 12 });
    engine.emitEvent('observation', { kind: 'electrical', zone: 'reception_door', component: 'reception_door', firstReport: true }, { actor: 'maya', evidenceIds: ['E2'] });
    engine.emitEvent('observation', { kind: 'electrical', zone: 'reception_door', component: 'reception_door', firstReport: false }, { actor: 'daniel', evidenceIds: ['E2'] });
    engine.emitEvent('move_interrupted', { code: 'ROUTE_UNAVAILABLE', hazard_kind: 'electrical', component: 'reception_door' }, { actor: 'maya', evidenceIds: ['E2'] });
    engine.emitEvent('alarm_activated', { station: 'alarm_hallway', via: 'tool' }, { actor: 'alex', actionId: 'A-007' }); // decision row covers it
    engine.emitEvent('alarm_activated', { station: 'alarm_hallway', via: 'instinct' }, { actor: 'maya' });
    engine.emitEvent('instinct', { kind: 'alarm' }, { actor: 'maya' }); // same moment, already a line
    engine.emitEvent('checked_in', {}, { actor: 'maya' });
    engine.emitEvent('roster_verified', { complete: false }, { actor: 'alex' });
    engine.emitEvent('assistance_requested', { helper: 'alex' }, { actor: 'daniel' });
    engine.emitEvent('actor_lost', { cause: 'fire', zone: 'rh_room', tile: [9, 6] }, { actor: 'daniel' });
    engine.emitEvent('episode_ended', { status: 'partial', reason: 'Daniel was lost' });
    orch.ingestNew();
    expect(rows.map((r) => r.summary)).toEqual([
      '🔥 Fire started in the Red Hat room',
      '🔥 Daniel spots fire in the Red Hat room',
      '📣 Daniel shouts “Fire!” — Maya hears',
      '🏃 Maya backs away from the fire',
      '🏃 Maya backs away from the fire',
      '⚡ Power cut — the reception door is stuck shut',
      '⚡ Maya finds the reception door dead',
      '🚨 Maya pulls the hallway alarm on the way out — everyone hears the siren',
      '✖ Daniel was lost to the fire',
      '🏁 Partial — 0 of 5 escaped',
    ]);
    for (const r of rows) expect(r.summary).not.toMatch(ID_LEAK);
    expect(rows.filter((r) => r.origin.startsWith('Instinct')).length).toBe(4); // shout, 2 flee lines, instinct alarm
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
    expect(enumOf(tools, 'pull_alarm')).toEqual(['alex']); // alex at (4,10) is 1 tile from the hallway stand (4,9); maya is far
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
    expect(d).toMatch(/E1 fire in the Red Hat room \(zones: rh_room, rh_door\): ~37 known burning cells — spreading/);
    expect(d).toMatch(/ALARM: not raised \(anyone who passes a pull station pulls it automatically\)\. Next to a pull station now: alex/);
    expect(d).toMatch(/LOST \(cannot act\): maya/);
    expect(d).toMatch(/Optional: Daniel may ask Alex for help/);
    expect(d).not.toMatch(/do not check Alex in/);
    const dead = stateDigest(
      view({
        evidence: [{ id: 'E2', kind: 'electrical', zone: 'reception_door', zones: ['reception_door'], cells_known: 2, bbox: [31, 12, 32, 12], component: 'reception_door', observed_by: 'alex', at: 9, known_by: ['alex'] }],
        alarm: { active: true, by: 'maya', at: 4, stations },
      }),
    );
    expect(dead).toMatch(/E2 dead sliding door: reception_door in the reception door \(reception_door\)/);
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
          ? { ...a, zone: 'cubicles' as const, tile: [20, 15] as [number, number], alerted: false, status: 'working' as const, knows_evidence: [] }
          : { ...a, zone: 'rh_room' as const },
      ),
      evidence: [{ ...view().evidence[0], known_by: ['maya', 'daniel'] }],
    });

  it('digest shows who can hear whom and sends the unreachable to a fire alarm', () => {
    const d = stateDigest(split(), fakeMap);
    const earshotLine = d.split('\n').find((l) => l.startsWith('EARSHOT (who can hear whom — notify reaches only these groups):'))!;
    expect(earshotLine).toContain('rh_room: maya, daniel');
    expect(earshotLine).toContain('cubicles: alex');
    expect(d).toMatch(
      /Not alerted yet: alex \(in cubicles\) — out of earshot of everyone who knows; only a fire alarm reaches them \(move someone to "alarm"\)\. Can reach the alarm without going back inside: maya \(≈\d+ tiles\), daniel \(≈\d+ tiles\)/,
    );
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
    // Alone in the cubicles, alerted Alex has nobody to talk to: notify is not offered to him
    const alone = view({
      actors: view().actors.map((a) => (a.id === 'alex' ? { ...a, zone: 'cubicles' as const, tile: [20, 15] as [number, number] } : { ...a, zone: 'rh_room' as const })),
    });
    expect(enumOf(toolsFor('v2', alone, fakeMap), 'notify')).toEqual(['maya', 'daniel']);
  });
});

describe('realism in the digest and masking: outside, instincts, no re-entry', () => {
  it('lists people outside, never offers them as alarm runners, and flags instinct movers as ready for orders', () => {
    const v = view({
      actors: view().actors.map((a) =>
        a.id === 'alex'
          ? { ...a, zone: 'cubicles' as const, tile: [20, 15] as [number, number], alerted: false, status: 'working' as const, knows_evidence: [] }
          : a.id === 'maya'
            ? { ...a, zone: 'sidewalk' as const, tile: [10, 20] as [number, number] }
            : { ...a, busy: 'backing away from the fire (instinct)', status: 'moving' as const },
      ),
      evidence: [{ ...view().evidence[0], known_by: ['maya', 'daniel'] }],
    });
    const d = stateDigest(v, fakeMap);
    expect(d).toMatch(/OUTSIDE \(can't go back in\): maya/);
    expect(d).toMatch(/Can reach the alarm without going back inside: daniel/);
    expect(d).not.toMatch(/Can reach the alarm without going back inside: [^.]*maya/);
    expect(d).toMatch(/daniel is backing away from the fire by instinct — give daniel a destination/);
    expect(d).not.toMatch(/BUSY MOVING[^\n]*daniel/);
    // The instinct mover can be given orders.
    expect(enumOf(toolsFor('v2', v, fakeMap), 'move')).toContain('daniel');
  });

  it('the v2 procedure covers instincts, the fire alarms, no re-entry and plain-language messages', () => {
    const system = new Orchestrator({
      engine: new FakeEngine(fakeMap, fakeScenario, { episodeId: 'ep-p' }),
      provider: new ScriptedProvider({ latencyMs: [0, 0] }),
      map: fakeMap,
      scenario: fakeScenario,
      harness: 'v2',
      deadlineMs: 1000,
      getTick: () => 0,
      isPaused: () => false,
      emitRow: () => {},
      recordInput: () => {},
    }).systemPrompt();
    expect(system).toMatch(/shout "Fire!" to their own room automatically/);
    expect(system).toMatch(/Never send anyone back inside/);
    expect(system).toMatch(/move them to destination "alarm"/);
    expect(system).toMatch(/Never put evidence ids, zone codes or coordinates in message text/);
    expect(system).toMatch(/Fire spreads every second and can burn through walls/);
  });
});
