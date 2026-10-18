# Benchmark: escape-office-scenarios-v2 / test

- Provider: **Nemotron 3.5 Lightning 30B-A3B** · model `escape-nemotron` · self-hosted-vllm · thinking off
- Harness: `v2` · decision cap default · concurrency 4 · clock lockstep
- Run: 2026-10-18T00:57:44.554Z → 2026-10-18T00:59:09.267Z · 16 cases
- Ruleset 2 (spreading fire, electrical doors, alarms, no time limit). Small sample (≤32 cases); single run per case; temperature > 0 and seeded fire spread, so reruns can differ.

## Aggregates

| Metric | Value |
|---|---|
| Verified success (all 3 alive, checked in, roster verified) on normal cases | 11/14 |
| False success on trapped-by-design cases | 0/2 |
| Outcome mix | success 11 · partial 2 · unresolved 3 |
| Outcomes matching expectation (success on normal, non-success on trapped) | 13/16 |
| People escaped and checked in | 37/48 |
| People lost — normal cases / trapped cases | 2 / 0 |
| Mean reward | 0.00 |
| Tool calls / invalid (rate) | 385 / 200 (51.9%) |
| Malformed responses / provider errors | 0 / 0 |
| Recoveries after an error | 75 |
| Repeated identical invalid calls | 63 |
| Re-planned after a route interruption | 11/13 |
| Hazard reported (notify with evidence or alarm) | 11/16 |
| Fire alarm pulled · mean sim s after first sighting | 5/16 · 17.1 |
| Buddy assistance completed when Daniel asked | 0/14 |
| Roster verified | 13/16 |
| Mean decisions / episode | 24.1 |
| Mean sim time to verified success (s) | 32.5 |
| Decision latency p50 / p95 (ms, n=385) | 720 / 1174 |
| Tokens prompt / completion | 1835317 / 22633 |
| Wall time total (s) · episodes/min | 84.7 · 11.33 |

| Family | n | success | as expected | escaped | lost |
|---|---|---|---|---|---|
| fire_only | 4 | 100% | 100% | 12/12 | 0 |
| multi_fire | 3 | 33% | 33% | 7/9 | 2 |
| fire_then_door | 5 | 80% | 80% | 12/15 | 0 |
| independent | 2 | 100% | 100% | 6/6 | 0 |
| trapped | 2 | 0% | 100% | 0/6 | 0 |

## Cases

| Case | Family | Trapped | Outcome | Escaped/lost | Alarm | Reward | Decisions | Invalid | Recov. | Sim s | Wall s | p50/p95 ms | Tokens in/out |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| test-01-fire_only | fire_only | no | success | 3/0 | yes | 1 | 11 | 3 | 2 | 34.8 | 8.8 | 766/1114 | 47324/622 |
| test-02-fire_only | fire_only | no | success | 3/0 | — | 0 | 7 | 0 | 0 | 13.7 | 4.9 | 731/1016 | 28822/333 |
| test-03-fire_only | fire_only | no | success | 3/0 | — | -1 | 36 | 22 | 9 | 55.2 | 30.1 | 746/1299 | 172794/2242 |
| test-04-fire_only | fire_only | no | success | 3/0 | — | 0 | 7 | 0 | 0 | 14.4 | 5.0 | 720/1017 | 28788/324 |
| test-05-multi_fire | multi_fire | no | partial ⚠ | 2/1 | yes | 0 | 16 | 6 | 4 | 32.0 | 11.9 | 738/1060 | 64780/912 |
| test-06-multi_fire | multi_fire | no | partial ⚠ | 2/1 | — | 0 | 11 | 1 | 2 | 19.1 | 7.8 | 735/922 | 44377/496 |
| test-07-multi_fire | multi_fire | no | success | 3/0 | — | 0 | 12 | 0 | 3 | 27.9 | 8.7 | 745/814 | 51683/590 |
| test-08-fire_then_door | fire_then_door | no | success | 3/0 | — | -1 | 31 | 12 | 11 | 47.7 | 25.8 | 774/1279 | 145854/2089 |
| test-09-fire_then_door | fire_then_door | no | success | 3/0 | yes | 1 | 12 | 0 | 3 | 30.1 | 8.4 | 684/1011 | 52306/642 |
| test-10-fire_then_door | fire_then_door | no | unresolved ⚠ | 0/0 | — | -1 | 60 | 43 | 7 | 102.7 | 45.9 | 746/1045 | 302562/3578 |
| test-11-fire_then_door | fire_then_door | no | success | 3/0 | — | 1 | 11 | 1 | 2 | 22.2 | 9.1 | 709/1369 | 48110/722 |
| test-12-fire_then_door | fire_then_door | no | success | 3/0 | yes | 1 | 18 | 6 | 5 | 49.4 | 13.2 | 719/1226 | 81549/996 |
| test-13-independent | independent | no | success | 3/0 | — | 1 | 24 | 10 | 8 | 42.2 | 19.6 | 765/1291 | 107025/1489 |
| test-14-independent | independent | no | success | 3/0 | — | 0 | 9 | 0 | 2 | 19.8 | 6.4 | 734/820 | 37758/471 |
| test-15-trapped | trapped | yes | unresolved | 0/0 | — | -1 | 60 | 50 | 5 | 98.7 | 40.9 | 630/939 | 315959/3606 |
| test-16-trapped | trapped | yes | unresolved | 0/0 | yes | -1 | 60 | 46 | 12 | 85.8 | 39.6 | 620/841 | 305626/3521 |

⚠ = not the expected outcome (success on a normal case; anything but success on a trapped one). Fire spread is seeded but the planner samples at temperature > 0: report counts, not just rates.
