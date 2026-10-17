// SCRIPTED FIXTURE — not a model. A deterministic rule policy over the same PlannerView the model sees.
// Used for UI development, tests and as a labeled offline demo; every trace row says "SCRIPTED fixture".
import type { ActorId, NormalizedToolCall, PlannerView, ProviderInfo } from '@escape/contracts';
import { LatencyStats, type DecideRequest, type DecisionProvider, type DecisionResult } from './types.js';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type ViewActor = PlannerView['actors'][number];

interface Memory {
  lastRemaining: number;
  lastMoveDest: Partial<Record<ActorId, string>>;
  usedRoutes: Set<string>;
  reported: Set<string>;
  consulted: Set<string>;
}

export interface ScriptedOptions {
  /** [min, max] simulated latency in ms (default 300–600). */
  latencyMs?: [number, number];
  seed?: number;
}

export class ScriptedProvider implements DecisionProvider {
  private rng: () => number;
  private stats = new LatencyStats();
  private n = 0;
  private mem: Memory = this.freshMemory();
  private latency: [number, number];

  constructor(opts: ScriptedOptions = {}) {
    this.latency = opts.latencyMs ?? [300, 600];
    this.rng = mulberry32(opts.seed ?? 1017);
  }

  private freshMemory(): Memory {
    return { lastRemaining: Number.POSITIVE_INFINITY, lastMoveDest: {}, usedRoutes: new Set(), reported: new Set(), consulted: new Set() };
  }

  info(): ProviderInfo {
    return {
      id: 'scripted',
      label: 'SCRIPTED fixture — not a model',
      model: 'scripted-policy-v1',
      endpointKind: 'scripted',
      healthy: true,
      healthDetail: `deterministic rule policy; simulated latency ${this.latency[0]}–${this.latency[1]} ms`,
      thinking: false,
      p50LatencyMs: this.stats.p50(),
      lastLatencyMs: this.stats.last,
    };
  }

  async health() {
    return { ok: true, detail: 'scripted fixture (no endpoint)' };
  }

  async decide(req: DecideRequest): Promise<DecisionResult> {
    const [lo, hi] = this.latency;
    const delay = Math.round(lo + (hi - lo) * this.rng());
    if (delay > 0) {
      const aborted = await new Promise<boolean>((resolve) => {
        const t = setTimeout(() => resolve(false), delay);
        req.signal.addEventListener('abort', () => {
          clearTimeout(t);
          resolve(true);
        });
      });
      if (aborted) return { kind: 'error', code: 'ABORTED', message: 'request aborted (episode reset)', latencyMs: delay };
    }
    if (req.signal.aborted) return { kind: 'error', code: 'ABORTED', message: 'request aborted (episode reset)', latencyMs: delay };
    this.stats.add(delay);

    const view = req.view;
    // New episode ⇒ decision budget goes back up.
    if (view.decisions_remaining > this.mem.lastRemaining) this.mem = this.freshMemory();
    this.mem.lastRemaining = view.decisions_remaining;

    const call = this.policy(view);
    if (call.name === 'move') {
      const a = call.arguments as { actor_id: ActorId; destination: string; route_id?: string };
      this.mem.lastMoveDest[a.actor_id] = a.destination;
      if (a.route_id) this.mem.usedRoutes.add(a.route_id);
    }
    const id = `call_scripted_${++this.n}`;
    return {
      kind: 'tool_call',
      calls: [{ ...call, id }],
      parseMode: 'native',
      latencyMs: delay,
      raw: { request: { note: 'scripted fixture: no model request' }, response: { tool: call.name, arguments: call.arguments } },
    };
  }

  private policy(view: PlannerView): Omit<NormalizedToolCall, 'id'> {
    const A = Object.fromEntries(view.actors.map((a) => [a.id, a])) as Record<ActorId, ViewActor>;
    const mk = (name: string, args: Record<string, unknown>): Omit<NormalizedToolCall, 'id'> => ({ name, arguments: args });

    // 1. Report hazards nobody else knows about yet (fire before blockers).
    const unreported = [...view.evidence]
      .sort((x, y) => (x.kind === y.kind ? 0 : x.kind === 'fire' ? -1 : 1))
      .find((e) => e.known_by.length < view.actors.length && !this.mem.reported.has(e.id));
    if (unreported) {
      const speaker = unreported.known_by.includes(unreported.observed_by) ? unreported.observed_by : unreported.known_by[0];
      this.mem.reported.add(unreported.id);
      const where = unreported.zone ? unreported.zone.replace(/_/g, ' ') : 'nearby';
      return unreported.kind === 'fire'
        ? mk('notify', {
            actor_id: speaker,
            recipient: 'all',
            topic: 'fire',
            evidence_ids: [unreported.id],
            message: `Fire in the ${where}! Everyone evacuate to the assembly point now.`,
            reason_summary: 'Report the hazard with evidence before anyone moves.',
          })
        : mk('notify', {
            actor_id: speaker,
            recipient: 'all',
            topic: 'route_blocked',
            evidence_ids: [unreported.id],
            message: `The ${where} is blocked — use the other route.`,
            reason_summary: 'Share the new obstruction so routes are re-planned.',
          });
    }

    // 2. Accountability.
    const all = view.actors;
    if (all.every((a) => a.checked_in) && !view.roster.verified) {
      return mk('verify_roster', { actor_id: 'alex', reason_summary: 'Everyone is checked in; warden verifies the roster.' });
    }
    const toCheck = all.find((a) => a.zone === 'assembly' && !a.checked_in && !a.busy);
    if (toCheck) return mk('check_in', { actor_id: toCheck.id });

    // 3. Daniel's buddy arrangement (consent first).
    const buddy = view.assistance.preference === 'buddy' && !view.assistance.fulfilled;
    const alex = A.alex;
    const daniel = A.daniel;
    if (buddy && daniel?.alerted && !view.assistance.requested && !daniel.checked_in) {
      return mk('request_assistance', {
        actor_id: 'daniel',
        helper_id: 'alex',
        reason_summary: "Daniel asks for the pre-arranged buddy guidance.",
      });
    }
    const escortActive = !!(alex?.escort || daniel?.escort) || daniel?.status === 'escorted';
    if (buddy && view.assistance.requested && !view.assistance.accepted && !escortActive && alex && daniel && alex.alerted) {
      const d = Math.hypot(alex.tile[0] - daniel.tile[0], alex.tile[1] - daniel.tile[1]);
      if (d <= 1.5 && !alex.busy && !daniel.busy) {
        return mk('assist', { actor_id: 'alex', person_id: 'daniel', reason_summary: 'Start the agreed escort.' });
      }
      if (!alex.busy) {
        return mk('move', { actor_id: 'alex', destination: 'daniel', reason_summary: 'Go to Daniel for the buddy arrangement.' });
      }
    }

    // 4. Evacuate everyone who is alerted, idle and not yet at assembly.
    for (const a of all) {
      if (!a.alerted || a.checked_in || a.busy || a.zone === 'assembly') continue;
      if (a.status === 'escorted') continue; // follower moves with the leader
      if (a.id === 'daniel' && buddy && !escortActive) continue; // waiting for Alex
      if (a.id === 'alex' && buddy && view.assistance.requested && !escortActive) continue; // handled above
      const route = [...view.routes]
        .reverse()
        .find((r) => r.actor === a.id && r.destination === 'assembly' && !this.mem.usedRoutes.has(r.route_id));
      if (route) {
        return mk('move', {
          actor_id: a.id,
          destination: 'assembly',
          route_id: route.route_id,
          expected_revision: route.knowledge_revision,
          reason_summary: 'Follow the re-planned route.',
        });
      }
      const interrupted =
        this.mem.lastMoveDest[a.id] === 'assembly' ||
        view.recent_actions.some(
          (r) => r.actor === a.id && !r.ok && (r.error_code === 'ROUTE_UNAVAILABLE' || r.error_code === 'STALE_STATE'),
        );
      if (interrupted) {
        return mk('plan_route', { actor_id: a.id, destination: 'assembly', reason_summary: 'Previous route failed; plan an alternate.' });
      }
      return mk('move', { actor_id: a.id, destination: 'assembly', reason_summary: 'Evacuate to the assembly point.' });
    }

    // 5. Nothing actionable right now (people are moving): ground in the plan once, then monitor.
    for (const section of buddy ? ['assistance', 'routes'] : ['routes']) {
      if (!this.mem.consulted.has(section)) {
        this.mem.consulted.add(section);
        return mk('consult_plan', { actor_id: 'alex', section, reason_summary: `Warden checks the ${section} section while people move.` });
      }
    }
    const someone = all.find((a) => !a.checked_in) ?? all[0];
    return mk('observe', { actor_id: someone.id, reason_summary: 'Monitor while others move.' });
  }
}
