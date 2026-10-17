# Benchmark: escape-office-scenarios-v2 / test

- Provider: **Nemotron 3.5 Lightning 30B-A3B** · model `escape-nemotron` · self-hosted-vllm · thinking off
- Harness: `v2` · decision cap default · concurrency 4 · clock lockstep
- Run: 2026-10-17T22:42:56.096Z → 2026-10-17T22:44:33.635Z · 16 cases
- Ruleset 2 (spreading fire, electrical doors, alarms, no time limit). Small sample (≤32 cases); single run per case; temperature > 0 and seeded fire spread, so reruns can differ.

## Aggregates

| Metric | Value |
|---|---|
| Verified success (all 3 alive, checked in, roster verified) on normal cases | 9/14 |
| False success on trapped-by-design cases | 0/2 |
| Outcome mix | success 9 · partial 3 · incomplete 1 · unresolved 3 |
| Outcomes matching expectation (success on normal, non-success on trapped) | 11/16 |
| People escaped and checked in | 33/48 |
| People lost — normal cases / trapped cases | 4 / 3 |
| Mean reward | 0.00 |
| Tool calls / invalid (rate) | 466 / 193 (41.4%) |
| Malformed responses / provider errors | 0 / 0 |
| Recoveries after an error | 74 |
| Repeated identical invalid calls | 91 |
| Re-planned after a route interruption | 8/11 |
| Hazard reported (notify with evidence or alarm) | 13/16 |
| Fire alarm pulled · mean sim s after first sighting | 2/16 · 4.4 |
| Buddy assistance completed when Daniel asked | 0/14 |
| Roster verified | 12/16 |
| Mean decisions / episode | 29.1 |
| Mean sim time to verified success (s) | 25.5 |
| Decision latency p50 / p95 (ms, n=466) | 649 / 1219 |
| Tokens prompt / completion | 2105195 / 26443 |
| Wall time total (s) · episodes/min | 97.5 · 9.84 |

| Family | n | success | as expected | escaped | lost |
|---|---|---|---|---|---|
| fire_only | 4 | 100% | 100% | 12/12 | 0 |
| multi_fire | 3 | 67% | 67% | 8/9 | 1 |
| fire_then_door | 5 | 20% | 20% | 6/15 | 3 |
| independent | 2 | 100% | 100% | 6/6 | 0 |
| trapped | 2 | 0% | 100% | 1/6 | 3 |

## Cases

| Case | Family | Trapped | Outcome | Escaped/lost | Alarm | Reward | Decisions | Invalid | Recov. | Sim s | Wall s | p50/p95 ms | Tokens in/out |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| test-01-fire_only | fire_only | no | success | 3/0 | — | 1 | 10 | 1 | 1 | 32.1 | 7.5 | 618/1279 | 41390/510 |
| test-02-fire_only | fire_only | no | success | 3/0 | — | 0 | 7 | 0 | 0 | 13.7 | 4.8 | 649/1019 | 27350/283 |
| test-03-fire_only | fire_only | no | success | 3/0 | yes | 1 | 14 | 1 | 1 | 33.4 | 10.6 | 678/1284 | 58905/729 |
| test-04-fire_only | fire_only | no | success | 3/0 | — | 0 | 8 | 0 | 0 | 14.4 | 5.2 | 590/842 | 31108/269 |
| test-05-multi_fire | multi_fire | no | success | 3/0 | — | 1 | 14 | 3 | 4 | 25.7 | 10.5 | 671/1378 | 57614/809 |
| test-06-multi_fire | multi_fire | no | partial ⚠ | 2/1 | — | 0 | 23 | 3 | 4 | 25.1 | 23.5 | 1139/1351 | 88805/1883 |
| test-07-multi_fire | multi_fire | no | success | 3/0 | — | 1 | 10 | 1 | 2 | 22.4 | 6.3 | 541/1090 | 40463/454 |
| test-08-fire_then_door | fire_then_door | no | unresolved ⚠ | 0/0 | — | -1 | 60 | 25 | 4 | 86.9 | 41.3 | 657/940 | 280515/3010 |
| test-09-fire_then_door | fire_then_door | no | success | 3/0 | — | 1 | 12 | 0 | 3 | 30.1 | 6.9 | 478/1208 | 49940/473 |
| test-10-fire_then_door | fire_then_door | no | unresolved ⚠ | 0/0 | — | -1 | 60 | 37 | 19 | 95.2 | 39.8 | 652/891 | 285290/2964 |
| test-11-fire_then_door | fire_then_door | no | partial ⚠ | 2/1 | — | -1 | 49 | 34 | 6 | 76.8 | 49.5 | 1076/1307 | 232151/4272 |
| test-12-fire_then_door | fire_then_door | no | partial ⚠ | 1/2 | yes | -1 | 58 | 25 | 7 | 85.2 | 39.8 | 667/1040 | 274264/2784 |
| test-13-independent | independent | no | success | 3/0 | — | 1 | 12 | 2 | 2 | 37.7 | 9.1 | 616/1337 | 49219/651 |
| test-14-independent | independent | no | success | 3/0 | — | 0 | 9 | 0 | 2 | 19.8 | 5.4 | 578/761 | 35565/326 |
| test-15-trapped | trapped | yes | incomplete | 1/2 | — | -1 | 60 | 23 | 9 | 53.5 | 37.0 | 572/869 | 265546/3910 |
| test-16-trapped | trapped | yes | unresolved | 0/1 | — | -1 | 60 | 38 | 10 | 90.7 | 34.3 | 534/832 | 287070/3116 |

⚠ = not the expected outcome (success on a normal case; anything but success on a trapped one). Fire spread is seeded but the planner samples at temperature > 0: report counts, not just rates.
