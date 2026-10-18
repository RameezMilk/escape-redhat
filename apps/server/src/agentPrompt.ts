// Per-agent mode prompts: each person (Alex, Maya, Daniel) is their own model call, deciding only for themselves from
// what they personally know (engine.agentView). No hard-coded instincts run in this mode — the responsibilities below
// are the person's own judgement, stated once in their system prompt. The central planner prompt (prompt.ts) is
// unchanged and still used by central mode.
import { ACTOR_IDS, ACTOR_PROFILES, ASSISTANCE, countWord, TOOL_DEFS, WARDEN_ID, type ActorId, type AgentView, type MapData, type OpenAIToolDef, type ScenarioCase } from '@escape/contracts';
import { joinNames } from '@escape/engine';
import { placeName } from './places.js';

const place = (z: string | null | undefined) => (z ? placeName(z) : 'somewhere unknown');
const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function building(map: MapData): string {
  const zones = map.zones.map((z) => `${z.id} (${place(z.id)})`).join('; ');
  const edges = map.zoneEdges.map(([a, b]) => `${a}–${b}`).join(', ');
  const alarms = (map.alarms ?? []).map((a) => `${a.id} in ${place(a.zone)}`).join(', ');
  const doors = (map.components ?? []).map((c) => `${c.id} (${place(c.zone)})`).join(', ');
  const exits = map.zones.filter((z) => z.kind === 'exit').map((z) => `${z.id} (${place(z.id)})`);
  const assembly = map.zones.find((z) => z.kind === 'assembly');
  const n = map.alarms?.length ?? 0;
  return `THE BUILDING (one floor, fictional office)
Places: ${zones}.
Connections: ${edges}.
Exits: ${joinNames(exits)} lead outside; exit doors are manual and always open. Assembly point: "assembly" — ${assembly?.label.replace(/^Assembly point \(|\)$/g, '') ?? 'outside'}.
Fire alarm: ${n === 1 ? 'one pull station' : `${countWord(n)} pull stations`}, ${alarms} (move with destination "alarm" — the nearest one; you pull it when you get there; or pull_alarm if you are already standing at one). It is the only way to warn people in other rooms: the siren reaches the whole building.
Your voice (notify) reaches only people in the same room as you (a doorway joins the two rooms it connects; outside is one area).${
    doors ? `\nElectric sliding doors (they stick shut in a power cut): ${doors}.` : ''
  }
Fire spreads every second and can burn through walls into the next room. Walking into fire is fatal.`;
}

/** First-person system prompt for one person. */
export function buildAgentSystemPrompt(id: ActorId, map: MapData, scenario: ScenarioCase): string {
  const p = ACTOR_PROFILES[id];
  const about: string[] = [`You are ${p.name} — ${p.role}. ${p.profile}`];
  if (id === WARDEN_ID) about.push('You are the exercise warden: when everyone is checked in at the assembly point, you confirm the roster with verify_roster (only you can).');
  if (p.usesWheelchair) about.push('You use a wheelchair: your routes are step-free (the engine plans them that way).');
  if (id === ASSISTANCE.person) {
    about.push(
      scenario.danielPreference === 'buddy'
        ? `You told ${ACTOR_PROFILES[ASSISTANCE.buddy].name} you would like a buddy in an evacuation (request_assistance). It is optional — you can also evacuate on your own, and you never wait in danger for a buddy.`
        : 'You evacuate on your own; you have not asked anyone to be your buddy.',
    );
  }
  const others = ACTOR_IDS.filter((o) => o !== id).map((o) => `${ACTOR_PROFILES[o].name} (${ACTOR_PROFILES[o].role})`);
  about.push(`Also in the building: ${joinNames(others)}.`);

  return `You are one of ${countWord(ACTOR_IDS.length)} people in an evacuation drill simulation ("Escape from Red Hat"). You decide ONLY for yourself. Each turn, think about what you personally see, hear and know right now — your surroundings, the hazards you know about, who is with you, whether the alarm is sounding — then call exactly ONE tool for yourself (actor_id "${id}"). A simulation engine checks every action against the real world: an impossible action is rejected with a reason and a hint and changes nothing.

ABOUT YOU
${about.join('\n')}

${building(map)}

WHAT A RESPONSIBLE PERSON DOES (use your own judgement)
- Your life first. If fire is near you, get away from it and out of the building — by the exit that is away from the fire, never through it.
- Raising the alarm is everyone's job, including yours. If you know of a fire and you have not heard the siren, nobody in the other rooms knows yet: pull the nearest fire alarm if you can reach it without passing through fire — best on your way out. If you cannot reach it safely, warn the people in your room and get out.
- Warn the people in your room (notify) if they may not know what you know — in plain words: where the danger is and which way to go. Never put ids or codes in the message text.
- The siren means evacuate now — you do not need to find the danger first.
- Once you are outside, do not go back into the building.
- Go to the assembly point ("assembly") and check_in when you are standing in it.
- If your way is blocked (a dead sliding door, fire ahead), plan_route to "assembly" and move with the returned route_id.${
    id === WARDEN_ID
      ? `\n- As warden: if ${ACTOR_PROFILES[ASSISTANCE.person].name} asks for help and you can reach him safely, go to him and assist; then your moves take him along. When everyone is checked in, call verify_roster.`
      : ''
  }

TURN RULES
Think briefly — a few short sentences, this is an emergency — then make one tool call, for yourself only (actor_id "${id}"). While you are walking somewhere you keep going; you can still speak or look around. Read the result of your last action: never repeat a rejected call unchanged — follow its hint. Only cite evidence ids you know (they are listed under WHAT YOU KNOW). observe / plan_route / consult_plan move nobody; do not use them twice in a row without a reason.`;
}

/** Personal digest as the user message for one person's decision. Every id they may cite (evidence, routes) is in it;
 *  the raw view is not appended — with reasoning on, prompt + thinking must fit the 8k context. */
export function agentUserContent(view: AgentView): string {
  const me = view.me;
  const lines: string[] = [`TIME: ${view.sim_time.toFixed(1)} s`];
  const state = me.checked_in ? 'checked in at the assembly point' : me.doing ? me.doing : me.status === 'moving' ? 'moving' : 'standing still';
  lines.push(
    `YOU: ${me.name} — in ${place(me.zone)} (${me.zone ?? '?'}), ${state}${me.outside ? ' — you are OUTSIDE the building' : ''}${me.escort ? `; ${me.escort}` : ''}.`,
  );

  const nearest = view.hazards
    .filter((h) => h.kind === 'fire' && h.bbox)
    .map((h) => distToBox(me.tile, h.bbox!))
    .sort((a, b) => a - b)[0];
  if (nearest !== undefined && nearest <= 3 && !me.outside) lines.push(`DANGER: known fire about ${Math.round(nearest)} tiles from you.`);
  lines.push('WHAT YOU KNOW:');
  if (!view.hazards.length) lines.push('- No hazard seen or reported to you.');
  for (const h of view.hazards) {
    const where = h.places.length ? h.places.join(', ') : 'unknown place';
    if (h.kind === 'fire') {
      const near = h.bbox ? Math.max(0, Math.round(distToBox(me.tile, h.bbox))) : null;
      lines.push(
        `- ${h.id}: fire — known burning in ${where}${h.spreading ? ', spreading' : ''}${near !== null ? `; the nearest known flames are about ${near} tiles from you` : ''}.`,
      );
    } else {
      lines.push(`- ${h.id}: ${h.what} — that sliding door is stuck shut; routes through it are blocked.`);
    }
  }

  const station = [...view.alarm.station].sort((a, b) => dist(me.tile, a.stand) - dist(me.tile, b.stand))[0];
  if (view.alarm.sounding) lines.push('ALARM: SOUNDING — the siren has alerted everyone in the building.');
  else
    lines.push(
      `ALARM: silent — you have not heard the siren${station ? `. The nearest pull station is in ${place(station.zone)}, about ${Math.round(dist(me.tile, station.stand))} tiles from you (destination "alarm")` : ''}.`,
    );

  lines.push(
    view.with_me.length
      ? `WITH YOU (can hear you): ${view.with_me.map((p) => `${p.name} (${p.checked_in ? 'checked in' : p.doing ?? (p.alerted ? 'alerted, standing still' : 'not alerted — still working')})`).join('; ')}.`
      : 'WITH YOU: nobody else is in your room.',
  );
  if (view.others.length) lines.push(`OTHERS: ${view.others.map((o) => `${o.name} — ${o.where}`).join('; ')}.`);

  if (view.heard.length) {
    lines.push('YOU HEARD:');
    for (const m of view.heard) lines.push(`- ${m.at.toFixed(1)} s, ${nameOf(m.from)}: "${m.message}"`);
  }
  const as = view.assistance;
  const asx: string[] = [];
  if (as.requested_of_me.length) asx.push(`${as.requested_of_me.map(nameOf).join(', ')} asked you for help evacuating`);
  if (as.requested_by_me) asx.push(`you asked ${nameOf(as.requested_by_me)} for help`);
  if (as.escorting) asx.push(`you are escorting ${nameOf(as.escorting)}`);
  if (as.escorted_by) asx.push(`${nameOf(as.escorted_by)} is escorting you`);
  if (asx.length) lines.push(`ASSISTANCE: ${asx.join('; ')}.`);
  if (view.roster) lines.push(`ROSTER (at the assembly point): checked in — ${view.roster.checked_in.map(nameOf).join(', ') || 'nobody yet'}; verified: ${view.roster.verified ? 'yes' : 'no'}.`);
  if (view.my_routes.length) {
    const r = view.my_routes[view.my_routes.length - 1];
    lines.push(`YOUR LATEST PLANNED ROUTE: ${r.route_id} to ${r.destination} via ${r.zones.map(place).join(' → ')}.`);
  }
  const last = view.my_recent_actions[view.my_recent_actions.length - 1];
  if (last) {
    lines.push(
      last.ok
        ? `YOUR LAST ACTION: ${last.tool ?? '?'} — ${last.summary}`
        : `YOUR LAST ACTION WAS REJECTED: ${last.tool ?? '?'} — ${last.error_code ?? ''} ${last.summary}${last.hint ? ` Hint: ${last.hint}` : ''}`,
    );
  }
  if (view.new_for_me.length) {
    lines.push('SINCE YOUR LAST DECISION:');
    for (const t of view.new_for_me.slice(-8)) lines.push(`- ${t}`);
  }
  lines.push('', 'Decide your next action now — one tool call, for yourself.');
  return lines.join('\n');
}

function nameOf(id: string): string {
  return (ACTOR_IDS as readonly string[]).includes(id) ? ACTOR_PROFILES[id as ActorId].name : id;
}

function distToBox(t: [number, number], b: [number, number, number, number]): number {
  const dx = Math.max(b[0] - t[0], 0, t[0] - b[2]);
  const dy = Math.max(b[1] - t[1], 0, t[1] - b[3]);
  return Math.hypot(dx, dy);
}

/** The tools this person can use right now, all pinned to actor_id = self. The engine still validates every call. */
export function agentToolsFor(id: ActorId, view: AgentView): OpenAIToolDef[] {
  const me = view.me;
  const hearers = view.with_me.map((p) => p.id);
  // Looking around twice in a row tells nobody anything new: after an observe, offer real actions instead.
  const lastTool = view.my_recent_actions[view.my_recent_actions.length - 1]?.tool;
  const offer: Record<string, boolean> = {
    observe: !me.checked_in && lastTool !== 'observe',
    consult_plan: true,
    notify: hearers.length > 0,
    plan_route: !me.checked_in,
    // Already walking somewhere: the engine would reject a second move (ACTOR_BUSY), so it is not offered.
    move: !me.checked_in && !me.doing,
    request_assistance: !me.checked_in && me.uses_wheelchair && !view.assistance.requested_by_me,
    assist: !me.checked_in && view.assistance.requested_of_me.length > 0 && !view.assistance.escorting,
    check_in: !me.checked_in && me.zone === 'assembly',
    verify_roster: id === WARDEN_ID && me.checked_in,
    pull_alarm: !view.alarm.sounding && !me.checked_in,
  };
  const out: OpenAIToolDef[] = [];
  for (const def of TOOL_DEFS) {
    if (!offer[def.function.name]) continue;
    const params = def.function.parameters as { properties: Record<string, Record<string, unknown>> };
    const properties: Record<string, Record<string, unknown>> = {
      ...params.properties,
      actor_id: { ...params.properties.actor_id, enum: [id], description: `Always "${id}" — you act only for yourself.` },
    };
    if (def.function.name === 'notify') {
      properties.recipient = { ...params.properties.recipient, enum: ['all', ...hearers], description: `'all' (everyone in your room) or one person in your room.` };
    }
    out.push({ ...def, function: { ...def.function, parameters: { ...params, properties } } });
  }
  return out;
}
