# Benchmark: escape-office-scenarios-v3 / test

- Provider: **Nemotron 3.5 Lightning 30B-A3B** · model `escape-nemotron` · self-hosted-vllm · thinking on (≤128 tokens) · each person decides for themselves (no engine instincts)
- Harness: `v2` · decision cap default · concurrency 1 · clock lockstep
- Run: 2026-10-18T08:12:46.528Z → 2026-10-18T08:27:46.754Z · 16 cases
- Ruleset 2 (spreading fire, electrical doors, alarms, no time limit). Small sample (≤32 cases); single run per case; temperature > 0 and seeded fire spread, so reruns can differ.

## Aggregates

| Metric | Value |
|---|---|
| Verified success (all 5 alive, checked in, roster verified) on normal cases | 12/14 |
| False success on trapped-by-design cases | 0/2 |
| Outcome mix | success 12 · partial 4 |
| Outcomes matching expectation (success on normal, non-success on trapped) | 14/16 |
| People escaped and checked in | 76/80 |
| People lost — normal cases / trapped cases | 2 / 2 |
| Mean reward | 0.50 |
| Tool calls / invalid (rate) | 959 / 112 (11.7%) |
| Malformed responses / provider errors | 18 / 0 |
| Recoveries after an error | 130 |
| Repeated identical invalid calls | 3 |
| Re-planned after a route interruption | 9/9 |
| Hazard reported (notify with evidence or alarm) | 16/16 |
| Fire alarm pulled · mean sim s after first sighting | 16/16 · 18.7 |
| Buddy assistance completed when Daniel asked | 0/14 |
| Roster verified | 16/16 |
| Mean decisions / episode | 61.1 |
| Mean sim time to verified success (s) | 51.6 |
| Decision latency p50 / p95 (ms, n=977) | 1080 / 2067 |
| Tokens prompt / completion | 3058613 / 207803 |
| Wall time total (s) · episodes/min | 900.2 · 1.07 |

| Family | n | success | as expected | escaped | lost |
|---|---|---|---|---|---|
| fire_only | 4 | 100% | 100% | 20/20 | 0 |
| multi_fire | 3 | 67% | 67% | 14/15 | 1 |
| fire_then_door | 5 | 80% | 80% | 24/25 | 1 |
| independent | 2 | 100% | 100% | 10/10 | 0 |
| trapped | 2 | 0% | 100% | 8/10 | 2 |

## Cases

| Case | Family | Trapped | Outcome | Escaped/lost | Alarm | Reward | Decisions | Invalid | Recov. | Sim s | Wall s | p50/p95 ms | Tokens in/out |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| test-01-fire_only | fire_only | no | success | 5/0 | yes | 1 | 66 | 2 | 6 | 87.6 | 73.0 | 1047/4644 | 202531/16049 |
| test-02-fire_only | fire_only | no | success | 5/0 | yes | 1 | 51 | 3 | 2 | 45.3 | 46.1 | 1146/2501 | 160556/11143 |
| test-03-fire_only | fire_only | no | success | 5/0 | yes | 1 | 46 | 4 | 2 | 36.9 | 39.2 | 1204/1954 | 148573/9309 |
| test-04-fire_only | fire_only | no | success | 5/0 | yes | 1 | 40 | 1 | 1 | 37.2 | 32.9 | 1138/1995 | 124762/7937 |
| test-05-multi_fire | multi_fire | no | success | 5/0 | yes | 1 | 50 | 4 | 7 | 51.2 | 39.0 | 1194/1966 | 154425/9385 |
| test-06-multi_fire | multi_fire | no | success | 5/0 | yes | -1 | 67 | 4 | 12 | 66.8 | 56.8 | 1123/1953 | 207418/12864 |
| test-07-multi_fire | multi_fire | no | partial ⚠ | 4/1 | yes | 0 | 128 | 7 | 13 | 119.0 | 135.3 | 1084/3818 | 415240/31495 |
| test-08-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 56 | 6 | 6 | 58.0 | 49.2 | 1033/1983 | 172324/11167 |
| test-09-fire_then_door | fire_then_door | no | partial ⚠ | 4/1 | yes | 0 | 88 | 10 | 22 | 83.2 | 83.0 | 1127/2402 | 275526/19565 |
| test-10-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 36 | 1 | 1 | 32.9 | 30.6 | 1070/2084 | 110243/7288 |
| test-11-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 53 | 6 | 0 | 41.4 | 44.4 | 1049/2038 | 169344/9718 |
| test-12-fire_then_door | fire_then_door | no | success | 5/0 | yes | -1 | 85 | 27 | 13 | 71.5 | 71.5 | 1274/2001 | 268610/19062 |
| test-13-independent | independent | no | success | 5/0 | yes | 1 | 38 | 1 | 1 | 39.9 | 30.8 | 1032/2050 | 116159/6841 |
| test-14-independent | independent | no | success | 5/0 | yes | 1 | 37 | 3 | 3 | 50.2 | 38.4 | 1068/4602 | 116784/8814 |
| test-15-trapped | trapped | yes | partial | 4/1 | yes | 0 | 71 | 18 | 22 | 132.8 | 70.1 | 1006/1651 | 220562/14417 |
| test-16-trapped | trapped | yes | partial | 4/1 | yes | 0 | 65 | 15 | 19 | 115.0 | 59.8 | 1018/1591 | 195556/12749 |

⚠ = not the expected outcome (success on a normal case; anything but success on a trapped one). Fire spread is seeded but the planner samples at temperature > 0: report counts, not just rates.
