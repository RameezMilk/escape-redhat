// Authoritative, deterministic simulation for Escape from Red Hat (gameplay v2).
// Pure TypeScript: no timers, no I/O, no Math.random. One instance = one episode.
//
// v2 rules: fire spreads cell-by-cell (separate seeded RNG stream) and burns out into impassable debris; anyone it
// reaches is lost. Electrical failures disable interior sliding doors (impassable, opaque, stop fire). A manual pull
// station alarm alerts everyone. There is no time limit: an episode ends on verified success, partial (someone lost,
// survivors accounted for), failed (everyone lost), or a safety stop (decision cap / headless stall ceiling).
import {
  ACTOR_IDS,
  ACTOR_PROFILES,
  TOOL_ARG_SCHEMAS,
  TOOL_NAMES,
  type ActorId,
  type ActorSnapshot,
  type ActorStatus,
  type AlarmStation,
  type DecisionMeta,
  type DecisionNote,
  type Dir,
  type DoorComponent,
  type Engine,
  type EngineOptions,
  type EpisodeOutcome,
  type EpisodeResult,
  type ErrorCode,
  type HazardKind,
  type HazardSnapshot,
  type MapData,
  type NormalizedToolCall,
  type OutcomeStatus,
  type Phase,
  type PlacementResult,
  type PlannerView,
  type ScenarioCase,
  type ScheduledEvent,
  type Snapshot,
  type Tile,
  type ToolArgs,
  type ToolName,
  type ToolResult,
  type WorldEvent,
  type WorldEventType,
  type ZoneId,
} from '@escape/contracts';
import { hashValue, canonicalJson } from './hash.js';
import { SITE_PLAN, ruleSources, type PlanSectionId } from './knowledge.js';
import { inBounds, inEarshot, tileDistance, tileIndex, zoneAt } from './map.js';
import { findPath, lineOfSight, type NavMask } from './nav.js';
import { HAZARD_SPECS, isFlammable, validatePlacement } from './placement.js';
import { mulberry32 } from './rng.js';
import { computeResult, type ActionLogEntry, type Interruption } from './scoring.js';

export const SPEED_TILES_PER_SEC = 3;
/** "Moderate" fire: per-tick probability that a burning cell tries to ignite one random neighbour. */
export const FIRE_SPREAD_PER_TICK = 0.018;
/** Probability that a spread attempt onto a doorway tile succeeds (doorways slow fire). */
export const DOOR_IGNITION_FACTOR = 0.3;
/** Each cell burns for a seeded duration in this tick range, then becomes charred debris. */
export const FIRE_BURN_TICKS: readonly [number, number] = [400, 600];
/** People see burning/charred cells within this many tiles (with line of sight). */
export const FIRE_SIGHT_RADIUS = HAZARD_SPECS.fire.visibility;
const SMOKE_DELAY_SEC = 15;
const NEARBY_RADIUS = 6;
const DUPLICATE_NOTIFY_WINDOW_SEC = 5;
const FIRE_ADJACENT_EXTRA_COST = 4;

const AMBIENT_LINES: Record<ActorId, string[]> = {
  alex: ['Badge printer is jammed again…', 'Who booked the lobby for 4pm?', 'Checking the visitor list.', 'Coffee refill time.'],
  maya: ['These slides need one more chart.', 'Has anyone seen my stylus?', 'Demo dry-run in ten!', 'Ooh, snacks arrived.'],
  daniel: ['Nice office — where is the whiteboard?', 'Wi-Fi password, anyone?', 'Taking notes for the team.', 'This chair has great wheels… oh wait.'],
};

const MOORE: readonly [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

interface Hazard {
  id: string;
  kind: HazardKind;
  col: number;
  row: number;
  placedAtTick: number;
  placedAtSimTime: number;
  evidenceId: string | null;
  /** Fire: initial seed cells. Electrical: the door tiles. */
  seed: number[];
  /** Fire: burning cell → tick at which it burns out. */
  burning: Map<number, number>;
  /** Fire: burnt-out cells (impassable debris). */
  charred: Set<number>;
  /** Electrical: disabled door tiles. */
  doorIdx: number[];
  componentId?: string;
}

interface Evidence {
  id: string;
  hazardId: string;
  kind: HazardKind;
  zone: ZoneId | null;
  observedBy: ActorId;
  at: number;
  knownBy: ActorId[];
  via: 'sight' | 'smoke';
  componentId?: string;
  /** Zones already reported to the planner (knowledge-level spread news). */
  reportedZones: Set<ZoneId>;
}

interface Task {
  kind: 'move' | 'ambient';
  actionId?: string;
  decisionId?: string;
  destination: string;
  routeId?: string;
  target: Tile;
  path: Tile[];
  progress: number;
  traversed: number;
  total: number;
  follower?: ActorId;
  stopAfterStep?: { hazardId: string };
}

interface ActorState {
  id: ActorId;
  col: number;
  row: number;
  dir: Dir;
  pose: 'sit' | 'stand';
  alerted: boolean;
  alertedAt: number | null;
  commanded: boolean;
  knows: string[];
  /** Per evidence id: cell indices this person has seen (or been told) are burning / charred / disabled. */
  known: Map<string, Set<number>>;
  revision: number;
  checkedIn: boolean;
  escort: { role: 'leader' | 'follower'; partner: ActorId } | null;
  task: Task | null;
  ambientNextTick: number;
  zone: ZoneId | null;
  lost: boolean;
  lostAt: number | null;
}

interface Route {
  id: string;
  actor: ActorId;
  destination: string;
  path: Tile[];
  start: Tile;
  target: Tile;
  zones: ZoneId[];
  revision: number;
  accessible: boolean;
}

interface PendingScheduled {
  ev: ScheduledEvent;
  triggeredAtTick: number | null;
  done: boolean;
  failed: boolean;
}

type Fail = { ok: false; actionId: string; error: { code: ErrorCode; message: string; hint?: string; details?: Record<string, unknown> } };

const dirBetween = (from: Tile, to: Tile): Dir => {
  const dc = to.col - from.col;
  const dr = to.row - from.row;
  if (Math.abs(dc) >= Math.abs(dr)) return dc > 0 ? 'right' : dc < 0 ? 'left' : 'down';
  return dr > 0 ? 'down' : 'up';
};
const sameTile = (a: Tile, b: Tile) => a.col === b.col && a.row === b.row;
const name = (id: ActorId) => ACTOR_PROFILES[id].name;
const pad3 = (n: number) => String(n).padStart(3, '0');
const round2 = (n: number) => Math.round(n * 100) / 100;
const isActorId = (x: unknown): x is ActorId => typeof x === 'string' && (ACTOR_IDS as readonly string[]).includes(x);

export function createEngine(map: MapData, scenario: ScenarioCase, opts: EngineOptions): Engine {
  const tickMs = opts.tickMs ?? 100;
  const maxDecisions = opts.maxDecisions ?? 60;
  const stallCeiling = opts.stallCeilingSimSec;
  const spreadP = opts.fireSpreadPerTick ?? FIRE_SPREAD_PER_TICK;
  const ambientOn = opts.ambient ?? true;
  const seed = opts.seed ?? scenario.seed;
  const rng = mulberry32(seed);
  /** Separate stream so fire behaviour never perturbs ambient behaviour (and vice versa). */
  const spreadRng = mulberry32((seed ^ 0x5f17e) >>> 0);
  const speedPerTick = (SPEED_TILES_PER_SEC * tickMs) / 1000;
  const idx = (t: Tile) => tileIndex(map, t.col, t.row);
  const tileOf = (i: number): Tile => ({ col: i % map.cols, row: Math.floor(i / map.cols) });
  const components: DoorComponent[] = map.components ?? [];
  const stations: AlarmStation[] = map.alarms ?? [];
  const doorTiles = new Set<number>((map.components ?? []).flatMap((d) => d.tiles.map((t) => tileIndex(map, t.col, t.row))));

  // ------------------------------------------------------------------ state
  let tick = 0;
  let phase: Phase = 'idle';
  let incidentAt: number | null = null;
  let outcome: EpisodeOutcome | null = null;
  let rosterVerified = false;
  let hazardSeq = 0;
  let evidenceSeq = 0;
  let routeSeq = 0;
  let decisionsUsed = 0;
  let lastViewedSeq = 0;
  let endedAtWall: number | undefined;
  const hazards: Hazard[] = [];
  const evidence: Evidence[] = [];
  const routes: Route[] = [];
  const requests: { person: ActorId; helper: ActorId; at: number }[] = [];
  const escorts: { leader: ActorId; follower: ActorId; at: number; fulfilled: boolean }[] = [];
  const events: WorldEvent[] = [];
  const actionLog: ActionLogEntry[] = [];
  const interruptions: Interruption[] = [];
  const decisionMeta = new Map<string, { latencyMs?: number; promptTokens?: number; completionTokens?: number }>();
  const resultCache = new Map<string, ToolResult>();
  const actionIdsUsed = new Set<string>();
  const counters = { knownHazardMoveAttempts: 0, prematureVerifyAttempts: 0, assistWithoutConsentAttempts: 0, scheduledFailures: 0 };
  const lastNotify: { key: string; at: number }[] = [];
  const alarm: { active: boolean; at?: number; by?: ActorId; stationId?: string } = { active: false };

  // Real (ground-truth) cell state
  const burningOwner = new Map<number, Hazard>();
  const charredOwner = new Map<number, Hazard>();
  const disabledDoor = new Map<number, Hazard>();
  /** Disabled door tiles as a set (opaque for line of sight). */
  const doorOpaque = new Set<number>();
  /** Union of everything impassable: burning ∪ charred ∪ disabled doors. */
  const realBlocked = new Set<number>();
  const ownerOf = (i: number) => burningOwner.get(i) ?? charredOwner.get(i) ?? disabledDoor.get(i);
  /** Union over all people of known cells, per evidence (for the compact planner view). */
  const unionKnown = new Map<string, Set<number>>();

  const simTime = () => round2((tick * tickMs) / 1000);

  const actors: Record<ActorId, ActorState> = {} as Record<ActorId, ActorState>;
  for (const id of ACTOR_IDS) {
    const s = scenario.spawns[id];
    actors[id] = {
      id,
      col: s.col,
      row: s.row,
      dir: s.dir,
      pose: s.pose,
      alerted: false,
      alertedAt: null,
      commanded: false,
      knows: [],
      known: new Map(),
      revision: 0,
      checkedIn: false,
      escort: null,
      task: null,
      ambientNextTick: rng.int(30, 90),
      zone: zoneAt(map, s.col, s.row),
      lost: false,
      lostAt: null,
    };
  }
  const living = () => ACTOR_IDS.filter((id) => !actors[id].lost);

  const scheduled: PendingScheduled[] = scenario.events
    .filter((e) => e.trigger.type !== 'manual')
    .map((ev) => ({ ev, triggeredAtTick: null, done: false, failed: false }));

  function emit(type: WorldEventType, data: Record<string, unknown>, extra: Partial<WorldEvent> = {}): WorldEvent {
    const ev: WorldEvent = { seq: events.length + 1, tick, simTime: simTime(), type, data, ...extra };
    events.push(ev);
    return ev;
  }

  emit('episode_started', { caseId: scenario.caseId, seed: scenario.seed, mapId: map.id, danielPreference: scenario.danielPreference });

  // ------------------------------------------------------------------ helpers
  const usesAccessible = (a: ActorState) => ACTOR_PROFILES[a.id].usesWheelchair || a.escort !== null;
  const maskFor = (a: ActorState): NavMask => (usesAccessible(a) ? 'accessible' : 'walkable');
  const knownNoGo = (...ids: ActorId[]) => {
    const s = new Set<number>();
    for (const id of ids) for (const cells of actors[id].known.values()) for (const i of cells) s.add(i);
    return s;
  };
  /** Soft cost for tiles next to known fire (keeps routes away from the flames' edge). */
  const fireAdjacentCost = (ids: ActorId[], blocked: Set<number>) => {
    const extra = new Map<number, number>();
    for (const id of ids) {
      for (const [eid, cells] of actors[id].known) {
        if (evidenceById(eid)?.kind !== 'fire') continue;
        for (const i of cells) {
          const c = i % map.cols;
          const r = Math.floor(i / map.cols);
          for (const [dc, dr] of MOORE) {
            if (!inBounds(map, c + dc, r + dr)) continue;
            const j = tileIndex(map, c + dc, r + dr);
            if (!blocked.has(j)) extra.set(j, FIRE_ADJACENT_EXTRA_COST);
          }
        }
      }
    }
    return extra;
  };
  const evidenceById = (eid: string) => evidence.find((x) => x.id === eid);
  const isMoving = (a: ActorState): boolean => {
    if (a.task) return true;
    if (a.escort?.role === 'follower') return actors[a.escort.partner].task !== null;
    return false;
  };
  const leaderOf = (a: ActorState): ActorState => (a.escort?.role === 'follower' ? actors[a.escort.partner] : a);
  const followerOf = (a: ActorState): ActorState | null => (a.escort?.role === 'leader' ? actors[a.escort.partner] : null);
  const occupiedBy = (exclude: ActorId[]) => {
    const s = new Set<number>();
    for (const id of ACTOR_IDS) {
      if (exclude.includes(id)) continue;
      const a = actors[id];
      if (a.lost) continue;
      s.add(idx(a));
      if (a.task) s.add(idx(a.task.target));
    }
    return s;
  };
  const zonesOf = (start: Tile, path: Tile[]): ZoneId[] => {
    const out: ZoneId[] = [];
    for (const t of [start, ...path]) {
      const z = zoneAt(map, t.col, t.row);
      if (z && out[out.length - 1] !== z) out.push(z);
    }
    return out;
  };
  const describeTile = (t: Tile) => `${zoneAt(map, t.col, t.row) ?? 'outside'} (${t.col},${t.row})`;
  const hazardCells = (h: Hazard): number[] => (h.kind === 'fire' ? [...h.burning.keys(), ...h.charred] : h.doorIdx);
  const componentLabel = (id?: string) => components.find((c) => c.id === id)?.label ?? 'a sliding door';
  const zoneOfIdx = (i: number) => map.zone[i];
  const nearestStation = (t: Tile) => {
    let best: { s: AlarmStation; d: number } | null = null;
    for (const s of stations) {
      const d = tileDistance(t, s.stand);
      if (!best || d < best.d) best = { s, d };
    }
    return best;
  };

  /** Cells of hazard h that person a can see right now (seeing any part of a jammed door reveals the whole door). */
  function visibleCells(a: Tile, h: Hazard): number[] {
    const radius = HAZARD_SPECS[h.kind].visibility;
    const r2 = radius * radius;
    const out: number[] = [];
    for (const i of hazardCells(h)) {
      const c = i % map.cols;
      const r = Math.floor(i / map.cols);
      const dc = c - a.col;
      const dr = r - a.row;
      if (dc * dc + dr * dr > r2) continue;
      if (lineOfSight(map, a, { col: c, row: r }, doorOpaque)) out.push(i);
    }
    return h.kind === 'electrical' && out.length ? [...h.doorIdx] : out;
  }

  function setPhase(p: Phase) {
    if (phase === p || phase === 'ended') return;
    const from = phase;
    if (from === 'idle' && incidentAt === null) incidentAt = simTime();
    phase = p;
    emit('phase_changed', { from, to: p });
  }

  function alert(a: ActorState) {
    if (a.alerted || a.lost) return;
    a.alerted = true;
    a.alertedAt = simTime();
    if (a.task?.kind === 'ambient') {
      a.task.path = a.task.progress > 0 ? [a.task.path[0]] : [];
      if (!a.task.path.length) a.task = null;
    }
  }

  function learn(a: ActorState, e: Evidence): boolean {
    if (a.knows.includes(e.id)) return false;
    a.knows.push(e.id);
    a.revision++;
    if (!a.known.has(e.id)) a.known.set(e.id, new Set());
    if (!e.knownBy.includes(a.id)) e.knownBy.push(a.id);
    return true;
  }

  /** Record cells a person now knows about for evidence e (sight, smoke or a report). */
  function addKnown(a: ActorState, eid: string, cells: Iterable<number>) {
    let set = a.known.get(eid);
    if (!set) a.known.set(eid, (set = new Set()));
    let union = unionKnown.get(eid);
    if (!union) unionKnown.set(eid, (union = new Set()));
    for (const c of cells) {
      set.add(c);
      union.add(c);
    }
  }

  /** Actor perceives a hazard (sight or smoke). Creates evidence on the first sighting of that hazard. */
  function observeHazard(a: ActorState, h: Hazard, via: 'sight' | 'smoke', cells: number[]): Evidence | null {
    let e = h.evidenceId ? evidenceById(h.evidenceId) : undefined;
    if (!e) {
      const z = zoneOfIdx(h.seed[0]) ?? null;
      e = {
        id: `E${++evidenceSeq}`,
        hazardId: h.id,
        kind: h.kind,
        zone: z,
        observedBy: a.id,
        at: simTime(),
        knownBy: [],
        via,
        ...(h.componentId ? { componentId: h.componentId } : {}),
        reportedZones: new Set(z ? [z] : []),
      };
      evidence.push(e);
      h.evidenceId = e.id;
    }
    const isNew = learn(a, e);
    addKnown(a, e.id, cells);
    if (!isNew) return null;
    emit(
      'observation',
      { kind: h.kind, zone: e.zone, via, firstReport: e.observedBy === a.id, ...(h.componentId ? { component: h.componentId } : {}) },
      { actor: a.id, evidenceIds: [e.id] },
    );
    if (h.kind === 'fire') alert(a);
    if (phase === 'idle') setPhase('incident');
    return e;
  }

  function endEpisode(status: OutcomeStatus, reason: string) {
    if (outcome) return;
    for (const id of ACTOR_IDS) {
      const a = actors[id];
      if (a.task) {
        a.task.progress = 0;
        a.task = null;
      }
    }
    outcome = { status, reason, simTime: simTime() };
    phase = 'ended';
    emit('episode_ended', { status, reason });
  }

  /** Ground truth (never shown to the planner): survivors who cannot physically reach the assembly area. */
  function unreachableActors(): ActorId[] {
    const out: ActorId[] = [];
    for (const id of living()) {
      const a = actors[id];
      if (a.checkedIn || zoneAt(map, a.col, a.row) === 'assembly') continue;
      const p = findPath(map, a, map.assembly.tiles, { mask: maskFor(a), blocked: realBlocked });
      if (!p) out.push(id);
    }
    return out;
  }

  function endBySafetyStop(kind: 'cap' | 'stall') {
    const trapped = unreachableActors();
    const why = kind === 'cap' ? `decision cap (${maxDecisions}) reached` : 'stalled (headless safety stop)';
    if (trapped.length) {
      endEpisode('unresolved', `No safe route to the assembly point existed for ${trapped.map(name).join(', ')} given the actual hazards (${why}).`);
      return;
    }
    const outstanding = living().filter((id) => !actors[id].checkedIn);
    const detail = outstanding.length ? `not checked in: ${outstanding.map(name).join(', ')}` : rosterVerified ? 'roster verified' : 'roster not verified by the warden';
    endEpisode('incomplete', `${kind === 'cap' ? `Decision cap (${maxDecisions}) reached` : 'Stalled'}; ${detail}.`);
  }

  function checkCap() {
    if (!outcome && decisionsUsed >= maxDecisions) endBySafetyStop('cap');
  }

  /** Terminal conditions that do not need a tool call. */
  function checkEnd() {
    if (outcome) return;
    const alive = living();
    if (!alive.length) {
      endEpisode('failed', 'Everyone was lost to the fire.');
      return;
    }
    const lost = ACTOR_IDS.filter((id) => actors[id].lost);
    if (actors.alex.lost && lost.length && alive.every((id) => actors[id].checkedIn)) {
      endEpisode(
        'partial',
        `${alive.map(name).join(' and ')} reached the assembly point and checked in; ${lost.map(name).join(' and ')} ${lost.length > 1 ? 'were' : 'was'} lost to the fire (no warden left to verify the roster).`,
      );
      return;
    }
    if (stallCeiling !== undefined && incidentAt !== null && simTime() - incidentAt >= stallCeiling) endBySafetyStop('stall');
  }

  // ------------------------------------------------------------------ hazards
  function hazardSnapshots(): HazardSnapshot[] {
    return hazards.map((h) => {
      const cells = (h.kind === 'fire' ? [...h.burning.keys()] : h.doorIdx).slice().sort((x, y) => x - y).map(tileOf);
      const charred = [...h.charred].sort((x, y) => x - y).map(tileOf);
      return {
        id: h.id,
        kind: h.kind,
        col: h.col,
        row: h.row,
        cells,
        charred,
        noGo: [...cells, ...charred],
        ...(h.componentId ? { componentId: h.componentId } : {}),
        placedAtSimTime: h.placedAtSimTime,
      };
    });
  }

  function ignite(h: Hazard, i: number) {
    h.burning.set(i, tick + spreadRng.int(FIRE_BURN_TICKS[0], FIRE_BURN_TICKS[1]));
    burningOwner.set(i, h);
    realBlocked.add(i);
  }

  function placeHazard(kind: HazardKind, col: number, row: number): PlacementResult {
    if (outcome) return { ok: false, code: 'EPISODE_OVER', reason: 'The episode has ended. Reset to start again.' };
    if (kind !== 'fire' && kind !== 'electrical') return { ok: false, code: 'NOT_PLACEABLE_ZONE', reason: `Unknown hazard kind '${String(kind)}'.` };
    const v = validatePlacement(map, { hazards: hazardSnapshots(), actors: ACTOR_IDS.map((id) => actors[id]) }, kind, col, row);
    if (!v.ok) return v;
    const cells = v.tiles.map(idx);
    const h: Hazard = {
      id: `H${++hazardSeq}`,
      kind,
      col: kind === 'fire' ? col : v.tiles[0].col,
      row: kind === 'fire' ? row : v.tiles[0].row,
      placedAtTick: tick,
      placedAtSimTime: simTime(),
      evidenceId: null,
      seed: cells,
      burning: new Map(),
      charred: new Set(),
      doorIdx: kind === 'electrical' ? cells : [],
      ...(v.componentId ? { componentId: v.componentId } : {}),
    };
    hazards.push(h);
    if (kind === 'fire') for (const i of cells) ignite(h, i);
    else
      for (const i of cells) {
        disabledDoor.set(i, h);
        doorOpaque.add(i);
        realBlocked.add(i);
      }
    const event = emit(
      kind === 'fire' ? 'hazard_placed' : 'door_disabled',
      { hazardId: h.id, kind, col: h.col, row: h.row, tiles: v.tiles.map((t) => [t.col, t.row]), ...(v.componentId ? { component: v.componentId } : {}) },
    );
    // Anyone mid-step INTO a newly blocked tile steps back (stays on their current safe tile).
    for (const id of ACTOR_IDS) {
      const t = actors[id].task;
      if (t && t.path.length && cells.includes(idx(t.path[0]))) t.progress = 0;
    }
    return { ok: true, hazardId: h.id, event };
  }

  // ------------------------------------------------------------------ fire spread
  const staticNeighbours = new Map<number, number[]>();
  function spreadCandidates(i: number): number[] {
    let list = staticNeighbours.get(i);
    if (list) return list;
    list = [];
    const c = i % map.cols;
    const r = Math.floor(i / map.cols);
    for (const [dc, dr] of MOORE) {
      if (!isFlammable(map, c + dc, r + dr)) continue;
      const j = tileIndex(map, c + dc, r + dr);
      list.push(j);
      if (!map.walkable[j]) list.push(j); // furniture counts double (fuel)
    }
    staticNeighbours.set(i, list);
    return list;
  }
  /** Diagonal spread may not cut a corner where both orthogonal intermediates are walls/closed doors. */
  function cornerOpen(from: number, to: number): boolean {
    const fc = from % map.cols;
    const fr = Math.floor(from / map.cols);
    const tc = to % map.cols;
    const tr = Math.floor(to / map.cols);
    if (fc === tc || fr === tr) return true;
    const passes = (c: number, r: number) => isFlammable(map, c, r) && !disabledDoor.has(tileIndex(map, c, r));
    return passes(tc, fr) || passes(fc, tr);
  }

  function stepFire() {
    for (const h of hazards) {
      if (h.kind !== 'fire' || !h.burning.size) continue;
      for (const [i, burnout] of [...h.burning]) {
        if (tick >= burnout) {
          h.burning.delete(i);
          burningOwner.delete(i);
          h.charred.add(i);
          charredOwner.set(i, h);
          continue;
        }
        if (spreadRng.next() >= spreadP) continue;
        const cand = spreadCandidates(i);
        if (!cand.length) continue;
        const j = cand[Math.floor(spreadRng.next() * cand.length)];
        if (realBlocked.has(j) || !cornerOpen(i, j)) continue;
        // Doorways slow the spread (frames/thresholds): ignition onto a door tile succeeds 30% of the time.
        if (doorTiles.has(j) && spreadRng.next() >= DOOR_IGNITION_FACTOR) continue;
        ignite(h, j);
      }
    }
  }

  // ------------------------------------------------------------------ losses
  function loseActor(a: ActorState) {
    if (a.lost) return;
    const t = a.task;
    a.lost = true;
    a.lostAt = simTime();
    if (t) {
      t.progress = 0;
      a.task = null;
      if (t.kind === 'move') {
        emit(
          'move_interrupted',
          { code: 'ACTOR_LOST', destination: t.destination, partial_tiles: t.traversed, total_tiles: t.total, stopped_at: [a.col, a.row], zone: zoneAt(map, a.col, a.row), hazard_kind: 'fire', evidence: null, with: t.follower ?? null },
          { actor: a.id, actionId: t.actionId, decisionId: t.decisionId },
        );
      }
    }
    if (a.escort) {
      const p = actors[a.escort.partner];
      p.escort = null;
      a.escort = null;
    }
    emit('actor_lost', { cause: 'fire', tile: [a.col, a.row], zone: zoneAt(map, a.col, a.row) }, { actor: a.id });
  }

  function checkLosses() {
    for (const id of ACTOR_IDS) {
      const a = actors[id];
      if (a.lost) continue;
      let hit = burningOwner.has(idx(a));
      const t = a.task;
      if (!hit && t && t.path.length && t.progress > 0.5 && burningOwner.has(idx(t.path[0]))) hit = true;
      if (hit) loseActor(a);
    }
  }

  // ------------------------------------------------------------------ movement
  function startTask(a: ActorState, task: Task) {
    a.task = task;
    a.pose = 'stand';
    const f = task.follower ? actors[task.follower] : null;
    if (f) f.pose = 'stand';
  }

  function interrupt(a: ActorState, h: Hazard) {
    const t = a.task!;
    t.progress = 0;
    a.task = null;
    if (t.kind === 'ambient') return;
    const e = h.evidenceId ? evidenceById(h.evidenceId) : undefined;
    const data = {
      code: 'ROUTE_UNAVAILABLE',
      destination: t.destination,
      partial_tiles: t.traversed,
      total_tiles: t.total,
      stopped_at: [a.col, a.row],
      zone: zoneAt(map, a.col, a.row),
      hazard_kind: h.kind,
      hazard_zone: e?.zone ?? zoneOfIdx(h.seed[0]),
      ...(h.componentId ? { component: h.componentId } : {}),
      evidence: e?.id ?? null,
      with: t.follower ?? null,
    };
    emit('move_interrupted', data, { actor: a.id, actionId: t.actionId, decisionId: t.decisionId, evidenceIds: e ? [e.id] : [] });
    interruptions.push({
      actor: a.id,
      partner: t.follower,
      decisionIndex: decisionsUsed,
      simTime: simTime(),
      evidenceId: e?.id ?? null,
      zone: e?.zone ?? null,
      hazardKind: h.kind,
      ...(h.componentId ? { component: h.componentId } : {}),
    });
  }

  function arrive(a: ActorState, t: Task) {
    const next = t.path.shift()!;
    const prev = { col: a.col, row: a.row };
    a.dir = dirBetween(prev, next);
    a.col = next.col;
    a.row = next.row;
    t.progress -= 1;
    t.traversed++;
    const f = t.follower ? actors[t.follower] : null;
    if (f && !f.lost) {
      f.dir = dirBetween(f, prev);
      f.col = prev.col;
      f.row = prev.row;
    }
    for (const m of f && !f.lost ? [a, f] : [a]) {
      const z = zoneAt(map, m.col, m.row);
      if (z !== m.zone) {
        m.zone = z;
        onZoneEnter(m.id, z);
      }
    }
  }

  function completeTask(a: ActorState) {
    const t = a.task!;
    a.task = null;
    t.progress = 0;
    if (t.kind === 'ambient') {
      const spot = map.spawnSpots[a.id].find((s) => s.col === a.col && s.row === a.row);
      a.pose = spot?.pose ?? 'stand';
      a.dir = spot?.dir ?? 'down';
      if (rng.next() < 0.35) emit('ambient_line', { text: rng.pick(AMBIENT_LINES[a.id]), authored: true }, { actor: a.id });
      return;
    }
    emit(
      'move_completed',
      { destination: t.destination, tiles: t.traversed, at: [a.col, a.row], zone: zoneAt(map, a.col, a.row), with: t.follower ?? null },
      { actor: a.id, actionId: t.actionId, decisionId: t.decisionId },
    );
  }

  /** Stop before entering any really-blocked cell that the mover (or their follower) knows about, or that is next. */
  function checkPath(a: ActorState, t: Task): boolean {
    const f = t.follower ? actors[t.follower] : null;
    for (let k = 0; k < t.path.length; k++) {
      const i = idx(t.path[k]);
      if (!realBlocked.has(i)) continue;
      const h = ownerOf(i)!;
      const knows = (x: ActorState | null) => !!x && !x.lost && [...x.known.values()].some((s) => s.has(i));
      const nextBlocked = k === 0;
      if (!(knows(a) || knows(f) || nextBlocked)) continue;
      if (nextBlocked && !knows(a)) observeHazard(a, h, 'sight', h.kind === 'electrical' ? [...h.doorIdx] : [i]);
      if (nextBlocked || t.progress === 0) {
        interrupt(a, h);
      } else {
        // Finish the step onto the (safe) next tile, then stop.
        t.path = [t.path[0]];
        t.stopAfterStep = { hazardId: h.id };
      }
      return !a.task;
    }
    return false;
  }

  function stepMovement() {
    for (const id of ACTOR_IDS) {
      const a = actors[id];
      const t = a.task;
      if (!t || a.lost) continue;
      if (!t.stopAfterStep && checkPath(a, t)) continue;
      if (!t.path.length) {
        completeTask(a);
        continue;
      }
      t.progress += speedPerTick;
      if (t.progress >= 1) {
        arrive(a, t);
        if (t.stopAfterStep) {
          const h = hazards.find((x) => x.id === t.stopAfterStep!.hazardId);
          if (h) {
            interrupt(a, h);
            continue;
          }
          t.stopAfterStep = undefined;
        }
        if (!t.path.length) completeTask(a);
        else checkPath(a, t);
      }
    }
  }

  // ------------------------------------------------------------------ perception + smoke
  function stepPerception() {
    for (const id of ACTOR_IDS) {
      const a = actors[id];
      if (a.lost) continue;
      for (const h of hazards) {
        const cells = visibleCells(a, h);
        if (!cells.length) continue;
        if (h.evidenceId && a.knows.includes(h.evidenceId)) addKnown(a, h.evidenceId, cells);
        else observeHazard(a, h, 'sight', cells);
      }
    }
    // Smoke: a fire nobody has noticed for 15 s is smelled by the nearest person (by path).
    for (const h of hazards) {
      if (h.kind !== 'fire' || h.evidenceId) continue;
      if ((tick - h.placedAtTick) * tickMs < SMOKE_DELAY_SEC * 1000) continue;
      const cells = hazardCells(h);
      const own = new Set(cells);
      const around = new Set<number>();
      for (const i of cells) {
        const c = i % map.cols;
        const r = Math.floor(i / map.cols);
        for (const [dc, dr] of MOORE) {
          if (!inBounds(map, c + dc, r + dr)) continue;
          const j = tileIndex(map, c + dc, r + dr);
          if (!own.has(j) && map.walkable[j]) around.add(j);
        }
      }
      let best: { id: ActorId; d: number } | null = null;
      for (const id of living()) {
        const a = actors[id];
        const p = findPath(map, a, (i) => around.has(i), { mask: 'walkable', blocked: realBlocked });
        const d = p ? p.length : 1000 + tileDistance(a, tileOf(cells[0]));
        if (!best || d < best.d) best = { id, d };
      }
      if (best) observeHazard(actors[best.id], h, 'smoke', h.seed.filter((i) => realBlocked.has(i)));
    }
    // Knowledge-level spread news: a known fire reaching a new zone (from KNOWN cells only — never ground truth).
    for (const e of evidence) {
      if (e.kind !== 'fire') continue;
      const u = unionKnown.get(e.id);
      if (!u) continue;
      const fresh: ZoneId[] = [];
      for (const i of u) {
        const z = zoneOfIdx(i);
        if (z && !e.reportedZones.has(z)) {
          e.reportedZones.add(z);
          fresh.push(z);
        }
      }
      for (const z of fresh) emit('fire_spread', { evidence: e.id, zone: z, cells_known: u.size }, { evidenceIds: [e.id] });
    }
  }

  // ------------------------------------------------------------------ ambient idle behaviour
  function stepAmbient() {
    if (!ambientOn) return;
    for (const id of ACTOR_IDS) {
      const a = actors[id];
      if (a.lost || a.alerted || a.checkedIn || a.task || a.escort || tick < a.ambientNextTick) continue;
      a.ambientNextTick = tick + rng.int(60, 150);
      const occupied = occupiedBy([id]);
      const spots = map.activitySpots[id].filter((s) => !sameTile(s, a) && !occupied.has(idx(s)) && !realBlocked.has(idx(s)));
      if (!spots.length) continue;
      const spot = rng.pick(spots);
      const path = findPath(map, a, [spot], { mask: maskFor(a), blocked: realBlocked });
      if (!path || !path.length) continue;
      startTask(a, { kind: 'ambient', destination: 'activity', target: spot, path, progress: 0, traversed: 0, total: path.length });
    }
  }

  // ------------------------------------------------------------------ scheduled presenter events
  function onZoneEnter(actor: ActorId, zone: ZoneId | null) {
    if (phase === 'idle' || !zone) return;
    for (const s of scheduled) {
      const tr = s.ev.trigger;
      if (s.triggeredAtTick !== null || tr.type !== 'actor_enters_zone') continue;
      if ((tr.actor === 'any' || tr.actor === actor) && tr.zone === zone) s.triggeredAtTick = tick;
    }
  }

  function stepScheduled() {
    for (const s of scheduled) {
      if (s.done) continue;
      const tr = s.ev.trigger;
      if (s.triggeredAtTick === null && tr.type === 'at_time' && simTime() >= tr.simTime) s.triggeredAtTick = tick;
      if (s.triggeredAtTick === null) continue;
      const r = placeHazard(s.ev.action.kind, s.ev.action.col, s.ev.action.row);
      if (r.ok) s.done = true;
      else if ((tick - s.triggeredAtTick) * tickMs > 3000) {
        s.done = true;
        s.failed = true;
        counters.scheduledFailures++;
      }
    }
  }

  // ------------------------------------------------------------------ step
  function step(): WorldEvent[] {
    if (outcome) return [];
    const before = events.length;
    tick++;
    stepScheduled();
    stepFire();
    checkLosses();
    stepPerception();
    stepMovement();
    checkLosses();
    stepAmbient();
    if (!outcome && (phase === 'incident' || phase === 'evacuating')) {
      const alive = living();
      if (alive.length && alive.every((id) => actors[id].checkedIn || zoneAt(map, actors[id].col, actors[id].row) === 'assembly')) setPhase('accounting');
    }
    checkEnd();
    return events.slice(before);
  }

  // ------------------------------------------------------------------ tools
  const fail = (actionId: string, code: ErrorCode, message: string, hint?: string, details?: Record<string, unknown>): Fail => ({
    ok: false,
    actionId,
    error: { code, message, ...(hint ? { hint } : {}), ...(details ? { details } : {}) },
  });

  /** 'alarm' = nearest pull station; a station id (alarm_corridor) = that station. */
  const isAlarmDest = (d: string) => d === 'alarm' || stations.some((s) => s.id === d);

  /** Candidate target tiles for a destination (zone, person or 'alarm'), excluding occupied/claimed/known-blocked tiles. */
  function targetsFor(destination: string, movers: ActorId[], mask: NavMask, blocked: Set<number>): Tile[] {
    const occupied = occupiedBy(movers);
    const ok = (t: Tile) => {
      const i = idx(t);
      return (mask === 'accessible' ? map.accessible[i] : map.walkable[i]) && !occupied.has(i) && !blocked.has(i);
    };
    if (isAlarmDest(destination)) return stations.filter((s) => destination === 'alarm' || s.id === destination).map((s) => s.stand).filter(ok);
    if (isActorId(destination)) {
      const p = actors[destination];
      const out: Tile[] = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dc && !dr) continue;
          const t = { col: p.col + dc, row: p.row + dr };
          if (inBounds(map, t.col, t.row) && ok(t)) out.push(t);
        }
      }
      if (ACTOR_PROFILES[p.id].usesWheelchair) {
        const acc = out.filter((t) => map.accessible[idx(t)]);
        if (acc.length) return acc;
      }
      return out;
    }
    const tiles: Tile[] = [];
    for (let r = 0; r < map.rows; r++) for (let c = 0; c < map.cols; c++) if (map.zone[tileIndex(map, c, r)] === destination && ok({ col: c, row: r })) tiles.push({ col: c, row: r });
    const visible = tiles.filter((t) => !map.occluded[idx(t)]);
    return visible.length ? visible : tiles;
  }

  /** For an escorted pair heading to a zone, extend the path (up to 3 tiles) so the follower also ends inside the
   *  zone and not on a tile someone else is standing on / heading to. */
  function extendForFollower(start: Tile, path: Tile[], destination: string, movers: ActorId[], blocked: Set<number>) {
    if (!path.length || isActorId(destination) || isAlarmDest(destination)) return;
    const occupied = occupiedBy(movers);
    for (let step = 0; step < 3; step++) {
      const followerEnd = path.length >= 2 ? path[path.length - 2] : start;
      if (zoneAt(map, followerEnd.col, followerEnd.row) === destination && !occupied.has(idx(followerEnd))) return;
      const last = path[path.length - 1];
      let extended = false;
      for (const [dc, dr] of [
        [0, 1],
        [1, 0],
        [-1, 0],
        [0, -1],
      ]) {
        const n = { col: last.col + dc, row: last.row + dr };
        if (!inBounds(map, n.col, n.row)) continue;
        const i = idx(n);
        if (zoneAt(map, n.col, n.row) !== destination || !map.accessible[i] || occupied.has(i) || blocked.has(i)) continue;
        if (path.some((p) => sameTile(p, n)) || sameTile(n, start)) continue;
        path.push(n);
        extended = true;
        break;
      }
      if (!extended) return;
    }
  }

  function planFor(a: ActorState, destination: string): { path: Tile[]; mask: NavMask; blockedKnown: Set<number>; movers: ActorId[]; start: Tile } | null {
    const leader = leaderOf(a);
    const follower = followerOf(leader);
    const movers = follower && !follower.lost ? [leader.id, follower.id] : [leader.id];
    const mask: NavMask = movers.length > 1 || ACTOR_PROFILES[leader.id].usesWheelchair ? 'accessible' : 'walkable';
    const blockedKnown = knownNoGo(...movers);
    const targets = targetsFor(destination, movers, mask, blockedKnown);
    if (!targets.length) return null;
    const start = { col: leader.col, row: leader.row };
    const path = findPath(map, start, targets, { mask, blocked: blockedKnown, extraCost: fireAdjacentCost(movers, blockedKnown) });
    if (!path) return null;
    if (movers.length > 1) extendForFollower(start, path, destination, movers, blockedKnown);
    return { path, mask, blockedKnown, movers, start };
  }

  function knownHazardSummary(ids: ActorId[]): string {
    const known = new Set<string>();
    for (const id of ids) for (const e of actors[id].knows) known.add(e);
    if (!known.size) return 'none';
    return [...known]
      .map((eid) => {
        const e = evidenceById(eid);
        if (!e) return eid;
        if (e.kind === 'electrical') return `${eid} (${componentLabel(e.componentId)} stuck closed)`;
        const zones = new Set<string>();
        for (const id of ids) for (const i of actors[id].known.get(eid) ?? []) zones.add(zoneOfIdx(i) ?? '?');
        return `${eid} (fire in ${[...zones].join(', ') || e.zone})`;
      })
      .join(', ');
  }

  function toolObserve(actionId: string, args: ToolArgs['observe']): ToolResult {
    const a = actors[args.actor_id];
    const seen: { h: Hazard; cells: number[] }[] = [];
    for (const h of hazards) {
      const cells = visibleCells(a, h);
      if (!cells.length) continue;
      if (h.evidenceId && a.knows.includes(h.evidenceId)) addKnown(a, h.evidenceId, cells);
      else observeHazard(a, h, 'sight', cells);
      seen.push({ h, cells });
    }
    const z = zoneAt(map, a.col, a.row);
    const neighbours = map.zoneEdges.filter(([x, y]) => x === z || y === z).map(([x, y]) => (x === z ? y : x));
    const connections = neighbours.map((nz) => {
      const hits = a.knows.filter((eid) => [...(a.known.get(eid) ?? [])].some((i) => zoneOfIdx(i) === nz));
      return { zone: nz, known_hazards: hits, status: hits.length ? `hazard ${hits.join(', ')} known there` : 'no known hazard' };
    });
    const nearby = living()
      .filter((id) => id !== a.id && tileDistance(a, actors[id]) <= NEARBY_RADIUS)
      .map((id) => ({ id, zone: zoneAt(map, actors[id].col, actors[id].row), distance: round2(tileDistance(a, actors[id])) }));
    const vis = seen.map(({ h, cells }) => ({
      evidence_id: h.evidenceId,
      kind: h.kind,
      zone: zoneOfIdx(cells[0]),
      cells_visible: cells.length,
      distance: round2(Math.min(...cells.map((i) => tileDistance(a, tileOf(i))))),
      ...(h.componentId ? { component: h.componentId } : {}),
    }));
    const st = nearestStation(a);
    return {
      ok: true,
      actionId,
      status: 'completed',
      data: {
        actor: a.id,
        zone: z,
        tile: [a.col, a.row],
        visible_hazards: vis,
        nearby_people: nearby,
        connections,
        alarm: { active: alarm.active, nearest_station: st ? { id: st.s.id, zone: st.s.zone, distance: round2(st.d) } : null },
      },
      evidenceIds: vis.map((v) => v.evidence_id!).filter(Boolean),
    };
  }

  function toolConsultPlan(actionId: string, args: ToolArgs['consult_plan']): ToolResult {
    const sec = SITE_PLAN.sections[args.section as PlanSectionId];
    const data: Record<string, unknown> = {
      section: args.section,
      plan_title: SITE_PLAN.title,
      text: sec.text,
      rule_ids: sec.rule_ids,
      sources: ruleSources(sec.rule_ids),
    };
    if (args.section === 'routes') {
      data.route_briefing = {
        from_rh_room_primary: 'door_b → lobby → south_branch → east_exit → plaza → assembly',
        from_rh_room_alternate: 'door_a → north_corridor → west_exit → west_sidewalk → plaza → assembly',
        from_lobby_alternate: 'lobby → connector → north_corridor → west_exit → west_sidewalk → plaza → assembly',
        electric_sliding_doors: components.map((c) => c.id),
        note: 'Static plan only. Interior sliding doors can jam in a power failure; exits are manual. Current hazards are known only through observation or reports.',
      };
    }
    if (args.section === 'reporting') data.pull_stations = stations.map((s) => ({ id: s.id, zone: s.zone, label: s.label }));
    if (args.section === 'assistance') data.daniel_preference = scenario.danielPreference;
    return { ok: true, actionId, status: 'completed', data };
  }

  function toolNotify(actionId: string, args: ToolArgs['notify']): ToolResult | Fail {
    const a = actors[args.actor_id];
    if (args.recipient === a.id) return fail(actionId, 'INVALID_ARGUMENT', `${name(a.id)} cannot notify themselves.`, "Use recipient 'all' or another character id.");
    for (const eid of args.evidence_ids) {
      const e = evidenceById(eid);
      if (!e) return fail(actionId, 'UNKNOWN_EVIDENCE', `Evidence ${eid} does not exist.`, `Known evidence: ${evidence.map((x) => x.id).join(', ') || 'none yet'}.`);
      if (!a.knows.includes(eid)) {
        return fail(actionId, 'UNKNOWN_EVIDENCE', `${name(a.id)} does not know ${eid}.`, `${eid} is known by ${e.knownBy.map(name).join(', ')}; have one of them speak, or share it with ${name(a.id)} first.`);
      }
    }
    const cited = args.evidence_ids.map((eid) => evidenceById(eid)!);
    if (args.topic === 'fire' && !cited.some((e) => e.kind === 'fire')) {
      const fireKnown = a.knows.filter((eid) => evidenceById(eid)?.kind === 'fire');
      return fail(actionId, 'INVALID_ARGUMENT', "topic 'fire' must cite fire evidence the speaker knows.", fireKnown.length ? `Cite ${fireKnown.join(', ')}.` : `${name(a.id)} has not seen or been told about a fire.`);
    }
    if (args.topic === 'route_blocked' && !cited.length) {
      return fail(actionId, 'INVALID_ARGUMENT', "topic 'route_blocked' must cite at least one evidence id.", `${name(a.id)} knows: ${a.knows.join(', ') || 'nothing yet'}.`);
    }
    if (args.topic === 'evacuate' && !a.alerted) {
      return fail(actionId, 'NOT_AUTHORIZED', `${name(a.id)} is not aware of any emergency yet.`, 'Someone who saw the hazard must report it first (or pull the alarm).');
    }
    // Spoken: only people in the same room hear it (doorways join both sides). The fire alarm is the only
    // building-wide alert.
    const speakerZone = zoneAt(map, a.col, a.row);
    const canHear = (id: ActorId) => {
      const r = actors[id];
      return inEarshot(map, speakerZone, zoneAt(map, r.col, r.row));
    };
    const others = living().filter((id) => id !== a.id);
    const alarmHint = `pull the fire alarm in the north corridor (move ${a.id} to destination "alarm", then pull_alarm), or go to them`;
    let recipients: ActorId[];
    let notReached: ActorId[] = [];
    if (args.recipient === 'all') {
      recipients = others.filter(canHear);
      notReached = others.filter((id) => !canHear(id));
      if (!recipients.length) {
        return fail(actionId, 'OUT_OF_RANGE', `Nobody is within earshot of ${name(a.id)} (${speakerZone ?? 'unknown zone'}).`, `Spoken alerts only reach the same room — ${alarmHint}.`, {
          speaker_zone: speakerZone,
          out_of_earshot: notReached.map((id) => ({ id, zone: zoneAt(map, actors[id].col, actors[id].row) })),
        });
      }
    } else {
      const rid = args.recipient as ActorId;
      if (actors[rid].lost) return fail(actionId, 'NOT_AUTHORIZED', `${name(rid)} was lost to the fire.`, 'Speak to someone who is still in the building.');
      if (!canHear(rid)) {
        const rz = zoneAt(map, actors[rid].col, actors[rid].row);
        return fail(actionId, 'OUT_OF_RANGE', `${name(rid)} is in ${rz ?? 'another area'} — out of earshot of ${name(a.id)} (${speakerZone ?? 'unknown zone'}).`, `Spoken alerts only reach the same room — ${alarmHint}.`, {
          speaker_zone: speakerZone,
          recipient_zone: rz,
        });
      }
      recipients = [rid];
    }
    const dupKey = canonicalJson([a.id, args.recipient, args.topic, [...args.evidence_ids].sort(), args.message]);
    const recent = lastNotify.find((n) => n.key === dupKey && simTime() - n.at <= DUPLICATE_NOTIFY_WINDOW_SEC);
    if (recent) return { ok: true, actionId, status: 'completed', data: { duplicate: true, note: 'Identical message already delivered moments ago.' } };
    // apply
    lastNotify.push({ key: dupKey, at: simTime() });
    const newlyAlerted: ActorId[] = [];
    const learned: Record<string, string[]> = {};
    for (const rid of recipients) {
      const r = actors[rid];
      for (const e of cited) {
        if (learn(r, e)) (learned[rid] ??= []).push(e.id);
        addKnown(r, e.id, a.known.get(e.id) ?? []);
      }
      if (args.topic === 'fire' || args.topic === 'route_blocked' || args.topic === 'evacuate') {
        if (!r.alerted) newlyAlerted.push(rid);
        alert(r);
      }
    }
    emit(
      'message_delivered',
      { from: a.id, to: args.recipient, recipients, not_reached: notReached, topic: args.topic, message: args.message, newly_alerted: newlyAlerted },
      { actor: a.id, actionId, evidenceIds: args.evidence_ids },
    );
    if (phase === 'idle' && newlyAlerted.length) setPhase('incident');
    return {
      ok: true,
      actionId,
      status: 'completed',
      data: {
        delivered_to: recipients,
        not_reached: notReached,
        newly_alerted: newlyAlerted,
        evidence_shared: learned,
        ...(notReached.length ? { note: `Out of earshot (other rooms): ${notReached.join(', ')} — only the fire alarm reaches them.` } : {}),
      },
      evidenceIds: args.evidence_ids,
    };
  }

  function destinationError(actionId: string, a: ActorState, destination: string): Fail | null {
    if (destination === a.id) return fail(actionId, 'INVALID_ARGUMENT', 'Destination cannot be the traveller themself.');
    if (isActorId(destination) && actors[destination].lost) {
      return fail(actionId, 'INVALID_ARGUMENT', `${name(destination)} was lost to the fire.`, 'Choose a zone, "alarm", or a surviving person.');
    }
    return null;
  }

  function toolPlanRoute(actionId: string, args: ToolArgs['plan_route']): ToolResult | Fail {
    const a = actors[args.actor_id];
    const bad = destinationError(actionId, a, args.destination);
    if (bad) return bad;
    const partner = a.escort?.partner;
    if (partner && args.destination === partner) return fail(actionId, 'INVALID_ARGUMENT', `${name(a.id)} is already linked with ${name(partner)}.`);
    const plan = planFor(a, args.destination);
    if (!plan) {
      const movers = partner ? [a.id, partner] : [a.id];
      return fail(
        actionId,
        'ROUTE_UNAVAILABLE',
        `No ${partner || ACTOR_PROFILES[a.id].usesWheelchair ? 'wheelchair-accessible ' : ''}route to ${args.destination} that avoids known hazards.`,
        'Try a different destination (e.g. the other exit or assembly via another corridor), or observe for updated information.',
        { known_hazards: knownHazardSummary(movers) },
      );
    }
    const route: Route = {
      id: `R${++routeSeq}`,
      actor: a.id,
      destination: args.destination,
      path: plan.path,
      start: plan.start,
      target: plan.path[plan.path.length - 1] ?? plan.start,
      zones: zonesOf(plan.start, plan.path),
      revision: a.revision,
      accessible: plan.mask === 'accessible',
    };
    routes.push(route);
    return {
      ok: true,
      actionId,
      status: 'completed',
      data: {
        route_id: route.id,
        destination: route.destination,
        zones: route.zones,
        length_tiles: route.path.length,
        eta_s: round2(route.path.length / SPEED_TILES_PER_SEC),
        knowledge_revision: route.revision,
        accessible: route.accessible,
        avoids_known_hazards: knownHazardSummary(plan.movers),
      },
    };
  }

  function toolMove(actionId: string, decisionId: string, args: ToolArgs['move']): ToolResult | Fail {
    const a = actors[args.actor_id];
    if (!a.alerted) {
      const knowers = living().filter((id) => actors[id].alerted);
      return fail(
        actionId,
        'NOT_AUTHORIZED',
        `${name(a.id)} has not been alerted to any emergency.`,
        knowers.length ? `notify ${name(a.id)} first (e.g. ${name(knowers[0])} → ${a.id}), or pull the fire alarm.` : 'Nobody has reported a hazard yet.',
      );
    }
    if (a.checkedIn) return fail(actionId, 'NOT_AUTHORIZED', `${name(a.id)} is already checked in at the assembly point.`, 'Checked-in people stay at assembly for the roster check.');
    if (isMoving(a)) {
      const t = leaderOf(a).task!;
      const waiting = living()
        .filter((id) => id !== a.id && actors[id].alerted && !actors[id].checkedIn && !isMoving(actors[id]))
        .map((id) => name(id));
      return fail(
        actionId,
        'ACTOR_BUSY',
        `${name(a.id)} is already moving to ${t.destination} (${t.path.length} tiles left). Do not repeat this call.`,
        waiting.length ? `Give an order to someone who is waiting instead: ${waiting.join(', ')}.` : 'Everyone alerted is busy or checked in; the next update arrives when a move finishes.',
        { tiles_remaining: t.path.length, waiting_for_orders: waiting },
      );
    }
    const bad = destinationError(actionId, a, args.destination);
    if (bad) return bad;
    const leader = leaderOf(a);
    const follower = followerOf(leader);
    const partner = a.escort?.partner;
    if (partner && args.destination === partner) {
      return fail(actionId, 'INVALID_ARGUMENT', `${name(a.id)} is already escorting ${name(partner)} — they travel together.`, `move ${leaderOf(a).id} to "assembly" (or another zone); ${name(partner)} comes along.`);
    }
    if (follower && !follower.alerted) return fail(actionId, 'NOT_AUTHORIZED', `${name(follower.id)} has not been alerted.`);
    const movers = follower ? [leader.id, follower.id] : [leader.id];
    if (isAlarmDest(args.destination)) {
      const st = nearestStation(leader);
      if (st && st.d <= 1.5) {
        return { ok: true, actionId, status: 'completed', data: { destination: 'alarm', already_there: true, at: [leader.col, leader.row], station: st.s.id, next: `Already at the ${st.s.label} — call pull_alarm for ${leader.id}.` } };
      }
    } else if (zoneAt(map, leader.col, leader.row) === args.destination && (!follower || zoneAt(map, follower.col, follower.row) === args.destination)) {
      return {
        ok: true,
        actionId,
        status: 'completed',
        data: {
          destination: args.destination,
          already_there: true,
          at: [leader.col, leader.row],
          next: args.destination === 'assembly' ? `Already at assembly — call check_in for ${movers.join(' and ')}.` : 'Already there.',
        },
      };
    }
    let path: Tile[];
    let routeId: string | undefined;
    if (args.route_id) {
      const route = routes.find((r) => r.id === args.route_id);
      if (!route) return fail(actionId, 'INVALID_ARGUMENT', `Unknown route_id ${args.route_id}.`, 'Call plan_route first, or omit route_id to auto-plan.');
      if (!movers.includes(route.actor)) return fail(actionId, 'INVALID_ARGUMENT', `Route ${route.id} was planned for ${name(route.actor)}.`, `Omit route_id to auto-plan for ${name(a.id)}.`);
      if (route.destination !== args.destination) return fail(actionId, 'INVALID_ARGUMENT', `Route ${route.id} goes to ${route.destination}, not ${args.destination}.`, 'Omit route_id to auto-plan.');
      if (!sameTile(route.start, leader)) return fail(actionId, 'STALE_STATE', `Route ${route.id} starts at (${route.start.col},${route.start.row}) but ${name(leader.id)} is now at (${leader.col},${leader.row}).`, 'plan_route again, or omit route_id to auto-plan.');
      if (follower && !route.accessible) return fail(actionId, 'STALE_STATE', `Route ${route.id} is not wheelchair-accessible but ${name(leader.id)} is escorting ${name(follower.id)}.`, 'plan_route again (it will use accessible tiles), or omit route_id.');
      const known = knownNoGo(...movers);
      const crossing = route.path.find((t) => known.has(idx(t)));
      if (crossing) {
        counters.knownHazardMoveAttempts++;
        return fail(actionId, 'STALE_STATE', `Route ${route.id} crosses a hazard ${name(a.id)} now knows about (near ${describeTile(crossing)}).`, 'plan_route again — it will avoid known hazards (or omit route_id).', {
          known_hazards: knownHazardSummary(movers),
          route_revision: route.revision,
          current_revision: a.revision,
        });
      }
      path = route.path.map((t) => ({ ...t }));
      routeId = route.id;
    } else {
      const plan = planFor(a, args.destination);
      if (!plan) {
        return fail(actionId, 'ROUTE_UNAVAILABLE', `No ${follower || ACTOR_PROFILES[leader.id].usesWheelchair ? 'wheelchair-accessible ' : ''}route to ${args.destination} that avoids known hazards.`, 'Choose another destination (the other exit, or assembly via another corridor) or observe for updated information.', {
          known_hazards: knownHazardSummary(movers),
        });
      }
      path = plan.path;
    }
    if (!path.length) {
      const next = isActorId(args.destination)
        ? args.destination === 'daniel' && leader.id === 'alex'
          ? requests.some((r) => r.person === 'daniel' && r.helper === 'alex')
            ? 'Alex is already next to Daniel and Daniel has asked for help: call assist (alex → daniel).'
            : 'Alex is already next to Daniel. Daniel has not asked for help yet: Daniel calls request_assistance with helper_id "alex".'
          : `Already next to ${name(args.destination)}.`
        : 'Already there.';
      return { ok: true, actionId, status: 'completed', data: { destination: args.destination, already_there: true, at: [leader.col, leader.row], next } };
    }
    startTask(leader, {
      kind: 'move',
      actionId,
      decisionId,
      destination: args.destination,
      routeId,
      target: path[path.length - 1],
      path,
      progress: 0,
      traversed: 0,
      total: path.length,
      follower: follower?.id,
    });
    leader.commanded = true;
    if (follower) follower.commanded = true;
    if (phase === 'incident') setPhase('evacuating');
    const zones = zonesOf(leader, path);
    emit('move_started', { destination: args.destination, route_id: routeId ?? null, length_tiles: path.length, zones, with: follower?.id ?? null }, { actor: leader.id, actionId, decisionId });
    return {
      ok: true,
      actionId,
      status: 'started',
      data: {
        mover: leader.id,
        moving_together_with: follower?.id ?? null,
        destination: args.destination,
        route_id: routeId ?? null,
        zones,
        length_tiles: path.length,
        eta_s: round2(path.length / SPEED_TILES_PER_SEC),
        note: 'Movement result (arrival or interruption) arrives as a later event.',
      },
    };
  }

  function toolRequestAssistance(actionId: string, args: ToolArgs['request_assistance']): ToolResult | Fail {
    const a = actors[args.actor_id];
    if (args.helper_id === a.id) return fail(actionId, 'INVALID_ARGUMENT', 'A character cannot request assistance from themselves.');
    if (!a.alerted) return fail(actionId, 'NOT_AUTHORIZED', `${name(a.id)} has not been alerted to any emergency.`, `notify ${name(a.id)} first.`);
    if (requests.some((r) => r.person === a.id && r.helper === args.helper_id)) {
      return { ok: true, actionId, status: 'completed', data: { duplicate: true, requested: true, helper: args.helper_id } };
    }
    requests.push({ person: a.id, helper: args.helper_id, at: simTime() });
    emit('assistance_requested', { person: a.id, helper: args.helper_id }, { actor: a.id, actionId });
    return {
      ok: true,
      actionId,
      status: 'completed',
      data: { requested: true, helper: args.helper_id, next: `${name(args.helper_id)} must be next to ${name(a.id)} (move ${args.helper_id} to '${a.id}'), then assist.` },
    };
  }

  function toolAssist(actionId: string, args: ToolArgs['assist']): ToolResult | Fail {
    const helper = actors[args.actor_id];
    const person = actors[args.person_id];
    if (helper.id === person.id) return fail(actionId, 'INVALID_ARGUMENT', 'A character cannot assist themselves.');
    if (!helper.alerted) return fail(actionId, 'NOT_AUTHORIZED', `${name(helper.id)} has not been alerted to any emergency.`);
    if (helper.escort || person.escort) {
      const linked = helper.escort?.partner === person.id;
      return fail(
        actionId,
        'INVALID_ARGUMENT',
        linked ? `${name(helper.id)} is already escorting ${name(person.id)}.` : `${name(helper.escort ? helper.id : person.id)} is already part of an escort pair.`,
        linked ? `No need to assist again — move ${helper.id} to "assembly"; ${name(person.id)} comes along.` : undefined,
      );
    }
    if (helper.checkedIn || person.checkedIn) return fail(actionId, 'NOT_AUTHORIZED', 'Checked-in people stay at assembly.');
    if (!requests.some((r) => r.person === person.id && r.helper === helper.id)) {
      counters.assistWithoutConsentAttempts++;
      const hint =
        person.id === 'daniel' && scenario.danielPreference === 'independent'
          ? 'Daniel prefers to evacuate independently and has not asked for help; respect that.'
          : `${name(person.id)} must request_assistance(helper_id='${helper.id}') first (consent).`;
      return fail(actionId, 'ASSISTANCE_NOT_ACCEPTED', `${name(person.id)} has not requested assistance from ${name(helper.id)}.`, hint);
    }
    if (isMoving(helper) || isMoving(person)) return fail(actionId, 'ACTOR_BUSY', 'Both people must be stationary to start an escort.', 'Wait for the current move to finish.');
    const d = tileDistance(helper, person);
    if (d > 1.5) {
      return fail(actionId, 'OUT_OF_RANGE', `${name(helper.id)} is ${round2(d)} tiles from ${name(person.id)}; must be adjacent (≤1.5).`, `move ${helper.id} to '${person.id}' first.`, {
        distance: round2(d),
        helper_at: [helper.col, helper.row],
        person_at: [person.col, person.row],
      });
    }
    helper.escort = { role: 'leader', partner: person.id };
    person.escort = { role: 'follower', partner: helper.id };
    escorts.push({ leader: helper.id, follower: person.id, at: simTime(), fulfilled: false });
    emit('escort_started', { helper: helper.id, person: person.id }, { actor: helper.id, actionId });
    return { ok: true, actionId, status: 'completed', data: { escorting: person.id, note: 'Moving either one now moves both together on wheelchair-accessible tiles.' } };
  }

  function rosterState() {
    const checkedIn = ACTOR_IDS.filter((id) => actors[id].checkedIn);
    const lost = ACTOR_IDS.filter((id) => actors[id].lost);
    const outstanding = ACTOR_IDS.filter((id) => !actors[id].checkedIn && !actors[id].lost);
    const required = scenario.danielPreference === 'buddy';
    const fulfilled = escorts.some((e) => (e.leader === 'daniel' || e.follower === 'daniel') && e.fulfilled);
    return { checkedIn, outstanding, lost, required, fulfilled };
  }

  function toolCheckIn(actionId: string, args: ToolArgs['check_in']): ToolResult | Fail {
    const a = actors[args.actor_id];
    if (isMoving(a)) return fail(actionId, 'ACTOR_BUSY', `${name(a.id)} is still moving.`, 'Check in after arriving.');
    const z = zoneAt(map, a.col, a.row);
    if (z !== 'assembly') return fail(actionId, 'OUT_OF_RANGE', `${name(a.id)} is in ${z ?? 'unknown'}, not at the assembly point.`, `move ${a.id} to 'assembly' first.`, { zone: z, at: [a.col, a.row] });
    if (a.checkedIn) return { ok: true, actionId, status: 'completed', data: { duplicate: true, checked_in: rosterState().checkedIn } };
    a.checkedIn = true;
    emit('checked_in', { at: [a.col, a.row] }, { actor: a.id, actionId });
    for (const e of escorts) {
      if (!e.fulfilled && actors[e.leader].checkedIn && actors[e.follower].checkedIn) {
        e.fulfilled = true;
        emit('assistance_fulfilled', { helper: e.leader, person: e.follower }, { actor: e.leader, actionId });
      }
    }
    const alive = living();
    if (alive.every((id) => actors[id].checkedIn || zoneAt(map, actors[id].col, actors[id].row) === 'assembly')) setPhase('accounting');
    const rs = rosterState();
    return { ok: true, actionId, status: 'completed', data: { checked_in: rs.checkedIn, outstanding: rs.outstanding, lost: rs.lost } };
  }

  function toolVerifyRoster(actionId: string, args: ToolArgs['verify_roster']): ToolResult | Fail {
    if (args.actor_id !== 'alex') return fail(actionId, 'NOT_AUTHORIZED', 'Only the warden (alex) verifies the roster.', "Use actor_id 'alex'.");
    if (!actors.alex.checkedIn) return fail(actionId, 'OUT_OF_RANGE', 'The warden must be checked in at the assembly point to verify the roster.', "check_in alex at 'assembly' first.");
    const rs = rosterState();
    const complete = rs.outstanding.length === 0;
    emit('roster_verified', { complete, checked_in: rs.checkedIn, outstanding: rs.outstanding, lost: rs.lost, assistance_required: rs.required, assistance_fulfilled: rs.fulfilled }, { actor: 'alex', actionId });
    if (complete) {
      rosterVerified = true;
      if (rs.lost.length) {
        endEpisode(
          'partial',
          `${rs.checkedIn.map(name).join(' and ')} reached the assembly point and the warden verified the roster; ${rs.lost.map(name).join(' and ')} ${rs.lost.length > 1 ? 'were' : 'was'} lost to the fire.`,
        );
      } else {
        endEpisode('success', 'All three are physically checked in at the assembly point and the warden verified the roster.');
      }
    } else {
      counters.prematureVerifyAttempts++;
    }
    return {
      ok: true,
      actionId,
      status: 'completed',
      data: {
        complete,
        checked_in: rs.checkedIn,
        outstanding: rs.outstanding,
        lost: rs.lost,
        assistance: { preference: scenario.danielPreference, fulfilled: rs.fulfilled },
        ...(complete ? {} : { note: 'Not every survivor is accounted for yet.' }),
      },
    };
  }

  function toolPullAlarm(actionId: string, args: ToolArgs['pull_alarm']): ToolResult | Fail {
    const a = actors[args.actor_id];
    if (!a.alerted && !a.knows.length) {
      return fail(actionId, 'NOT_AUTHORIZED', `${name(a.id)} is not aware of any emergency.`, 'Someone must see a hazard (observe) or be told (notify) before pulling the alarm.');
    }
    if (isMoving(a)) return fail(actionId, 'ACTOR_BUSY', `${name(a.id)} is still moving.`, 'Pull the alarm after arriving at the station.');
    const st = nearestStation(a);
    if (!st || st.d > 1.5) {
      return fail(actionId, 'OUT_OF_RANGE', `${name(a.id)} is not at a fire-alarm pull station.`, `move ${a.id} to destination "alarm" first.`, {
        nearest_station: st?.s.id ?? null,
        distance: st ? round2(st.d) : null,
      });
    }
    if (alarm.active) return { ok: true, actionId, status: 'completed', data: { already_active: true, station: alarm.stationId, by: alarm.by } };
    alarm.active = true;
    alarm.at = simTime();
    alarm.by = a.id;
    alarm.stationId = st.s.id;
    const newlyAlerted: ActorId[] = [];
    for (const id of living()) {
      if (!actors[id].alerted) newlyAlerted.push(id);
      alert(actors[id]);
    }
    emit('alarm_activated', { station: st.s.id, label: st.s.label, zone: st.s.zone, by: a.id, newly_alerted: newlyAlerted }, { actor: a.id, actionId });
    if (phase === 'idle') setPhase('incident');
    return { ok: true, actionId, status: 'completed', data: { alarm: 'active', station: st.s.id, newly_alerted: newlyAlerted, note: 'Everyone is alerted to evacuate; the alarm does not say where the hazard is.' } };
  }

  function summarize(call: { name: string; args: Record<string, unknown> }, r: ToolResult): string {
    const who = isActorId(call.args.actor_id) ? name(call.args.actor_id) : '?';
    if (!r.ok) return `${call.name} rejected: ${r.error.code} — ${r.error.message}`;
    const d = r.data;
    switch (call.name) {
      case 'observe': {
        const v = (d.visible_hazards as { evidence_id: string; kind: string }[]) ?? [];
        return `${who} looked around in ${d.zone}: ${v.length ? v.map((x) => `${x.kind} ${x.evidence_id}`).join(', ') : 'no hazard in sight'}`;
      }
      case 'consult_plan':
        return `${who} read the plan: ${d.section}`;
      case 'notify':
        if (d.duplicate) return `${who}'s repeated message ignored (duplicate)`;
        return `${who} → ${call.args.recipient}: ${call.args.topic} (heard by ${((d.delivered_to as string[]) ?? []).map((x) => name(x as ActorId)).join(', ')})${
          ((d.not_reached as string[]) ?? []).length ? `; out of earshot: ${(d.not_reached as string[]).map((x) => name(x as ActorId)).join(', ')} — only the fire alarm reaches them` : ''
        }`;
      case 'plan_route':
        return `${who} route ${d.route_id} to ${d.destination}: ${(d.zones as string[]).join(' → ')} (${d.length_tiles} tiles)`;
      case 'move':
        return d.already_there ? `${who} already at ${d.destination} — no movement. ${d.next ?? ''}`.trim() : `${who}${d.moving_together_with ? ` + ${name(d.moving_together_with as ActorId)}` : ''} moving to ${d.destination} (${d.length_tiles} tiles, ~${d.eta_s}s)`;
      case 'request_assistance':
        return `${who} asked ${name(call.args.helper_id as ActorId)} for assistance`;
      case 'assist':
        return `${who} is now escorting ${name(call.args.person_id as ActorId)}`;
      case 'check_in':
        return `${who} checked in at assembly`;
      case 'verify_roster':
        return d.complete
          ? ((d.lost as string[]) ?? []).length
            ? `Roster verified: survivors accounted for; lost ${(d.lost as string[]).map((x) => name(x as ActorId)).join(', ')}`
            : 'Roster verified: everyone accounted for'
          : `Roster incomplete: outstanding ${((d.outstanding as string[]) ?? []).join(', ')}`;
      case 'pull_alarm':
        return d.already_active ? `${who} pulled the alarm (already sounding)` : `${who} pulled the fire alarm at ${componentOrStation(String(d.station))} — everyone alerted`;
      default:
        return `${call.name} ok`;
    }
  }
  const componentOrStation = (id: string) => stations.find((s) => s.id === id)?.label ?? id;

  function sanitizeArgs(args: unknown): Record<string, unknown> {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args as Record<string, unknown>).slice(0, 12)) {
      out[k] = typeof v === 'string' ? v.slice(0, 200) : Array.isArray(v) ? v.slice(0, 8) : v;
    }
    return out;
  }

  function nextActionId(decisionId: string): string {
    const base = `A-${decisionId.replace(/^D-/, '')}`;
    let id = base;
    for (let n = 2; actionIdsUsed.has(id); n++) id = `${base}.${n}`;
    actionIdsUsed.add(id);
    return id;
  }

  function decisionIndexOf(decisionId: string): number {
    const n = Number(decisionId.replace(/^D-/, ''));
    return Number.isFinite(n) ? n : decisionsUsed;
  }

  /** Any referenced person who was lost cannot act or be acted with. */
  function lostReference(actionId: string, args: Record<string, unknown>): Fail | null {
    for (const key of ['actor_id', 'helper_id', 'person_id', 'recipient']) {
      const v = args[key];
      if (isActorId(v) && actors[v].lost) {
        const survivors = living().map(name);
        return fail(actionId, 'NOT_AUTHORIZED', `${name(v)} was lost to the fire.`, survivors.length ? `Give orders to the survivors: ${survivors.join(', ')}.` : 'Nobody is left to act.');
      }
    }
    return null;
  }

  function executeTool(call: NormalizedToolCall, meta: DecisionMeta): ToolResult {
    if (call.id && resultCache.has(call.id)) return resultCache.get(call.id)!;
    if (!decisionMeta.has(meta.decisionId)) decisionMeta.set(meta.decisionId, { latencyMs: meta.latencyMs, promptTokens: meta.promptTokens, completionTokens: meta.completionTokens });
    const actionId = nextActionId(meta.decisionId);
    const args = sanitizeArgs(call.arguments);
    let r: ToolResult;
    if (outcome) {
      r = fail(actionId, 'EPISODE_OVER', `The episode has ended (${outcome.status}).`);
    } else if (!(TOOL_NAMES as readonly string[]).includes(call.name)) {
      r = fail(actionId, 'UNKNOWN_TOOL', `Unknown tool '${call.name}'.`, `Available tools: ${TOOL_NAMES.join(', ')}.`);
    } else {
      const parsed = TOOL_ARG_SCHEMAS[call.name as ToolName].safeParse(call.arguments);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
        r = fail(actionId, 'INVALID_ARGUMENT', `Invalid arguments for ${call.name}.`, issues.slice(0, 3).join('; '), { issues });
      } else {
        const lostRef = lostReference(actionId, parsed.data as Record<string, unknown>);
        if (lostRef) r = lostRef;
        else {
          const a = parsed.data as never;
          switch (call.name as ToolName) {
            case 'observe':
              r = toolObserve(actionId, a);
              break;
            case 'consult_plan':
              r = toolConsultPlan(actionId, a);
              break;
            case 'notify':
              r = toolNotify(actionId, a);
              break;
            case 'plan_route':
              r = toolPlanRoute(actionId, a);
              break;
            case 'move':
              r = toolMove(actionId, meta.decisionId, a);
              break;
            case 'request_assistance':
              r = toolRequestAssistance(actionId, a);
              break;
            case 'assist':
              r = toolAssist(actionId, a);
              break;
            case 'check_in':
              r = toolCheckIn(actionId, a);
              break;
            case 'verify_roster':
              r = toolVerifyRoster(actionId, a);
              break;
            case 'pull_alarm':
              r = toolPullAlarm(actionId, a);
              break;
          }
        }
      }
    }
    const actor = isActorId(args.actor_id) ? args.actor_id : undefined;
    const summary = summarize({ name: call.name, args }, r!);
    actionLog.push({
      decision: meta.decisionId,
      decisionIndex: decisionIndexOf(meta.decisionId),
      actor,
      tool: call.name,
      args,
      ok: r!.ok,
      started: r!.ok && r!.status === 'started',
      summary,
      errorCode: r!.ok ? undefined : r!.error.code,
      hint: r!.ok ? undefined : r!.error.hint,
      simTime: simTime(),
      evidenceIds: r!.ok ? r!.evidenceIds ?? (Array.isArray(args.evidence_ids) ? (args.evidence_ids as string[]) : []) : [],
      topic: typeof args.topic === 'string' ? args.topic : undefined,
    });
    emit(r!.ok ? 'tool_executed' : 'tool_rejected', { tool: call.name, args, ok: r!.ok, summary, ...(r!.ok ? { status: r!.status } : { error: r!.error }) }, {
      actor,
      actionId,
      decisionId: meta.decisionId,
    });
    if (call.id) resultCache.set(call.id, r!);
    checkEnd();
    checkCap();
    return r!;
  }

  function beginDecision(): string {
    decisionsUsed++;
    return `D-${pad3(decisionsUsed)}`;
  }

  function noteDecision(note: DecisionNote, meta?: Omit<DecisionMeta, 'decisionId'>) {
    if (meta && !decisionMeta.has(note.decisionId)) decisionMeta.set(note.decisionId, { ...meta });
    actionLog.push({
      decision: note.decisionId,
      decisionIndex: decisionIndexOf(note.decisionId),
      ok: false,
      started: false,
      summary: `${note.kind}: ${note.detail}`.slice(0, 300),
      errorCode: note.kind.toUpperCase(),
      hint:
        note.kind === 'malformed' || note.kind === 'no_call'
          ? 'Respond with exactly one tool call using the provided tools and valid JSON arguments.'
          : note.kind === 'ignored_extra_call'
            ? 'Only the first tool call per turn is executed.'
            : undefined,
      simTime: simTime(),
      note: note.kind,
      evidenceIds: [],
    });
    emit('decision_note', { kind: note.kind, detail: note.detail.slice(0, 300) }, { decisionId: note.decisionId });
    if (note.kind !== 'ignored_extra_call') checkCap();
  }

  // ------------------------------------------------------------------ planner view
  const RELEVANT: WorldEventType[] = ['observation', 'move_completed', 'move_interrupted', 'assistance_fulfilled', 'alarm_activated', 'actor_lost', 'fire_spread'];

  function describeEvent(e: WorldEvent): string | null {
    const who = e.actor ? name(e.actor) : 'Someone';
    const d = e.data;
    switch (e.type) {
      case 'observation':
        if (d.kind === 'electrical') return `${who} saw that ${componentLabel(d.component as string | undefined)} is stuck closed — power failure (${e.evidenceIds?.[0]})${d.firstReport ? '' : ' (already reported)'}.`;
        return `${who} ${d.via === 'smoke' ? 'smelled smoke and found' : 'saw'} a fire (${e.evidenceIds?.[0]}) in ${d.zone}${d.firstReport ? '' : ' (already reported)'}.`;
      case 'fire_spread':
        return `Fire ${d.evidence} has spread into ${d.zone} (${d.cells_known} burning/burnt tiles known).`;
      case 'alarm_activated': {
        const st = stations.find((s) => s.id === d.station);
        return `Alarm raised by ${who} at the ${st?.label ?? d.station} — everyone is alerted to evacuate.`;
      }
      case 'actor_lost':
        return `${who} was lost to the fire in ${d.zone ?? 'the building'}.`;
      case 'move_completed':
        return `${who}${d.with ? ` and ${name(d.with as ActorId)}` : ''} arrived at ${d.destination} (${e.actionId}) — now in ${d.zone}.${d.zone === 'assembly' ? ' Not checked in yet: call check_in.' : ''}`;
      case 'move_interrupted': {
        if (d.code === 'ACTOR_LOST') return null;
        const what = d.hazard_kind === 'electrical' ? `${componentLabel(d.component as string | undefined)} stuck closed ${d.evidence ?? ''}` : `fire ${d.evidence ?? ''} ahead`;
        return `${who}'s move to ${d.destination} (${e.actionId}) was interrupted: ROUTE_UNAVAILABLE — ${what}; stopped at ${d.zone} (${(d.stopped_at as number[]).join(',')}) after ${d.partial_tiles}/${d.total_tiles} tiles.`;
      }
      case 'assistance_fulfilled':
        return `${name(d.helper as ActorId)} completed the buddy escort for ${name(d.person as ActorId)}.`;
      case 'phase_changed':
        return `Phase: ${d.from} → ${d.to}.`;
      case 'checked_in':
        return `${who} is checked in.`;
      default:
        return null;
    }
  }

  function bboxOf(cells: Iterable<number>): [number, number, number, number] | null {
    let b: [number, number, number, number] | null = null;
    for (const i of cells) {
      const c = i % map.cols;
      const r = Math.floor(i / map.cols);
      if (!b) b = [c, r, c, r];
      else b = [Math.min(b[0], c), Math.min(b[1], r), Math.max(b[2], c), Math.max(b[3], r)];
    }
    return b;
  }

  function plannerView(): PlannerView {
    const rs = rosterState();
    return {
      sim_time: simTime(),
      phase,
      decisions_remaining: Math.max(0, maxDecisions - decisionsUsed),
      actors: ACTOR_IDS.map((id) => {
        const a = actors[id];
        const leader = leaderOf(a);
        const t = leader.task;
        let busy: string | null = null;
        if (a.task) busy = `moving to ${a.task.destination}${a.task.actionId ? ` (${a.task.actionId})` : ''}, ${a.task.path.length} tiles left`;
        else if (a.escort?.role === 'follower' && t) busy = `moving with ${name(leader.id)} to ${t.destination}, ${t.path.length} tiles left`;
        return {
          id,
          name: name(id),
          role: ACTOR_PROFILES[id].role,
          zone: zoneAt(map, a.col, a.row),
          tile: [a.col, a.row] as [number, number],
          status: statusOf(a),
          alerted: a.alerted,
          checked_in: a.checkedIn,
          busy: a.lost || a.task?.kind === 'ambient' ? null : busy,
          knows_evidence: [...a.knows],
          escort: a.escort ? `${a.escort.role === 'leader' ? 'escorting' : 'escorted by'} ${a.escort.partner}` : null,
          uses_wheelchair: ACTOR_PROFILES[id].usesWheelchair,
          lost: a.lost,
        };
      }),
      evidence: evidence.map((e) => {
        const cells = unionKnown.get(e.id) ?? new Set<number>();
        const zones: ZoneId[] = [];
        for (const i of cells) {
          const z = zoneOfIdx(i);
          if (z && !zones.includes(z)) zones.push(z);
        }
        return {
          id: e.id,
          kind: e.kind,
          zone: e.zone,
          zones,
          cells_known: cells.size,
          bbox: bboxOf(cells),
          ...(e.componentId ? { component: e.componentId } : {}),
          ...(e.kind === 'fire' ? { spreading: true } : {}),
          observed_by: e.observedBy,
          at: e.at,
          known_by: [...e.knownBy],
        };
      }),
      alarm: {
        active: alarm.active,
        ...(alarm.at !== undefined ? { at: alarm.at } : {}),
        ...(alarm.by ? { by: alarm.by } : {}),
        stations: stations.map((s) => ({ id: s.id, zone: s.zone, stand: [s.stand.col, s.stand.row] as [number, number] })),
      },
      messages: events
        .filter((e) => e.type === 'message_delivered')
        .slice(-6)
        .map((e) => ({ from: e.actor!, to: String(e.data.to), topic: String(e.data.topic), evidence_ids: e.evidenceIds ?? [], message: String(e.data.message), at: e.simTime })),
      assistance: {
        person: 'daniel',
        preference: scenario.danielPreference,
        buddy: 'alex',
        requested: requests.some((r) => r.person === 'daniel'),
        accepted: escorts.some((e) => e.follower === 'daniel' || e.leader === 'daniel'),
        fulfilled: rs.fulfilled,
      },
      roster: { checked_in: rs.checkedIn, verified: rosterVerified, lost: rs.lost },
      routes: routes.slice(-4).map((r) => ({ route_id: r.id, actor: r.actor, destination: r.destination, zones: r.zones, knowledge_revision: r.revision })),
      recent_actions: actionLog.slice(-8).map((l) => ({
        decision: l.decision,
        ...(l.actor ? { actor: l.actor } : {}),
        ...(l.tool ? { tool: l.tool } : {}),
        ...(l.args ? { args: l.args } : {}),
        ok: l.ok,
        summary: l.summary,
        ...(l.errorCode ? { error_code: l.errorCode } : {}),
        ...(l.hint ? { hint: l.hint } : {}),
      })),
      new_since_last_decision: events
        .slice(lastViewedSeq)
        .map(describeEvent)
        .filter((s): s is string => !!s),
    };
  }

  function needsDecision(): { needed: boolean; reason: string } {
    if (outcome) return { needed: false, reason: 'episode ended' };
    if (phase === 'idle') return { needed: false, reason: 'no incident yet' };
    if (decisionsUsed >= maxDecisions) return { needed: false, reason: 'decision cap reached' };
    // A repeat sighting of an already-reported hazard is not news for the planner; only first reports wake it.
    const fresh = events.slice(lastViewedSeq).filter((e) => RELEVANT.includes(e.type) && (e.type !== 'observation' || e.data.firstReport === true) && !(e.type === 'move_interrupted' && e.data.code === 'ACTOR_LOST'));
    if (fresh.length) return { needed: true, reason: `new events: ${[...new Set(fresh.map((e) => e.type))].join(', ')}` };
    const alive = living();
    const ready = alive.filter((id) => actors[id].alerted && !actors[id].checkedIn && !isMoving(actors[id]));
    if (ready.length) return { needed: true, reason: `ready for instructions: ${ready.join(', ')}` };
    // People who were never told still need the planner (e.g. the reporter evacuated without notifying anyone).
    const unalerted = alive.filter((id) => !actors[id].alerted && !actors[id].checkedIn);
    if (unalerted.length && alive.some((id) => actors[id].alerted)) return { needed: true, reason: `not yet alerted: ${unalerted.join(', ')}` };
    if (alive.length && alive.every((id) => actors[id].checkedIn) && !rosterVerified && !actors.alex.lost) return { needed: true, reason: 'everyone checked in; roster not verified' };
    return { needed: false, reason: 'waiting for movement' };
  }

  // ------------------------------------------------------------------ snapshot
  function statusOf(a: ActorState): ActorStatus {
    if (a.lost) return 'lost';
    if (a.checkedIn) return 'checked_in';
    if (a.escort) {
      const moving = isMoving(a);
      if (moving) return a.escort.role === 'leader' ? 'escorting' : 'escorted';
    }
    if (a.task?.kind === 'move') return 'moving';
    if (a.alerted) return a.commanded ? 'waiting' : 'alerted';
    return a.pose === 'sit' && !a.task ? 'working' : 'idle';
  }

  function snapshot(): Snapshot {
    const rs = rosterState();
    return {
      episodeId: opts.episodeId,
      caseId: scenario.caseId,
      seed: scenario.seed,
      tick,
      simTime: simTime(),
      phase,
      paused: false,
      mode: 'live',
      actors: ACTOR_IDS.map((id): ActorSnapshot => {
        const a = actors[id];
        let x = a.col;
        let y = a.row;
        let dir = a.dir;
        let moving = false;
        if (a.task && a.task.path.length) {
          const n = a.task.path[0];
          x = a.col + (n.col - a.col) * a.task.progress;
          y = a.row + (n.row - a.row) * a.task.progress;
          dir = dirBetween(a, n);
          moving = true;
        } else if (a.escort?.role === 'follower') {
          const l = actors[a.escort.partner];
          if (l.task && l.task.path.length) {
            x = a.col + (l.col - a.col) * l.task.progress;
            y = a.row + (l.row - a.row) * l.task.progress;
            if (!sameTile(a, l)) dir = dirBetween(a, l);
            moving = true;
          }
        }
        const t = a.task;
        return {
          id,
          name: name(id),
          role: ACTOR_PROFILES[id].role,
          col: a.col,
          row: a.row,
          x: round2(x),
          y: round2(y),
          dir,
          anim: moving ? 'walk' : a.pose === 'sit' ? (a.alerted ? 'sit' : 'type') : 'idle',
          zone: zoneAt(map, a.col, a.row),
          status: statusOf(a),
          alerted: a.alerted,
          checkedIn: a.checkedIn,
          escort: a.escort,
          task: t ? { kind: t.kind, destination: t.destination, ...(t.actionId ? { actionId: t.actionId } : {}), tilesRemaining: t.path.length } : null,
          knows: [...a.knows],
          usesWheelchair: ACTOR_PROFILES[id].usesWheelchair,
          lost: a.lost,
          ...(a.lostAt !== null ? { lostAtSimTime: a.lostAt } : {}),
        };
      }),
      hazards: hazardSnapshots(),
      roster: { checkedIn: rs.checkedIn, verified: rosterVerified, lost: rs.lost },
      assistance: {
        required: rs.required,
        requested: requests.some((r) => r.person === 'daniel'),
        accepted: escorts.some((e) => e.follower === 'daniel' || e.leader === 'daniel'),
        fulfilled: rs.fulfilled,
      },
      alarm: { active: alarm.active, ...(alarm.at !== undefined ? { atSimTime: alarm.at } : {}), ...(alarm.by ? { by: alarm.by } : {}), ...(alarm.stationId ? { stationId: alarm.stationId } : {}) },
      decisions: { used: decisionsUsed, max: maxDecisions, inFlight: false },
      outcome,
    };
  }

  function hash(): string {
    return hashValue({
      tick,
      phase,
      outcome,
      rosterVerified,
      rng: rng.state(),
      spreadRng: spreadRng.state(),
      alarm,
      actors: ACTOR_IDS.map((id) => {
        const a = actors[id];
        return {
          id,
          col: a.col,
          row: a.row,
          dir: a.dir,
          pose: a.pose,
          alerted: a.alerted,
          commanded: a.commanded,
          knows: a.knows,
          known: [...a.known].map(([eid, s]) => [eid, [...s].sort((x, y) => x - y)]),
          revision: a.revision,
          checkedIn: a.checkedIn,
          escort: a.escort,
          lost: a.lost,
          ambientNextTick: a.ambientNextTick,
          task: a.task ? { kind: a.task.kind, destination: a.task.destination, path: a.task.path, progress: round2(a.task.progress), follower: a.task.follower ?? null } : null,
        };
      }),
      hazards: hazards.map((h) => ({
        id: h.id,
        kind: h.kind,
        col: h.col,
        row: h.row,
        evidenceId: h.evidenceId,
        burning: [...h.burning].sort((x, y) => x[0] - y[0]),
        charred: [...h.charred].sort((x, y) => x - y),
        doors: h.doorIdx,
      })),
      evidence: evidence.map((e) => ({ id: e.id, knownBy: e.knownBy })),
      requests,
      escorts,
      routes: routes.length,
      scheduled: scheduled.map((s) => [s.triggeredAtTick, s.done]),
    });
  }

  function result(wallTimeMs?: number): EpisodeResult | null {
    if (!outcome) return null;
    if (wallTimeMs !== undefined) endedAtWall = wallTimeMs;
    return computeResult({
      episodeId: opts.episodeId,
      caseId: scenario.caseId,
      outcome,
      actionLog,
      events,
      interruptions,
      decisionsUsed,
      decisionMeta: [...decisionMeta.values()],
      counters,
      roster: rosterState(),
      rosterVerified,
      simTime: simTime(),
      wallTimeMs: endedAtWall ?? 0,
      danielPreference: scenario.danielPreference,
      lost: ACTOR_IDS.filter((id) => actors[id].lost).map((id) => ({ actor: id, simTime: actors[id].lostAt ?? 0, alertedAt: actors[id].alertedAt })),
      alarm: { active: alarm.active, at: alarm.at ?? null, by: alarm.by ?? null, stationId: alarm.stationId ?? null, stationLabel: stations.find((s) => s.id === alarm.stationId)?.label ?? null },
      componentLabels: Object.fromEntries(components.map((c) => [c.id, c.label])),
    });
  }

  return {
    map,
    scenario,
    episodeId: opts.episodeId,
    step,
    placeHazard,
    beginDecision,
    executeTool,
    noteDecision,
    needsDecision,
    plannerView,
    markViewed: () => {
      lastViewedSeq = events.length;
    },
    snapshot,
    get events() {
      return events;
    },
    eventsSince: (seq: number) => events.filter((e) => e.seq > seq),
    outcome: () => outcome,
    end: (status, reason) => endEpisode(status, reason),
    result,
    hash,
  };
}
