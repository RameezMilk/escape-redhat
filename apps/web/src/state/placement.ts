// Presenter placement tool: select Fire / Electrical failure (card click, drag, or F/E key), preview, place.
// Any number of each threat can be placed (Reset clears them). Validity uses the engine's shared validatePlacement;
// the server re-validates authoritatively.
import { useSyncExternalStore } from 'react';

import type { HazardKind, MapData, Snapshot, Tile } from '@escape/contracts';
import { doorNear, validatePlacement } from '@escape/engine';

import { send } from '../net/socket';
import { store } from './store';


export interface GhostState {
  kind: HazardKind | null;
  col: number;
  row: number;
  /** Whether the ghost is over the map (mouse/drag) or keyboard-positioned. */
  visible: boolean;
  dragging: boolean;
}

export interface GhostEval {
  valid: boolean;
  reason: string;
  /** Fire: the 2×2 seed. Electrical: the snapped door's tiles (or the hovered tile when invalid). */
  tiles: Tile[];
  componentId?: string;
}

type Listener = () => void;

class PlacementStore {
  state: GhostState = { kind: null, col: 14, row: 10, visible: false, dragging: false };
  private listeners = new Set<Listener>();
  map: MapData | null = null;

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getState = () => this.state;
  private set(p: Partial<GhostState>) {
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
  }

  select(kind: HazardKind | null): void {
    if (kind === this.state.kind && !this.state.dragging) {
      this.set({ kind: null, visible: false });
      return;
    }
    this.set({ kind, visible: kind !== null && this.state.visible });
  }
  startDrag(kind: HazardKind): void {
    this.set({ kind, dragging: true });
  }
  endDrag(): void {
    this.set({ dragging: false, visible: false, kind: null });
  }
  hover(col: number, row: number): void {
    if (col !== this.state.col || row !== this.state.row || !this.state.visible) this.set({ col, row, visible: true });
  }
  leave(): void {
    if (this.state.visible) this.set({ visible: false });
  }
  nudge(dc: number, dr: number): void {
    if (!this.map) return;
    const col = Math.max(0, Math.min(this.map.cols - 1, this.state.col + dc));
    const row = Math.max(0, Math.min(this.map.rows - 1, this.state.row + dr));
    this.set({ col, row, visible: true });
  }
  cancel(): void {
    this.set({ kind: null, visible: false, dragging: false });
  }

  evaluate(kind: HazardKind, col: number, row: number, snap: Snapshot | null): GhostEval {
    const here: Tile[] = kind === 'fire' ? [{ col, row }, { col: col + 1, row }, { col, row: row + 1 }, { col: col + 1, row: row + 1 }] : [{ col, row }];
    if (!this.map || !snap) return { valid: false, reason: 'Waiting for the simulation…', tiles: here };
    if (snap.outcome || snap.phase === 'ended') return { valid: false, reason: 'Episode is over — reset to place hazards.', tiles: here };
    if (snap.mode === 'replay') return { valid: false, reason: 'Replay is read-only.', tiles: here };
    const actors = snap.actors.filter((a) => !a.lost).map((a) => ({ col: Math.round(a.x), row: Math.round(a.y) }));
    const res = validatePlacement(this.map, { hazards: snap.hazards, actors }, kind, col, row);
    if (res.ok) {
      const door = res.componentId ? this.map.components.find((d) => d.id === res.componentId) : undefined;
      return {
        valid: true,
        reason: kind === 'fire' ? 'Start a fire here' : `Cut power: ${door?.label ?? res.componentId}`,
        tiles: res.tiles,
        componentId: res.componentId,
      };
    }
    // Electrical: still show which door the pointer is near (e.g. ALREADY_DISABLED) so the red preview is meaningful.
    const near = kind === 'electrical' ? doorNear(this.map, col, row) : null;
    return { valid: false, reason: res.reason, tiles: near ? near.tiles : here, componentId: near?.id };
  }

  /** Place at the current ghost position (or given tile). Returns true when a command was sent. */
  commit(kind = this.state.kind, col = this.state.col, row = this.state.row): boolean {
    if (!kind) return false;
    const snap = store.getState().snapshot;
    const ev = this.evaluate(kind, col, row, snap);
    if (!ev.valid) {
      store.toast(ev.reason, 'error');
      return false;
    }
    send({ type: 'place', kind, col, row });
    this.set({ kind: null, visible: false, dragging: false });
    return true;
  }
}

export const placement = new PlacementStore();

export function usePlacement<T>(select: (s: GhostState) => T): T {
  return useSyncExternalStore(placement.subscribe, () => select(placement.getState()));
}
