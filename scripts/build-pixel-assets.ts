// Generates the two small index files the browser asset loader needs from the vendored
// Pixel Agents assets (apps/web/public/assets). PNGs are decoded in the browser at runtime.
//
//   npx tsx scripts/build-pixel-assets.ts      (or: npm run assets:build)
//
// Uses the vendored Pixel Agents build helpers (MIT, pinned 3537e14) unchanged.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildAssetIndex, buildFurnitureCatalog } from '../apps/web/src/vendor/pixel-agents/core/src/assets/build.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(root, 'apps/web/public/assets');

const catalog = buildFurnitureCatalog(assetsDir);
const index = buildAssetIndex(assetsDir);

writeFileSync(join(assetsDir, 'furniture-catalog.json'), JSON.stringify(catalog, null, 1) + '\n');
writeFileSync(join(assetsDir, 'asset-index.json'), JSON.stringify(index, null, 1) + '\n');
console.log(
  `assets: ${catalog.length} furniture entries, ${index.characters.length} characters, ${index.floors.length} floors, ${index.walls.length} wall sets`,
);
