# Benchmark: escape-office-scenarios-v3 / test

- Provider: **Nemotron 3.5 Lightning 30B-A3B** · model `escape-nemotron` · self-hosted-vllm · thinking off · one central planner
- Harness: `v2` · decision cap default · concurrency 4 · clock lockstep
- Run: 2026-10-18T05:39:17.167Z → 2026-10-18T05:41:00.190Z · 16 cases
- Ruleset 2 (spreading fire, electrical doors, alarms, no time limit). Small sample (≤32 cases); single run per case; temperature > 0 and seeded fire spread, so reruns can differ.

## Aggregates

| Metric | Value |
|---|---|
| Verified success (all 5 alive, checked in, roster verified) on normal cases | 14/14 |
| False success on trapped-by-design cases | 0/2 |
| Outcome mix | success 14 · partial 2 |
| Outcomes matching expectation (success on normal, non-success on trapped) | 16/16 |
| People escaped and checked in | 78/80 |
| People lost — normal cases / trapped cases | 0 / 2 |
| Mean reward | 0.63 |
| Tool calls / invalid (rate) | 454 / 143 (31.5%) |
| Malformed responses / provider errors | 0 / 0 |
| Recoveries after an error | 85 |
| Repeated identical invalid calls | 33 |
| Re-planned after a route interruption | 10/10 |
| Hazard reported (notify with evidence or alarm) | 16/16 |
| Fire alarm pulled · mean sim s after first sighting | 16/16 · 13.6 |
| Buddy assistance completed when Daniel asked | 0/14 |
| Roster verified | 16/16 |
| Mean decisions / episode | 28.4 |
| Mean sim time to verified success (s) | 33.6 |
| Decision latency p50 / p95 (ms, n=454) | 703 / 984 |
| Tokens prompt / completion | 2340347 / 25285 |
| Wall time total (s) · episodes/min | 103.0 · 9.32 |

| Family | n | success | as expected | escaped | lost |
|---|---|---|---|---|---|
| fire_only | 4 | 100% | 100% | 20/20 | 0 |
| multi_fire | 3 | 100% | 100% | 15/15 | 0 |
| fire_then_door | 5 | 100% | 100% | 25/25 | 0 |
| independent | 2 | 100% | 100% | 10/10 | 0 |
| trapped | 2 | 0% | 100% | 8/10 | 2 |

## Cases

| Case | Family | Trapped | Outcome | Escaped/lost | Alarm | Reward | Decisions | Invalid | Recov. | Sim s | Wall s | p50/p95 ms | Tokens in/out |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| test-01-fire_only | fire_only | no | success | 5/0 | yes | 1 | 18 | 5 | 5 | 39.9 | 13.8 | 777/968 | 85718/942 |
| test-02-fire_only | fire_only | no | success | 5/0 | yes | 1 | 31 | 8 | 4 | 35.8 | 23.5 | 742/1044 | 160592/1686 |
| test-03-fire_only | fire_only | no | success | 5/0 | yes | 1 | 16 | 3 | 1 | 29.6 | 12.5 | 747/1170 | 81944/910 |
| test-04-fire_only | fire_only | no | success | 5/0 | yes | 1 | 15 | 2 | 1 | 19.5 | 10.4 | 733/1023 | 69493/702 |
| test-05-multi_fire | multi_fire | no | success | 5/0 | yes | 1 | 22 | 2 | 1 | 28.6 | 16.7 | 749/914 | 107747/1190 |
| test-06-multi_fire | multi_fire | no | success | 5/0 | yes | -1 | 33 | 17 | 8 | 34.4 | 27.6 | 809/1359 | 182313/2182 |
| test-07-multi_fire | multi_fire | no | success | 5/0 | yes | 1 | 26 | 4 | 8 | 50.3 | 19.8 | 752/928 | 132295/1444 |
| test-08-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 31 | 7 | 8 | 53.4 | 23.4 | 749/1034 | 157788/1736 |
| test-09-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 21 | 2 | 4 | 21.6 | 15.7 | 766/904 | 104620/1139 |
| test-10-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 26 | 3 | 3 | 36.8 | 18.4 | 707/904 | 124639/1282 |
| test-11-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 23 | 5 | 5 | 29.0 | 16.2 | 695/876 | 117549/1199 |
| test-12-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 21 | 5 | 3 | 35.4 | 16.9 | 767/1257 | 113618/1176 |
| test-13-independent | independent | no | success | 5/0 | yes | 1 | 23 | 3 | 2 | 20.8 | 16.4 | 716/851 | 110384/1175 |
| test-14-independent | independent | no | success | 5/0 | yes | 1 | 24 | 5 | 5 | 35.1 | 18.3 | 736/1119 | 124937/1354 |
| test-15-trapped | trapped | yes | partial | 4/1 | yes | -1 | 48 | 26 | 16 | 91.8 | 31.0 | 600/841 | 247000/2810 |
| test-16-trapped | trapped | yes | partial | 4/1 | yes | -1 | 76 | 46 | 11 | 116.7 | 43.2 | 558/750 | 419710/4358 |

⚠ = not the expected outcome (success on a normal case; anything but success on a trapped one). Fire spread is seeded but the planner samples at temperature > 0: report counts, not just rates.
