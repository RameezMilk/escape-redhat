// Grid navigation: 4-connected Dijkstra (occluded tiles cost more), line of sight.
import type { MapData, Tile } from '@escape/contracts';
import { inBounds, tileIndex } from './map.js';

export type NavMask = 'walkable' | 'accessible';

export interface PathOptions {
  mask: NavMask;
  /** Tile indices that may not be entered (hazard no-go tiles, known or real). */
  blocked?: ReadonlySet<number>;
  /** Cost of stepping onto a ¾-view occluded tile (default 3). */
  occludedCost?: number;
  /** Extra cost per tile index (e.g. tiles next to known fire), added to the step cost. */
  extraCost?: ReadonlyMap<number, number>;
}

const NEIGHBOURS: readonly [number, number][] = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

export function passable(map: MapData, i: number, opts: PathOptions): boolean {
  const ok = opts.mask === 'accessible' ? map.accessible[i] : map.walkable[i];
  return ok && !(opts.blocked?.has(i) ?? false);
}

/** Minimal binary heap keyed by (cost, seq) for deterministic tie-breaking. */
class Heap {
  private items: [number, number, number][] = [];
  push(cost: number, seq: number, node: number) {
    const a = this.items;
    a.push([cost, seq, node]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (less(a[i], a[p])) {
        [a[i], a[p]] = [a[p], a[i]];
        i = p;
      } else break;
    }
  }
  pop(): [number, number, number] | undefined {
    const a = this.items;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && less(a[l], a[m])) m = l;
        if (r < a.length && less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}
const less = (x: [number, number, number], y: [number, number, number]) => x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);

/**
 * Shortest path from start to the nearest target tile. Returns the path EXCLUDING start
 * ([] if start is already a target), or null if unreachable. The start tile is always allowed.
 */
export function findPath(map: MapData, start: Tile, targets: readonly Tile[] | ((i: number) => boolean), opts: PathOptions): Tile[] | null {
  const n = map.cols * map.rows;
  const isTarget =
    typeof targets === 'function'
      ? targets
      : (() => {
          const s = new Set(targets.map((t) => tileIndex(map, t.col, t.row)));
          return (i: number) => s.has(i);
        })();
  const startI = tileIndex(map, start.col, start.row);
  if (isTarget(startI)) return [];
  const occCost = opts.occludedCost ?? 3;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const heap = new Heap();
  let seq = 0;
  dist[startI] = 0;
  heap.push(0, seq++, startI);
  for (let item = heap.pop(); item; item = heap.pop()) {
    const [d, , u] = item;
    if (d > dist[u]) continue;
    if (u !== startI && isTarget(u)) {
      const path: Tile[] = [];
      for (let v = u; v !== startI; v = prev[v]) path.push({ col: v % map.cols, row: Math.floor(v / map.cols) });
      return path.reverse();
    }
    const uc = u % map.cols;
    const ur = Math.floor(u / map.cols);
    for (const [dc, dr] of NEIGHBOURS) {
      const c = uc + dc;
      const r = ur + dr;
      if (!inBounds(map, c, r)) continue;
      const v = tileIndex(map, c, r);
      if (!passable(map, v, opts)) continue;
      const nd = d + (map.occluded[v] ? occCost : 1) + (opts.extraCost?.get(v) ?? 0);
      if (nd < dist[v]) {
        dist[v] = nd;
        prev[v] = u;
        heap.push(nd, seq++, v);
      }
    }
  }
  return null;
}

/** Path cost helper (same weights as findPath). */
export function pathCost(map: MapData, path: readonly Tile[], occludedCost = 3): number {
  return path.reduce((s, t) => s + (map.occluded[tileIndex(map, t.col, t.row)] ? occludedCost : 1), 0);
}

/** Bresenham line of sight between tile centres. Walls/void on intermediate tiles block; furniture doesn't.
 *  `opaque` adds extra blocking tiles (e.g. a closed, disabled sliding door). */
export function lineOfSight(map: MapData, a: Tile, b: Tile, opaque?: ReadonlySet<number>): boolean {
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
    if (!(x0 === a.col && y0 === a.row) && !(x0 === x1 && y0 === y1)) {
      const ti = tileIndex(map, x0, y0);
      const t = map.terrain[ti];
      if (t === 'wall' || t === 'void' || (opaque?.has(ti) ?? false)) return false;
    }
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

/** Convenience used by the planner-facing route tool: plan over a mask avoiding given tile indices. */
export function planPath(map: MapData, start: Tile, targets: readonly Tile[], mask: NavMask, blocked?: ReadonlySet<number>): Tile[] | null {
  return findPath(map, start, targets, { mask, blocked });
}
