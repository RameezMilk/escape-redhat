#!/usr/bin/env node
// Hackathon 2-week rule check: every DIRECT npm dependency (all workspaces) must resolve to a version
// published before the cutoff. Reads versions from package-lock.json, publish times from the npm registry.
//
//   npm run deps:audit            # exit 1 if any direct dependency was published after the cutoff
import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const CUTOFF = new Date(process.env.CUTOFF ?? '2026-10-03T00:00:00.000Z');
const root = new URL('..', import.meta.url).pathname;
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));

const manifests = [join(root, 'package.json')];
for (const dir of ['packages', 'apps']) {
  const base = join(root, dir);
  if (!existsSync(base)) continue;
  for (const d of readdirSync(base)) if (existsSync(join(base, d, 'package.json'))) manifests.push(join(base, d, 'package.json'));
}

const direct = new Map(); // name -> Set(lockKey)
for (const m of manifests) {
  const pkg = JSON.parse(readFileSync(m, 'utf8'));
  const wsDir = m.slice(root.length).replace(/\/?package\.json$/, '');
  for (const field of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(pkg[field] ?? {})) {
      if (name.startsWith('@escape/')) continue;
      const keys = [wsDir ? `${wsDir}/node_modules/${name}` : null, `node_modules/${name}`].filter(Boolean);
      const key = keys.find((k) => lock.packages?.[k]);
      if (!key) continue;
      if (!direct.has(name)) direct.set(name, new Set());
      direct.get(name).add(lock.packages[key].version);
    }
  }
}

const rows = [];
await Promise.all(
  [...direct.entries()].map(async ([name, versions]) => {
    let times = {};
    try {
      const { stdout } = await run('npm', ['view', name, 'time', '--json'], { maxBuffer: 64 * 1024 * 1024 });
      times = JSON.parse(stdout);
    } catch (e) {
      rows.push({ name, version: [...versions].join(','), published: 'LOOKUP FAILED', late: true });
      return;
    }
    for (const v of versions) {
      const t = times[v] ? new Date(times[v]) : null;
      rows.push({ name, version: v, published: t ? t.toISOString().slice(0, 10) : 'unknown', late: !t || t >= CUTOFF });
    }
  }),
);

rows.sort((a, b) => a.name.localeCompare(b.name));
console.log(`Direct npm dependencies vs cutoff ${CUTOFF.toISOString().slice(0, 10)} (hackathon 2-week rule):`);
for (const r of rows) console.log(`${r.late ? '✗' : '✓'} ${r.name.padEnd(28)} ${String(r.version).padEnd(10)} ${r.published}`);
const late = rows.filter((r) => r.late);
if (late.length) {
  console.error(`\n${late.length} dependency version(s) published on/after the cutoff or unknown.`);
  process.exit(1);
}
console.log('\nAll direct dependencies predate the cutoff.');
