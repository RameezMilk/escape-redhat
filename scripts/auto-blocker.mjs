// Rehearsal helper: acts as the presenter's second move in the hero scenario.
// Waits until Alex (escorting Daniel) is in the NVIDIA lobby heading for the exits, then drops the Blocker in the
// south branch — exactly what a presenter would drag in by hand. The trace shows it as a presenter placement.
//   node scripts/auto-blocker.mjs [ws://localhost:8787/ws] [col] [row]
const url = process.argv[2] ?? 'ws://localhost:8787/ws';
const col = Number(process.argv[3] ?? 26);
const row = Number(process.argv[4] ?? 15);
let done = false;

const ws = new WebSocket(url);
ws.addEventListener('open', () => {
  ws.send(JSON.stringify({ type: 'hello' }));
  console.log(`waiting for Alex + Daniel to enter the lobby; will place blocker at (${col},${row})`);
});
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(String(ev.data));
  if (msg.type === 'placement_result' && msg.kind === 'blocker') {
    console.log(msg.ok ? 'blocker placed' : `blocker rejected: ${msg.code} ${msg.reason}`);
    if (msg.ok) process.exit(0);
    done = false; // try again on the next snapshot
    return;
  }
  if (msg.type !== 'snapshot' || done) return;
  const alex = msg.snapshot.actors.find((a) => a.id === 'alex');
  if (alex?.escort?.partner === 'daniel' && alex.zone === 'lobby' && alex.task?.kind === 'move') {
    done = true;
    ws.send(JSON.stringify({ type: 'place', kind: 'blocker', col, row }));
  }
});
ws.addEventListener('close', () => process.exit(done ? 0 : 1));
