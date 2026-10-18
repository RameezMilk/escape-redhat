// Generic map builder: a map spec (data/maps/<id>.spec.ts) + its ASCII grid → MapData.
// The ASCII is the source of truth for terrain, doors and exits; furniture footprints come from the vendored Pixel
// Agents manifests so the renderer and the engine agree on collisions. Specs use plain string ids because ZoneId
// itself is generated from the current map (see build-map.ts).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ACTOR_PROFILES } from '../../packages/contracts/src/engine-api.js';
import { CUSTOM_FURNITURE } from '../../packages/contracts/src/furniture.js';
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

/** Floor patterns of the Pixel Agents tile set (FLOOR_n uses floors/floor_{n-1}.png). */
export const TILE = { WALL: 0, FLOOR_1: 1, FLOOR_2: 2, FLOOR_3: 3, FLOOR_4: 4, FLOOR_5: 5, FLOOR_6: 6, FLOOR_7: 7, FLOOR_8: 8, FLOOR_9: 9, VOID: 255 };

/** One ASCII character: its terrain and how its zone is found ('rect' = from `rects`, null = no zone). */
export interface LegendEntry {
  terrain: TerrainKind;
  zone: string | 'rect' | null;
  /** Defaults to true for floor/outdoor terrain. */
  walkable?: boolean;
  /** Floor style for tiles without a zone (e.g. a road). */
  style?: [number, ColorValue];
}

/** Zone rectangle for 'rect' characters; every such tile must fall in exactly one rectangle. Inclusive bounds. */
export interface ZoneRect {
  zone: string;
  cols: [number, number];
  rows: [number, number];
}

export type ZoneSpec = Omit<ZoneDef, 'id'> & { id: string };

/** Electric sliding door: tiles from a letter run (`char`) or listed explicitly with their `zone`. */
export interface DoorSpec {
  id: string;
  name: string;
  label: string;
  char?: string;
  zone?: string;
  tiles?: Tile[];
}

/** Manual pull station on `wall`, operated from the adjacent `stand` tile (its zone is the stand's zone). */
export interface AlarmSpec {
  id: string;
  name: string;
  label: string;
  wall: Tile;
  stand: Tile;
}

export interface FurnitureSpec {
  type: string;
  col: number;
  row: number;
  color?: ColorValue;
}

export interface MapSpec {
  id: string;
  version: number;
  /** ASCII file next to the spec. */
  ascii: string;
  legend: Record<string, LegendEntry>;
  rects: ZoneRect[];
  zones: ZoneSpec[];
  furniture: FurnitureSpec[];
  decor: DecorDef[];
  doors: DoorSpec[];
  alarms: AlarmSpec[];
  spawns: Record<ActorId, SpawnSpot[]>;
  activity: Record<ActorId, Tile[]>;
  /** Visual theme per zone: [floor pattern, color]. Does not affect the simulation. */
  zoneStyle: Record<string, [number, ColorValue]>;
  wallColor: ColorValue;
  checkInPoint: Tile;
}

export interface BuildResult {
  map: MapData;
  summary: string[];
}

interface AssetInfo {
  footprintW: number;
  footprintH: number;
  backgroundTiles: number;
  category: string;
}

interface ManifestNode {
  id?: string;
  type: string;
  category?: string;
  backgroundTiles?: number;
  footprintW?: number;
  footprintH?: number;
  members?: ManifestNode[];
}

/** Footprints of every furniture asset: the vendored Pixel Agents manifests plus our procedural CUSTOM_FURNITURE. */
export function loadFurnitureIndex(furnitureDir: string): Map<string, AssetInfo> {
  const index = new Map<string, AssetInfo>();
  for (const [id, f] of Object.entries(CUSTOM_FURNITURE)) {
    index.set(id, { footprintW: f.footprintW, footprintH: f.footprintH, backgroundTiles: f.backgroundTiles, category: f.category });
  }
  let dirs: string[] = [];
  try {
    dirs = readdirSync(furnitureDir);
  } catch {
    dirs = [];
  }
  for (const dir of dirs) {
    const manifestPath = join(furnitureDir, dir, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    const rootNode = JSON.parse(readFileSync(manifestPath, 'utf8')) as ManifestNode;
    const walk = (n: ManifestNode, bg: number, category: string) => {
      const nbg = n.backgroundTiles ?? bg;
      const ncat = n.category ?? category;
      if (n.type === 'asset' && n.id && n.footprintW && n.footprintH) {
        index.set(n.id, { footprintW: n.footprintW, footprintH: n.footprintH, backgroundTiles: nbg, category: ncat });
      }
      for (const m of n.members ?? []) walk(m, nbg, ncat);
    };
    walk(rootNode, rootNode.backgroundTiles ?? 0, rootNode.category ?? 'misc');
  }
  return index;
}

export function buildMap(spec: MapSpec, mapsDir: string, furniture: Map<string, AssetInfo>): BuildResult {
  const ascii = readFileSync(join(mapsDir, spec.ascii), 'utf8').trimEnd().split('\n');
  const rows = ascii.length;
  const cols = ascii[0].length;
  if (!ascii.every((l) => l.length === cols)) throw new Error('ASCII rows must all have the same width');

  const idx = (c: number, r: number) => r * cols + c;
  const ch = (c: number, r: number) => (c < 0 || r < 0 || c >= cols || r >= rows ? ' ' : ascii[r][c]);
  const legendOf = (c: number, r: number): LegendEntry => {
    const x = ch(c, r);
    const e = spec.legend[x];
    if (!e) throw new Error(`ASCII character '${x}' at (${c},${r}) is not in the legend`);
    return e;
  };

  // ---------------------------------------------------------------- terrain and zones
  const zoneIds = new Set(spec.zones.map((z) => z.id));
  for (const [x, e] of Object.entries(spec.legend)) {
    if (e.zone && e.zone !== 'rect' && !zoneIds.has(e.zone)) throw new Error(`legend '${x}' names unknown zone ${e.zone}`);
  }
  for (const rc of spec.rects) if (!zoneIds.has(rc.zone)) throw new Error(`rectangle names unknown zone ${rc.zone}`);

  const terrain: TerrainKind[] = [];
  const zone: (ZoneId | null)[] = [];
  const legendWalkable: boolean[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const e = legendOf(c, r);
      terrain.push(e.terrain);
      legendWalkable.push(e.walkable ?? (e.terrain === 'floor' || e.terrain === 'outdoor'));
      if (e.zone === 'rect') {
        const hits = spec.rects.filter((rc) => c >= rc.cols[0] && c <= rc.cols[1] && r >= rc.rows[0] && r <= rc.rows[1]);
        if (hits.length !== 1) throw new Error(`tile (${c},${r}) '${ch(c, r)}' is in ${hits.length} zone rectangles (${hits.map((h) => h.zone).join(', ') || 'none'})`);
        zone.push(hits[0].zone as ZoneId);
      } else zone.push((e.zone as ZoneId | null) ?? null);
    }
  }
  for (const z of spec.zones) if (!zone.includes(z.id as ZoneId)) throw new Error(`zone ${z.id} has no tiles`);

  // ---------------------------------------------------------------- furniture
  const assetFor = (type: string): AssetInfo => {
    const base = type.split(':')[0];
    const info = furniture.get(base);
    if (!info) throw new Error(`unknown furniture type ${type} (no manifest asset ${base})`);
    return info;
  };
  const placed: PlacedFurnitureDef[] = spec.furniture.map((f, i) => {
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
  for (const f of placed) for (const b of f.blocks) blocked.add(`${b.col},${b.row}`);

  const walkable = terrain.map((_t, i) => legendWalkable[i] && !blocked.has(`${i % cols},${Math.floor(i / cols)}`));
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
    const r = Math.floor(i / cols);
    return (t === 'floor' || t === 'outdoor') && r + 1 < rows && terrain[i + cols] === 'wall';
  });

  // Zone adjacency from 4-connected tiles (ignoring furniture: the zone graph is structural).
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

  // ---------------------------------------------------------------- doors and alarms
  const components: DoorComponent[] = spec.doors.map((d) => {
    const tiles = d.char ? tilesWhere((c, r) => ch(c, r) === d.char) : (d.tiles ?? []);
    const doorZone = (d.char ? spec.legend[d.char]?.zone : d.zone) as ZoneId | undefined;
    if (!doorZone || doorZone === ('rect' as ZoneId)) throw new Error(`door ${d.id} has no zone`);
    if (tiles.length !== 2) throw new Error(`door ${d.id} must be exactly 2 tiles (got ${tiles.length})`);
    const [a, b] = tiles;
    const horizontal = a.row === b.row && Math.abs(a.col - b.col) === 1;
    const vertical = a.col === b.col && Math.abs(a.row - b.row) === 1;
    if (!horizontal && !vertical) throw new Error(`door ${d.id} tiles are not two adjacent collinear tiles`);
    for (const t of tiles) {
      if (terrain[idx(t.col, t.row)] !== 'floor' || !walkable[idx(t.col, t.row)]) throw new Error(`door ${d.id} tile (${t.col},${t.row}) is not walkable floor`);
      if (zone[idx(t.col, t.row)] !== doorZone) throw new Error(`door ${d.id} tile (${t.col},${t.row}) is not in zone ${doorZone}`);
    }
    return { id: d.id, kind: 'sliding_door', label: d.label, name: d.name, zone: doorZone, orientation: horizontal ? 'horizontal' : 'vertical', tiles };
  });

  const alarms: AlarmStation[] = spec.alarms.map((a) => {
    const z = zone[idx(a.stand.col, a.stand.row)];
    if (!z) throw new Error(`alarm ${a.id} stand tile has no zone`);
    if (terrain[idx(a.wall.col, a.wall.row)] !== 'wall') throw new Error(`alarm ${a.id} wall tile is not a wall`);
    if (!accessible[idx(a.stand.col, a.stand.row)]) throw new Error(`alarm ${a.id} stand tile is not wheelchair-accessible`);
    if (Math.abs(a.wall.col - a.stand.col) + Math.abs(a.wall.row - a.stand.row) !== 1) throw new Error(`alarm ${a.id} stand is not adjacent to its wall`);
    return { id: a.id, label: a.label, name: a.name, zone: z, wall: a.wall, stand: a.stand };
  });

  // ---------------------------------------------------------------- validation of authored spots
  for (const [actor, spots] of Object.entries(spec.spawns) as [ActorId, SpawnSpot[]][]) {
    const wheels = ACTOR_PROFILES[actor].usesWheelchair;
    for (const s of [...spots, ...(spec.activity[actor] ?? [])]) {
      const ok = wheels ? accessible[idx(s.col, s.row)] : walkable[idx(s.col, s.row)];
      if (!ok) throw new Error(`${actor} spot (${s.col},${s.row}) is not ${wheels ? 'accessible' : 'walkable'}`);
    }
  }
  for (const z of spec.zones) {
    if (!z.name || !z.at) throw new Error(`zone ${z.id} needs a name and an at phrase`);
    if (zone[idx(z.anchor.col, z.anchor.row)] !== z.id) throw new Error(`anchor of ${z.id} is not inside the zone`);
    if (!walkable[idx(z.anchor.col, z.anchor.row)]) throw new Error(`anchor of ${z.id} is not walkable`);
    if (!spec.zoneStyle[z.id]) throw new Error(`zone ${z.id} has no style`);
  }

  // ---------------------------------------------------------------- Pixel Agents layout (renderer)
  const layoutTiles: number[] = [];
  const tileColors: (ColorValue | null)[] = [];
  for (let i = 0; i < terrain.length; i++) {
    const t = terrain[i];
    if (t === 'wall') {
      layoutTiles.push(TILE.WALL);
      tileColors.push(spec.wallColor);
    } else if (t === 'void') {
      layoutTiles.push(TILE.VOID);
      tileColors.push(null);
    } else {
      const z = zone[i];
      const style = z ? spec.zoneStyle[z] : spec.legend[ch(i % cols, Math.floor(i / cols))].style;
      if (!style) throw new Error(`tile (${i % cols},${Math.floor(i / cols)}) has no floor style`);
      layoutTiles.push(style[0]);
      tileColors.push(style[1]);
    }
  }

  const zoneTilesOf = (id: string) => tilesWhere((c, r) => zone[idx(c, r)] === id);
  const map: Omit<MapData, 'hash'> = {
    id: spec.id,
    version: spec.version,
    cols,
    rows,
    tileSize: 16,
    terrain,
    zone,
    walkable,
    accessible,
    occluded,
    zones: spec.zones as ZoneDef[],
    zoneEdges,
    exits: spec.zones.filter((z) => z.kind === 'exit').map((z) => ({ id: z.id as ZoneId, tiles: zoneTilesOf(z.id) })),
    assembly: { tiles: spec.zones.filter((z) => z.kind === 'assembly').flatMap((z) => zoneTilesOf(z.id)), checkInPoint: spec.checkInPoint },
    spawnSpots: spec.spawns,
    activitySpots: spec.activity,
    furniture: placed,
    decor: spec.decor,
    components,
    alarms,
    layout: {
      version: 1,
      cols,
      rows,
      tiles: layoutTiles,
      furniture: placed.map(({ uid, type, col, row }, i) => ({ uid, type, col, row, ...(spec.furniture[i].color ? { color: spec.furniture[i].color } : {}) })),
      tileColors,
    },
  };

  const hash = createHash('sha256').update(JSON.stringify(map)).digest('hex').slice(0, 16);
  const nAcc = accessible.filter(Boolean).length;
  const nWalk = walkable.filter(Boolean).length;
  return {
    map: { ...map, hash },
    summary: [
      `${spec.id}: ${cols}x${rows}, walkable ${nWalk}, accessible ${nAcc}, furniture ${placed.length}, zones ${spec.zones.length}, zone edges ${zoneEdges.length}, doors ${components.length}, alarms ${alarms.length}, hash ${hash}`,
      `zone edges: ${zoneEdges.map((e) => e.join('–')).join(', ')}`,
      `sealable rooms (every neighbour is an electric door): ${sealableRooms(map).join(', ') || 'none'}`,
    ],
  };
}

/** Rooms whose every neighbouring zone is an electric door zone — a power cut on all of them seals the room. */
export function sealableRooms(map: Pick<MapData, 'zones' | 'zoneEdges' | 'components'>): string[] {
  const doorKind = new Set(map.zones.filter((z) => z.kind === 'door').map((z) => z.id as string));
  const doorZones = new Set((map.components ?? []).map((d) => d.zone as string).filter((z) => doorKind.has(z)));
  return map.zones
    .filter((z) => z.kind === 'room')
    .filter((z) => {
      const nbrs = map.zoneEdges.flatMap(([a, b]) => (a === z.id ? [b] : b === z.id ? [a] : []));
      return nbrs.length > 0 && nbrs.every((n) => doorZones.has(n));
    })
    .map((z) => z.id);
}
