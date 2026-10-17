// Planner prompt. Two harness versions for the baseline-vs-final evaluation:
//   v1 = baseline: role, people, map, tools; no procedural guidance.
//   v2 = v1 + explicit exercise procedure and error-recovery guidance.
// The model never sees unobserved hazard truth: the user message is exactly engine.plannerView().
import { ACTOR_IDS, ACTOR_PROFILES, type MapData, type PlannerView, type ScenarioCase } from '@escape/contracts';
import type { Harness } from './config.js';

function briefing(map: MapData, scenario: ScenarioCase): string {
  const people = ACTOR_IDS.map((id) => {
    const p = ACTOR_PROFILES[id];
    let line = `- ${id} — ${p.name}, ${p.role}. ${p.profile}`;
    if (id === 'alex') line += ' Only Alex can call verify_roster.';
    if (id === 'daniel') {
      line +=
        scenario.danielPreference === 'buddy'
          ? ' Assistance preference: wants Alex as his buddy (guide) during an evacuation.'
          : ' Assistance preference: independent — he evacuates on his own and has NOT asked for a buddy.';
    }
    return line;
  }).join('\n');

  const zones = map.zones.map((z) => `${z.id} (${z.label})`).join('; ');
  const edges = map.zoneEdges.map(([a, b]) => `${a}–${b}`).join(', ');
  return `PEOPLE
${people}

MAP (one ground-level floor; fictional office)
Zones: ${zones}.
Connections: ${edges}.
Exits: west_exit and east_exit, both lead outside to the plaza. Assembly point: zone "assembly" in the plaza.`;
}

const ROLE = `You are the exercise coordinator AI for a fictional office evacuation drill ("Escape from Red Hat"). You centrally direct three simulated people — Alex, Maya and Daniel — by calling exactly ONE tool per turn; every call names the actor_id who acts. A simulation engine validates each call against the true world state: invalid calls are rejected with an error code and a hint and change nothing. Each turn you receive the current state as JSON: actors (zone, status, alerted, checked_in, busy), evidence (hazards someone has observed or been told about — you only know what the people know), messages, assistance status, roster, planned routes, recent action results, and what changed since your last decision.`;

const GOAL_V1 = `GOAL
Get everyone safely to the assembly point and accounted for. Use the tools. One tool call per turn.`;

const PROCEDURE_V2 = `PROCEDURE (follow in order of need)
1. Report: when someone observes a hazard, have that person notify recipient "all" with topic "fire" (or "route_blocked") and the evidence_ids they know. People who have not been alerted cannot evacuate (NOT_AUTHORIZED).
2. Assistance: if Daniel wants a buddy, Daniel calls request_assistance with helper_id "alex"; then move Alex to destination "daniel"; then assist(actor_id "alex", person_id "daniel"). After that, moving Alex moves both. Never assist without Daniel's request; nobody is carried.
3. Evacuate: move each alerted person to destination "assembly". Moves take time — you are told when they complete or are interrupted; meanwhile you may act for other people.
4. Recover: if a move fails with ROUTE_UNAVAILABLE or STALE_STATE, have the person who saw it notify "all" with topic "route_blocked" and the new evidence id, then call plan_route for the traveller to destination "assembly" and move with the returned route_id.
5. Account: when a person is inside the assembly area and not moving, call check_in for them. When all three are checked in, Alex calls verify_roster — only this confirms the drill is complete.
RULES: one tool call per turn; never repeat a rejected call unchanged — read its error hint and fix the cause; only cite evidence ids that appear in the state; keep messages short and calm; reason_summary is optional, one short line.`;

export function buildSystemPrompt(harness: Harness, map: MapData, scenario: ScenarioCase): string {
  return [ROLE, briefing(map, scenario), harness === 'v2' ? PROCEDURE_V2 : GOAL_V1].join('\n\n');
}

/** v2 only: a short digest of the (already planner-visible) state, so a small model does not have to dig through JSON.
 *  Derived purely from the PlannerView — no hidden world truth. */
export function stateDigest(view: PlannerView): string {
  const actors = view.actors ?? [];
  const recent = view.recent_actions ?? [];
  // Decisions since each person last received an order (within the recent window) — a starvation signal.
  const sinceOrder = (id: string) => {
    for (let i = recent.length - 1; i >= 0; i--) if (recent[i].actor === id) return recent.length - 1 - i;
    return recent.length;
  };
  const ready = actors
    .filter((a) => a.alerted && !a.checked_in && !a.busy)
    .sort((a, b) => sinceOrder(b.id) - sinceOrder(a.id));
  const busy = actors.filter((a) => a.busy && !a.checked_in);
  const unalerted = actors.filter((a) => !a.alerted && !a.checked_in);
  const open: string[] = [];
  if (unalerted.length) {
    open.push(`Not alerted yet: ${unalerted.map((a) => a.id).join(', ')} — someone who knows the evidence must notify them before they can evacuate.`);
  }
  const as = view.assistance;
  if (as && as.preference === 'buddy' && !as.fulfilled) {
    if (!as.requested) open.push('Daniel\'s buddy arrangement has not started (he has not called request_assistance with helper "alex").');
    else if (!as.accepted) open.push('Daniel has asked Alex for help; Alex must be next to Daniel and then call assist before they travel together.');
    else open.push('Alex is escorting Daniel; moving Alex moves both.');
  }
  for (const a of actors) {
    if (a.zone === 'assembly' && !a.checked_in && !a.busy) open.push(`${a.name} is at the assembly point but not checked in.`);
  }
  if (actors.length && actors.every((a) => a.checked_in) && !view.roster?.verified) open.push('Everyone is checked in; the roster has not been verified.');
  const last = recent[recent.length - 1];
  const lines = [
    `WAITING FOR YOUR ORDERS (most neglected first): ${
      ready
        .map((a) => {
          const n = sinceOrder(a.id);
          return `${a.id} (in ${a.zone}${n >= recent.length && recent.length ? `, no order in your last ${recent.length} decisions` : n > 0 ? `, last order ${n} decisions ago` : ''})`;
        })
        .join(', ') || 'nobody'
    }`,
    `BUSY MOVING (do not move/assist them again yet): ${busy.map((a) => `${a.id} — ${a.busy}`).join('; ') || 'nobody'}`,
    `OPEN ITEMS: ${open.length ? open.map((o) => `\n- ${o}`).join('') : 'none'}`,
  ];
  lines.push('NOTE: move plans its own route; plan_route/observe/consult_plan are optional look-ups — they do not move anyone.');
  if (last && !last.ok) {
    lines.push(`YOUR LAST CALL WAS REJECTED (${last.decision} ${last.tool ?? ''} for ${last.actor ?? '?'}): ${last.error_code ?? ''} — ${last.hint ?? last.summary}. Do not repeat it unchanged.`);
  }
  return lines.join('\n');
}

export function userContent(view: PlannerView, harness: Harness = 'v2'): string {
  if (harness === 'v1') return `Current state (JSON):\n${JSON.stringify(view)}\n\nChoose the single best next tool call.`;
  return `${stateDigest(view)}\n\nCurrent state (JSON):\n${JSON.stringify(view)}\n\nChoose ONE tool call — normally for someone who is waiting for your orders.`;
}

export function buildMessages(harness: Harness, map: MapData, scenario: ScenarioCase, view: PlannerView) {
  return [
    { role: 'system' as const, content: buildSystemPrompt(harness, map, scenario) },
    { role: 'user' as const, content: userContent(view, harness) },
  ];
}
