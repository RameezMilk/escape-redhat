// Metrics, reward and the deterministic debrief, computed from the episode's logs.
import { ACTOR_PROFILES, type ActorId, type DebriefLesson, type EpisodeMetrics, type EpisodeOutcome, type EpisodeResult, type WorldEvent } from '@escape/contracts';
import { canonicalJson } from './hash.js';
import { ruleSources } from './knowledge.js';

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
  zone: string | null;
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
  roster: { checkedIn: ActorId[]; outstanding: ActorId[]; required: boolean; fulfilled: boolean };
  rosterVerified: boolean;
  simTime: number;
  wallTimeMs: number;
  danielPreference: 'buddy' | 'independent';
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
  const reportLatency = report && firstFire ? Math.round((report.simTime - firstFire.simTime) * 10) / 10 : null;
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
      hazardReported: !!report,
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
    },
  };

  const proceduresOk = metrics.procedural.hazardReported && (!input.roster.required || input.roster.fulfilled) && input.rosterVerified;
  const critical = repeatedInvalid >= 3 || metrics.procedural.knownHazardMoveAttempts >= 2;
  const reward = critical ? -1 : success && proceduresOk ? 1 : 0;

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
        assistanceOk: !input.roster.required || input.roster.fulfilled,
        rosterVerified: input.rosterVerified,
        checkedIn: input.roster.checkedIn.length,
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

  if (input.outcome.status === 'unresolved') {
    candidates.push({
      score: 10,
      l: lesson(
        'unresolved',
        'No safe way out — an unresolved outcome',
        `${input.outcome.reason} The exercise reports this honestly instead of inventing a route. Real plans keep at least one exit route clear and assign alternatives in advance.`,
        ['EXIT-CLEAR', 'EAP-ROUTES'],
      ),
    });
  }

  if (input.interruptions.length) {
    const i = input.interruptions[0];
    const who = i.partner ? `${name(i.actor)} and ${name(i.partner)}` : name(i.actor);
    candidates.push({
      score: 6,
      l: lesson(
        'routes',
        'Updated route information',
        `${who} found the route through ${i.zone ?? 'the corridor'} obstructed${i.evidenceId ? ` (${i.evidenceId})` : ''} at ${i.simTime.toFixed(1)} s. ${
          m.procedural.replannedAfterInterruption ? 'The team re-planned around it using what they now knew' : 'The team did not re-plan after the obstruction'
        }. Exit routes must stay unobstructed; when one is not, current observations should replace the usual route.`,
        ['EXIT-CLEAR', 'EAP-ROUTES', 'GUIDE-LAYOUT-BUDDY'],
      ),
    });
  } else {
    candidates.push({
      score: 2,
      l: lesson('routes', 'Planned routes', 'Everyone evacuated without needing to re-route. The plan assigns primary and alternate routes so people can adapt if one is unavailable.', ['EAP-ROUTES']),
    });
  }

  if (firstFire) {
    const seer = firstFire.actor ? name(firstFire.actor) : 'Someone';
    candidates.push({
      score: 5,
      l: lesson(
        'reporting',
        'Reporting the hazard',
        report
          ? `${seer} saw the fire${firstFire.data.via === 'smoke' ? ' (smoke)' : ''} at ${firstFire.simTime.toFixed(1)} s and ${report.actor ? name(report.actor) : 'someone'} raised the alarm ${m.procedural.reportLatencySimSec?.toFixed(1)} s later, citing evidence. Prompt, evidence-based reporting alerts others who cannot see the hazard.`
          : `${seer} saw the fire at ${firstFire.simTime.toFixed(1)} s, but nobody raised the alarm with evidence. Others only learn about hazards they cannot see if someone reports them.`,
        ['EAP-REPORT'],
      ),
    });
  }

  if (input.roster.required) {
    candidates.push({
      score: 4,
      l: lesson(
        'assistance',
        "Daniel's buddy arrangement",
        input.roster.fulfilled
          ? 'Daniel asked for his agreed buddy, Alex came to him, and they travelled together on wheelchair-accessible tiles to the assembly point. Consent came first; nobody carried him.'
          : `Daniel had asked for a buddy in advance, but the escort was not completed${m.procedural.assistWithoutConsentAttempts ? ' (assistance was attempted before he had asked)' : ''}. Pre-arranged, consent-based assistance is part of the plan.`,
        ['EAP-ASSIST', 'GUIDE-LAYOUT-BUDDY'],
      ),
    });
  } else if (input.danielPreference === 'independent') {
    candidates.push({
      score: 3,
      l: lesson(
        'assistance',
        "Respecting Daniel's preference",
        `Daniel preferred to evacuate independently${m.procedural.assistWithoutConsentAttempts ? `; ${m.procedural.assistWithoutConsentAttempts} unrequested assistance attempt(s) were refused by the rules` : ''}. Assistance arrangements are individual and consent-based.`,
        ['EAP-ASSIST'],
      ),
    });
  }

  candidates.push({
    score: 3.5,
    l: lesson(
      'accountability',
      'Accounting for everyone',
      input.rosterVerified
        ? `${input.roster.checkedIn.length}/3 checked in at the assembly point and the warden verified the roster at ${input.outcome.simTime.toFixed(1)} s${m.procedural.prematureVerifyAttempts ? ` (after ${m.procedural.prematureVerifyAttempts} early check(s) that correctly reported people outstanding)` : ''}. Only a physical check-in plus the roster check confirms everyone is out.`
        : `${input.roster.checkedIn.length}/3 checked in; the roster was not verified. Saying "everyone is out" is not accountability — a check-in and roster check are.`,
      ['EAP-ACCOUNT'],
    ),
  });

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((c) => c.l);
}
