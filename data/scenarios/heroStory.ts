// The scripted hero story: the demo scenario's people (demo-hero.json, where the presenter places hazards live) plus a
// fixed sequence of hazards (hero-story.json). It becomes the benchmark's dev-00-hero case and the scenario the
// server integration tests run, so both stay in step without copying coordinates.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScenarioCase, ScheduledEvent } from '../../packages/contracts/src/types.js';

export interface HeroStory {
  mapId: string;
  events: ScheduledEvent[];
  labels: ScenarioCase['labels'];
}

const here = dirname(fileURLToPath(import.meta.url));

export const loadDemoHero = (): ScenarioCase => JSON.parse(readFileSync(join(here, 'demo-hero.json'), 'utf8')) as ScenarioCase;
export const loadHeroStory = (): HeroStory => JSON.parse(readFileSync(join(here, 'hero-story.json'), 'utf8')) as HeroStory;

/** dev-00-hero: demo-hero's spawns and preferences with the story's scheduled hazards. */
export function heroStoryCase(demoHero: ScenarioCase = loadDemoHero(), story: HeroStory = loadHeroStory()): ScenarioCase {
  if (story.mapId !== demoHero.mapId) throw new Error(`hero story is for ${story.mapId}, demo-hero for ${demoHero.mapId}`);
  return { ...demoHero, caseId: 'dev-00-hero', split: 'dev', family: 'hero', events: story.events, labels: story.labels };
}
