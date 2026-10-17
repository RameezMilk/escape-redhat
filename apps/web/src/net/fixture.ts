// ?fixture=1 — a canned, clearly-labelled FIXTURE stream for UI development without the server.
// It is NOT model output and the UI says so (provider chip "FIXTURE"). Movement uses BFS on the real map.
import type {
  ActorId,
  ActorSnapshot,
  ClientMessage,
  EpisodeResult,
  HazardKind,
  HazardSnapshot,
  MapData,
  ServerMessage,
  Snapshot,
  Tile,
  TraceRow,
} from '@escape/contracts';
import { hazardFootprint, hazardNoGo } from '@escape/engine';

import { setSenderOverride } from './socket';
import { store } from '../state/store';

const EP = 'fixture-ep-1';
const NAMES: Record<ActorId, string> = { alex: 'Alex', maya: 'Maya', daniel: 'Daniel' };

interface Walker {
  path: Tile[];
  progress: number;
  dest: string;
  onDone?: () => void;
}

export function startFixture(map: MapData): void {
  store.setSource('fixture');
  store.setConnection('open');
  const caseSpawns: Record<ActorId, { col: number; row: number; dir: ActorSnapshot['dir'] }> = {
    alex: { col: 22, row: 8, dir: 'up' },
    maya: { col: 13, row: 7, dir: 'up' },
    daniel: { col: 15, row: 12, dir: 'left' },
  };
  const actors: ActorSnapshot[] = (Object.keys(caseSpawns) as ActorId[]).map((id) => ({
    id,
    name: NAMES[id],
    role: id === 'alex' ? 'Exercise warden' : id === 'maya' ? 'Employee' : 'Visitor (uses a wheelchair)',
    col: caseSpawns[id].col,
    row: caseSpawns[id].row,
    x: caseSpawns[id].col,
    y: caseSpawns[id].row,
    dir: caseSpawns[id].dir,
    anim: id === 'daniel' ? 'idle' : 'type',
    zone: map.zone[caseSpawns[id].row * map.cols + caseSpawns[id].col],
    status: 'working',
    alerted: false,
    checkedIn: false,
    escort: null,
    task: null,
    knows: [],
    usesWheelchair: id === 'daniel',
  }));
  const hazards: HazardSnapshot[] = [];
  const walkers = new Map<ActorId, Walker>();
  let tick = 0;
  let paused = false;
  let phase: Snapshot['phase'] = 'idle';
  let decisions = 0;
  const trace: TraceRow[] = [];
  let seq = 0;
  let ended: EpisodeResult | null = null;
  const timers: { at: number; fn: () => void }[] = [];
  const simTime = () => tick / 10;
  const later = (sec: number, fn: () => void) => timers.push({ at: simTime() + sec, fn });

  const emit = (m: ServerMessage) => store.handle(m);
  const snap = (): Snapshot => ({
    episodeId: EP,
    caseId: 'demo-hero',
    seed: 20261017,
    tick,
    simTime: simTime(),
    phase,
    paused,
    mode: 'live',
    actors: actors.map((a) => ({ ...a })),
    hazards: hazards.map((h) => ({ ...h })),
    roster: { checkedIn: actors.filter((a) => a.checkedIn).map((a) => a.id), verified: !!ended },
    assistance: { required: true, requested: decisions >= 3, accepted: decisions >= 6, fulfilled: !!ended },
    decisions: { used: decisions, max: 24, inFlight: false },
    outcome: ended ? ended.outcome : null,
  });

  const row = (r: Partial<TraceRow> & Pick<TraceRow, 'origin' | 'status' | 'summary'>): TraceRow => {
    const full: TraceRow = { id: `r${++seq}`, episodeId: EP, kind: 'decision', simTime: simTime(), wallTime: Date.now(), ...r };
    trace.push(full);
    emit({ type: 'trace', episodeId: EP, row: full });
    return full;
  };
  const engineRow = (summary: string, actor?: ActorId, evidenceIds?: string[]) =>
    row({ kind: 'engine', origin: 'Engine', status: 'info', summary, actor, evidenceIds, eventSeq: seq });
  const decision = (actor: ActorId, tool: string, args: Record<string, unknown>, summary: string, opts: Partial<TraceRow> = {}) => {
    decisions++;
    return row({
      decisionId: `D-${String(decisions).padStart(3, '0')}`,
      actionId: `A-${String(decisions).padStart(3, '0')}`,
      origin: `FIXTURE planner → ${NAMES[actor]} → ${tool}`,
      actor,
      tool,
      args: { actor_id: actor, ...args },
      status: 'completed',
      summary,
      latencyMs: 600 + ((decisions * 137) % 500),
      provider: { id: 'fixture', model: 'fixture', endpointKind: 'scripted' },
      ...opts,
    });
  };
  const say = (actor: ActorId, text: string, kind: 'message' | 'alert' | 'observation' | 'ambient' = 'message') =>
    emit({ type: 'bubble', episodeId: EP, actor, text, kind, ttlMs: kind === 'message' ? 4200 : 2500 });

  const W = (c: number, r: number) => c >= 0 && r >= 0 && c < map.cols && r < map.rows && map.walkable[r * map.cols + c];
  const blockedNow = () => new Set(hazards.flatMap((h) => h.noGo.map((t) => `${t.col},${t.row}`)));
  const bfs = (from: Tile, goal: (t: Tile) => boolean, avoid: Set<string>): Tile[] => {
    const prev = new Map<string, string | null>();
    const q: Tile[] = [from];
    prev.set(`${from.col},${from.row}`, null);
    while (q.length) {
      const t = q.shift()!;
      if (goal(t)) {
        const out: Tile[] = [];
        let k: string | null = `${t.col},${t.row}`;
        while (k) {
          const [c, r] = k.split(',').map(Number);
          out.unshift({ col: c, row: r });
          k = prev.get(k) ?? null;
        }
        return out.slice(1);
      }
      for (const [dc, dr] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ]) {
        const n = { col: t.col + dc, row: t.row + dr };
        const k = `${n.col},${n.row}`;
        if (!prev.has(k) && W(n.col, n.row) && !avoid.has(k)) {
          prev.set(k, `${t.col},${t.row}`);
          q.push(n);
        }
      }
    }
    return [];
  };
  const inZone = (z: string) => (t: Tile) => map.zone[t.row * map.cols + t.col] === z;
  const walk = (id: ActorId, goal: (t: Tile) => boolean, dest: string, avoid: Set<string>, onDone?: () => void) => {
    const a = actors.find((x) => x.id === id)!;
    const path = bfs({ col: a.col, row: a.row }, goal, avoid);
    walkers.set(id, { path, progress: 0, dest, onDone });
    a.status = 'moving';
    a.anim = 'walk';
    a.task = { kind: 'move', destination: dest, tilesRemaining: path.length };
  };

  const place = (kind: HazardKind, col: number, row: number) => {
    hazards.push({
      kind,
      col,
      row,
      w: 2,
      h: 2,
      tiles: hazardFootprint(kind, col, row),
      noGo: hazardNoGo(map, kind, col, row),
      placedAtSimTime: simTime(),
    });
    engineRow(`Presenter placed a ${kind} at (${col},${row}).`);
    if (kind === 'fire') {
      later(0.6, () => {
        phase = 'incident';
        const maya = actors.find((a) => a.id === 'maya')!;
        maya.knows.push('E1');
        maya.alerted = true;
        engineRow('Maya sees fire inside door A (evidence E1).', 'maya', ['E1']);
        say('maya', '🔥', 'observation');
      });
      later(1.8, () => {
        decision('maya', 'notify', { recipient: 'all', topic: 'fire', evidence_ids: ['E1'], message: 'Fire by door A! Leave by the east door.' }, 'Delivered to Alex, Daniel; both alerted.', {
          evidenceIds: ['E1'],
          reasonSummary: 'Report the hazard first so everyone is alerted.',
        });
        say('maya', 'Fire by door A! Leave by the east door.');
        for (const a of actors) {
          a.alerted = true;
          a.status = a.id === 'maya' ? 'alerted' : 'alerted';
          if (a.anim === 'type') a.anim = 'idle';
          if (a.id !== 'maya') say(a.id, '!', 'alert');
        }
        phase = 'evacuating';
      });
      later(3.0, () => decision('alex', 'consult_plan', { section: 'assistance' }, 'Plan: Alex is Daniel’s agreed buddy if he asks (1910.38(e)).'));
      later(4.0, () => {
        decision('daniel', 'request_assistance', { helper_id: 'alex' }, 'Daniel asked Alex for the agreed buddy support.');
        say('daniel', 'Alex, can you guide me out?');
      });
      later(5.0, () => {
        decision('alex', 'assist', { person_id: 'daniel' }, 'Alex is 9.2 tiles away — must be next to Daniel.', {
          status: 'rejected',
          result: { ok: false, actionId: 'A-005', error: { code: 'OUT_OF_RANGE', message: 'Alex is 9.2 tiles from Daniel.', hint: 'move alex to daniel first' } },
        });
      });
      later(6.0, () => {
        const r = decision('alex', 'move', { destination: 'daniel' }, 'Started: Alex → Daniel (14 tiles).', { status: 'running', recovered: true });
        walk('alex', (t) => Math.abs(t.col - 15) + Math.abs(t.row - 12) === 1, 'daniel', blockedNow(), () => {
          r.status = 'completed';
          r.summary = 'Arrived next to Daniel.';
          emit({ type: 'trace', episodeId: EP, row: { ...r } });
          later(0.8, () => {
            decision('alex', 'assist', { person_id: 'daniel' }, 'Escort started: Alex is guiding Daniel.');
            const al = actors.find((a) => a.id === 'alex')!;
            const da = actors.find((a) => a.id === 'daniel')!;
            al.escort = { role: 'leader', partner: 'daniel' };
            da.escort = { role: 'follower', partner: 'alex' };
          });
          later(2.0, () => {
            decision('alex', 'move', { destination: 'assembly' }, 'Started: Alex + Daniel → assembly via east exit.', { status: 'running' });
            walk('alex', inZone('assembly'), 'assembly', blockedNow());
            walk('daniel', inZone('assembly'), 'assembly', blockedNow());
          });
        });
      });
      later(7.0, () => {
        decision('maya', 'move', { destination: 'assembly' }, 'Started: Maya → assembly via door B and the east exit.', { status: 'running' });
        walk('maya', inZone('assembly'), 'assembly', blockedNow(), () => {
          later(0.5, () => {
            decision('maya', 'check_in', {}, 'Maya checked in at the assembly point.');
            actors.find((a) => a.id === 'maya')!.checkedIn = true;
          });
        });
      });
    }
  };

  setSenderOverride((msg: ClientMessage) => {
    if (msg.type === 'place') {
      if (hazards.some((h) => h.kind === msg.kind)) {
        emit({ type: 'placement_result', episodeId: EP, kind: msg.kind, ok: false, reason: 'Already placed (fixture).' });
        return;
      }
      place(msg.kind, msg.col, msg.row);
    } else if (msg.type === 'remove') {
      const i = hazards.findIndex((h) => h.kind === msg.kind);
      if (i >= 0) hazards.splice(i, 1);
    } else if (msg.type === 'pause') paused = true;
    else if (msg.type === 'resume') paused = false;
    else if (msg.type === 'reset') location.reload();
    else store.toast(`Fixture mode ignores "${msg.type}".`);
  });

  emit({
    type: 'welcome',
    episodeId: EP,
    snapshot: snap(),
    trace: [],
    provider: { id: 'fixture', label: 'Fixture', model: 'none', endpointKind: 'scripted', healthy: true, thinking: false },
    mapId: map.id,
    cases: [{ caseId: 'demo-hero', split: 'demo', family: 'hero' }],
    runs: [],
    result: null,
  });

  // Catch up on real elapsed time so the fixture keeps pace even when the tab is throttled (hidden windows → 1 Hz timers).
  let lastWall = performance.now();
  let owed = 0;
  setInterval(() => {
    const nowWall = performance.now();
    owed += (nowWall - lastWall) / 100;
    lastWall = nowWall;
    if (paused) {
      owed = 0;
      emit({ type: 'snapshot', episodeId: EP, snapshot: snap() });
      return;
    }
    while (owed >= 1) {
      owed -= 1;
      step();
    }
    emit({ type: 'snapshot', episodeId: EP, snapshot: snap() });
  }, 100);

  function step(): void {
    tick++;
    for (const t of timers.filter((x) => x.at <= simTime())) {
      timers.splice(timers.indexOf(t), 1);
      t.fn();
    }
    for (const [id, w] of walkers) {
      const a = actors.find((x) => x.id === id)!;
      if (!w.path.length) {
        walkers.delete(id);
        a.anim = 'idle';
        a.status = 'waiting';
        a.task = null;
        w.onDone?.();
        continue;
      }
      const next = w.path[0];
      // Fixture-only blocker discovery
      const blocked = blockedNow();
      if (blocked.has(`${next.col},${next.row}`)) {
        walkers.delete(id);
        a.anim = 'idle';
        a.status = 'waiting';
        a.task = null;
        engineRow(`${NAMES[id]} found the route blocked and stopped safely.`, id, ['E2']);
        say(id, '⛔', 'observation');
        continue;
      }
      w.progress += 0.3;
      const dc = next.col - a.col;
      const dr = next.row - a.row;
      a.dir = dc > 0 ? 'right' : dc < 0 ? 'left' : dr > 0 ? 'down' : 'up';
      if (w.progress >= 1) {
        w.progress -= 1;
        a.col = next.col;
        a.row = next.row;
        w.path.shift();
      }
      const nn = w.path[0];
      a.x = nn ? a.col + (nn.col - a.col) * w.progress : a.col;
      a.y = nn ? a.row + (nn.row - a.row) * w.progress : a.row;
      a.zone = map.zone[a.row * map.cols + a.col];
      if (a.task) a.task.tilesRemaining = w.path.length;
    }
    // Finish once everybody is at the assembly
    if (!ended && actors.every((a) => a.zone === 'assembly') && walkers.size === 0) {
      for (const a of actors) a.checkedIn = true;
      decision('alex', 'verify_roster', {}, '3/3 checked in, 0 outstanding — verified.');
      phase = 'ended';
      ended = {
        episodeId: EP,
        caseId: 'demo-hero',
        outcome: { status: 'success', reason: 'FIXTURE: all three checked in and the warden verified the roster.', simTime: simTime() },
        metrics: {
          decisions,
          toolCalls: decisions,
          validCalls: decisions - 1,
          invalidCalls: 1,
          invalidByCode: { OUT_OF_RANGE: 1 },
          malformed: 0,
          providerErrors: 0,
          recoveries: 1,
          repeatedInvalid: 0,
          simTimeToComplete: simTime(),
          simTime: simTime(),
          wallTimeMs: simTime() * 1000,
          latencyMsP50: 820,
          latencyMsP95: 1100,
          promptTokens: 0,
          completionTokens: 0,
          procedural: {
            hazardReported: true,
            reportLatencySimSec: 1.2,
            assistanceRequired: true,
            assistanceFulfilled: true,
            assistWithoutConsentAttempts: 0,
            checkedIn: 3,
            rosterVerified: true,
            prematureVerifyAttempts: 0,
            knownHazardMoveAttempts: 0,
            routeInterruptions: 0,
            replannedAfterInterruption: false,
          },
        },
        debrief: [
          {
            id: 'reporting',
            title: 'Report first',
            text: 'FIXTURE text: Maya reported the fire 1.2 s after seeing it, so Alex and Daniel could act on it.',
            ruleIds: ['EAP-REPORT'],
            sources: [{ label: '29 CFR 1910.38(c)(1)', url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.38' }],
          },
          {
            id: 'assistance',
            title: 'Assistance by agreement',
            text: 'FIXTURE text: Daniel asked for his agreed buddy; Alex had to be next to him before the escort could start.',
            ruleIds: ['EAP-ASSIST'],
            sources: [{ label: '29 CFR 1910.38(e)', url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.38' }],
          },
          {
            id: 'accountability',
            title: 'Account for everyone',
            text: 'FIXTURE text: success was declared only after the warden verified 3/3 physically checked in.',
            ruleIds: ['EAP-ACCOUNT'],
            sources: [{ label: '29 CFR 1910.38(c)(4)', url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.38' }],
          },
        ],
        score: { reward: 1, success: true, checks: {} },
      };
      emit({ type: 'episode_end', episodeId: EP, result: ended });
    }
  }

  // Ambient life before the incident (authored lines — labelled ambient)
  later(2.5, () => phase === 'idle' && say('alex', 'Badge printer jammed again…', 'ambient'));
  later(5.5, () => phase === 'idle' && say('maya', 'Slides look good!', 'ambient'));
}
