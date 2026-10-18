# Benchmark: escape-office-scenarios-v1 / test

- Provider: **Nemotron 3.5 Lightning 30B-A3B** · model `escape-nemotron` · self-hosted-vllm · thinking off
- Harness: `v1` · decision cap default · concurrency 4 · clock lockstep
- Run: 2026-10-17T21:00:05.949Z → 2026-10-17T21:01:57.130Z · 16 cases
- Small sample (≤32 cases); single run per case; temperature > 0 so reruns can differ.

## Aggregates

| Metric | Value |
|---|---|
| Verified success on solvable cases | 5/14 |
| Label-consistent outcomes (success iff solvable) | 7/16 |
| False success on unsolvable cases | 0 |
| Mean reward | -0.50 |
| Tool calls / invalid (rate) | 611 / 164 (26.8%) |
| Malformed responses / provider errors | 0 / 0 |
| Recoveries after an error | 96 |
| Repeated identical invalid calls | 64 |
| Re-planned after a route interruption | 6/6 |
| Hazard reported with evidence | 10/16 |
| Assistance fulfilled when required | 4/13 |
| Roster verified | 5/16 |
| Mean decisions / episode | 38.2 |
| Mean sim time to verified completion (s) | 55.5 |
| Decision latency p50 / p95 (ms, n=611) | 668 / 1002 |
| Tokens prompt / completion | 2489165 / 32109 |
| Wall time total (s) · episodes/min | 111.2 · 8.63 |

| Family | n | success | label-consistent |
|---|---|---|---|
| fire_only | 5 | 20% | 20% |
| fire_then_blocker | 6 | 33% | 33% |
| independent | 3 | 67% | 67% |
| unsolvable | 2 | 0% | 100% |

## Cases

| Case | Family | Solvable | Outcome | Reward | Decisions | Invalid | Recov. | Sim s | Wall s | p50/p95 ms | Tokens in/out |
|---|---|---|---|---|---|---|---|---|---|---|---|
| test-01-fire_only | fire_only | yes | incomplete ⚠ | 0 | 40 | 5 | 3 | 84.0 | 28.7 | 708/863 | 155966/2039 |
| test-02-fire_only | fire_only | yes | incomplete ⚠ | -1 | 40 | 15 | 9 | 39.2 | 30.0 | 721/990 | 167427/2279 |
| test-03-fire_only | fire_only | yes | incomplete ⚠ | -1 | 40 | 8 | 2 | 78.0 | 30.7 | 718/1064 | 159078/2299 |
| test-04-fire_only | fire_only | yes | success | -1 | 39 | 18 | 9 | 55.7 | 27.9 | 712/888 | 161383/2062 |
| test-05-fire_only | fire_only | yes | incomplete ⚠ | -1 | 39 | 13 | 8 | 60.5 | 29.5 | 729/1096 | 163069/2282 |
| test-06-fire_then_blocker | fire_then_blocker | yes | incomplete ⚠ | -1 | 40 | 12 | 12 | 83.2 | 29.5 | 682/1093 | 165731/2040 |
| test-07-fire_then_blocker | fire_then_blocker | yes | success | -1 | 35 | 13 | 10 | 52.5 | 26.2 | 704/1099 | 146094/1893 |
| test-08-fire_then_blocker | fire_then_blocker | yes | incomplete ⚠ | 0 | 40 | 11 | 6 | 68.2 | 28.6 | 658/1064 | 163391/2098 |
| test-09-fire_then_blocker | fire_then_blocker | yes | success | -1 | 39 | 15 | 7 | 54.5 | 25.7 | 638/773 | 163145/2051 |
| test-10-fire_then_blocker | fire_then_blocker | yes | incomplete ⚠ | 0 | 40 | 0 | 0 | 94.0 | 26.4 | 637/759 | 152395/1726 |
| test-11-fire_then_blocker | fire_then_blocker | yes | incomplete ⚠ | -1 | 40 | 15 | 11 | 58.7 | 26.3 | 642/759 | 165877/1989 |
| test-12-independent | independent | yes | success | 1 | 35 | 4 | 3 | 72.1 | 23.9 | 660/973 | 139995/1798 |
| test-13-independent | independent | yes | success | 1 | 24 | 3 | 2 | 42.9 | 16.4 | 638/898 | 94270/1212 |
| test-14-independent | independent | yes | incomplete ⚠ | 0 | 40 | 1 | 1 | 71.0 | 25.2 | 626/718 | 154463/1853 |
| test-15-unsolvable | unsolvable | no | unresolved | -1 | 40 | 15 | 6 | 74.2 | 27.3 | 654/922 | 169573/2305 |
| test-16-unsolvable | unsolvable | no | unresolved | -1 | 40 | 16 | 7 | 52.1 | 26.7 | 643/894 | 167308/2183 |

⚠ = outcome inconsistent with the solvability label. Small sample: report counts, not just rates.
