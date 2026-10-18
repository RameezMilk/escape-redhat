# Benchmark: escape-office-scenarios-v2 / dev

- Provider: **Nemotron 3.5 Lightning 30B-A3B** · model `escape-nemotron` · self-hosted-vllm · thinking off
- Harness: `v2` · decision cap default · concurrency 4 · clock lockstep
- Run: 2026-10-17T22:41:42.238Z → 2026-10-17T22:42:43.684Z · 16 cases
- Ruleset 2 (spreading fire, electrical doors, alarms, no time limit). Small sample (≤32 cases); single run per case; temperature > 0 and seeded fire spread, so reruns can differ.

## Aggregates

| Metric | Value |
|---|---|
| Verified success (all 3 alive, checked in, roster verified) on normal cases | 14/15 |
| False success on trapped-by-design cases | 0/1 |
| Outcome mix | success 14 · partial 1 · incomplete 1 |
| Outcomes matching expectation (success on normal, non-success on trapped) | 15/16 |
| People escaped and checked in | 43/48 |
| People lost — normal cases / trapped cases | 2 / 2 |
| Mean reward | 0.81 |
| Tool calls / invalid (rate) | 245 / 66 (26.9%) |
| Malformed responses / provider errors | 0 / 0 |
| Recoveries after an error | 48 |
| Repeated identical invalid calls | 22 |
| Re-planned after a route interruption | 6/6 |
| Hazard reported (notify with evidence or alarm) | 16/16 |
| Fire alarm pulled · mean sim s after first sighting | 2/16 · 23.3 |
| Buddy assistance completed when Daniel asked | 0/14 |
| Roster verified | 15/16 |
| Mean decisions / episode | 15.3 |
| Mean sim time to verified success (s) | 21.6 |
| Decision latency p50 / p95 (ms, n=245) | 581 / 1180 |
| Tokens prompt / completion | 1051636 / 12960 |
| Wall time total (s) · episodes/min | 61.4 · 15.62 |

| Family | n | success | as expected | escaped | lost |
|---|---|---|---|---|---|
| hero | 1 | 100% | 100% | 3/3 | 0 |
| fire_only | 4 | 75% | 75% | 10/12 | 2 |
| multi_fire | 3 | 100% | 100% | 9/9 | 0 |
| fire_then_door | 5 | 100% | 100% | 15/15 | 0 |
| independent | 2 | 100% | 100% | 6/6 | 0 |
| trapped | 1 | 0% | 100% | 0/3 | 2 |

## Cases

| Case | Family | Trapped | Outcome | Escaped/lost | Alarm | Reward | Decisions | Invalid | Recov. | Sim s | Wall s | p50/p95 ms | Tokens in/out |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| dev-00-hero | hero | no | success | 3/0 | — | 1 | 21 | 4 | 5 | 34.7 | 15.0 | 656/1180 | 91608/1112 |
| dev-01-fire_only | fire_only | no | success | 3/0 | — | 1 | 14 | 4 | 2 | 15.4 | 12.0 | 761/1292 | 58704/862 |
| dev-02-fire_only | fire_only | no | partial ⚠ | 1/2 | — | 0 | 8 | 1 | 1 | 11.4 | 5.6 | 592/1400 | 29615/411 |
| dev-03-fire_only | fire_only | no | success | 3/0 | — | 1 | 14 | 3 | 3 | 25.3 | 9.4 | 549/1250 | 55882/691 |
| dev-04-fire_only | fire_only | no | success | 3/0 | — | 1 | 10 | 1 | 1 | 13.8 | 6.9 | 629/1073 | 40804/491 |
| dev-05-multi_fire | multi_fire | no | success | 3/0 | — | 1 | 12 | 3 | 3 | 13.1 | 9.6 | 676/1283 | 50203/756 |
| dev-06-multi_fire | multi_fire | no | success | 3/0 | — | 1 | 9 | 0 | 0 | 16.1 | 5.9 | 577/927 | 35082/426 |
| dev-07-multi_fire | multi_fire | no | success | 3/0 | — | 1 | 11 | 3 | 3 | 13.1 | 8.4 | 767/1378 | 45041/690 |
| dev-08-fire_then_door | fire_then_door | no | success | 3/0 | — | 1 | 16 | 3 | 5 | 42.1 | 11.2 | 578/1144 | 66940/805 |
| dev-09-fire_then_door | fire_then_door | no | success | 3/0 | — | 1 | 12 | 0 | 3 | 25.8 | 8.4 | 666/1076 | 49673/611 |
| dev-10-fire_then_door | fire_then_door | no | success | 3/0 | — | 1 | 16 | 4 | 5 | 31.1 | 11.9 | 672/1180 | 68785/955 |
| dev-11-fire_then_door | fire_then_door | no | success | 3/0 | — | 1 | 9 | 0 | 0 | 11.4 | 6.4 | 558/1152 | 36354/433 |
| dev-12-fire_then_door | fire_then_door | no | success | 3/0 | — | 1 | 11 | 0 | 1 | 27.4 | 7.3 | 597/1192 | 45116/499 |
| dev-13-independent | independent | no | success | 3/0 | yes | 1 | 13 | 2 | 2 | 16.0 | 9.5 | 673/1187 | 54449/767 |
| dev-14-independent | independent | no | success | 3/0 | — | 1 | 9 | 0 | 0 | 17.4 | 5.7 | 606/965 | 35158/432 |
| dev-15-trapped | trapped | yes | incomplete | 0/2 | yes | -1 | 60 | 38 | 14 | 77.9 | 30.5 | 485/645 | 288222/3019 |

⚠ = not the expected outcome (success on a normal case; anything but success on a trapped one). Fire spread is seeded but the planner samples at temperature > 0: report counts, not just rates.
