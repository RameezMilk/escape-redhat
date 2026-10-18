# Benchmark: escape-office-scenarios-v3 / dev

- Provider: **Nemotron 3.5 Lightning 30B-A3B** · model `escape-nemotron` · self-hosted-vllm · thinking on (≤128 tokens) · each person decides for themselves (no engine instincts)
- Harness: `v2` · decision cap default · concurrency 1 · clock lockstep
- Run: 2026-10-18T05:42:50.778Z → 2026-10-18T05:54:08.150Z · 16 cases
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
| Tool calls / invalid (rate) | 788 / 87 (11.0%) |
| Malformed responses / provider errors | 4 / 0 |
| Recoveries after an error | 56 |
| Repeated identical invalid calls | 15 |
| Re-planned after a route interruption | 3/4 |
| Hazard reported (notify with evidence or alarm) | 16/16 |
| Fire alarm pulled · mean sim s after first sighting | 16/16 · 10.7 |
| Buddy assistance completed when Daniel asked | 0/14 |
| Roster verified | 16/16 |
| Mean decisions / episode | 49.5 |
| Mean sim time to verified success (s) | 44.4 |
| Decision latency p50 / p95 (ms, n=792) | 1117 / 2199 |
| Tokens prompt / completion | 2500868 / 158108 |
| Wall time total (s) · episodes/min | 677.4 · 1.42 |

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
| dev-00-hero | hero | no | success | 5/0 | yes | 1 | 31 | 0 | 0 | 37.8 | 30.7 | 1050/2421 | 96634/6380 |
| dev-01-fire_only | fire_only | no | success | 5/0 | yes | 1 | 50 | 5 | 5 | 56.3 | 39.8 | 1137/1786 | 161209/9426 |
| dev-02-fire_only | fire_only | no | success | 5/0 | yes | 1 | 38 | 0 | 0 | 42.9 | 30.8 | 979/1700 | 118468/6849 |
| dev-03-fire_only | fire_only | no | success | 5/0 | yes | 1 | 41 | 3 | 3 | 47.7 | 40.3 | 1065/2452 | 132404/8801 |
| dev-04-fire_only | fire_only | no | success | 5/0 | yes | 1 | 49 | 2 | 1 | 44.5 | 40.8 | 1046/1780 | 153298/9340 |
| dev-05-multi_fire | multi_fire | no | success | 5/0 | yes | 1 | 53 | 2 | 2 | 46.4 | 47.2 | 1040/1725 | 164328/10620 |
| dev-06-multi_fire | multi_fire | no | success | 5/0 | yes | 1 | 44 | 1 | 1 | 40.2 | 41.0 | 1055/2276 | 135341/9331 |
| dev-07-multi_fire | multi_fire | no | success | 5/0 | yes | 1 | 46 | 4 | 4 | 46.2 | 44.0 | 1218/2803 | 146141/10562 |
| dev-08-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 50 | 1 | 2 | 53.7 | 46.7 | 1022/2253 | 156705/9828 |
| dev-09-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 45 | 3 | 2 | 36.5 | 37.0 | 1140/1707 | 142437/8598 |
| dev-10-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 41 | 2 | 2 | 42.9 | 34.6 | 1203/1735 | 127965/8048 |
| dev-11-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 48 | 10 | 1 | 38.4 | 35.4 | 1280/1861 | 153300/9044 |
| dev-12-fire_then_door | fire_then_door | no | success | 5/0 | yes | 1 | 52 | 9 | 4 | 42.7 | 42.3 | 1043/1818 | 166902/9751 |
| dev-13-independent | independent | no | success | 5/0 | yes | 1 | 38 | 2 | 2 | 49.7 | 36.1 | 1041/2285 | 122066/7592 |
| dev-14-independent | independent | no | success | 5/0 | yes | 1 | 47 | 2 | 3 | 39.5 | 39.2 | 1036/1768 | 151412/8729 |
| dev-15-trapped | trapped | yes | partial | 4/1 | yes | -1 | 119 | 41 | 24 | 53.9 | 91.2 | 1317/2332 | 372258/25209 |

⚠ = not the expected outcome (success on a normal case; anything but success on a trapped one). Fire spread is seeded but the planner samples at temperature > 0: report counts, not just rates.
