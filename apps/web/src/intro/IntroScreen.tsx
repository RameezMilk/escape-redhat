import { useCallback, useEffect, useRef, useState } from 'react';

import { drawTowerScene, type Rect } from './towerScene';

/** Logical scene height the art is composed for; the canvas is scaled by an integer factor to stay crisp. */
const SCENE_W = 400;
const SCENE_H = 225;
const ZOOM_MS = 1150;

interface Props {
  /** Called when the zoom starts (the office starts fading in underneath). */
  onEnterStart: () => void;
  /** Called when the intro has fully faded out. */
  onDone: () => void;
}

export function IntroScreen({ onEnterStart, onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scaleRef = useRef(3);
  const glowRef = useRef<Rect | null>(null);
  const hoverRef = useRef(false);
  const [hover, setHover] = useState(false);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const leavingRef = useRef(false);

  // Fit: integer scale, logical canvas grows to cover the viewport (extra space = more sky/street).
  useEffect(() => {
    const fit = () => {
      const c = canvasRef.current;
      if (!c) return;
      const s = Math.max(1, Math.min(Math.floor(window.innerHeight / SCENE_H), Math.floor(window.innerWidth / SCENE_W)));
      const w = Math.ceil(window.innerWidth / s);
      const h = Math.ceil(window.innerHeight / s);
      c.width = w;
      c.height = h;
      c.style.width = `${w * s}px`;
      c.style.height = `${h * s}px`;
      scaleRef.current = s;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // Render loop.
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      const c = canvasRef.current;
      const ctx = c?.getContext('2d');
      if (c && ctx) {
        const layout = drawTowerScene(ctx, c.width, c.height, (now - t0) / 1000, hoverRef.current || leavingRef.current);
        glowRef.current = layout.glow;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const enter = useCallback(() => {
    if (leavingRef.current) return;
    const g = glowRef.current;
    const s = scaleRef.current;
    leavingRef.current = true;
    setTip(null);
    setOrigin(g ? { x: (g.x + g.w / 2) * s, y: (g.y + g.h / 2) * s } : { x: window.innerWidth / 2, y: window.innerHeight / 2 });
    onEnterStart();
    window.setTimeout(onDone, ZOOM_MS);
  }, [onDone, onEnterStart]);

  // Keyboard: Enter / Space enters the building.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        enter();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [enter]);

  const hitTest = (clientX: number, clientY: number): boolean => {
    const g = glowRef.current;
    const c = canvasRef.current;
    if (!g || !c) return false;
    const r = c.getBoundingClientRect();
    const s = scaleRef.current;
    const x = (clientX - r.left) / s;
    const y = (clientY - r.top) / s;
    return x >= g.x - 3 && x <= g.x + g.w + 3 && y >= g.y - 3 && y <= g.y + g.h + 3;
  };

  const onMove = (e: React.MouseEvent) => {
    if (leavingRef.current) return;
    const h = hitTest(e.clientX, e.clientY);
    if (h !== hoverRef.current) {
      hoverRef.current = h;
      setHover(h);
    }
    setTip(h ? { x: e.clientX, y: e.clientY } : null);
  };

  return (
    <div className={`intro ${origin ? 'leaving' : ''}`} role="dialog" aria-label="Escape Red Hat start screen">
      <canvas
        ref={canvasRef}
        className="intro-canvas"
        style={{ cursor: hover ? 'pointer' : 'default', transformOrigin: origin ? `${origin.x}px ${origin.y}px` : undefined }}
        onMouseMove={onMove}
        onMouseLeave={() => {
          hoverRef.current = false;
          setHover(false);
          setTip(null);
        }}
        onClick={(e) => hitTest(e.clientX, e.clientY) && enter()}
      />
      <header className="intro-title">
        <h1 className="arcade">ESCAPE RED HAT</h1>
      </header>
      <button type="button" className="intro-prompt" onClick={enter}>
        <span className="blink">▶</span> CLICK THE GLOWING GROUND FLOOR <span className="blink">◀</span>
      </button>
      {tip && (
        <div className="intro-tip" style={{ left: tip.x + 14, top: tip.y - 30 }}>
          GROUND FLOOR · ENTER
        </div>
      )}
      <footer className="intro-foot">Fictional interior · not affiliated with or endorsed by Red Hat or NVIDIA · press Enter to start</footer>
    </div>
  );
}
