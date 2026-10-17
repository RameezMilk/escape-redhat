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
  placeHazard(kind: HazardKind, col: number, row: number): PlacementResult {
    return { ok: true, event: this.push('hazard_placed', { kind, col, row }) };
  }
  removeHazard(kind: HazardKind) {
    return { ok: true, event: this.push('hazard_removed', { kind }) };
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
      decisions_remaining: 24 - this.decisions,
      actors: [],
      evidence: [],
      messages: [],
      assistance: { person: 'daniel', preference: 'buddy', buddy: 'alex', requested: false, accepted: false, fulfilled: false },
      roster: { checked_in: [], verified: false },
      routes: [],
      recent_actions: [],
      new_since_last_decision: [],
    };
  }
  markViewed(): void {}
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
      roster: { checkedIn: [], verified: false },
      assistance: { required: true, requested: false, accepted: false, fulfilled: false },
      decisions: { used: this.decisions, max: 24, inFlight: false },
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
  id: 'office-v1',
  hash: 'fake',
  zones: [],
  zoneEdges: [],
  spawnSpots: { alex: [], maya: [], daniel: [] },
} as unknown as MapData;

export const fakeScenario: ScenarioCase = {
  caseId: 'test-case',
  split: 'dev',
  family: 'hero',
  seed: 1,
  mapId: 'office-v1',
  spawns: {
    alex: { col: 1, row: 1, dir: 'down', pose: 'stand' },
    maya: { col: 2, row: 1, dir: 'down', pose: 'stand' },
    daniel: { col: 3, row: 1, dir: 'down', pose: 'sit' },
  },
  danielPreference: 'buddy',
  events: [],
  labels: { solvable: true, primaryRouteBlocked: false },
};
