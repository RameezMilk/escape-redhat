# Dataset card: `escape-office-scenarios-v1`

Synthetic scenario and benchmark dataset for **Escape from Red Hat**, a pixel-art evacuation exercise. In it, one LLM planner (Nemotron 3.5 Lightning 30B-A3B) controls three simulated people through validated tools.

| | |
|---|---|
| Type | Synthetic. Generated during the NVIDIA × Red Hat Small Models Hack, Raleigh NC, 2026-10-17 |
| License | CC BY 4.0 (data). Code in this repo is MIT |
| Generator | `data/scenarios/generator.ts` v1.0.0, master seed `20261017`, run with `npm run data:scenarios` |
| Map | `data/maps/office-v1.json`, built from `office-v1.ascii` by `build-map.ts`. A fictional 34×23-tile office |
| Files | `cases.dev.jsonl` (16), `cases.test.jsonl` (16), `demo-hero.json` (live demo), `splits.json`, `provenance.json` (sha256 of all inputs and outputs) |
| Used by | The app boots `demo-hero` from this folder; `apps/eval/src/bench.ts` runs and scores every case |

## What a case contains

Each line is a `ScenarioCase` (see `packages/contracts/src/types.ts`) with these fields:

- **`spawns`**: a start tile and pose for `alex` (warden), `maya` (employee) and `daniel` (visitor who uses a wheelchair).
- **`danielPreference`**: either `buddy` (Daniel asks Alex to guide him) or `independent`.
- **`events`**: scheduled presenter actions, each one placing a fire or a blocker. Triggers:
  - `at_time` (simulated seconds);
  - `actor_enters_zone` (any person crosses into a named zone);
  - `manual` (live demo only).
- **`labels`**: `solvable`, `primaryRouteBlocked`, and free-text `notes`.

**Hazard geometry** (it must match the engine):

| Hazard | Footprint | No-go buffer | Seen within |
|---|---|---|---|
| Fire | 2×2 | 1 tile | 8 tiles, line of sight |
| Blocker | 2×2 | 0 tiles | 4 tiles, line of sight |

If nobody sees a fire, the nearest person notices smoke after 15 s of simulated time. This is an engine rule.

## How it was generated

1. **Spawns.** The generator makes one seeded pick per actor from `map.spawnSpots`. Picks don't overlap, and all of Daniel's spots are wheelchair-accessible.
2. **Fire.** A valid 2×2 placement drawn from a *fire-location family*. A valid placement:
   - is on floor in a hazard-placeable zone;
   - avoids furniture;
   - has nobody standing inside its buffer at t = 1 s.
3. **Blocker** (`fire_then_blocker`, and some `independent` cases):
   - It is placed on a chokepoint: `south_branch`, `connector`, `door_a`, `door_b`, or the west end of the north corridor.
   - The chokepoint must lie on some person's shortest route, given the fire.
   - An alternate route must still exist.
   - It drops *mid-evacuation*, when anyone enters the zone just before that chokepoint. Timed drops on doorways were excluded because they can land on a person.
4. **Unsolvable.** Fire and blocker both drop at t = 1 s and leave at least one person with no route. The expected honest outcome is `unresolved`, never `success`.
5. **Labels.** The generator searches the grid with full knowledge, using Dijkstra with the engine's occluded-tile cost 3.
   - `solvable` is true if and only if every person can reach the assembly area with all of the case's hazards present. Daniel is held to wheelchair-clearance tiles.
   - Each label must agree under two clearance interpretations: (a) the static clearance mask minus hazard tiles, and (b) clearance recomputed around hazards. Cases where they disagree are discarded.
   - This oracle is used only for labels and scoring. The planner never sees it.

## Splits (structural hold-out)

| Split | Fire-location families | Families (count) |
|---|---|---|
| dev (16) | `rh_room_doorA` (inside the Red Hat room near door A), `lobby` | hero 1, fire_only 5, fire_then_blocker 6, independent 2, unsolvable 2 |
| test (16) | `north_corridor`, `rh_room_doorB` (inside the room near door B) | fire_only 5, fire_then_blocker 6, independent 3, unsolvable 2 |

Test fire locations never appear in dev, so prompt or harness changes tuned on dev are scored on unseen layouts. `dev-00-hero` is the live demo case, with its manual drops replaced by triggers.

Corridor fires (test) are usually not visible to anyone at t = 1 s; they rely on the 15 s smoke-notice rule. `splits.json` records per case:
- `fireInitiallySeenBy`;
- `chokepoint`;
- `fireFamily`;
- `danielPreference`.

## Intended use

- A small, reproducible **tool-use benchmark**. It asks whether a planner selects valid tools, reports hazards, recovers from `ROUTE_UNAVAILABLE`, honours consent-based assistance, and verifies the roster without false completion claims.
- Baseline-versus-final comparisons on the held-out test split.

## Limitations

- **Not real human behaviour.** Nothing here is a measurement of how people evacuate. Personalities and roles are fictional.
- **No fire dynamics.** Fire is a static, impassable footprint. There is no smoke spread, no heat, and no injury model.
- **Fictional map.** It is not the venue or any real building, and it makes no building-code or compliance claim.
- **Small sample** (32 cases). Report counts, not just rates.
- **Placements can be skipped.** A mid-evacuation drop that would land on a person is rejected by the engine and logged, so that run proceeds without the blocker.
- **Triggers may not fire.** A zone-entry trigger fires only if someone actually enters that zone. A planner that picks a different route never meets the blocker.

## Real datasets considered but not integrated

| Dataset | Licence | Why not integrated |
|---|---|---|
| LEMTA evacuation drills, DOI 10.12763/XNYB9A | Etalab 2.0 | Doorway passage times from French lab drills. They don't describe this map, wheelchair users or individual behaviour, and the MVP didn't need calibration |
| Jülich bottleneck experiments, DOI 10.34735/ped.2009.6 | CC BY 4.0 | Crowd trajectories through bottlenecks. Not relevant to three people in a small office |
| NIST stair-egress data | NIST terms | Our map is a single ground level with no stairs |
| City of Raleigh building footprints | City of Raleigh open data | Exterior footprints only, with no interiors. The map is deliberately fictional |

None of these are used by the app, the scorer, or this dataset.
