# Benchmark: escape-office-scenarios-v1 / test

- Provider: **Nemotron 3.5 Lightning 30B-A3B** · model `escape-nemotron` · self-hosted-vllm · thinking off
- Harness: `v2` · decision cap default · concurrency 4 · clock lockstep
- Run: 2026-10-17T20:58:35.468Z → 2026-10-17T21:00:05.534Z · 16 cases
- Small sample (≤32 cases); single run per case; temperature > 0 so reruns can differ.

## Aggregates

| Metric | Value |
|---|---|
| Verified success on solvable cases | 12/14 |
| Label-consistent outcomes (success iff solvable) | 14/16 |
| False success on unsolvable cases | 0 |
| Mean reward | 0.69 |
| Tool calls / invalid (rate) | 448 / 43 (9.6%) |
| Malformed responses / provider errors | 0 / 0 |
| Recoveries after an error | 46 |
| Repeated identical invalid calls | 15 |
| Re-planned after a route interruption | 7/8 |
| Hazard reported with evidence | 16/16 |
| Assistance fulfilled when required | 9/13 |
| Roster verified | 12/16 |
| Mean decisions / episode | 28.0 |
| Mean sim time to verified completion (s) | 39.2 |
| Decision latency p50 / p95 (ms, n=448) | 670 / 1148 |
| Tokens prompt / completion | 1679169 / 24457 |
| Wall time total (s) · episodes/min | 90.1 · 10.66 |

| Family | n | success | label-consistent |
|---|---|---|---|
| fire_only | 5 | 100% | 100% |
| fire_then_blocker | 6 | 67% | 67% |
| independent | 3 | 100% | 100% |
| unsolvable | 2 | 0% | 100% |

## Cases

| Case | Family | Solvable | Outcome | Reward | Decisions | Invalid | Recov. | Sim s | Wall s | p50/p95 ms | Tokens in/out |
|---|---|---|---|---|---|---|---|---|---|---|---|
| test-01-fire_only | fire_only | yes | success | 1 | 16 | 1 | 1 | 34.1 | 11.4 | 727/1107 | 56666/796 |
| test-02-fire_only | fire_only | yes | success | 1 | 16 | 2 | 2 | 21.8 | 10.3 | 606/1278 | 56068/739 |
| test-03-fire_only | fire_only | yes | success | 1 | 24 | 4 | 3 | 43.4 | 16.3 | 643/1260 | 88086/1197 |
| test-04-fire_only | fire_only | yes | success | 1 | 35 | 1 | 1 | 34.2 | 24.5 | 657/1256 | 124825/1677 |
| test-05-fire_only | fire_only | yes | success | 1 | 33 | 3 | 2 | 50.1 | 21.4 | 665/904 | 121615/1532 |
| test-06-fire_then_blocker | fire_then_blocker | yes | success | 1 | 28 | 3 | 3 | 50.2 | 18.1 | 646/875 | 104965/1286 |
| test-07-fire_then_blocker | fire_then_blocker | yes | incomplete ⚠ | 0 | 40 | 0 | 1 | 10.4 | 31.1 | 726/1213 | 151988/2443 |
| test-08-fire_then_blocker | fire_then_blocker | yes | incomplete ⚠ | 0 | 40 | 1 | 2 | 22.4 | 31.8 | 714/1205 | 152896/2478 |
| test-09-fire_then_blocker | fire_then_blocker | yes | success | 1 | 38 | 1 | 2 | 39.4 | 25.3 | 652/969 | 145902/1936 |
| test-10-fire_then_blocker | fire_then_blocker | yes | success | 1 | 24 | 2 | 3 | 49.8 | 15.7 | 621/1045 | 89797/1122 |
| test-11-fire_then_blocker | fire_then_blocker | yes | success | 1 | 20 | 2 | 4 | 33.5 | 13.3 | 667/831 | 73626/964 |
| test-12-independent | independent | yes | success | 1 | 12 | 0 | 0 | 33.7 | 8.5 | 663/967 | 43703/586 |
| test-13-independent | independent | yes | success | 1 | 20 | 0 | 0 | 39.2 | 11.9 | 578/728 | 72955/819 |
| test-14-independent | independent | yes | success | 1 | 22 | 2 | 5 | 40.5 | 13.5 | 588/797 | 84435/949 |
| test-15-unsolvable | unsolvable | no | unresolved | 0 | 40 | 1 | 1 | 22.0 | 33.7 | 786/1264 | 157540/3903 |
| test-16-unsolvable | unsolvable | no | unresolved | -1 | 40 | 20 | 16 | 56.1 | 22.3 | 517/807 | 154102/2030 |

⚠ = outcome inconsistent with the solvability label. Small sample: report counts, not just rates.
