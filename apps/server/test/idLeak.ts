// Viewer-facing text must never show evidence ids (E1), code-like zone/door/pull-station ids (from the map), action or
// decision ids (A-007, D-003) or tile coordinates.
import type { MapData } from '@escape/contracts';
import { placesFor } from '@escape/engine';

export const idLeakRegex = (map: MapData): RegExp => new RegExp(`\\bE\\d+\\b|${placesFor(map).idPattern}|\\b[AD]-\\d+\\b|\\(\\d+,\\s*\\d+\\)`);
