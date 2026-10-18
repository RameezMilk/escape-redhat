// Headless benchmark over the scenario dataset (lockstep clock: the sim is frozen while the planner thinks,
// so simulated time measures plan quality; wall-clock and model latency are reported separately).
//
//   npm run bench -- --split dev --provider env --harness v2 --concurrency 4 --out results/dev-v2
//   npm run bench -- --split test --provider scripted --limit 4
//
// Flags: --split dev|test|all (dev) · --provider env|scripted (env) · --harness v1|v2 (env PLANNER_HARNESS or v2)
//        --concurrency N (1) · --limit K · --cases id1,id2 · --max-decisions N · --thinking on|off · --out DIR
//        --mode central|agents (central; agents = each person decides for themselves, reasoning on, no engine instincts)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTOR_IDS, ACTOR_PROFILES, ASSISTANCE, type EpisodeResult, type ScenarioCase, type TraceRow } from '@escape/contracts';
import { createProviderFromEnv, runEpisodeHeadless } from '../../server/src/headless.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');

export interface BenchRow {
  caseId: string;
  family: string;
  solvableLabel: boolean;
  /** Trapped-by-design case (labels.expectLosses): success would be a false claim. */
  expectLosses: boolean;
  outcome: string;
  outcomeReason: string;
  /** success on a normal case, or any non-success outcome on a trapped one */
  labelConsistent: boolean;
  reward: number;
  decisions: number;
  toolCalls: number;
  invalidCalls: number;
  invalidByCode: Record<string, number>;
  malformed: number;
  providerErrors: number;
  recoveries: number;
  repeatedInvalid: number;
  hazardReported: boolean;
  assistanceRequired: boolean;
  assistanceFulfilled: boolean;
  rosterVerified: boolean;
  routeInterruptions: number;
  replannedAfterInterruption: boolean;
  alarmRaised: boolean;
  alarmLatencySimSec: number | null;
  /** Survivors who reached assembly and checked in. */
  escaped: number;
  lost: number;
  simTime: number;
  simTimeToComplete: number | null;
  wallTimeMs: number;
  latencyMsP50: number | null;
  latencyMsP95: number | null;
  promptTokens: number;
  completionTokens: number;
  error?: string;
}

export interface BenchSummary {
  meta: {
    dataset: string;
    split: string;
    cases: number;
    provider: { id: string; label: string; model: string; endpointKind: string; thinking: boolean; thinkingBudget?: number; baseUrl?: string };
    harness: string;
    mode: 'central' | 'agents';
    maxDecisions: number | null;
    concurrency: number;
    clock: 'lockstep';
    startedAt: string;
    finishedAt: string;
    note: string;
  };
  aggregates: Record<string, unknown>;
  rows: BenchRow[];
}

function parseArgs(argv: string[]) {
  const a: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    a[k.slice(2)] = v;
  }
  return a;
}

export function loadCases(split: string): ScenarioCase[] {
  const splits = split === 'all' ? ['dev', 'test'] : [split];
  const out: ScenarioCase[] = [];
  for (const s of splits) {
    const p = join(root, 'data/scenarios', `cases.${s}.jsonl`);
    for (const line of readFileSync(p, 'utf8').split('\n')) if (line.trim()) out.push(JSON.parse(line) as ScenarioCase);
  }
  return out;
}

const percentile = (xs: number[], p: number): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : '—');
const fmt = (x: number | null | undefined, digits = 1) => (x === null || x === undefined ? '—' : x.toFixed(digits));

function rowFrom(c: ScenarioCase, result: EpisodeResult): BenchRow {
  const m = result.metrics;
  const pr = m.procedural;
  const success = result.outcome.status === 'success';
  const expectLosses = c.labels.expectLosses ?? false;
  return {
    caseId: c.caseId,
    family: c.family,
    solvableLabel: c.labels.solvable,
    expectLosses,
    outcome: result.outcome.status,
    outcomeReason: result.outcome.reason,
    labelConsistent: expectLosses ? !success : success,
    reward: result.score.reward,
    decisions: m.decisions,
    toolCalls: m.toolCalls,
    invalidCalls: m.invalidCalls,
    invalidByCode: m.invalidByCode,
    malformed: m.malformed,
    providerErrors: m.providerErrors,
    recoveries: m.recoveries,
    repeatedInvalid: m.repeatedInvalid,
    hazardReported: m.procedural.hazardReported,
    assistanceRequired: m.procedural.assistanceRequired,
    assistanceFulfilled: m.procedural.assistanceFulfilled,
    rosterVerified: m.procedural.rosterVerified,
    routeInterruptions: m.procedural.routeInterruptions,
    replannedAfterInterruption: m.procedural.replannedAfterInterruption,
    alarmRaised: pr.alarmRaised ?? false,
    alarmLatencySimSec: pr.alarmLatencySimSec ?? null,
    escaped: pr.escaped ?? pr.checkedIn ?? 0,
    lost: pr.lost ?? 0,
    simTime: m.simTime,
    simTimeToComplete: m.simTimeToComplete,
    wallTimeMs: m.wallTimeMs,
    latencyMsP50: m.latencyMsP50,
    latencyMsP95: m.latencyMsP95,
    promptTokens: m.promptTokens,
    completionTokens: m.completionTokens,
  };
}

function decisionLatencies(trace: TraceRow[]): number[] {
  const byId = new Map<string, TraceRow>();
  for (const r of trace) if (r.kind === 'decision') byId.set(r.id, r);
  return [...byId.values()].map((r) => r.latencyMs).filter((x): x is number => typeof x === 'number');
}

const OUTCOMES = ['success', 'partial', 'failed', 'incomplete', 'unresolved', 'aborted', 'error'] as const;

export function aggregate(rows: BenchRow[], latencies: number[], wallMs: number) {
  const ok = rows.filter((r) => !r.error);
  const byFamily: Record<string, { n: number; success: number; labelConsistent: number; escaped: number; lost: number }> = {};
  for (const r of ok) {
    const f = (byFamily[r.family] ??= { n: 0, success: 0, labelConsistent: 0, escaped: 0, lost: 0 });
    f.n++;
    if (r.outcome === 'success') f.success++;
    if (r.labelConsistent) f.labelConsistent++;
    f.escaped += r.escaped;
    f.lost += r.lost;
  }
  const outcomeMix = Object.fromEntries(OUTCOMES.map((o) => [o, rows.filter((r) => r.outcome === o).length]));
  const normal = ok.filter((r) => !r.expectLosses);
  const trapped = ok.filter((r) => r.expectLosses);
  const toolCalls = ok.reduce((a, r) => a + r.toolCalls, 0);
  const invalid = ok.reduce((a, r) => a + r.invalidCalls, 0);
  const interrupted = ok.filter((r) => r.routeInterruptions > 0);
  const alarmLat = ok.map((r) => r.alarmLatencySimSec).filter((x): x is number => typeof x === 'number');
  return {
    episodes: rows.length,
    errored: rows.length - ok.length,
    outcomeMix,
    successOnNormal: `${normal.filter((r) => r.outcome === 'success').length}/${normal.length}`,
    falseSuccessOnTrapped: trapped.filter((r) => r.outcome === 'success').length,
    trappedCases: trapped.length,
    labelConsistent: `${ok.filter((r) => r.labelConsistent).length}/${ok.length}`,
    peopleEscaped: `${ok.reduce((a, r) => a + r.escaped, 0)}/${ok.length * ACTOR_IDS.length}`,
    peopleLost: ok.reduce((a, r) => a + r.lost, 0),
    peopleLostOnNormal: normal.reduce((a, r) => a + r.lost, 0),
    peopleLostOnTrapped: trapped.reduce((a, r) => a + r.lost, 0),
    meanReward: mean(ok.map((r) => r.reward)),
    byFamily,
    toolCalls,
    invalidCalls: invalid,
    invalidCallRate: toolCalls ? invalid / toolCalls : null,
    malformed: ok.reduce((a, r) => a + r.malformed, 0),
    providerErrors: ok.reduce((a, r) => a + r.providerErrors, 0),
    recoveries: ok.reduce((a, r) => a + r.recoveries, 0),
    repeatedInvalid: ok.reduce((a, r) => a + r.repeatedInvalid, 0),
    replannedAfterInterruption: `${interrupted.filter((r) => r.replannedAfterInterruption).length}/${interrupted.length}`,
    hazardReported: `${ok.filter((r) => r.hazardReported).length}/${ok.length}`,
    alarmRaised: `${ok.filter((r) => r.alarmRaised).length}/${ok.length}`,
    meanAlarmLatencySimSec: mean(alarmLat),
    assistanceFulfilledWhenRequested: `${ok.filter((r) => r.assistanceRequired && r.assistanceFulfilled).length}/${ok.filter((r) => r.assistanceRequired).length}`,
    rosterVerified: `${ok.filter((r) => r.rosterVerified).length}/${ok.length}`,
    meanDecisions: mean(ok.map((r) => r.decisions)),
    meanSimTimeToCompleteSuccess: mean(ok.filter((r) => r.outcome === 'success' && r.simTimeToComplete !== null).map((r) => r.simTimeToComplete!)),
    decisionLatencyMsP50: percentile(latencies, 50),
    decisionLatencyMsP95: percentile(latencies, 95),
    decisionsMeasured: latencies.length,
    promptTokens: ok.reduce((a, r) => a + r.promptTokens, 0),
    completionTokens: ok.reduce((a, r) => a + r.completionTokens, 0),
    totalWallMs: wallMs,
    episodesPerMinute: wallMs ? (rows.length * 60000) / wallMs : null,
  };
}

export function renderMarkdown(s: BenchSummary): string {
  const a = s.aggregates as ReturnType<typeof aggregate>;
  const p = s.meta.provider;
  const lines: string[] = [];
  lines.push(`# Benchmark: ${s.meta.dataset} / ${s.meta.split}`);
  lines.push('');
  lines.push(`- Provider: **${p.label}** · model \`${p.model}\` · ${p.endpointKind}${p.endpointKind === 'scripted' ? ' (**scripted fixture, NOT a model**)' : ''} · thinking ${p.thinking ? `on${p.thinkingBudget ? ` (≤${p.thinkingBudget} tokens)` : ''}` : 'off'} · ${s.meta.mode === 'agents' ? 'each person decides for themselves (no engine instincts)' : 'one central planner'}`);
  lines.push(`- Harness: \`${s.meta.harness}\` · decision cap ${s.meta.maxDecisions ?? 'default'} · concurrency ${s.meta.concurrency} · clock ${s.meta.clock}`);
  lines.push(`- Run: ${s.meta.startedAt} → ${s.meta.finishedAt} · ${s.meta.cases} cases`);
  lines.push(`- ${s.meta.note}`);
  lines.push('');
  lines.push('## Aggregates');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---|');
  lines.push(`| Verified success (all ${ACTOR_IDS.length} alive, checked in, roster verified) on normal cases | ${a.successOnNormal} |`);
  lines.push(`| False success on trapped-by-design cases | ${a.falseSuccessOnTrapped}/${a.trappedCases} |`);
  lines.push(`| Outcome mix | ${Object.entries(a.outcomeMix).filter(([, n]) => n).map(([o, n]) => `${o} ${n}`).join(' · ')} |`);
  lines.push(`| Outcomes matching expectation (success on normal, non-success on trapped) | ${a.labelConsistent} |`);
  lines.push(`| People escaped and checked in | ${a.peopleEscaped} |`);
  lines.push(`| People lost — normal cases / trapped cases | ${a.peopleLostOnNormal} / ${a.peopleLostOnTrapped} |`);
  lines.push(`| Mean reward | ${fmt(a.meanReward, 2)} |`);
  lines.push(`| Tool calls / invalid (rate) | ${a.toolCalls} / ${a.invalidCalls} (${a.invalidCallRate === null ? '—' : (100 * a.invalidCallRate).toFixed(1) + '%'}) |`);
  lines.push(`| Malformed responses / provider errors | ${a.malformed} / ${a.providerErrors} |`);
  lines.push(`| Recoveries after an error | ${a.recoveries} |`);
  lines.push(`| Repeated identical invalid calls | ${a.repeatedInvalid} |`);
  lines.push(`| Re-planned after a route interruption | ${a.replannedAfterInterruption} |`);
  lines.push(`| Hazard reported (notify with evidence or alarm) | ${a.hazardReported} |`);
  lines.push(`| Fire alarm pulled · mean sim s after first sighting | ${a.alarmRaised} · ${fmt(a.meanAlarmLatencySimSec)} |`);
  lines.push(`| Buddy assistance completed when ${ACTOR_PROFILES[ASSISTANCE.person].name} asked | ${a.assistanceFulfilledWhenRequested} |`);
  lines.push(`| Roster verified | ${a.rosterVerified} |`);
  lines.push(`| Mean decisions / episode | ${fmt(a.meanDecisions)} |`);
  lines.push(`| Mean sim time to verified success (s) | ${fmt(a.meanSimTimeToCompleteSuccess)} |`);
  lines.push(`| Decision latency p50 / p95 (ms, n=${a.decisionsMeasured}) | ${fmt(a.decisionLatencyMsP50, 0)} / ${fmt(a.decisionLatencyMsP95, 0)} |`);
  lines.push(`| Tokens prompt / completion | ${a.promptTokens} / ${a.completionTokens} |`);
  lines.push(`| Wall time total (s) · episodes/min | ${(a.totalWallMs / 1000).toFixed(1)} · ${fmt(a.episodesPerMinute, 2)} |`);
  lines.push('');
  lines.push('| Family | n | success | as expected | escaped | lost |');
  lines.push('|---|---|---|---|---|---|');
  for (const [f, v] of Object.entries(a.byFamily)) lines.push(`| ${f} | ${v.n} | ${pct(v.success, v.n)} | ${pct(v.labelConsistent, v.n)} | ${v.escaped}/${v.n * ACTOR_IDS.length} | ${v.lost} |`);
  lines.push('');
  lines.push('## Cases');
  lines.push('');
  lines.push('| Case | Family | Trapped | Outcome | Escaped/lost | Alarm | Reward | Decisions | Invalid | Recov. | Sim s | Wall s | p50/p95 ms | Tokens in/out |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of s.rows) {
    if (r.error) {
      lines.push(`| ${r.caseId} | ${r.family} | ${r.expectLosses ? 'yes' : 'no'} | ERROR: ${r.error.slice(0, 60)} | | | | | | | | | | |`);
      continue;
    }
    lines.push(
      `| ${r.caseId} | ${r.family} | ${r.expectLosses ? 'yes' : 'no'} | ${r.outcome}${r.labelConsistent ? '' : ' ⚠'} | ${r.escaped}/${r.lost} | ${r.alarmRaised ? 'yes' : '—'} | ${r.reward} | ${r.decisions} | ${r.invalidCalls} | ${r.recoveries} | ${fmt(r.simTime)} | ${(r.wallTimeMs / 1000).toFixed(1)} | ${fmt(r.latencyMsP50, 0)}/${fmt(r.latencyMsP95, 0)} | ${r.promptTokens}/${r.completionTokens} |`,
    );
  }
  lines.push('');
  lines.push('⚠ = not the expected outcome (success on a normal case; anything but success on a trapped one). Fire spread is seeded but the planner samples at temperature > 0: report counts, not just rates.');
  return lines.join('\n') + '\n';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const split = args.split ?? 'dev';
  const providerMode = args.provider ?? 'env';
  const harness = (args.harness ?? process.env.PLANNER_HARNESS ?? 'v2') === 'v1' ? 'v1' : 'v2';
  const concurrency = Math.max(1, Number(args.concurrency ?? 1));
  const maxDecisions = args['max-decisions'] ? Number(args['max-decisions']) : undefined;

  let cases = loadCases(split);
  if (args.cases) {
    const want = new Set(args.cases.split(','));
    cases = cases.filter((c) => want.has(c.caseId));
  }
  if (args.limit) cases = cases.slice(0, Number(args.limit));
  if (!cases.length) throw new Error('no cases selected');

  const mode = args.mode === 'agents' ? 'agents' : 'central';
  const env: Record<string, string | undefined> = { ...process.env, PLANNER_HARNESS: harness, PLANNER_MODE: mode };
  if (providerMode === 'scripted') env.PLANNER_PROVIDER = 'scripted';
  if (args.thinking) env[mode === 'agents' ? 'PLANNER_AGENT_THINKING' : 'PLANNER_THINKING'] = args.thinking === 'on' ? 'true' : 'false';
  if (maxDecisions) env[mode === 'agents' ? 'PLANNER_AGENT_MAX_DECISIONS' : 'PLANNER_MAX_DECISIONS'] = String(maxDecisions);
  const provider = createProviderFromEnv(env);
  const info = provider.info();

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = resolve(root, args.out ?? join('results', `${stamp}-${split}-${info.endpointKind}-${harness}`));
  mkdirSync(join(outDir, 'runs'), { recursive: true });

  console.log(`[bench] ${cases.length} cases · split ${split} · ${info.label} (${info.model}, ${info.endpointKind}) · harness ${harness} · mode ${mode} · thinking ${info.thinking ? `on${info.thinkingBudget ? ` ≤${info.thinkingBudget} tokens` : ''}` : 'off'} · concurrency ${concurrency}`);
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const rows: BenchRow[] = new Array(cases.length);
  const latencies: number[] = [];
  let next = 0;

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= cases.length) return;
      const c = cases[i];
      try {
        const r = await runEpisodeHeadless({
          scenario: c,
          // The scripted fixture keeps per-episode memory: one per episode, or concurrent episodes corrupt each other.
          provider: providerMode === 'scripted' ? createProviderFromEnv(env) : provider,
          harness,
          mode,
          maxDecisions,
          episodeId: `bench-${c.caseId}-${stamp}`,
        });
        writeFileSync(join(outDir, 'runs', `${c.caseId}.jsonl`), r.runLogLines.map((l) => JSON.stringify(l)).join('\n') + '\n');
        rows[i] = rowFrom(c, r.result);
        latencies.push(...decisionLatencies(r.trace));
        console.log(`[bench] ${c.caseId.padEnd(26)} ${r.result.outcome.status.padEnd(10)} reward ${r.result.score.reward} · ${r.result.metrics.decisions} decisions · ${r.result.metrics.invalidCalls} invalid · ${(r.result.metrics.wallTimeMs / 1000).toFixed(1)}s`);
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        console.error(`[bench] ${c.caseId} ERROR ${msg}`);
        rows[i] = { ...rowFrom(c, emptyResult(c)), outcome: 'error', error: msg, labelConsistent: false };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, worker));
  const wallMs = Date.now() - t0;

  const summary: BenchSummary = {
    meta: {
      dataset: datasetId(),
      split,
      cases: cases.length,
      provider: { id: info.id, label: info.label, model: info.model, endpointKind: info.endpointKind, thinking: info.thinking, ...(info.thinkingBudget ? { thinkingBudget: info.thinkingBudget } : {}), baseUrl: info.baseUrl },
      harness,
      mode,
      maxDecisions: maxDecisions ?? null,
      concurrency,
      clock: 'lockstep',
      startedAt,
      finishedAt: new Date().toISOString(),
      note:
        info.endpointKind === 'scripted'
          ? 'SCRIPTED fixture run: validates the harness only; these are not model results.'
          : 'Ruleset 2 (spreading fire, electrical doors, alarms, no time limit). Small sample (≤32 cases); single run per case; temperature > 0 and seeded fire spread, so reruns can differ.',
    },
    aggregates: aggregate(rows, latencies, wallMs),
    rows,
  };
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  writeFileSync(join(outDir, 'summary.md'), renderMarkdown(summary));
  console.log(`[bench] wrote ${join(outDir, 'summary.md')}`);
  console.log(renderMarkdown(summary).split('\n## Cases')[0]);
}

function datasetId(): string {
  try {
    return (JSON.parse(readFileSync(join(root, 'data/scenarios/splits.json'), 'utf8')) as { dataset?: string }).dataset ?? 'escape-office-scenarios';
  } catch {
    return 'escape-office-scenarios';
  }
}

function emptyResult(c: ScenarioCase): EpisodeResult {
  return {
    episodeId: '',
    caseId: c.caseId,
    outcome: { status: 'aborted', reason: 'harness error', simTime: 0 },
    metrics: {
      decisions: 0,
      toolCalls: 0,
      validCalls: 0,
      invalidCalls: 0,
      invalidByCode: {},
      malformed: 0,
      providerErrors: 0,
      recoveries: 0,
      repeatedInvalid: 0,
      simTimeToComplete: null,
      simTime: 0,
      wallTimeMs: 0,
      latencyMsP50: null,
      latencyMsP95: null,
      promptTokens: 0,
      completionTokens: 0,
      procedural: {
        hazardReported: false,
        reportLatencySimSec: null,
        assistanceRequired: false,
        assistanceFulfilled: false,
        assistWithoutConsentAttempts: 0,
        checkedIn: 0,
        rosterVerified: false,
        prematureVerifyAttempts: 0,
        knownHazardMoveAttempts: 0,
        routeInterruptions: 0,
        replannedAfterInterruption: false,
        alarmRaised: false,
        alarmLatencySimSec: null,
        alarmBy: null,
        instinctFlees: 0,
        escaped: 0,
        lost: 0,
      },
    },
    debrief: [],
    score: { reward: 0, success: false, checks: {} },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
