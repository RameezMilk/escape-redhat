// Planner loop shared by the live server and headless evaluation.
//   central: wake → beginDecision → plannerView → provider.decide → (stale? held?) → executeTool → trace
//   agents:  per person: wake → beginDecision → agentView(person) → provider.decide → executeTool (actor pinned) → trace
// Every real proposal and result becomes a TraceRow; engine events become gray "engine" rows.
import {
  ACTOR_IDS,
  ACTOR_PROFILES,
  TOOL_DEFS,
  type ActorId,
  type BubbleMessage,
  type Engine,
  type MapData,
  type ScenarioCase,
  type NormalizedToolCall,
  type ToolResult,
  type TraceRow,
  type TraceStatus,
  type WorldEvent,
} from '@escape/contracts';
import { agentToolsFor, agentUserContent, buildAgentSystemPrompt } from './agentPrompt.js';
import type { Harness, PlannerMode } from './config.js';
import { buildSystemPrompt, toolsFor } from './prompt.js';
import { componentOf, EvidenceBook, humanize, inPlace, theAlarm, theDoor, zoneAtTile } from './places.js';
import { modelName, plannerName, type DecideRequest, type DecisionProvider, type DecisionResult } from './providers/types.js';
import type { RunInput } from './runlog.js';

export interface OrchestratorDeps {
  engine: Engine;
  provider: DecisionProvider;
  map: MapData;
  scenario: ScenarioCase;
  harness: Harness;
  /** 'central' (default): one planner call directs everyone. 'agents': each person makes their own call. */
  mode?: PlannerMode;
  deadlineMs: number;
  /** Number of engine.step() calls so far (stamps run-log inputs). */
  getTick(): number;
  isPaused(): boolean;
  emitRow(row: TraceRow): void;
  recordInput(input: RunInput): void;
  emitBubble?(b: Omit<BubbleMessage, 'type' | 'episodeId'>): void;
  log?(msg: string): void;
}

const isActor = (v: unknown): v is ActorId => typeof v === 'string' && (ACTOR_IDS as readonly string[]).includes(v);
const nameOf = (a: unknown) => (isActor(a) ? ACTOR_PROFILES[a].name : '?');
/** Abort after this many provider errors in a row in one decision slot (the central planner, or one person in
 *  per-agent mode — parallel calls that time out together count once per person, not three times at once). */
const MAX_CONSECUTIVE_PROVIDER_FAILURES = 3;
/** After an unproductive decision (observe/consult_plan/rejected/no call/provider error) with no new
 *  meaningful events, wait this many simulated seconds before asking again (prevents spinning). */
export const IDLE_BACKOFF_SIM_SEC = 2;
/** Events that do not count as news for the idle backoff. Fire spread/charring happen every tick — never wake on them. */
export const QUIET_EVENTS = new Set<WorldEvent['type']>([
  'tool_executed',
  'tool_rejected',
  'decision_note',
  'ambient_line',
  'fire_spread',
  'cell_charred',
]);
const NON_PROGRESS_TOOLS = new Set(['observe', 'consult_plan']);
/** Decision slot key for the central planner (per-agent mode uses the person's id). */
const CENTRAL = 'central';
/** Reasoning text kept on a trace row (the full text stays in raw.response). */
const REASONING_MAX_CHARS = 1500;

/** One decision between asking the model and applying its answer. */
interface OpenDecision {
  base: TraceRow;
  idx: number;
  /** Per-agent mode: the person deciding (their calls are pinned to them). */
  actor: ActorId | null;
  req: DecideRequest;
}

function compactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const { reason_summary: _r, ...rest } = args;
  return rest;
}

function resultSummary(tool: string, result: ToolResult): string {
  if (!result.ok) return `${result.error.code}: ${result.error.message}`;
  const d = result.data as Record<string, unknown>;
  if (typeof d.summary === 'string') return d.summary;
  if (result.status === 'started') return `${tool} started`;
  return `${tool} ok`;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const names = (ids: unknown): string[] => (Array.isArray(ids) ? ids.filter(isActor).map((a) => ACTOR_PROFILES[a].name) : []);
const joinNames = (n: string[]) => (n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} and ${n.at(-1)}`);

/** Was this alarm pulled by a planner decision (pull_alarm tool) or by someone's instinct on their way past? */
export function alarmVia(e: WorldEvent): 'tool' | 'instinct' {
  const via = (e.data as Record<string, unknown>).via;
  if (via === 'tool' || via === 'instinct') return via;
  return e.actionId ? 'tool' : 'instinct';
}

export interface DescribeContext {
  /** People who escaped (checked in) — used for the final story line. */
  escaped?: number;
  book?: EvidenceBook;
}

/**
 * Story-beat text for an engine event (plain English: names and places — never evidence ids, zone ids or
 * coordinates), or null if the event is not a story beat. The orchestrator additionally filters repeats
 * (only the first sighting per hazard, at most one flee line per person per 10 s, no tool-pulled alarm echo).
 */
export function describeEvent(e: WorldEvent, map?: MapData, ctx: DescribeContext = {}): string | null {
  const d = e.data as Record<string, unknown>;
  const who = e.actor ? ACTOR_PROFILES[e.actor].name : isActor(d.actor) ? ACTOR_PROFILES[d.actor].name : 'Someone';
  switch (e.type) {
    case 'hazard_placed':
      if (d.kind === 'electrical') return `⚡ Power cut — ${theDoor(componentOf(d))} is stuck shut`;
      return `🔥 Fire started in ${inPlace(str(d.zone) ?? zoneAtTile(map, d.col, d.row))}`;
    case 'door_disabled':
      return `⚡ Power cut — ${theDoor(componentOf(d))} is stuck shut`;
    case 'observation':
      if (d.kind === 'electrical') return `⚡ ${who} finds ${theDoor(componentOf(d))} dead`;
      if (d.via === 'smoke') return `🔥 ${who} smells smoke — fire in ${inPlace(d.zone)}`;
      return `🔥 ${who} spots fire in ${inPlace(d.zone)}`;
    case 'instinct': {
      const kind = str(d.kind);
      if (kind === 'shout') {
        const heard = names(d.heard_by ?? d.heardBy ?? d.to);
        return `📣 ${who} shouts “Fire!”${heard.length ? ` — ${joinNames(heard)} hear${heard.length === 1 ? 's' : ''}` : ''}`;
      }
      if (kind === 'flee') return `🏃 ${who} backs away from the fire`;
      if (kind === 'alarm') return `🚨 ${who} pulls ${theAlarm(d.station)} on the way out — everyone hears the siren`;
      return null;
    }
    case 'alarm_activated':
      return alarmVia(e) === 'instinct'
        ? `🚨 ${who} pulls ${theAlarm(d.station)} on the way out — everyone hears the siren`
        : `🚨 ${who} pulls ${theAlarm(d.station)} — everyone hears the siren`;
    case 'actor_lost':
      return `✖ ${who} was lost to the fire`;
    case 'episode_ended': {
      const status = str(d.status);
      if (status === 'success') return '🏁 Everyone made it out';
      if (status === 'failed') return '🏁 Nobody made it out';
      if (status === 'partial') return `🏁 Partial — ${ctx.escaped ?? '?'} of ${ACTOR_IDS.length} escaped`;
      return `🏁 Stopped — ${humanize(str(d.reason) ?? status ?? 'safety stop', ctx.book)}`;
    }
    default:
      return null;
  }
}

/** Human reason for an interrupted move (shown on the failed move row). */
export function interruptionReason(e: WorldEvent): string {
  const d = e.data as Record<string, unknown>;
  if (d.code === 'ACTOR_LOST') return 'lost to the fire';
  if (d.hazard_kind === 'electrical') return `stopped — ${theDoor(componentOf(d))} is dead`;
  return `stopped — fire ahead in ${inPlace(str(d.hazard_zone) ?? str(d.zone))}`;
}

export interface BubbleContext {
  /** Actors not lost (alarm alerts go to everyone still in the simulation). */
  living?: ActorId[];
  book?: EvidenceBook;
}

/** Speech/alert bubbles caused by an engine event (shared by live and replay). No ids, ever. */
export function bubblesForEvent(e: WorldEvent, ctx: BubbleContext = {}): Omit<BubbleMessage, 'type' | 'episodeId'>[] {
  const d = e.data as Record<string, unknown>;
  const out: Omit<BubbleMessage, 'type' | 'episodeId'>[] = [];
  const alive = (a: ActorId) => !ctx.living || ctx.living.includes(a);
  if (e.type === 'alarm_activated') {
    const puller = e.actor ?? (isActor(d.by) ? d.by : undefined);
    const living = ctx.living ?? [...ACTOR_IDS];
    for (const a of living) if (a !== puller) out.push({ actor: a, text: '🚨', kind: 'alert', ttlMs: 2500 });
    if (puller) out.push({ actor: puller, text: 'Pulling the fire alarm!', kind: 'message', ttlMs: 4500 });
    return out;
  }
  const actor = e.actor ?? (isActor(d.actor) ? d.actor : undefined);
  if (!actor) return out;
  if (e.type === 'instinct') {
    if (d.kind === 'shout') {
      out.push({ actor, text: 'Fire! Get out!', kind: 'message', ttlMs: 4000 });
      const heard = Array.isArray(d.heard_by ?? d.heardBy ?? d.to) ? ((d.heard_by ?? d.heardBy ?? d.to) as unknown[]) : [];
      for (const r of heard) if (isActor(r) && r !== actor && alive(r)) out.push({ actor: r, text: '!', kind: 'alert', ttlMs: 1500 });
    }
    // flee: the movement says it; alarm: alarm_activated carries the bubbles.
    return out;
  }
  if (e.type === 'message_delivered') {
    const text = humanize(String(d.message ?? ''), ctx.book);
    if (text) out.push({ actor, text, kind: 'message', ttlMs: 4500 });
    const recips = Array.isArray(d.recipients)
      ? (d.recipients as unknown[])
      : d.recipient === 'all' || d.to === 'all'
        ? ACTOR_IDS.filter((a) => a !== actor)
        : [d.recipient ?? d.to];
    for (const r of recips) if (isActor(r) && r !== actor && alive(r)) out.push({ actor: r, text: '!', kind: 'alert', ttlMs: 1500 });
  } else if (e.type === 'observation') {
    const text = d.kind === 'electrical' ? "⚡ This door's dead!" : d.via === 'smoke' ? '🔥 I smell smoke!' : '🔥 Fire!';
    out.push({ actor, text, kind: 'observation', ttlMs: 2500 });
  } else if (e.type === 'ambient_line') {
    const text = String(d.text ?? d.line ?? d.message ?? '');
    if (text) out.push({ actor, text, kind: 'ambient', ttlMs: 3000 });
  }
  // actor_lost: no bubble — the renderer plays the disintegration effect.
  return out;
}

/** Engine event types that can become story-beat rows (further filtered in the orchestrator). Everything else is
 *  either covered by a decision row (messages, check-ins, roster, assistance, tool-pulled alarm, interrupted moves)
 *  or noise (fire spread, charring, phases). */
const STORY_TYPES = new Set<WorldEvent['type']>(['hazard_placed', 'door_disabled', 'observation', 'instinct', 'alarm_activated', 'actor_lost', 'episode_ended']);
/** At most one "backs away from the fire" line per person per this many simulated seconds. */
const FLEE_ROW_GAP_SIM_SEC = 10;

export class Orchestrator {
  disposed = false;
  private controller = new AbortController();
  /** Open decision slots: 'central', or person ids in per-agent mode. */
  private busy = new Set<string>();
  private held: (() => void)[] = [];
  private rows = new Map<string, TraceRow>();
  private moveRows = new Map<string, string>();
  /** Provider errors in a row, per decision slot. */
  private consecutiveProviderFailures = new Map<string, number>();
  private failureAt = new Map<ActorId, number>();
  private doorRows = new Set<string>();
  /** What each evidence id refers to — for turning stray ids into words in viewer-facing text. */
  readonly book = new EvidenceBook();
  /** Hazards whose first sighting already has a story line. */
  private sighted = new Set<string>();
  /** Last "backs away" story line per person (sim seconds). */
  private lastFleeRow = new Map<ActorId, number>();
  private alarmRowDone = false;
  private decisionIndex = 0;
  private lastSeq = 0;
  /** Last decision per slot (idle backoff after an unproductive one). */
  private lastDecision = new Map<string, { simTime: number; seq: number; productive: boolean }>();
  private readonly system: string;
  private readonly agentSystems: Record<ActorId, string>;
  private readonly planner: string;
  private readonly model: string;
  readonly mode: PlannerMode;

  constructor(private d: OrchestratorDeps) {
    this.mode = d.mode ?? 'central';
    this.system = buildSystemPrompt(d.harness, d.map, d.scenario);
    this.agentSystems = Object.fromEntries(ACTOR_IDS.map((id) => [id, buildAgentSystemPrompt(id, d.map, d.scenario)])) as Record<ActorId, string>;
    this.planner = plannerName(d.provider.info());
    this.model = modelName(d.provider.info());
    // Ingest events already present (episode_started etc.).
    this.ingestNew();
  }

  /** Any decision waiting on the model (the live loop may freeze the sim clock meanwhile). */
  get inFlight(): boolean {
    return this.busy.size > 0;
  }

  get episodeId() {
    return this.d.engine.episodeId;
  }

  trace(): TraceRow[] {
    return [...this.rows.values()];
  }

  systemPrompt(actor?: ActorId): string {
    return actor && this.mode === 'agents' ? this.agentSystems[actor] : this.system;
  }

  private emit(row: TraceRow) {
    this.rows.set(row.id, row);
    this.d.emitRow(row);
  }

  private patch(id: string, p: Partial<TraceRow>) {
    const cur = this.rows.get(id);
    if (!cur) return;
    this.emit({ ...cur, ...p });
  }

  private simTime() {
    return this.d.engine.snapshot().simTime;
  }

  private providerTag() {
    const i = this.d.provider.info();
    return { id: i.id, model: i.model, endpointKind: i.endpointKind };
  }

  /** Idle backoff: after an unproductive decision, wait for news or a couple of simulated seconds. */
  private backoffOver(key: string): boolean {
    const { engine } = this.d;
    const ld = this.lastDecision.get(key);
    if (!ld || ld.productive) return true;
    const meaningful = engine.eventsSince(ld.seq).some((e) => e.seq > ld.seq && !QUIET_EVENTS.has(e.type));
    if (meaningful) return true;
    return engine.snapshot().simTime >= ld.simTime + IDLE_BACKOFF_SIM_SEC;
  }

  private blocked(): boolean {
    return this.disposed || this.d.isPaused() || !!this.d.engine.outcome();
  }

  /** Central mode: true when a new planner decision should be requested now. */
  ready(): boolean {
    if (this.mode === 'agents') return this.readyAgents().length > 0;
    if (this.busy.has(CENTRAL) || this.blocked()) return false;
    if (!this.d.engine.needsDecision().needed) return false;
    return this.backoffOver(CENTRAL);
  }

  /** Per-agent mode: the people who should decide now (fixed order: alex, maya, daniel). */
  readyAgents(): ActorId[] {
    if (this.mode !== 'agents' || this.blocked()) return [];
    return ACTOR_IDS.filter((id) => !this.busy.has(id) && this.d.engine.agentNeedsDecision(id).needed && this.backoffOver(id));
  }

  /** Live mode: start every decision the engine has work for (one per person in per-agent mode). */
  maybeDecide(): void {
    const fail = (e: unknown) => this.d.log?.(`[orchestrator] decision failed: ${(e as Error).stack ?? e}`);
    if (this.mode === 'agents') {
      for (const id of this.readyAgents()) void this.decideFor(id).catch(fail);
      return;
    }
    if (!this.ready()) return;
    void this.decideOnce().catch(fail);
  }

  private markDecision(key: string, productive: boolean) {
    this.ingestNew();
    this.lastDecision.set(key, { simTime: this.simTime(), seq: this.lastSeq, productive });
  }

  /** Abort in-flight work; any late response is discarded (episode reset). */
  dispose(): void {
    this.disposed = true;
    this.controller.abort();
    this.resume();
  }

  /** Paused → resumed: apply held responses against the current state. */
  resume(): void {
    const held = this.held;
    this.held = [];
    for (const r of held) r();
  }

  /** Central mode: one planner decision. */
  async decideOnce(): Promise<void> {
    await this.run([null]);
  }

  /** Per-agent mode: one person's own decision. */
  async decideFor(actor: ActorId): Promise<void> {
    await this.run([actor]);
  }

  /** Headless per-agent step: open decisions for these people in order, ask the model for all of them in parallel,
   *  then apply the answers in the same order (deterministic for a given set of answers). */
  async decideAgents(actors: ActorId[]): Promise<void> {
    await this.run(actors);
  }

  private async run(who: (ActorId | null)[]): Promise<void> {
    const keys = who.map((a) => a ?? CENTRAL).filter((k) => !this.busy.has(k));
    if (!keys.length || this.disposed || this.d.engine.outcome()) return;
    for (const k of keys) this.busy.add(k);
    try {
      const open = keys.map((k) => this.open(k === CENTRAL ? null : (k as ActorId)));
      const answers = await Promise.all(open.map((o) => this.ask(o)));
      for (let i = 0; i < open.length; i++) await this.settle(open[i], answers[i]);
    } finally {
      for (const k of keys) this.busy.delete(k);
    }
  }

  /** Start a decision: count it, build the right view, show a placeholder row. */
  private open(actor: ActorId | null): OpenDecision {
    const { engine } = this.d;
    const decisionId = engine.beginDecision();
    this.d.recordInput({ tick: this.d.getTick(), type: 'begin', decisionId });
    this.decisionIndex++;
    const idx = this.decisionIndex;
    const rowId = `${engine.episodeId}:${decisionId}`;
    const signal = this.controller.signal;
    const deadlineMs = this.d.deadlineMs;
    let req: DecideRequest;
    let simTime: number;
    if (actor) {
      const view = engine.agentView(actor);
      engine.markAgentViewed(actor);
      this.d.recordInput({ tick: this.d.getTick(), type: 'view', actor });
      simTime = view.sim_time;
      req = {
        system: this.agentSystems[actor],
        agent: { actor, view, user: agentUserContent(view) },
        map: this.d.map,
        tools: agentToolsFor(actor, view),
        signal,
        deadlineMs,
      };
    } else {
      const view = engine.plannerView();
      engine.markViewed();
      this.d.recordInput({ tick: this.d.getTick(), type: 'view' });
      simTime = view.sim_time;
      req = { system: this.system, view, map: this.d.map, harness: this.d.harness, tools: toolsFor(this.d.harness, view, this.d.map), signal, deadlineMs };
    }
    const who = actor ? ACTOR_PROFILES[actor].name : null;
    const base: TraceRow = {
      id: rowId,
      episodeId: engine.episodeId,
      kind: 'decision',
      decisionId,
      origin: who ? `${this.model} → ${who} (own decision) → …` : `${this.planner} → …`,
      ...(actor ? { actor } : {}),
      status: 'proposed',
      summary: who ? `${who} is thinking…` : `Awaiting ${this.planner} decision…`,
      simTime,
      wallTime: Date.now(),
      provider: this.providerTag(),
    };
    this.emit(base);
    return { base, idx, actor, req };
  }

  /** Ask the model (one retry on a transport error). */
  private async ask(o: OpenDecision): Promise<{ res: DecisionResult; retried: boolean }> {
    let res = await this.d.provider.decide(o.req);
    if (res.kind === 'error' && res.code !== 'ABORTED' && !this.disposed) {
      this.patch(o.base.id, { summary: `${res.code}: ${res.message} — retrying once` });
      res = await this.d.provider.decide(o.req);
      return { res, retried: true };
    }
    return { res, retried: false };
  }

  /** Apply an answer unless the episode was reset; hold it while paused. */
  private async settle(o: OpenDecision, a: { res: DecisionResult; retried: boolean }): Promise<void> {
    let res = a.res;
    // Per-agent mode: a person only ever acts for themselves.
    if (o.actor && res.kind === 'tool_call') res = { ...res, calls: res.calls.map((c) => pinActor(c, o.actor!)) };
    if (this.disposed) {
      this.emit({ ...this.rowWithResponse(o.base, res), status: 'discarded_stale', summary: 'Response arrived after reset — discarded, not applied' });
      return;
    }
    if (this.d.isPaused()) {
      this.emit({ ...this.rowWithResponse(o.base, res), status: 'held', summary: 'Paused — response held; will be validated on resume' });
      await new Promise<void>((resolve) => {
        this.held.push(resolve);
      });
      if (this.disposed) {
        this.emit({ ...this.rowWithResponse(o.base, res), status: 'discarded_stale', summary: 'Held response discarded after reset' });
        return;
      }
    }
    this.apply(o, res, a.retried);
  }

  /** Trace origin: "Nemotron planner → Maya → move" (central) or "Nemotron → Maya (own decision) → move" (agents). */
  private originFor(actor: ActorId | undefined, tool: string): string {
    return this.mode === 'agents' ? `${this.model} → ${nameOf(actor)} (own decision) → ${tool}` : `${this.planner} → ${nameOf(actor)} → ${tool}`;
  }

  private rowWithResponse(base: TraceRow, res: DecisionResult): TraceRow {
    const row: TraceRow = { ...base, latencyMs: res.latencyMs, wallTime: Date.now() };
    if ((res.kind === 'tool_call' || res.kind === 'no_call') && res.reasoning) row.reasoning = res.reasoning.slice(0, REASONING_MAX_CHARS);
    if (res.kind === 'tool_call' && res.calls[0]) {
      const c = res.calls[0];
      const actor = isActor(c.arguments.actor_id) ? (c.arguments.actor_id as ActorId) : undefined;
      row.tool = c.name;
      row.actor = actor;
      row.args = compactArgs(c.arguments);
      row.origin = this.originFor(actor, c.name);
      if (typeof c.arguments.reason_summary === 'string') row.reasonSummary = c.arguments.reason_summary;
      row.parseMode = res.parseMode;
      row.usage = res.usage;
    }
    if ('raw' in res && res.raw) row.raw = res.raw;
    return row;
  }

  private apply(o: OpenDecision, res: DecisionResult, retried: boolean) {
    const { engine } = this.d;
    const { base, idx } = o;
    const key = o.actor ?? CENTRAL;
    const who = o.actor ? `${this.model} → ${nameOf(o.actor)} (own decision)` : this.planner;
    const decisionId = base.decisionId!;
    const tick = this.d.getTick();
    const simTime = this.simTime();

    if (res.kind === 'error') {
      const detail = `${res.code}: ${res.message}${retried ? ' (after 1 retry)' : ''}`;
      engine.noteDecision({ decisionId, kind: 'provider_error', detail }, { latencyMs: res.latencyMs });
      this.d.recordInput({ tick, type: 'note', note: { decisionId, kind: 'provider_error', detail }, meta: { latencyMs: res.latencyMs } });
      const failures = (this.consecutiveProviderFailures.get(key) ?? 0) + 1;
      this.consecutiveProviderFailures.set(key, failures);
      this.emit({ ...this.rowWithResponse(base, res), status: 'provider_error', summary: detail, simTime, origin: `${who} → (no response)` });
      if (failures >= MAX_CONSECUTIVE_PROVIDER_FAILURES && !engine.outcome()) {
        const reason = `model unavailable: ${res.code} ${res.message}`.slice(0, 200);
        engine.end('aborted', reason);
        this.d.recordInput({ tick, type: 'end', status: 'aborted', reason });
      }
      this.markDecision(key, false);
      return;
    }
    this.consecutiveProviderFailures.set(key, 0);

    if (res.kind === 'no_call') {
      const detail = `No tool call in response${res.text ? `: "${res.text.slice(0, 120)}"` : ''}`;
      const meta = { latencyMs: res.latencyMs, promptTokens: res.usage?.promptTokens, completionTokens: res.usage?.completionTokens };
      engine.noteDecision({ decisionId, kind: 'no_call', detail }, meta);
      this.d.recordInput({ tick, type: 'note', note: { decisionId, kind: 'no_call', detail }, meta });
      this.emit({ ...this.rowWithResponse(base, res), status: 'malformed', summary: detail, simTime, origin: `${who} → (no tool call)` });
      this.markDecision(key, false);
      return;
    }

    const [call, ...extra] = res.calls;
    const meta = {
      decisionId,
      latencyMs: res.latencyMs,
      promptTokens: res.usage?.promptTokens,
      completionTokens: res.usage?.completionTokens,
    };
    const seqBefore = this.lastSeq;
    const result = engine.executeTool(call, meta);
    this.d.recordInput({ tick, type: 'tool', call, meta });
    // Prefer the engine's own human-readable summary (carried on the tool_executed/tool_rejected event).
    const toolEvent = engine
      .eventsSince(seqBefore)
      .filter((e) => (e.type === 'tool_executed' || e.type === 'tool_rejected') && e.decisionId === decisionId)
      .at(-1);
    const engineSummary = typeof toolEvent?.data.summary === 'string' ? (toolEvent.data.summary as string) : undefined;

    const row = this.rowWithResponse(base, res);
    const actor = row.actor;
    let status: TraceStatus;
    if (!result.ok) status = 'rejected';
    else status = result.status === 'started' ? 'running' : 'completed';
    let recovered = false;
    if (actor) {
      if (!result.ok) this.failureAt.set(actor, idx);
      else {
        const f = this.failureAt.get(actor);
        if (f !== undefined && idx - f <= 3) {
          recovered = true;
          this.failureAt.delete(actor);
        }
      }
    }
    if (result.ok && result.status === 'started') this.moveRows.set(result.actionId, base.id);
    this.emit({
      ...row,
      actionId: result.actionId,
      status,
      result,
      summary: humanize(engineSummary ?? resultSummary(call.name, result), this.book) + (res.malformedArguments ? ' (arguments were not valid JSON)' : ''),
      evidenceIds: result.ok ? result.evidenceIds : undefined,
      simTime,
      recovered: recovered || undefined,
    });

    extra.forEach((x, i) => {
      const detail = `${x.name} ignored: one action per turn`;
      engine.noteDecision({ decisionId, kind: 'ignored_extra_call', detail });
      this.d.recordInput({ tick, type: 'note', note: { decisionId, kind: 'ignored_extra_call', detail } });
      const xActor = isActor(x.arguments.actor_id) ? (x.arguments.actor_id as ActorId) : undefined;
      this.emit({
        id: `${base.id}:x${i + 1}`,
        episodeId: base.episodeId,
        kind: 'decision',
        decisionId,
        origin: this.originFor(xActor, x.name),
        actor: xActor,
        tool: x.name,
        args: compactArgs(x.arguments),
        status: 'ignored',
        summary: detail,
        simTime,
        wallTime: Date.now(),
        provider: this.providerTag(),
      });
    });
    this.markDecision(key, result.ok && !NON_PROGRESS_TOOLS.has(call.name));
  }

  /** Pull engine events since the last call: update move rows, add engine rows and bubbles. */
  ingestNew(): void {
    const events = this.d.engine.eventsSince(this.lastSeq).filter((e) => e.seq > this.lastSeq);
    for (const e of events) {
      this.lastSeq = Math.max(this.lastSeq, e.seq);
      this.ingestEvent(e);
    }
  }

  private ingestEvent(e: WorldEvent) {
    const d = e.data as Record<string, unknown>;
    this.book.learn(e);
    if ((e.type === 'move_completed' || e.type === 'move_interrupted') && e.actionId) {
      const rowId = this.moveRows.get(e.actionId);
      if (rowId) {
        const cur = this.rows.get(rowId);
        if (cur) {
          const done = e.type === 'move_completed';
          this.emit({
            ...cur,
            status: done ? 'completed' : 'failed',
            summary: `${cur.summary} → ${done ? 'arrived' : interruptionReason(e)}`,
            evidenceIds: [...new Set([...(cur.evidenceIds ?? []), ...(e.evidenceIds ?? [])])],
          });
        }
        this.moveRows.delete(e.actionId);
      }
      if (e.type === 'move_interrupted' && e.actor) this.failureAt.set(e.actor, this.decisionIndex);
    }

    if (STORY_TYPES.has(e.type) && this.isStoryBeat(e, d)) {
      const escaped = e.type === 'episode_ended' ? this.d.engine.snapshot().roster.checkedIn.length : undefined;
      const summary = describeEvent(e, this.d.map, { escaped, book: this.book });
      if (summary) {
        this.emit({
          id: `${this.episodeId}:ev:${e.seq}`,
          episodeId: this.episodeId,
          kind: 'engine',
          eventSeq: e.seq,
          decisionId: e.decisionId,
          actionId: e.actionId,
          origin: e.type === 'instinct' || (e.type === 'alarm_activated' && alarmVia(e) === 'instinct') ? 'Instinct (engine — not the model)' : 'Engine',
          actor: e.actor ?? (isActor(d.actor) ? d.actor : undefined),
          status: 'info',
          summary,
          evidenceIds: e.evidenceIds,
          simTime: e.simTime,
          wallTime: Date.now(),
        });
      }
    }

    // Bubbles
    if (this.d.emitBubble) {
      const living = e.type === 'alarm_activated' || e.type === 'message_delivered' || e.type === 'instinct' ? this.living() : undefined;
      for (const b of bubblesForEvent(e, { living, book: this.book })) this.d.emitBubble(b);
    }
  }

  /** Story-beat filter: one line per moment that matters, never an echo of a decision row. */
  private isStoryBeat(e: WorldEvent, d: Record<string, unknown>): boolean {
    switch (e.type) {
      case 'hazard_placed':
      case 'door_disabled': {
        if (e.type === 'hazard_placed' && d.kind !== 'electrical') return true;
        // A power cut can surface as both hazard_placed(electrical) and door_disabled: one line per door.
        const key = componentOf(d) ?? `seq${e.seq}`;
        if (this.doorRows.has(key)) return false;
        this.doorRows.add(key);
        return true;
      }
      case 'observation': {
        // Only the first sighting of each hazard (later sightings are covered by bubbles and instincts).
        const key = e.evidenceIds?.[0] ?? componentOf(d) ?? `${String(d.kind)}:${String(d.zone)}`;
        if (this.sighted.has(key)) return false;
        this.sighted.add(key);
        return true;
      }
      case 'instinct': {
        if (d.kind === 'alarm') {
          if (this.alarmRowDone) return false;
          this.alarmRowDone = true;
          return true;
        }
        if (d.kind === 'flee') {
          const a = e.actor ?? (isActor(d.actor) ? d.actor : undefined);
          if (!a) return false;
          const last = this.lastFleeRow.get(a);
          if (last !== undefined && e.simTime - last < FLEE_ROW_GAP_SIM_SEC) return false;
          this.lastFleeRow.set(a, e.simTime);
          return true;
        }
        return d.kind === 'shout';
      }
      case 'alarm_activated': {
        // A pull_alarm decision row already covers a tool pull; but an alarm pulled on ARRIVAL from a planner move
        // to "alarm" has no pull_alarm row (only the move row), so it still gets a story line.
        const fromMoveArrival = !!e.actionId && this.moveRows.has(e.actionId);
        if ((alarmVia(e) === 'tool' && !fromMoveArrival) || this.alarmRowDone) return false;
        this.alarmRowDone = true;
        return true;
      }
      case 'actor_lost':
      case 'episode_ended':
        return true;
      default:
        return false;
    }
  }

  private living(): ActorId[] {
    return this.d.engine
      .snapshot()
      .actors.filter((a) => !a.lost)
      .map((a) => a.id);
  }
}

/** Per-agent mode: whatever actor_id the model wrote, the call is for the person who made it. */
function pinActor(call: NormalizedToolCall, actor: ActorId): NormalizedToolCall {
  if (call.arguments.actor_id === actor) return call;
  return { ...call, arguments: { ...call.arguments, actor_id: actor } };
}
