# Benchmark: escape-office-scenarios-v2 / test

- Provider: **Nemotron 3.5 Lightning 30B-A3B** · model `escape-nemotron` · self-hosted-vllm · thinking off
- Harness: `v1` · decision cap default · concurrency 4 · clock lockstep
- Run: 2026-10-18T00:59:09.557Z → 2026-10-18T01:02:12.567Z · 16 cases
- Ruleset 2 (spreading fire, electrical doors, alarms, no time limit). Small sample (≤32 cases); single run per case; temperature > 0 and seeded fire spread, so reruns can differ.

## Aggregates

| Metric | Value |
|---|---|
| Verified success (all 3 alive, checked in, roster verified) on normal cases | 6/14 |
| False success on trapped-by-design cases | 0/2 |
| Outcome mix | success 6 · unresolved 10 |
| Outcomes matching expectation (success on normal, non-success on trapped) | 8/16 |
| People escaped and checked in | 23/48 |
| People lost — normal cases / trapped cases | 1 / 0 |
| Mean reward | -1.00 |
| Tool calls / invalid (rate) | 866 / 441 (50.9%) |
| Malformed responses / provider errors | 0 / 0 |
| Recoveries after an error | 232 |
| Repeated identical invalid calls | 184 |
| Re-planned after a route interruption | 8/11 |
| Hazard reported (notify with evidence or alarm) | 15/16 |
| Fire alarm pulled · mean sim s after first sighting | 8/16 · 19.0 |
| Buddy assistance completed when Daniel asked | 5/14 |
| Roster verified | 6/16 |
| Mean decisions / episode | 54.1 |
| Mean sim time to verified success (s) | 56.5 |
| Decision latency p50 / p95 (ms, n=866) | 713 / 1117 |
| Tokens prompt / completion | 4256746 / 52545 |
| Wall time total (s) · episodes/min | 183.0 · 5.25 |

| Family | n | success | as expected | escaped | lost |
|---|---|---|---|---|---|
| fire_only | 4 | 75% | 75% | 10/12 | 0 |
| multi_fire | 3 | 0% | 0% | 2/9 | 1 |
| fire_then_door | 5 | 40% | 40% | 6/15 | 0 |
| independent | 2 | 50% | 50% | 3/6 | 0 |
| trapped | 2 | 0% | 100% | 2/6 | 0 |

## Cases

| Case | Family | Trapped | Outcome | Escaped/lost | Alarm | Reward | Decisions | Invalid | Recov. | Sim s | Wall s | p50/p95 ms | Tokens in/out |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| test-01-fire_only | fire_only | no | success | 3/0 | — | -1 | 51 | 20 | 21 | 74.3 | 36.7 | 704/850 | 242272/2784 |
| test-02-fire_only | fire_only | no | success | 3/0 | yes | -1 | 34 | 18 | 14 | 43.4 | 24.8 | 714/833 | 160755/1960 |
| test-03-fire_only | fire_only | no | unresolved ⚠ | 1/0 | — | -1 | 60 | 27 | 18 | 87.2 | 44.5 | 705/1083 | 290577/3611 |
| test-04-fire_only | fire_only | no | success | 3/0 | yes | -1 | 34 | 19 | 12 | 50.6 | 24.1 | 703/861 | 162154/1848 |
| test-05-multi_fire | multi_fire | no | unresolved ⚠ | 0/0 | — | -1 | 60 | 37 | 17 | 106.6 | 44.9 | 715/1117 | 295163/3593 |
| test-06-multi_fire | multi_fire | no | unresolved ⚠ | 1/1 | — | -1 | 60 | 24 | 14 | 68.2 | 42.5 | 691/828 | 293731/3184 |
| test-07-multi_fire | multi_fire | no | unresolved ⚠ | 1/0 | yes | -1 | 60 | 36 | 8 | 86.3 | 45.3 | 726/1140 | 299782/3440 |
| test-08-fire_then_door | fire_then_door | no | unresolved ⚠ | 0/0 | — | -1 | 60 | 38 | 22 | 78.7 | 48.3 | 762/1084 | 302754/4071 |
| test-09-fire_then_door | fire_then_door | no | success | 3/0 | yes | -1 | 45 | 23 | 17 | 52.1 | 32.3 | 716/822 | 218696/2453 |
| test-10-fire_then_door | fire_then_door | no | unresolved ⚠ | 0/0 | — | -1 | 60 | 28 | 9 | 96.7 | 48.2 | 736/1129 | 295246/4099 |
| test-11-fire_then_door | fire_then_door | no | success | 3/0 | yes | -1 | 45 | 21 | 14 | 54.4 | 31.7 | 702/841 | 216477/2467 |
| test-12-fire_then_door | fire_then_door | no | unresolved ⚠ | 0/0 | — | -1 | 60 | 41 | 12 | 106.1 | 54.1 | 830/1231 | 307948/4546 |
| test-13-independent | independent | no | unresolved ⚠ | 0/0 | — | -1 | 60 | 21 | 18 | 101.0 | 48.6 | 726/1205 | 290974/3938 |
| test-14-independent | independent | no | success | 3/0 | yes | -1 | 57 | 19 | 12 | 64.3 | 40.6 | 687/1064 | 277536/3140 |
| test-15-trapped | trapped | yes | unresolved | 1/0 | yes | -1 | 60 | 32 | 14 | 77.1 | 42.8 | 704/1050 | 299760/3547 |
| test-16-trapped | trapped | yes | unresolved | 1/0 | yes | -1 | 60 | 37 | 10 | 86.9 | 36.0 | 564/919 | 302921/3864 |

⚠ = not the expected outcome (success on a normal case; anything but success on a trapped one). Fire spread is seeded but the planner samples at temperature > 0: report counts, not just rates.
