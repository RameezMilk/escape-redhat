// Client state: a tiny external store fed by the WebSocket (or the ?fixture=1 source).
// The canvas render loop reads the two latest snapshots directly (no React re-render per frame);
// React components subscribe to the coarse UI state via useStore().
import { useSyncExternalStore } from 'react';

import type {
  ActorId,
  BubbleMessage,
  CaseSummary,
  EpisodeResult,
  ProviderInfo,
  RunSummary,
  ServerMessage,
  Snapshot,
  TraceRow,
} from '@escape/contracts';

export interface ActiveBubble {
  id: number;
  actor: ActorId;
  text: string;
  kind: BubbleMessage['kind'];
  expiresAt: number;
  createdAt: number;
}

export interface Toast {
  id: number;
  text: string;
  tone: 'error' | 'info';
  expiresAt: number;
}

export interface UiState {
  connection: 'connecting' | 'open' | 'closed';
  source: 'live' | 'fixture';
  episodeId: string | null;
  snapshot: Snapshot | null;
  trace: TraceRow[];
  provider: ProviderInfo | null;
  cases: CaseSummary[];
  runs: RunSummary[];
  result: EpisodeResult | null;
  bubbles: ActiveBubble[];
  toasts: Toast[];
  mapId: string | null;
}

/** Timestamped snapshot for interpolation. */
export interface TimedSnapshot {
  at: number;
  snap: Snapshot;
}

type Listener = () => void;

class Store {
  private state: UiState = {
    connection: 'connecting',
    source: 'live',
    episodeId: null,
    snapshot: null,
    trace: [],
    provider: null,
    cases: [],
    runs: [],
    result: null,
    bubbles: [],
    toasts: [],
    mapId: null,
  };
  private listeners = new Set<Listener>();
  private nextId = 1;
  /** Last two snapshots for render-loop interpolation. */
  prev: TimedSnapshot | null = null;
  curr: TimedSnapshot | null = null;

  getState = (): UiState => this.state;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private set(patch: Partial<UiState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  setConnection(connection: UiState['connection']): void {
    if (connection !== this.state.connection) this.set({ connection });
  }

  setSource(source: UiState['source']): void {
    this.set({ source });
  }

  private pushSnapshot(snap: Snapshot): void {
    const at = performance.now();
    // A reset/new episode or a backwards jump snaps instead of interpolating.
    if (!this.curr || this.curr.snap.episodeId !== snap.episodeId || snap.tick < this.curr.snap.tick) {
      this.prev = { at, snap };
    } else {
      this.prev = this.curr;
    }
    this.curr = { at, snap };
  }

  handle(msg: ServerMessage): void {
    if (msg.type === 'welcome') {
      this.prev = null;
      this.curr = null;
      this.pushSnapshot(msg.snapshot);
      this.set({
        episodeId: msg.episodeId,
        snapshot: msg.snapshot,
        trace: msg.trace,
        provider: msg.provider,
        cases: msg.cases,
        runs: msg.runs,
        result: msg.result,
        mapId: msg.mapId,
        bubbles: [],
      });
      return;
    }
    // Drop messages from any episode other than the current one (stale after reset).
    if (msg.episodeId !== this.state.episodeId) {
      if (msg.type === 'snapshot' && this.state.episodeId === null) {
        // no welcome yet — ignore
      }
      return;
    }
    switch (msg.type) {
      case 'snapshot':
        this.pushSnapshot(msg.snapshot);
        this.set({ snapshot: msg.snapshot });
        break;
      case 'trace': {
        const trace = this.state.trace;
        const i = trace.findIndex((r) => r.id === msg.row.id);
        const next = i >= 0 ? [...trace.slice(0, i), msg.row, ...trace.slice(i + 1)] : [...trace, msg.row];
        this.set({ trace: next });
        break;
      }
      case 'bubble': {
        const now = performance.now();
        const others = this.state.bubbles.filter((b) => b.actor !== msg.actor || b.kind === 'alert');
        this.set({
          bubbles: [
            ...others.filter((b) => b.expiresAt > now),
            { id: this.nextId++, actor: msg.actor, text: msg.text, kind: msg.kind, createdAt: now, expiresAt: now + msg.ttlMs },
          ],
        });
        break;
      }
      case 'placement_result':
        if (!msg.ok) this.toast(msg.reason ?? `Could not place ${msg.kind}.`, 'error');
        break;
      case 'provider':
        this.set({ provider: msg.provider });
        break;
      case 'episode_end':
        this.set({ result: msg.result });
        break;
      case 'error':
        this.toast(msg.message, 'error');
        break;
    }
  }

  toast(text: string, tone: Toast['tone'] = 'info'): void {
    const now = performance.now();
    this.set({ toasts: [...this.state.toasts.filter((t) => t.expiresAt > now), { id: this.nextId++, text, tone, expiresAt: now + 4200 }] });
  }

  /** Remove expired bubbles/toasts (called by a low-frequency timer). */
  prune(): void {
    const now = performance.now();
    const bubbles = this.state.bubbles.filter((b) => b.expiresAt > now);
    const toasts = this.state.toasts.filter((t) => t.expiresAt > now);
    if (bubbles.length !== this.state.bubbles.length || toasts.length !== this.state.toasts.length) this.set({ bubbles, toasts });
  }
}

export const store = new Store();

export function useStore<T>(select: (s: UiState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}
