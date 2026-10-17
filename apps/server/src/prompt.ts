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

export function userContent(view: PlannerView): string {
  return `Current state (JSON):\n${JSON.stringify(view)}\n\nChoose the single best next tool call.`;
}

export function buildMessages(harness: Harness, map: MapData, scenario: ScenarioCase, view: PlannerView) {
  return [
    { role: 'system' as const, content: buildSystemPrompt(harness, map, scenario) },
    { role: 'user' as const, content: userContent(view) },
  ];
}
