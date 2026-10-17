// Bottom strip: the two presenter interventions (Fire, Blocker) + episode status.
import { useEffect, useRef } from 'react';

import type { HazardKind } from '@escape/contracts';

import { ACTOR_ORDER, ACTOR_VIEW } from '../office/actors';
import { getCachedSprite } from '../vendor/pixel-agents/webview-ui/src/office/sprites/spriteCache';
import { getBlockerSprite, getFireFrames } from '../office/sprites/hazards';
import { placement, usePlacement } from '../state/placement';
import { useStore } from '../state/store';

function SpriteIcon({ kind, size }: { kind: HazardKind; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    let raf = 0;
    const draw = (t: number) => {
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, c.width, c.height);
      const sprite = kind === 'fire' ? getFireFrames()[Math.floor(t / 140) % 3] : getBlockerSprite();
      ctx.drawImage(getCachedSprite(sprite, size / 32), 0, 0);
      if (kind === 'fire') raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [kind, size]);
  return <canvas ref={ref} width={size} height={size} className="card-icon" />;
}

const CARDS: { kind: HazardKind; title: string; key: string; blurb: string }[] = [
  { kind: 'fire', title: 'Fire', key: 'F', blurb: 'Impassable 2×2 hazard + 1-tile danger margin. Someone has to notice it.' },
  { kind: 'blocker', title: 'Blocker', key: 'B', blurb: 'Toppled cabinets. Cuts a corridor; discovered only when someone gets close.' },
];

export function Palette() {
  const selected = usePlacement((s) => s.kind);
  const snapshot = useStore((s) => s.snapshot);
  const placed = new Set(snapshot?.hazards.map((h) => h.kind) ?? []);
  const paused = snapshot?.paused ?? false;
  const ended = !!snapshot?.outcome;

  return (
    <section className="panel palette">
      <div className="cards">
        {CARDS.map((c) => {
          const isPlaced = placed.has(c.kind);
          const disabled = ended || snapshot?.mode === 'replay' || (isPlaced && !paused);
          return (
            <button
              key={c.kind}
              className={`card card-${c.kind} ${selected === c.kind ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
              draggable={!disabled}
              aria-pressed={selected === c.kind}
              title={disabled && isPlaced ? 'Already placed — pause to reposition, or reset.' : `Drag onto the map, or press ${c.key}`}
              onClick={() => !disabled && placement.select(c.kind)}
              onDragStart={(e) => {
                if (disabled) return e.preventDefault();
                e.dataTransfer.setData('application/x-escape-hazard', c.kind);
                e.dataTransfer.effectAllowed = 'copy';
                const img = e.currentTarget.querySelector('canvas');
                if (img) e.dataTransfer.setDragImage(img, 32, 32);
                placement.startDrag(c.kind);
              }}
              onDragEnd={() => placement.endDrag()}
            >
              <SpriteIcon kind={c.kind} size={64} />
              <span className="card-body">
                <span className="card-title">
                  {c.title} <kbd>{c.key}</kbd>
                  {isPlaced ? <span className="card-placed">{paused ? 'placed · click to move' : 'placed'}</span> : null}
                </span>
                <span className="card-blurb">{c.blurb}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="palette-help">
        <div className="help-title">How to play</div>
        <ol>
          <li>Drag a card onto the office (or click it, then click a tile).</li>
          <li>Keys: <kbd>F</kbd>/<kbd>B</kbd> select · arrows move · <kbd>Enter</kbd> place · <kbd>Esc</kbd> cancel · <kbd>P</kbd> pause.</li>
          <li>Try the fire first, then block the route people are using.</li>
        </ol>
      </div>
      <div className="roster">
        <div className="help-title">Roster</div>
        {ACTOR_ORDER.map((id) => {
          const a = snapshot?.actors.find((x) => x.id === id);
          return (
            <div key={id} className="roster-row" style={{ ['--actor' as string]: ACTOR_VIEW[id].color }}>
              <span className="dot" />
              <span className="rname">{ACTOR_VIEW[id].name}</span>
              <span className="rstate">{a ? (a.checkedIn ? '✓ checked in' : a.alerted ? 'alerted' : 'unaware') : '—'}</span>
            </div>
          );
        })}
        <div className="roster-row sub">
          assistance: {snapshot ? (snapshot.assistance.fulfilled ? 'fulfilled ✓' : snapshot.assistance.accepted ? 'escorting' : snapshot.assistance.requested ? 'requested' : snapshot.assistance.required ? 'agreed buddy (not yet requested)' : 'not required') : '—'}
        </div>
        <div className="roster-row sub">roster verified: {snapshot?.roster.verified ? 'yes ✓' : 'no'}</div>
      </div>
    </section>
  );
}
