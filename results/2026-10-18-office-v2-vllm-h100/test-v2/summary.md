# Benchmark: escape-office-scenarios-v3 / test

- Provider: **Nemotron 3.5 Lightning 30B-A3B** · model `escape-nemotron` · self-hosted-vllm · thinking off · one central planner
- Harness: `v2` · decision cap default · concurrency 4 · clock lockstep
- Run: 2026-10-18T08:32:23.472Z → 2026-10-18T08:34:11.805Z · 16 cases
- Ruleset 2 (spreading fire, electrical doors, alarms, no time limit). Small sample (≤32 cases); single run per case; temperature > 0 and seeded fire spread, so reruns can differ.

## Aggregates

| Metric | Value |
|---|---|
| Verified success (all 5 alive, checked in, roster verified) on normal cases | 13/14 |
| False success on trapped-by-design cases | 0/2 |
| Outcome mix | success 13 · partial 3 |
| Outcomes matching expectation (success on normal, non-success on trapped) | 15/16 |
| People escaped and checked in | 77/80 |
| People lost — normal cases / trapped cases | 1 / 2 |
| Mean reward | 0.44 |
| Tool calls / invalid (rate) | 478 / 156 (32.6%) |
| Malformed responses / provider errors | 0 / 0 |
| Recoveries after an error | 90 |
| Repeated identical invalid calls | 42 |
| Re-planned after a route interruption | 11/11 |
| Hazard reported (notify with evidence or alarm) | 15/16 |
| Fire alarm pulled · mean sim s after first sighting | 15/16 · 17.1 |
| Buddy assistance completed when Daniel asked | 0/14 |
| Roster verified | 16/16 |
| Mean decisions / episode | 29.9 |
| Mean sim time to verified success (s) | 35.4 |
| Decision latency p50 / p95 (ms, n=478) | 730 / 1078 |
| Tokens prompt / completion | 2462506 / 26864 |
| Wall time total (s) · episodes/min | 108.3 · 8.86 |

| Family | n | success | as expected | escaped | lost |
|---|---|---|---|---|---|
| fire_only | 4 | 100% | 100% | 20/20 | 0 |
| multi_fire | 3 | 67% | 67% | 14/15 | 1 |
| fire_then_door | 5 | 100% | 100% | 25/25 | 0 |
| independent | 2 | 100% | 100% | 10/10 | 0 |
| trapped | 2 | 0% | 100% | 8/10 | 2 |

## Cases

| Case | Family | Trapped | Outcome | Escaped/lost | Alarm | Reward | Decisions | Invalid | Recov. | Sim s | Wall s | p50/p95 ms | Tokens in/out |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| test-01-fire_only | fire_only | no | success | 5/0 | yes | 1 | 19 | 5 | 5 | 39.9 | 13.7 | 741/927 | 91382/1008 |
| test-02-fire_only | fire_only | no | success | 5/0 | yes | -1 | 50 | 28 | 7 | 70.4 | 43.7 | 807/1242 | 278729/3291 |
| test-03-fire_only | fire_only | no | success | 5/0 | yes | 1 | 54 | 13 | 9 | 46.5 | 45.7 | 806/1249 | 281157/3413 |
| test-04-fire_only | fire_only | no | success | 5/0 | yes | 1 | 20 | 3 | 2 | 32.9 | 14.2 | 700/841 | 94573/927 |
| test-05-multi_fire | multi_fire | no | success | 5/0 | yes | 1 | 19 | 2 | 1 | 28.6 | 14.1 | 713/1259 | 93314/1029 |
| test-06-multi_fire | multi_fire | no | success | 5/0 | yes | 1 | 24 | 5 | 4 | 29.2 | 17.8 | 720/915 | 116223/1292 |
| test-07-multi_fire | multi_fire | no | partial ⚠ | 4/1 | — | 0 | 23 | 7 | 6 | 18.4 | 17.9 | 744/995 | 117522/1297 |
| test-08-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 26 | 5 | 7 | 42.2 | 20.3 | 758/912 | 130371/1428 |
| test-09-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 20 | 2 | 4 | 25.6 | 14.7 | 723/832 | 94963/1014 |
| test-10-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 18 | 1 | 2 | 19.2 | 13.4 | 778/853 | 89078/939 |
| test-11-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 26 | 6 | 5 | 27.8 | 20.1 | 783/965 | 137315/1502 |
| test-12-fire_then_door | fire_then_door | no | success | 5/0 | yes | -1 | 19 | 5 | 3 | 33.2 | 14.1 | 697/1292 | 100699/1012 |
| test-13-independent | independent | no | success | 5/0 | yes | 1 | 18 | 3 | 2 | 30.9 | 12.9 | 723/926 | 84878/910 |
| test-14-independent | independent | no | success | 5/0 | yes | 1 | 21 | 5 | 5 | 34.4 | 15.9 | 767/936 | 108258/1080 |
| test-15-trapped | trapped | yes | partial | 4/1 | yes | -1 | 47 | 24 | 11 | 88.5 | 29.6 | 588/820 | 242559/2777 |
| test-16-trapped | trapped | yes | partial | 4/1 | yes | -1 | 74 | 42 | 17 | 121.0 | 42.0 | 563/772 | 401485/3945 |

⚠ = not the expected outcome (success on a normal case; anything but success on a trapped one). Fire spread is seeded but the planner samples at temperature > 0: report counts, not just rates.
