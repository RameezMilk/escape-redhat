// Engine-backed HTTP API for headless, externally driven episodes (used by the NeMo Gym Resources
// Server in gym/escape_resources_server, and usable by any harness that brings its own model loop).
//
// Semantics match headless.ts / the orchestrator's lockstep mode: the simulation is frozen while the
// caller's model "thinks"; after a session is created or a tool executes, the sim advances until the
// engine has planner work again (needsDecision) or the episode ends. Each tool call is one decision.
// Same idle backoff as the orchestrator: after an unproductive call (observe/consult_plan/rejected)
// with no meaningful new events, at least IDLE_BACKOFF_SIM_SEC of sim time passes before returning.
import type { FastifyInstance } from 'fastify';
import {
  TOOL_DEFS,
  type CreateEngine,
  type Engine,
  type EpisodeOutcome,
  type MapData,
  type PlannerView,
  type ScenarioCase,
  type ToolResult,
} from '@escape/contracts';
import type { Harness } from './config.js';
import { DEFAULT_STALL_CEILING_SIM_SEC, stallGuardTicks } from './headless.js';
import { IDLE_BACKOFF_SIM_SEC, QUIET_EVENTS } from './orchestrator.js';
import { buildSystemPrompt, userContent } from './prompt.js';
import { readPlannerConfig } from './config.js';

const NON_PROGRESS_TOOLS = new Set(['observe', 'consult_plan']);

export interface GymSessionOptions {
  sessionId: string;
  caseId: string;
  harness?: Harness;
  maxDecisions?: number;
  /** Safety stop (sim seconds since the incident). Default 900. There is no gameplay timer. */
  stallCeilingSimSec?: number;
}

export interface GymStepResponse {
  session_id: string;
  result?: ToolResult;
  state: PlannerView;
  /** Same text the app's planner receives as its user message for this state. */
  user_prompt: string;
  done: boolean;
  outcome: EpisodeOutcome | null;
  sim_time: number;
  decisions_used: number;
}

/** Compact state for multi-turn harnesses (NeMo Gym simple_agent appends every tool output to the
 *  conversation, so the full PlannerView per step would overflow a 16K context). */
export interface CompactState {
  sim_time: number;
  phase: PlannerView['phase'];
  decisions_remaining: number;
  changes: string[];
  actors: { id: string; zone: string | null; status: string; alerted: boolean; checked_in: boolean; busy: string | null; escort: string | null; lost: boolean }[];
  evidence: { id: string; kind: string; zone: string | null; zones: string[]; cells_known: number; component?: string; known_by: string[] }[];
  alarm: { active: boolean; by?: string };
  assistance: PlannerView['assistance'];
  roster: PlannerView['roster'];
  latest_route?: PlannerView['routes'][number];
}

export function compactState(v: PlannerView): CompactState {
  return {
    sim_time: v.sim_time,
    phase: v.phase,
    decisions_remaining: v.decisions_remaining,
    changes: v.new_since_last_decision,
    actors: v.actors.map((a) => ({
      id: a.id,
      zone: a.zone,
      status: a.status,
      alerted: a.alerted,
      checked_in: a.checked_in,
      busy: a.busy,
      escort: a.escort,
      lost: !!a.lost,
    })),
    evidence: v.evidence.map((e) => ({
      id: e.id,
      kind: e.kind,
      zone: e.zone,
      zones: e.zones ?? [],
      cells_known: e.cells_known ?? 0,
      ...(e.component ? { component: e.component } : {}),
      known_by: e.known_by,
    })),
    alarm: { active: !!v.alarm?.active, ...(v.alarm?.by ? { by: v.alarm.by } : {}) },
    assistance: v.assistance,
    roster: v.roster,
    ...(v.routes.length ? { latest_route: v.routes[v.routes.length - 1] } : {}),
  };
}

export interface GymVerifyResponse {
  session_id: string;
  case_id: string;
  reward: number;
  success: boolean;
  outcome: EpisodeOutcome;
  checks: Record<string, boolean | number>;
  metrics: unknown;
  /** True if the episode was still running at verify time and was ended as incomplete. */
  ended_by_verify: boolean;
}

interface GymSession {
  id: string;
  scenario: ScenarioCase;
  harness: Harness;
  engine: Engine;
  tick: number;
  decisions: number;
  callCounter: number;
  createdAt: number;
  stallCeilingSimSec: number;
  last: { simTime: number; seq: number; productive: boolean } | null;
}

export class GymSessions {
  private sessions = new Map<string, GymSession>();

  constructor(
    private deps: {
      map: MapData;
      cases: Map<string, ScenarioCase>;
      createEngine: CreateEngine;
      maxSessions?: number;
    },
  ) {}

  get size() {
    return this.sessions.size;
  }

  create(opts: GymSessionOptions): GymStepResponse & { system_prompt: string; tools: typeof TOOL_DEFS; case_id: string; harness: Harness } {
    const scenario = this.deps.cases.get(opts.caseId);
    if (!scenario) throw new GymError(404, `unknown case_id ${opts.caseId}`);
    if (!scenario.events.length || scenario.events.some((e) => e.trigger.type === 'manual')) {
      throw new GymError(
        400,
        `case ${opts.caseId} has presenter-placed hazards (manual or none scheduled) and cannot run headless; use a dataset case such as dev-00-hero`,
      );
    }
    if (!opts.sessionId || opts.sessionId.length > 200) throw new GymError(400, 'session_id required (≤200 chars)');
    const harness: Harness = opts.harness === 'v1' ? 'v1' : 'v2';
    const stallCeilingSimSec = opts.stallCeilingSimSec ?? DEFAULT_STALL_CEILING_SIM_SEC;
    const engine = this.deps.createEngine(this.deps.map, scenario, {
      episodeId: `gym-${opts.sessionId}`,
      maxDecisions: opts.maxDecisions ?? readPlannerConfig().maxDecisions,
      stallCeilingSimSec,
    });
    // Replacing an existing session id resets it (Gym may re-seed the same session).
    this.sessions.delete(opts.sessionId);
    const max = this.deps.maxSessions ?? 256;
    while (this.sessions.size >= max) {
      const oldest = this.sessions.keys().next().value as string;
      this.sessions.delete(oldest);
    }
    const s: GymSession = {
      id: opts.sessionId,
      scenario,
      harness,
      engine,
      tick: 0,
      decisions: 0,
      callCounter: 0,
      createdAt: Date.now(),
      stallCeilingSimSec,
      last: null,
    };
    this.sessions.set(s.id, s);
    this.advance(s);
    return {
      ...this.stateOf(s),
      system_prompt: buildSystemPrompt(harness, this.deps.map, scenario),
      tools: TOOL_DEFS,
      case_id: scenario.caseId,
      harness,
    };
  }

  tool(
    sessionId: string,
    name: string,
    args: unknown,
    meta?: { call_id?: string; latency_ms?: number; prompt_tokens?: number; completion_tokens?: number },
  ): GymStepResponse {
    const s = this.get(sessionId);
    const { engine } = s;
    let result: ToolResult;
    if (engine.outcome()) {
      result = { ok: false, actionId: 'A-000', error: { code: 'EPISODE_OVER', message: 'The episode has ended; call verify.' } };
    } else {
      const decisionId = engine.beginDecision();
      s.decisions++;
      const callId = meta?.call_id ?? `${s.id}-c${++s.callCounter}`;
      const argObj = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
      result = engine.executeTool(
        { id: callId, name, arguments: argObj },
        {
          decisionId,
          latencyMs: meta?.latency_ms,
          promptTokens: meta?.prompt_tokens,
          completionTokens: meta?.completion_tokens,
        },
      );
      this.mark(s, result.ok && !NON_PROGRESS_TOOLS.has(name));
      this.advance(s);
    }
    return { ...this.stateOf(s), result };
  }

  /** Record a model turn that produced no executable call (counts toward the decision cap, fed back to the planner). */
  note(sessionId: string, kind: 'malformed' | 'no_call' | 'provider_error', detail: string): GymStepResponse {
    const s = this.get(sessionId);
    if (!s.engine.outcome()) {
      const decisionId = s.engine.beginDecision();
      s.decisions++;
      s.engine.noteDecision({ decisionId, kind, detail: detail.slice(0, 500) });
      this.mark(s, false);
      this.advance(s);
    }
    return this.stateOf(s);
  }

  verify(sessionId: string): GymVerifyResponse {
    const s = this.get(sessionId);
    let endedByVerify = false;
    if (!s.engine.outcome()) {
      s.engine.end('incomplete', 'agent stopped calling tools before the exercise was verified complete');
      endedByVerify = true;
    }
    const result = s.engine.result(Date.now() - s.createdAt);
    if (!result) throw new GymError(500, 'engine produced no result');
    return {
      session_id: s.id,
      case_id: s.scenario.caseId,
      reward: result.score.reward,
      success: result.score.success,
      outcome: result.outcome,
      checks: result.score.checks,
      metrics: result.metrics,
      ended_by_verify: endedByVerify,
    };
  }

  delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  // ---------------------------------------------------------------------------

  private get(sessionId: string): GymSession {
    const s = this.sessions.get(sessionId);
    if (!s) throw new GymError(404, `unknown session ${sessionId} (seed it first)`);
    return s;
  }

  private simTime(s: GymSession) {
    return s.engine.snapshot().simTime;
  }

  private lastSeq(s: GymSession) {
    const ev = s.engine.events;
    return ev.length ? ev[ev.length - 1].seq : 0;
  }

  private mark(s: GymSession, productive: boolean) {
    s.last = { simTime: this.simTime(s), seq: this.lastSeq(s), productive };
  }

  private ready(s: GymSession): boolean {
    const { engine } = s;
    if (engine.outcome()) return false;
    if (!engine.needsDecision().needed) return false;
    const ld = s.last;
    if (!ld || ld.productive) return true;
    const meaningful = engine.eventsSince(ld.seq).some((e) => !QUIET_EVENTS.has(e.type));
    if (meaningful) return true;
    return this.simTime(s) >= ld.simTime + IDLE_BACKOFF_SIM_SEC;
  }

  /** Step the frozen-during-thinking sim until the planner has work or the episode ends. */
  private advance(s: GymSession) {
    const tickLimit = stallGuardTicks(s.stallCeilingSimSec);
    while (!s.engine.outcome() && !this.ready(s)) {
      s.engine.step();
      s.tick++;
      if (s.tick > tickLimit) {
        s.engine.end('incomplete', 'gym guard: stalled (no completion possible within the stall ceiling)');
        break;
      }
    }
  }

  private stateOf(s: GymSession): GymStepResponse {
    const view = s.engine.plannerView();
    s.engine.markViewed();
    const outcome = s.engine.outcome();
    return {
      session_id: s.id,
      state: view,
      user_prompt: userContent(view, s.harness, this.deps.map),
      done: !!outcome,
      outcome,
      sim_time: this.simTime(s),
      decisions_used: s.decisions,
    };
  }
}

export class GymError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Register /api/gym/* routes on the Fastify app. */
export function registerGymRoutes(app: FastifyInstance, gym: GymSessions) {
  const handle = async <T>(reply: { code(n: number): { send(b: unknown): unknown } }, fn: () => T) => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof GymError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  };

  app.post('/api/gym/sessions', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const q = (req.query ?? {}) as Record<string, string>;
    return handle(reply, () =>
      gym.create({
        sessionId: String(body.session_id ?? ''),
        caseId: String(body.case_id ?? ''),
        harness: (body.harness ?? q.harness) === 'v1' ? 'v1' : 'v2',
        maxDecisions: typeof body.max_decisions === 'number' ? body.max_decisions : undefined,
        stallCeilingSimSec: typeof body.stall_ceiling_sim_sec === 'number' ? body.stall_ceiling_sim_sec : undefined,
      }),
    );
  });

  app.post('/api/gym/sessions/:id/tools/:name', async (req, reply) => {
    const { id, name } = req.params as { id: string; name: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    // Accept either {arguments:{...}, meta?} or the bare argument object.
    const args = 'arguments' in body ? body.arguments : body;
    const meta = (body.meta ?? undefined) as Parameters<GymSessions['tool']>[3];
    const compact = ((req.query ?? {}) as Record<string, string>).view === 'compact';
    return handle(reply, () => {
      const r = gym.tool(id, name, args, meta);
      if (!compact) return r;
      return { result: r.result, done: r.done, outcome: r.outcome, state: compactState(r.state) };
    });
  });

  app.post('/api/gym/sessions/:id/note', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Record<string, unknown>;
    const kind = body.kind === 'malformed' || body.kind === 'provider_error' ? body.kind : 'no_call';
    return handle(reply, () => gym.note(id, kind, String(body.detail ?? '')));
  });

  app.post('/api/gym/sessions/:id/verify', async (req, reply) => {
    const { id } = req.params as { id: string };
    return handle(reply, () => gym.verify(id));
  });

  app.delete('/api/gym/sessions/:id', async (req) => {
    const { id } = req.params as { id: string };
    return { deleted: gym.delete(id) };
  });

  app.get('/api/gym/tools', async () => TOOL_DEFS);
}
