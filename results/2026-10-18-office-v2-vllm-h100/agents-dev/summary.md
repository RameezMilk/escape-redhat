# Benchmark: escape-office-scenarios-v3 / dev

- Provider: **Nemotron 3.5 Lightning 30B-A3B** · model `escape-nemotron` · self-hosted-vllm · thinking on (≤128 tokens) · each person decides for themselves (no engine instincts)
- Harness: `v2` · decision cap default · concurrency 1 · clock lockstep
- Run: 2026-10-18T08:01:23.835Z → 2026-10-18T08:12:46.136Z · 16 cases
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
| Mean reward | 0.88 |
| Tool calls / invalid (rate) | 753 / 76 (10.1%) |
| Malformed responses / provider errors | 13 / 0 |
| Recoveries after an error | 45 |
| Repeated identical invalid calls | 9 |
| Re-planned after a route interruption | 2/3 |
| Hazard reported (notify with evidence or alarm) | 16/16 |
| Fire alarm pulled · mean sim s after first sighting | 16/16 · 10.7 |
| Buddy assistance completed when Daniel asked | 0/14 |
| Roster verified | 16/16 |
| Mean decisions / episode | 47.9 |
| Mean sim time to verified success (s) | 44.4 |
| Decision latency p50 / p95 (ms, n=766) | 1135 / 2067 |
| Tokens prompt / completion | 2395287 / 160283 |
| Wall time total (s) · episodes/min | 682.3 · 1.41 |

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
| dev-00-hero | hero | no | success | 5/0 | yes | 1 | 44 | 2 | 1 | 44.7 | 43.0 | 1047/2069 | 139141/9285 |
| dev-01-fire_only | fire_only | no | success | 5/0 | yes | 1 | 33 | 1 | 1 | 35.8 | 28.6 | 1035/2078 | 103614/6656 |
| dev-02-fire_only | fire_only | no | success | 5/0 | yes | 1 | 36 | 1 | 1 | 42.9 | 31.4 | 1047/2041 | 111682/6817 |
| dev-03-fire_only | fire_only | no | success | 5/0 | yes | 1 | 45 | 2 | 2 | 46.0 | 38.0 | 1106/1984 | 145992/8573 |
| dev-04-fire_only | fire_only | no | success | 5/0 | yes | 1 | 32 | 1 | 1 | 41.5 | 30.9 | 1054/3439 | 100617/7086 |
| dev-05-multi_fire | multi_fire | no | success | 5/0 | yes | 1 | 57 | 4 | 2 | 46.8 | 67.0 | 1196/4867 | 177556/15712 |
| dev-06-multi_fire | multi_fire | no | success | 5/0 | yes | 1 | 41 | 1 | 1 | 32.9 | 35.1 | 1105/2048 | 126253/7956 |
| dev-07-multi_fire | multi_fire | no | success | 5/0 | yes | 1 | 42 | 1 | 1 | 55.6 | 40.9 | 1162/2763 | 130942/9597 |
| dev-08-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 56 | 1 | 2 | 61.9 | 53.3 | 1116/2081 | 176227/12111 |
| dev-09-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 39 | 2 | 1 | 33.3 | 31.3 | 1046/1967 | 120143/6936 |
| dev-10-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 43 | 2 | 2 | 40.8 | 38.3 | 1062/1931 | 127438/8738 |
| dev-11-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 64 | 7 | 2 | 55.7 | 58.4 | 1223/2029 | 199833/14160 |
| dev-12-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 46 | 7 | 5 | 37.9 | 42.6 | 1181/2798 | 147733/10075 |
| dev-13-independent | independent | no | success | 5/0 | yes | 1 | 49 | 3 | 3 | 52.8 | 43.8 | 1027/1956 | 155985/9814 |
| dev-14-independent | independent | no | success | 5/0 | yes | 1 | 30 | 0 | 0 | 38.0 | 21.5 | 1128/1993 | 94892/5365 |
| dev-15-trapped | trapped | yes | partial | 4/1 | yes | -1 | 109 | 41 | 20 | 57.9 | 78.2 | 1273/1930 | 337239/21402 |

⚠ = not the expected outcome (success on a normal case; anything but success on a trapped one). Fire spread is seeded but the planner samples at temperature > 0: report counts, not just rates.
