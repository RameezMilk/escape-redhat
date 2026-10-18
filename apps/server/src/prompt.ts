// Planner prompt. Two harness versions for the baseline-vs-final evaluation:
//   v1 = baseline: role, people, map, tools; no procedural guidance.
//   v2 = v1 + explicit exercise procedure and error-recovery guidance.
// The model never sees unobserved hazard truth: the user message is exactly engine.plannerView().
import { ACTOR_IDS, ACTOR_PROFILES, ASSISTANCE, countWord, TOOL_DEFS, WARDEN_ID, type MapData, type OpenAIToolDef, type PlannerView, type ScenarioCase, type ZoneId } from '@escape/contracts';
import { inEarshot, isOutsideZone, joinNames, loadMap, placesFor, roomsOf } from '@escape/engine';
import type { Harness } from './config.js';

const nm = (id: string) => ACTOR_PROFILES[id as keyof typeof ACTOR_PROFILES]?.name ?? id;
/** Warden, assisted person and buddy by name (from ACTOR_PROFILES). */
const W = nm(WARDEN_ID);
const P = nm(ASSISTANCE.person);
const B = nm(ASSISTANCE.buddy);

function briefing(map: MapData, scenario: ScenarioCase): string {
  const people = ACTOR_IDS.map((id) => {
    const p = ACTOR_PROFILES[id];
    let line = `- ${id} — ${p.name}, ${p.role}. ${p.profile}`;
    if (id === WARDEN_ID) line += ` Only ${W} can call verify_roster.`;
    if (id === ASSISTANCE.person) {
      line +=
        scenario.danielPreference === 'buddy'
          ? ` Assistance preference: would like ${B} as his buddy (guide) during an evacuation — optional, he can also evacuate on his own.`
          : ' Assistance preference: independent — he evacuates on his own and has NOT asked for a buddy.';
    }
    return line;
  }).join('\n');

  const zones = map.zones.map((z) => `${z.id} (${z.label})`).join('; ');
  const edges = map.zoneEdges.map(([a, b]) => `${a}–${b}`).join(', ');
  const alarms = (map.alarms ?? []).map((a) => `${a.id} (${a.zone})`).join(', ');
  const doors = (map.components ?? []).map((c) => `${c.id} (${c.zone})`).join(', ');
  const exits = map.zones.filter((z) => z.kind === 'exit').map((z) => `${z.id} (${z.label})`).join(', ');
  const outdoors = map.zones.filter((z) => z.kind === 'outdoor').map((z) => z.id).join(', ');
  const assembly = map.zones.find((z) => z.kind === 'assembly');
  const stations = map.alarms?.length ?? 0;
  return `PEOPLE
${people}

MAP (one ground-level floor; fictional office)
Zones: ${zones}.
Connections: ${edges}.
Exits: ${exits}; exit doors are manual and always open. Outside (${outdoors}, assembly) is one area; the assembly point is zone "assembly" (${assembly?.label ?? 'outside'}).
Speech: notify is spoken — it reaches only people in the same room (doorways join the two rooms they connect; outside is one area). People in other rooms do not hear it.${
    alarms
      ? `\nFire-alarm pull station${stations > 1 ? 's' : ''}: ${alarms} — the ONLY way to alert people in other rooms. Use move with destination "alarm" to reach ${stations > 1 ? 'the nearest one' : 'it'}.`
      : ''
  }${doors ? `\nElectric sliding doors (can fail closed in a power outage): ${doors}.` : ''}
Instincts (automatic — not your actions): a person who sees fire shouts "Fire!" to everyone in their room; people back away from fire that is close to them; anyone who passes a pull station while the alarm is off pulls it.
Fire spreads every second and can burn through walls into the next room. People who are outside cannot go back into the building.`;
}

const ROLE = `You are the exercise coordinator AI for a fictional office evacuation drill ("Escape from Red Hat"). You centrally direct ${countWord(ACTOR_IDS.length)} simulated people — ${joinNames(ACTOR_IDS.map(nm))} — by calling exactly ONE tool per turn; every call names the actor_id who acts. A simulation engine validates each call against the true world state: invalid calls are rejected with an error code and a hint and change nothing. Each turn you receive the current state as JSON: actors (zone, status, alerted, checked_in, busy, lost), evidence (hazards someone has observed or been told about — you only know what the people know), the fire alarm, messages, assistance status, roster, planned routes, recent action results, and what changed since your last decision.`;

const GOAL_V1 = `GOAL
Get everyone safely to the assembly point and accounted for. Use the tools. One tool call per turn.`;

const PROCEDURE_V2 = `PROCEDURE (in order of need)
1. Life first: anyone near known fire moves away and OUT now. People back away from close fire by instinct, but only you send them to an exit. Choose the exit AWAY from the fire and avoid routes that pass near known fire.
2. Alert: people shout "Fire!" to their own room automatically. Anyone in another room hears nothing until a fire-alarm pull station is pulled — the only building-wide alert. Pick the person whose way out already passes a pull station (or the nearest person not in danger) and move them to destination "alarm" (the nearest station; they pull it on arrival; or call pull_alarm), then to "assembly". Skip the alarm if everyone is already alerted or outside.
3. Never send anyone back inside: people who are outside cannot re-enter (rejected).
4. Recover: dead sliding doors and fire can cut a route. If a move fails (ROUTE_UNAVAILABLE or STALE_STATE), plan_route for that person to "assembly" and move with the returned route_id. Tell people in the same room with notify (topic "route_blocked") if it helps them.
5. Buddy (optional): ${P} may ask ${B} for help (request_assistance → ${B} next to him → assist; then moving ${B} moves both). Never delay anyone's evacuation for it; nobody is carried.
6. Account: check_in each person inside the assembly area; when every survivor is checked in, ${W} calls verify_roster — the only way to confirm the drill is complete.
MESSAGES: plain language — where the danger is and which way to go, e.g. "Fire in the Red Hat room — leave through the kitchen and the back exit, now!" or "The reception door is dead — go through the cubicles and the side door to the main entrance." Never put evidence ids, zone codes or coordinates in message text (evidence_ids carries those).
RULES: send people to destination "assembly" (their route goes through the nearest safe exit) rather than to an exit; one tool call per turn, most urgent person first; the tool list shows only people who can take each action right now; never repeat a rejected call unchanged — read its hint and fix the cause; only cite evidence ids that appear in the state; plan_route/observe/consult_plan are optional look-ups that move nobody.`;

export function buildSystemPrompt(harness: Harness, map: MapData, scenario: ScenarioCase): string {
  return [ROLE, briefing(map, scenario), harness === 'v2' ? PROCEDURE_V2 : GOAL_V1].join('\n\n');
}

type ViewActor = PlannerView['actors'][number];

/** Outside the building (no going back in once here). */
const isOutside = (a: ViewActor) => isOutsideZone(a.zone as ZoneId | null);
/** A person moving on instinct (backing away from fire) can be given a destination — they are not really busy. */
const onInstinct = (a: ViewActor) => !!a.busy && /instinct|backing away|flee/i.test(a.busy);
const reallyBusy = (a: ViewActor) => !!a.busy && !onInstinct(a);
/** Place names for the digest (zone ids stay available to the model alongside them). */
const place = (z: string | null | undefined) => {
  if (!z) return 'an unknown place';
  const p = placesFor(loadMap());
  return p.isZone(z) ? p.placeName(z) : z.replace(/_/g, ' ');
};

const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Pull stations as the planner sees them (PlannerView.alarm.stations), falling back to the static map. */
function stationsOf(view: PlannerView, map?: MapData): { id: string; zone: string; stand: [number, number] }[] {
  const fromView = view.alarm?.stations;
  if (fromView?.length) return fromView;
  return (map?.alarms ?? []).map((a) => ({ id: a.id, zone: a.zone, stand: [a.stand.col, a.stand.row] as [number, number] }));
}

/** Earshot between two zones: same room (doorways join both sides); without a map, same zone only. */
function earshot(map: MapData | undefined, za: string | null, zb: string | null): boolean {
  if (!za || !zb) return false;
  if (!map) return za === zb;
  return inEarshot(map, za as ZoneId, zb as ZoneId);
}

/** "rh_room: maya, daniel · lobby: alex" — people grouped by the room(s) they can be heard in. */
function earshotGroups(people: ViewActor[], map?: MapData): string {
  const groups = new Map<string, string[]>();
  for (const a of people) {
    if (!a.zone) continue;
    const rooms = map ? roomsOf(map, a.zone as ZoneId) : [a.zone];
    const key = rooms.length > 1 ? `${a.zone} (hears ${rooms.join(' + ')})` : (rooms[0] ?? a.zone);
    groups.set(key, [...(groups.get(key) ?? []), a.id]);
  }
  return [...groups].map(([k, ids]) => `${k}: ${ids.join(', ')}`).join(' · ');
}

/** v2 only: a short digest of the (already planner-visible) state, so a small model does not have to dig through JSON.
 *  Derived purely from the PlannerView (+ static map layout) — no hidden world truth. */
export function stateDigest(view: PlannerView, map?: MapData): string {
  const all = view.actors ?? [];
  const actors = all.filter((a) => !a.lost);
  const lost = all.filter((a) => a.lost);
  const recent = view.recent_actions ?? [];
  // Decisions since each person last received an order (within the recent window) — a starvation signal.
  const sinceOrder = (id: string) => {
    for (let i = recent.length - 1; i >= 0; i--) if (recent[i].actor === id) return recent.length - 1 - i;
    return recent.length;
  };
  // Distance from a person to the nearest KNOWN fire (bbox of known cells) — a risk signal from planner-visible state.
  const fireBoxes = (view.evidence ?? []).filter((e) => e.kind === 'fire' && e.bbox).map((e) => ({ id: e.id, box: e.bbox! }));
  const fireDist = (a: { tile: [number, number] }) => {
    let best = Infinity;
    let id = '';
    for (const f of fireBoxes) {
      const [c0, r0, c1, r1] = f.box;
      const dc = Math.max(c0 - a.tile[0], 0, a.tile[0] - c1);
      const dr = Math.max(r0 - a.tile[1], 0, a.tile[1] - r1);
      const d = Math.hypot(dc, dr);
      if (d < best) [best, id] = [d, f.id];
    }
    return { d: best, id };
  };
  const ready = actors
    .filter((a) => a.alerted && !a.checked_in && !reallyBusy(a))
    .sort((a, b) => fireDist(a).d - fireDist(b).d || sinceOrder(b.id) - sinceOrder(a.id));
  const atRisk = actors
    .filter((a) => !a.checked_in && !reallyBusy(a) && !isOutside(a) && fireDist(a).d <= 8)
    .sort((a, b) => fireDist(a).d - fireDist(b).d);
  const busy = actors.filter((a) => reallyBusy(a) && !a.checked_in);
  const outside = actors.filter((a) => isOutside(a));
  const instinctive = actors.filter((a) => onInstinct(a) && !a.checked_in);
  const unalerted = actors.filter((a) => !a.alerted && !a.checked_in);
  const stations = stationsOf(view, map);
  const hears = (a: ViewActor, b: ViewActor) => earshot(map, a.zone, b.zone);

  const hazardLines: string[] = [];
  for (const e of view.evidence ?? []) {
    if (e.kind === 'fire') {
      const zones = e.zones?.length ? e.zones.join(', ') : (e.zone ?? 'unknown area');
      hazardLines.push(`${e.id} fire in ${place(e.zone)} (zones: ${zones}): ~${e.cells_known ?? '?'} known burning cells${e.spreading !== false ? ' — spreading' : ''} (known to ${e.known_by.join(', ')})`);
    } else {
      hazardLines.push(`${e.id} dead sliding door: ${e.component ?? 'unknown door'}${e.zone ? ` in ${place(e.zone)} (${e.zone})` : ''} — stuck closed, route around it (known to ${e.known_by.join(', ')})`);
    }
  }

  const alarm = view.alarm;
  let alarmLine: string;
  if (alarm?.active) {
    alarmLine = `ALARM: sounding${alarm.by ? ` (pulled by ${alarm.by}${alarm.at !== undefined ? ` at ${alarm.at}s` : ''})` : ''} — everyone alive has been alerted.`;
  } else {
    const canPull = actors.filter((a) => (a.alerted || a.knows_evidence.length) && !reallyBusy(a) && stations.some((st) => dist(a.tile, st.stand) <= 1.5));
    const near = actors
      .filter((a) => (a.alerted || a.knows_evidence.length) && !a.checked_in && !canPull.includes(a))
      .map((a) => {
        const best = stations.map((st) => ({ st, d: dist(a.tile, st.stand) })).sort((x, y) => x.d - y.d)[0];
        return best && best.d <= 6 ? `${a.id} is ${best.d.toFixed(1)} tiles from ${best.st.id}` : null;
      })
      .filter((x): x is string => !!x);
    alarmLine = `ALARM: not raised (anyone who passes a pull station pulls it automatically).${canPull.length ? ` Next to a pull station now: ${canPull.map((a) => a.id).join(', ')} (can pull_alarm).` : ''}${near.length ? ` Close: ${near.join('; ')}.` : ''}`;
  }

  const open: string[] = [];
  // Who could reach a pull station without going back inside (inside, alerted, alive), nearest first.
  const runners = actors
    .filter((a) => (a.alerted || a.knows_evidence.length) && !a.checked_in && !isOutside(a))
    .map((a) => ({ a, d: Math.min(...stations.map((st) => dist(a.tile, st.stand)), Infinity) }))
    .filter((r) => Number.isFinite(r.d))
    .sort((x, y) => x.d - y.d);
  for (const u of unalerted) {
    const tellers = actors.filter((a) => a.id !== u.id && a.alerted && a.knows_evidence.length && hears(a, u));
    if (tellers.length) {
      open.push(`Not alerted yet: ${u.id} (in ${u.zone}) — ${tellers.map((t) => t.id).join(' or ')} can tell them in person (same room).`);
    } else if (!alarm?.active) {
      const who = runners.length
        ? ` Can reach the alarm without going back inside: ${runners.map((r) => `${r.a.id} (≈${Math.round(r.d)} tiles${reallyBusy(r.a) ? ', moving' : ''})`).join(', ')}.`
        : ' Nobody inside who knows can reach it.';
      open.push(`Not alerted yet: ${u.id} (in ${u.zone}) — out of earshot of everyone who knows; only a fire alarm reaches them (move someone to "alarm").${who}`);
    }
  }
  for (const a of instinctive) open.push(`${a.id} is backing away from the fire by instinct — give ${a.id} a destination (they can take orders now).`);
  const as = view.assistance;
  const warden = actors.find((a) => a.id === WARDEN_ID);
  const buddy = actors.find((a) => a.id === ASSISTANCE.buddy);
  const person = actors.find((a) => a.id === ASSISTANCE.person);
  const buddyOpen = !!as && as.preference === 'buddy' && !as.fulfilled && !!person && !person.checked_in && !!buddy && !buddy.checked_in;
  if (buddyOpen && buddy && person) {
    const gap = dist(buddy.tile, person.tile);
    if (!as.requested) {
      if (person.alerted) open.push(`Optional: ${P} may ask ${B} for help (request_assistance, helper_id "${ASSISTANCE.buddy}") — good practice, but do not delay anyone's evacuation for it.`);
    } else if (!as.accepted) {
      if (buddy.busy) open.push(`${B} is on his way (${buddy.busy}); give orders to others meanwhile.`);
      else if (gap > 1.5) open.push(`${P} has asked ${B} for help; ${B} is ${gap.toFixed(1)} tiles away — move ${ASSISTANCE.buddy} to destination "${ASSISTANCE.person}", or let ${P} evacuate on his own if the fire is close.`);
      else open.push(`${B} is next to ${P} and ${P} has asked for help — ${B} can call assist for ${P} now.`);
    } else open.push(`${B} is escorting ${P}; moving ${B} moves both.`);
  }
  for (const a of actors) {
    if (a.zone === 'assembly' && !a.checked_in && !reallyBusy(a)) open.push(`${a.name} is at the assembly point but not checked in.`);
  }
  if (actors.length && actors.every((a) => a.checked_in) && !view.roster?.verified) {
    open.push(warden ? `Everyone still alive is checked in; ${W} should verify_roster.` : 'Everyone still alive is checked in (the warden was lost, so nobody can verify the roster).');
  }

  const last = recent[recent.length - 1];
  const lines: string[] = [];
  if (atRisk.length) {
    lines.push(
      `URGENT — near known fire and not moving (closest first): ${atRisk
        .map((a) => `${a.id} (≈${Math.round(fireDist(a).d)} tiles from ${fireDist(a).id}, in ${a.zone}${a.alerted ? '' : ', NOT alerted'})`)
        .join(', ')}. Fire spreads every second: get them moving to "assembly" before anything else${atRisk.some((a) => !a.alerted) ? ' (alert the un-alerted first: notify if in the same room, otherwise a fire alarm)' : ''}.`,
    );
  }
  lines.push(
    `WAITING FOR YOUR ORDERS (most at risk first): ${
      ready
        .map((a) => {
          const n = sinceOrder(a.id);
          return `${a.id} (in ${a.zone}${n >= recent.length && recent.length ? `, no order in your last ${recent.length} decisions` : n > 0 ? `, last order ${n} decisions ago` : ''})`;
        })
        .join(', ') || 'nobody'
    }`,
    `BUSY MOVING (do not move/assist them again yet): ${busy.map((a) => `${a.id} — ${a.busy}`).join('; ') || 'nobody'}`,
    `EARSHOT (who can hear whom — notify reaches only these groups): ${earshotGroups(actors.filter((a) => !a.checked_in), map) || 'nobody inside'}`,
    `HAZARDS: ${hazardLines.length ? hazardLines.map((h) => `\n- ${h}`).join('') : 'none known yet'}`,
    alarmLine,
  );
  if (outside.length) lines.push(`OUTSIDE (can't go back in): ${outside.map((a) => `${a.id}${a.checked_in ? ' (checked in)' : ''}`).join(', ')}`);
  if (lost.length) lines.push(`LOST (cannot act): ${lost.map((a) => a.id).join(', ')}`);
  lines.push(`OPEN ITEMS: ${open.length ? open.map((o) => `\n- ${o}`).join('') : 'none'}`);
  lines.push('NOTE: move plans its own route; plan_route/observe/consult_plan are optional look-ups — they do not move anyone.');
  if (last && !last.ok) {
    lines.push(`YOUR LAST CALL WAS REJECTED (${last.decision} ${last.tool ?? ''} for ${last.actor ?? '?'}): ${last.error_code ?? ''} — ${last.hint ?? last.summary}. Do not repeat it unchanged.`);
  }
  return lines.join('\n');
}

export function userContent(view: PlannerView, harness: Harness = 'v2', map?: MapData): string {
  if (harness === 'v1') return `Current state (JSON):\n${JSON.stringify(view)}\n\nChoose the single best next tool call.`;
  return `${stateDigest(view, map)}\n\nCurrent state (JSON):\n${JSON.stringify(view)}\n\nChoose ONE tool call — normally for the most urgent person who is waiting for your orders.`;
}

export function buildMessages(harness: Harness, map: MapData, scenario: ScenarioCase, view: PlannerView) {
  return [
    { role: 'system' as const, content: buildSystemPrompt(harness, map, scenario) },
    { role: 'user' as const, content: userContent(view, harness, map) },
  ];
}


/** v2 only: per-decision action masking. Each tool's actor_id enum lists only the people who can sensibly take that
 *  action right now (derived from the planner-visible state + static map). The engine still validates every call, and
 *  any invalid proposal is still recorded — masking narrows the menu, it does not hide failures. Lost people never
 *  appear. v1 sends the static TOOL_DEFS. */
export function toolsFor(harness: Harness, view: PlannerView, map?: MapData): OpenAIToolDef[] {
  if (harness === 'v1') return TOOL_DEFS;
  const all = view.actors ?? [];
  if (!all.length) return TOOL_DEFS;
  const actors = all.filter((a) => !a.lost);
  const as = view.assistance;
  const person = actors.find((a) => a.id === ASSISTANCE.person);
  const buddy = actors.find((a) => a.id === ASSISTANCE.buddy);
  const warden = actors.find((a) => a.id === WARDEN_ID);
  const free = (a: ViewActor) => a.alerted && !a.checked_in && !reallyBusy(a);
  const stations = stationsOf(view, map);
  const allowed: Record<string, string[]> = {
    observe: actors.filter((a) => !a.checked_in).map((a) => a.id),
    consult_plan: actors.map((a) => a.id),
    notify: actors
      .filter((a) => a.alerted && a.knows_evidence.length && actors.some((b) => b.id !== a.id && earshot(map, a.zone, b.zone)))
      .map((a) => a.id),
    plan_route: actors.filter((a) => !a.checked_in).map((a) => a.id),
    move: actors.filter(free).map((a) => a.id),
    request_assistance: actors.filter((a) => a.alerted && !a.checked_in && a.uses_wheelchair && !as?.requested).map((a) => a.id),
    assist: [],
    check_in: actors.filter((a) => a.zone === 'assembly' && !a.checked_in && !reallyBusy(a)).map((a) => a.id),
    verify_roster: warden && warden.checked_in && actors.every((a) => a.checked_in) ? [WARDEN_ID] : [],
    pull_alarm: view.alarm?.active
      ? []
      : actors
          .filter((a) => (a.alerted || a.knows_evidence.length) && !reallyBusy(a) && stations.some((st) => dist(a.tile, st.stand) <= 1.5))
          .map((a) => a.id),
  };
  if (as?.requested && !as.accepted && person && buddy && free(buddy) && !reallyBusy(person) && dist(buddy.tile, person.tile) <= 1.5) {
    allowed.assist = [ASSISTANCE.buddy];
  }
  // notify recipients: only people within earshot of an offered speaker (plus 'all' = everyone within earshot).
  const hearers = new Set<string>();
  for (const sid of allowed.notify) {
    const sp = actors.find((a) => a.id === sid)!;
    for (const b of actors) if (b.id !== sid && earshot(map, sp.zone, b.zone)) hearers.add(b.id);
  }
  const out: OpenAIToolDef[] = [];
  for (const def of TOOL_DEFS) {
    const ids = allowed[def.function.name];
    if (!ids || !ids.length) continue;
    const params = def.function.parameters as { properties: Record<string, Record<string, unknown>> };
    const properties: Record<string, Record<string, unknown>> = { ...params.properties, actor_id: { ...params.properties.actor_id, enum: ids } };
    if (def.function.name === 'notify') properties.recipient = { ...params.properties.recipient, enum: ['all', ...ACTOR_IDS.filter((id) => hearers.has(id))] };
    out.push({ ...def, function: { ...def.function, parameters: { ...params, properties } } });
  }
  return out.length ? out : TOOL_DEFS;
}
