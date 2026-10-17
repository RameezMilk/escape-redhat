// One live episode at a time (plus labeled replays). Owns the 10 Hz sim loop, presenter
// commands, pause/reset semantics, the run log and broadcasting to every connected client.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACTOR_IDS,
  type ActorId,
  type ClientMessage,
  type CreateEngine,
  type Engine,
  type EpisodeResult,
  type HazardKind,
  type MapData,
  type ScenarioCase,
  type ServerMessage,
  type Snapshot,
  type SpawnSpot,
  type TraceRow,
} from '@escape/contracts';
import type { PlannerConfig } from './config.js';
import { caseSummaries } from './data.js';
import { bubblesForEvent, Orchestrator } from './orchestrator.js';
import type { DecisionProvider } from './providers/types.js';
import { applyInput, listRuns, readRunLog, RunLog, type RunHeader, type RunInput, type RunLine } from './runlog.js';

export interface SessionDeps {
  map: MapData;
  cases: Map<string, ScenarioCase>;
  provider: DecisionProvider;
  planner: PlannerConfig;
  createEngine: CreateEngine;
  broadcast(msg: ServerMessage): void;
  runsDir?: string | null;
  defaultCase?: string;
  /** Wall-clock ms per sim tick for the live loop (default 100 = real time). 0 disables the timer (tests drive loop()). */
  tickIntervalMs?: number;
  maxSimTime?: number;
  log?(msg: string): void;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded, non-overlapping spawns from the map's authored spawn spots (used when reset supplies a new seed). */
export function pickSpawns(map: MapData, seed: number): Record<ActorId, SpawnSpot> {
  const rng = mulberry32(seed);
  const used = new Set<string>();
  const out = {} as Record<ActorId, SpawnSpot>;
  for (const id of ACTOR_IDS) {
    const spots = map.spawnSpots[id].filter((s) => !used.has(`${s.col},${s.row}`));
    const s = spots[Math.floor(rng() * spots.length)] ?? map.spawnSpots[id][0];
    used.add(`${s.col},${s.row}`);
    out[id] = s;
  }
  return out;
}

interface ReplayState {
  engine: Engine;
  replayId: string;
  header: RunHeader;
  inputs: Map<number, RunInput[]>;
  traceRows: Map<number, TraceRow[]>;
  tick: number;
  finalTick: number;
  footer?: Extract<RunLine, { type: 'footer' }>;
  recordedResult?: EpisodeResult;
  done: boolean;
  rows: Map<string, TraceRow>;
}

export class Session {
  private engine!: Engine;
  private orch!: Orchestrator;
  private runLog!: RunLog;
  private scenario!: ScenarioCase;
  private tick = 0;
  paused = false;
  private ended = false;
  private wallStart = 0;
  private result: EpisodeResult | null = null;
  private counter = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private replay: ReplayState | null = null;

  constructor(private d: SessionDeps) {}

  get episodeId(): string {
    return this.replay ? this.replay.replayId : this.engine.episodeId;
  }

  get currentEngine(): Engine {
    return this.engine;
  }

  get orchestrator(): Orchestrator {
    return this.orch;
  }

  /** Start (or restart) a live episode. */
  start(caseId?: string, seed?: number): void {
    this.stopTimer();
    const base = this.d.cases.get(caseId ?? this.d.defaultCase ?? 'demo-hero') ?? [...this.d.cases.values()][0];
    if (!base) throw new Error('no scenario cases loaded');
    let scenario = base;
    if (seed !== undefined && seed !== base.seed) scenario = { ...base, seed, spawns: pickSpawns(this.d.map, seed) };
    this.scenario = scenario;
    this.counter++;
    const episodeId = `ep-${Date.now().toString(36)}-${this.counter}`;
    const maxDecisions = this.d.planner.maxDecisions;
    const maxSimTime = this.d.maxSimTime ?? 240;
    this.engine = this.d.createEngine(this.d.map, scenario, { episodeId, maxDecisions, maxSimTime });
    this.tick = 0;
    this.paused = false;
    this.ended = false;
    this.result = null;
    this.replay = null;
    this.wallStart = Date.now();

    const runsDir = this.d.runsDir ?? null;
    this.runLog = new RunLog(runsDir ? join(runsDir, `${episodeId}.jsonl`) : null);
    const info = this.d.provider.info();
    this.runLog.write({
      type: 'header',
      runId: episodeId,
      episodeId,
      createdAt: new Date().toISOString(),
      scenario,
      mapId: this.d.map.id,
      mapHash: this.d.map.hash,
      provider: { id: info.id, label: info.label, model: info.model, endpointKind: info.endpointKind, baseUrl: info.baseUrl, thinking: info.thinking },
      harness: this.d.planner.harness,
      engineOptions: { maxDecisions, maxSimTime },
      clock: 'live',
    });

    this.orch = new Orchestrator({
      engine: this.engine,
      provider: this.d.provider,
      map: this.d.map,
      scenario,
      harness: this.d.planner.harness,
      deadlineMs: this.d.planner.deadlineMs,
      getTick: () => this.tick,
      isPaused: () => this.paused,
      emitRow: (row) => {
        this.runLog.write({ type: 'trace', tick: this.tick, row });
        this.d.broadcast({ type: 'trace', episodeId: row.episodeId, row });
      },
      recordInput: (input) => this.runLog.write({ type: 'input', input }),
      emitBubble: (b) => this.d.broadcast({ type: 'bubble', episodeId, ...b }),
      log: this.d.log,
    });

    this.d.broadcast(this.welcome());
    const interval = this.d.tickIntervalMs ?? 100;
    if (interval > 0) this.timer = setInterval(() => this.loop(), interval);
  }

  stop(): void {
    this.stopTimer();
    this.orch?.dispose();
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private record(input: RunInput) {
    this.runLog.write({ type: 'input', input });
  }

  /** One iteration of the live loop (also driven directly by tests). */
  loop(): void {
    if (this.replay) return this.replayLoop();
    if (!this.paused && !this.engine.outcome()) {
      this.engine.step();
      this.tick++;
    }
    this.orch.ingestNew();
    if (!this.paused) this.orch.maybeDecide();
    this.d.broadcast({ type: 'snapshot', episodeId: this.episodeId, snapshot: this.snapshot() });
    if (this.engine.outcome() && !this.ended) this.finish();
  }

  private finish() {
    this.ended = true;
    this.orch.ingestNew();
    const result = this.engine.result(Date.now() - this.wallStart);
    this.result = result;
    if (result) {
      this.runLog.write({ type: 'result', tick: this.tick, result });
      this.d.broadcast({ type: 'episode_end', episodeId: this.engine.episodeId, result });
    }
    this.runLog.write({ type: 'footer', finalTick: this.tick, hash: this.engine.hash(), eventCount: this.engine.events.length });
    this.d.log?.(`[session] ${this.engine.episodeId} ended: ${result?.outcome.status ?? '?'} — ${result?.outcome.reason ?? ''}`);
  }

  snapshot(): Snapshot {
    if (this.replay) {
      const s = this.replay.engine.snapshot();
      return { ...s, episodeId: this.replay.replayId, paused: this.paused, mode: 'replay', decisions: { ...s.decisions, inFlight: false } };
    }
    const s = this.engine.snapshot();
    return {
      ...s,
      episodeId: this.engine.episodeId,
      paused: this.paused,
      mode: 'live',
      decisions: { ...s.decisions, inFlight: this.orch.inFlight },
    };
  }

  trace(): TraceRow[] {
    return this.replay ? [...this.replay.rows.values()] : this.orch.trace();
  }

  welcome(): ServerMessage {
    return {
      type: 'welcome',
      episodeId: this.episodeId,
      snapshot: this.snapshot(),
      trace: this.trace(),
      provider: this.d.provider.info(),
      mapId: this.d.map.id,
      cases: caseSummaries(this.d.cases),
      runs: this.d.runsDir ? listRuns(this.d.runsDir) : [],
      result: this.replay ? (this.replay.done ? (this.replay.engine.result() ?? null) : null) : this.result,
    };
  }

  pause(): void {
    this.paused = true;
    this.d.broadcast({ type: 'snapshot', episodeId: this.episodeId, snapshot: this.snapshot() });
  }

  resume(): void {
    this.paused = false;
    if (!this.replay) this.orch.resume();
    this.d.broadcast({ type: 'snapshot', episodeId: this.episodeId, snapshot: this.snapshot() });
  }

  reset(caseId?: string, seed?: number): void {
    if (!this.replay) {
      this.orch.dispose();
      if (!this.ended) {
        this.runLog.write({ type: 'footer', finalTick: this.tick, hash: this.engine.hash(), eventCount: this.engine.events.length });
      }
    }
    this.start(caseId ?? this.scenario?.caseId, seed);
  }

  place(kind: HazardKind, col: number, row: number): ServerMessage {
    const episodeId = this.episodeId;
    if (this.replay) return { type: 'placement_result', episodeId, kind, ok: false, code: 'REPLAY', reason: 'Replay in progress — reset to return to live mode' };
    const e = this.engine;
    let r = e.placeHazard(kind, col, row);
    this.record({ tick: this.tick, type: 'place', kind, col, row });
    if (!r.ok && r.code === 'ALREADY_PLACED') {
      const canReposition = this.paused || e.snapshot().phase === 'idle';
      if (!canReposition) {
        return { type: 'placement_result', episodeId, kind, ok: false, code: 'PAUSE_TO_MOVE', reason: `A ${kind} is already placed — pause to reposition it` };
      }
      const old = e.snapshot().hazards.find((h) => h.kind === kind);
      e.removeHazard(kind);
      this.record({ tick: this.tick, type: 'remove', kind });
      r = e.placeHazard(kind, col, row);
      this.record({ tick: this.tick, type: 'place', kind, col, row });
      if (!r.ok && old) {
        e.placeHazard(kind, old.col, old.row);
        this.record({ tick: this.tick, type: 'place', kind, col: old.col, row: old.row });
      }
    }
    this.orch.ingestNew();
    if (!this.paused) this.orch.maybeDecide();
    const msg: ServerMessage = r.ok
      ? { type: 'placement_result', episodeId, kind, ok: true }
      : { type: 'placement_result', episodeId, kind, ok: false, code: r.code, reason: r.reason };
    this.d.broadcast({ type: 'snapshot', episodeId, snapshot: this.snapshot() });
    return msg;
  }

  remove(kind: HazardKind): ServerMessage {
    const episodeId = this.episodeId;
    if (this.replay) return { type: 'placement_result', episodeId, kind, ok: false, code: 'REPLAY', reason: 'Replay in progress' };
    if (!this.paused && this.engine.snapshot().phase !== 'idle') {
      return { type: 'placement_result', episodeId, kind, ok: false, code: 'PAUSE_TO_REMOVE', reason: 'Pause the exercise to remove a hazard (or reset)' };
    }
    const r = this.engine.removeHazard(kind);
    this.record({ tick: this.tick, type: 'remove', kind });
    this.orch.ingestNew();
    this.d.broadcast({ type: 'snapshot', episodeId, snapshot: this.snapshot() });
    return r.ok
      ? { type: 'placement_result', episodeId, kind, ok: true }
      : { type: 'placement_result', episodeId, kind, ok: false, code: 'NOT_PLACED', reason: r.reason ?? 'nothing to remove' };
  }

  /** Handle one validated client message. Returns a direct reply for the sender, if any. */
  handle(msg: ClientMessage): ServerMessage | null {
    switch (msg.type) {
      case 'hello':
        return this.welcome();
      case 'place':
        return this.place(msg.kind, msg.col, msg.row);
      case 'remove':
        return this.remove(msg.kind);
      case 'pause':
        this.pause();
        return null;
      case 'resume':
        this.resume();
        return null;
      case 'reset':
        this.reset(msg.caseId, msg.seed);
        return null;
      case 'replay':
        return this.startReplay(msg.runId);
    }
  }

  // -------------------------------------------------------------------------
  // Replay: re-simulate a saved run through a fresh engine, label it REPLAY, verify the hash.
  // -------------------------------------------------------------------------

  startReplay(runId: string): ServerMessage | null {
    if (!/^[\w.-]+$/.test(runId) || !this.d.runsDir) return { type: 'error', episodeId: this.episodeId, message: 'invalid run id' };
    const path = join(this.d.runsDir, `${runId}.jsonl`);
    if (!existsSync(path)) return { type: 'error', episodeId: this.episodeId, message: `run ${runId} not found` };
    let lines: RunLine[];
    try {
      lines = readRunLog(path);
    } catch (e) {
      return { type: 'error', episodeId: this.episodeId, message: `cannot read run log: ${(e as Error).message}` };
    }
    const header = lines.find((l): l is RunHeader => l.type === 'header');
    if (!header) return { type: 'error', episodeId: this.episodeId, message: 'run log has no header' };

    // Leave live mode cleanly.
    if (!this.replay) {
      this.orch.dispose();
      if (!this.ended) this.runLog.write({ type: 'footer', finalTick: this.tick, hash: this.engine.hash(), eventCount: this.engine.events.length });
      this.ended = true;
    }
    this.stopTimer();

    const inputs = new Map<number, RunInput[]>();
    const traceRows = new Map<number, TraceRow[]>();
    let footer: ReplayState['footer'];
    let recordedResult: EpisodeResult | undefined;
    let maxTick = 0;
    for (const l of lines) {
      if (l.type === 'input') {
        const arr = inputs.get(l.input.tick) ?? [];
        arr.push(l.input);
        inputs.set(l.input.tick, arr);
        maxTick = Math.max(maxTick, l.input.tick);
      } else if (l.type === 'trace') {
        const arr = traceRows.get(l.tick) ?? [];
        arr.push(l.row);
        traceRows.set(l.tick, arr);
        maxTick = Math.max(maxTick, l.tick);
      } else if (l.type === 'footer') footer = l;
      else if (l.type === 'result') recordedResult = l.result;
    }
    this.counter++;
    const replayId = `replay-${header.episodeId}-${this.counter}`;
    const engine = this.d.createEngine(this.d.map, header.scenario, { episodeId: header.episodeId, ...header.engineOptions });
    this.replay = {
      engine,
      replayId,
      header,
      inputs,
      traceRows,
      tick: 0,
      finalTick: footer?.finalTick ?? maxTick,
      footer,
      recordedResult,
      done: false,
      rows: new Map(),
    };
    this.paused = false;
    this.d.broadcast(this.welcome());
    const interval = this.d.tickIntervalMs ?? 100;
    if (interval > 0) this.timer = setInterval(() => this.loop(), interval);
    return null;
  }

  private replayRow(row: TraceRow) {
    const st = this.replay!;
    const r = { ...row, episodeId: st.replayId };
    st.rows.set(r.id, r);
    this.d.broadcast({ type: 'trace', episodeId: st.replayId, row: r });
  }

  private replayLoop(): void {
    const st = this.replay!;
    if (!this.paused && !st.done) {
      let seqBefore = st.engine.events.length ? st.engine.events[st.engine.events.length - 1].seq : 0;
      for (const input of st.inputs.get(st.tick) ?? []) applyInput(st.engine, input);
      for (const row of st.traceRows.get(st.tick) ?? []) this.replayRow(row);
      if (st.tick < st.finalTick) {
        st.engine.step();
        st.tick++;
      } else {
        st.done = true;
        this.finishReplay();
      }
      for (const e of st.engine.eventsSince(seqBefore).filter((x) => x.seq > seqBefore)) {
        seqBefore = e.seq;
        for (const b of bubblesForEvent(e)) this.d.broadcast({ type: 'bubble', episodeId: st.replayId, ...b });
      }
    }
    this.d.broadcast({ type: 'snapshot', episodeId: st.replayId, snapshot: this.snapshot() });
  }

  private finishReplay() {
    const st = this.replay!;
    const hash = st.engine.hash();
    let summary: string;
    if (!st.footer) summary = `REPLAY finished; the run log has no footer so the final state cannot be verified (hash ${hash})`;
    else if (st.footer.hash === hash && st.footer.eventCount === st.engine.events.length)
      summary = `REPLAY verified: re-simulated state matches the recorded run (hash ${hash}, ${st.engine.events.length} events)`;
    else
      summary = `REPLAY DIVERGED from the recorded run: hash ${hash} vs recorded ${st.footer.hash}; events ${st.engine.events.length} vs ${st.footer.eventCount}`;
    this.replayRow({
      id: `${st.replayId}:verify`,
      episodeId: st.replayId,
      kind: 'engine',
      origin: 'Replay',
      status: st.footer && st.footer.hash === hash ? 'info' : 'failed',
      summary,
      simTime: st.engine.snapshot().simTime,
      wallTime: Date.now(),
    });
    const result = st.engine.result() ?? st.recordedResult;
    if (result) this.d.broadcast({ type: 'episode_end', episodeId: st.replayId, result });
  }
}
