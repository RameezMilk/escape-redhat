# Baseline vs final — escape-office-scenarios-v1 / test

- Baseline: `results/2026-10-17-vllm-h100/test-v1/summary.json` — harness v1, Nemotron 3.5 Lightning 30B-A3B (escape-nemotron, self-hosted-vllm), 2026-10-17T21:00:05.949Z
- Final: `results/2026-10-17-vllm-h100/test-v2/summary.json` — harness v2, Nemotron 3.5 Lightning 30B-A3B (escape-nemotron, self-hosted-vllm), 2026-10-17T20:58:35.468Z
- Cases: 16 vs 16 (identical set)

| Metric | Baseline | Final | Δ |
|---|---|---|---|
| Verified success on solvable (fraction) | 5/14 | 12/14 | +0.50 |
| Label-consistent outcomes | 7/16 | 14/16 | +0.44 |
| False success on unsolvable | 0 | 0 | +0 |
| Mean reward | -0.50 | 0.69 | +1.19 |
| Invalid-call rate | 0.268 | 0.096 | -0.172 |
| Recoveries | 96 | 46 | -50 |
| Repeated invalid calls | 64 | 15 | -49 |
| Re-planned after interruption | 6/6 | 7/8 | -0.13 |
| Mean decisions / episode | 38.2 | 28.0 | -10.2 |
| Decision latency p50 (ms) | 668 | 670 | +2 |

| Case | Baseline | Final |
|---|---|---|
| test-01-fire_only | incomplete (r=0) | success (r=1) |
| test-02-fire_only | incomplete (r=-1) | success (r=1) |
| test-03-fire_only | incomplete (r=-1) | success (r=1) |
| test-04-fire_only | success (r=-1) | success (r=1) |
| test-05-fire_only | incomplete (r=-1) | success (r=1) |
| test-06-fire_then_blocker | incomplete (r=-1) | success (r=1) |
| test-07-fire_then_blocker | success (r=-1) | incomplete (r=0) |
| test-08-fire_then_blocker | incomplete (r=0) | incomplete (r=0) |
| test-09-fire_then_blocker | success (r=-1) | success (r=1) |
| test-10-fire_then_blocker | incomplete (r=0) | success (r=1) |
| test-11-fire_then_blocker | incomplete (r=-1) | success (r=1) |
| test-12-independent | success (r=1) | success (r=1) |
| test-13-independent | success (r=1) | success (r=1) |
| test-14-independent | incomplete (r=0) | success (r=1) |
| test-15-unsolvable | unresolved (r=-1) | unresolved (r=0) |
| test-16-unsolvable | unresolved (r=-1) | unresolved (r=-1) |

Single run per case at temperature > 0: differences of one or two cases may be noise.
