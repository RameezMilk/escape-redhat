// Prints the medians fire.test.ts pins, from the same setups (packages/engine/test/fireSetups.ts), so the bands can be
// re-pinned after a map or fire-tuning change:  npx tsx scripts/measure-fire.ts
import { FIRE_SPREAD_PER_TICK, WALL_IGNITION_FACTOR } from '../packages/engine/src/index.js';
import { FIRE_SITES, measureGrowth, measureReach, measureSealed, measureWalls, med } from '../packages/engine/test/fireSetups.js';
import { map } from '../packages/engine/test/helpers.js';

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b).join(', ');
console.log(`${map.id} · FIRE_SPREAD_PER_TICK ${FIRE_SPREAD_PER_TICK} · WALL_IGNITION_FACTOR ${WALL_IGNITION_FACTOR}`);
const g = measureGrowth();
console.log(`growth   floor cells median @20 s ${med(g.at20)} [${sorted(g.at20)}] · @40 s ${med(g.at40)} [${sorted(g.at40)}]`);
const r = measureReach();
const { first, second } = FIRE_SITES.reach;
console.log(`reach    → ${first} median ${med(r.first)} s · → ${second} median ${med(r.second)} s (${r.second.filter((t) => t <= 150).length}/${r.second.length} within 150 s)`);
const s = measureSealed();
console.log(`sealed   ${FIRE_SITES.sealed.room}: escaped ${s.escaped}/15 · median hold ${med(s.delays)} s`);
const w = measureWalls();
console.log(`walls    first wall ignition median ${med(w.firstWall)} s (n ${w.firstWall.length}/${w.runs}) · far zone within 120 s ${w.nextRoom}/${w.runs}`);
