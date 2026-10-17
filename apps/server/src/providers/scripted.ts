// SCRIPTED FIXTURE — not a model. A deterministic rule policy over the same PlannerView the model sees.
// Used for UI development, tests and as a labeled offline demo; every trace row says "SCRIPTED fixture".
import type { ActorId, NormalizedToolCall, PlannerView, ProviderInfo } from '@escape/contracts';
import { inEarshot, loadMap } from '@escape/engine';

/** Static office map: the fixture needs room layout to know who can hear whom. */
const OFFICE = loadMap();
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
    const alive = view.actors.filter((a) => !a.lost);
    const stations = view.alarm?.stations ?? [];
    const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const nearestStation = (a: ViewActor) => stations.map((st) => dist(a.tile, st.stand)).sort((x, y) => x - y)[0] ?? Infinity;
    const alarmActive = !!view.alarm?.active;

    // 1. Report and alert. Spoken notify reaches only the same room; the hallway fire alarm reaches everyone.
    const hears = (a: ViewActor, b: ViewActor) => inEarshot(OFFICE, a.zone, b.zone);
    const unaware = alive.filter((a) => !a.alerted);
    //  a) Standing at the pull station during a known fire (or while someone is still unaware) → pull it.
    const fireKnown = view.evidence.some((e) => e.kind === 'fire');
    if (!alarmActive && (unaware.length || fireKnown)) {
      const atStation = alive.find((a) => (a.alerted || a.knows_evidence.length) && !a.busy && nearestStation(a) <= 1.5);
      if (atStation) return mk('pull_alarm', { actor_id: atStation.id, reason_summary: 'Raise the building alarm so people in other rooms hear it.' });
    }
    //  b) Tell people in the same room what you know (fire first, then dead doors).
    const evidence = [...view.evidence].sort((x, y) => (x.kind === y.kind ? 0 : x.kind === 'fire' ? -1 : 1));
    for (const e of evidence) {
      for (const sid of e.known_by) {
        const speaker = A[sid];
        if (!speaker || speaker.lost || !speaker.alerted) continue;
        const listeners = alive.filter((b) => b.id !== speaker.id && hears(speaker, b) && !e.known_by.includes(b.id));
        if (!listeners.length) continue;
        const where = e.zone === 'rh_room' ? 'Red Hat room' : e.zone ? e.zone.replace(/_/g, ' ') : 'nearby';
        return e.kind === 'fire'
          ? mk('notify', {
              actor_id: speaker.id,
              recipient: 'all',
              topic: 'fire',
              evidence_ids: [e.id],
              message: `Fire in the ${where}! Get out to the assembly point now and keep away from it.`,
              reason_summary: 'Alert everyone in this room (voice only carries this far).',
            })
          : mk('notify', {
              actor_id: speaker.id,
              recipient: 'all',
              topic: 'route_blocked',
              evidence_ids: [e.id],
              message: `The ${e.component ? e.component.replace(/_/g, ' ') : 'sliding door'} is dead — use another route.`,
              reason_summary: 'Share the dead door with people in this room.',
            });
      }
    }
    //  c) Someone is unaware and out of earshot of everyone who knows → send the nearest idle alerted person to the
    //     hallway pull station (pulled on arrival by step a).
    const knowers = alive.filter((a) => a.alerted);
    const unreachable = unaware.filter((u) => !knowers.some((k) => k.knows_evidence.length && hears(k, u)));
    if (!alarmActive && unreachable.length && stations.length) {
      const enRoute = knowers.some((k) => k.busy !== null && this.mem.lastMoveDest[k.id] === 'alarm');
      const runner = knowers
        .filter((k) => !k.busy && !k.checked_in && k.status !== 'escorted')
        .sort((a, b) => nearestStation(a) - nearestStation(b))[0];
      if (!enRoute && runner && this.mem.lastMoveDest[runner.id] !== 'alarm') {
        return mk('move', { actor_id: runner.id, destination: 'alarm', reason_summary: `Go pull the hallway fire alarm — ${unreachable.map((u) => u.id).join(', ')} cannot hear us.` });
      }
    }

    // 2. Accountability (survivors only).
    const alex = A.alex && !A.alex.lost ? A.alex : undefined;
    if (alive.length && alive.every((a) => a.checked_in) && !view.roster.verified && alex) {
      return mk('verify_roster', { actor_id: 'alex', reason_summary: 'Everyone still alive is checked in; warden verifies the roster.' });
    }
    const toCheck = alive.find((a) => a.zone === 'assembly' && !a.checked_in && !a.busy);
    if (toCheck) return mk('check_in', { actor_id: toCheck.id });

    // 3. Optional buddy arrangement: only when Daniel prefers it AND Alex is close; otherwise Daniel goes on his own.
    const daniel = A.daniel && !A.daniel.lost ? A.daniel : undefined;
    const escortActive = !!(alex?.escort || daniel?.escort) || daniel?.status === 'escorted';
    const buddyClose = !!alex && !!daniel && dist(alex.tile, daniel.tile) <= 6;
    const buddy =
      view.assistance.preference === 'buddy' &&
      !view.assistance.fulfilled &&
      !!alex?.alerted &&
      !alex.checked_in &&
      !!daniel &&
      !daniel.checked_in &&
      daniel.zone !== 'assembly' &&
      (escortActive || view.assistance.requested || buddyClose);
    if (buddy && daniel?.alerted && !daniel.busy && !view.assistance.requested) {
      return mk('request_assistance', { actor_id: 'daniel', helper_id: 'alex', reason_summary: 'Daniel asks for the pre-arranged buddy guidance.' });
    }
    if (buddy && view.assistance.requested && !view.assistance.accepted && !escortActive && alex && daniel) {
      const d = dist(alex.tile, daniel.tile);
      if (d <= 1.5 && !alex.busy && !daniel.busy) {
        return mk('assist', { actor_id: 'alex', person_id: 'daniel', reason_summary: 'Start the agreed escort.' });
      }
      if (!alex.busy && this.mem.lastMoveDest.alex !== 'daniel') {
        return mk('move', { actor_id: 'alex', destination: 'daniel', reason_summary: 'Go to Daniel for the buddy arrangement.' });
      }
    }

    // 4. Evacuate everyone alive, alerted, idle and not yet at assembly — immediately (fire spreads).
    for (const a of alive) {
      if (!a.alerted || a.checked_in || a.busy || a.zone === 'assembly') continue;
      if (a.status === 'escorted') continue; // follower moves with the leader
      if (buddy && !escortActive && (a.id === 'daniel' || a.id === 'alex') && view.assistance.requested) continue; // handled above
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
        view.recent_actions.some((r) => r.actor === a.id && !r.ok && (r.error_code === 'ROUTE_UNAVAILABLE' || r.error_code === 'STALE_STATE'));
      if (interrupted) {
        return mk('plan_route', { actor_id: a.id, destination: 'assembly', reason_summary: 'Previous route failed; plan an alternate.' });
      }
      return mk('move', { actor_id: a.id, destination: 'assembly', reason_summary: 'Evacuate to the assembly point now.' });
    }

    // 5. Nothing actionable right now (people are moving): ground in the plan once, then monitor.
    const watcher = alex ?? alive[0] ?? view.actors[0];
    if (!this.mem.consulted.has('routes')) {
      this.mem.consulted.add('routes');
      return mk('consult_plan', { actor_id: watcher.id, section: 'routes', reason_summary: 'Check the routes section while people move.' });
    }
    const someone = alive.find((a) => !a.checked_in) ?? watcher;
    return mk('observe', { actor_id: someone.id, reason_summary: 'Monitor while others move.' });
  }
}
