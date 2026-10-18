# Baseline vs final — escape-office-scenarios-v2 / test

- Baseline: `results/2026-10-17-ruleset2-vllm-h100/test-v1/summary.json` — harness v1, Nemotron 3.5 Lightning 30B-A3B (escape-nemotron, self-hosted-vllm), 2026-10-17T22:44:33.889Z
- Final: `results/2026-10-17-ruleset2-vllm-h100/test-v2/summary.json` — harness v2, Nemotron 3.5 Lightning 30B-A3B (escape-nemotron, self-hosted-vllm), 2026-10-17T22:42:56.096Z
- Cases: 16 vs 16 (identical set)

| Metric | Baseline | Final | Δ |
|---|---|---|---|
| Verified success on normal (non-trapped) cases | 6/14 | 9/14 | +0.21 |
| Outcomes matching expectation | 8/16 | 11/16 | +0.19 |
| False success on trapped cases | 0 | 0 | +0 |
| People escaped and checked in | 26/48 | 33/48 | +0.15 |
| People lost on normal cases | 8 | 4 | -4 |
| Fire alarm pulled | 3/16 | 2/16 | -0.06 |
| Mean reward | -0.38 | 0.00 | +0.38 |
| Invalid-call rate | 0.335 | 0.414 | +0.080 |
| Recoveries | 176 | 74 | -102 |
| Repeated invalid calls | 72 | 91 | +19 |
| Re-planned after interruption | 5/8 | 8/11 | +0.10 |
| Mean decisions / episode | 51.0 | 29.1 | -21.9 |
| Decision latency p50 (ms) | 709 | 649 | -60 |

| Case | Baseline | Final |
|---|---|---|
| test-01-fire_only | incomplete (r=0) | success (r=1) |
| test-02-fire_only | success (r=-1) | success (r=0) |
| test-03-fire_only | success (r=-1) | success (r=1) |
| test-04-fire_only | success (r=-1) | success (r=0) |
| test-05-multi_fire | partial (r=-1, lost 2) | success (r=1) |
| test-06-multi_fire | partial (r=0, lost 2) | partial (r=0, lost 1) |
| test-07-multi_fire | partial (r=0, lost 1) | success (r=1) |
| test-08-fire_then_door | unresolved (r=0) | unresolved (r=-1) |
| test-09-fire_then_door | success (r=-1) | success (r=1) |
| test-10-fire_then_door | unresolved (r=-1, lost 1) | unresolved (r=-1) |
| test-11-fire_then_door | incomplete (r=0, lost 2) | partial (r=-1, lost 1) |
| test-12-fire_then_door | unresolved (r=-1) | partial (r=-1, lost 2) |
| test-13-independent | success (r=1) | success (r=1) |
| test-14-independent | success (r=1) | success (r=0) |
| test-15-trapped | incomplete (r=-1, lost 2) | incomplete (r=-1, lost 2) |
| test-16-trapped | incomplete (r=0, lost 2) | unresolved (r=-1, lost 1) |

Single run per case at temperature > 0 (and, in ruleset 2, a seeded stochastic fire): differences of one or two cases may be noise.
