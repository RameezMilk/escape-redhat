# Baseline vs final — escape-office-scenarios-v2 / test

- Baseline: `results/2026-10-17-ruleset3-vllm-h100/test-v1/summary.json` — harness v1, Nemotron 3.5 Lightning 30B-A3B (escape-nemotron, self-hosted-vllm), 2026-10-18T00:59:09.557Z
- Final: `results/2026-10-17-ruleset3-vllm-h100/test-v2/summary.json` — harness v2, Nemotron 3.5 Lightning 30B-A3B (escape-nemotron, self-hosted-vllm), 2026-10-18T00:57:44.554Z
- Cases: 16 vs 16 (identical set)

| Metric | Baseline | Final | Δ |
|---|---|---|---|
| Verified success on normal (non-trapped) cases | 6/14 | 11/14 | +0.36 |
| Outcomes matching expectation | 8/16 | 13/16 | +0.31 |
| False success on trapped cases | 0 | 0 | +0 |
| People escaped and checked in | 23/48 | 37/48 | +0.29 |
| People lost on normal cases | 1 | 2 | +1 |
| Fire alarm pulled | 8/16 | 5/16 | -0.19 |
| Mean reward | -1.00 | 0.00 | +1.00 |
| Invalid-call rate | 0.509 | 0.519 | +0.010 |
| Recoveries | 232 | 75 | -157 |
| Repeated invalid calls | 184 | 63 | -121 |
| Re-planned after interruption | 8/11 | 11/13 | +0.12 |
| Mean decisions / episode | 54.1 | 24.1 | -30.1 |
| Decision latency p50 (ms) | 713 | 720 | +7 |

| Case | Baseline | Final |
|---|---|---|
| test-01-fire_only | success (r=-1) | success (r=1) |
| test-02-fire_only | success (r=-1) | success (r=0) |
| test-03-fire_only | unresolved (r=-1) | success (r=-1) |
| test-04-fire_only | success (r=-1) | success (r=0) |
| test-05-multi_fire | unresolved (r=-1) | partial (r=0, lost 1) |
| test-06-multi_fire | unresolved (r=-1, lost 1) | partial (r=0, lost 1) |
| test-07-multi_fire | unresolved (r=-1) | success (r=0) |
| test-08-fire_then_door | unresolved (r=-1) | success (r=-1) |
| test-09-fire_then_door | success (r=-1) | success (r=1) |
| test-10-fire_then_door | unresolved (r=-1) | unresolved (r=-1) |
| test-11-fire_then_door | success (r=-1) | success (r=1) |
| test-12-fire_then_door | unresolved (r=-1) | success (r=1) |
| test-13-independent | unresolved (r=-1) | success (r=1) |
| test-14-independent | success (r=-1) | success (r=0) |
| test-15-trapped | unresolved (r=-1) | unresolved (r=-1) |
| test-16-trapped | unresolved (r=-1) | unresolved (r=-1) |

Single run per case at temperature > 0 (and, in ruleset 2, a seeded stochastic fire): differences of one or two cases may be noise.
