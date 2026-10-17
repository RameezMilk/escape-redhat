import { useEffect, useState } from 'react';

import type { MapData } from '@escape/contracts';
import { loadMap } from '@escape/engine';

import { DebriefOverlay } from './debrief/DebriefOverlay';
import { send } from './net/socket';
import { loadPixelAssets } from './office/assetLoader';
import { OfficeView } from './office/OfficeView';
import { Palette } from './palette/Palette';
import { placement } from './state/placement';
import { store, useStore } from './state/store';
import { TopBar } from './topbar/TopBar';
import { TracePanel } from './trace/TracePanel';

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === 'f' || k === 'F') placement.select('fire');
      else if (k === 'b' || k === 'B') placement.select('blocker');
      else if (k === 'Escape') placement.cancel();
      else if (k === 'p' || k === 'P') {
        const snap = store.getState().snapshot;
        if (snap && !snap.outcome) send({ type: snap.paused ? 'resume' : 'pause' });
      } else if (placement.state.kind && k.startsWith('Arrow')) {
        e.preventDefault();
        const d = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[k] as [number, number] | undefined;
        if (d) placement.nudge(d[0], d[1]);
      } else if (placement.state.kind && k === 'Enter') {
        e.preventDefault();
        placement.commit();
      } else return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  const [map, setMap] = useState<MapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useKeyboard();

  useEffect(() => {
    loadPixelAssets()
      .then(() => setMap(loadMap()))
      .catch((e: unknown) => setError(String(e)));
    const id = window.setInterval(() => store.prune(), 250);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="app">
      <TopBar />
      <main className="stage panel">
        {map ? <OfficeView map={map} /> : <div className="loading">{error ? `Asset load failed: ${error}` : 'Loading pixel office…'}</div>}
        <DebriefOverlay />
      </main>
      <TracePanel />
      <Palette />
      <Toasts />
    </div>
  );
}
