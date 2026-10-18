// Generates the escape-office-scenarios dataset for the current map (synthetic, deterministic) — ruleset 2.
//
//   npm run data:scenarios
//   npx tsx data/scenarios/generator.ts --check    # generate, compare with the files on disk, write nothing
//
// Inputs:  data/maps/<DEFAULT_MAP_ID>.json (npm run data:map), data/scenarios/demo-hero.json, hero-story.json
// Outputs: data/scenarios/cases.dev.jsonl, cases.test.jsonl, splits.json, provenance.json
//
// Ruleset 2 (see DATASET_CARD.md): fire SPREADS from a 2×2 seed (stochastic, seeded in the engine); an
// "electrical failure" jams one of the map's interior electric sliding doors shut; fire-alarm pull stations exist;
// there is no time limit, and people reached by the fire are lost.
//
// Method:
//  1. Spawns: one seeded pick per actor from map.spawnSpots (non-overlapping; wheelchair users' spots are accessible).
//  2. Fire seed: a valid 2×2 placement from a *fire-location family* (SPECS below, per map). Dev and test use
//     DISJOINT families (structural hold-out): test fire locations never appear in dev.
//  3. Family extras:
//     - multi_fire: a second seed from another of the split's fire families, ≥3 tiles from every spawn, at t = 4–8 s.
//     - fire_then_door: an electrical failure on a sliding door that lies on someone's oracle route given the fire,
//       chosen so an alternate route still exists; it drops when someone enters the zone before that door
//       (mid-evacuation), or shortly after the incident for doors right next to the start room.
//     - independent: the assisted person (ASSISTANCE) prefers to evacuate on their own; half also get a door failure.
//     - trapped: fire inside a sealable room (every opening is an electric door) and ALL of its doors fail at
//       t = 1 s, sealing its occupants in with a spreading fire → expectLosses.
//  4. Labels from a full-knowledge grid search at placement time (fire seed cells + disabled doors, Daniel on
//     wheelchair-clearance tiles), required to agree under two clearance interpretations. Fire spread is stochastic
//     and happens later in the engine, so these labels describe the start of the incident, not the outcome.
//  5. Every placement is cross-checked with the engine's validatePlacement when the engine module is importable.
// The oracle is used only for labels/scoring, never shown to the planner.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ActorId,
  CaseFamily,
  DoorComponent,
  HazardKind,
  MapData,
  ScenarioCase,
  ScheduledEvent,
  SpawnSpot,
  Tile,
  ZoneId,
} from '../../packages/contracts/src/types.js';
import { DEFAULT_MAP_ID } from '../../packages/contracts/src/map-ids.generated.js';
import { ACTOR_IDS } from '../../packages/contracts/src/types.js';
import { ACTOR_PROFILES, ASSISTANCE } from '../../packages/contracts/src/engine-api.js';
import { sealableRooms } from '../maps/builder.js';
import { heroStoryCase, loadDemoHero, loadHeroStory } from './heroStory.js';

export const GENERATOR_VERSION = '3.0.0';
export const MASTER_SEED = 20261017;
const ACTORS: ActorId[] = [...ACTOR_IDS];

/** A fire-location family: 2×2 seeds whose whole footprint lies in `zone` (and inside `box`, if given). */
export interface FireFamilyDef {
  id: string;
  zone: ZoneId;
  box?: { cols: [number, number]; rows: [number, number] };
  /** Prefer seeds someone can see at t = 1 s (false for corridors, where fires are usually smelled first). */
  preferVisible?: boolean;
}

/** Per-map dataset recipe: fire families per split (disjoint) and the family used for trapped cases. */
export interface MapScenarioSpec {
  dataset: string;
  families: Record<'dev' | 'test', FireFamilyDef[]>;
  trapped: Record<'dev' | 'test', string>;
}

export const SPECS: Record<string, MapScenarioSpec> = {
  // Each split has a big shared space, an occupied meeting/work room and a service room; test rooms never appear in
  // dev. Trapped cases seal a sealable room with someone inside: the Red Hat room (dev) and the GPU server room (test).
  'office-v2': {
    dataset: 'escape-office-scenarios-v3',
    families: {
      dev: [
        { id: 'rh_room', zone: 'rh_room' as ZoneId },
        { id: 'cubicles', zone: 'cubicles' as ZoneId },
        { id: 'kitchen', zone: 'kitchen' as ZoneId },
      ],
      test: [
        { id: 'server_room', zone: 'server_room' as ZoneId },
        { id: 'hallway', zone: 'hallway' as ZoneId, preferVisible: false },
        { id: 'reception', zone: 'reception' as ZoneId },
      ],
    },
    trapped: { dev: 'rh_room', test: 'server_room' },
  },
};

/** Placement geometry (must match packages/engine/src/placement.ts; cross-checked at runtime when importable). */
export const HAZARD_GEOMETRY = {
  fire: { w: 2, h: 2, sightRadius: 9, note: '2×2 seed; spreads stochastically in the engine' },
  electrical: { sightRadius: 5, note: 'disables one interior electric sliding door (its tiles become impassable and opaque)' },
} as const;

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

// ---------------------------------------------------------------------------
// Seeded PRNG
// ---------------------------------------------------------------------------

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
type Rng = ReturnType<typeof mulberry32>;
const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];

// ---------------------------------------------------------------------------
// Grid helpers (self-contained oracle nav)
// ---------------------------------------------------------------------------

export interface Placed {
  kind: HazardKind;
  col: number;
  row: number;
  cells: Tile[];
  componentId?: string;
}

export class Grid {
  constructor(readonly map: MapData) {}
  inb = (c: number, r: number) => c >= 0 && r >= 0 && c < this.map.cols && r < this.map.rows;
  i = (c: number, r: number) => r * this.map.cols + c;
  key = (c: number, r: number) => `${c},${r}`;
  zoneAt = (c: number, r: number): ZoneId | null => (this.inb(c, r) ? this.map.zone[this.i(c, r)] : null);
  isWall = (c: number, r: number) => !this.inb(c, r) || this.map.terrain[this.i(c, r)] === 'wall';
  walkable = (c: number, r: number) => this.inb(c, r) && this.map.walkable[this.i(c, r)];

  fireSeed(col: number, row: number): Tile[] {
    const s = HAZARD_GEOMETRY.fire;
    const out: Tile[] = [];
    for (let dr = 0; dr < s.h; dr++) for (let dc = 0; dc < s.w; dc++) out.push({ col: col + dc, row: row + dr });
    return out;
  }

  /** The sliding door under (col,row), else the nearest one within 1 tile (Chebyshev). Mirrors the engine's snapping. */
  doorNear(col: number, row: number): DoorComponent | null {
    let best: DoorComponent | null = null;
    let bd = Infinity;
    for (const d of this.map.components) {
      for (const t of d.tiles) {
        const dist = Math.max(Math.abs(t.col - col), Math.abs(t.row - row));
        if (dist <= 1 && dist < bd) {
          bd = dist;
          best = d;
        }
      }
    }
    return best;
  }

  door(id: string): DoorComponent {
    const d = this.map.components.find((c) => c.id === id);
    if (!d) throw new Error(`unknown door ${id}`);
    return d;
  }

  placedFire(col: number, row: number): Placed {
    return { kind: 'fire', col, row, cells: this.fireSeed(col, row) };
  }

  placedDoor(id: string): Placed {
    const d = this.door(id);
    return { kind: 'electrical', col: d.tiles[0].col, row: d.tiles[0].row, cells: d.tiles.map((t) => ({ ...t })), componentId: d.id };
  }

  /** Line of sight between tile centres; walls block (furniture does not). */
  los(a: Tile, b: Tile): boolean {
    let x0 = a.col;
    let y0 = a.row;
    const x1 = b.col;
    const y1 = b.row;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      if (!(x0 === a.col && y0 === a.row) && !(x0 === x1 && y0 === y1) && this.isWall(x0, y0)) return false;
      if (x0 === x1 && y0 === y1) return true;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  sees(actor: Tile, h: Placed): boolean {
    const R = HAZARD_GEOMETRY[h.kind].sightRadius;
    return h.cells.some((t) => Math.hypot(t.col - actor.col, t.row - actor.row) <= R && this.los(actor, t));
  }

  /** Passability for an actor given blocked tiles. mode A: static clearance mask; mode B: clearance recomputed. */
  passFn(wheelchair: boolean, blocked: Set<string>, mode: 'A' | 'B') {
    const free = (c: number, r: number) => this.walkable(c, r) && !blocked.has(this.key(c, r));
    if (!wheelchair) return free;
    if (mode === 'A') return (c: number, r: number) => free(c, r) && this.map.accessible[this.i(c, r)];
    return (c: number, r: number) => {
      if (!free(c, r)) return false;
      for (const [dc, dr] of [
        [0, 0],
        [-1, 0],
        [0, -1],
        [-1, -1],
      ]) {
        const c0 = c + dc;
        const r0 = r + dr;
        if (free(c0, r0) && free(c0 + 1, r0) && free(c0, r0 + 1) && free(c0 + 1, r0 + 1)) return true;
      }
      return false;
    };
  }

  /** Dijkstra (occluded tiles cost 3, like the engine) → tile path to the nearest assembly tile, or null. */
  routeToAssembly(start: Tile, pass: (c: number, r: number) => boolean): Tile[] | null {
    const goal = new Set(this.map.assembly.tiles.map((t) => this.key(t.col, t.row)));
    const dist = new Map<string, number>();
    const prev = new Map<string, string>();
    const sk = this.key(start.col, start.row);
    dist.set(sk, 0);
    const open = new Set<string>([sk]);
    while (open.size) {
      let best = '';
      let bd = Infinity;
      for (const k of open) {
        const d = dist.get(k)!;
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
      open.delete(best);
      const [c, r] = best.split(',').map(Number);
      if (goal.has(best)) {
        const path: Tile[] = [];
        let k: string | undefined = best;
        while (k) {
          const [pc, pr] = k.split(',').map(Number);
          path.unshift({ col: pc, row: pr });
          k = prev.get(k);
        }
        return path;
      }
      for (const [dc, dr] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ]) {
        const nc = c + dc;
        const nr = r + dr;
        if (!pass(nc, nr)) continue;
        const nk = this.key(nc, nr);
        const nd = bd + (this.map.occluded[this.i(nc, nr)] ? 3 : 1);
        if (nd < (dist.get(nk) ?? Infinity)) {
          dist.set(nk, nd);
          prev.set(nk, best);
          open.add(nk);
        }
      }
    }
    return null;
  }

  zoneSequence(path: Tile[]): ZoneId[] {
    const seq: ZoneId[] = [];
    for (const t of path) {
      const z = this.zoneAt(t.col, t.row);
      if (z && seq[seq.length - 1] !== z) seq.push(z);
    }
    return seq;
  }
}

// ---------------------------------------------------------------------------
// Placement validation (mirrors the engine's rules; cross-checked against the engine when importable)
// ---------------------------------------------------------------------------

export function validPlacement(g: Grid, p: Placed, occupied: Tile[], others: Placed[]): boolean {
  const otherCells = new Set(others.flatMap((o) => o.cells.map((t) => g.key(t.col, t.row))));
  const occ = new Set(occupied.map((t) => g.key(t.col, t.row)));
  if (p.kind === 'fire') {
    for (const t of p.cells) {
      if (!g.inb(t.col, t.row)) return false;
      if (g.map.terrain[g.i(t.col, t.row)] !== 'floor') return false;
      if (!g.walkable(t.col, t.row)) return false; // furniture
      const zdef = g.map.zones.find((d) => d.id === g.zoneAt(t.col, t.row));
      if (!zdef || !zdef.hazardPlaceable) return false;
    }
  } else {
    if (!p.componentId) return false;
    if (others.some((o) => o.kind === 'electrical' && o.componentId === p.componentId)) return false;
  }
  if (p.cells.some((t) => occ.has(g.key(t.col, t.row)))) return false;
  if (p.cells.some((t) => otherCells.has(g.key(t.col, t.row)))) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------

function inFireFamily(g: Grid, fam: FireFamilyDef, col: number, row: number): boolean {
  const fp = g.fireSeed(col, row);
  if (!fp.every((t) => g.zoneAt(t.col, t.row) === fam.zone)) return false;
  const b = fam.box;
  return !b || fp.every((t) => t.col >= b.cols[0] && t.col <= b.cols[1] && t.row >= b.rows[0] && t.row <= b.rows[1]);
}

/** The electric doors that seal a room (components in the door zones next to it). */
function sealingDoors(g: Grid, room: ZoneId): DoorComponent[] {
  const nbrs = new Set(g.map.zoneEdges.flatMap(([a, b]) => (a === room ? [b] : b === room ? [a] : [])));
  return g.map.components.filter((d) => nbrs.has(d.zone));
}

const shortName = (g: Grid, z: ZoneId) => (g.map.zones.find((d) => d.id === z)?.name ?? z).replace(/^the /, '');

function solvability(g: Grid, spawns: Record<ActorId, SpawnSpot>, hazards: Placed[]) {
  const blocked = new Set<string>();
  for (const h of hazards) for (const t of h.cells) blocked.add(g.key(t.col, t.row));
  const res: Record<'A' | 'B', Record<ActorId, Tile[] | null>> = { A: {} as never, B: {} as never };
  for (const mode of ['A', 'B'] as const) {
    for (const a of ACTORS) res[mode][a] = g.routeToAssembly(spawns[a], g.passFn(ACTOR_PROFILES[a].usesWheelchair, blocked, mode));
  }
  const solvableA = ACTORS.every((a) => res.A[a] !== null);
  const solvableB = ACTORS.every((a) => res.B[a] !== null);
  return { agree: solvableA === solvableB, solvable: solvableA && solvableB, routes: res.B };
}

// ---------------------------------------------------------------------------
// Case construction
// ---------------------------------------------------------------------------

function sampleSpawns(g: Grid, rng: Rng): Record<ActorId, SpawnSpot> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const s = Object.fromEntries(ACTORS.map((a) => [a, pick(rng, g.map.spawnSpots[a])])) as Record<ActorId, SpawnSpot>;
    const keys = new Set(ACTORS.map((a) => g.key(s[a].col, s[a].row)));
    if (keys.size === ACTORS.length) return s;
  }
  throw new Error('could not sample non-overlapping spawns');
}

const spawnTiles = (spawns: Record<ActorId, SpawnSpot>): Tile[] => ACTORS.map((a) => spawns[a]);

function fireCandidates(g: Grid, fam: FireFamilyDef, spawns: Record<ActorId, SpawnSpot>, others: Placed[], minDistFromSpawns = 0): Placed[] {
  const out: Placed[] = [];
  for (let r = 0; r < g.map.rows; r++) {
    for (let c = 0; c < g.map.cols; c++) {
      if (!inFireFamily(g, fam, c, r)) continue;
      const p = g.placedFire(c, r);
      if (!validPlacement(g, p, spawnTiles(spawns), others)) continue;
      if (minDistFromSpawns > 0 && p.cells.some((t) => spawnTiles(spawns).some((s) => Math.max(Math.abs(s.col - t.col), Math.abs(s.row - t.row)) < minDistFromSpawns))) continue;
      out.push(p);
    }
  }
  return out;
}

const seenBy = (g: Grid, spawns: Record<ActorId, SpawnSpot>, h: Placed): ActorId[] => ACTORS.filter((a) => g.sees(spawns[a], h));

/** Drop a door failure mid-evacuation: when anyone enters the zone just before the door on a route that uses it. */
function doorTrigger(g: Grid, routes: Record<ActorId, Tile[] | null>, door: DoorComponent, rng: Rng): ScheduledEvent['trigger'] {
  const doorKeys = new Set(door.tiles.map((t) => g.key(t.col, t.row)));
  for (const a of ACTORS) {
    const p = routes[a];
    if (!p) continue;
    const at = p.findIndex((t) => doorKeys.has(g.key(t.col, t.row)));
    if (at < 0) continue;
    const seq = g.zoneSequence(p.slice(0, at)); // zones walked before reaching the door
    if (seq.length >= 2) return { type: 'actor_enters_zone', actor: 'any', zone: seq[seq.length - 1] };
  }
  // The door is right next to someone's start room: fail it shortly after the incident instead
  // (the engine retries a blocked placement for 3 s if someone is standing in the doorway).
  return { type: 'at_time', simTime: 3 + Math.floor(rng() * 3) };
}

interface Built {
  scenario: ScenarioCase;
  fireFamily: string;
  doors: string[];
  fireSeenBy: ActorId[];
  /** Placements to cross-check with the engine: actors given = positions known at drop time (t=1 s), else []. */
  checks: { p: Placed; actors: Tile[]; before: Placed[] }[];
}

function buildCase(
  g: Grid,
  rng: Rng,
  split: 'dev' | 'test',
  family: CaseFamily,
  fam: FireFamilyDef,
  otherFam: FireFamilyDef,
  n: number,
  usedKeys: Set<string>,
): Built | null {
  for (let attempt = 0; attempt < 400; attempt++) {
    const seed = Math.floor(rng() * 2 ** 31);
    const crng = mulberry32(seed);
    const spawns = sampleSpawns(g, crng);
    const fires = fireCandidates(g, fam, spawns, []);
    if (!fires.length) continue;
    // Prefer fires someone can see at t=1 s; corridor fires are usually only smelled (15 s rule).
    const visible = fires.filter((f) => seenBy(g, spawns, f).length > 0);
    const fire = pick(crng, visible.length && fam.preferVisible !== false ? visible : fires);
    const fireOnly = solvability(g, spawns, [fire]);
    if (!fireOnly.agree || !fireOnly.solvable) continue;

    const events: ScheduledEvent[] = [
      { id: 'ev-fire', trigger: { type: 'at_time', simTime: 1 }, action: { type: 'place_hazard', kind: 'fire', col: fire.col, row: fire.row } },
    ];
    const checks: Built['checks'] = [{ p: fire, actors: spawnTiles(spawns), before: [] }];
    const placed: Placed[] = [fire];
    let solvable = true;
    let expectLosses = false;
    let primaryRouteBlocked = false;
    const doors: string[] = [];
    let notes = `Fire seed (${fam.id}) at t=1 s.`;
    const danielPreference = family === 'independent' ? 'independent' : 'buddy';

    if (family === 'multi_fire') {
      const seconds = fireCandidates(g, otherFam, spawns, placed, 3);
      const options = seconds.filter((s) => {
        const both = solvability(g, spawns, [fire, s]);
        return both.agree && both.solvable;
      });
      if (!options.length) continue;
      const second = pick(crng, options);
      const t = 4 + Math.floor(crng() * 5);
      events.push({ id: 'ev-fire-2', trigger: { type: 'at_time', simTime: t }, action: { type: 'place_hazard', kind: 'fire', col: second.col, row: second.row } });
      checks.push({ p: second, actors: [], before: [fire] });
      placed.push(second);
      notes += ` Second fire seed (${otherFam.id}) at t=${t} s.`;
    }

    const wantsDoor = family === 'fire_then_door' || (family === 'independent' && crng() < 0.5);
    if (wantsDoor) {
      const routeKeys = new Set(ACTORS.flatMap((a) => (fireOnly.routes[a] ?? []).map((t) => g.key(t.col, t.row))));
      const options = g.map.components.filter((d) => {
        const p = g.placedDoor(d.id);
        if (!d.tiles.some((t) => routeKeys.has(g.key(t.col, t.row)))) return false; // must be on someone's route
        if (!validPlacement(g, p, [], placed)) return false;
        const both = solvability(g, spawns, [...placed, p]);
        return both.agree && both.solvable;
      });
      if (!options.length) continue;
      const door = pick(crng, options);
      const p = g.placedDoor(door.id);
      const trigger = doorTrigger(g, fireOnly.routes, door, crng);
      events.push({ id: 'ev-door', trigger, action: { type: 'place_hazard', kind: 'electrical', col: p.col, row: p.row } });
      checks.push({ p, actors: [], before: [...placed] });
      placed.push(p);
      doors.push(door.id);
      primaryRouteBlocked = true;
      notes += ` Electrical failure jams ${door.id} ${trigger.type === 'actor_enters_zone' ? `when someone enters ${trigger.zone}` : `at t=${(trigger as { simTime: number }).simTime} s`}; an alternate route exists.`;
    }

    if (family === 'trapped') {
      // Seal the room: fire inside + every one of its doors fails at t=1 s.
      const room = fam.zone;
      if (!sealableRooms(g.map).includes(room)) throw new Error(`trapped family ${fam.id}: ${room} is not sealable`);
      if (!ACTORS.some((a) => g.zoneAt(spawns[a].col, spawns[a].row) === room)) continue;
      if (!fire.cells.every((t) => g.zoneAt(t.col, t.row) === room)) continue;
      const sealing = sealingDoors(g, room);
      for (const d of sealing) {
        const p = g.placedDoor(d.id);
        if (!validPlacement(g, p, spawnTiles(spawns), placed)) break;
        events.push({ id: `ev-${d.id}`, trigger: { type: 'at_time', simTime: 1 }, action: { type: 'place_hazard', kind: 'electrical', col: p.col, row: p.row } });
        checks.push({ p, actors: spawnTiles(spawns), before: [...placed] });
        placed.push(p);
        doors.push(d.id);
      }
      if (doors.length !== sealing.length) continue;
      const all = solvability(g, spawns, placed);
      if (!all.agree || all.solvable) continue;
      solvable = false;
      expectLosses = true;
      const which = sealing.length === 1 ? `The ${shortName(g, room)} door fails` : `${sealing.length === 2 ? 'Both' : `All ${sealing.length}`} ${shortName(g, room)} doors fail`;
      notes += ` ${which} at t=1 s with the fire inside: the room is sealed, so its occupants are expected to be lost. Honest outcomes: partial or failed, never success.`;
    }
    if (family === 'independent') notes += ` ${ACTOR_PROFILES[ASSISTANCE.person].name} prefers to evacuate independently (no buddy).`;

    const sig = JSON.stringify([spawns, events.map((e) => e.action), danielPreference]);
    if (usedKeys.has(sig)) continue;
    usedKeys.add(sig);

    const scenario: ScenarioCase = {
      caseId: `${split}-${String(n).padStart(2, '0')}-${family}`,
      split,
      family,
      seed,
      mapId: g.map.id,
      spawns,
      danielPreference,
      events,
      labels: { solvable, primaryRouteBlocked, ...(expectLosses ? { expectLosses } : {}), notes },
    };
    return { scenario, fireFamily: fam.id, doors, fireSeenBy: seenBy(g, spawns, fire), checks };
  }
  return null;
}

// Per-split plan: [family, count]
const PLAN: Record<'dev' | 'test', [CaseFamily, number][]> = {
  dev: [
    ['fire_only', 4],
    ['multi_fire', 3],
    ['fire_then_door', 5],
    ['independent', 2],
    ['trapped', 1],
  ],
  test: [
    ['fire_only', 4],
    ['multi_fire', 3],
    ['fire_then_door', 5],
    ['independent', 2],
    ['trapped', 2],
  ],
};

function heroCase(g: Grid): Built {
  // The scripted hero story (demo-hero's people + hero-story.json's hazards), so the benchmark can run it.
  const scenario = heroStoryCase(loadDemoHero(), loadHeroStory());
  const placed: Placed[] = [];
  const checks: Built['checks'] = [];
  const doors: string[] = [];
  for (const ev of scenario.events) {
    if (ev.action.kind === 'fire') {
      const p = g.placedFire(ev.action.col, ev.action.row);
      checks.push({ p, actors: ev.trigger.type === 'at_time' && ev.trigger.simTime <= 1 ? spawnTiles(scenario.spawns) : [], before: [...placed] });
      placed.push(p);
    } else {
      const comp = g.doorNear(ev.action.col, ev.action.row);
      if (!comp) throw new Error('hero-story electrical event is not on a sliding door');
      const p = g.placedDoor(comp.id);
      checks.push({ p, actors: [], before: [...placed] });
      placed.push(p);
      doors.push(comp.id);
    }
  }
  const s = solvability(g, scenario.spawns, placed);
  if (!s.agree || !s.solvable) throw new Error('the hero story must be solvable with all its hazards present');
  const fire = placed.find((p) => p.kind === 'fire');
  return { scenario, fireFamily: 'hero', doors, fireSeenBy: fire ? seenBy(g, scenario.spawns, fire) : [], checks };
}

// ---------------------------------------------------------------------------
// Optional cross-check against the engine's own validatePlacement (if the engine module loads)
// ---------------------------------------------------------------------------

interface EngineValidator {
  validatePlacement: (
    map: MapData,
    state: { hazards: unknown[]; actors: { col: number; row: number }[] },
    kind: HazardKind,
    col: number,
    row: number,
  ) => { ok: boolean; code?: string; reason?: string };
}

async function loadEngineValidator(): Promise<EngineValidator | null> {
  const modPath = '../../packages/engine/src/index.js'; // non-literal: keeps this script's typecheck independent of the engine
  try {
    const eng = (await import(/* @vite-ignore */ modPath)) as Partial<EngineValidator> & { HAZARD_SPECS?: Record<string, unknown> };
    if (typeof eng.validatePlacement === 'function' && eng.HAZARD_SPECS && 'electrical' in eng.HAZARD_SPECS) return eng as EngineValidator;
  } catch {
    /* engine not importable yet */
  }
  return null;
}

function toSnapshot(p: Placed, i: number) {
  return {
    id: `H${i + 1}`,
    kind: p.kind,
    col: p.col,
    row: p.row,
    cells: p.cells,
    charred: [],
    noGo: p.cells,
    ...(p.componentId ? { componentId: p.componentId } : {}),
    placedAtSimTime: 1,
  };
}

function crossCheck(eng: EngineValidator, map: MapData, built: Built): string | null {
  for (const c of built.checks) {
    const r = eng.validatePlacement(map, { hazards: c.before.map(toSnapshot), actors: c.actors }, c.p.kind, c.p.col, c.p.row);
    if (!r.ok) return `${built.scenario.caseId}: engine rejects ${c.p.kind} at (${c.p.col},${c.p.row}): ${r.code} ${r.reason ?? ''}`;
  }
  return null;
}

// ---------------------------------------------------------------------------

async function main() {
  const check = process.argv.includes('--check');
  const mapPath = join(root, `data/maps/${DEFAULT_MAP_ID}.json`);
  const map = JSON.parse(readFileSync(mapPath, 'utf8')) as MapData;
  if (!map.components?.length) throw new Error('map has no sliding-door components; rebuild with npm run data:map');
  const spec = SPECS[map.id];
  if (!spec) throw new Error(`no scenario spec for map ${map.id} (add it to SPECS)`);
  const g = new Grid(map);
  const heroPath = join(here, 'demo-hero.json');
  const storyPath = join(here, 'hero-story.json');
  const eng = await loadEngineValidator();

  const rng = mulberry32(MASTER_SEED);
  const out: Record<'dev' | 'test', Built[]> = { dev: [heroCase(g)], test: [] };
  const used = new Set<string>();
  for (const split of ['dev', 'test'] as const) {
    const fams = spec.families[split];
    const trappedFam = fams.find((f) => f.id === spec.trapped[split]);
    if (!trappedFam) throw new Error(`trapped family ${spec.trapped[split]} is not a ${split} fire family`);
    let n = 1;
    for (const [family, count] of PLAN[split]) {
      for (let k = 0; k < count; k++) {
        // Rotate through the fire-location families; trapped cases always burn inside the sealable room.
        const order: FireFamilyDef[] = family === 'trapped' ? [trappedFam] : [...fams.slice(k % fams.length), ...fams.slice(0, k % fams.length)];
        let built: Built | null = null;
        for (const fam of order) {
          const other = fams[(fams.indexOf(fam) + 1) % fams.length];
          for (let tries = 0; tries < 5 && !built; tries++) {
            const b = buildCase(g, rng, split, family, fam, other, n, used);
            if (b && eng) {
              const err = crossCheck(eng, map, b);
              if (err) {
                console.warn(`[generator] discarding: ${err}`);
                continue;
              }
            }
            built = b;
          }
          if (built) break;
        }
        if (!built) throw new Error(`could not build ${split} ${family} #${k}`);
        out[split].push(built);
        n++;
      }
    }
  }
  if (eng) {
    const err = crossCheck(eng, map, out.dev[0]);
    if (err) throw new Error(err);
  }

  const files: Record<string, string> = {};
  for (const split of ['dev', 'test'] as const) {
    files[`cases.${split}.jsonl`] = out[split].map((b) => JSON.stringify(b.scenario)).join('\n') + '\n';
  }
  const splits = {
    dataset: spec.dataset,
    ruleset: 2,
    structural_holdout: {
      description: 'Dev and test use disjoint fire-location families; test fire placements never appear in dev.',
      dev_fire_families: spec.families.dev.map((f) => f.id),
      test_fire_families: spec.families.test.map((f) => f.id),
    },
    splits: Object.fromEntries(
      (['dev', 'test'] as const).map((split) => [
        split,
        out[split].map((b) => ({
          caseId: b.scenario.caseId,
          family: b.scenario.family,
          fireFamily: b.fireFamily,
          doors: b.doors,
          fires: b.scenario.events.filter((e) => e.action.kind === 'fire').length,
          solvable: b.scenario.labels.solvable,
          expectLosses: b.scenario.labels.expectLosses ?? false,
          primaryRouteBlocked: b.scenario.labels.primaryRouteBlocked,
          danielPreference: b.scenario.danielPreference,
          fireInitiallySeenBy: b.fireSeenBy,
        })),
      ]),
    ),
  };
  files['splits.json'] = JSON.stringify(splits, null, 2) + '\n';

  if (check) {
    for (const [name, content] of Object.entries(files)) {
      let current = '';
      try {
        current = readFileSync(join(here, name), 'utf8');
      } catch {
        /* missing */
      }
      console.log(`${current === content ? 'unchanged' : 'WOULD CHANGE'}  ${name}`);
    }
    console.log(`engine cross-check: ${eng ? 'on' : 'OFF'} · dev ${out.dev.length} · test ${out.test.length} cases (nothing written)`);
    return;
  }
  for (const [name, content] of Object.entries(files)) writeFileSync(join(here, name), content);
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const provenance = {
    dataset: spec.dataset,
    ruleset: 2,
    license: 'CC-BY-4.0',
    synthetic: true,
    created: '2026-10-17',
    created_during: 'NVIDIA x Red Hat Small Models Hack, Raleigh NC, 2026-10-17/18',
    generator: { path: 'data/scenarios/generator.ts', version: GENERATOR_VERSION, master_seed: MASTER_SEED },
    map: { id: map.id, hash: map.hash, source: `data/maps/${map.id}.ascii + data/maps/${map.id}.spec.ts (data/maps/builder.ts)` },
    method:
      'Seeded sampling of spawns (map.spawnSpots), 2×2 fire seeds from fire-location families (dev/test disjoint), second fire seeds (multi_fire), and electrical failures on interior sliding doors chosen against oracle shortest routes; solvability labels from a full-knowledge grid search at placement time (Daniel on wheelchair-clearance tiles). Fire spread happens later in the engine (seeded, stochastic). No real-world measurements are included.',
    hazard_geometry: HAZARD_GEOMETRY,
    engine_cross_check: eng ? 'every placement validated with packages/engine validatePlacement' : 'engine not importable at generation time; local checks only',
    inputs: {
      'demo-hero.json': sha(readFileSync(heroPath, 'utf8')),
      'hero-story.json': sha(readFileSync(storyPath, 'utf8')),
      [`${map.id}.json`]: sha(readFileSync(mapPath, 'utf8')),
    },
    outputs: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha(v)])),
    counts: Object.fromEntries((['dev', 'test'] as const).map((s) => [s, out[s].length])),
  };
  writeFileSync(join(here, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');

  console.log(`engine cross-check: ${eng ? 'on' : 'OFF (engine not importable; local checks only)'}`);
  for (const split of ['dev', 'test'] as const) {
    const byFam: Record<string, number> = {};
    for (const b of out[split]) byFam[b.scenario.family] = (byFam[b.scenario.family] ?? 0) + 1;
    console.log(`${split}: ${out[split].length} cases`, byFam);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
