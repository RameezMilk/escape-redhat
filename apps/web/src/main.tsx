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
import { startFixture } from './net/fixture';
import { connect } from './net/socket';
import { store } from './state/store';

// Dev-only handle for debugging in the browser console.
if (import.meta.env.DEV) (window as unknown as { __escape: unknown }).__escape = store;

const params = new URLSearchParams(location.search);
if (params.has('fixture')) startFixture(loadMap());
else connect();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
