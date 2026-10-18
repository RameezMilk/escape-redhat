# Benchmark: escape-office-scenarios-v3 / test

- Provider: **Nemotron 3.5 Lightning 30B-A3B** · model `escape-nemotron` · self-hosted-vllm · thinking off · one central planner
- Harness: `v1` · decision cap default · concurrency 4 · clock lockstep
- Run: 2026-10-18T08:27:53.454Z → 2026-10-18T08:32:23.141Z · 16 cases
- Ruleset 2 (spreading fire, electrical doors, alarms, no time limit). Small sample (≤32 cases); single run per case; temperature > 0 and seeded fire spread, so reruns can differ.

## Aggregates

| Metric | Value |
|---|---|
| Verified success (all 5 alive, checked in, roster verified) on normal cases | 9/14 |
| False success on trapped-by-design cases | 0/2 |
| Outcome mix | success 9 · incomplete 4 · unresolved 3 |
| Outcomes matching expectation (success on normal, non-success on trapped) | 11/16 |
| People escaped and checked in | 57/80 |
| People lost — normal cases / trapped cases | 3 / 2 |
| Mean reward | -1.00 |
| Tool calls / invalid (rate) | 1323 / 558 (42.2%) |
| Malformed responses / provider errors | 0 / 0 |
| Recoveries after an error | 323 |
| Repeated identical invalid calls | 178 |
| Re-planned after a route interruption | 14/14 |
| Hazard reported (notify with evidence or alarm) | 16/16 |
| Fire alarm pulled · mean sim s after first sighting | 14/16 · 30.0 |
| Buddy assistance completed when Daniel asked | 2/14 |
| Roster verified | 9/16 |
| Mean decisions / episode | 82.7 |
| Mean sim time to verified success (s) | 81.3 |
| Decision latency p50 / p95 (ms, n=1323) | 726 / 1116 |
| Tokens prompt / completion | 7512740 / 76277 |
| Wall time total (s) · episodes/min | 269.7 · 3.56 |

| Family | n | success | as expected | escaped | lost |
|---|---|---|---|---|---|
| fire_only | 4 | 75% | 75% | 19/20 | 0 |
| multi_fire | 3 | 33% | 33% | 7/15 | 2 |
| fire_then_door | 5 | 60% | 60% | 19/25 | 1 |
| independent | 2 | 100% | 100% | 10/10 | 0 |
| trapped | 2 | 0% | 100% | 2/10 | 2 |

## Cases

| Case | Family | Trapped | Outcome | Escaped/lost | Alarm | Reward | Decisions | Invalid | Recov. | Sim s | Wall s | p50/p95 ms | Tokens in/out |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| test-01-fire_only | fire_only | no | success | 5/0 | yes | -1 | 55 | 28 | 19 | 66.4 | 41.7 | 744/877 | 308083/3047 |
| test-02-fire_only | fire_only | no | success | 5/0 | yes | -1 | 72 | 31 | 18 | 102.9 | 55.6 | 733/1192 | 408879/4145 |
| test-03-fire_only | fire_only | no | unresolved ⚠ | 4/0 | yes | -1 | 100 | 43 | 27 | 95.0 | 76.0 | 741/1061 | 572186/5803 |
| test-04-fire_only | fire_only | no | success | 5/0 | yes | -1 | 88 | 19 | 15 | 118.9 | 64.7 | 725/855 | 484443/4592 |
| test-05-multi_fire | multi_fire | no | success | 5/0 | yes | -1 | 57 | 21 | 18 | 58.6 | 43.8 | 712/1288 | 325541/3442 |
| test-06-multi_fire | multi_fire | no | unresolved ⚠ | 2/1 | — | -1 | 100 | 38 | 19 | 120.0 | 83.6 | 779/1248 | 578835/6335 |
| test-07-multi_fire | multi_fire | no | unresolved ⚠ | 0/1 | yes | -1 | 100 | 40 | 37 | 104.4 | 74.8 | 734/895 | 578416/5424 |
| test-08-fire_then_door | fire_then_door | no | success | 5/0 | yes | -1 | 88 | 31 | 13 | 101.3 | 66.2 | 731/895 | 496061/4825 |
| test-09-fire_then_door | fire_then_door | no | incomplete ⚠ | 2/1 | yes | -1 | 100 | 43 | 20 | 119.3 | 74.0 | 727/1075 | 563750/5568 |
| test-10-fire_then_door | fire_then_door | no | incomplete ⚠ | 2/0 | yes | -1 | 100 | 57 | 29 | 92.5 | 80.5 | 735/1199 | 577132/6346 |
| test-11-fire_then_door | fire_then_door | no | success | 5/0 | yes | -1 | 80 | 38 | 17 | 74.3 | 59.4 | 734/860 | 454572/4467 |
| test-12-fire_then_door | fire_then_door | no | success | 5/0 | yes | -1 | 71 | 27 | 12 | 82.4 | 53.6 | 746/1137 | 408014/4011 |
| test-13-independent | independent | no | success | 5/0 | yes | -1 | 60 | 31 | 12 | 60.0 | 47.6 | 755/1080 | 336546/3760 |
| test-14-independent | independent | no | success | 5/0 | yes | -1 | 52 | 20 | 18 | 67.1 | 37.1 | 703/837 | 289717/2789 |
| test-15-trapped | trapped | yes | incomplete | 0/1 | — | -1 | 100 | 36 | 17 | 148.5 | 64.8 | 613/959 | 561519/5855 |
| test-16-trapped | trapped | yes | incomplete | 2/1 | yes | -1 | 100 | 55 | 32 | 142.6 | 62.4 | 575/913 | 569046/5868 |

⚠ = not the expected outcome (success on a normal case; anything but success on a trapped one). Fire spread is seeded but the planner samples at temperature > 0: report counts, not just rates.
