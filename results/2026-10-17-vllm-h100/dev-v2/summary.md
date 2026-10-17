# Benchmark: escape-office-scenarios-v1 / dev

- Provider: **Nemotron 3.5 Lightning 30B-A3B** · model `escape-nemotron` · self-hosted-vllm · thinking off
- Harness: `v2` · decision cap default · concurrency 4 · clock lockstep
- Run: 2026-10-17T20:57:15.772Z → 2026-10-17T20:58:25.306Z · 16 cases
- Small sample (≤32 cases); single run per case; temperature > 0 so reruns can differ.

## Aggregates

| Metric | Value |
|---|---|
| Verified success on solvable cases | 14/14 |
| Label-consistent outcomes (success iff solvable) | 16/16 |
| False success on unsolvable cases | 0 |
| Mean reward | 0.75 |
| Tool calls / invalid (rate) | 377 / 70 (18.6%) |
| Malformed responses / provider errors | 0 / 0 |
| Recoveries after an error | 70 |
| Repeated identical invalid calls | 32 |
| Re-planned after a route interruption | 8/9 |
| Hazard reported with evidence | 16/16 |
| Assistance fulfilled when required | 12/14 |
| Roster verified | 14/16 |
| Mean decisions / episode | 23.6 |
| Mean sim time to verified completion (s) | 28.5 |
| Decision latency p50 / p95 (ms, n=377) | 585 / 1043 |
| Tokens prompt / completion | 1402378 / 17741 |
| Wall time total (s) · episodes/min | 69.5 · 13.81 |

| Family | n | success | label-consistent |
|---|---|---|---|
| hero | 1 | 100% | 100% |
| fire_only | 5 | 100% | 100% |
| fire_then_blocker | 6 | 100% | 100% |
| independent | 2 | 100% | 100% |
| unsolvable | 2 | 0% | 100% |

## Cases

| Case | Family | Solvable | Outcome | Reward | Decisions | Invalid | Recov. | Sim s | Wall s | p50/p95 ms | Tokens in/out |
|---|---|---|---|---|---|---|---|---|---|---|---|
| dev-00-hero | hero | yes | success | 1 | 26 | 2 | 4 | 32.9 | 17.8 | 652/1159 | 96490/1286 |
| dev-01-fire_only | fire_only | yes | success | 1 | 19 | 1 | 1 | 19.1 | 12.4 | 585/1191 | 67995/896 |
| dev-02-fire_only | fire_only | yes | success | 1 | 17 | 1 | 1 | 16.8 | 10.9 | 582/1287 | 61326/750 |
| dev-03-fire_only | fire_only | yes | success | 1 | 17 | 1 | 1 | 20.1 | 11.4 | 631/1289 | 60412/740 |
| dev-04-fire_only | fire_only | yes | success | 1 | 13 | 1 | 1 | 14.2 | 7.8 | 547/1022 | 45069/559 |
| dev-05-fire_only | fire_only | yes | success | 1 | 17 | 1 | 1 | 19.8 | 11.6 | 678/1016 | 60657/821 |
| dev-06-fire_then_blocker | fire_then_blocker | yes | success | 1 | 25 | 3 | 4 | 36.8 | 15.7 | 567/1066 | 92271/1166 |
| dev-07-fire_then_blocker | fire_then_blocker | yes | success | 1 | 23 | 3 | 5 | 37.2 | 15.7 | 682/865 | 84854/1073 |
| dev-08-fire_then_blocker | fire_then_blocker | yes | success | 1 | 27 | 3 | 4 | 45.4 | 18.3 | 633/1000 | 101284/1247 |
| dev-09-fire_then_blocker | fire_then_blocker | yes | success | 1 | 27 | 3 | 3 | 30.9 | 19.5 | 715/1161 | 102560/1414 |
| dev-10-fire_then_blocker | fire_then_blocker | yes | success | 1 | 28 | 2 | 4 | 32.9 | 20.0 | 621/1201 | 105224/1455 |
| dev-11-fire_then_blocker | fire_then_blocker | yes | success | 1 | 25 | 3 | 5 | 28.0 | 16.6 | 659/854 | 95514/1219 |
| dev-12-independent | independent | yes | success | 1 | 22 | 0 | 3 | 42.5 | 13.5 | 583/987 | 83120/916 |
| dev-13-independent | independent | yes | success | 1 | 11 | 0 | 0 | 22.1 | 6.6 | 519/972 | 39251/464 |
| dev-14-unsolvable | unsolvable | no | unresolved | -1 | 40 | 23 | 22 | 57.0 | 20.9 | 493/710 | 150587/1802 |
| dev-15-unsolvable | unsolvable | no | unresolved | -1 | 40 | 23 | 11 | 58.1 | 20.4 | 495/611 | 155764/1933 |

⚠ = outcome inconsistent with the solvability label. Small sample: report counts, not just rates.
