# Baseline vs final — escape-office-scenarios-v3 / test

- Baseline: `results/2026-10-18-office-v2-vllm-h100/test-v1/summary.json` — harness v1, Nemotron 3.5 Lightning 30B-A3B (escape-nemotron, self-hosted-vllm), 2026-10-18T05:34:45.501Z
- Final: `results/2026-10-18-office-v2-vllm-h100/test-v2/summary.json` — harness v2, Nemotron 3.5 Lightning 30B-A3B (escape-nemotron, self-hosted-vllm), 2026-10-18T05:39:17.167Z
- Cases: 16 vs 16 (identical set)

| Metric | Baseline | Final | Δ |
|---|---|---|---|
| Verified success on normal (non-trapped) cases | 6/14 | 14/14 | +0.57 |
| Outcomes matching expectation | 8/16 | 16/16 | +0.50 |
| False success on trapped cases | 0 | 0 | +0 |
| People escaped and checked in | 57/80 | 78/80 | +0.26 |
| People lost on normal cases | 6 | 0 | -6 |
| Fire alarm pulled | 15/16 | 16/16 | +0.06 |
| Mean reward | -1.00 | 0.63 | +1.63 |
| Invalid-call rate | 0.474 | 0.315 | -0.159 |
| Recoveries | 341 | 85 | -256 |
| Repeated invalid calls | 193 | 33 | -160 |
| Re-planned after interruption | 13/14 | 10/10 | +0.07 |
| Mean decisions / episode | 88.5 | 28.4 | -60.1 |
| Decision latency p50 (ms) | 699 | 703 | +4 |

| Case | Baseline | Final |
|---|---|---|
| test-01-fire_only | success (r=-1) | success (r=1) |
| test-02-fire_only | incomplete (r=-1, lost 1) | success (r=1) |
| test-03-fire_only | partial (r=-1, lost 1) | success (r=1) |
| test-04-fire_only | success (r=-1) | success (r=1) |
| test-05-multi_fire | success (r=-1) | success (r=1) |
| test-06-multi_fire | unresolved (r=-1, lost 1) | success (r=-1) |
| test-07-multi_fire | incomplete (r=-1, lost 1) | success (r=1) |
| test-08-fire_then_door | success (r=-1) | success (r=1) |
| test-09-fire_then_door | incomplete (r=-1, lost 1) | success (r=1) |
| test-10-fire_then_door | incomplete (r=-1) | success (r=1) |
| test-11-fire_then_door | success (r=-1) | success (r=1) |
| test-12-fire_then_door | incomplete (r=-1) | success (r=1) |
| test-13-independent | incomplete (r=-1, lost 1) | success (r=1) |
| test-14-independent | success (r=-1) | success (r=1) |
| test-15-trapped | incomplete (r=-1, lost 1) | partial (r=-1, lost 1) |
| test-16-trapped | incomplete (r=-1, lost 1) | partial (r=-1, lost 1) |

Single run per case at temperature > 0 (and, in ruleset 2, a seeded stochastic fire): differences of one or two cases may be noise.
