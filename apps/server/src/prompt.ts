// Planner prompt. Two harness versions for the baseline-vs-final evaluation:
//   v1 = baseline: role, people, map, tools; no procedural guidance.
//   v2 = v1 + explicit exercise procedure and error-recovery guidance.
// The model never sees unobserved hazard truth: the user message is exactly engine.plannerView().
import { ACTOR_IDS, ACTOR_PROFILES, TOOL_DEFS, type MapData, type OpenAIToolDef, type PlannerView, type ScenarioCase } from '@escape/contracts';
import type { Harness } from './config.js';

function briefing(map: MapData, scenario: ScenarioCase): string {
  const people = ACTOR_IDS.map((id) => {
    const p = ACTOR_PROFILES[id];
    let line = `- ${id} — ${p.name}, ${p.role}. ${p.profile}`;
    if (id === 'alex') line += ' Only Alex can call verify_roster.';
    if (id === 'daniel') {
      line +=
        scenario.danielPreference === 'buddy'
          ? ' Assistance preference: would like Alex as his buddy (guide) during an evacuation — optional, he can also evacuate on his own.'
          : ' Assistance preference: independent — he evacuates on his own and has NOT asked for a buddy.';
    }
    return line;
  }).join('\n');

  const zones = map.zones.map((z) => `${z.id} (${z.label})`).join('; ');
  const edges = map.zoneEdges.map(([a, b]) => `${a}–${b}`).join(', ');
  const alarms = (map.alarms ?? []).map((a) => `${a.id} (${a.zone})`).join(', ');
  const doors = (map.components ?? []).map((c) => `${c.id} (${c.zone})`).join(', ');
  return `PEOPLE
${people}

MAP (one ground-level floor; fictional office)
Zones: ${zones}.
Connections: ${edges}.
Exits: west_exit and east_exit, both lead outside to the plaza; exit doors are manual and always open. Assembly point: zone "assembly" in the plaza.${
    alarms ? `\nFire-alarm pull stations: ${alarms}. Use move with destination "alarm" to reach the nearest one.` : ''
  }${doors ? `\nElectric sliding doors (can fail closed in a power outage): ${doors}.` : ''}`;
}

const ROLE = `You are the exercise coordinator AI for a fictional office evacuation drill ("Escape from Red Hat"). You centrally direct three simulated people — Alex, Maya and Daniel — by calling exactly ONE tool per turn; every call names the actor_id who acts. A simulation engine validates each call against the true world state: invalid calls are rejected with an error code and a hint and change nothing. Each turn you receive the current state as JSON: actors (zone, status, alerted, checked_in, busy, lost), evidence (hazards someone has observed or been told about — you only know what the people know), the fire alarm, messages, assistance status, roster, planned routes, recent action results, and what changed since your last decision.`;

const GOAL_V1 = `GOAL
Get everyone safely to the assembly point and accounted for. Use the tools. One tool call per turn.`;

const PROCEDURE_V2 = `PROCEDURE (follow in order of need)
1. Report: whoever sees fire raises the alarm. If they are standing next to a pull station (pull_alarm is offered for them) — or one is only a few steps away — pull_alarm; otherwise notify recipient "all" with topic "fire" and the evidence_ids they know. The alarm alerts everyone but does not say where the fire is. People who have not been alerted cannot evacuate (NOT_AUTHORIZED).
2. Evacuate immediately: move each alerted person to destination "assembly" — do not wait. Fire SPREADS every second and anyone it reaches is lost. Keep away from known fire. Moves take time — you are told when they complete or are interrupted; meanwhile act for other people.
3. Recover: electric sliding doors can be dead (stuck closed) and fire can cut a route. If a move fails with ROUTE_UNAVAILABLE or STALE_STATE, have the person who saw it notify "all" with topic "route_blocked" and the new evidence id, then plan_route for the traveller to "assembly" and move with the returned route_id.
4. Buddy (optional, good practice): Daniel may ask Alex for help (request_assistance with helper_id "alex"); Alex then comes next to him and calls assist, after which moving Alex moves both. Never assist without Daniel's request; nobody is carried; do not delay anyone's evacuation for it.
5. Account: when a person is inside the assembly area and not moving, call check_in for them. When every surviving person is checked in, Alex calls verify_roster — only this confirms the drill is complete. Lost people cannot act and are reported by the roster.
RULES: each turn the tool list (and each tool's actor_id options) shows only the people who can take that action right now; one tool call per turn; never repeat a rejected call unchanged — read its error hint and fix the cause; only cite evidence ids that appear in the state; keep messages short and calm; reason_summary is optional, one short line.`;

export function buildSystemPrompt(harness: Harness, map: MapData, scenario: ScenarioCase): string {
  return [ROLE, briefing(map, scenario), harness === 'v2' ? PROCEDURE_V2 : GOAL_V1].join('\n\n');
}

type ViewActor = PlannerView['actors'][number];

const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Pull stations as the planner sees them (PlannerView.alarm.stations), falling back to the static map. */
function stationsOf(view: PlannerView, map?: MapData): { id: string; zone: string; stand: [number, number] }[] {
  const fromView = view.alarm?.stations;
  if (fromView?.length) return fromView;
  return (map?.alarms ?? []).map((a) => ({ id: a.id, zone: a.zone, stand: [a.stand.col, a.stand.row] as [number, number] }));
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
    .filter((a) => a.alerted && !a.checked_in && !a.busy)
    .sort((a, b) => fireDist(a).d - fireDist(b).d || sinceOrder(b.id) - sinceOrder(a.id));
  const atRisk = actors
    .filter((a) => !a.checked_in && !a.busy && a.zone !== 'assembly' && fireDist(a).d <= 8)
    .sort((a, b) => fireDist(a).d - fireDist(b).d);
  const busy = actors.filter((a) => a.busy && !a.checked_in);
  const unalerted = actors.filter((a) => !a.alerted && !a.checked_in);
  const stations = stationsOf(view, map);

  const hazardLines: string[] = [];
  for (const e of view.evidence ?? []) {
    if (e.kind === 'fire') {
      const zones = e.zones?.length ? e.zones.join(', ') : (e.zone ?? 'unknown area');
      hazardLines.push(`${e.id} fire: ~${e.cells_known ?? '?'} known burning cells across ${zones}${e.spreading !== false ? ' — spreading' : ''} (known to ${e.known_by.join(', ')})`);
    } else {
      hazardLines.push(`${e.id} dead sliding door: ${e.component ?? 'unknown door'}${e.zone ? ` (${e.zone})` : ''} — stuck closed, route around it (known to ${e.known_by.join(', ')})`);
    }
  }

  const alarm = view.alarm;
  let alarmLine: string;
  if (alarm?.active) {
    alarmLine = `ALARM: sounding${alarm.by ? ` (pulled by ${alarm.by}${alarm.at !== undefined ? ` at ${alarm.at}s` : ''})` : ''} — everyone alive has been alerted.`;
  } else {
    const canPull = actors.filter((a) => (a.alerted || a.knows_evidence.length) && !a.busy && stations.some((st) => dist(a.tile, st.stand) <= 1.5));
    const near = actors
      .filter((a) => (a.alerted || a.knows_evidence.length) && !a.checked_in && !canPull.includes(a))
      .map((a) => {
        const best = stations.map((st) => ({ st, d: dist(a.tile, st.stand) })).sort((x, y) => x.d - y.d)[0];
        return best && best.d <= 6 ? `${a.id} is ${best.d.toFixed(1)} tiles from ${best.st.id}` : null;
      })
      .filter((x): x is string => !!x);
    alarmLine = `ALARM: not raised.${canPull.length ? ` Next to a pull station now: ${canPull.map((a) => a.id).join(', ')} (can pull_alarm).` : ''}${near.length ? ` Close: ${near.join('; ')}.` : ''}`;
  }

  const open: string[] = [];
  if (unalerted.length) {
    open.push(`Not alerted yet: ${unalerted.map((a) => a.id).join(', ')} — pull the alarm or notify them before they can evacuate.`);
  }
  const as = view.assistance;
  const alex = actors.find((a) => a.id === 'alex');
  const daniel = actors.find((a) => a.id === 'daniel');
  const buddyOpen = !!as && as.preference === 'buddy' && !as.fulfilled && !!daniel && !daniel.checked_in && !!alex && !alex.checked_in;
  if (buddyOpen && alex && daniel) {
    const gap = dist(alex.tile, daniel.tile);
    if (!as.requested) {
      if (daniel.alerted) open.push('Optional: Daniel may ask Alex for help (request_assistance, helper_id "alex") — good practice, but do not delay anyone\'s evacuation for it.');
    } else if (!as.accepted) {
      if (alex.busy) open.push(`Alex is on his way (${alex.busy}); give orders to others meanwhile.`);
      else if (gap > 1.5) open.push(`Daniel has asked Alex for help; Alex is ${gap.toFixed(1)} tiles away — move alex to destination "daniel", or let Daniel evacuate on his own if the fire is close.`);
      else open.push('Alex is next to Daniel and Daniel has asked for help — Alex can call assist for Daniel now.');
    } else open.push('Alex is escorting Daniel; moving Alex moves both.');
  }
  for (const a of actors) {
    if (a.zone === 'assembly' && !a.checked_in && !a.busy) open.push(`${a.name} is at the assembly point but not checked in.`);
  }
  if (actors.length && actors.every((a) => a.checked_in) && !view.roster?.verified) {
    open.push(alex ? 'Everyone still alive is checked in; Alex should verify_roster.' : 'Everyone still alive is checked in (the warden was lost, so nobody can verify the roster).');
  }

  const last = recent[recent.length - 1];
  const lines: string[] = [];
  if (atRisk.length) {
    lines.push(
      `URGENT — near known fire and not moving (closest first): ${atRisk
        .map((a) => `${a.id} (≈${Math.round(fireDist(a).d)} tiles from ${fireDist(a).id}, in ${a.zone}${a.alerted ? '' : ', NOT alerted'})`)
        .join(', ')}. Fire spreads every second: get them moving to "assembly" before anything else${atRisk.some((a) => !a.alerted) ? ' (alert the un-alerted first: notify all or pull_alarm)' : ''}.`,
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
    `HAZARDS: ${hazardLines.length ? hazardLines.map((h) => `\n- ${h}`).join('') : 'none known yet'}`,
    alarmLine,
  );
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
  const daniel = actors.find((a) => a.id === 'daniel');
  const alex = actors.find((a) => a.id === 'alex');
  const free = (a: ViewActor) => a.alerted && !a.checked_in && !a.busy;
  const stations = stationsOf(view, map);
  const allowed: Record<string, string[]> = {
    observe: actors.filter((a) => !a.checked_in).map((a) => a.id),
    consult_plan: actors.map((a) => a.id),
    notify: actors.filter((a) => a.alerted && a.knows_evidence.length).map((a) => a.id),
    plan_route: actors.filter((a) => !a.checked_in).map((a) => a.id),
    move: actors.filter(free).map((a) => a.id),
    request_assistance: actors.filter((a) => a.alerted && !a.checked_in && a.uses_wheelchair && !as?.requested).map((a) => a.id),
    assist: [],
    check_in: actors.filter((a) => a.zone === 'assembly' && !a.checked_in && !a.busy).map((a) => a.id),
    verify_roster: alex && alex.checked_in && actors.every((a) => a.checked_in) ? ['alex'] : [],
    pull_alarm: view.alarm?.active
      ? []
      : actors
          .filter((a) => (a.alerted || a.knows_evidence.length) && !a.busy && stations.some((st) => dist(a.tile, st.stand) <= 1.5))
          .map((a) => a.id),
  };
  if (as?.requested && !as.accepted && daniel && alex && free(alex) && !daniel.busy && dist(alex.tile, daniel.tile) <= 1.5) {
    allowed.assist = ['alex'];
  }
  const out: OpenAIToolDef[] = [];
  for (const def of TOOL_DEFS) {
    const ids = allowed[def.function.name];
    if (!ids || !ids.length) continue;
    const params = def.function.parameters as { properties: Record<string, Record<string, unknown>> };
    out.push({
      ...def,
      function: {
        ...def.function,
        parameters: { ...params, properties: { ...params.properties, actor_id: { ...params.properties.actor_id, enum: ids } } },
      },
    });
  }
  return out.length ? out : TOOL_DEFS;
}
