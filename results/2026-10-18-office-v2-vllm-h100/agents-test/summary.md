# Benchmark: escape-office-scenarios-v3 / test

- Provider: **Nemotron 3.5 Lightning 30B-A3B** · model `escape-nemotron` · self-hosted-vllm · thinking on (≤128 tokens) · each person decides for themselves (no engine instincts)
- Harness: `v2` · decision cap default · concurrency 1 · clock lockstep
- Run: 2026-10-18T05:54:08.530Z → 2026-10-18T06:07:19.992Z · 16 cases
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
| Mean reward | 0.56 |
| Tool calls / invalid (rate) | 917 / 84 (9.2%) |
| Malformed responses / provider errors | 6 / 0 |
| Recoveries after an error | 110 |
| Repeated identical invalid calls | 8 |
| Re-planned after a route interruption | 9/9 |
| Hazard reported (notify with evidence or alarm) | 16/16 |
| Fire alarm pulled · mean sim s after first sighting | 16/16 · 17.9 |
| Buddy assistance completed when Daniel asked | 0/14 |
| Roster verified | 15/16 |
| Mean decisions / episode | 57.7 |
| Mean sim time to verified success (s) | 50.3 |
| Decision latency p50 / p95 (ms, n=923) | 1050 / 1737 |
| Tokens prompt / completion | 2864586 / 180881 |
| Wall time total (s) · episodes/min | 791.5 · 1.21 |

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
| test-01-fire_only | fire_only | no | success | 5/0 | yes | 1 | 64 | 3 | 7 | 75.4 | 57.2 | 1032/2314 | 199393/12863 |
| test-02-fire_only | fire_only | no | success | 5/0 | yes | 1 | 39 | 2 | 2 | 45.2 | 33.2 | 1053/2388 | 118073/7648 |
| test-03-fire_only | fire_only | no | success | 5/0 | yes | 1 | 40 | 2 | 2 | 34.2 | 42.9 | 1114/2923 | 126653/9809 |
| test-04-fire_only | fire_only | no | success | 5/0 | yes | 1 | 35 | 0 | 0 | 33.8 | 29.3 | 1059/2332 | 109418/6848 |
| test-05-multi_fire | multi_fire | no | partial ⚠ | 4/1 | yes | 0 | 49 | 0 | 3 | 50.5 | 40.1 | 1074/1657 | 151378/9138 |
| test-06-multi_fire | multi_fire | no | success | 5/0 | yes | -1 | 78 | 3 | 10 | 72.0 | 57.1 | 1172/1720 | 241382/14234 |
| test-07-multi_fire | multi_fire | no | success | 5/0 | yes | 1 | 69 | 2 | 2 | 45.8 | 55.5 | 1049/1838 | 213016/12693 |
| test-08-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 70 | 7 | 6 | 61.2 | 57.5 | 1094/1744 | 219538/13886 |
| test-09-fire_then_door | fire_then_door | no | partial ⚠ | 4/1 | yes | -1 | 94 | 15 | 22 | 90.3 | 83.4 | 1041/1566 | 294717/18180 |
| test-10-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 33 | 1 | 1 | 33.6 | 27.3 | 978/1741 | 98750/6129 |
| test-11-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 47 | 2 | 1 | 40.4 | 41.5 | 1118/2127 | 150066/9514 |
| test-12-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 78 | 17 | 15 | 68.4 | 65.0 | 1182/2339 | 241826/16587 |
| test-13-independent | independent | no | success | 5/0 | yes | 1 | 28 | 0 | 0 | 32.6 | 21.0 | 1115/1747 | 86098/5014 |
| test-14-independent | independent | no | success | 5/0 | yes | 1 | 37 | 1 | 2 | 61.4 | 32.4 | 1052/2350 | 114751/7324 |
| test-15-trapped | trapped | yes | partial | 4/1 | yes | 0 | 72 | 15 | 19 | 126.0 | 62.0 | 987/1618 | 221115/12924 |
| test-16-trapped | trapped | yes | partial | 4/1 | yes | 0 | 90 | 14 | 18 | 123.7 | 86.0 | 1029/1632 | 278412/18090 |

⚠ = not the expected outcome (success on a normal case; anything but success on a trapped one). Fire spread is seeded but the planner samples at temperature > 0: report counts, not just rates.
