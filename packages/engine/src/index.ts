// @escape/engine — authoritative, deterministic, browser-safe simulation.
export {
  createEngine,
  SPEED_TILES_PER_SEC,
  FIRE_SPREAD_PER_TICK,
  FIRE_BURN_TICKS,
  FIRE_SIGHT_RADIUS,
  DOOR_IGNITION_FACTOR,
  WALL_IGNITION_FACTOR,
  FLEE_RADIUS,
  SMOKE_RADIUS,
  FLEE_DESTINATION,
} from './world.js';
export {
  placesFor,
  placeName,
  atPlace,
  placeNameAt,
  zoneNear,
  doorName,
  stationName,
  anyStationName,
  destinationName,
  describeHazard,
  describeEvidence,
  joinNames,
  isOutsideZone,
  type Places,
} from './places.js';
export { loadMap, tileIndex, inBounds, zoneAt, zoneTiles, tileDistance, tileKey, roomsOf, inEarshot, type RoomId } from './map.js';
export { routeBriefing } from './routes.js';
export { findPath, planPath, pathCost, lineOfSight, passable, type NavMask, type PathOptions } from './nav.js';
export { HAZARD_SPECS, NON_FLAMMABLE_ZONES, validatePlacement, doorNear, fireFootprint, isFlammable, type PlacementCode, type PlacementCheck } from './placement.js';
export { RULE_CARDS, SITE_PLAN, ruleCard, ruleSources, type RuleCard, type SitePlan, type PlanSectionId } from './knowledge.js';
export { replayRun, applyInput, type RunInput, type RunInputs } from './replay.js';
export { computeResult, type ActionLogEntry, type Interruption } from './scoring.js';
export { mulberry32, type Rng } from './rng.js';
export { hashValue, canonicalJson, fnv1a } from './hash.js';
