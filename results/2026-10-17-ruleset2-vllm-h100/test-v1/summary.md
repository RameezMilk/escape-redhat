# Benchmark: escape-office-scenarios-v2 / test

- Provider: **Nemotron 3.5 Lightning 30B-A3B** · model `escape-nemotron` · self-hosted-vllm · thinking off
- Harness: `v1` · decision cap default · concurrency 4 · clock lockstep
- Run: 2026-10-17T22:44:33.889Z → 2026-10-17T22:47:17.127Z · 16 cases
- Ruleset 2 (spreading fire, electrical doors, alarms, no time limit). Small sample (≤32 cases); single run per case; temperature > 0 and seeded fire spread, so reruns can differ.

## Aggregates

| Metric | Value |
|---|---|
| Verified success (all 3 alive, checked in, roster verified) on normal cases | 6/14 |
| False success on trapped-by-design cases | 0/2 |
| Outcome mix | success 6 · partial 3 · incomplete 4 · unresolved 3 |
| Outcomes matching expectation (success on normal, non-success on trapped) | 8/16 |
| People escaped and checked in | 26/48 |
| People lost — normal cases / trapped cases | 8 / 4 |
| Mean reward | -0.38 |
| Tool calls / invalid (rate) | 816 / 273 (33.5%) |
| Malformed responses / provider errors | 0 / 0 |
| Recoveries after an error | 176 |
| Repeated identical invalid calls | 72 |
| Re-planned after a route interruption | 5/8 |
| Hazard reported (notify with evidence or alarm) | 16/16 |
| Fire alarm pulled · mean sim s after first sighting | 3/16 · 37.5 |
| Buddy assistance completed when Daniel asked | 2/14 |
| Roster verified | 9/16 |
| Mean decisions / episode | 51.0 |
| Mean sim time to verified success (s) | 50.8 |
| Decision latency p50 / p95 (ms, n=816) | 709 / 1147 |
| Tokens prompt / completion | 3877710 / 45838 |
| Wall time total (s) · episodes/min | 163.2 · 5.88 |

| Family | n | success | as expected | escaped | lost |
|---|---|---|---|---|---|
| fire_only | 4 | 75% | 75% | 9/12 | 0 |
| multi_fire | 3 | 0% | 0% | 4/9 | 5 |
| fire_then_door | 5 | 20% | 20% | 6/15 | 3 |
| independent | 2 | 100% | 100% | 6/6 | 0 |
| trapped | 2 | 0% | 100% | 1/6 | 4 |

## Cases

| Case | Family | Trapped | Outcome | Escaped/lost | Alarm | Reward | Decisions | Invalid | Recov. | Sim s | Wall s | p50/p95 ms | Tokens in/out |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| test-01-fire_only | fire_only | no | incomplete ⚠ | 0/0 | yes | 0 | 60 | 11 | 7 | 91.1 | 45.7 | 715/1118 | 276207/3451 |
| test-02-fire_only | fire_only | no | success | 3/0 | — | -1 | 45 | 18 | 11 | 52.9 | 33.3 | 713/1169 | 210899/2523 |
| test-03-fire_only | fire_only | no | success | 3/0 | — | -1 | 35 | 13 | 11 | 66.1 | 25.2 | 713/1109 | 162113/1934 |
| test-04-fire_only | fire_only | no | success | 3/0 | — | -1 | 46 | 14 | 7 | 37.8 | 34.7 | 701/1202 | 217559/2516 |
| test-05-multi_fire | multi_fire | no | partial ⚠ | 1/2 | — | -1 | 59 | 19 | 13 | 72.4 | 44.7 | 708/1250 | 287986/3479 |
| test-06-multi_fire | multi_fire | no | partial ⚠ | 1/2 | yes | 0 | 55 | 23 | 12 | 63.0 | 42.1 | 729/1211 | 263252/3221 |
| test-07-multi_fire | multi_fire | no | partial ⚠ | 2/1 | — | 0 | 53 | 18 | 14 | 74.1 | 40.7 | 728/1147 | 249742/2978 |
| test-08-fire_then_door | fire_then_door | no | unresolved ⚠ | 1/0 | — | 0 | 60 | 18 | 11 | 81.3 | 45.3 | 725/1067 | 284238/3347 |
| test-09-fire_then_door | fire_then_door | no | success | 3/0 | — | -1 | 33 | 15 | 12 | 39.2 | 23.6 | 694/932 | 155936/1828 |
| test-10-fire_then_door | fire_then_door | no | unresolved ⚠ | 1/1 | — | -1 | 60 | 22 | 14 | 79.8 | 45.4 | 719/1070 | 289664/3404 |
| test-11-fire_then_door | fire_then_door | no | incomplete ⚠ | 1/2 | — | 0 | 60 | 15 | 7 | 93.7 | 46.8 | 720/1202 | 286611/3427 |
| test-12-fire_then_door | fire_then_door | no | unresolved ⚠ | 0/0 | — | -1 | 60 | 31 | 23 | 103.9 | 44.9 | 714/1084 | 289748/3327 |
| test-13-independent | independent | no | success | 3/0 | yes | 1 | 42 | 8 | 7 | 73.2 | 31.2 | 719/1070 | 192484/2269 |
| test-14-independent | independent | no | success | 3/0 | — | 1 | 28 | 5 | 2 | 35.8 | 19.4 | 694/799 | 129797/1440 |
| test-15-trapped | trapped | yes | incomplete | 1/2 | — | -1 | 60 | 31 | 16 | 90.1 | 39.4 | 621/928 | 292304/3331 |
| test-16-trapped | trapped | yes | incomplete | 0/2 | — | 0 | 60 | 12 | 9 | 83.5 | 38.4 | 551/1196 | 289170/3363 |

⚠ = not the expected outcome (success on a normal case; anything but success on a trapped one). Fire spread is seeded but the planner samples at temperature > 0: report counts, not just rates.
