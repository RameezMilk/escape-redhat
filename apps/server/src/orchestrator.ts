// Planner loop shared by the live server and headless evaluation.
//   wake → beginDecision → plannerView → provider.decide → (stale? held?) → executeTool → trace
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
  type ToolResult,
  type TraceRow,
  type TraceStatus,
  type WorldEvent,
} from '@escape/contracts';
import type { Harness } from './config.js';
import { buildSystemPrompt, toolsFor } from './prompt.js';
import { plannerName, type DecisionProvider, type DecisionResult } from './providers/types.js';
import type { RunInput } from './runlog.js';

export interface OrchestratorDeps {
  engine: Engine;
  provider: DecisionProvider;
  map: MapData;
  scenario: ScenarioCase;
  harness: Harness;
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

/** "Pull station — Red Hat room (by door B)" → "Red Hat room pull station". */
function stationName(map: MapData | undefined, id: string | undefined): string {
  const st = id ? map?.alarms?.find((a) => a.id === id) : undefined;
  if (!st) return id ? `${id.replace(/^alarm_/, '').replace(/_/g, ' ')} pull station` : 'a pull station';
  return `${st.label.replace(/^Pull station\s*[—-]\s*/i, '').replace(/\s*\(.*\)\s*$/, '')} pull station`;
}

/** "Sliding door B (Red Hat room east)" → "sliding door B". */
function doorName(map: MapData | undefined, id: string | undefined): string {
  const d = id ? map?.components?.find((c) => c.id === id) : undefined;
  if (!d) return id ? id.replace(/_/g, ' ') : 'a sliding door';
  const base = d.label.replace(/\s*\(.*\)\s*$/, '');
  return base.charAt(0).toLowerCase() + base.slice(1);
}

function zoneName(map: MapData | undefined, col: unknown, row: unknown): string | undefined {
  if (!map?.zone || typeof col !== 'number' || typeof row !== 'number') return undefined;
  const z = map.zone[row * map.cols + col];
  return z ?? undefined;
}

/** Component id an electrical hazard/door event refers to (defensive about field names). */
function componentOf(d: Record<string, unknown>): string | undefined {
  return str(d.componentId) ?? str(d.component) ?? str(d.component_id) ?? str(d.door) ?? str(d.doorId);
}

export function describeEvent(e: WorldEvent, map?: MapData): string | null {
  const d = e.data as Record<string, unknown>;
  const who = e.actor ? ACTOR_PROFILES[e.actor].name : '';
  const ev = e.evidenceIds?.length ? ` (${e.evidenceIds.join(', ')})` : '';
  // Types with fixed wording come first (the engine may also attach a generic summary).
  switch (e.type) {
    case 'hazard_placed': {
      if (d.kind === 'electrical') return `Presenter cut power to ${doorName(map, componentOf(d))}`;
      const zone = zoneName(map, d.col, d.row);
      return `Presenter started a fire at (${String(d.col)},${String(d.row)})${zone ? ` in ${zone}` : ''}`;
    }
    case 'door_disabled':
      return `Presenter cut power to ${doorName(map, componentOf(d))}`;
    case 'alarm_activated': {
      const by = e.actor ?? (isActor(d.by) ? d.by : undefined);
      const station = str(d.stationId) ?? str(d.station) ?? str(d.station_id);
      return `Alarm raised by ${by ? ACTOR_PROFILES[by].name : 'someone'} — ${stationName(map, station)}`;
    }
    case 'actor_lost':
      return `${who || 'Someone'} was lost to the fire`;
    case 'episode_ended':
      return `Episode ended: ${String(d.status ?? '')}${d.reason ? ` — ${String(d.reason)}` : ''}`;
  }
  if (typeof d.summary === 'string') return d.summary;
  switch (e.type) {
    case 'observation': {
      const what = d.kind === 'electrical' ? `a dead sliding door${componentOf(d) ? ` (${doorName(map, componentOf(d))})` : ''}` : String(d.kind ?? 'a hazard');
      return `${who} sees ${what}${d.zone ? ` in ${String(d.zone)}` : ''}${ev}`;
    }
    case 'message_delivered':
      return `${who} → ${String(d.recipient ?? d.to ?? 'all')}: "${String(d.message ?? '')}"`;
    case 'move_completed':
      return `${who} arrived at ${String(d.destination ?? 'destination')}`;
    case 'move_interrupted':
      return `${who} stopped: route unavailable${ev}`;
    case 'assistance_requested':
      return `${who} requested assistance from ${nameOf(d.helper ?? d.helper_id)}`;
    case 'escort_started':
      return `${who} is escorting ${nameOf(d.person ?? d.person_id)}`;
    case 'assistance_fulfilled':
      return 'Assistance arrangement fulfilled';
    case 'checked_in':
      return `${who} checked in at the assembly point`;
    case 'roster_verified':
      return `Roster verified by ${who || 'warden'}`;
    case 'phase_changed':
      return `Phase → ${String(d.phase ?? d.to ?? '')}`;
    default:
      return null;
  }
}

/** Speech/alert bubbles caused by an engine event (shared by live and replay).
 *  `living` = actors not lost (alarm alerts go to everyone still in the simulation). */
export function bubblesForEvent(e: WorldEvent, ctx: { living?: ActorId[] } = {}): Omit<BubbleMessage, 'type' | 'episodeId'>[] {
  const d = e.data as Record<string, unknown>;
  const out: Omit<BubbleMessage, 'type' | 'episodeId'>[] = [];
  if (e.type === 'alarm_activated') {
    const puller = e.actor ?? (isActor(d.by) ? d.by : undefined);
    const living = ctx.living ?? [...ACTOR_IDS];
    for (const a of living) if (a !== puller) out.push({ actor: a, text: '🚨', kind: 'alert', ttlMs: 2500 });
    if (puller) out.push({ actor: puller, text: 'Pulling the fire alarm!', kind: 'message', ttlMs: 4500 });
    return out;
  }
  if (!e.actor) return out;
  if (e.type === 'message_delivered') {
    const text = String(d.message ?? '');
    if (text) out.push({ actor: e.actor, text, kind: 'message', ttlMs: 4500 });
    const recips = Array.isArray(d.recipients)
      ? (d.recipients as unknown[])
      : d.recipient === 'all' || d.to === 'all'
        ? ACTOR_IDS.filter((a) => a !== e.actor)
        : [d.recipient ?? d.to];
    const living = ctx.living;
    for (const r of recips) if (isActor(r) && r !== e.actor && (!living || living.includes(r))) out.push({ actor: r, text: '!', kind: 'alert', ttlMs: 1500 });
  } else if (e.type === 'observation') {
    const icon = d.kind === 'electrical' ? '⚡' : '🔥';
    out.push({ actor: e.actor, text: `${icon} ${e.evidenceIds?.[0] ?? ''}`.trim(), kind: 'observation', ttlMs: 2500 });
  } else if (e.type === 'ambient_line') {
    const text = String(d.text ?? d.line ?? d.message ?? '');
    if (text) out.push({ actor: e.actor, text, kind: 'ambient', ttlMs: 3000 });
  }
  // actor_lost: no bubble — the renderer plays the disintegration effect.
  return out;
}

/** Engine event types shown as trace rows (others are covered by decision rows or are noise). */
const ENGINE_ROW_TYPES = new Set<WorldEvent['type']>([
  'hazard_placed',
  'door_disabled',
  'alarm_activated',
  'actor_lost',
  'observation',
  'message_delivered',
  'move_interrupted',
  'assistance_requested',
  'escort_started',
  'assistance_fulfilled',
  'checked_in',
  'roster_verified',
  'episode_ended',
]);

export class Orchestrator {
  inFlight = false;
  disposed = false;
  private controller = new AbortController();
  private releaseHeld: (() => void) | null = null;
  private rows = new Map<string, TraceRow>();
  private moveRows = new Map<string, string>();
  private consecutiveProviderFailures = 0;
  private failureAt = new Map<ActorId, number>();
  private doorRows = new Set<string>();
  private decisionIndex = 0;
  private lastSeq = 0;
  private lastDecision: { simTime: number; seq: number; productive: boolean } | null = null;
  private readonly system: string;
  private readonly planner: string;

  constructor(private d: OrchestratorDeps) {
    this.system = buildSystemPrompt(d.harness, d.map, d.scenario);
    this.planner = plannerName(d.provider.info());
    // Ingest events already present (episode_started etc.).
    this.ingestNew();
  }

  get episodeId() {
    return this.d.engine.episodeId;
  }

  trace(): TraceRow[] {
    return [...this.rows.values()];
  }

  systemPrompt(): string {
    return this.system;
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

  /** True when a new decision should be requested now. */
  ready(): boolean {
    const { engine } = this.d;
    if (this.inFlight || this.disposed || this.d.isPaused() || engine.outcome()) return false;
    if (!engine.needsDecision().needed) return false;
    const ld = this.lastDecision;
    if (!ld || ld.productive) return true;
    const meaningful = engine.eventsSince(ld.seq).some((e) => e.seq > ld.seq && !QUIET_EVENTS.has(e.type));
    if (meaningful) return true;
    return engine.snapshot().simTime >= ld.simTime + IDLE_BACKOFF_SIM_SEC;
  }

  /** Live mode: start a decision if the engine has work and nothing blocks. */
  maybeDecide(): void {
    if (!this.ready()) return;
    void this.decideOnce().catch((e) => this.d.log?.(`[orchestrator] decision failed: ${(e as Error).stack ?? e}`));
  }

  private markDecision(productive: boolean) {
    this.ingestNew();
    this.lastDecision = { simTime: this.simTime(), seq: this.lastSeq, productive };
  }

  /** Abort in-flight work; any late response is discarded (episode reset). */
  dispose(): void {
    this.disposed = true;
    this.controller.abort();
    this.releaseHeld?.();
  }

  /** Paused → resumed: apply a held response against the current state. */
  resume(): void {
    const r = this.releaseHeld;
    this.releaseHeld = null;
    r?.();
  }

  async decideOnce(): Promise<void> {
    if (this.inFlight || this.disposed) return;
    const { engine, provider } = this.d;
    if (engine.outcome()) return;
    this.inFlight = true;
    try {
      const decisionId = engine.beginDecision();
      this.d.recordInput({ tick: this.d.getTick(), type: 'begin', decisionId });
      const view = engine.plannerView();
      engine.markViewed();
      this.d.recordInput({ tick: this.d.getTick(), type: 'view' });
      this.decisionIndex++;
      const idx = this.decisionIndex;

      const rowId = `${engine.episodeId}:${decisionId}`;
      const base: TraceRow = {
        id: rowId,
        episodeId: engine.episodeId,
        kind: 'decision',
        decisionId,
        origin: `${this.planner} → …`,
        status: 'proposed',
        summary: `Awaiting ${this.planner} decision…`,
        simTime: view.sim_time,
        wallTime: Date.now(),
        provider: this.providerTag(),
      };
      this.emit(base);

      const ask = () =>
        provider.decide({
          system: this.system,
          view,
          harness: this.d.harness,
          tools: toolsFor(this.d.harness, view, this.d.map),
          signal: this.controller.signal,
          deadlineMs: this.d.deadlineMs,
        });
      let res: DecisionResult = await ask();
      let retried = false;
      if (res.kind === 'error' && res.code !== 'ABORTED' && !this.disposed) {
        this.patch(rowId, { summary: `${res.code}: ${res.message} — retrying once` });
        retried = true;
        res = await ask();
      }

      if (this.disposed) {
        this.emit({ ...this.rowWithResponse(base, res), status: 'discarded_stale', summary: 'Response arrived after reset — discarded, not applied' });
        return;
      }

      if (this.d.isPaused()) {
        this.emit({ ...this.rowWithResponse(base, res), status: 'held', summary: 'Paused — response held; will be validated on resume' });
        await new Promise<void>((resolve) => {
          this.releaseHeld = resolve;
        });
        if (this.disposed) {
          this.emit({ ...this.rowWithResponse(base, res), status: 'discarded_stale', summary: 'Held response discarded after reset' });
          return;
        }
      }

      this.apply(base, res, idx, retried);
    } finally {
      this.inFlight = false;
    }
  }

  private rowWithResponse(base: TraceRow, res: DecisionResult): TraceRow {
    const row: TraceRow = { ...base, latencyMs: res.latencyMs, wallTime: Date.now() };
    if (res.kind === 'tool_call' && res.calls[0]) {
      const c = res.calls[0];
      const actor = isActor(c.arguments.actor_id) ? (c.arguments.actor_id as ActorId) : undefined;
      row.tool = c.name;
      row.actor = actor;
      row.args = compactArgs(c.arguments);
      row.origin = `${this.planner} → ${nameOf(actor)} → ${c.name}`;
      if (typeof c.arguments.reason_summary === 'string') row.reasonSummary = c.arguments.reason_summary;
      row.parseMode = res.parseMode;
      row.usage = res.usage;
    }
    if ('raw' in res && res.raw) row.raw = res.raw;
    return row;
  }

  private apply(base: TraceRow, res: DecisionResult, idx: number, retried: boolean) {
    const { engine } = this.d;
    const decisionId = base.decisionId!;
    const tick = this.d.getTick();
    const simTime = this.simTime();

    if (res.kind === 'error') {
      const detail = `${res.code}: ${res.message}${retried ? ' (after 1 retry)' : ''}`;
      engine.noteDecision({ decisionId, kind: 'provider_error', detail }, { latencyMs: res.latencyMs });
      this.d.recordInput({ tick, type: 'note', note: { decisionId, kind: 'provider_error', detail }, meta: { latencyMs: res.latencyMs } });
      this.consecutiveProviderFailures++;
      this.emit({ ...this.rowWithResponse(base, res), status: 'provider_error', summary: detail, simTime, origin: `${this.planner} → (no response)` });
      if (this.consecutiveProviderFailures >= MAX_CONSECUTIVE_PROVIDER_FAILURES && !engine.outcome()) {
        const reason = `model unavailable: ${res.code} ${res.message}`.slice(0, 200);
        engine.end('aborted', reason);
        this.d.recordInput({ tick, type: 'end', status: 'aborted', reason });
      }
      this.markDecision(false);
      return;
    }
    this.consecutiveProviderFailures = 0;

    if (res.kind === 'no_call') {
      const detail = `No tool call in response${res.text ? `: "${res.text.slice(0, 120)}"` : ''}`;
      const meta = { latencyMs: res.latencyMs, promptTokens: res.usage?.promptTokens, completionTokens: res.usage?.completionTokens };
      engine.noteDecision({ decisionId, kind: 'no_call', detail }, meta);
      this.d.recordInput({ tick, type: 'note', note: { decisionId, kind: 'no_call', detail }, meta });
      this.emit({ ...this.rowWithResponse(base, res), status: 'malformed', summary: detail, simTime, origin: `${this.planner} → (no tool call)` });
      this.markDecision(false);
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
      summary: (engineSummary ?? resultSummary(call.name, result)) + (res.malformedArguments ? ' (arguments were not valid JSON)' : ''),
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
        origin: `${this.planner} → ${nameOf(xActor)} → ${x.name}`,
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
    this.markDecision(result.ok && !NON_PROGRESS_TOOLS.has(call.name));
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
    if ((e.type === 'move_completed' || e.type === 'move_interrupted') && e.actionId) {
      const rowId = this.moveRows.get(e.actionId);
      if (rowId) {
        const cur = this.rows.get(rowId);
        if (cur) {
          const done = e.type === 'move_completed';
          this.emit({
            ...cur,
            status: done ? 'completed' : 'failed',
            summary: `${cur.summary} → ${describeEvent(e, this.d.map) ?? (done ? 'arrived' : 'interrupted')}`,
            evidenceIds: [...new Set([...(cur.evidenceIds ?? []), ...(e.evidenceIds ?? [])])],
          });
        }
        this.moveRows.delete(e.actionId);
      }
      if (e.type === 'move_interrupted' && e.actor) this.failureAt.set(e.actor, this.decisionIndex);
    }

    // A presenter's power cut can surface as both hazard_placed(electrical) and door_disabled: one row per door.
    let duplicateDoorRow = false;
    if (e.type === 'door_disabled' || (e.type === 'hazard_placed' && d.kind === 'electrical')) {
      const key = componentOf(d) ?? `seq${e.seq}`;
      duplicateDoorRow = this.doorRows.has(key);
      this.doorRows.add(key);
    }
    if (ENGINE_ROW_TYPES.has(e.type) && !duplicateDoorRow) {
      const summary = describeEvent(e, this.d.map);
      if (summary) {
        this.emit({
          id: `${this.episodeId}:ev:${e.seq}`,
          episodeId: this.episodeId,
          kind: 'engine',
          eventSeq: e.seq,
          decisionId: e.decisionId,
          actionId: e.actionId,
          origin: 'Engine',
          actor: e.actor,
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
      const bubbles = bubblesForEvent(e, e.type === 'alarm_activated' || e.type === 'message_delivered' ? { living: this.living() } : {});
      for (const b of bubbles) this.d.emitBubble(b);
    }
  }

  private living(): ActorId[] {
    return this.d.engine
      .snapshot()
      .actors.filter((a) => !a.lost)
      .map((a) => a.id);
  }
}
