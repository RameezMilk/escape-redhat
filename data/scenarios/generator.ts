// Generates the escape-office-scenarios-v1 benchmark dataset (synthetic, deterministic).
//
//   npm run data:scenarios
//
// Inputs:  data/maps/office-v1.json (built by data/maps/build-map.ts), data/scenarios/demo-hero.json
// Outputs: data/scenarios/cases.dev.jsonl, cases.test.jsonl, splits.json, provenance.json
//
// Method (see DATASET_CARD.md):
//  1. Spawns: one seeded pick per actor from map.spawnSpots (non-overlapping; Daniel's spots are wheelchair-accessible).
//  2. Fire: a valid 2×2 placement sampled from a *fire-location family*. Dev and test use DISJOINT families
//     (structural hold-out): dev = rh_room near door A, lobby; test = north_corridor, rh_room near door B.
//  3. Blocker (fire_then_blocker / independent): a 2×2 placement on a chokepoint that lies on some actor's
//     shortest route given the fire, chosen so an alternate route still exists. It is scheduled to drop when any
//     actor enters a zone just before the chokepoint on that route (mid-evacuation).
//  4. Unsolvable: fire + chokepoint blocker that leave at least one person with no route to assembly.
//  5. Labels are computed from the map with full (oracle) knowledge: solvable iff every actor can reach the
//     assembly area with all hazards present (Daniel on wheelchair-clearance tiles). Labels are required to agree
//     under two clearance interpretations (static mask minus hazard tiles, and clearance recomputed around hazards).
// The oracle is used only for labels/scoring, never shown to the planner.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ActorId,
  CaseFamily,
  HazardKind,
  MapData,
  ScenarioCase,
  ScheduledEvent,
  SpawnSpot,
  Tile,
  ZoneId,
} from '../../packages/contracts/src/types.js';

export const GENERATOR_VERSION = '1.0.0';
export const MASTER_SEED = 20261017;
const ACTORS: ActorId[] = ['alex', 'maya', 'daniel'];

/** Must match the engine's hazard geometry. */
export const HAZARD_SPECS: Record<HazardKind, { w: number; h: number; buffer: number; sightRadius: number }> = {
  fire: { w: 2, h: 2, buffer: 1, sightRadius: 8 },
  blocker: { w: 2, h: 2, buffer: 0, sightRadius: 4 },
};

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

export class Grid {
  constructor(readonly map: MapData) {}
  inb = (c: number, r: number) => c >= 0 && r >= 0 && c < this.map.cols && r < this.map.rows;
  i = (c: number, r: number) => r * this.map.cols + c;
  key = (c: number, r: number) => `${c},${r}`;
  zoneAt = (c: number, r: number): ZoneId | null => (this.inb(c, r) ? this.map.zone[this.i(c, r)] : null);
  isWall = (c: number, r: number) => !this.inb(c, r) || this.map.terrain[this.i(c, r)] === 'wall';
  walkable = (c: number, r: number) => this.inb(c, r) && this.map.walkable[this.i(c, r)];

  footprint(kind: HazardKind, col: number, row: number): Tile[] {
    const s = HAZARD_SPECS[kind];
    const out: Tile[] = [];
    for (let dr = 0; dr < s.h; dr++) for (let dc = 0; dc < s.w; dc++) out.push({ col: col + dc, row: row + dr });
    return out;
  }

  noGo(kind: HazardKind, col: number, row: number): Tile[] {
    const s = HAZARD_SPECS[kind];
    const out: Tile[] = [];
    for (let r = row - s.buffer; r < row + s.h + s.buffer; r++)
      for (let c = col - s.buffer; c < col + s.w + s.buffer; c++) if (this.inb(c, r)) out.push({ col: c, row: r });
    return out;
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

  sees(actor: Tile, kind: HazardKind, col: number, row: number): boolean {
    const R = HAZARD_SPECS[kind].sightRadius;
    return this.footprint(kind, col, row).some(
      (t) => Math.hypot(t.col - actor.col, t.row - actor.row) <= R && this.los(actor, t),
    );
  }

  /** Passability for an actor given hazard no-go tiles. mode A: static clearance mask; mode B: clearance recomputed. */
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
    // small grid: simple O(n^2) Dijkstra is fine
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
// Placement validation (mirrors the plan's rules; engine re-validates at runtime)
// ---------------------------------------------------------------------------

export function validPlacement(
  g: Grid,
  kind: HazardKind,
  col: number,
  row: number,
  occupied: Tile[],
  other?: { kind: HazardKind; col: number; row: number },
): boolean {
  const fp = g.footprint(kind, col, row);
  for (const t of fp) {
    if (!g.inb(t.col, t.row)) return false;
    if (g.map.terrain[g.i(t.col, t.row)] !== 'floor') return false;
    if (!g.walkable(t.col, t.row)) return false; // furniture
    const z = g.zoneAt(t.col, t.row);
    const zdef = g.map.zones.find((d) => d.id === z);
    if (!zdef || !zdef.hazardPlaceable) return false;
  }
  const ng = new Set(g.noGo(kind, col, row).map((t) => g.key(t.col, t.row)));
  if (occupied.some((t) => ng.has(g.key(t.col, t.row)))) return false;
  if (other) {
    const otherFp = new Set(g.noGo(other.kind, other.col, other.row).map((t) => g.key(t.col, t.row)));
    if (fp.some((t) => otherFp.has(g.key(t.col, t.row)))) return false;
    const otherCore = new Set(g.footprint(other.kind, other.col, other.row).map((t) => g.key(t.col, t.row)));
    if ([...ng].some((k) => otherCore.has(k))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------

type FireFamily = 'rh_room_doorA' | 'lobby' | 'north_corridor' | 'rh_room_doorB';
const DEV_FIRE_FAMILIES: FireFamily[] = ['rh_room_doorA', 'lobby'];
const TEST_FIRE_FAMILIES: FireFamily[] = ['north_corridor', 'rh_room_doorB'];

function inFireFamily(g: Grid, fam: FireFamily, col: number, row: number): boolean {
  const fp = g.footprint('fire', col, row);
  const zones = new Set(fp.map((t) => g.zoneAt(t.col, t.row)));
  const all = (z: ZoneId) => zones.size === 1 && zones.has(z);
  switch (fam) {
    case 'rh_room_doorA': // inside the Red Hat room, within 4 tiles of door A (8..9, 4)
      return all('rh_room') && fp.every((t) => t.row <= 8 && t.col >= 5 && t.col <= 12);
    case 'rh_room_doorB': // inside the Red Hat room, within 4 tiles of door B (18, 9..10)
      return all('rh_room') && fp.every((t) => t.col >= 14 && t.row >= 7 && t.row <= 12);
    case 'lobby':
      return all('lobby');
    case 'north_corridor':
      return all('north_corridor');
  }
}

/** Chokepoint blocker positions (top-left of 2×2) and the zone they cut. */
const CHOKEPOINTS: { id: string; col: number; row: number; zone: ZoneId }[] = [
  { id: 'south_branch', col: 26, row: 15, zone: 'south_branch' },
  { id: 'connector', col: 27, row: 4, zone: 'connector' },
  { id: 'door_b', col: 18, row: 9, zone: 'door_b' },
  { id: 'door_a', col: 8, row: 4, zone: 'door_a' },
  { id: 'corridor_west_end', col: 4, row: 1, zone: 'north_corridor' },
];

interface Placed {
  kind: HazardKind;
  col: number;
  row: number;
}

function solvability(g: Grid, spawns: Record<ActorId, SpawnSpot>, hazards: Placed[]) {
  const blocked = new Set<string>();
  for (const h of hazards) for (const t of g.noGo(h.kind, h.col, h.row)) blocked.add(g.key(t.col, t.row));
  const res: Record<'A' | 'B', Record<ActorId, Tile[] | null>> = { A: {} as never, B: {} as never };
  for (const mode of ['A', 'B'] as const) {
    for (const a of ACTORS) res[mode][a] = g.routeToAssembly(spawns[a], g.passFn(a === 'daniel', blocked, mode));
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

/** Tiles people occupy when scheduled hazards drop at t=1 s (ambient wandering starts later). */
function busyTiles(_g: Grid, spawns: Record<ActorId, SpawnSpot>): Tile[] {
  return ACTORS.map((a) => spawns[a]);
}

function fireCandidates(g: Grid, fam: FireFamily, spawns: Record<ActorId, SpawnSpot>): Placed[] {
  const busy = busyTiles(g, spawns);
  const out: Placed[] = [];
  for (let r = 0; r < g.map.rows; r++) {
    for (let c = 0; c < g.map.cols; c++) {
      if (!inFireFamily(g, fam, c, r)) continue;
      if (!validPlacement(g, 'fire', c, r, busy)) continue;
      out.push({ kind: 'fire', col: c, row: r });
    }
  }
  return out;
}

function seenBy(g: Grid, spawns: Record<ActorId, SpawnSpot>, h: Placed): ActorId[] {
  return ACTORS.filter((a) => g.sees(spawns[a], h.kind, h.col, h.row));
}

function blockerTrigger(
  g: Grid,
  routes: Record<ActorId, Tile[] | null>,
  chokeZone: ZoneId,
): ScheduledEvent['trigger'] {
  // Drop the blocker when anyone enters the zone just before the chokepoint on a route that uses it
  // (excluding the route's start zone, which nobody "enters").
  for (const a of ACTORS) {
    const p = routes[a];
    if (!p) continue;
    const seq = g.zoneSequence(p);
    const k = seq.indexOf(chokeZone);
    if (k >= 2) return { type: 'actor_enters_zone', actor: 'any', zone: seq[k - 1] };
  }
  return { type: 'at_time', simTime: 6 };
}

interface Built {
  scenario: ScenarioCase;
  fireFamily: FireFamily | 'hero';
  chokepoint?: string;
  fireSeenBy: ActorId[];
}

function buildCase(
  g: Grid,
  rng: Rng,
  split: 'dev' | 'test',
  family: CaseFamily,
  fam: FireFamily,
  n: number,
  usedKeys: Set<string>,
): Built | null {
  for (let attempt = 0; attempt < 400; attempt++) {
    const seed = Math.floor(rng() * 2 ** 31);
    const crng = mulberry32(seed);
    const spawns = sampleSpawns(g, crng);
    const fires = fireCandidates(g, fam, spawns);
    if (!fires.length) continue;
    // Prefer fires someone can see at t=1s; corridor fires are usually only smelled (15 s rule).
    const visible = fires.filter((f) => seenBy(g, spawns, f).length > 0);
    const fire = pick(crng, visible.length && fam !== 'north_corridor' ? visible : fires);
    const fireOnly = solvability(g, spawns, [fire]);
    if (!fireOnly.agree || !fireOnly.solvable) continue;

    const events: ScheduledEvent[] = [
      { id: 'ev-fire', trigger: { type: 'at_time', simTime: 1 }, action: { type: 'place_hazard', kind: 'fire', col: fire.col, row: fire.row } },
    ];
    let solvable = true;
    let primaryRouteBlocked = false;
    let chokepoint: string | undefined;
    let notes = '';

    const danielPreference = family === 'independent' ? 'independent' : 'buddy';
    const wantsBlocker = family === 'fire_then_blocker' || family === 'unsolvable' || (family === 'independent' && rng() < 0.5);

    if (wantsBlocker) {
      const routeZones = new Set(ACTORS.flatMap((a) => (fireOnly.routes[a] ? g.zoneSequence(fireOnly.routes[a]!) : [])));
      const options = CHOKEPOINTS.filter((cp) => {
        if (!validPlacement(g, 'blocker', cp.col, cp.row, busyTiles(g, spawns), fire)) return false;
        const both = solvability(g, spawns, [fire, { kind: 'blocker', col: cp.col, row: cp.row }]);
        if (!both.agree) return false;
        if (family === 'unsolvable') return !both.solvable;
        // Mid-evacuation drops must be zone-entry triggered: a timed drop on a doorway can land on a person.
        return both.solvable && routeZones.has(cp.zone) && blockerTrigger(g, fireOnly.routes, cp.zone).type === 'actor_enters_zone';
      });
      if (!options.length) continue;
      const cp = pick(crng, options);
      chokepoint = cp.id;
      primaryRouteBlocked = routeZones.has(cp.zone);
      if (family === 'unsolvable') {
        solvable = false;
        events.push({ id: 'ev-blocker', trigger: { type: 'at_time', simTime: 1 }, action: { type: 'place_hazard', kind: 'blocker', col: cp.col, row: cp.row } });
        notes = `Fire (${fam}) plus a blocker at ${cp.id} leave at least one person with no route to assembly. Expected outcome: unresolved, never success.`;
      } else {
        events.push({ id: 'ev-blocker', trigger: blockerTrigger(g, fireOnly.routes, cp.zone), action: { type: 'place_hazard', kind: 'blocker', col: cp.col, row: cp.row } });
        notes = `Fire (${fam}); blocker drops at ${cp.id} mid-evacuation. An alternate route exists.`;
      }
    } else {
      notes = `Fire (${fam}); no blocker.`;
    }
    if (family === 'independent') notes += ' Daniel prefers to evacuate independently (no buddy).';

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
      labels: { solvable, primaryRouteBlocked, notes },
    };
    return { scenario, fireFamily: fam, chokepoint, fireSeenBy: seenBy(g, spawns, fire) };
  }
  return null;
}

// Per-split plan: [family, count]
const PLAN: Record<'dev' | 'test', [CaseFamily, number][]> = {
  dev: [
    ['fire_only', 5],
    ['fire_then_blocker', 6],
    ['independent', 2],
    ['unsolvable', 2],
  ],
  test: [
    ['fire_only', 5],
    ['fire_then_blocker', 6],
    ['independent', 3],
    ['unsolvable', 2],
  ],
};

function heroAuto(g: Grid, hero: ScenarioCase): Built {
  // The live demo case with its manual placements turned into scheduled triggers so the benchmark can run it.
  const fire = hero.events.find((e) => e.action.kind === 'fire')!;
  const blocker = hero.events.find((e) => e.action.kind === 'blocker')!;
  const scenario: ScenarioCase = {
    ...hero,
    caseId: 'dev-00-hero',
    split: 'dev',
    family: 'hero',
    events: [
      { ...fire, trigger: { type: 'at_time', simTime: 1 } },
      { ...blocker, trigger: { type: 'actor_enters_zone', actor: 'any', zone: 'lobby' } },
    ],
    labels: { ...hero.labels, notes: 'Automated version of demo-hero: fire at t=1s, blocker when anyone enters the lobby.' },
  };
  const s = solvability(g, hero.spawns, [
    { kind: 'fire', col: fire.action.col, row: fire.action.row },
    { kind: 'blocker', col: blocker.action.col, row: blocker.action.row },
  ]);
  if (!s.agree || !s.solvable) throw new Error('demo-hero must be solvable with both hazards present');
  return { scenario, fireFamily: 'hero', chokepoint: 'south_branch', fireSeenBy: seenBy(g, hero.spawns, { kind: 'fire', col: fire.action.col, row: fire.action.row }) };
}

function main() {
  const mapPath = join(root, 'data/maps/office-v1.json');
  const map = JSON.parse(readFileSync(mapPath, 'utf8')) as MapData;
  const g = new Grid(map);
  const heroPath = join(here, 'demo-hero.json');
  const hero = JSON.parse(readFileSync(heroPath, 'utf8')) as ScenarioCase;

  const rng = mulberry32(MASTER_SEED);
  const out: Record<'dev' | 'test', Built[]> = { dev: [heroAuto(g, hero)], test: [] };
  const used = new Set<string>();
  for (const split of ['dev', 'test'] as const) {
    const fams = split === 'dev' ? DEV_FIRE_FAMILIES : TEST_FIRE_FAMILIES;
    let n = split === 'dev' ? 1 : 1;
    for (const [family, count] of PLAN[split]) {
      for (let k = 0; k < count; k++) {
        // Alternate fire-location families; fall back to the other family if a combination is impossible.
        const order = k % 2 === 0 ? fams : [...fams].reverse();
        let built: Built | null = null;
        for (const fam of order) {
          built = buildCase(g, rng, split, family, fam, n, used);
          if (built) break;
        }
        if (!built) throw new Error(`could not build ${split} ${family} #${k}`);
        out[split].push(built);
        n++;
      }
    }
  }

  const files: Record<string, string> = {};
  for (const split of ['dev', 'test'] as const) {
    files[`cases.${split}.jsonl`] = out[split].map((b) => JSON.stringify(b.scenario)).join('\n') + '\n';
  }
  const splits = {
    dataset: 'escape-office-scenarios-v1',
    structural_holdout: {
      description: 'Dev and test use disjoint fire-location families; test fire placements never appear in dev.',
      dev_fire_families: DEV_FIRE_FAMILIES,
      test_fire_families: TEST_FIRE_FAMILIES,
    },
    splits: Object.fromEntries(
      (['dev', 'test'] as const).map((split) => [
        split,
        out[split].map((b) => ({
          caseId: b.scenario.caseId,
          family: b.scenario.family,
          fireFamily: b.fireFamily,
          chokepoint: b.chokepoint ?? null,
          solvable: b.scenario.labels.solvable,
          primaryRouteBlocked: b.scenario.labels.primaryRouteBlocked,
          danielPreference: b.scenario.danielPreference,
          fireInitiallySeenBy: b.fireSeenBy,
        })),
      ]),
    ),
  };
  files['splits.json'] = JSON.stringify(splits, null, 2) + '\n';

  for (const [name, content] of Object.entries(files)) writeFileSync(join(here, name), content);
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const provenance = {
    dataset: 'escape-office-scenarios-v1',
    license: 'CC-BY-4.0',
    synthetic: true,
    created: '2026-10-17',
    created_during: 'NVIDIA x Red Hat Small Models Hack, Raleigh NC, 2026-10-17/18',
    generator: { path: 'data/scenarios/generator.ts', version: GENERATOR_VERSION, master_seed: MASTER_SEED },
    map: { id: map.id, hash: map.hash, source: 'data/maps/office-v1.ascii + data/maps/build-map.ts' },
    method:
      'Seeded sampling of spawns (map.spawnSpots), fire placements from fire-location families (dev/test disjoint), and chokepoint blockers chosen against oracle shortest routes; solvability labels from a full-knowledge grid search (Daniel on wheelchair-clearance tiles). No real-world measurements are included.',
    hazard_specs: HAZARD_SPECS,
    inputs: { 'demo-hero.json': sha(readFileSync(heroPath, 'utf8')), 'office-v1.json': sha(readFileSync(mapPath, 'utf8')) },
    outputs: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha(v)])),
    counts: Object.fromEntries((['dev', 'test'] as const).map((s) => [s, out[s].length])),
  };
  writeFileSync(join(here, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');

  for (const split of ['dev', 'test'] as const) {
    const byFam: Record<string, number> = {};
    for (const b of out[split]) byFam[b.scenario.family] = (byFam[b.scenario.family] ?? 0) + 1;
    console.log(`${split}: ${out[split].length} cases`, byFam);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
