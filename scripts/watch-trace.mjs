// Tail the live trace from a running server in the terminal (one line per settled decision / notable engine event).
//   node scripts/watch-trace.mjs [ws://localhost:8787/ws]
const url = process.argv[2] ?? 'ws://localhost:8787/ws';
const FINAL = new Set(['completed', 'failed', 'rejected', 'malformed', 'provider_error', 'discarded_stale', 'ignored', 'running', 'held']);
const seen = new Map();
let episode = null;

const ws = new WebSocket(url);
ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'hello' })));
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(String(ev.data));
  if (msg.type === 'welcome') {
    if (episode !== msg.episodeId) console.log(`# episode ${msg.episodeId} · ${msg.provider.label} (${msg.provider.endpointKind})`);
    episode = msg.episodeId;
    for (const row of msg.trace) show(row);
  } else if (msg.type === 'trace' && msg.episodeId === episode) {
    show(msg.row);
  } else if (msg.type === 'episode_end' && msg.episodeId === episode) {
    const r = msg.result;
    console.log(`# END ${r.outcome.status}: ${r.outcome.reason} · decisions ${r.metrics.decisions} · invalid ${r.metrics.invalidCalls} · recoveries ${r.metrics.recoveries} · reward ${r.score.reward}`);
  }
});
ws.addEventListener('close', () => {
  console.log('# socket closed');
  process.exit(0);
});

function show(row) {
  const key = `${row.status}`;
  if (seen.get(row.id) === key) return;
  if (row.kind === 'decision' && !FINAL.has(row.status)) return;
  seen.set(row.id, key);
  const t = `t=${row.simTime.toFixed(1)}s`;
  if (row.kind === 'engine') {
    console.log(`  ${t} [engine] ${row.summary}`);
    return;
  }
  const args = row.args ? JSON.stringify(row.args).slice(0, 140) : '';
  const lat = row.latencyMs ? ` ${(row.latencyMs / 1000).toFixed(1)}s` : '';
  const rec = row.recovered ? ' ↻recovered' : '';
  console.log(`${row.decisionId ?? ''} ${t} ${row.status.toUpperCase()}${rec} ${row.origin} ${args}${lat}\n      → ${row.summary}`);
}
