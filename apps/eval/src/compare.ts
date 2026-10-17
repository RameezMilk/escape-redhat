// Compare two bench summaries (baseline vs final) on the same case set and configuration.
//
//   npx tsx apps/eval/src/compare.ts results/test-v1/summary.json results/test-v2/summary.json [--out results/compare-test.md]
//
// Refuses to call it an improvement if the case sets differ; warns if provider/model/thinking differ.
import { readFileSync, writeFileSync } from 'node:fs';
import type { BenchRow, BenchSummary } from './bench.js';

function load(p: string): BenchSummary {
  return JSON.parse(readFileSync(p, 'utf8')) as BenchSummary;
}

const n = (x: unknown) => (typeof x === 'number' ? x : null);
const f = (x: number | null, d = 2) => (x === null ? '—' : x.toFixed(d));
const delta = (a: number | null, b: number | null, d = 2) => (a === null || b === null ? '—' : `${b - a >= 0 ? '+' : ''}${(b - a).toFixed(d)}`);
const frac = (s: unknown) => {
  if (typeof s !== 'string') return null;
  const [x, y] = s.split('/').map(Number);
  return y ? x / y : null;
};

export function compare(basePath: string, finalPath: string): string {
  const A = load(basePath);
  const B = load(finalPath);
  const out: string[] = [];
  const idsA = new Set(A.rows.map((r) => r.caseId));
  const idsB = new Set(B.rows.map((r) => r.caseId));
  const sameCases = idsA.size === idsB.size && [...idsA].every((id) => idsB.has(id));
  const warnings: string[] = [];
  if (!sameCases) warnings.push('Case sets differ — this is NOT a like-for-like comparison.');
  for (const k of ['model', 'endpointKind', 'thinking'] as const) {
    if (A.meta.provider[k] !== B.meta.provider[k]) warnings.push(`provider.${k} differs (${A.meta.provider[k]} → ${B.meta.provider[k]}).`);
  }
  if (A.meta.dataset !== B.meta.dataset) warnings.push(`dataset differs (${A.meta.dataset} → ${B.meta.dataset}) — different rules or cases.`);
  if (A.meta.maxDecisions !== B.meta.maxDecisions) warnings.push(`decision cap differs (${A.meta.maxDecisions} → ${B.meta.maxDecisions}).`);
  if (A.meta.provider.endpointKind === 'scripted' || B.meta.provider.endpointKind === 'scripted') warnings.push('A scripted fixture run is involved — not model results.');

  out.push(`# Baseline vs final — ${A.meta.dataset} / ${A.meta.split}`);
  out.push('');
  out.push(`- Baseline: \`${basePath}\` — harness ${A.meta.harness}, ${A.meta.provider.label} (${A.meta.provider.model}, ${A.meta.provider.endpointKind}), ${A.meta.startedAt}`);
  out.push(`- Final: \`${finalPath}\` — harness ${B.meta.harness}, ${B.meta.provider.label} (${B.meta.provider.model}, ${B.meta.provider.endpointKind}), ${B.meta.startedAt}`);
  out.push(`- Cases: ${A.rows.length} vs ${B.rows.length}${sameCases ? ' (identical set)' : ''}`);
  for (const w of warnings) out.push(`- ⚠ ${w}`);
  out.push('');
  const a = A.aggregates as Record<string, unknown>;
  const b = B.aggregates as Record<string, unknown>;
  out.push('| Metric | Baseline | Final | Δ |');
  out.push('|---|---|---|---|');
  // Ruleset-2 keys first; ruleset-1 summaries (static fire + blocker) used the older names.
  const pickKey = (...keys: string[]) => keys.find((k) => a[k] !== undefined || b[k] !== undefined) ?? keys[0];
  const fracRow = (label: string, ...keys: string[]) => {
    const key = pickKey(...keys);
    out.push(`| ${label} | ${a[key] ?? '—'} | ${b[key] ?? '—'} | ${delta(frac(a[key]), frac(b[key]))} |`);
  };
  const numRow = (label: string, key: string, d = 2) => out.push(`| ${label} | ${f(n(a[key]), d)} | ${f(n(b[key]), d)} | ${delta(n(a[key]), n(b[key]), d)} |`);
  fracRow('Verified success on normal (non-trapped) cases', 'successOnNormal', 'successOnSolvable');
  fracRow('Outcomes matching expectation', 'labelConsistent');
  numRow('False success on trapped cases', pickKey('falseSuccessOnTrapped', 'falseSuccessOnUnsolvable'), 0);
  fracRow('People escaped and checked in', 'peopleEscaped');
  numRow('People lost on normal cases', 'peopleLostOnNormal', 0);
  fracRow('Fire alarm pulled', 'alarmRaised');
  numRow('Mean reward', 'meanReward');
  numRow('Invalid-call rate', 'invalidCallRate', 3);
  numRow('Recoveries', 'recoveries', 0);
  numRow('Repeated invalid calls', 'repeatedInvalid', 0);
  fracRow('Re-planned after interruption', 'replannedAfterInterruption');
  numRow('Mean decisions / episode', 'meanDecisions', 1);
  numRow('Decision latency p50 (ms)', 'decisionLatencyMsP50', 0);
  out.push('');
  out.push('| Case | Baseline | Final |');
  out.push('|---|---|---|');
  const byB = new Map<string, BenchRow>(B.rows.map((r) => [r.caseId, r]));
  for (const ra of A.rows) {
    const rb = byB.get(ra.caseId);
    const cell = (r: BenchRow) => `${r.outcome} (r=${r.reward}${typeof r.lost === 'number' && r.lost ? `, lost ${r.lost}` : ''})`;
    out.push(`| ${ra.caseId} | ${cell(ra)} | ${rb ? cell(rb) : '—'} |`);
  }
  out.push('');
  out.push('Single run per case at temperature > 0 (and, in ruleset 2, a seeded stochastic fire): differences of one or two cases may be noise.');
  return out.join('\n') + '\n';
}

if (process.argv[1]?.endsWith('compare.ts')) {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 ? args[outIdx + 1] : undefined;
  const files = args.filter((x, i) => !x.startsWith('--') && (outIdx < 0 || i !== outIdx + 1));
  if (files.length !== 2) {
    console.error('usage: compare.ts <baseline/summary.json> <final/summary.json> [--out file.md]');
    process.exit(2);
  }
  const md = compare(files[0], files[1]);
  if (outPath) writeFileSync(outPath, md);
  console.log(md);
}
