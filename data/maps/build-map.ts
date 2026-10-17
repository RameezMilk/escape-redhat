// Builds data/maps/office-v1.json from office-v1.ascii + the furniture list below.
// The ASCII is the source of truth for terrain/doors/exits; furniture footprints come from the
// vendored Pixel Agents manifests so the renderer and the engine agree on collisions.
//
//   npm run data:map
//
// Legend: '#' wall · '.' floor · ',' outdoor walkable · 'A'/'B' conference doors · 'C' lobby connector
//         'W'/'E' exits · 'X' assembly area · ' ' void
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ActorId,
  AlarmStation,
  ColorValue,
  DecorDef,
  DoorComponent,
  MapData,
  PlacedFurnitureDef,
  SpawnSpot,
  TerrainKind,
  Tile,
  ZoneDef,
  ZoneId,
} from '../../packages/contracts/src/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const FURNITURE_DIR = join(root, 'apps/web/public/assets/furniture');

const ascii = readFileSync(join(here, 'office-v1.ascii'), 'utf8').trimEnd().split('\n');
const rows = ascii.length;
const cols = ascii[0].length;
if (!ascii.every((l) => l.length === cols)) throw new Error('ASCII rows must all have the same width');

const idx = (c: number, r: number) => r * cols + c;
const ch = (c: number, r: number) => (c < 0 || r < 0 || c >= cols || r >= rows ? ' ' : ascii[r][c]);

// ---------------------------------------------------------------------------
// Terrain and zones
// ---------------------------------------------------------------------------

function terrainOf(c: number, r: number): TerrainKind {
  const x = ch(c, r);
  if (x === '#') return 'wall';
  if (x === ' ') return 'void';
  if (x === ',' || x === 'X') return 'outdoor';
  return 'floor';
}

function zoneOf(c: number, r: number): ZoneId | null {
  const x = ch(c, r);
  switch (x) {
    case 'W':
      return 'west_exit';
    case 'E':
      return 'east_exit';
    case 'A':
      return 'door_a';
    case 'B':
      return 'door_b';
    case 'C':
      return 'connector';
    case 'X':
      return 'assembly';
    case ',':
      return c <= 2 && r <= 18 ? 'west_sidewalk' : 'plaza';
    case '.':
      if (r >= 1 && r <= 3) return 'north_corridor';
      if (c >= 4 && c <= 17 && r >= 5 && r <= 17) return 'rh_room';
      if (c >= 19 && c <= 32 && r >= 5 && r <= 13) return 'lobby';
      if (c >= 26 && c <= 27 && r >= 14 && r <= 17) return 'south_branch';
      throw new Error(`floor tile (${c},${r}) has no zone rule`);
    default:
      return null;
  }
}

const ZONES: ZoneDef[] = [
  { id: 'rh_room', label: 'Red Hat conference room', kind: 'room', hazardPlaceable: true, anchor: { col: 11, row: 13 } },
  { id: 'door_a', label: 'Conference door A (north)', kind: 'door', hazardPlaceable: true, anchor: { col: 8, row: 4 } },
  { id: 'door_b', label: 'Conference door B (east)', kind: 'door', hazardPlaceable: true, anchor: { col: 18, row: 9 } },
  { id: 'north_corridor', label: 'North corridor', kind: 'corridor', hazardPlaceable: true, anchor: { col: 16, row: 2 } },
  { id: 'connector', label: 'Lobby connector (to north corridor)', kind: 'door', hazardPlaceable: true, anchor: { col: 27, row: 4 } },
  { id: 'lobby', label: 'NVIDIA lobby', kind: 'room', hazardPlaceable: true, anchor: { col: 25, row: 10 } },
  { id: 'south_branch', label: 'South branch (to east exit)', kind: 'corridor', hazardPlaceable: true, anchor: { col: 26, row: 16 } },
  { id: 'west_exit', label: 'West exit', kind: 'exit', hazardPlaceable: false, anchor: { col: 3, row: 1 } },
  { id: 'east_exit', label: 'East exit', kind: 'exit', hazardPlaceable: false, anchor: { col: 26, row: 18 } },
  { id: 'west_sidewalk', label: 'West sidewalk (outside)', kind: 'outdoor', hazardPlaceable: false, anchor: { col: 1, row: 10 } },
  { id: 'plaza', label: 'South plaza (outside)', kind: 'outdoor', hazardPlaceable: false, anchor: { col: 22, row: 20 } },
  { id: 'assembly', label: 'Assembly / check-in point', kind: 'assembly', hazardPlaceable: false, anchor: { col: 15, row: 20 } },
];

// ---------------------------------------------------------------------------
// Furniture (Pixel Agents catalog ids). Chairs are walkable (people sit on them).
// Keep corridors clear: furniture there would break wheelchair clearance on the alternate route.
// ---------------------------------------------------------------------------

const FURNITURE: { type: string; col: number; row: number; color?: ColorValue }[] = [
  // Red Hat room — conference table with chairs
  { type: 'TABLE_FRONT', col: 9, row: 8 },
  { type: 'WOODEN_CHAIR_SIDE', col: 8, row: 8 },
  { type: 'WOODEN_CHAIR_SIDE', col: 8, row: 10 },
  { type: 'WOODEN_CHAIR_SIDE:left', col: 12, row: 8 },
  { type: 'WOODEN_CHAIR_SIDE:left', col: 12, row: 10 },
  // Bookshelf that leaves a deliberate 1-wide gap (col 8) beside the table: walkable, NOT wheelchair-accessible
  { type: 'DOUBLE_BOOKSHELF', col: 6, row: 10 },
  // Maya's workstation near door A
  { type: 'DESK_FRONT', col: 12, row: 5 },
  { type: 'PC_FRONT_ON_1', col: 13, row: 5 },
  { type: 'WOODEN_CHAIR_BACK', col: 13, row: 6 },
  // Two workstations along the south wall
  { type: 'DESK_FRONT', col: 5, row: 14 },
  { type: 'PC_FRONT_ON_1', col: 6, row: 14 },
  { type: 'WOODEN_CHAIR_BACK', col: 6, row: 15 },
  { type: 'DESK_FRONT', col: 13, row: 14 },
  { type: 'PC_FRONT_ON_1', col: 14, row: 14 },
  { type: 'WOODEN_CHAIR_BACK', col: 14, row: 15 },
  // Room decor
  { type: 'PLANT', col: 4, row: 5 },
  { type: 'LARGE_PLANT', col: 16, row: 5 },
  { type: 'PLANT_2', col: 17, row: 15 },
  { type: 'BIN', col: 4, row: 13 },
  // NVIDIA lobby — warden desk
  { type: 'DESK_FRONT', col: 21, row: 6 },
  { type: 'PC_FRONT_ON_1', col: 22, row: 6 },
  { type: 'WOODEN_CHAIR_BACK', col: 22, row: 7 },
  // Lounge
  { type: 'SOFA_FRONT', col: 29, row: 9 },
  { type: 'COFFEE_TABLE', col: 29, row: 10 },
  { type: 'LARGE_PLANT', col: 31, row: 5 },
  { type: 'PLANT', col: 19, row: 11 },
  { type: 'CACTUS', col: 32, row: 11 },
];

const DECOR: DecorDef[] = [
  { kind: 'sign_redhat', col: 12, row: 4, label: 'RED HAT' },
  { kind: 'sign_nvidia', col: 21, row: 4, label: 'NVIDIA' },
  { kind: 'exit_sign', col: 3, row: 3, label: 'EXIT' },
  { kind: 'exit_sign', col: 28, row: 14, label: 'EXIT' },
  { kind: 'evac_plan', col: 18, row: 7, label: 'Evacuation plan' },
  { kind: 'checkin_flag', col: 15, row: 20, label: 'Assembly' },
];

// Electric sliding doors (interior only). Exit doors (W/E) are deliberately NOT electrical: exit doors must open from
// the inside without power, keys or special knowledge (29 CFR 1910.36(d)(1)), so they fail safe.
const COMPONENTS: DoorComponent[] = [
  { id: 'door_a', kind: 'sliding_door', label: 'Sliding door A (Red Hat room north)', zone: 'door_a', orientation: 'horizontal', tiles: [{ col: 8, row: 4 }, { col: 9, row: 4 }] },
  { id: 'door_b', kind: 'sliding_door', label: 'Sliding door B (Red Hat room east)', zone: 'door_b', orientation: 'vertical', tiles: [{ col: 18, row: 9 }, { col: 18, row: 10 }] },
  { id: 'connector', kind: 'sliding_door', label: 'Lobby connector door', zone: 'connector', orientation: 'horizontal', tiles: [{ col: 27, row: 4 }, { col: 28, row: 4 }] },
  { id: 'south_door', kind: 'sliding_door', label: 'South branch door (to east exit)', zone: 'south_branch', orientation: 'horizontal', tiles: [{ col: 26, row: 14 }, { col: 27, row: 14 }] },
];

// Manual fire-alarm pull stations: mounted on a wall tile, operated from the adjacent stand tile.
const ALARMS: AlarmStation[] = [
  { id: 'alarm_rh', label: 'Pull station — Red Hat room (by door B)', zone: 'rh_room', wall: { col: 18, row: 12 }, stand: { col: 17, row: 12 } },
  { id: 'alarm_corridor', label: 'Pull station — north corridor', zone: 'north_corridor', wall: { col: 14, row: 0 }, stand: { col: 14, row: 1 } },
  { id: 'alarm_lobby', label: 'Pull station — NVIDIA lobby', zone: 'lobby', wall: { col: 24, row: 4 }, stand: { col: 24, row: 5 } },
];

const SPAWNS: Record<ActorId, SpawnSpot[]> = {
  alex: [
    { col: 22, row: 8, dir: 'up', pose: 'sit' },
    { col: 25, row: 11, dir: 'down', pose: 'stand' },
    { col: 20, row: 9, dir: 'right', pose: 'stand' },
  ],
  maya: [
    { col: 13, row: 7, dir: 'up', pose: 'sit' },
    { col: 15, row: 9, dir: 'left', pose: 'stand' },
    { col: 6, row: 16, dir: 'up', pose: 'sit' },
  ],
  daniel: [
    { col: 15, row: 12, dir: 'left', pose: 'sit' },
    { col: 16, row: 10, dir: 'left', pose: 'sit' },
    { col: 12, row: 13, dir: 'up', pose: 'sit' },
  ],
};

const ACTIVITY: Record<ActorId, Tile[]> = {
  alex: [
    { col: 22, row: 8 },
    { col: 25, row: 11 },
    { col: 20, row: 9 },
    { col: 28, row: 12 },
  ],
  maya: [
    { col: 13, row: 7 },
    { col: 15, row: 9 },
    { col: 6, row: 16 },
    { col: 7, row: 13 },
  ],
  daniel: [
    { col: 15, row: 12 },
    { col: 16, row: 10 },
    { col: 12, row: 13 },
    { col: 6, row: 7 },
  ],
};

// ---------------------------------------------------------------------------
// Furniture manifests → footprints
// ---------------------------------------------------------------------------

interface ManifestNode {
  id?: string;
  type: string;
  category?: string;
  backgroundTiles?: number;
  footprintW?: number;
  footprintH?: number;
  members?: ManifestNode[];
}

interface AssetInfo {
  footprintW: number;
  footprintH: number;
  backgroundTiles: number;
  category: string;
}

const assetIndex = new Map<string, AssetInfo>();
for (const dir of readdirSafe(FURNITURE_DIR)) {
  const manifestPath = join(FURNITURE_DIR, dir, 'manifest.json');
  if (!existsSync(manifestPath)) continue;
  const rootNode = JSON.parse(readFileSync(manifestPath, 'utf8')) as ManifestNode;
  const walk = (n: ManifestNode, bg: number, category: string) => {
    const nbg = n.backgroundTiles ?? bg;
    const ncat = n.category ?? category;
    if (n.type === 'asset' && n.id && n.footprintW && n.footprintH) {
      assetIndex.set(n.id, { footprintW: n.footprintW, footprintH: n.footprintH, backgroundTiles: nbg, category: ncat });
    }
    for (const m of n.members ?? []) walk(m, nbg, ncat);
  };
  walk(rootNode, rootNode.backgroundTiles ?? 0, rootNode.category ?? 'misc');
}

function readdirSafe(p: string): string[] {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}

function assetFor(type: string): AssetInfo {
  const base = type.split(':')[0];
  const info = assetIndex.get(base);
  if (!info) throw new Error(`unknown furniture type ${type} (no manifest asset ${base})`);
  return info;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const terrain: TerrainKind[] = [];
const zone: (ZoneId | null)[] = [];
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    terrain.push(terrainOf(c, r));
    zone.push(zoneOf(c, r));
  }
}

const furniture: PlacedFurnitureDef[] = FURNITURE.map((f, i) => {
  const a = assetFor(f.type);
  const blocks: Tile[] = [];
  if (a.category !== 'chairs') {
    for (let dr = a.backgroundTiles; dr < a.footprintH; dr++) {
      for (let dc = 0; dc < a.footprintW; dc++) blocks.push({ col: f.col + dc, row: f.row + dr });
    }
  }
  for (const b of blocks) {
    const t = terrain[idx(b.col, b.row)];
    if (t !== 'floor' && t !== 'outdoor') throw new Error(`furniture ${f.type} at (${f.col},${f.row}) blocks non-floor tile (${b.col},${b.row})`);
  }
  return { uid: `f-${i}-${f.type.toLowerCase()}`, type: f.type, col: f.col, row: f.row, blocks };
});

const blocked = new Set<string>();
for (const f of furniture) for (const b of f.blocks) blocked.add(`${b.col},${b.row}`);

const walkable = terrain.map((t, i) => {
  const c = i % cols;
  const r = Math.floor(i / cols);
  return (t === 'floor' || t === 'outdoor') && !blocked.has(`${c},${r}`);
});
const W = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && walkable[idx(c, r)];

// Wheelchair clearance: tile is inside some fully walkable 2×2 block.
const accessible = walkable.map((w, i) => {
  if (!w) return false;
  const c = i % cols;
  const r = Math.floor(i / cols);
  for (const [dc, dr] of [
    [0, 0],
    [-1, 0],
    [0, -1],
    [-1, -1],
  ]) {
    const c0 = c + dc;
    const r0 = r + dr;
    if (W(c0, r0) && W(c0 + 1, r0) && W(c0, r0 + 1) && W(c0 + 1, r0 + 1)) return true;
  }
  return false;
});

// ¾-view occlusion: a floor tile directly north of a wall is drawn under the wall's top half.
const occluded = terrain.map((t, i) => {
  const c = i % cols;
  const r = Math.floor(i / cols);
  return (t === 'floor' || t === 'outdoor') && r + 1 < rows && terrain[idx(c, r + 1)] === 'wall';
});

// Zone adjacency from 4-connected walkable tiles (ignoring furniture: zone graph is structural).
const edgeSet = new Set<string>();
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    const z = zone[idx(c, r)];
    if (!z) continue;
    for (const [dc, dr] of [
      [1, 0],
      [0, 1],
    ]) {
      const c2 = c + dc;
      const r2 = r + dr;
      if (c2 >= cols || r2 >= rows) continue;
      const z2 = zone[idx(c2, r2)];
      if (z2 && z2 !== z) edgeSet.add([z, z2].sort().join('|'));
    }
  }
}
const zoneEdges = [...edgeSet].sort().map((e) => e.split('|') as [ZoneId, ZoneId]);

const tilesWhere = (pred: (c: number, r: number) => boolean): Tile[] => {
  const out: Tile[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (pred(c, r)) out.push({ col: c, row: r });
  return out;
};

// Validate authored spots
for (const [actor, spots] of Object.entries(SPAWNS) as [ActorId, SpawnSpot[]][]) {
  for (const s of [...spots, ...ACTIVITY[actor]]) {
    const ok = actor === 'daniel' ? accessible[idx(s.col, s.row)] : walkable[idx(s.col, s.row)];
    if (!ok) throw new Error(`${actor} spot (${s.col},${s.row}) is not ${actor === 'daniel' ? 'accessible' : 'walkable'}`);
  }
}
for (const d of COMPONENTS) {
  for (const t of d.tiles) {
    if (terrain[idx(t.col, t.row)] !== 'floor' || !walkable[idx(t.col, t.row)]) throw new Error(`door ${d.id} tile (${t.col},${t.row}) is not walkable floor`);
    if (zone[idx(t.col, t.row)] !== d.zone) throw new Error(`door ${d.id} tile (${t.col},${t.row}) is not in zone ${d.zone}`);
  }
}
for (const a of ALARMS) {
  if (terrain[idx(a.wall.col, a.wall.row)] !== 'wall') throw new Error(`alarm ${a.id} wall tile is not a wall`);
  if (!accessible[idx(a.stand.col, a.stand.row)]) throw new Error(`alarm ${a.id} stand tile is not wheelchair-accessible`);
  if (zone[idx(a.stand.col, a.stand.row)] !== a.zone) throw new Error(`alarm ${a.id} stand tile is not in zone ${a.zone}`);
  if (Math.abs(a.wall.col - a.stand.col) + Math.abs(a.wall.row - a.stand.row) !== 1) throw new Error(`alarm ${a.id} stand is not adjacent to its wall`);
}
for (const z of ZONES) {
  if (zone[idx(z.anchor.col, z.anchor.row)] !== z.id) throw new Error(`anchor of ${z.id} is not inside the zone`);
  if (!walkable[idx(z.anchor.col, z.anchor.row)]) throw new Error(`anchor of ${z.id} is not walkable`);
}

// ---------------------------------------------------------------------------
// Pixel Agents layout (renderer)
// ---------------------------------------------------------------------------

const TILE = { WALL: 0, FLOOR_1: 1, FLOOR_2: 2, FLOOR_3: 3, FLOOR_4: 4, FLOOR_5: 5, FLOOR_6: 6, FLOOR_7: 7, FLOOR_8: 8, FLOOR_9: 9, VOID: 255 };

// Visual theme per zone: [floor pattern, color]. Tuned by the visual lead; does not affect simulation.
const ZONE_STYLE: Record<ZoneId, [number, ColorValue]> = {
  rh_room: [TILE.FLOOR_1, { h: 356, s: 55, b: -38, c: -70 }],
  door_a: [TILE.FLOOR_3, { h: 215, s: 12, b: -8, c: -35 }],
  door_b: [TILE.FLOOR_3, { h: 215, s: 12, b: -8, c: -35 }],
  north_corridor: [TILE.FLOOR_3, { h: 215, s: 12, b: -8, c: -35 }],
  connector: [TILE.FLOOR_3, { h: 215, s: 12, b: -8, c: -35 }],
  lobby: [TILE.FLOOR_7, { h: 95, s: 30, b: -40, c: -80 }],
  south_branch: [TILE.FLOOR_3, { h: 215, s: 12, b: -8, c: -35 }],
  west_exit: [TILE.FLOOR_1, { h: 140, s: 60, b: -12, c: -25 }],
  east_exit: [TILE.FLOOR_1, { h: 140, s: 60, b: -12, c: -25 }],
  west_sidewalk: [TILE.FLOOR_3, { h: 36, s: 22, b: -22, c: -55 }],
  plaza: [TILE.FLOOR_3, { h: 36, s: 22, b: -22, c: -55 }],
  assembly: [TILE.FLOOR_5, { h: 46, s: 75, b: -8, c: -35 }],
};
const WALL_COLOR: ColorValue = { h: 214, s: 30, b: -100, c: -55 };

const layoutTiles: number[] = [];
const tileColors: (ColorValue | null)[] = [];
for (let i = 0; i < terrain.length; i++) {
  const t = terrain[i];
  if (t === 'wall') {
    layoutTiles.push(TILE.WALL);
    tileColors.push(WALL_COLOR);
  } else if (t === 'void') {
    layoutTiles.push(TILE.VOID);
    tileColors.push(null);
  } else {
    const [pattern, color] = ZONE_STYLE[zone[i] as ZoneId];
    layoutTiles.push(pattern);
    tileColors.push(color);
  }
}

const map: Omit<MapData, 'hash'> = {
  id: 'office-v1',
  version: 1,
  cols,
  rows,
  tileSize: 16,
  terrain,
  zone,
  walkable,
  accessible,
  occluded,
  zones: ZONES,
  zoneEdges,
  exits: [
    { id: 'west_exit', tiles: tilesWhere((c, r) => ch(c, r) === 'W') },
    { id: 'east_exit', tiles: tilesWhere((c, r) => ch(c, r) === 'E') },
  ],
  assembly: { tiles: tilesWhere((c, r) => ch(c, r) === 'X'), checkInPoint: { col: 15, row: 20 } },
  spawnSpots: SPAWNS,
  activitySpots: ACTIVITY,
  furniture,
  decor: DECOR,
  components: COMPONENTS,
  alarms: ALARMS,
  layout: {
    version: 1,
    cols,
    rows,
    tiles: layoutTiles,
    furniture: furniture.map(({ uid, type, col, row }) => ({ uid, type, col, row })),
    tileColors,
  },
};

const hash = createHash('sha256').update(JSON.stringify(map)).digest('hex').slice(0, 16);
const out: MapData = { ...map, hash };
writeFileSync(join(here, 'office-v1.json'), JSON.stringify(out) + '\n');

const nAcc = accessible.filter(Boolean).length;
const nWalk = walkable.filter(Boolean).length;
console.log(`office-v1: ${cols}x${rows}, walkable ${nWalk}, accessible ${nAcc}, furniture ${furniture.length}, zone edges ${zoneEdges.length}, hash ${hash}`);
console.log('zone edges:', zoneEdges.map((e) => e.join('–')).join(', '));
