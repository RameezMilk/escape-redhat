// ?fixture=1 — a canned, clearly-labelled FIXTURE stream for UI development without the server.
// It is NOT model output and the UI says so (provider chip "FIXTURE"). Storyline, on whatever map is loaded: the fire
// spreads tile by tile (and up the walls); whoever is nearest spots it and shouts (instinct) so their room hears; the
// witness heads for the nearest pull station and pulls it on the way (instinct) so everyone hears the siren; the
// buddy escorts the person who asked for help; everyone else walks to the assembly point; a sliding door can lose
// power (stop + replan). Add &loss=1 to leave the witness behind (faster fire) and see a partial outcome.
import type {
  ActorId,
  ActorSnapshot,
  ClientMessage,
  DebriefLesson,
  EpisodeResult,
  HazardKind,
  HazardSnapshot,
  MapData,
  ServerMessage,
  Snapshot,
  Tile,
  TraceRow,
} from '@escape/contracts';
import { ACTOR_IDS, ACTOR_PROFILES, ASSISTANCE, WARDEN_ID } from '@escape/contracts';
import { doorNear, isFlammable, placesFor } from '@escape/engine';

import { store } from '../state/store';
import { setSenderOverride } from './socket';

const EP = 'fixture-ep-1';
const NAMES = Object.fromEntries(ACTOR_IDS.map((id) => [id, ACTOR_PROFILES[id].name])) as Record<ActorId, string>;

interface Walker {
  path: Tile[];
  progress: number;
  dest: string;
  avoid?: () => Set<string>;
  goal: (t: Tile) => boolean;
  onDone?: () => void;
  rowRef?: TraceRow;
}
interface FireState {
  id: string;
  burnAt: Map<string, number>; // cell → tick ignited
  charred: Set<string>;
}

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

export function startFixture(map: MapData): void {
  store.setSource('fixture');
  store.setConnection('open');
  const lossMode = new URLSearchParams(location.search).get('loss') === '1';
  const rng = mulberry32(20261017);
  const SPREAD_P = lossMode ? 0.055 : 0.035;
  const BURN_TICKS = 450;

  const places = placesFor(map);
  const spawns = map.spawnSpots;
  const spawnOf = (id: ActorId) => spawns[id][0];
  const actors: ActorSnapshot[] = ACTOR_IDS.map((id) => ({
    id,
    name: NAMES[id],
    role: ACTOR_PROFILES[id].role,
    col: spawnOf(id).col,
    row: spawnOf(id).row,
    x: spawnOf(id).col,
    y: spawnOf(id).row,
    dir: spawnOf(id).dir,
    anim: ACTOR_PROFILES[id].usesWheelchair ? 'idle' : 'type',
    zone: map.zone[spawnOf(id).row * map.cols + spawnOf(id).col],
    status: 'working',
    alerted: false,
    checkedIn: false,
    escort: null,
    task: null,
    knows: [],
    usesWheelchair: ACTOR_PROFILES[id].usesWheelchair,
    lost: false,
  }));
  const { person: PERSON, buddy: BUDDY } = ASSISTANCE;
  const A = (id: ActorId) => actors.find((a) => a.id === id)!;
  const hazards: HazardSnapshot[] = [];
  const fires: FireState[] = [];
  const walkers = new Map<ActorId, Walker>();
  let tick = 0;
  let paused = false;
  let phase: Snapshot['phase'] = 'idle';
  let decisions = 0;
  let seq = 0;
  let hz = 0;
  let ended: EpisodeResult | null = null;
  let storyStarted = false;
  let firstSight: number | null = null;
  let alarm: Snapshot['alarm'] = { active: false };
  let doorTrouble = false;
  const timers: { at: number; fn: () => void }[] = [];
  const simTime = () => tick / 10;
  const later = (sec: number, fn: () => void) => timers.push({ at: simTime() + sec, fn });
  const emit = (m: ServerMessage) => store.handle(m);
  const key = (t: { col: number; row: number }) => `${t.col},${t.row}`;
  const idx = (c: number, r: number) => r * map.cols + c;

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
    hazards: hazards.map((h) => ({ ...h, cells: [...h.cells], charred: [...h.charred], noGo: [...h.noGo] })),
    roster: { checkedIn: actors.filter((a) => a.checkedIn).map((a) => a.id), verified: !!ended && !A(WARDEN_ID).lost, lost: actors.filter((a) => a.lost).map((a) => a.id) },
    assistance: { required: false, requested: decisions >= 4, accepted: !!A(BUDDY).escort, fulfilled: A(PERSON).checkedIn && !!A(BUDDY).escort },
    alarm: { ...alarm },
    decisions: { used: decisions, max: 100, inFlight: false },
    outcome: ended ? ended.outcome : null,
  });

  const row = (r: Partial<TraceRow> & Pick<TraceRow, 'origin' | 'status' | 'summary'>): TraceRow => {
    const full: TraceRow = { id: `r${++seq}`, episodeId: EP, kind: 'decision', simTime: simTime(), wallTime: Date.now(), ...r };
    emit({ type: 'trace', episodeId: EP, row: full });
    return full;
  };
  const update = (r: TraceRow, p: Partial<TraceRow>) => {
    Object.assign(r, p);
    emit({ type: 'trace', episodeId: EP, row: { ...r } });
  };
  const engineRow = (summary: string, actor?: ActorId, evidenceIds?: string[]) =>
    row({ kind: 'engine', origin: 'Engine', status: 'info', summary, actor, evidenceIds, eventSeq: seq });
  const instinctRow = (summary: string, actor: ActorId) => row({ kind: 'engine', origin: 'Instinct (engine)', status: 'info', summary, actor, eventSeq: seq });
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
      latencyMs: 450 + ((decisions * 137) % 400),
      provider: { id: 'fixture', model: 'fixture', endpointKind: 'scripted' },
      ...opts,
    });
  };
  const say = (actor: ActorId, text: string, kind: 'message' | 'alert' | 'observation' | 'ambient' = 'message') =>
    emit({ type: 'bubble', episodeId: EP, actor, text, kind, ttlMs: kind === 'message' ? 4200 : 2500 });

  // --- navigation (BFS on the real map, avoiding burning/charred cells and stuck doors)
  const blockedNow = () => new Set(hazards.flatMap((h) => h.noGo.map(key)));
  const W = (c: number, r: number) => c >= 0 && r >= 0 && c < map.cols && r < map.rows && map.walkable[idx(c, r)];
  const bfs = (from: Tile, goal: (t: Tile) => boolean, avoid: Set<string>): Tile[] => {
    const prev = new Map<string, string | null>([[key(from), null]]);
    const q: Tile[] = [from];
    while (q.length) {
      const t = q.shift()!;
      if (goal(t)) {
        const out: Tile[] = [];
        for (let k: string | null = key(t); k; k = prev.get(k) ?? null) {
          const [c, r] = k.split(',').map(Number);
          out.unshift({ col: c, row: r });
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
        if (!prev.has(key(n)) && W(n.col, n.row) && !avoid.has(key(n))) {
          prev.set(key(n), key(t));
          q.push(n);
        }
      }
    }
    return [];
  };
  const inZone = (z: string) => (t: Tile) => map.zone[idx(t.col, t.row)] === z;
  const walk = (id: ActorId, goal: (t: Tile) => boolean, dest: string, onDone?: () => void, rowRef?: TraceRow) => {
    const a = A(id);
    if (a.lost) return;
    const path = bfs({ col: a.col, row: a.row }, goal, blockedNow());
    walkers.set(id, { path, progress: 0, dest, goal, onDone, rowRef });
    a.status = 'moving';
    a.anim = 'walk';
    a.task = { kind: 'move', destination: dest, tilesRemaining: path.length };
  };
  const nearestAlarm = (from: Tile) => {
    let best = map.alarms[0];
    let bestD = Infinity;
    for (const s of map.alarms) {
      const d = bfs(from, (t) => t.col === s.stand.col && t.row === s.stand.row, blockedNow()).length || Infinity;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  };

  // --- hazards
  const refreshHazard = (h: HazardSnapshot, f?: FireState) => {
    if (f) {
      h.cells = [...f.burnAt.keys()].map((k) => {
        const [col, row] = k.split(',').map(Number);
        return { col, row };
      });
      h.charred = [...f.charred].map((k) => {
        const [col, row] = k.split(',').map(Number);
        return { col, row };
      });
    }
    h.noGo = [...h.cells, ...h.charred];
  };
  const flammable = (c: number, r: number, doors: Set<string>) => {
    if (!isFlammable(map, c, r) || doors.has(`${c},${r}`)) return false;
    return map.terrain[idx(c, r)] !== 'wall' || rng() < 0.25; // walls catch slowly, then carry the fire on
  };

  const place = (kind: HazardKind, col: number, row: number) => {
    if (kind === 'electrical') {
      const door = doorNear(map, col, row);
      if (!door || hazards.some((h) => h.componentId === door.id)) {
        emit({ type: 'placement_result', episodeId: EP, kind, ok: false, reason: 'Drop on an electric sliding door (fixture).' });
        return;
      }
      const h: HazardSnapshot = { id: `H${++hz}`, kind, col: door.tiles[0].col, row: door.tiles[0].row, cells: [...door.tiles], charred: [], noGo: [...door.tiles], componentId: door.id, placedAtSimTime: simTime() };
      hazards.push(h);
      engineRow(`Power cut — ${places.doorName(door.id)} stuck shut`);
      doorTrouble = true;
      return;
    }
    const f: FireState = { id: `H${++hz}`, burnAt: new Map(), charred: new Set() };
    for (const t of [
      { col, row },
      { col: col + 1, row },
      { col, row: row + 1 },
      { col: col + 1, row: row + 1 },
    ])
      f.burnAt.set(key(t), tick);
    fires.push(f);
    const h: HazardSnapshot = { id: f.id, kind, col, row, cells: [], charred: [], noGo: [], placedAtSimTime: simTime() };
    refreshHazard(h, f);
    hazards.push(h);
    engineRow(`Fire started ${places.atPlace(map.zone[idx(col, row)])}`);
    if (!storyStarted) startStory();
  };

  // --- scripted storyline (FIXTURE, not a model)
  let witness: ActorId = ACTOR_IDS[0];
  const startStory = () => {
    storyStarted = true;
    const seed = hazards.find((h) => h.kind === 'fire')!;
    const d = (a: ActorSnapshot) => Math.hypot(a.col - seed.col, a.row - seed.row);
    witness = [...actors].sort((a, b) => d(a) - d(b))[0].id;
    const roommates = () => actors.filter((a) => a.id !== witness && !a.lost && a.zone === A(witness).zone);
    later(0.6, () => {
      phase = 'incident';
      firstSight = simTime();
      const w = A(witness);
      w.knows.push('E1');
      w.alerted = true;
      w.anim = 'idle';
      engineRow(`${NAMES[witness]} spots fire ${places.atPlace(map.zone[idx(seed.col, seed.row)])}`, witness, ['E1']);
      say(witness, '🔥 Fire!', 'observation');
    });
    later(1.0, () => {
      // Instinct: shout to the room (people elsewhere do not hear).
      const heard = roommates();
      for (const a of heard) {
        a.knows.push('E1');
        a.alerted = true;
        a.status = 'alerted';
        say(a.id, '!', 'alert');
      }
      instinctRow(`${NAMES[witness]} shouts “Fire!”${heard.length ? ` — ${heard.map((a) => NAMES[a.id]).join(' and ')} hear${heard.length === 1 ? 's' : ''}` : ''}`, witness);
      say(witness, 'Fire! Get out!');
    });
    later(1.5, () => {
      // Instinct: the people in the room back away from the flames while waiting for a plan.
      const far = (t: Tile) => Math.hypot(t.col - seed.col, t.row - seed.row) >= 7;
      for (const a of roommates()) walk(a.id, (t) => far(t) && inZone(a.zone ?? '')(t), 'away from the fire');
    });
    later(2.2, () => {
      const st = nearestAlarm(A(witness));
      const r = decision(witness, 'move', { destination: 'assembly' }, `${NAMES[witness]} → assembly past ${places.stationName(st.id)}.`, { status: 'running', reasonSummary: 'Get out — and raise the alarm on the way.' });
      walk(witness, (t) => t.col === st.stand.col && t.row === st.stand.row, 'assembly', () => {
        // Instinct: they pass the pull station and pull it on the way out.
        alarm = { active: true, atSimTime: simTime(), by: witness, stationId: st.id };
        instinctRow(`${NAMES[witness]} pulls ${places.stationName(st.id)} on the way out — everyone hears the siren`, witness);
        for (const a of actors) {
          if (a.lost) continue;
          a.alerted = true;
          if (a.anim === 'type') a.anim = 'idle';
          if (a.status === 'working') a.status = 'alerted';
          if (a.id !== witness) say(a.id, '🚨', 'alert');
        }
        phase = 'evacuating';
        afterAlarm();
        if (!lossMode) {
          walk(witness, inZone('assembly'), 'assembly', () => {
            update(r, { status: 'completed', summary: `${NAMES[witness]} reached the assembly point.` });
            later(0.6, () => checkIn(witness));
          }, r);
        }
      }, r);
    });
  };

  const afterAlarm = () => {
    const buddyFlow = witness !== PERSON && witness !== BUDDY;
    if (buddyFlow) {
      later(1.0, () => {
        decision(PERSON, 'request_assistance', { helper_id: BUDDY }, `${NAMES[PERSON]} asked ${NAMES[BUDDY]} to guide them out.`);
        say(PERSON, `${NAMES[BUDDY]}, can you guide me out?`);
      });
      later(2.0, () => {
        const r = decision(BUDDY, 'move', { destination: PERSON }, `${NAMES[BUDDY]} → ${NAMES[PERSON]}.`, { status: 'running' });
        const p = A(PERSON);
        walk(BUDDY, (t) => Math.abs(t.col - p.col) + Math.abs(t.row - p.row) === 1, PERSON, () => {
          update(r, { status: 'completed', summary: `Arrived next to ${NAMES[PERSON]}.` });
          later(0.6, () => {
            decision(BUDDY, 'assist', { person_id: PERSON }, `Escort started: ${NAMES[BUDDY]} is guiding ${NAMES[PERSON]}.`);
            A(BUDDY).escort = { role: 'leader', partner: PERSON };
            A(PERSON).escort = { role: 'follower', partner: BUDDY };
          });
          later(1.4, () => evacuate(BUDDY, true));
        }, r);
      });
    }
    // Everyone else walks out on their own, a moment apart.
    actors
      .filter((a) => a.id !== witness && !(buddyFlow && (a.id === PERSON || a.id === BUDDY)))
      .forEach((a, i) => later(1.2 + i * 0.7, () => evacuate(a.id, false)));
    if (lossMode) later(3.0, () => engineRow(`FIXTURE (&loss=1): ${NAMES[witness]} is left behind — they are never sent to the exit.`));
  };

  const evacuate = (id: ActorId, withPartner: boolean) => {
    if (A(id).lost) return;
    const r = decision(id, 'move', { destination: 'assembly' }, `${NAMES[id]}${withPartner ? ` + ${NAMES[PERSON]}` : ''} → assembly.`, { status: 'running' });
    const onDone = () => {
      update(r, { status: 'completed', summary: `${NAMES[id]} reached the assembly point.` });
      later(0.6, () => checkIn(id));
    };
    walk(id, inZone('assembly'), 'assembly', onDone, r);
    if (withPartner) walk(PERSON, inZone('assembly'), 'assembly', () => later(0.9, () => checkIn(PERSON)));
  };

  const checkIn = (id: ActorId) => {
    const a = A(id);
    if (a.lost || a.checkedIn) return;
    decision(id, 'check_in', {}, `${NAMES[id]} checked in at assembly.`);
    a.checkedIn = true;
    a.status = 'checked_in';
  };

  const stuckDoor = (id: ActorId, w: Walker) => {
    const doorCells = new Set(hazards.filter((h) => h.kind === 'electrical').flatMap((h) => h.cells.map(key)));
    const ahead = w.path.slice(0, 5).find((t) => doorCells.has(key(t)));
    if (!ahead) return false;
    const a = A(id);
    walkers.delete(id);
    a.anim = 'idle';
    a.status = 'waiting';
    a.task = null;
    const dead = hazards.find((h) => h.kind === 'electrical' && h.cells.some((c) => key(c) === key(ahead)));
    const doorTxt = places.doorName(dead?.componentId);
    if (w.rowRef) update(w.rowRef, { status: 'failed', summary: `${NAMES[id]} stopped: ${doorTxt} ahead has no power.` });
    engineRow(`${NAMES[id]} finds ${doorTxt} dead`, id, ['E2']);
    say(id, "⚡ This door's dead!", 'observation');
    later(0.8, () => {
      const msg = `${doorTxt[0].toUpperCase()}${doorTxt.slice(1)} is dead — go round another way!`;
      decision(id, 'notify', { recipient: 'all', topic: 'route_blocked', evidence_ids: ['E2'], message: msg }, 'Told the people nearby.', { recovered: true, result: { ok: true, actionId: 'fx', status: 'completed', data: { delivered_to: [] } } });
      say(id, msg);
    });
    later(1.8, () => {
      const r = decision(id, 'move', { destination: w.dest }, `${NAMES[id]} re-routes around the stuck door.`, { status: 'running' });
      const done = w.onDone;
      walk(id, w.goal, w.dest, () => {
        update(r, { status: 'completed', summary: `${NAMES[id]} reached ${w.dest}.` });
        done?.();
      }, r);
      if (A(id).escort?.role === 'leader') walk(PERSON, w.goal, w.dest, () => later(0.9, () => checkIn(PERSON)));
    });
    return true;
  };

  setSenderOverride((msg: ClientMessage) => {
    if (msg.type === 'place') place(msg.kind, msg.col, msg.row);
    else if (msg.type === 'pause') paused = true;
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

  // Catch up on real elapsed time so the fixture keeps pace even when the tab is throttled.
  let lastWall = performance.now();
  let owed = 0;
  setInterval(() => {
    const nowWall = performance.now();
    owed += (nowWall - lastWall) / 100;
    lastWall = nowWall;
    if (paused) owed = 0;
    while (owed >= 1 && !ended) {
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
    // Fire: spread to random 8-neighbours, burn out to char after BURN_TICKS.
    const doorCells = new Set(hazards.filter((h) => h.kind === 'electrical').flatMap((h) => h.cells.map(key)));
    const allBurning = new Set(fires.flatMap((f) => [...f.burnAt.keys(), ...f.charred]));
    for (const f of fires) {
      for (const [k, at] of [...f.burnAt]) {
        if (tick - at > BURN_TICKS) {
          f.burnAt.delete(k);
          f.charred.add(k);
          continue;
        }
        if (rng() >= SPREAD_P) continue;
        const [c, r] = k.split(',').map(Number);
        const dc = Math.floor(rng() * 3) - 1;
        const dr = Math.floor(rng() * 3) - 1;
        const nk = `${c + dc},${r + dr}`;
        if ((dc || dr) && !allBurning.has(nk) && flammable(c + dc, r + dr, doorCells)) {
          f.burnAt.set(nk, tick);
          allBurning.add(nk);
        }
      }
      const h = hazards.find((x) => x.id === f.id);
      if (h) refreshHazard(h, f);
    }
    // Losses: anyone standing on (or stepping into) a burning cell.
    const burning = new Set(fires.flatMap((f) => [...f.burnAt.keys()]));
    for (const a of actors) {
      if (a.lost || a.checkedIn) continue;
      const w = walkers.get(a.id);
      const into = w && w.path[0] && w.progress > 0.5 ? key(w.path[0]) : null;
      if (burning.has(key(a)) || (into && burning.has(into))) {
        a.lost = true;
        a.lostAtSimTime = simTime();
        a.status = 'lost';
        a.task = null;
        a.escort = null;
        walkers.delete(a.id);
        engineRow(`${NAMES[a.id]} was lost to the fire`, a.id);
      }
    }
    // Movement
    for (const [id, w] of walkers) {
      const a = A(id);
      if (!w.path.length) {
        walkers.delete(id);
        a.anim = 'idle';
        a.status = a.checkedIn ? 'checked_in' : 'waiting';
        a.task = null;
        w.onDone?.();
        continue;
      }
      if (doorTrouble && stuckDoor(id, w)) continue;
      const next = w.path[0];
      if (burning.has(key(next))) {
        // FIXTURE: stop at the fire's edge and re-route
        walkers.delete(id);
        a.anim = 'idle';
        later(0.5, () => walk(id, w.goal, w.dest, w.onDone, w.rowRef));
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
      a.zone = map.zone[idx(a.col, a.row)];
      if (a.task) a.task.tilesRemaining = w.path.length;
    }
    maybeEnd();
  }

  function maybeEnd(): void {
    if (ended || phase === 'idle') return;
    const alive = actors.filter((a) => !a.lost);
    let status: EpisodeResult['outcome']['status'] | null = null;
    if (!alive.length) status = 'failed';
    else if (alive.every((a) => a.checkedIn)) {
      if (!A(WARDEN_ID).lost) decision(WARDEN_ID, 'verify_roster', {}, `${alive.length}/${actors.length} checked in${actors.length - alive.length ? `, ${actors.length - alive.length} lost` : ''} — verified.`);
      status = alive.length === actors.length ? 'success' : 'partial';
    }
    if (!status) return;
    phase = 'ended';
    const lost = actors.filter((a) => a.lost).map((a) => NAMES[a.id]);
    const reason =
      status === 'success'
        ? 'FIXTURE: everyone reached the assembly point, checked in, and the warden verified the roster.'
        : status === 'partial'
          ? `FIXTURE: survivors are accounted for; lost to the fire: ${lost.join(', ')}.`
          : 'FIXTURE: nobody made it out.';
    const lessons: DebriefLesson[] = [
      {
        id: 'alarm',
        title: 'Raise the alarm',
        text: alarm.active
          ? `FIXTURE text: ${NAMES[witness]} pulled ${places.stationName(alarm.stationId)} on the way out, ${alarm.atSimTime !== undefined && firstSight !== null ? `${(alarm.atSimTime - firstSight).toFixed(1)} s` : ''} after seeing the fire; the siren reached the people in other rooms, who could not hear the shout.`
          : 'FIXTURE text: nobody reached a pull station, so the building was never alerted — people who could not see the fire kept working.',
        ruleIds: ['ALARM-SYSTEM', 'EAP-REPORT'],
        sources: [{ label: '29 CFR 1910.165 — Employee alarm systems', url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.165' }],
      },
      lost.length
        ? {
            id: 'losses',
            title: 'Fire spreads — move early',
            text: `FIXTURE text: the spreading fire reached ${lost.join(', ')} before they were out — in a spreading fire, minutes matter.`,
            ruleIds: ['EAP-ROUTES'],
            sources: [{ label: '29 CFR 1910.38(c)(2)', url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.38' }],
          }
        : {
            id: 'routes',
            title: 'Updated route information',
            text: doorTrouble ? 'FIXTURE text: a sliding door lost power on the route; the team reported it and re-routed.' : 'FIXTURE text: everyone used routes away from the known fire.',
            ruleIds: ['EXIT-CLEAR'],
            sources: [{ label: '29 CFR 1910.37(a)(3)', url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.37' }],
          },
      {
        id: 'accountability',
        title: 'Account for everyone',
        text: 'FIXTURE text: the outcome is declared only from physical check-ins and the warden’s roster check.',
        ruleIds: ['EAP-ACCOUNT'],
        sources: [{ label: '29 CFR 1910.38(c)(4)', url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.38' }],
      },
    ];
    const result: EpisodeResult = {
      episodeId: EP,
      caseId: 'demo-hero',
      outcome: { status, reason, simTime: simTime() },
      metrics: {
        decisions,
        toolCalls: decisions,
        validCalls: decisions,
        invalidCalls: 0,
        invalidByCode: {},
        malformed: 0,
        providerErrors: 0,
        recoveries: doorTrouble ? 1 : 0,
        repeatedInvalid: 0,
        simTimeToComplete: simTime(),
        simTime: simTime(),
        wallTimeMs: simTime() * 1000,
        latencyMsP50: 620,
        latencyMsP95: 840,
        promptTokens: 0,
        completionTokens: 0,
        procedural: {
          hazardReported: alarm.active,
          reportLatencySimSec: alarm.atSimTime !== undefined && firstSight !== null ? alarm.atSimTime - firstSight : null,
          assistanceRequired: false,
          assistanceFulfilled: A(PERSON).checkedIn,
          assistWithoutConsentAttempts: 0,
          checkedIn: actors.filter((a) => a.checkedIn).length,
          rosterVerified: !A(WARDEN_ID).lost,
          prematureVerifyAttempts: 0,
          knownHazardMoveAttempts: 0,
          routeInterruptions: doorTrouble ? 1 : 0,
          replannedAfterInterruption: doorTrouble,
          alarmRaised: alarm.active,
          alarmLatencySimSec: alarm.atSimTime !== undefined && firstSight !== null ? alarm.atSimTime - firstSight : null,
          escaped: actors.filter((a) => a.checkedIn && !a.lost).length,
          lost: lost.length,
          alarmBy: alarm.active ? 'instinct' : null,
          instinctFlees: 1,
        },
      },
      debrief: lessons,
      score: { reward: status === 'success' ? 1 : status === 'failed' ? -1 : 0, success: status === 'success', checks: {} },
    };
    ended = result;
    engineRow(status === 'success' ? '✓ Everyone made it out' : status === 'partial' ? `Partial — ${alive.length} of ${actors.length} escaped` : 'Nobody made it out');
    emit({ type: 'episode_end', episodeId: EP, result });
  }

  // Ambient life before the incident (authored lines — labelled ambient)
  ACTOR_IDS.forEach((id, i) => later(2.5 + i * 3, () => phase === 'idle' && say(id, ACTOR_PROFILES[id].ambient[0], 'ambient')));
}
