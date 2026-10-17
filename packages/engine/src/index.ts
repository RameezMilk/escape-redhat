// @escape/engine — authoritative, deterministic, browser-safe simulation.
export { createEngine, SPEED_TILES_PER_SEC, FIRE_SPREAD_PER_TICK, FIRE_BURN_TICKS, FIRE_SIGHT_RADIUS } from './world.js';
export { loadMap, tileIndex, inBounds, zoneAt, zoneTiles, tileDistance, tileKey } from './map.js';
export { findPath, planPath, pathCost, lineOfSight, passable, type NavMask, type PathOptions } from './nav.js';
export { HAZARD_SPECS, NON_FLAMMABLE_ZONES, validatePlacement, doorNear, fireFootprint, isFlammable, type PlacementCode, type PlacementCheck } from './placement.js';
export { RULE_CARDS, SITE_PLAN, ruleCard, ruleSources, type RuleCard, type SitePlan, type PlanSectionId } from './knowledge.js';
export { replayRun, applyInput, type RunInput, type RunInputs } from './replay.js';
export { computeResult, type ActionLogEntry, type Interruption } from './scoring.js';
export { mulberry32, type Rng } from './rng.js';
export { hashValue, canonicalJson, fnv1a } from './hash.js';
