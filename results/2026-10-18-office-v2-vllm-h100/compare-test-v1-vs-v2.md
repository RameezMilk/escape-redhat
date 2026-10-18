# Baseline vs final — escape-office-scenarios-v3 / test

- Baseline: `results/2026-10-18-office-v2-vllm-h100/test-v1/summary.json` — harness v1, Nemotron 3.5 Lightning 30B-A3B (escape-nemotron, self-hosted-vllm), 2026-10-18T08:27:53.454Z
- Final: `results/2026-10-18-office-v2-vllm-h100/test-v2/summary.json` — harness v2, Nemotron 3.5 Lightning 30B-A3B (escape-nemotron, self-hosted-vllm), 2026-10-18T08:32:23.472Z
- Cases: 16 vs 16 (identical set)

| Metric | Baseline | Final | Δ |
|---|---|---|---|
| Verified success on normal (non-trapped) cases | 9/14 | 13/14 | +0.29 |
| Outcomes matching expectation | 11/16 | 15/16 | +0.25 |
| False success on trapped cases | 0 | 0 | +0 |
| People escaped and checked in | 57/80 | 77/80 | +0.25 |
| People lost on normal cases | 3 | 1 | -2 |
| Fire alarm pulled | 14/16 | 15/16 | +0.06 |
| Mean reward | -1.00 | 0.44 | +1.44 |
| Invalid-call rate | 0.422 | 0.326 | -0.095 |
| Recoveries | 323 | 90 | -233 |
| Repeated invalid calls | 178 | 42 | -136 |
| Re-planned after interruption | 14/14 | 11/11 | +0.00 |
| Mean decisions / episode | 82.7 | 29.9 | -52.8 |
| Decision latency p50 (ms) | 726 | 730 | +4 |

| Case | Baseline | Final |
|---|---|---|
| test-01-fire_only | success (r=-1) | success (r=1) |
| test-02-fire_only | success (r=-1) | success (r=-1) |
| test-03-fire_only | unresolved (r=-1) | success (r=1) |
| test-04-fire_only | success (r=-1) | success (r=1) |
| test-05-multi_fire | success (r=-1) | success (r=1) |
| test-06-multi_fire | unresolved (r=-1, lost 1) | success (r=1) |
| test-07-multi_fire | unresolved (r=-1, lost 1) | partial (r=0, lost 1) |
| test-08-fire_then_door | success (r=-1) | success (r=1) |
| test-09-fire_then_door | incomplete (r=-1, lost 1) | success (r=1) |
| test-10-fire_then_door | incomplete (r=-1) | success (r=1) |
| test-11-fire_then_door | success (r=-1) | success (r=1) |
| test-12-fire_then_door | success (r=-1) | success (r=-1) |
| test-13-independent | success (r=-1) | success (r=1) |
| test-14-independent | success (r=-1) | success (r=1) |
| test-15-trapped | incomplete (r=-1, lost 1) | partial (r=-1, lost 1) |
| test-16-trapped | incomplete (r=-1, lost 1) | partial (r=-1, lost 1) |

Single run per case at temperature > 0 (and, in ruleset 2, a seeded stochastic fire): differences of one or two cases may be noise.
