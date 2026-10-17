// Low-volume two-tone fire-alarm siren synthesised with WebAudio (no audio assets).
// Browsers only allow audio after a user gesture: the first pointer/key event (e.g. the start-screen click) unlocks it.

let ctx: AudioContext | null = null;
let nodes: { osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode } | null = null;
let unlocked = false;

const MUTE_KEY = 'escape.siren.muted';
let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
})();
const listeners = new Set<() => void>();

function unlock() {
  unlocked = true;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* audio unavailable */
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', unlock, { once: false, capture: true });
  window.addEventListener('keydown', unlock, { once: false, capture: true });
}

export function isMuted(): boolean {
  return muted;
}
export function setMuted(m: boolean): void {
  muted = m;
  try {
    localStorage.setItem(MUTE_KEY, m ? '1' : '0');
  } catch {
    /* ignore */
  }
  if (m) stopSiren();
  for (const l of listeners) l();
}
export function onMuteChange(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function startSiren(): void {
  if (muted || !unlocked || nodes) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 770;
    // Two-tone: a square LFO swings the pitch between ~650 and ~890 Hz, about 1.3 times a second.
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 1.3;
    const depth = ctx.createGain();
    depth.gain.value = 120;
    lfo.connect(depth).connect(osc.frequency);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(0.035, ctx.currentTime + 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    lfo.start();
    nodes = { osc, lfo, gain };
  } catch {
    nodes = null;
  }
}

export function stopSiren(): void {
  if (!nodes || !ctx) return;
  const { osc, lfo, gain } = nodes;
  nodes = null;
  try {
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.12);
    osc.stop(ctx.currentTime + 0.15);
    lfo.stop(ctx.currentTime + 0.15);
  } catch {
    /* already stopped */
  }
}
