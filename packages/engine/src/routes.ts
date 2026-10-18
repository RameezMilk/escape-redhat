// The static route briefing in consult_plan('routes'), generated from the map: for every room, the shortest
// wheelchair-accessible route to the assembly point, and an alternate that avoids the primary's first doorway or exit.
// Plan knowledge only — it ignores hazards (the planner learns those from observations and reports).
import type { MapData, ZoneId } from '@escape/contracts';
import { tileIndex, zoneTiles } from './map.js';
import { findPath } from './nav.js';

const cache = new WeakMap<MapData, Record<string, string>>();

function zoneSequence(map: MapData, path: { col: number; row: number }[]): ZoneId[] {
  const seq: ZoneId[] = [];
  for (const t of path) {
    const z = map.zone[tileIndex(map, t.col, t.row)];
    if (z && seq[seq.length - 1] !== z) seq.push(z);
  }
  return seq;
}

export function routeBriefing(map: MapData): Record<string, string> {
  const hit = cache.get(map);
  if (hit) return hit;
  const kind = new Map(map.zones.map((z) => [z.id, z.kind]));
  const out: Record<string, string> = {};
  for (const room of map.zones.filter((z) => z.kind === 'room')) {
    const route = (blocked?: ReadonlySet<number>) => {
      const p = findPath(map, room.anchor, map.assembly.tiles, { mask: 'accessible', blocked });
      return p ? zoneSequence(map, [room.anchor, ...p]) : null;
    };
    const primary = route();
    if (!primary) continue;
    out[`from_${room.id}_primary`] = primary.join(' → ');
    const via = primary.find((z) => kind.get(z) === 'door' || kind.get(z) === 'exit');
    if (via) {
      const alt = route(new Set(zoneTiles(map, via).map((t) => tileIndex(map, t.col, t.row))));
      if (alt) out[`from_${room.id}_alternate`] = alt.join(' → ');
    }
  }
  cache.set(map, out);
  return out;
}
