// The pixel office: Pixel Agents canvas renderer (vendored, MIT @3537e14) driven by server snapshots,
// plus DOM overlays (name chips, speech bubbles, placement tooltip) positioned with the renderer's projection.
import { useEffect, useMemo, useRef, useState } from 'react';

import { ACTOR_PROFILES, type ActorId, type HazardKind, type MapData } from '@escape/contracts';

import { CHARACTER_SITTING_OFFSET_PX, CHARACTER_Z_SORT_OFFSET } from '../vendor/pixel-agents/webview-ui/src/constants';
import { getCharacterSprite } from '../vendor/pixel-agents/webview-ui/src/office/engine/characters';
import { startGameLoop } from '../vendor/pixel-agents/webview-ui/src/office/engine/gameLoop';
import { renderFrame, type ExtraDrawable } from '../vendor/pixel-agents/webview-ui/src/office/engine/renderer';
import { getCharacterSprites } from '../vendor/pixel-agents/webview-ui/src/office/sprites/spriteData';
import { mapOffset, overlayProjection } from '../vendor/pixel-agents/webview-ui/src/office/projection';
import { CharacterState, type Character } from '../vendor/pixel-agents/webview-ui/src/office/types';
import { placement, usePlacement } from '../state/placement';
import { store, useStore } from '../state/store';
import { evidenceNames, humanize, isShoutText } from '../trace/humanize';
import { ACTOR_ORDER, ACTOR_VIEW } from './actors';
import { drawDisintegration, TOTAL_SEC } from './effects/disintegrate';
import {
  createScene,
  buildingBounds,
  drawAlarmStrobe,
  drawGhost,
  extendedGroundMarkings,
  fixtureDrawables,
  rackLedDrawables,
  hazardDrawables,
  interpolateActors,
  staticDrawables,
  updateScene,
  type Scene,
} from './scene';

const T = 16;

interface Props {
  map: MapData;
}

function statusLine(a: { status: string; lost?: boolean; checkedIn: boolean; escort: { role: string; partner: ActorId } | null; task: { destination: string } | null }): string {
  if (a.lost) return 'lost';
  if (a.checkedIn) return 'checked in ✓';
  if (a.escort) return a.escort.role === 'leader' ? `escorting ${ACTOR_VIEW[a.escort.partner].name}` : `with ${ACTOR_VIEW[a.escort.partner].name}`;
  if (a.status === 'moving' && a.task) return /flee|away/i.test(a.task.destination) ? '↩ backing away' : `→ ${humanize(a.task.destination)}`;
  return a.status.replace(/_/g, ' ');
}

export function OfficeView({ map }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  /** zr = integer render zoom (device px per art px), s = extra nearest-neighbour scale to fill the stage, e = zr * s. */
  const zoomRef = useRef({ zr: 2, s: 1, e: 2 });
  const chipRefs = useRef<Partial<Record<ActorId, HTMLDivElement | null>>>({});
  const bubbleRefs = useRef<Partial<Record<ActorId, HTMLDivElement | null>>>({});
  const tipRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  /** Client time (ms) when each actor was first seen lost — drives the disintegration effect. */
  const lostRef = useRef<{ episode: string; at: Map<ActorId, number> }>({ episode: '', at: new Map() });

  const snapshot = useStore((s) => s.snapshot);
  const bubbles = useStore((s) => s.bubbles);
  const trace = useStore((s) => s.trace);
  const evNames = useMemo(() => evidenceNames(trace), [trace]);
  const ghost = usePlacement((s) => s);

  useEffect(() => {
    placement.map = map;
    sceneRef.current = createScene(map);
    setReady(true);
  }, [map]);

  // Canvas sizing + game loop
  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const scene = sceneRef.current!;
    const statics = staticDrawables(map);
    const building = buildingBounds(map);

    const offscreen = document.createElement('canvas');
    const ground = document.createElement('canvas'); // floor tiles only (no furniture or people), at render zoom
    const backdrop = document.createElement('canvas'); // stage-sized: the outdoors carried on past the map's edges
    const mapW = map.cols * T;
    const mapH = map.rows * T;

    /** Fill the stage around the map: beside it, its edge columns continue (sidewalk, road, far sidewalk) with the
     *  kerbs and centre line running on; above and below, plain sidewalk. Rebuilt on resize only. */
    const buildBackdrop = () => {
      const { zr, e } = zoomRef.current;
      const tz = T * zr;
      ground.width = mapW * zr;
      ground.height = mapH * zr;
      const g = ground.getContext('2d')!;
      g.imageSmoothingEnabled = false;
      renderFrame(g, ground.width, ground.height, scene.tileMap, [], [], zr, 0, 0, undefined, undefined, map.layout.tileColors, map.cols, map.rows);
      backdrop.width = canvas.width;
      backdrop.height = canvas.height;
      const b = backdrop.getContext('2d')!;
      b.imageSmoothingEnabled = false;
      const { offsetX: mx, offsetY: my } = mapOffset(canvas.width, canvas.height, map.cols, map.rows, e, 0, 0);
      const step = T * e;
      const xAt = (c: number) => Math.round(mx + c * step);
      const yAt = (r: number) => Math.round(my + r * step);
      const c0 = -Math.ceil(mx / step);
      const c1 = map.cols + Math.ceil((canvas.width - mx - mapW * e) / step);
      const r0 = -Math.ceil(my / step);
      const r1 = map.rows + Math.ceil((canvas.height - my - mapH * e) / step);
      for (let r = r0; r < r1; r++) {
        for (let c = c0; c < c1; c++) {
          const inRows = r >= 0 && r < map.rows;
          if (inRows && c >= 0 && c < map.cols) continue;
          const sc = inRows ? (c < 0 ? 0 : map.cols - 1) : 0;
          const sr = inRows ? r : r < 0 ? 0 : map.rows - 1;
          b.drawImage(ground, sc * tz, sr * tz, tz, tz, xAt(c), yAt(r), xAt(c + 1) - xAt(c), yAt(r + 1) - yAt(r));
        }
      }
      const ext = 5 * Math.ceil((Math.max(-c0, c1 - map.cols) + 1) / 5);
      for (const d of extendedGroundMarkings(map, ext)) d.draw(b, mx, my, e);
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = wrap.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      // Fill the stage: render at the largest integer zoom that fits (crisp), then upscale nearest-neighbour by the
      // remaining fraction so the map uses all the space it can; the backdrop covers whatever is left on the sides.
      const fit = Math.min(canvas.width / mapW, (canvas.height - 20 * dpr) / (mapH + T));
      const zr = Math.max(1, Math.floor(fit));
      const sc = Math.max(0.5, fit) / zr;
      zoomRef.current = { zr, s: sc, e: zr * sc };
      offscreen.width = mapW * zr;
      offscreen.height = (mapH + 2 * T) * zr; // one tile of headroom above row 0 (wall caps, signs) and below
      buildBackdrop();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const stop = startGameLoop(canvas, {
      update: (dt) => {
        const now = performance.now();
        const actors = interpolateActors(store.prev, store.curr, now);
        updateScene(scene, actors, dt);
      },
      render: (ctx) => {
        const now = performance.now();
        const { zr, s: sc, e } = zoomRef.current;
        const dpr = window.devicePixelRatio || 1;
        const off = offscreen.getContext('2d')!;
        off.imageSmoothingEnabled = false;
        const snap = store.curr?.snap;
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
        const hazards = snap?.hazards ?? [];
        const extras: ExtraDrawable[] = [
          ...statics,
          ...fixtureDrawables(map, hazards, snap?.alarm, now, reduced),
          ...rackLedDrawables(map, hazards, now, reduced),
          ...hazardDrawables(hazards, now, snap?.episodeId ?? '', map),
        ];
        // Losses: lost actors leave the normal character pass and play the disintegration effect instead.
        const lost = lostRef.current;
        if (snap && lost.episode !== snap.episodeId) {
          lost.at.clear();
          lost.episode = snap.episodeId;
        }
        const chars: Character[] = [];
        for (const [id, ch] of scene.characters) {
          const sa = snap?.actors.find((a) => a.id === id);
          if (!sa?.lost) {
            chars.push(ch);
            continue;
          }
          if (!lost.at.has(id as ActorId)) {
            // Reconnect / late join: don't replay an old loss.
            const stale = snap && sa.lostAtSimTime !== undefined && snap.simTime - sa.lostAtSimTime > 3;
            lost.at.set(id as ActorId, stale ? now - TOTAL_SEC * 1000 - 1 : now);
          }
          const elapsed = (now - lost.at.get(id as ActorId)!) / 1000;
          if (elapsed >= TOTAL_SEC) continue;
          const sprite = ch.spriteOverride ?? getCharacterSprite(ch, getCharacterSprites(ch.palette, ch.hueShift));
          const sitting = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
          extras.push({
            zY: ch.y + T / 2 + CHARACTER_Z_SORT_OFFSET,
            draw: (c, ox, oy, z) => {
              const w = (sprite[0]?.length ?? 16) * z;
              const h = sprite.length * z;
              drawDisintegration(c, sprite, Math.round(ox + ch.x * z - w / 2), Math.round(oy + (ch.y + sitting) * z - h), z, elapsed);
            },
          });
        }
        const { offsetX, offsetY } = renderFrame(
          off,
          offscreen.width,
          offscreen.height,
          scene.tileMap,
          scene.furniture,
          chars,
          zr,
          0,
          0,
          undefined,
          undefined,
          map.layout.tileColors,
          map.cols,
          map.rows,
          undefined,
          undefined,
          undefined,
          false,
          null,
          [],
          extras,
        );
        // Placement ghost (drawn at render zoom, scaled with the scene)
        const g = placement.state;
        const ev = g.kind && g.visible ? placement.evaluate(g.kind, g.col, g.row, store.getState().snapshot) : null;
        if (snap?.alarm?.active && !snap.outcome) {
          // The building and its walls, from one tile above the top wall (its caps) down to the bottom wall.
          const tz = T * zr;
          const rect = { x: offsetX + building.col * tz, y: offsetY + (building.row - 1) * tz, w: building.cols * tz, h: (building.rows + 1) * tz };
          drawAlarmStrobe(off, rect, now, reduced);
        }
        if (g.kind && ev) drawGhost(off, { kind: g.kind, col: g.col, row: g.row, valid: ev.valid, tiles: ev.tiles }, offsetX, offsetY, zr, now);

        // Blit to the visible canvas over the backdrop (nearest-neighbour upscale to the fitted zoom)
        const { offsetX: mx, offsetY: my } = mapOffset(canvas.width, canvas.height, map.cols, map.rows, e, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(backdrop, 0, 0);
        ctx.drawImage(offscreen, mx - offsetX * sc, my - offsetY * sc, offscreen.width * sc, offscreen.height * sc);

        const tip = tipRef.current;
        if (tip) {
          if (g.kind && ev) {
            tip.style.display = 'block';
            const tc = ev.tiles.length ? (Math.min(...ev.tiles.map((t) => t.col)) + Math.max(...ev.tiles.map((t) => t.col)) + 1) / 2 : g.col + 1;
            const tr = ev.tiles.length ? Math.min(...ev.tiles.map((t) => t.row)) - (g.kind === 'electrical' ? 1.4 : 0) : g.row;
            tip.style.transform = `translate(${Math.round((mx + tc * T * e) / dpr)}px, ${Math.round((my + tr * T * e) / dpr) - 8}px) translate(-50%, -100%)`;
            tip.textContent = ev.reason;
            tip.dataset.valid = String(ev.valid);
          } else tip.style.display = 'none';
        }
        // DOM overlays follow the characters
        const rect = wrap.getBoundingClientRect();
        const proj = overlayProjection(map, rect, e, { x: 0, y: 0 }, dpr);
        // Place name chips above heads. An escort pair travelling together shares one chip above the higher head
        // (so neither chip covers the partner's sprite); other overlapping chips are stacked.
        const snapActors = store.curr?.snap.actors ?? [];
        const placed: { x: number; y: number; w: number; h: number }[] = [];
        const order = [...ACTOR_ORDER].sort((a, b) => (scene.characters.get(b)?.y ?? 0) - (scene.characters.get(a)?.y ?? 0));
        const headOf = (id: ActorId) => {
          const c = scene.characters.get(id)!;
          const sitting = c.state === CharacterState.TYPE ? 6 : 0;
          return { x: c.x, y: c.y + sitting - (ACTOR_PROFILES[id].usesWheelchair ? 26 : 30) };
        };
        for (const id of order) {
          const ch = scene.characters.get(id);
          const chip = chipRefs.current[id];
          const bub = bubbleRefs.current[id];
          if (!ch || !chip) continue;
          const sa = snapActors.find((a) => a.id === id);
          if (sa?.lost) {
            const at = lostRef.current.at.get(id);
            const done = at === undefined || (performance.now() - at) / 1000 >= TOTAL_SEC;
            if (done) {
              chip.style.display = 'none';
              if (bub) bub.style.display = 'none';
              continue;
            }
          } else if (bub) bub.style.display = '';
          const partner = sa?.escort?.partner;
          const pc = partner ? scene.characters.get(partner) : undefined;
          const together = !!(partner && pc && Math.hypot(pc.x - ch.x, pc.y - ch.y) < 1.7 * T);
          let head = headOf(id);
          if (together && sa?.escort?.role === 'follower') {
            chip.style.display = 'none';
            if (bub) bub.style.transform = `translate(${Math.round(proj.toScreenX(head.x))}px, ${Math.round(proj.toScreenY(head.y)) - 4}px) translate(-50%, -100%)`;
            continue;
          }
          chip.style.display = '';
          chip.dataset.pair = String(together);
          if (together && partner) {
            const ph = headOf(partner);
            head = { x: (head.x + ph.x) / 2, y: Math.min(head.y, ph.y) };
          }
          const x = proj.toScreenX(head.x);
          let y = proj.toScreenY(head.y);
          const w = chip.offsetWidth;
          const h = chip.offsetHeight;
          for (let guard = 0; guard < 3; guard++) {
            const hit = placed.find((p) => Math.abs(p.x - x) < (p.w + w) / 2 + 2 && y > p.y - p.h - 2 && y - h < p.y + 2);
            if (!hit) break;
            y = hit.y - hit.h - 3;
          }
          placed.push({ x, y, w, h });
          chip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
          if (bub) bub.style.transform = `translate(${Math.round(x)}px, ${Math.round(y - h - 6)}px) translate(-50%, -100%)`;
        }
      },
    });
    return () => {
      stop();
      ro.disconnect();
    };
  }, [ready, map]);

  // Mouse/drag → tile under cursor (fire: 2×2 seed centred on the pointer; electrical: the tile under the pointer)
  const tileAt = (clientX: number, clientY: number, kind: HazardKind | null = placement.state.kind): { col: number; row: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const zoom = zoomRef.current.e;
    const { offsetX, offsetY } = mapOffset(canvas.width, canvas.height, map.cols, map.rows, zoom, 0, 0);
    const wx = ((clientX - rect.left) * dpr - offsetX) / zoom;
    const wy = ((clientY - rect.top) * dpr - offsetY) / zoom;
    const col = kind === 'electrical' ? Math.floor(wx / T) : Math.round(wx / T - 1);
    const row = kind === 'electrical' ? Math.floor(wy / T) : Math.round(wy / T - 1);
    if (col < -1 || row < -1 || col > map.cols || row > map.rows) return null;
    return { col, row };
  };

  const onMove = (e: React.MouseEvent) => {
    if (!placement.state.kind) return;
    const t = tileAt(e.clientX, e.clientY);
    if (t) placement.hover(t.col, t.row);
    else placement.leave();
  };

  const onClick = (e: React.MouseEvent) => {
    const kind = placement.state.kind;
    if (!kind) return;
    const t = tileAt(e.clientX, e.clientY);
    if (t) placement.commit(kind, t.col, t.row);
  };

  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-escape-hazard')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const t = tileAt(e.clientX, e.clientY);
    if (t) placement.hover(t.col, t.row);
  };

  const onDrop = (e: React.DragEvent) => {
    const kind = e.dataTransfer.getData('application/x-escape-hazard') as HazardKind;
    if (kind !== 'fire' && kind !== 'electrical') return;
    e.preventDefault();
    const t = tileAt(e.clientX, e.clientY, kind);
    if (t) placement.commit(kind, t.col, t.row);
    placement.endDrag();
  };

  const actors = snapshot?.actors ?? [];
  const now = performance.now();

  return (
    <div
      ref={wrapRef}
      className={`office ${ghost.kind ? 'placing' : ''}`}
      onMouseMove={onMove}
      onMouseLeave={() => placement.leave()}
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={() => placement.leave()}
      onDrop={onDrop}
    >
      <canvas ref={canvasRef} className="office-canvas" />
      <div className="overlay-layer">
        {ACTOR_ORDER.map((id) => {
          const a = actors.find((x) => x.id === id);
          const v = ACTOR_VIEW[id];
          return (
            <div
              key={id}
              ref={(el) => {
                chipRefs.current[id] = el;
              }}
              className={`name-chip ${a?.checkedIn ? 'done' : ''} ${a?.alerted ? 'alerted' : ''} ${a?.lost ? 'lost' : ''}`}
              style={{ ['--actor' as string]: v.color }}
            >
              <span className="name">
                {v.name}
                {a?.escort?.role === 'leader' ? (
                  <span className="pair-name">
                    {' '}
                    + {ACTOR_VIEW[a.escort.partner].name}
                  </span>
                ) : null}
              </span>
              {a ? <span className="status">{statusLine(a)}</span> : null}
            </div>
          );
        })}
        {ACTOR_ORDER.map((id) => {
          const b = [...bubbles].reverse().find((x) => x.actor === id && x.kind !== 'alert');
          const alert = bubbles.find((x) => x.actor === id && x.kind === 'alert');
          const shown = b ?? alert;
          return (
            <div
              key={`b-${id}`}
              ref={(el) => {
                bubbleRefs.current[id] = el;
              }}
              className={`bubble ${shown ? `kind-${shown.kind}` : 'hidden'} ${shown && shown.expiresAt - now < 600 ? 'fading' : ''}`}
            >
              {shown ? (
                <>
                  {shown.kind === 'message' ? (
                    isShoutText(shown.text) ? (
                      <span className="bubble-tag tag-instinct" title="human instinct — not a model decision">
                        instinct
                      </span>
                    ) : (
                      <span className="bubble-tag">says</span>
                    )
                  ) : null}
                  <span className="bubble-text">{humanize(shown.text, evNames)}</span>
                </>
              ) : null}
            </div>
          );
        })}
        <div ref={tipRef} className="ghost-tip" style={{ display: 'none' }} />
      </div>
      {snapshot?.mode === 'replay' ? <div className="replay-badge">REPLAY · recorded run</div> : null}
      {snapshot?.paused ? <div className="paused-badge">PAUSED</div> : null}
      {snapshot?.alarm?.active && !snapshot.outcome ? <div className="alarm-badge-map">🚨 FIRE ALARM — EVACUATE</div> : null}
    </div>
  );
}
