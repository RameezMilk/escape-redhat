// Presentation-only clean-up for anything a viewer reads: evidence ids ("E2") and raw zone codes ("rh_room") are
// replaced by plain names. The raw values stay untouched in the trace details' raw JSON.
import type { TraceRow } from '@escape/contracts';

export const ZONE_NAMES: Record<string, string> = {
  rh_room: 'Red Hat room',
  door_a: 'door A',
  door_b: 'door B',
  north_corridor: 'north hallway',
  connector: 'lobby connector',
  lobby: 'NVIDIA lobby',
  south_branch: 'south corridor',
  south_door: 'south door',
  west_exit: 'west exit',
  east_exit: 'east exit',
  west_sidewalk: 'outside',
  plaza: 'outside',
  assembly: 'assembly point',
  alarm: 'hallway alarm',
  alarm_corridor: 'hallway alarm',
};

// Only code-like ids (with an underscore) are rewritten inside free text; plain words ("alarm", "lobby",
// "assembly") are left alone so "hallway alarm" never becomes "hallway hallway alarm".
const ZONE_RE = new RegExp(`\\b(${Object.keys(ZONE_NAMES).filter((k) => k.includes('_')).join('|')})\\b`, 'g');

/** Evidence id → plain description, learnt from engine rows that carry evidenceIds ("Daniel spots fire in the Red Hat room"). */
export function evidenceNames(trace: readonly TraceRow[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const r of trace) {
    if (!r.evidenceIds?.length) continue;
    for (const id of r.evidenceIds) {
      if (names.has(id)) continue;
      const s = r.summary;
      const fireAt = /fire\b(?:[^—]*?)\b(in|near|by) (?:the )?([^—.(]+)/i.exec(s);
      if (/fire/i.test(s)) names.set(id, fireAt ? `the fire ${fireAt[1]} the ${fireAt[2].trim()}` : 'the fire');
      else {
        const door = /\b((?:south|lobby connector|connector)\s+door|door\s+[AB]|sliding door[^—.(]*)/i.exec(s);
        names.set(id, door ? `the dead ${door[1].trim()}` : 'the dead door');
      }
    }
  }
  return names;
}

/** Replace evidence ids and zone codes with readable names. */
export function humanize(text: string, names?: Map<string, string>): string {
  return text
    .replace(/\(\s*E\d+\s*\)/g, '')
    .replace(/\bE\d+\b/g, (id) => names?.get(id) ?? 'the hazard')
    .replace(ZONE_RE, (z) => ZONE_NAMES[z] ?? z)
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Engine rows produced by human instinct (not by the model). */
export function instinctKind(row: TraceRow): 'shout' | 'flee' | 'alarm' | null {
  if (row.kind !== 'engine') return null;
  const s = row.summary.toLowerCase();
  const tagged = row.origin.toLowerCase().includes('instinct');
  if (/\bshouts?\b/.test(s)) return 'shout';
  if (/backs? away|backing away|steps? back from/.test(s)) return 'flee';
  if (/on (?:her|his|their) way (?:out|past)|in passing/.test(s) || (tagged && s.includes('alarm'))) return 'alarm';
  return tagged ? 'flee' : null;
}

/** Shout bubbles are instinct, not a model message. */
export function isShoutText(text: string): boolean {
  return /^\W*fire!?\s*(?:fire!?\s*)?get out/i.test(text.trim()) || /^\W*fire!\s*fire!?\W*$/i.test(text.trim());
}
