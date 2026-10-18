// The engine boundary. packages/engine implements this; apps/server and apps/eval consume it.
// The engine is pure and deterministic: no timers, no I/O, no Math.random (seeded PRNG only).
import { ACTOR_IDS } from './types.js';
import type {
  ActorId,
  AgentView,
  EpisodeOutcome,
  EpisodeResult,
  HazardKind,
  MapData,
  NormalizedToolCall,
  PlannerView,
  ScenarioCase,
  Snapshot,
  ToolResult,
  WorldEvent,
} from './types.js';

export interface EngineOptions {
  episodeId: string;
  /** Simulated milliseconds per tick (default 100). */
  tickMs?: number;
  /** Decision cap per episode — a safety stop, not a game rule (default 60). */
  maxDecisions?: number;
  /** Headless safety stop: end as 'incomplete' (stalled) after this many simulated seconds since the incident.
   *  Unset (live game) = no limit; there is no gameplay timer. */
  stallCeilingSimSec?: number;
  /** Seed for idle/ambient behaviour; defaults to scenario.seed. */
  seed?: number;
  /** Per-tick probability that a burning cell tries to ignite one random neighbour (default: engine FIRE_SPREAD_PER_TICK). */
  fireSpreadPerTick?: number;
  /** Idle ambient wandering before people are alerted (default true). Headless experiments may turn it off. */
  ambient?: boolean;
  /** Hard-coded survival instincts (default true): shout "Fire!" to the room, back away from fire, pull the alarm when
   *  passing it, never re-enter. Per-agent mode turns them off — each person's own model call decides instead. */
  instincts?: boolean;
}

export type PlacementCode =
  | 'OUT_OF_BOUNDS'
  | 'NOT_FLOOR'
  | 'FURNITURE'
  | 'EXIT_OR_ASSEMBLY'
  | 'OCCUPIED'
  | 'OVERLAP'
  | 'NOT_PLACEABLE_ZONE'
  | 'NOT_A_DOOR'
  | 'ALREADY_DISABLED'
  | 'EPISODE_OVER';

export type PlacementResult = { ok: true; hazardId: string; event: WorldEvent } | { ok: false; code: PlacementCode; reason: string };

/** Non-tool decision outcomes the orchestrator reports so they count toward the cap and appear in planner feedback. */
export interface DecisionNote {
  decisionId: string;
  kind: 'malformed' | 'no_call' | 'provider_error' | 'discarded_stale' | 'ignored_extra_call';
  detail: string;
}

export interface DecisionMeta {
  decisionId: string;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
}

export interface Engine {
  readonly map: MapData;
  readonly scenario: ScenarioCase;
  readonly episodeId: string;

  /** Advance one tick: movement, perception, scheduled events, idle behaviour, outcome checks. Returns new events. */
  step(): WorldEvent[];

  /** Any number of hazards. Fire: 2×2 seed at (col,row) top-left. Electrical: snaps to the sliding door under/near (col,row). */
  placeHazard(kind: HazardKind, col: number, row: number): PlacementResult;

  /** Starts a new decision; increments the count. Returns e.g. "D-007". */
  beginDecision(): string;
  /** Validate + apply one tool call. Invalid calls never mutate world state. Idempotent on call.id. */
  executeTool(call: NormalizedToolCall, meta: DecisionMeta): ToolResult;
  /** Record a decision that produced no executable call (counts toward the cap; fed back to the planner). */
  noteDecision(note: DecisionNote, meta?: Omit<DecisionMeta, 'decisionId'>): void;

  /** Whether the planner has useful work now (incident active, not ended, and something changed or someone is ready). */
  needsDecision(): { needed: boolean; reason: string };
  plannerView(): PlannerView;
  /** Marks all events up to now as seen by the planner (call right after building a view for a decision). */
  markViewed(): void;

  /** Per-agent mode: one person's own view (their knowledge only). */
  agentView(actor: ActorId): AgentView;
  /** Marks events up to now as seen by this person (call right after building their view). */
  markAgentViewed(actor: ActorId): void;
  /** Whether this person should decide now (aware of the emergency and something changed, or free to act). */
  agentNeedsDecision(actor: ActorId): { needed: boolean; reason: string };

  snapshot(): Snapshot;
  readonly events: readonly WorldEvent[];
  eventsSince(seq: number): WorldEvent[];

  outcome(): EpisodeOutcome | null;
  /** Force-end (e.g. provider aborted). No-op if already ended. */
  end(status: 'aborted' | 'incomplete', reason: string): void;
  result(wallTimeMs?: number): EpisodeResult | null;

  /** Stable hash of canonical world state (tests: invalid calls must not change it). */
  hash(): string;
}

export type CreateEngine = (map: MapData, scenario: ScenarioCase, opts: EngineOptions) => Engine;

export interface ActorProfile {
  name: string;
  role: string;
  profile: string;
  usesWheelchair: boolean;
  /** The exercise warden: the only person who can verify the roster (exactly one). */
  warden?: true;
  /** The buddy this person may ask for help in an evacuation (the one assistance arrangement). */
  buddy?: ActorId;
  /** Idle chatter before an incident. */
  ambient: string[];
}

/** Actor metadata shared by engine, server and web. */
export const ACTOR_PROFILES: Record<ActorId, ActorProfile> = {
  alex: {
    name: 'Alex',
    role: 'Exercise warden (employee)',
    profile: 'Calm, trained in the fictional evacuation plan, knows the layout, the pull stations and the roster. Designated buddy for visitors who ask for help.',
    usesWheelchair: false,
    warden: true,
    ambient: ['Badge printer is jammed again…', 'Who booked the lobby for 4pm?', 'Checking the visitor list.', 'Coffee refill time.'],
  },
  maya: {
    name: 'Maya',
    role: 'Employee',
    profile: 'Observant and empathetic; reports what she sees and helps when appropriate.',
    usesWheelchair: false,
    ambient: ['These slides need one more chart.', 'Has anyone seen my stylus?', 'Demo dry-run in ten!', 'Ooh, snacks arrived.'],
  },
  daniel: {
    name: 'Daniel',
    role: 'Visitor (uses a wheelchair)',
    profile: 'Unfamiliar with the building. Navigates accessible routes himself; has asked for a buddy to guide him if there is an evacuation.',
    usesWheelchair: true,
    buddy: 'alex',
    ambient: ['Nice office — where is the whiteboard?', 'Wi-Fi password, anyone?', 'Taking notes for the team.', 'This chair has great wheels… oh wait.'],
  },
  rosa: {
    name: 'Rosa',
    role: 'Receptionist (employee)',
    profile: 'Runs the front desk by the main entrance; friendly, organised, and knows who is in the building today.',
    usesWheelchair: false,
    ambient: ['Welcome! Please sign the visitor book.', 'Your badge will be ready in a moment.', 'Another courier for the server room…', 'Line two is for you, Alex.'],
  },
  kenji: {
    name: 'Kenji',
    role: 'IT engineer (employee)',
    profile: 'Looks after the GPU server room; practical and calm, knows the back corridors and the kitchen exit.',
    usesWheelchair: false,
    ambient: ['Rack 4 is running hot again.', 'Who unplugged the GPU node?!', 'Firmware update: 12%… still 12%.', 'More coffee for this deploy.'],
  },
};

/** The exercise warden (verifies the roster). */
export const WARDEN_ID: ActorId = ACTOR_IDS.find((id) => ACTOR_PROFILES[id].warden) ?? ACTOR_IDS[0];

/** The assistance arrangement: `person` may ask `buddy` to guide them out (ScenarioCase.danielPreference says whether
 *  they want to in a given case — the field name predates the profile-driven roster). */
export const ASSISTANCE: { person: ActorId; buddy: ActorId } = (() => {
  const person = ACTOR_IDS.find((id) => ACTOR_PROFILES[id].buddy) ?? ACTOR_IDS[ACTOR_IDS.length - 1];
  return { person, buddy: ACTOR_PROFILES[person].buddy ?? WARDEN_ID };
})();

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
/** "three", "five" — for prose about the roster size. */
export const countWord = (n: number): string => NUMBER_WORDS[n] ?? String(n);
