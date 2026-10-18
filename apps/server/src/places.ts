// Human-readable place and hazard names for anything a viewer sees (trace rows, bubbles).
// Evidence ids (E1…), raw zone ids (rh_room…), action ids (A-007) and tile coordinates never reach the screen;
// they stay in planner-facing fields and in the raw JSON a viewer can expand.
import type { MapData, WorldEvent } from '@escape/contracts';

/** Short names for zones (fallback when the engine's own place names are unavailable). */
export const PLACE_NAMES: Record<string, string> = {
  rh_room: 'Red Hat room',
  door_a: 'door A',
  door_b: 'door B',
  north_corridor: 'north hallway',
  connector: 'lobby connector',
  lobby: 'NVIDIA lobby',
  south_branch: 'south corridor',
  west_exit: 'west exit',
  east_exit: 'east exit',
  west_sidewalk: 'outside',
  plaza: 'outside',
  assembly: 'assembly point',
};

/** Short names for electric sliding doors (component ids). */
export const DOOR_NAMES: Record<string, string> = {
  door_a: 'door A',
  door_b: 'door B',
  connector: 'lobby connector door',
  south_door: 'south door',
};

// Only underscore ids: bare words like "lobby"/"assembly" also occur inside already-human text ("NVIDIA lobby",
// "assembly point") — replacing them again produced "assembly point point".
const ZONE_ID_RE = new RegExp(`\\b(${Object.keys(PLACE_NAMES).filter((k) => k.includes('_')).join('|')})\\b`, 'g');
const DOOR_ID_RE = /\bsouth_door\b/g;

export function placeName(zone: unknown): string {
  if (typeof zone !== 'string' || !zone) return 'the building';
  return PLACE_NAMES[zone] ?? zone.replace(/_/g, ' ');
}

/** "the Red Hat room" / "door A" / "outside" — with an article where it reads naturally. */
export function inPlace(zone: unknown): string {
  if (typeof zone !== 'string' || !zone) return 'the building';
  const p = placeName(zone);
  return /^(door [A-Z]|outside)$/.test(p) ? p : `the ${p}`;
}

export function doorName(component: unknown): string {
  if (typeof component !== 'string' || !component) return 'sliding door';
  return DOOR_NAMES[component] ?? component.replace(/_/g, ' ');
}

/** Door with the right article: "door B" (named), "the south door". */
export function theDoor(component: unknown): string {
  const n = doorName(component);
  return /^door [A-Z]$/.test(n) ? n : `the ${n}`;
}

/** Zone of a tile, if the map knows it. */
export function zoneAtTile(map: MapData | undefined, col: unknown, row: unknown): string | undefined {
  if (!map?.zone || typeof col !== 'number' || typeof row !== 'number') return undefined;
  return map.zone[row * map.cols + col] ?? undefined;
}

/** Component id an electrical hazard/door event refers to (defensive about field names). */
export function componentOf(d: Record<string, unknown>): string | undefined {
  for (const k of ['component', 'componentId', 'component_id', 'door', 'doorId']) {
    const v = d[k];
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
}

/** What a piece of evidence is, in words: "the fire in the Red Hat room", "the dead south door". */
export interface EvidenceInfo {
  kind: string;
  zone?: string;
  component?: string;
}

export function describeEvidenceInfo(e: EvidenceInfo): string {
  if (e.kind === 'electrical') return `the dead ${doorName(e.component)}`.replace('the dead door', 'dead door');
  return e.zone ? `the fire in ${inPlace(e.zone)}` : 'the fire';
}

/** Remembers what each evidence id refers to (learned from observation / placement events). */
export class EvidenceBook {
  private byId = new Map<string, EvidenceInfo>();

  learn(e: WorldEvent): void {
    const d = e.data as Record<string, unknown>;
    if (e.type !== 'observation' && e.type !== 'move_interrupted') return;
    const kind = typeof d.kind === 'string' ? d.kind : typeof d.hazard_kind === 'string' ? d.hazard_kind : undefined;
    if (!kind) return;
    const zone = typeof d.hazard_zone === 'string' ? d.hazard_zone : typeof d.zone === 'string' ? d.zone : undefined;
    for (const id of e.evidenceIds ?? []) {
      if (!this.byId.has(id)) this.byId.set(id, { kind, zone, component: componentOf(d) });
    }
  }

  describe(id: string): string {
    const info = this.byId.get(id);
    return info ? describeEvidenceInfo(info) : 'the hazard';
  }
}

/**
 * Final safety net for viewer-facing text: evidence ids → what they are, zone/door ids → place names,
 * and no action ids or tile coordinates. Planner-facing text is never passed through this.
 */
export function humanize(text: string, book?: EvidenceBook): string {
  let s = text;
  // "(E2)" / "fire E1" / "E1" → description (drop the parenthesised form entirely when it only repeats the place)
  s = s.replace(/\s*\((E\d+(?:,\s*E\d+)*)\)/g, '');
  s = s.replace(/\b(fire|door|hazard|evidence)\s+(E\d+)\b/gi, (_m, _w, id: string) => (book ? book.describe(id) : 'the hazard'));
  s = s.replace(/\bE\d+\b/g, (id) => (book ? book.describe(id) : 'the hazard'));
  s = s.replace(DOOR_ID_RE, 'south door');
  s = s.replace(ZONE_ID_RE, (z) => placeName(z));
  // action / decision ids and coordinates
  s = s.replace(/\s*\((?:A|D)-\d+\)/g, '');
  s = s.replace(/\s*(?:at|near)?\s*\(\d+,\s*\d+\)/g, '');
  s = s.replace(/\bthe the\b/g, 'the');
  // Route lists: two zones can share a place name ("outside → outside") — collapse consecutive repeats.
  if (s.includes(' → ')) s = s.split(' → ').filter((part, i, all) => i === 0 || part.trim() !== all[i - 1].trim()).join(' → ');
  return s.replace(/\s{2,}/g, ' ').trim();
}
