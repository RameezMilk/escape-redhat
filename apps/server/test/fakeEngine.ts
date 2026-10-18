import { ACTOR_IDS, ACTOR_PROFILES } from '@escape/contracts';
import { loadMap } from '@escape/engine';
// Minimal Engine stand-in for orchestrator/session tests (no simulation; records calls).
import type {
  DecisionMeta,
  DecisionNote,
  Engine,
  EngineOptions,
  EpisodeOutcome,
  EpisodeResult,
  HazardKind,
  MapData,
  NormalizedToolCall,
  PlacementResult,
  PlannerView,
  ScenarioCase,
  Snapshot,
  ToolResult,
  WorldEvent,
} from '@escape/contracts';

export class FakeEngine implements Engine {
  readonly episodeId: string;
  needs = true;
  tick = 0;
  decisions = 0;
  executed: NormalizedToolCall[] = [];
  notes: DecisionNote[] = [];
  events: WorldEvent[] = [];
  private _outcome: EpisodeOutcome | null = null;
  private seq = 0;

  constructor(
    readonly map: MapData,
    readonly scenario: ScenarioCase,
    opts: EngineOptions,
  ) {
    this.episodeId = opts.episodeId;
    this.push('episode_started', {});
  }

  private push(type: WorldEvent['type'], data: Record<string, unknown>, extra: Partial<WorldEvent> = {}): WorldEvent {
    const e: WorldEvent = { seq: ++this.seq, tick: this.tick, simTime: this.tick / 10, type, data, ...extra };
    this.events.push(e);
    return e;
  }

  step(): WorldEvent[] {
    this.tick++;
    return [];
  }
  placements: { kind: HazardKind; col: number; row: number }[] = [];
  placeHazard(kind: HazardKind, col: number, row: number): PlacementResult {
    this.placements.push({ kind, col, row });
    const hazardId = `H${this.placements.length}`;
    return { ok: true, hazardId, event: this.push('hazard_placed', { hazardId, kind, col, row }) };
  }
  /** Test helper: emit an arbitrary engine event (e.g. alarm_activated, actor_lost). */
  emitEvent(type: WorldEvent['type'], data: Record<string, unknown>, extra: Partial<WorldEvent> = {}): WorldEvent {
    return this.push(type, data, extra);
  }
  beginDecision(): string {
    this.decisions++;
    return `D-${String(this.decisions).padStart(3, '0')}`;
  }
  executeTool(call: NormalizedToolCall, meta: DecisionMeta): ToolResult {
    this.executed.push(call);
    this.push('tool_executed', { tool: call.name }, { decisionId: meta.decisionId });
    return { ok: true, actionId: `A-${meta.decisionId}`, status: 'completed', data: { summary: `${call.name} done` } };
  }
  noteDecision(note: DecisionNote): void {
    this.notes.push(note);
    this.push('decision_note', { kind: note.kind });
  }
  needsDecision() {
    return { needed: this.needs && !this._outcome, reason: 'test' };
  }
  plannerView(): PlannerView {
    return {
      sim_time: this.tick / 10,
      phase: 'incident',
      decisions_remaining: 60 - this.decisions,
      actors: [],
      evidence: [],
      alarm: { active: false, stations: [] },
      messages: [],
      assistance: { person: 'daniel', preference: 'buddy', buddy: 'alex', requested: false, accepted: false, fulfilled: false },
      roster: { checked_in: [], verified: false, lost: [] },
      routes: [],
      recent_actions: [],
      new_since_last_decision: [],
    };
  }
  markViewed(): void {}
  agentView(): never {
    throw new Error('FakeEngine: per-agent mode not supported');
  }
  markAgentViewed(): void {}
  agentNeedsDecision() {
    return { needed: false, reason: 'fake engine' };
  }
  snapshot(): Snapshot {
    return {
      episodeId: this.episodeId,
      caseId: this.scenario.caseId,
      seed: this.scenario.seed,
      tick: this.tick,
      simTime: this.tick / 10,
      phase: 'incident',
      paused: false,
      mode: 'live',
      actors: [],
      hazards: [],
      roster: { checkedIn: [], verified: false, lost: [] },
      assistance: { required: false, requested: false, accepted: false, fulfilled: false },
      alarm: { active: false },
      decisions: { used: this.decisions, max: 60, inFlight: false },
      outcome: this._outcome,
    };
  }
  eventsSince(seq: number): WorldEvent[] {
    return this.events.filter((e) => e.seq > seq);
  }
  outcome() {
    return this._outcome;
  }
  end(status: 'aborted' | 'incomplete', reason: string) {
    if (this._outcome) return;
    this._outcome = { status, reason, simTime: this.tick / 10 };
    this.push('episode_ended', { status, reason });
  }
  result(wallTimeMs = 0): EpisodeResult | null {
    if (!this._outcome) return null;
    return {
      episodeId: this.episodeId,
      caseId: this.scenario.caseId,
      outcome: this._outcome,
      metrics: { wallTimeMs } as unknown as EpisodeResult['metrics'],
      debrief: [],
      score: { reward: 0, success: false, checks: {} },
    };
  }
  hash(): string {
    return `h${this.executed.length}-${this.tick}`;
  }
}

export const fakeMap = {
  id: loadMap().id,
  hash: 'fake',
  // Real office zones, zone graph, doors and pull stations so earshot (rooms joined by doorways) behaves as in the
  // game, and the real zone grid so story-beat texts can name places.
  zones: loadMap().zones,
  zoneEdges: loadMap().zoneEdges,
  cols: loadMap().cols,
  rows: loadMap().rows,
  zone: loadMap().zone,
  spawnSpots: Object.fromEntries(ACTOR_IDS.map((id) => [id, []])),
  components: loadMap().components,
  alarms: loadMap().alarms,
} as unknown as MapData;

export const fakeScenario: ScenarioCase = {
  caseId: 'test-case',
  split: 'dev',
  family: 'hero',
  seed: 1,
  mapId: loadMap().id,
  spawns: Object.fromEntries(ACTOR_IDS.map((id, i) => [id, { col: i + 1, row: 1, dir: 'down', pose: ACTOR_PROFILES[id].usesWheelchair ? 'sit' : 'stand' }])) as ScenarioCase['spawns'],
  danielPreference: 'buddy',
  events: [],
  labels: { solvable: true, primaryRouteBlocked: false },
};
