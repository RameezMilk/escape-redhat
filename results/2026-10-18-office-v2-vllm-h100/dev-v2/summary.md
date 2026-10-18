# Benchmark: escape-office-scenarios-v3 / dev

- Provider: **Nemotron 3.5 Lightning 30B-A3B** · model `escape-nemotron` · self-hosted-vllm · thinking off · one central planner
- Harness: `v2` · decision cap default · concurrency 4 · clock lockstep
- Run: 2026-10-18T08:34:12.104Z → 2026-10-18T08:36:11.703Z · 16 cases
- Ruleset 2 (spreading fire, electrical doors, alarms, no time limit). Small sample (≤32 cases); single run per case; temperature > 0 and seeded fire spread, so reruns can differ.

## Aggregates

| Metric | Value |
|---|---|
| Verified success (all 5 alive, checked in, roster verified) on normal cases | 15/15 |
| False success on trapped-by-design cases | 0/1 |
| Outcome mix | success 15 · partial 1 |
| Outcomes matching expectation (success on normal, non-success on trapped) | 16/16 |
| People escaped and checked in | 79/80 |
| People lost — normal cases / trapped cases | 0 / 1 |
| Mean reward | 0.63 |
| Tool calls / invalid (rate) | 517 / 154 (29.8%) |
| Malformed responses / provider errors | 0 / 0 |
| Recoveries after an error | 69 |
| Repeated identical invalid calls | 38 |
| Re-planned after a route interruption | 4/5 |
| Hazard reported (notify with evidence or alarm) | 16/16 |
| Fire alarm pulled · mean sim s after first sighting | 15/16 · 7.6 |
| Buddy assistance completed when Daniel asked | 0/14 |
| Roster verified | 16/16 |
| Mean decisions / episode | 32.3 |
| Mean sim time to verified success (s) | 33.3 |
| Decision latency p50 / p95 (ms, n=517) | 751 / 1144 |
| Tokens prompt / completion | 2737849 / 30062 |
| Wall time total (s) · episodes/min | 119.6 · 8.03 |

| Family | n | success | as expected | escaped | lost |
|---|---|---|---|---|---|
| hero | 1 | 100% | 100% | 5/5 | 0 |
| fire_only | 4 | 100% | 100% | 20/20 | 0 |
| multi_fire | 3 | 100% | 100% | 15/15 | 0 |
| fire_then_door | 5 | 100% | 100% | 25/25 | 0 |
| independent | 2 | 100% | 100% | 10/10 | 0 |
| trapped | 1 | 0% | 100% | 4/5 | 1 |

## Cases

| Case | Family | Trapped | Outcome | Escaped/lost | Alarm | Reward | Decisions | Invalid | Recov. | Sim s | Wall s | p50/p95 ms | Tokens in/out |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dev-00-hero | hero | no | success | 5/0 | yes | 1 | 42 | 8 | 14 | 56.0 | 31.9 | 730/1014 | 224286/2334 |
| dev-01-fire_only | fire_only | no | success | 5/0 | yes | 1 | 23 | 5 | 3 | 18.5 | 19.5 | 789/1277 | 118345/1467 |
| dev-02-fire_only | fire_only | no | success | 5/0 | yes | 1 | 29 | 6 | 4 | 28.3 | 23.1 | 798/1006 | 148676/1671 |
| dev-03-fire_only | fire_only | no | success | 5/0 | yes | 1 | 30 | 6 | 4 | 36.9 | 24.0 | 775/1084 | 156586/1725 |
| dev-04-fire_only | fire_only | no | success | 5/0 | yes | 1 | 29 | 6 | 4 | 24.2 | 23.2 | 781/1193 | 146406/1773 |
| dev-05-multi_fire | multi_fire | no | success | 5/0 | yes | 1 | 31 | 7 | 5 | 38.1 | 24.2 | 780/956 | 158619/1731 |
| dev-06-multi_fire | multi_fire | no | success | 5/0 | yes | 1 | 21 | 3 | 1 | 19.5 | 16.6 | 789/914 | 110502/1165 |
| dev-07-multi_fire | multi_fire | no | success | 5/0 | yes | 1 | 31 | 13 | 4 | 38.9 | 25.0 | 766/1294 | 161570/1934 |
| dev-08-fire_then_door | fire_then_door | no | success | 5/0 | yes | -1 | 34 | 6 | 3 | 46.0 | 24.5 | 722/848 | 171563/1691 |
| dev-09-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 16 | 1 | 1 | 19.2 | 12.2 | 779/1283 | 80953/902 |
| dev-10-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 32 | 12 | 5 | 48.3 | 24.7 | 757/1272 | 169904/1748 |
| dev-11-fire_then_door | fire_then_door | no | success | 5/0 | yes | -1 | 52 | 15 | 6 | 39.4 | 43.0 | 753/1472 | 276244/3549 |
| dev-12-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 24 | 7 | 3 | 24.9 | 19.1 | 799/1015 | 131568/1330 |
| dev-13-independent | independent | no | success | 5/0 | yes | 1 | 21 | 1 | 0 | 36.5 | 15.9 | 764/944 | 106952/1095 |
| dev-14-independent | independent | no | success | 5/0 | yes | 1 | 31 | 10 | 3 | 24.3 | 22.8 | 716/866 | 159356/1690 |
| dev-15-trapped | trapped | yes | partial | 4/1 | — | -1 | 71 | 48 | 9 | 89.0 | 43.6 | 586/785 | 416319/4257 |

⚠ = not the expected outcome (success on a normal case; anything but success on a trapped one). Fire spread is seeded but the planner samples at temperature > 0: report counts, not just rates.
