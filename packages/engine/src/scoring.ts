// Metrics, reward and the deterministic debrief, computed from the episode's logs.
import { ACTOR_IDS, ACTOR_PROFILES, ASSISTANCE, type ActorId, type DebriefLesson, type EpisodeMetrics, type EpisodeOutcome, type EpisodeResult, type WorldEvent, type ZoneId } from '@escape/contracts';
import { canonicalJson } from './hash.js';
import { ruleSources } from './knowledge.js';
import { anyStationName, atPlace, doorName, joinNames, stationName } from './places.js';

export interface ActionLogEntry {
  decision: string;
  decisionIndex: number;
  actor?: ActorId;
  tool?: string;
  args?: Record<string, unknown>;
  ok: boolean;
  started: boolean;
  summary: string;
  errorCode?: string;
  hint?: string;
  simTime: number;
  note?: string;
  evidenceIds: string[];
  topic?: string;
}

export interface Interruption {
  actor: ActorId;
  partner?: ActorId;
  decisionIndex: number;
  simTime: number;
  evidenceId: string | null;
  zone: ZoneId | null;
  hazardKind: 'fire' | 'electrical';
  component?: string;
}

export interface ScoringInput {
  episodeId: string;
  caseId: string;
  outcome: EpisodeOutcome;
  actionLog: ActionLogEntry[];
  events: readonly WorldEvent[];
  interruptions: Interruption[];
  decisionsUsed: number;
  decisionMeta: { latencyMs?: number; promptTokens?: number; completionTokens?: number }[];
  counters: { knownHazardMoveAttempts: number; prematureVerifyAttempts: number; assistWithoutConsentAttempts: number; scheduledFailures: number };
  roster: { checkedIn: ActorId[]; outstanding: ActorId[]; lost: ActorId[]; required: boolean; fulfilled: boolean };
  rosterVerified: boolean;
  simTime: number;
  wallTimeMs: number;
  danielPreference: 'buddy' | 'independent';
  lost: { actor: ActorId; simTime: number; alertedAt: number | null }[];
  /** via: 'tool' = the planner (pull_alarm, or arriving on an order to go to the alarm); 'instinct' = on the way past. */
  alarm: { active: boolean; at: number | null; by: ActorId | null; via: 'tool' | 'instinct' | null; stationId: string | null };
  /** Times people backed away from nearby fire by instinct. */
  instinctFlees: number;
}

const name = (id: string) => ACTOR_PROFILES[id as ActorId]?.name ?? id;

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return Math.round(s[i]);
}

export function computeResult(input: ScoringInput): EpisodeResult {
  const tools = input.actionLog.filter((l) => l.tool);
  const notes = input.actionLog.filter((l) => l.note);
  const invalid = tools.filter((l) => !l.ok);
  const invalidByCode: Record<string, number> = {};
  for (const l of invalid) invalidByCode[l.errorCode!] = (invalidByCode[l.errorCode!] ?? 0) + 1;

  // Repeated identical rejected calls
  const seen = new Set<string>();
  let repeatedInvalid = 0;
  for (const l of invalid) {
    const key = canonicalJson([l.tool, l.args]);
    if (seen.has(key)) repeatedInvalid++;
    seen.add(key);
  }

  // Recoveries: a failure (rejected call or interruption) followed by a successful call by the same actor within 3 decisions.
  const failures: { actor: ActorId; partner?: ActorId; at: number }[] = [
    ...invalid.filter((l) => l.actor).map((l) => ({ actor: l.actor!, at: l.decisionIndex })),
    ...input.interruptions.map((i) => ({ actor: i.actor, partner: i.partner, at: i.decisionIndex })),
  ];
  let recoveries = 0;
  for (const f of failures) {
    const ok = tools.some((l) => l.ok && (l.actor === f.actor || (f.partner && l.actor === f.partner)) && l.decisionIndex > f.at && l.decisionIndex <= f.at + 3);
    if (ok) recoveries++;
  }

  // Procedural checks
  const firstFire = input.events.find((e) => e.type === 'observation' && e.data.kind === 'fire');
  const fireEvidence = new Set(input.events.filter((e) => e.type === 'observation' && e.data.kind === 'fire').flatMap((e) => e.evidenceIds ?? []));
  const report = tools.find((l) => l.ok && l.tool === 'notify' && (l.topic === 'fire' || l.topic === 'evacuate') && l.evidenceIds.some((id) => fireEvidence.has(id)));
  // The first warning to others: an evidence-citing notify or the building alarm, whichever came first.
  const alarmAt = input.alarm.active ? input.alarm.at : null;
  const firstWarningAt = [report?.simTime, alarmAt ?? undefined].filter((x): x is number => typeof x === 'number').sort((a, b) => a - b)[0];
  const reportLatency = firstWarningAt !== undefined && firstFire ? Math.round((firstWarningAt - firstFire.simTime) * 10) / 10 : null;
  const alarmLatency = alarmAt !== null && firstFire ? Math.round((alarmAt - firstFire.simTime) * 10) / 10 : null;
  const replanned = input.interruptions.some((i) =>
    tools.some((l) => l.ok && l.started && l.tool === 'move' && (l.actor === i.actor || l.actor === i.partner) && l.decisionIndex > i.decisionIndex),
  );

  const latencies = input.decisionMeta.map((m) => m.latencyMs).filter((x): x is number => typeof x === 'number');
  const success = input.outcome.status === 'success';
  const metrics: EpisodeMetrics = {
    decisions: input.decisionsUsed,
    toolCalls: tools.length,
    validCalls: tools.length - invalid.length,
    invalidCalls: invalid.length,
    invalidByCode,
    malformed: notes.filter((n) => n.note === 'malformed' || n.note === 'no_call').length,
    providerErrors: notes.filter((n) => n.note === 'provider_error').length,
    recoveries,
    repeatedInvalid,
    simTimeToComplete: success ? input.outcome.simTime : null,
    simTime: input.simTime,
    wallTimeMs: input.wallTimeMs,
    latencyMsP50: percentile(latencies, 50),
    latencyMsP95: percentile(latencies, 95),
    promptTokens: input.decisionMeta.reduce((s, m) => s + (m.promptTokens ?? 0), 0),
    completionTokens: input.decisionMeta.reduce((s, m) => s + (m.completionTokens ?? 0), 0),
    procedural: {
      hazardReported: !!report || input.alarm.active,
      reportLatencySimSec: reportLatency,
      assistanceRequired: input.roster.required,
      assistanceFulfilled: input.roster.fulfilled,
      assistWithoutConsentAttempts: input.counters.assistWithoutConsentAttempts,
      checkedIn: input.roster.checkedIn.length,
      rosterVerified: input.rosterVerified,
      prematureVerifyAttempts: input.counters.prematureVerifyAttempts,
      knownHazardMoveAttempts: input.counters.knownHazardMoveAttempts,
      routeInterruptions: input.interruptions.length,
      replannedAfterInterruption: replanned,
      alarmRaised: input.alarm.active,
      alarmLatencySimSec: alarmLatency,
      alarmBy: input.alarm.active ? (input.alarm.via === 'instinct' ? 'instinct' : 'planner') : null,
      instinctFlees: input.instinctFlees,
      escaped: input.roster.checkedIn.length,
      lost: input.lost.length,
    },
  };

  // Buddy assistance is good practice but no longer gates success (gameplay v2).
  const proceduresOk = metrics.procedural.hazardReported && input.rosterVerified;
  const critical = repeatedInvalid >= 3 || metrics.procedural.knownHazardMoveAttempts >= 2;
  const failed = input.outcome.status === 'failed';
  const reward = critical || failed ? -1 : success && proceduresOk ? 1 : 0;

  return {
    episodeId: input.episodeId,
    caseId: input.caseId,
    outcome: input.outcome,
    metrics,
    debrief: buildDebrief(input, metrics, report, firstFire),
    score: {
      reward,
      success,
      checks: {
        hazardReported: metrics.procedural.hazardReported,
        alarmRaised: input.alarm.active,
        assistanceOk: !input.roster.required || input.roster.fulfilled,
        rosterVerified: input.rosterVerified,
        checkedIn: input.roster.checkedIn.length,
        escaped: input.roster.checkedIn.length,
        lost: input.lost.length,
        criticalViolation: critical,
        recoveries,
        invalidCalls: invalid.length,
        scheduledPlacementFailures: input.counters.scheduledFailures,
      },
    },
  };
}

function lesson(id: DebriefLesson['id'], title: string, text: string, ruleIds: string[]): DebriefLesson {
  return { id, title, text, ruleIds, sources: ruleSources(ruleIds) };
}

function buildDebrief(input: ScoringInput, m: EpisodeMetrics, report: ActionLogEntry | undefined, firstFire: WorldEvent | undefined): DebriefLesson[] {
  const candidates: { score: number; l: DebriefLesson }[] = [];
  const fmt = (t: number) => `${t.toFixed(1)} s`;

  if (input.lost.length) {
    const parts = input.lost.map((x) =>
      x.alertedAt === null
        ? `${name(x.actor)} at ${fmt(x.simTime)}, before anyone had alerted them`
        : `${name(x.actor)} at ${fmt(x.simTime)}, ${(x.simTime - x.alertedAt).toFixed(1)} s after being alerted`,
    );
    candidates.push({
      score: 9,
      l: lesson(
        'losses',
        input.outcome.status === 'failed' ? 'Nobody got out' : 'Lost to the spreading fire',
        `The fire reached ${parts.join('; ')}. Fire spreads every second and, given time, burns through walls into the next room: early warning, leaving at once and keeping away from known fire are what buy time.`,
        ['EAP-REPORT', 'EAP-ROUTES'],
      ),
    });
  }

  if (input.outcome.status === 'unresolved') {
    candidates.push({
      score: 8,
      l: lesson(
        'unresolved',
        'No safe way out — an unresolved outcome',
        `${input.outcome.reason} The exercise reports this honestly instead of inventing a route. Real plans keep at least one exit route clear and assign alternatives in advance.`,
        ['EXIT-CLEAR', 'EAP-ROUTES'],
      ),
    });
  }

  if (firstFire) {
    candidates.push(
      input.alarm.active
        ? {
            score: 6,
            l: lesson(
              'alarm',
              'Raising the alarm',
              `${input.alarm.by ? name(input.alarm.by) : 'Someone'} pulled ${stationName(input.alarm.stationId)}${input.alarm.via === 'instinct' ? ' on the way past — an instinct, not an order' : ''}${
                m.procedural.alarmLatencySimSec !== null ? `, ${m.procedural.alarmLatencySimSec.toFixed(1)} s after the fire was first seen` : ''
              }. The siren alerts everyone at once — but it does not say where the fire is, so a spoken report still helps people choose a safe route.`,
              ['EAP-REPORT', 'ALARM-SYSTEM'],
            ),
          }
        : {
            score: 4.5,
            l: lesson(
              'alarm',
              'The alarm was never pulled',
              `Nobody used ${anyStationName().replace(/fire alarm$/, 'pull station')}; people were warned only by word of mouth${report ? '' : ' (or not at all)'}, and a voice carries only within a room. The pull station alerts the whole building at once, including people in other rooms who cannot see or hear about the fire.`,
              ['EAP-REPORT', 'ALARM-SYSTEM'],
            ),
          },
    );
  }

  if (input.interruptions.length) {
    const i = input.interruptions[0];
    const who = i.partner ? `${name(i.actor)} and ${name(i.partner)}` : name(i.actor);
    const door = i.hazardKind === 'electrical';
    const what = door ? `${doorName(i.component)} jammed shut by a power failure` : `fire across their route ${atPlace(i.zone)}`;
    candidates.push({
      score: 6.5,
      l: lesson(
        'routes',
        'Updated route information',
        `${who} found ${what} at ${fmt(i.simTime)}. ${
          m.procedural.replannedAfterInterruption ? 'The team re-planned around it using what they now knew' : 'The team did not re-plan after the obstruction'
        }. Exit routes must stay unobstructed; when one is not, current observations should replace the usual route.${
          door ? ' The exit doors themselves are not electric: exit doors must open from the inside without power, keys or special knowledge.' : ''
        }`,
        door ? ['EXIT-CLEAR', 'EXIT-OPENABLE', 'EAP-ROUTES'] : ['EXIT-CLEAR', 'EAP-ROUTES', 'GUIDE-LAYOUT-BUDDY'],
      ),
    });
  } else {
    candidates.push({
      score: 2,
      l: lesson('routes', 'Planned routes', 'Everyone who evacuated did so without needing to re-route. The plan assigns primary and alternate routes so people can adapt if one is unavailable.', ['EAP-ROUTES']),
    });
  }

  if (firstFire) {
    const seer = firstFire.actor ? name(firstFire.actor) : 'Someone';
    const shouted = [
      ...new Set(input.events.filter((e) => e.type === 'instinct' && e.data.kind === 'shout' && (e.data.heard_by as unknown[] | undefined)?.length && e.actor).map((e) => e.actor!)),
    ];
    candidates.push({
      score: report ? 5 : 5.5,
      l: lesson(
        'reporting',
        'Reporting the hazard',
        report
          ? `${seer} saw the fire${firstFire.data.via === 'smoke' ? ' (smoke)' : ''} at ${fmt(firstFire.simTime)} and ${report.actor ? name(report.actor) : 'someone'} reported it with evidence ${(report.simTime - firstFire.simTime).toFixed(1)} s later. Prompt, evidence-based reporting tells others where the danger is.`
          : shouted.length
            ? `${seer} saw the fire at ${fmt(firstFire.simTime)}${
                shouted.length === 1 && firstFire.actor === shouted[0] ? ' and shouted' : `; ${joinNames(shouted.map(name))} shouted`
              } "Fire!" to the people in the same room, but nobody told the other rooms where it was. Others only learn where a hazard is if someone reports it.`
            : `${seer} saw the fire at ${fmt(firstFire.simTime)}, but nobody described it to the others with evidence. Others only learn where a hazard is if someone reports it.`,
        ['EAP-REPORT'],
      ),
    });
  }

  if (input.roster.required) {
    candidates.push({
      score: 3,
      l: lesson(
        'assistance',
        `${name(ASSISTANCE.person)}'s buddy arrangement`,
        input.roster.fulfilled
          ? `${name(ASSISTANCE.person)} asked for his agreed buddy, ${name(ASSISTANCE.buddy)} came to him, and they travelled together on wheelchair-accessible tiles to the assembly point. Consent came first; nobody carried him.`
          : `${name(ASSISTANCE.person)} had asked for a buddy in advance, but the escort was not completed${m.procedural.assistWithoutConsentAttempts ? ' (assistance was attempted before he had asked)' : ''}. It is optional in this exercise, but pre-arranged, consent-based assistance is good practice.`,
        ['EAP-ASSIST', 'GUIDE-LAYOUT-BUDDY'],
      ),
    });
  } else if (input.danielPreference === 'independent') {
    candidates.push({
      score: 2.5,
      l: lesson(
        'assistance',
        `Respecting ${name(ASSISTANCE.person)}'s preference`,
        `${name(ASSISTANCE.person)} preferred to evacuate independently${m.procedural.assistWithoutConsentAttempts ? `; ${m.procedural.assistWithoutConsentAttempts} unrequested assistance attempt(s) were refused by the rules` : ''}. Assistance arrangements are individual and consent-based.`,
        ['EAP-ASSIST'],
      ),
    });
  }

  const survivors = ACTOR_IDS.length - input.lost.length;
  candidates.push({
    score: 3.5,
    l: lesson(
      'accountability',
      'Accounting for everyone',
      input.rosterVerified
        ? `${input.roster.checkedIn.length}/${survivors} survivors checked in at the assembly point and the warden verified the roster at ${fmt(input.outcome.simTime)}${input.lost.length ? `, reporting ${input.lost.map((x) => name(x.actor)).join(' and ')} as lost` : ''}${
            m.procedural.prematureVerifyAttempts ? ` (after ${m.procedural.prematureVerifyAttempts} early check(s) that correctly reported people outstanding)` : ''
          }. Only a physical check-in plus the roster check confirms who is out.`
        : `${input.roster.checkedIn.length}/${survivors} survivors checked in; the roster was not verified. Saying "everyone is out" is not accountability — a check-in and roster check are.`,
      ['EAP-ACCOUNT'],
    ),
  });

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((c) => c.l);
}
