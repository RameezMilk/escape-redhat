// Tool contract: OpenAI-compatible JSON Schemas (sent to the model) + zod validators (enforced by the engine).
// Keep the two in sync — tests in packages/engine/test/tools.contract.test.ts check every schema parses.
import { z } from 'zod';
import { ALARM_STATION_IDS } from './map-ids.generated.js';
import { ACTOR_IDS, ZONE_IDS, type ToolName } from './types.js';

const actorEnum = [...ACTOR_IDS];
const zoneEnum = [...ZONE_IDS];
/** Destinations: a zone, a person (go next to them), 'alarm' (nearest reachable pull station) or a station id. */
const destinationEnum = [...ZONE_IDS, ...ACTOR_IDS, 'alarm', ...ALARM_STATION_IDS];

export const PLAN_SECTIONS = ['reporting', 'routes', 'assistance', 'accountability'] as const;
export const NOTIFY_TOPICS = ['fire', 'route_blocked', 'evacuate', 'assistance', 'status'] as const;
export const RECIPIENTS = ['all', ...ACTOR_IDS] as const;

const reasonSummaryJson = {
  type: 'string',
  maxLength: 120,
  description: 'Optional one-line public reason for this action (shown to viewers).',
} as const;

const actorIdJson = (what: string) => ({ type: 'string', enum: actorEnum, description: what });

export interface OpenAIToolDef {
  type: 'function';
  function: { name: ToolName; description: string; parameters: Record<string, unknown> };
}

function tool(
  name: ToolName,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): OpenAIToolDef {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties: { ...properties, reason_summary: reasonSummaryJson },
        required,
        additionalProperties: false,
      },
    },
  };
}

export const TOOL_DEFS: OpenAIToolDef[] = [
  tool(
    'observe',
    "Look around from one character's current position. Returns their zone, any hazards they can see (creating evidence IDs), nearby people, and the zone's connections with known status.",
    { actor_id: actorIdJson('Who looks around.') },
    ['actor_id'],
  ),
  tool(
    'consult_plan',
    "Read a section of the office's (fictional) emergency action plan. Sections: reporting, routes, assistance, accountability.",
    {
      actor_id: actorIdJson('Who reads the plan.'),
      section: { type: 'string', enum: [...PLAN_SECTIONS] },
    },
    ['actor_id', 'section'],
  ),
  tool(
    'notify',
    'Have a character SAY something out loud. Spoken — reaches only people in the same room (doorways connect both sides); anyone in another room is not reached. Recipients learn the cited evidence and, for fire/route_blocked/evacuate, become alerted. topic fire or route_blocked requires evidence_ids the sender already knows. To alert people in other rooms, pull the fire alarm.',
    {
      actor_id: actorIdJson('Who speaks.'),
      recipient: { type: 'string', enum: [...RECIPIENTS], description: "'all' (everyone within earshot) or one character id in the same room (not the speaker)." },
      topic: { type: 'string', enum: [...NOTIFY_TOPICS] },
      evidence_ids: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 4,
        description: 'Evidence IDs like "E1" that the speaker knows.',
      },
      message: { type: 'string', minLength: 1, maxLength: 160, description: 'What they say (short).' },
    },
    ['actor_id', 'recipient', 'topic', 'evidence_ids', 'message'],
  ),
  tool(
    'plan_route',
    "Plan a route for a character using only hazards THAT CHARACTER knows about (it cannot see unknown obstructions). Returns route_id, the zones it passes, length and ETA. Daniel's routes (and an escorted pair's) use wheelchair-accessible tiles only.",
    {
      actor_id: actorIdJson('Who will travel.'),
      destination: {
        type: 'string',
        enum: destinationEnum,
        description: 'A zone id, a character id (go next to that person), or "alarm" / "alarm_corridor" (the fire-alarm pull station in the north corridor).',
      },
    },
    ['actor_id', 'destination'],
  ),
  tool(
    'move',
    'Start moving a character (and their escort partner, if linked) toward a destination. Pass a route_id from plan_route, or omit it to auto-plan on the character\'s known hazards. Movement stops safely if a hazard is discovered on the way; the result then arrives as a later event. Fire spreads: anyone it reaches is lost, so move early and keep away from known fire.',
    {
      actor_id: actorIdJson('Who moves.'),
      destination: { type: 'string', enum: destinationEnum },
      route_id: { type: 'string', description: 'Optional route id from plan_route.' },
      expected_revision: {
        type: 'integer',
        description: "Optional knowledge_revision the route was planned against; mismatch with newly known hazards on the route returns STALE_STATE.",
      },
    },
    ['actor_id', 'destination'],
  ),
  tool(
    'request_assistance',
    'A character asks a specific helper for the agreed evacuation assistance (records consent).',
    {
      actor_id: actorIdJson('Who asks for help.'),
      helper_id: actorIdJson('Who is asked.'),
    },
    ['actor_id', 'helper_id'],
  ),
  tool(
    'assist',
    'Helper starts escorting a person who has requested their assistance. Both must be next to each other (within 1.5 tiles) and not moving. After this, moving either one moves both together.',
    {
      actor_id: actorIdJson('The helper.'),
      person_id: actorIdJson('The person being assisted.'),
    },
    ['actor_id', 'person_id'],
  ),
  tool(
    'check_in',
    'Record that a character has arrived at the assembly point. Only works if they are physically inside the assembly area and not moving.',
    { actor_id: actorIdJson('Who checks in.') },
    ['actor_id'],
  ),
  tool(
    'verify_roster',
    'Warden-only accountability check at the assembly point. Returns who is checked in, who is outstanding and who was lost. This is the only way the exercise can be confirmed complete.',
    { actor_id: actorIdJson('Must be the warden (alex), checked in at assembly.') },
    ['actor_id'],
  ),
  tool(
    'pull_alarm',
    'Pull the fire-alarm pull station in the north corridor: the building siren sounds and every person is alerted to evacuate (it does not tell them where the hazard is). This is the only way to alert people in other rooms. The character must be standing next to the pull station (move to destination "alarm" first) and not moving.',
    { actor_id: actorIdJson('Who pulls the alarm.') },
    ['actor_id'],
  ),
];

// ---------------------------------------------------------------------------
// zod validators (strict: unknown keys are rejected)
// ---------------------------------------------------------------------------

const actorId = z.enum(ACTOR_IDS);
const reason = z.string().max(120).optional();

export const TOOL_ARG_SCHEMAS = {
  observe: z.object({ actor_id: actorId, reason_summary: reason }).strict(),
  consult_plan: z.object({ actor_id: actorId, section: z.enum(PLAN_SECTIONS), reason_summary: reason }).strict(),
  notify: z
    .object({
      actor_id: actorId,
      recipient: z.enum(RECIPIENTS),
      topic: z.enum(NOTIFY_TOPICS),
      evidence_ids: z.array(z.string().max(16)).max(4),
      message: z.string().min(1).max(160),
      reason_summary: reason,
    })
    .strict(),
  plan_route: z
    .object({
      actor_id: actorId,
      destination: z.enum(['alarm', ...zoneEnum, ...actorEnum, ...ALARM_STATION_IDS] as [string, ...string[]]),
      reason_summary: reason,
    })
    .strict(),
  move: z
    .object({
      actor_id: actorId,
      destination: z.enum(['alarm', ...zoneEnum, ...actorEnum, ...ALARM_STATION_IDS] as [string, ...string[]]),
      route_id: z.string().max(32).optional(),
      expected_revision: z.number().int().optional(),
      reason_summary: reason,
    })
    .strict(),
  request_assistance: z.object({ actor_id: actorId, helper_id: actorId, reason_summary: reason }).strict(),
  assist: z.object({ actor_id: actorId, person_id: actorId, reason_summary: reason }).strict(),
  check_in: z.object({ actor_id: actorId, reason_summary: reason }).strict(),
  verify_roster: z.object({ actor_id: actorId, reason_summary: reason }).strict(),
  pull_alarm: z.object({ actor_id: actorId, reason_summary: reason }).strict(),
} satisfies Record<ToolName, z.ZodTypeAny>;

export type ToolArgs = { [K in ToolName]: z.infer<(typeof TOOL_ARG_SCHEMAS)[K]> };
