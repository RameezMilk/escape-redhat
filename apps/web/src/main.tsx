import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/pixelify-sans/500.css';
import '@fontsource/press-start-2p/400.css';
import '@fontsource/pixelify-sans/700.css';
import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { loadMap } from '@escape/engine';

import { App } from './App';
import { Gallery } from './gallery/Gallery';
import { startFixture } from './net/fixture';
import { connect } from './net/socket';
import { store } from './state/store';

// Dev-only handle for debugging in the browser console.
if (import.meta.env.DEV) (window as unknown as { __escape: unknown }).__escape = store;

const params = new URLSearchParams(location.search);
// ?render=timer: drive animation with timers instead of requestAnimationFrame, so the office keeps rendering in a
// hidden/background window (screen capture of a non-focused window, automated screenshots). Visual-only.
if (params.get('render') === 'timer') {
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 33)) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number) => window.clearTimeout(id)) as typeof window.cancelAnimationFrame;
}
// ?gallery=1: sprite review page (no server, no office).
const gallery = params.has('gallery');
if (gallery) {
  /* sprites only */
} else if (params.has('fixture')) startFixture(loadMap());
else connect();

createRoot(document.getElementById('root')!).render(<StrictMode>{gallery ? <Gallery /> : <App />}</StrictMode>);
