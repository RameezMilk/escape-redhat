// @escape/engine — authoritative, deterministic, browser-safe simulation.
export { createEngine, SPEED_TILES_PER_SEC } from './world.js';
export { loadMap, tileIndex, inBounds, zoneAt, zoneTiles, tileDistance, tileKey } from './map.js';
export { findPath, planPath, pathCost, lineOfSight, passable, type NavMask, type PathOptions } from './nav.js';
export { HAZARD_SPECS, validatePlacement, hazardFootprint, hazardNoGo, type PlacementCode } from './placement.js';
export { RULE_CARDS, SITE_PLAN, ruleCard, ruleSources, type RuleCard, type SitePlan, type PlanSectionId } from './knowledge.js';
export { replayRun, applyInput, type RunInput, type RunInputs } from './replay.js';
export { computeResult, type ActionLogEntry, type Interruption } from './scoring.js';
export { mulberry32, type Rng } from './rng.js';
export { hashValue, canonicalJson, fnv1a } from './hash.js';
