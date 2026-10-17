// WebSocket client: /ws (Vite proxies to the server in dev; same origin in production).
// Auto-reconnects with backoff; on reconnect the server's welcome restores the full snapshot + trace.
import type { ClientMessage, ServerMessage } from '@escape/contracts';

import { store } from '../state/store';

type Sender = (msg: ClientMessage) => void;

let ws: WebSocket | null = null;
let retry = 0;
let stopped = false;
let override: Sender | null = null;

function url(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

export function connect(): void {
  stopped = false;
  store.setConnection('connecting');
  const sock = new WebSocket(url());
  ws = sock;
  sock.onopen = () => {
    retry = 0;
    store.setConnection('open');
    sock.send(JSON.stringify({ type: 'hello' } satisfies ClientMessage));
  };
  sock.onmessage = (ev) => {
    try {
      store.handle(JSON.parse(String(ev.data)) as ServerMessage);
    } catch (err) {
      console.warn('[ws] bad message', err);
    }
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    store.setConnection('closed');
    if (stopped) return;
    const delay = Math.min(8000, 400 * 2 ** retry++);
    setTimeout(() => !stopped && connect(), delay);
  };
  sock.onerror = () => sock.close();
}

export function disconnect(): void {
  stopped = true;
  ws?.close();
}

/** Fixture mode routes client commands to the fake source instead of the socket. */
export function setSenderOverride(fn: Sender | null): void {
  override = fn;
}

export function send(msg: ClientMessage): void {
  if (override) {
    override(msg);
    return;
  }
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  else store.toast('Not connected to the simulation server.', 'error');
}
