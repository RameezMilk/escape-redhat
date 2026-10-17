// Bottom strip: the presenter's threats (Fire, Electrical failure — any number of each) + episode status.
import { useEffect, useRef } from 'react';

import type { HazardKind } from '@escape/contracts';

import { ACTOR_ORDER, ACTOR_VIEW } from '../office/actors';
import { getBoltSprite, getFireFrames } from '../office/sprites/hazards';
import { getCachedSprite } from '../vendor/pixel-agents/webview-ui/src/office/sprites/spriteCache';
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
      const sprite = kind === 'fire' ? getFireFrames()[Math.floor(t / 140) % 3] : getBoltSprite();
      if (kind === 'electrical' && Math.floor(t / 90) % 23 === 0) ctx.globalAlpha = 0.55; // occasional flicker
      ctx.drawImage(getCachedSprite(sprite, size / 32), 0, 0);
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [kind, size]);
  return <canvas ref={ref} width={size} height={size} className="card-icon" />;
}

const CARDS: { kind: HazardKind; title: string; key: string; blurb: string }[] = [
  { kind: 'fire', title: 'Fire', key: 'F', blurb: 'Starts on a 2×2 patch and spreads to neighbouring tiles. Anyone it reaches is lost.' },
  { kind: 'electrical', title: 'Electrical failure', key: 'E', blurb: 'Cuts power to an electric sliding door — it sticks shut.' },
];

export function Palette() {
  const selected = usePlacement((s) => s.kind);
  const snapshot = useStore((s) => s.snapshot);
  const ended = !!snapshot?.outcome;
  const count = (k: HazardKind) => snapshot?.hazards.filter((h) => h.kind === k).length ?? 0;
  const alarm = snapshot?.alarm;
  const as = snapshot?.assistance;

  return (
    <section className="panel palette">
      <div className="cards">
        {CARDS.map((c) => {
          const disabled = ended || snapshot?.mode === 'replay';
          const n = count(c.kind);
          return (
            <button
              key={c.kind}
              className={`card card-${c.kind} ${selected === c.kind ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
              draggable={!disabled}
              aria-pressed={selected === c.kind}
              title={disabled ? 'Reset to place threats again.' : `Drag onto the map, or press ${c.key} — you can place as many as you like`}
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
                  {n > 0 ? <span className="card-placed">×{n} placed</span> : null}
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
          <li>Drag a card onto the office (or click it, then click a tile). Place as many as you like.</li>
          <li>
            Keys: <kbd>F</kbd> fire · <kbd>E</kbd> electrical failure · arrows move · <kbd>Enter</kbd> place · <kbd>Esc</kbd> cancel · <kbd>P</kbd> pause.
          </li>
          <li>Start a fire, then cut power to a sliding door on the route people are using.</li>
        </ol>
      </div>
      <div className="roster">
        <div className="help-title">Roster</div>
        {ACTOR_ORDER.map((id) => {
          const a = snapshot?.actors.find((x) => x.id === id);
          const state = !a ? '—' : a.lost ? '✖ lost' : a.checkedIn ? '✓ checked in' : a.zone === 'assembly' ? 'at assembly' : a.alerted ? 'alerted' : 'unaware';
          return (
            <div key={id} className={`roster-row ${a?.lost ? 'is-lost' : ''}`} style={{ ['--actor' as string]: ACTOR_VIEW[id].color }}>
              <span className="dot" />
              <span className="rname">{ACTOR_VIEW[id].name}</span>
              <span className="rstate">{state}</span>
            </div>
          );
        })}
        <div className={`roster-row sub ${alarm?.active ? 'alarm-on' : ''}`}>
          {alarm?.active
            ? `🚨 alarm raised${alarm.by ? ` by ${ACTOR_VIEW[alarm.by].name}` : ''}${alarm.atSimTime !== undefined ? ` at ${alarm.atSimTime.toFixed(1)} s` : ''}`
            : 'alarm: not raised'}
        </div>
        <div className="roster-row sub">
          buddy (optional): {as ? (as.fulfilled ? 'escorted out ✓' : as.accepted ? 'escorting' : as.requested ? 'requested' : 'not used') : '—'}
        </div>
        <div className="roster-row sub">roster verified: {snapshot?.roster.verified ? 'yes ✓' : 'no'}</div>
      </div>
    </section>
  );
}
