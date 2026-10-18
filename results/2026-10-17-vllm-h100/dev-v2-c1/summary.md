# Benchmark: escape-office-scenarios-v1 / dev

- Provider: **Nemotron 3.5 Lightning 30B-A3B** · model `escape-nemotron` · self-hosted-vllm · thinking off
- Harness: `v2` · decision cap default · concurrency 1 · clock lockstep
- Run: 2026-10-17T21:02:43.132Z → 2026-10-17T21:05:32.713Z · 16 cases
- Small sample (≤32 cases); single run per case; temperature > 0 so reruns can differ.

## Aggregates

| Metric | Value |
|---|---|
| Verified success on solvable cases | 14/14 |
| Label-consistent outcomes (success iff solvable) | 16/16 |
| False success on unsolvable cases | 0 |
| Mean reward | 0.75 |
| Tool calls / invalid (rate) | 367 / 74 (20.2%) |
| Malformed responses / provider errors | 0 / 0 |
| Recoveries after an error | 79 |
| Repeated identical invalid calls | 32 |
| Re-planned after a route interruption | 8/9 |
| Hazard reported with evidence | 16/16 |
| Assistance fulfilled when required | 12/14 |
| Roster verified | 14/16 |
| Mean decisions / episode | 22.9 |
| Mean sim time to verified completion (s) | 27.9 |
| Decision latency p50 / p95 (ms, n=367) | 462 / 625 |
| Tokens prompt / completion | 1357652 / 16956 |
| Wall time total (s) · episodes/min | 169.6 · 5.66 |

| Family | n | success | label-consistent |
|---|---|---|---|
| hero | 1 | 100% | 100% |
| fire_only | 5 | 100% | 100% |
| fire_then_blocker | 6 | 100% | 100% |
| independent | 2 | 100% | 100% |
| unsolvable | 2 | 0% | 100% |

## Cases

| Case | Family | Solvable | Outcome | Reward | Decisions | Invalid | Recov. | Sim s | Wall s | p50/p95 ms | Tokens in/out |
|---|---|---|---|---|---|---|---|---|---|---|---|
| dev-00-hero | hero | yes | success | 1 | 24 | 2 | 3 | 30.9 | 11.6 | 501/610 | 90117/1193 |
| dev-01-fire_only | fire_only | yes | success | 1 | 18 | 1 | 1 | 19.1 | 8.7 | 492/643 | 64746/933 |
| dev-02-fire_only | fire_only | yes | success | 1 | 18 | 1 | 1 | 16.8 | 7.5 | 426/577 | 64246/823 |
| dev-03-fire_only | fire_only | yes | success | 1 | 14 | 1 | 1 | 18.1 | 5.3 | 347/580 | 48639/592 |
| dev-04-fire_only | fire_only | yes | success | 1 | 16 | 2 | 2 | 16.2 | 6.5 | 394/569 | 57696/714 |
| dev-05-fire_only | fire_only | yes | success | 1 | 17 | 2 | 2 | 21.8 | 7.8 | 462/627 | 59843/754 |
| dev-06-fire_then_blocker | fire_then_blocker | yes | success | 1 | 25 | 3 | 4 | 34.8 | 11.5 | 441/612 | 92435/1149 |
| dev-07-fire_then_blocker | fire_then_blocker | yes | success | 1 | 25 | 3 | 5 | 38.8 | 11.2 | 462/562 | 94305/1131 |
| dev-08-fire_then_blocker | fire_then_blocker | yes | success | 1 | 30 | 6 | 7 | 34.3 | 14.8 | 507/660 | 112329/1539 |
| dev-09-fire_then_blocker | fire_then_blocker | yes | success | 1 | 22 | 2 | 4 | 32.9 | 8.6 | 348/522 | 79229/868 |
| dev-10-fire_then_blocker | fire_then_blocker | yes | success | 1 | 23 | 4 | 4 | 32.9 | 10.1 | 412/546 | 85236/1076 |
| dev-11-fire_then_blocker | fire_then_blocker | yes | success | 1 | 19 | 2 | 3 | 27.9 | 8.9 | 460/667 | 69491/859 |
| dev-12-independent | independent | yes | success | 1 | 24 | 3 | 4 | 42.5 | 11.9 | 496/756 | 92735/1084 |
| dev-13-independent | independent | yes | success | 1 | 12 | 0 | 0 | 24.1 | 4.8 | 317/575 | 42611/462 |
| dev-14-unsolvable | unsolvable | no | unresolved | -1 | 40 | 21 | 20 | 59.0 | 18.3 | 465/614 | 150041/1727 |
| dev-15-unsolvable | unsolvable | no | unresolved | -1 | 40 | 21 | 18 | 60.1 | 22.0 | 525/773 | 153953/2052 |

⚠ = outcome inconsistent with the solvability label. Small sample: report counts, not just rates.
