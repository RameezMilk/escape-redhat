# Dataset card: `escape-office-scenarios-v2`

Synthetic scenario and benchmark dataset for **Escape from Red Hat**, a pixel-art evacuation exercise. One LLM planner (Nemotron 3.5 Lightning 30B-A3B) controls three simulated people through validated tools.

This is **ruleset 2**: fire spreads, electrical failures jam sliding doors, there are fire-alarm pull stations, there is no time limit, and people reached by the fire are lost. Ruleset 1 (a static fire plus a "blocker", with a 240 s limit) is preserved in git history and in `results/2026-10-17-vllm-h100/`.

| | |
|---|---|
| Type | Synthetic. Generated during the NVIDIA × Red Hat Small Models Hack, Raleigh NC, 2026-10-17 |
| License | CC BY 4.0 (data). Code in this repo is MIT |
| Generator | `data/scenarios/generator.ts` v2.0.0, master seed `20261017`, run with `npm run data:scenarios` |
| Map | `data/maps/office-v1.json`, built from `office-v1.ascii` by `build-map.ts`. A fictional 34×23-tile office with 4 interior electric sliding doors and 3 fire-alarm pull stations |
| Files | `cases.dev.jsonl` (16), `cases.test.jsonl` (16), `demo-hero.json` (live demo), `splits.json`, `provenance.json` (sha256 of all inputs and outputs) |
| Used by | The app boots `demo-hero` from this folder; `apps/eval/src/bench.ts` runs and scores every case; `gym/make_tasks.ts` turns cases into NeMo Gym task rows |

## What a case contains

Each line is a `ScenarioCase` (see `packages/contracts/src/types.ts`) with these fields:

- **`spawns`**: a start tile and pose for `alex` (warden), `maya` (employee) and `daniel` (visitor who uses a wheelchair).
- **`danielPreference`**: `buddy` (Daniel may ask Alex to guide him; optional in ruleset 2) or `independent`.
- **`events`**: scheduled presenter actions, each placing a **fire seed** or an **electrical failure**. Triggers:
  - `at_time` (simulated seconds);
  - `actor_enters_zone` (any person crosses into a named zone);
  - `manual` (live demo only).
- **`labels`**: `solvable`, `primaryRouteBlocked`, `expectLosses` (trapped cases only), and free-text `notes`.

## Hazards (engine rules this dataset assumes)

| Hazard | Placement | Effect | Seen within |
|---|---|---|---|
| Fire | 2×2 seed on placeable floor (not furniture, exits, outdoors or assembly) | Spreads stochastically from cell to cell across building floor (seeded in the engine); burnt-out cells stay impassable; closed doors stop it. Anyone it reaches is lost | 9 tiles, line of sight |
| Electrical failure | One interior electric sliding door: `door_a`, `door_b`, `connector`, `south_door` | The door jams shut: impassable, blocks sight and fire | 5 tiles, line of sight |

- The two **exits are manual doors** and are never electrical, so a power failure cannot lock anyone in (29 CFR 1910.36(d)(1)).
- If nobody sees a fire, the nearest person notices smoke after 15 s of simulated time.
- If a scheduled placement would land on a person, the engine retries for 3 s and then skips it (logged).

## How it was generated

1. **Spawns.** One seeded pick per actor from `map.spawnSpots`. Picks don't overlap; Daniel's spots are wheelchair-accessible.
2. **Fire seed** at t = 1 s, drawn from a *fire-location family* (below). It must be valid and keep every person's route open at placement time.
3. **Family extras:**
   - `fire_only`: nothing else.
   - `multi_fire`: a second seed from the split's other fire family, at least 3 tiles from every spawn, at t = 4–8 s.
   - `fire_then_door`: an electrical failure on a sliding door that lies on someone's shortest route given the fire, with an alternate route still open. It drops when anyone enters the zone just before that door (mid-evacuation); doors right next to someone's start room fail 3–5 s after the incident instead.
   - `independent`: Daniel prefers to evacuate on his own; half of these also get a door failure.
   - `trapped`: the fire seed is inside the Red Hat room and **both** of its doors fail at t = 1 s, sealing the room's occupants in with a spreading fire (`expectLosses: true`). Honest outcomes are `partial` or `failed`, never `success`.
4. **Labels.** A full-knowledge grid search (Dijkstra with the engine's occluded-tile cost 3) at placement time, with fire seed cells and disabled doors blocked and Daniel held to wheelchair-clearance tiles.
   - `solvable` is true if and only if every person can reach the assembly area at that moment.
   - Labels must agree under two clearance interpretations (static mask minus hazard tiles; clearance recomputed around hazards), else the case is discarded.
   - **Fire spread is stochastic and happens later in the engine**, so a `solvable` case can still end in losses if the planner is slow. The labels describe the start of the incident, not the outcome.
   - The oracle is used only for labels and scoring. The planner never sees it.
5. **Engine cross-check.** When the engine module is importable at generation time, every placement is also validated with the engine's own `validatePlacement` (recorded in `provenance.json`).

## Splits (structural hold-out)

| Split | Fire-location families | Families (count) |
|---|---|---|
| dev (16) | `rh_room_doorA` (inside the Red Hat room near door A), `lobby` | hero 1, fire_only 4, multi_fire 3, fire_then_door 5, independent 2, trapped 1 |
| test (16) | `north_corridor`, `rh_room_doorB` (inside the room near door B) | fire_only 4, multi_fire 3, fire_then_door 5, independent 2, trapped 2 |

Test fire locations never appear in dev, so prompt or harness changes tuned on dev are scored on unseen layouts. `dev-00-hero` is the live demo case with its manual drops replaced by triggers (fire at t = 1 s; `south_door` fails when anyone enters the lobby).

`splits.json` records per case: `fireFamily`, `doors`, number of fire seeds, `solvable`, `expectLosses`, `danielPreference`, `fireInitiallySeenBy`.

## Intended use

- A small, reproducible **tool-use benchmark**: does a planner select valid tools, raise the alarm or report hazards, evacuate before a spreading fire arrives, recover from `ROUTE_UNAVAILABLE` at a jammed door, and verify the roster without false completion claims?
- Baseline-versus-final comparisons on the held-out test split.

## Limitations

- **Not real human behaviour.** Nothing here is a measurement of how people evacuate. Personalities and roles are fictional.
- **Not fire science.** Fire is a simple stochastic cellular spread over floor tiles. There is no smoke, heat, toxicity, ventilation or injury model; "lost" is a game state.
- **Fictional map.** It is not the venue or any real building, and it makes no building-code or compliance claim.
- **Small sample** (32 cases), and outcomes depend on both the planner's sampling (temperature > 0) and the seeded fire. Report counts, not just rates.
- **Placements can be skipped.** A drop that would land on a person is retried for 3 s and then skipped (logged), so that run proceeds without it.
- **Triggers may not fire.** A zone-entry trigger fires only if someone actually enters that zone; a planner that picks a different route never meets the failed door.

## Real datasets considered but not integrated

| Dataset | Licence | Why not integrated |
|---|---|---|
| LEMTA evacuation drills, DOI 10.12763/XNYB9A | Etalab 2.0 | Doorway passage times from French lab drills. They don't describe this map, wheelchair users or individual behaviour, and the MVP didn't need calibration |
| Jülich bottleneck experiments, DOI 10.34735/ped.2009.6 | CC BY 4.0 | Crowd trajectories through bottlenecks. Not relevant to three people in a small office |
| NIST stair-egress data | NIST terms | Our map is a single ground level with no stairs |
| City of Raleigh building footprints | City of Raleigh open data | Exterior footprints only, with no interiors. The map is deliberately fictional |

None of these are used by the app, the scorer, or this dataset.
