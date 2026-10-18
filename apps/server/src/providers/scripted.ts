// SCRIPTED FIXTURE — not a model. A deterministic rule policy over the same PlannerView the model sees.
// Used for UI development, tests and as a labeled offline demo; every trace row says "SCRIPTED fixture".
import { ACTOR_PROFILES, ASSISTANCE, WARDEN_ID, type ActorId, type AgentView, type NormalizedToolCall, type PlannerView, type ProviderInfo, type ZoneId } from '@escape/contracts';
import { inEarshot, isOutsideZone, loadMap } from '@escape/engine';

/** Static office map: the fixture needs room layout to know who can hear whom. */
const OFFICE = loadMap();
import { inPlace, theDoor } from '../places.js';
import { LatencyStats, type DecideRequest, type DecisionProvider, type DecisionResult } from './types.js';

/** Zones outside the building — people there never go back in. */
const outside = (a: { zone: string | null }) => isOutsideZone(a.zone as ZoneId | null);
/** Moving on instinct (backing away from fire) — the planner may redirect them. */
const onInstinct = (a: { busy: string | null }) => !!a.busy && /instinct|backing away|flee/i.test(a.busy);
const busy = (a: { busy: string | null }) => !!a.busy && !onInstinct(a);

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
  /** Per-agent mode: sim time of the last request (a drop means a new episode). */
  lastAgentTime: number;
  lastMoveDest: Partial<Record<ActorId, string>>;
  usedRoutes: Set<string>;
  reported: Set<string>;
  consulted: Set<string>;
}

export interface ScriptedOptions {
  /** [min, max] simulated latency in ms (default 300–600). */
  latencyMs?: [number, number];
  seed?: number;
  mode?: 'central' | 'agents';
}

export class ScriptedProvider implements DecisionProvider {
  private rng: () => number;
  private stats = new LatencyStats();
  private n = 0;
  private mem: Memory = this.freshMemory();
  private latency: [number, number];
  private mode: 'central' | 'agents';

  constructor(opts: ScriptedOptions = {}) {
    this.latency = opts.latencyMs ?? [300, 600];
    this.mode = opts.mode ?? 'central';
    this.rng = mulberry32(opts.seed ?? 1017);
  }

  private freshMemory(): Memory {
    return { lastRemaining: Number.POSITIVE_INFINITY, lastAgentTime: -1, lastMoveDest: {}, usedRoutes: new Set(), reported: new Set(), consulted: new Set() };
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
      mode: this.mode,
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

    let call: Omit<NormalizedToolCall, 'id'>;
    if (req.agent) {
      // New episode ⇒ the clock went back.
      if (req.agent.view.sim_time < this.mem.lastAgentTime) this.mem = this.freshMemory();
      this.mem.lastAgentTime = req.agent.view.sim_time;
      call = this.agentPolicy(req.agent.view);
    } else {
      const view = req.view!;
      // New episode ⇒ decision budget goes back up.
      if (view.decisions_remaining > this.mem.lastRemaining) this.mem = this.freshMemory();
      this.mem.lastRemaining = view.decisions_remaining;
      call = this.policy(view);
    }
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

  /** Per-agent fixture: one person's simple, deterministic judgement from their own view only. */
  private agentPolicy(v: AgentView): Omit<NormalizedToolCall, 'id'> {
    const me = v.me;
    const id = me.id;
    const mk = (name: string, args: Record<string, unknown>): Omit<NormalizedToolCall, 'id'> => ({ name, arguments: { actor_id: id, ...args } });
    const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const fire = v.hazards.find((h) => h.kind === 'fire');
    const deadDoor = v.hazards.find((h) => h.kind === 'electrical');
    const st = v.alarm.station[0];
    const lastDest = this.mem.lastMoveDest[id];

    if (me.checked_in) return mk('verify_roster', { reason_summary: 'Everyone is checked in — confirm the roster.' });
    if (me.zone === 'assembly') return mk('check_in', { reason_summary: 'At the assembly point — check in.' });
    if (!v.alarm.sounding && (fire || me.alerted) && st && dist(me.tile, st.stand) <= 1.5) {
      return mk('pull_alarm', { reason_summary: 'I am at the pull station and the alarm is silent.' });
    }
    // Warn my room once about the fire (and once about a dead door), if anyone here may not know.
    for (const h of [fire, deadDoor]) {
      if (!h || this.mem.reported.has(`${id}:${h.id}`) || !v.with_me.length) continue;
      if (h.kind === 'fire' && !v.with_me.some((p) => !p.alerted)) continue;
      this.mem.reported.add(`${id}:${h.id}`);
      const message =
        h.kind === 'fire'
          ? `Fire in ${inPlace(h.zones[0] ?? null)} — get out, now!`
          : `${theDoor(h.component)} is dead — go round another way.`.replace(/^t/, 'T');
      return mk('notify', { recipient: 'all', topic: h.kind === 'fire' ? 'fire' : 'route_blocked', evidence_ids: [h.id], message, reason_summary: 'Warn the people in my room.' });
    }
    if (me.doing) return mk('observe', { reason_summary: 'Keep an eye out while moving.' });
    // My last move stopped short (dead door, fire ahead): re-plan, then take the new route.
    if (lastDest === 'assembly' || (lastDest === 'alarm' && v.alarm.sounding)) {
      const r = v.my_routes[v.my_routes.length - 1];
      if (r && !this.mem.usedRoutes.has(r.route_id) && r.destination === 'assembly') return mk('move', { destination: 'assembly', route_id: r.route_id, reason_summary: 'Take the new route out.' });
      if (lastDest === 'assembly') return mk('plan_route', { destination: 'assembly', reason_summary: 'My way out is blocked — find another route.' });
    }
    if (!v.alarm.sounding && fire && !me.outside && lastDest !== 'alarm') {
      return mk('move', { destination: 'alarm', reason_summary: 'Nobody else may know — raise the alarm on my way out.' });
    }
    return mk('move', { destination: 'assembly', reason_summary: 'Get out to the assembly point.' });
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
      const atStation = alive.find((a) => (a.alerted || a.knows_evidence.length) && !busy(a) && nearestStation(a) <= 1.5);
      if (atStation) return mk('pull_alarm', { actor_id: atStation.id, reason_summary: 'Raise the building alarm so people in other rooms hear it.' });
    }
    //  b) Tell people in the same room what you know that they don't (people shout "Fire!" by instinct, so this is
    //     mostly dead doors and late arrivals).
    const evidence = [...view.evidence].sort((x, y) => (x.kind === y.kind ? 0 : x.kind === 'fire' ? -1 : 1));
    for (const e of evidence) {
      for (const sid of e.known_by) {
        const speaker = A[sid];
        if (!speaker || speaker.lost || !speaker.alerted) continue;
        const listeners = alive.filter((b) => b.id !== speaker.id && hears(speaker, b) && !e.known_by.includes(b.id));
        if (!listeners.length) continue;
        return e.kind === 'fire'
          ? mk('notify', {
              actor_id: speaker.id,
              recipient: 'all',
              topic: 'fire',
              evidence_ids: [e.id],
              message: `Fire in ${inPlace(e.zone)} — get out to the assembly point now and keep away from it!`,
              reason_summary: 'Alert everyone in this room (voice only carries this far).',
            })
          : mk('notify', {
              actor_id: speaker.id,
              recipient: 'all',
              topic: 'route_blocked',
              evidence_ids: [e.id],
              message: `${theDoor(e.component).replace(/^the /, 'The ').replace(/^door/, 'Door')} is dead — use another way out.`,
              reason_summary: 'Share the dead door with people in this room.',
            });
      }
    }
    //  c) Someone is unaware and out of earshot of everyone who knows → send the nearest alerted person who is still
    //     inside (never back in from outside) to the hallway pull station; they pull it on arrival.
    const knowers = alive.filter((a) => a.alerted);
    const unreachable = unaware.filter((u) => !knowers.some((k) => k.knows_evidence.length && hears(k, u)));
    if (!alarmActive && unreachable.length && stations.length) {
      const enRoute = knowers.some((k) => busy(k) && this.mem.lastMoveDest[k.id] === 'alarm');
      const runner = knowers
        .filter((k) => !busy(k) && !k.checked_in && !outside(k) && k.status !== 'escorted')
        .sort((a, b) => nearestStation(a) - nearestStation(b))[0];
      if (!enRoute && runner && this.mem.lastMoveDest[runner.id] !== 'alarm') {
        return mk('move', { actor_id: runner.id, destination: 'alarm', reason_summary: `Go pull the hallway fire alarm — ${unreachable.map((u) => u.id).join(', ')} cannot hear us.` });
      }
    }

    // 2. Accountability (survivors only).
    const warden = A[WARDEN_ID] && !A[WARDEN_ID].lost ? A[WARDEN_ID] : undefined;
    if (alive.length && alive.every((a) => a.checked_in) && !view.roster.verified && warden) {
      return mk('verify_roster', { actor_id: WARDEN_ID, reason_summary: 'Everyone still alive is checked in; warden verifies the roster.' });
    }
    const toCheck = alive.find((a) => a.zone === 'assembly' && !a.checked_in && !busy(a));
    if (toCheck) return mk('check_in', { actor_id: toCheck.id });

    // 3. Optional buddy arrangement: only when the assisted person prefers it AND their buddy is close; otherwise they
    //    go on their own.
    const { person: pid, buddy: bid } = ASSISTANCE;
    const helper = A[bid] && !A[bid].lost ? A[bid] : undefined;
    const person = A[pid] && !A[pid].lost ? A[pid] : undefined;
    const escortActive = !!(helper?.escort || person?.escort) || person?.status === 'escorted';
    const buddyClose = !!helper && !!person && dist(helper.tile, person.tile) <= 6;
    const buddy =
      view.assistance.preference === 'buddy' &&
      !view.assistance.fulfilled &&
      !!helper?.alerted &&
      !helper.checked_in &&
      !!person &&
      !person.checked_in &&
      person.zone !== 'assembly' &&
      (escortActive || view.assistance.requested || buddyClose);
    if (buddy && person?.alerted && !busy(person) && !view.assistance.requested) {
      return mk('request_assistance', { actor_id: pid, helper_id: bid, reason_summary: `${ACTOR_PROFILES[pid].name} asks for the pre-arranged buddy guidance.` });
    }
    if (buddy && view.assistance.requested && !view.assistance.accepted && !escortActive && helper && person) {
      const d = dist(helper.tile, person.tile);
      if (d <= 1.5 && !busy(helper) && !busy(person)) {
        return mk('assist', { actor_id: bid, person_id: pid, reason_summary: 'Start the agreed escort.' });
      }
      if (!busy(helper) && this.mem.lastMoveDest[bid] !== pid) {
        return mk('move', { actor_id: bid, destination: pid, reason_summary: `Go to ${ACTOR_PROFILES[pid].name} for the buddy arrangement.` });
      }
    }

    // 4. Evacuate everyone alive, alerted, idle (or only backing away on instinct) and not yet at assembly —
    //    immediately (fire spreads). The engine routes away from known fire.
    for (const a of alive) {
      if (!a.alerted || a.checked_in || busy(a) || a.zone === 'assembly') continue;
      if (a.status === 'escorted') continue; // follower moves with the leader
      if (buddy && !escortActive && (a.id === pid || a.id === bid) && view.assistance.requested) continue; // handled above
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
    const watcher = warden ?? alive[0] ?? view.actors[0];
    if (!this.mem.consulted.has('routes')) {
      this.mem.consulted.add('routes');
      return mk('consult_plan', { actor_id: watcher.id, section: 'routes', reason_summary: 'Check the routes section while people move.' });
    }
    const someone = alive.find((a) => !a.checked_in) ?? watcher;
    return mk('observe', { actor_id: someone.id, reason_summary: 'Monitor while others move.' });
  }
}
