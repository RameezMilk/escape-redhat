// Rehearsal helper: acts as the presenter's second move in the hero scenario (ruleset 2).
// Waits until Alex (escorting Daniel) — or, if there is no escort, anyone — is in the NVIDIA lobby heading for the
// exits, then drops an Electrical failure on the south sliding door (to the east exit), exactly what a presenter
// would drag in by hand. The trace shows it as a presenter placement.
//   node scripts/auto-electrical.mjs [ws://localhost:8787/ws] [col] [row]
const url = process.argv[2] ?? 'ws://localhost:8787/ws';
const col = Number(process.argv[3] ?? 26); // south_door tiles: (26,14), (27,14)
const row = Number(process.argv[4] ?? 14);
let done = false;

const ws = new WebSocket(url);
ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ type: 'hello' }));
  console.log(`waiting for the evacuation to reach the lobby; will fail the sliding door at (${col},${row})`);
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
  const actors = msg.snapshot.actors;
  const alex = actors.find((a) => a.id === 'alex');
  const escorting = alex?.escort?.partner === 'daniel' && alex.zone === 'lobby' && alex.task?.kind === 'move';
  const anyoneHeadingOut = !actors.some((a) => a.escort) && actors.some((a) => a.zone === 'lobby' && a.task?.kind === 'move' && !a.lost);
  if (escorting || anyoneHeadingOut) {
    done = true;
    ws.send(JSON.stringify({ type: 'place', kind: 'electrical', col, row }));
  }
});
ws.addEventListener('close', () => process.exit(done ? 0 : 1));
