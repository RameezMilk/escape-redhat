// Rehearsal helper: acts as the presenter's second move. Waits until someone is moving through a given zone (default:
// the main hallway) on their way out, then drops an Electrical failure on a sliding door (default: the reception
// door, on the way to the main entrance) — exactly what a presenter would drag in by hand. The trace shows it as a
// presenter placement. Door tiles come from the current map (data/maps/<id>.json).
//   node scripts/auto-electrical.mjs [--door reception_door] [--when-zone hallway] [--url ws://localhost:8787/ws]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const url = opt('url', 'ws://localhost:8787/ws');
const doorId = opt('door', 'reception_door');
const whenZone = opt('when-zone', 'hallway');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ids = readFileSync(join(root, 'packages/contracts/src/map-ids.generated.ts'), 'utf8');
const mapId = /DEFAULT_MAP_ID = '([^']+)'/.exec(ids)?.[1];
const map = JSON.parse(readFileSync(join(root, 'data/maps', `${mapId}.json`), 'utf8'));
const door = map.components.find((c) => c.id === doorId);
if (!door) {
  console.error(`no sliding door "${doorId}" on ${mapId}; doors: ${map.components.map((c) => c.id).join(', ')}`);
  process.exit(2);
}
const { col, row } = door.tiles[0];
let done = false;

const ws = new WebSocket(url);
ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ type: 'hello' }));
  console.log(`waiting for someone moving through ${whenZone}; will cut power to ${doorId} (${col},${row})`);
});
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(String(ev.data));
  if (msg.type === 'placement_result' && msg.kind === 'electrical') {
    console.log(msg.ok ? 'electrical failure placed' : `electrical failure rejected: ${msg.code} ${msg.reason}`);
    if (msg.ok) process.exit(0);
    done = false; // e.g. someone standing in the doorway: try again on the next snapshot
    return;
  }
  if (msg.type !== 'snapshot' || done) return;
  const headingOut = msg.snapshot.actors.some((a) => a.zone === whenZone && a.task?.kind === 'move' && !a.lost);
  if (headingOut) {
    done = true;
    ws.send(JSON.stringify({ type: 'place', kind: 'electrical', col, row }));
  }
});
ws.addEventListener('close', () => process.exit(done ? 0 : 1));
