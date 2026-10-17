// Presentation helpers for the trace panel: tool colour groups, one-line summaries, status glyphs and engine-event icons.
// Pure functions of a TraceRow — nothing here invents data; every line is derived from the row's args/result/summary.
import type { TraceRow } from '@escape/contracts';

export type ToolGroup = 'alert' | 'alarm' | 'move' | 'assist' | 'account' | 'lookup' | 'other';

const TOOL_GROUP: Record<string, ToolGroup> = {
  notify: 'alert',
  pull_alarm: 'alarm',
  move: 'move',
  plan_route: 'move',
  request_assistance: 'assist',
  assist: 'assist',
  check_in: 'account',
  verify_roster: 'account',
  observe: 'lookup',
  consult_plan: 'lookup',
};

export function toolGroup(tool?: string): ToolGroup {
  return (tool && TOOL_GROUP[tool]) || 'other';
}

const NAMES: Record<string, string> = { alex: 'Alex', maya: 'Maya', daniel: 'Daniel', all: 'everyone in earshot' };
const nameOf = (id: unknown) => (typeof id === 'string' ? (NAMES[id] ?? id) : '?');
const pretty = (s: unknown) => (typeof s === 'string' ? s.replace(/_/g, ' ') : String(s ?? ''));

function shorten(s: string, n = 90): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

/** Drop a leading "Alex " / "Alex: " so the one-liner doesn't repeat the name shown in the avatar column. */
function stripName(s: string, actor?: string): string {
  if (!actor) return s;
  const n = NAMES[actor];
  if (!n) return s;
  return s.replace(new RegExp(`^${n}(?:'s)?[:,]?\\s+`), '');
}

function data(row: TraceRow): Record<string, unknown> {
  return row.result && row.result.ok ? row.result.data : {};
}

/** Short, human one-liner for a decision row. Falls back to the server summary. */
export function oneLiner(row: TraceRow): string {
  const a = row.args ?? {};
  const d = data(row);
  if (row.status === 'proposed') return 'deciding…';
  if (row.result && !row.result.ok) {
    const msg = stripName(row.result.error.message, row.actor);
    return shorten(`${row.result.error.code} — ${msg}`);
  }
  if (row.status === 'malformed' || row.status === 'provider_error' || row.status === 'discarded_stale' || row.status === 'ignored') {
    return shorten(stripName(row.summary, row.actor));
  }
  if (row.status === 'failed') return shorten(stripName(row.summary.split('→').pop()?.trim() ?? row.summary, row.actor));
  switch (row.tool) {
    case 'notify': {
      const msg = typeof a.message === 'string' ? `“${shorten(a.message, 60)}”` : pretty(a.topic);
      const delivered = Array.isArray(d.delivered_to) ? (d.delivered_to as string[]) : null;
      const to = a.recipient === 'all' && delivered ? (delivered.length ? delivered.map(nameOf).join(', ') : 'nobody in earshot') : nameOf(a.recipient);
      return `${msg} → ${to}`;
    }
    case 'move': {
      if (d.already_there) return `already at ${pretty(a.destination)}`;
      const tiles = typeof d.length_tiles === 'number' ? ` · ${d.length_tiles} tiles` : '';
      const withP = typeof d.moving_together_with === 'string' ? ` (with ${nameOf(d.moving_together_with)})` : '';
      const arrived = row.status === 'completed' ? ' ✓ arrived' : '';
      return `→ ${pretty(a.destination)}${withP}${tiles}${arrived}`;
    }
    case 'plan_route': {
      const tiles = typeof d.length_tiles === 'number' ? ` · ${d.length_tiles} tiles` : '';
      const via = Array.isArray(d.zones) && d.zones.length > 2 ? ` via ${pretty((d.zones as string[]).slice(1, -1).slice(0, 3).join(', '))}` : '';
      return `route ${String(d.route_id ?? '')} → ${pretty(a.destination)}${tiles}${via}`.replace(/\s+/g, ' ');
    }
    case 'pull_alarm':
      return d.already_active ? 'alarm already sounding' : 'pulled the fire alarm — everyone alerted';
    case 'check_in':
      return 'checked in at assembly';
    case 'verify_roster': {
      if (d.complete) return Array.isArray(d.lost) && d.lost.length ? `roster complete · lost: ${(d.lost as string[]).map(nameOf).join(', ')}` : 'all accounted for';
      const out = Array.isArray(d.outstanding) ? (d.outstanding as string[]).map(nameOf).join(', ') : '';
      return out ? `outstanding: ${out}` : shorten(stripName(row.summary, row.actor));
    }
    case 'request_assistance':
      return `asked ${nameOf(a.helper_id)} for help`;
    case 'assist':
      return `now escorting ${nameOf(a.person_id)}`;
    case 'consult_plan':
      return `read plan: ${pretty(a.section)}`;
    case 'observe':
      return shorten(stripName(row.summary, row.actor).replace(/^looked around in /, 'looked around · '));
    default:
      return shorten(stripName(row.summary, row.actor));
  }
}

export interface StatusGlyph {
  glyph: string;
  tone: 'ok' | 'run' | 'warn' | 'bad' | 'muted' | 'think';
  label: string;
}

export function statusGlyph(row: TraceRow): StatusGlyph {
  switch (row.status) {
    case 'completed':
      return { glyph: '✓', tone: 'ok', label: 'completed' };
    case 'running':
    case 'accepted':
      return { glyph: '◌', tone: 'run', label: 'running' };
    case 'proposed':
      return { glyph: '…', tone: 'think', label: 'awaiting model' };
    case 'held':
      return { glyph: '⏸', tone: 'muted', label: 'held (paused)' };
    case 'rejected':
      return { glyph: '✕', tone: 'warn', label: 'rejected by the engine' };
    case 'malformed':
      return { glyph: '✕', tone: 'warn', label: 'malformed response' };
    case 'provider_error':
      return { glyph: '✕', tone: 'bad', label: 'provider error' };
    case 'failed':
      return { glyph: '✕', tone: 'bad', label: 'failed / interrupted' };
    case 'discarded_stale':
      return { glyph: '⌀', tone: 'muted', label: 'discarded (stale, after reset)' };
    case 'ignored':
      return { glyph: '⌀', tone: 'muted', label: 'ignored (one action per turn)' };
    default:
      return { glyph: '·', tone: 'muted', label: row.status };
  }
}

export type EventTone = 'fire' | 'power' | 'alarm' | 'lost' | 'ok' | 'msg' | 'seen' | 'end' | 'other';

/** Icon + tone for an engine row, inferred from its (server-written) summary text. */
export function eventIcon(summary: string): { icon: string; tone: EventTone } {
  const s = summary.toLowerCase();
  if (/\blost\b/.test(s) && !s.startsWith('episode ended')) return { icon: '✖', tone: 'lost' };
  if (s.startsWith('episode ended')) return { icon: '■', tone: 'end' };
  if (s.includes('alarm')) return { icon: '🚨', tone: 'alarm' };
  if (s.includes('cut power') || s.includes('dead sliding door') || s.includes('sliding door')) return { icon: '⚡', tone: 'power' };
  if (s.includes('started a fire') || (s.includes('fire') && !s.includes('→'))) return { icon: '🔥', tone: 'fire' };
  if (s.includes('checked in') || s.includes('roster verified') || s.includes('fulfilled')) return { icon: '✓', tone: 'ok' };
  if (s.includes('→') && s.includes('"')) return { icon: '💬', tone: 'msg' };
  if (s.includes(' sees ') || s.includes('smell')) return { icon: '👁', tone: 'seen' };
  if (s.includes('stopped') || s.includes('route unavailable')) return { icon: '⛔', tone: 'power' };
  return { icon: '◆', tone: 'other' };
}

export function fmtSim(t: number): string {
  return `${t.toFixed(1)}s`;
}

/** Engine summaries sometimes start with their own emoji; drop it since the row already shows an icon. */
export function stripLeadingEmoji(summary: string): string {
  return summary.replace(/^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|\uFE0F|\u200D|\s)+/u, '');
}
