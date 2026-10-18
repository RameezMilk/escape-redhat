# Benchmark: escape-office-scenarios-v3 / test

- Provider: **Nemotron 3.5 Lightning 30B-A3B** · model `escape-nemotron` · self-hosted-vllm · thinking off · one central planner
- Harness: `v1` · decision cap default · concurrency 4 · clock lockstep
- Run: 2026-10-18T05:34:45.501Z → 2026-10-18T05:39:16.883Z · 16 cases
- Ruleset 2 (spreading fire, electrical doors, alarms, no time limit). Small sample (≤32 cases); single run per case; temperature > 0 and seeded fire spread, so reruns can differ.

## Aggregates

| Metric | Value |
|---|---|
| Verified success (all 5 alive, checked in, roster verified) on normal cases | 6/14 |
| False success on trapped-by-design cases | 0/2 |
| Outcome mix | success 6 · partial 1 · incomplete 8 · unresolved 1 |
| Outcomes matching expectation (success on normal, non-success on trapped) | 8/16 |
| People escaped and checked in | 57/80 |
| People lost — normal cases / trapped cases | 6 / 2 |
| Mean reward | -1.00 |
| Tool calls / invalid (rate) | 1416 / 671 (47.4%) |
| Malformed responses / provider errors | 0 / 0 |
| Recoveries after an error | 341 |
| Repeated identical invalid calls | 193 |
| Re-planned after a route interruption | 13/14 |
| Hazard reported (notify with evidence or alarm) | 16/16 |
| Fire alarm pulled · mean sim s after first sighting | 15/16 · 45.4 |
| Buddy assistance completed when Daniel asked | 5/14 |
| Roster verified | 7/16 |
| Mean decisions / episode | 88.5 |
| Mean sim time to verified success (s) | 84.5 |
| Decision latency p50 / p95 (ms, n=1416) | 699 / 1053 |
| Tokens prompt / completion | 8041230 / 79647 |
| Wall time total (s) · episodes/min | 271.4 · 3.54 |

| Family | n | success | as expected | escaped | lost |
|---|---|---|---|---|---|
| fire_only | 4 | 50% | 50% | 17/20 | 2 |
| multi_fire | 3 | 33% | 33% | 10/15 | 2 |
| fire_then_door | 5 | 40% | 40% | 20/25 | 1 |
| independent | 2 | 50% | 50% | 7/10 | 1 |
| trapped | 2 | 0% | 100% | 3/10 | 2 |

## Cases

| Case | Family | Trapped | Outcome | Escaped/lost | Alarm | Reward | Decisions | Invalid | Recov. | Sim s | Wall s | p50/p95 ms | Tokens in/out |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| test-01-fire_only | fire_only | no | success | 5/0 | yes | -1 | 82 | 41 | 19 | 96.2 | 58.7 | 717/824 | 454675/4462 |
| test-02-fire_only | fire_only | no | incomplete ⚠ | 3/1 | yes | -1 | 100 | 51 | 23 | 120.8 | 70.6 | 691/836 | 565794/5397 |
| test-03-fire_only | fire_only | no | partial ⚠ | 4/1 | yes | -1 | 70 | 31 | 20 | 61.3 | 52.4 | 719/1078 | 392708/4091 |
| test-04-fire_only | fire_only | no | success | 5/0 | yes | -1 | 71 | 36 | 23 | 76.9 | 51.0 | 707/867 | 402648/3922 |
| test-05-multi_fire | multi_fire | no | success | 5/0 | yes | -1 | 84 | 35 | 27 | 74.7 | 59.0 | 705/814 | 474425/4406 |
| test-06-multi_fire | multi_fire | no | unresolved ⚠ | 2/1 | yes | -1 | 100 | 56 | 23 | 140.3 | 77.5 | 718/1149 | 568764/6231 |
| test-07-multi_fire | multi_fire | no | incomplete ⚠ | 3/1 | yes | -1 | 100 | 56 | 29 | 126.8 | 74.2 | 703/1142 | 573197/5758 |
| test-08-fire_then_door | fire_then_door | no | success | 5/0 | yes | -1 | 78 | 31 | 14 | 115.4 | 56.9 | 699/1098 | 443585/4418 |
| test-09-fire_then_door | fire_then_door | no | incomplete ⚠ | 2/1 | — | -1 | 100 | 54 | 20 | 123.1 | 76.3 | 722/1172 | 578923/5824 |
| test-10-fire_then_door | fire_then_door | no | incomplete ⚠ | 4/0 | yes | -1 | 100 | 52 | 22 | 97.9 | 73.9 | 705/1218 | 584065/5679 |
| test-11-fire_then_door | fire_then_door | no | success | 5/0 | yes | -1 | 69 | 26 | 17 | 69.3 | 50.2 | 703/1092 | 390841/3814 |
| test-12-fire_then_door | fire_then_door | no | incomplete ⚠ | 4/0 | yes | -1 | 100 | 41 | 21 | 136.0 | 72.4 | 693/1097 | 567260/5539 |
| test-13-independent | independent | no | incomplete ⚠ | 2/1 | yes | -1 | 100 | 46 | 19 | 137.5 | 70.4 | 693/949 | 558532/5457 |
| test-14-independent | independent | no | success | 5/0 | yes | -1 | 62 | 24 | 11 | 74.2 | 44.3 | 697/956 | 346712/3398 |
| test-15-trapped | trapped | yes | incomplete | 1/1 | yes | -1 | 100 | 46 | 24 | 159.5 | 66.5 | 668/866 | 569458/5679 |
| test-16-trapped | trapped | yes | incomplete | 2/1 | yes | -1 | 100 | 45 | 29 | 133.0 | 66.0 | 644/1009 | 569643/5572 |

⚠ = not the expected outcome (success on a normal case; anything but success on a trapped one). Fire spread is seeded but the planner samples at temperature > 0: report counts, not just rates.
