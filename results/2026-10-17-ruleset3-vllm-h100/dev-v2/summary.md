# Benchmark: escape-office-scenarios-v2 / dev

- Provider: **Nemotron 3.5 Lightning 30B-A3B** · model `escape-nemotron` · self-hosted-vllm · thinking off
- Harness: `v2` · decision cap default · concurrency 4 · clock lockstep
- Run: 2026-10-18T00:56:18.759Z → 2026-10-18T00:57:44.284Z · 16 cases
- Ruleset 2 (spreading fire, electrical doors, alarms, no time limit). Small sample (≤32 cases); single run per case; temperature > 0 and seeded fire spread, so reruns can differ.

## Aggregates

| Metric | Value |
|---|---|
| Verified success (all 3 alive, checked in, roster verified) on normal cases | 14/15 |
| False success on trapped-by-design cases | 0/1 |
| Outcome mix | success 14 · partial 1 · unresolved 1 |
| Outcomes matching expectation (success on normal, non-success on trapped) | 15/16 |
| People escaped and checked in | 44/48 |
| People lost — normal cases / trapped cases | 1 / 0 |
| Mean reward | 0.44 |
| Tool calls / invalid (rate) | 352 / 111 (31.5%) |
| Malformed responses / provider errors | 0 / 0 |
| Recoveries after an error | 66 |
| Repeated identical invalid calls | 37 |
| Re-planned after a route interruption | 8/8 |
| Hazard reported (notify with evidence or alarm) | 15/16 |
| Fire alarm pulled · mean sim s after first sighting | 11/16 · 13.7 |
| Buddy assistance completed when Daniel asked | 0/14 |
| Roster verified | 15/16 |
| Mean decisions / episode | 22.0 |
| Mean sim time to verified success (s) | 29.9 |
| Decision latency p50 / p95 (ms, n=352) | 692 / 1157 |
| Tokens prompt / completion | 1575620 / 20700 |
| Wall time total (s) · episodes/min | 85.5 · 11.22 |

| Family | n | success | as expected | escaped | lost |
|---|---|---|---|---|---|
| hero | 1 | 100% | 100% | 3/3 | 0 |
| fire_only | 4 | 100% | 100% | 12/12 | 0 |
| multi_fire | 3 | 100% | 100% | 9/9 | 0 |
| fire_then_door | 5 | 80% | 80% | 14/15 | 1 |
| independent | 2 | 100% | 100% | 6/6 | 0 |
| trapped | 1 | 0% | 100% | 0/3 | 0 |

## Cases

| Case | Family | Trapped | Outcome | Escaped/lost | Alarm | Reward | Decisions | Invalid | Recov. | Sim s | Wall s | p50/p95 ms | Tokens in/out |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dev-00-hero | hero | no | success | 3/0 | yes | 1 | 21 | 3 | 5 | 42.3 | 15.7 | 788/887 | 93943/1116 |
| dev-01-fire_only | fire_only | no | success | 3/0 | — | 1 | 9 | 1 | 1 | 13.1 | 7.5 | 824/1199 | 37771/547 |
| dev-02-fire_only | fire_only | no | success | 3/0 | yes | 1 | 22 | 2 | 6 | 38.0 | 16.7 | 762/1056 | 95049/1235 |
| dev-03-fire_only | fire_only | no | success | 3/0 | yes | -1 | 26 | 9 | 5 | 42.9 | 21.8 | 766/1195 | 115329/1681 |
| dev-04-fire_only | fire_only | no | success | 3/0 | — | 1 | 11 | 0 | 0 | 13.5 | 7.6 | 686/1017 | 47459/548 |
| dev-05-multi_fire | multi_fire | no | success | 3/0 | yes | 1 | 16 | 2 | 2 | 27.5 | 13.3 | 702/1282 | 71574/1083 |
| dev-06-multi_fire | multi_fire | no | success | 3/0 | — | 1 | 16 | 3 | 2 | 21.8 | 12.2 | 828/1015 | 66500/878 |
| dev-07-multi_fire | multi_fire | no | success | 3/0 | yes | 1 | 14 | 2 | 1 | 27.5 | 11.3 | 726/1222 | 61829/926 |
| dev-08-fire_then_door | fire_then_door | no | success | 3/0 | yes | 1 | 20 | 4 | 6 | 40.7 | 14.8 | 679/1161 | 91946/1148 |
| dev-09-fire_then_door | fire_then_door | no | partial ⚠ | 2/1 | yes | -1 | 55 | 27 | 15 | 77.6 | 36.3 | 631/880 | 231415/3010 |
| dev-10-fire_then_door | fire_then_door | no | success | 3/0 | yes | 1 | 15 | 2 | 4 | 33.3 | 10.7 | 715/1236 | 67135/819 |
| dev-11-fire_then_door | fire_then_door | no | success | 3/0 | yes | 1 | 20 | 2 | 2 | 29.8 | 15.0 | 714/1181 | 88096/1179 |
| dev-12-fire_then_door | fire_then_door | no | success | 3/0 | yes | -1 | 18 | 7 | 5 | 35.2 | 14.7 | 814/1225 | 76882/1077 |
| dev-13-independent | independent | no | success | 3/0 | yes | 1 | 14 | 2 | 2 | 29.8 | 10.6 | 691/1203 | 59989/747 |
| dev-14-independent | independent | no | success | 3/0 | — | 0 | 15 | 2 | 3 | 23.2 | 10.4 | 689/893 | 58769/775 |
| dev-15-trapped | trapped | yes | unresolved | 0/0 | — | -1 | 60 | 43 | 7 | 84.9 | 36.2 | 583/842 | 311934/3931 |

⚠ = not the expected outcome (success on a normal case; anything but success on a trapped one). Fire spread is seeded but the planner samples at temperature > 0: report counts, not just rates.
